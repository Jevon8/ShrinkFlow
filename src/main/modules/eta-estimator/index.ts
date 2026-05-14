import { spawn } from 'child_process'
import { unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CompressionMode } from '../compression-planner'
import type { CompressionPlan } from '../compression-planner'
import type { DeviceProfile } from '../device-profiler'
import { getFfmpegPath } from '../ffmpeg-manager'
import {
  queryBenchmarks,
  getResolutionBucket,
  type CompressionBenchmark,
  type ResolutionBucket
} from '../benchmark-store'

export interface EtaEstimateInput {
  duration: number
  width: number
  height: number
  videoCodec: string
  bitrate: number
  frameRate?: number
}

interface SpeedRange {
  minSpeedX: number
  maxSpeedX: number
}

export interface VideoEtaEstimate {
  videoIndex: number
  durationSeconds: number
  pixelFactor: number
  estimatedSecondsMin: number
  estimatedSecondsMax: number
}

export interface EtaEstimateResult {
  estimatedSecondsMin: number
  estimatedSecondsMax: number
  confidence: 'low' | 'medium' | 'high'
  source: 'history' | 'rule' | 'probe'
  reasons: string[]
  estimatedVideosCount: number
  ignoredVideosCount: number
  ignoredReasons: string[]
  debugBreakdown: {
    totalDurationSeconds: number
    averagePixelFactor: number
    mode: string
    speedRange?: SpeedRange
    selectedSpeedX?: number
    historySampleCount?: number
    probeSpeedX?: number
    formula: string
    perVideo: VideoEtaEstimate[]
  }
}

export interface EtaEstimateUnavailable {
  available: false
  reasons: string[]
}

type EtaResult = EtaEstimateResult | EtaEstimateUnavailable

// Reference: 1080p30 = 1920*1080 pixels
const REFERENCE_1080P_PIXELS = 1920 * 1080

// Base speed range for CPU libx264 medium at 1080p30
// speedMultiplier = videoDuration / actualCompressionSeconds
const BASE_MIN_SPEED_X = 2
const BASE_MAX_SPEED_X = 12

// Mode speed factors (relative to balanced / medium preset)
function getModeSpeedFactor(mode: CompressionMode): number {
  switch (mode) {
    case 'balanced': return 1.0
    case 'compatible_high_quality': return 0.9
    case 'quality_first': return 0.45
    case 'smallest_size': return 0.75
    case 'target_size_fast': return 0.8
    case 'target_size_accurate': return 0.4
    case 'heavy_balanced': return 0.9
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function computePixelFactor(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return (width * height) / REFERENCE_1080P_PIXELS
}

function computeComplexityFactor(width: number, height: number, fps?: number): number {
  const pixelFactor = computePixelFactor(width, height)
  const fpsFactor = fps && fps > 0 ? fps / 30 : 1
  return pixelFactor * fpsFactor
}

function estimateSingleVideo(
  duration: number,
  width: number,
  height: number,
  fps: number | undefined,
  modeSpeedFactor: number,
  speedRange: SpeedRange
): { min: number; max: number } {
  const complexity = computeComplexityFactor(width, height, fps)
  // Higher complexity → lower speed → longer encoding
  const minSpeedX = speedRange.minSpeedX / complexity
  const maxSpeedX = speedRange.maxSpeedX / complexity
  return {
    min: duration / maxSpeedX,
    max: duration / minSpeedX
  }
}

export async function estimateEta(
  videos: EtaEstimateInput[],
  mode: CompressionMode,
  deviceProfile: DeviceProfile,
  userDataPath?: string,
  probeSpeedX?: number
): Promise<EtaResult> {
  if (videos.length === 0) {
    return { available: false, reasons: ['No videos provided'] }
  }

  const reasons: string[] = []
  const ignoredReasons: string[] = []

  // Filter valid videos (need duration > 0 AND width > 0 AND height > 0)
  const validVideos: { video: EtaEstimateInput; index: number }[] = []
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]
    if (v.duration > 0 && v.width > 0 && v.height > 0) {
      validVideos.push({ video: v, index: i })
    } else {
      if (v.duration <= 0) ignoredReasons.push('missing_duration')
      if (v.width <= 0 || v.height <= 0) ignoredReasons.push('missing_resolution')
    }
  }

  if (validVideos.length === 0) {
    return {
      available: false,
      reasons: ['All videos are missing duration or resolution metadata']
    }
  }

  const totalDuration = validVideos.reduce((sum, { video }) => sum + video.duration, 0)
  const avgPixelFactor = validVideos.reduce((sum, { video }) => sum + computePixelFactor(video.width, video.height), 0) / validVideos.length
  const modeSpeedFactor = getModeSpeedFactor(mode)

  // Build the base speed range for this mode
  const modeAdjustedRange: SpeedRange = {
    minSpeedX: BASE_MIN_SPEED_X * modeSpeedFactor,
    maxSpeedX: BASE_MAX_SPEED_X * modeSpeedFactor
  }

  // Try history first
  let historySpeeds: number[] = []
  let historySampleCount = 0
  let source: 'history' | 'rule' | 'probe' = 'rule'
  let selectedSpeedX: number | undefined
  const speedRange = modeAdjustedRange

  if (userDataPath) {
    try {
      // Determine dominant resolution bucket from input videos
      const bucketCounts = new Map<ResolutionBucket, number>()
      for (const { video } of validVideos) {
        const bucket = getResolutionBucket(video.height)
        bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
      }
      let dominantBucket: ResolutionBucket | undefined
      let maxCount = 0
      for (const [bucket, count] of bucketCounts) {
        if (count > maxCount) {
          maxCount = count
          dominantBucket = bucket
        }
      }

      // Query benchmarks with same mode, resolution bucket, and output codec
      const benchmarks = await queryBenchmarks(userDataPath, {
        mode,
        resolutionBucket: dominantBucket,
        outputCodec: 'h264'
      })
      const matchingBenchmarks = benchmarks.filter((b) => b.speedMultiplier > 0)
      historySpeeds = matchingBenchmarks.map((b) => b.speedMultiplier)
      historySampleCount = historySpeeds.length
    } catch {
      // Ignore errors reading benchmarks
    }
  }

  if (probeSpeedX !== undefined && probeSpeedX > 0) {
    // Quick probe takes priority over history
    source = 'probe'
    selectedSpeedX = probeSpeedX
    reasons.push('probe_used')
  } else if (historySampleCount >= 3) {
    source = 'history'
    selectedSpeedX = median(historySpeeds)
    reasons.push('history_match')
  } else if (historySampleCount >= 1) {
    source = 'history'
    selectedSpeedX = historySpeeds.reduce((a, b) => a + b, 0) / historySpeeds.length
    reasons.push('history_limited')
  } else {
    source = 'rule'
    if (deviceProfile.availableHardwareEncoders.length > 0) {
      reasons.push('hw_not_used')
    } else {
      reasons.push('cpu_only')
    }
  }

  // Per-video estimation and sum
  const perVideo: VideoEtaEstimate[] = []
  let totalMin = 0
  let totalMax = 0

  for (const { video, index } of validVideos) {
    const pf = computePixelFactor(video.width, video.height)
    let vMin: number
    let vMax: number

    if (selectedSpeedX !== undefined) {
      // History/probe: apply pixel factor ratio to the selected speed
      const videoComplexity = computeComplexityFactor(video.width, video.height, video.frameRate)
      const avgComplexity = avgPixelFactor // reference is 1080p = 1.0
      const complexityRatio = videoComplexity / avgComplexity
      const adjustedSpeed = selectedSpeedX * (complexityRatio > 0 ? 1 / complexityRatio : 1)
      const marginFactor = source === 'probe' ? 0.2 : (historySampleCount >= 3 ? 0.2 : 0.4)
      vMin = video.duration / (adjustedSpeed * (1 + marginFactor))
      vMax = video.duration / (adjustedSpeed * (1 - marginFactor))
    } else {
      // Rule: per-video based on its own resolution
      const est = estimateSingleVideo(video.duration, video.width, video.height, video.frameRate, modeSpeedFactor, speedRange)
      vMin = est.min
      vMax = est.max
    }

    perVideo.push({
      videoIndex: index,
      durationSeconds: video.duration,
      pixelFactor: pf,
      estimatedSecondsMin: Math.max(Math.round(vMin), 1),
      estimatedSecondsMax: Math.max(Math.round(vMax), 2)
    })

    totalMin += vMin
    totalMax += vMax
  }

  const estimatedSecondsMin = Math.max(Math.round(totalMin), 1)
  let estimatedSecondsMax = Math.max(Math.round(totalMax), estimatedSecondsMin + 1)

  // Sanity check: short videos without history should not show huge estimates
  if (source === 'rule' && totalDuration <= 300) {
    // Cap max at a reasonable multiplier of total duration
    const capSeconds = Math.max(totalDuration * 2, 60)
    if (estimatedSecondsMax > capSeconds) {
      estimatedSecondsMax = Math.round(capSeconds)
      reasons.push('short_video_capped')
    }
  }

  // Sanity check: if range is too wide and source is rule, warn
  if (source === 'rule' && estimatedSecondsMin > 0 && estimatedSecondsMax / estimatedSecondsMin > 4) {
    reasons.push('wide_range')
  }

  // Confidence
  let confidence: 'low' | 'medium' | 'high'
  if (source === 'probe') {
    confidence = 'medium'
  } else if (historySampleCount >= 3) {
    confidence = 'high'
  } else if (historySampleCount >= 1) {
    confidence = 'medium'
  } else {
    confidence = 'low'
  }

  const formula = source === 'history' || source === 'probe'
    ? `sum(perVideo.duration / adjustedSpeed) ± margin, selectedSpeed=${selectedSpeedX!.toFixed(1)}x`
    : `sum(perVideo.duration / (speedRange/${avgPixelFactor.toFixed(2)}pf))`

  const result: EtaResult = {
    estimatedSecondsMin,
    estimatedSecondsMax,
    confidence,
    source,
    reasons,
    estimatedVideosCount: validVideos.length,
    ignoredVideosCount: videos.length - validVideos.length,
    ignoredReasons: [...new Set(ignoredReasons)],
    debugBreakdown: {
      totalDurationSeconds: totalDuration,
      averagePixelFactor: Math.round(avgPixelFactor * 1000) / 1000,
      mode,
      speedRange,
      selectedSpeedX,
      historySampleCount: historySampleCount || undefined,
      probeSpeedX,
      formula,
      perVideo
    }
  }

  // Debug log
  console.log(`[eta] estimate result:`)
  console.log(`  estimatedVideosCount: ${validVideos.length}`)
  console.log(`  ignoredVideosCount: ${videos.length - validVideos.length}`)
  console.log(`  totalDurationSeconds: ${totalDuration}`)
  console.log(`  averagePixelFactor: ${avgPixelFactor.toFixed(3)}`)
  console.log(`  mode: ${mode}`)
  console.log(`  source: ${source}`)
  if (speedRange) console.log(`  speedRange: ${speedRange.minSpeedX.toFixed(1)}x – ${speedRange.maxSpeedX.toFixed(1)}x`)
  if (selectedSpeedX !== undefined) console.log(`  selectedSpeedX: ${selectedSpeedX.toFixed(1)}x`)
  console.log(`  historySampleCount: ${historySampleCount}`)
  if (probeSpeedX !== undefined) console.log(`  probeSpeedX: ${probeSpeedX.toFixed(1)}x`)
  console.log(`  estimatedSecondsMin: ${estimatedSecondsMin}`)
  console.log(`  estimatedSecondsMax: ${estimatedSecondsMax}`)
  console.log(`  confidence: ${confidence}`)

  return result
}

/**
 * Run a quick probe: compress a short segment of the given video to measure actual speed.
 * Returns the speedMultiplier (videoDuration / actualCompressionSeconds) for the probe segment.
 * Returns null if probe fails.
 */
export async function runQuickProbe(
  inputPath: string,
  videoDuration: number,
  plan: CompressionPlan,
  probeSeconds: number = 5
): Promise<number | null> {
  const ffmpeg = getFfmpegPath()
  const probeDuration = Math.min(probeSeconds, videoDuration, 10)

  // Build a temp output path
  let tempDir: string
  try {
    tempDir = await mkdtemp(join(tmpdir(), 'shrinkflow-probe-'))
  } catch {
    return null
  }

  const tempOutput = join(tempDir, `probe_${Date.now()}.mp4`)
  console.log(`[eta-probe] started: input=${inputPath} probeDuration=${Math.min(probeSeconds, videoDuration, 10)}s tempOutput=${tempOutput}`)

  // Build FFmpeg args: take the plan's input args, replace output with temp path
  const args = [...plan.ffmpegArgs]
  const inputArgs = args.slice(0, -1)
  const fullArgs = [
    ...inputArgs,
    '-t', String(probeDuration),
    '-y', // overwrite temp
    tempOutput
  ]

  return new Promise<number | null>((resolve) => {
    const startTime = Date.now()
    const child = spawn(ffmpeg, fullArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

    child.stderr?.on('data', () => {})
    child.stdout?.on('data', () => {})

    child.on('close', async (code) => {
      const elapsedSeconds = (Date.now() - startTime) / 1000

      // Clean up temp file
      try { await unlink(tempOutput) } catch { /* ignore cleanup errors */ }
      try {
        const { rmdir } = await import('fs/promises')
        await rmdir(tempDir)
      } catch { /* ignore cleanup errors */ }
      console.log(`[eta-probe] cleaned temp file: ${tempOutput}`)

      if (code !== 0 || elapsedSeconds <= 0) {
        console.log(`[eta-probe] failed: code=${code} elapsed=${elapsedSeconds}s`)
        resolve(null)
        return
      }

      const speedX = probeDuration / elapsedSeconds
      console.log(`[eta-probe] completed: probeDuration=${probeDuration}s elapsed=${elapsedSeconds.toFixed(1)}s speedX=${speedX.toFixed(1)}`)
      resolve(speedX)
    })

    child.on('error', async (err) => {
      console.log(`[eta-probe] failed: spawn error: ${err.message}`)
      try { await unlink(tempOutput) } catch { /* ignore cleanup errors */ }
      try {
        const { rmdir } = await import('fs/promises')
        await rmdir(tempDir)
      } catch { /* ignore cleanup errors */ }
      console.log(`[eta-probe] cleaned temp file after error: ${tempOutput}`)
      resolve(null)
    })
  })
}
