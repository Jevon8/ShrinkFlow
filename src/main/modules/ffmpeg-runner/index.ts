import { spawn, type ChildProcess } from 'child_process'
import { stat, unlink, rm } from 'fs/promises'
import { dirname } from 'path'
import { getFfmpegPath } from '../ffmpeg-manager'
import type { CompressionPlan } from '../compression-planner'

export type CompressionPhase = 'single' | 'two_pass_analyze' | 'two_pass_encode'

export interface CompressionProgress {
  percent: number
  elapsedSeconds: number
  remainingLabel: string
  remainingSeconds: number
  speed: string
  outTimeUs: number
  phase: CompressionPhase
}

export interface CompressionResult {
  success: boolean
  originalSize: number
  outputSize: number
  savedSize: number
  compressionRatio: number
  outputPath: string
  error?: string
  targetSizeMB?: number
  actualSizeMB?: number
  sizeErrorPercent?: number
  accuracyMode?: 'fast' | 'accurate'
  outputLargerThanInput?: boolean
  noSaving?: boolean
}


function parseProgressLine(key: string, value: string, state: Record<string, string>): void {
  state[key.trim()] = value.trim()
}

function parseOutTimeUs(state: Record<string, string>): number {
  // out_time_ms is in microseconds (despite the name)
  const ms = state['out_time_ms']
  if (ms) {
    const val = parseInt(ms, 10)
    return isNaN(val) ? 0 : val
  }
  // Fallback: parse out_time HH:MM:SS.xx
  const t = state['out_time']
  if (!t) return 0
  const parts = t.split(':')
  if (parts.length !== 3) return 0
  const h = parseFloat(parts[0]) || 0
  const m = parseFloat(parts[1]) || 0
  const s = parseFloat(parts[2]) || 0
  return Math.floor((h * 3600 + m * 60 + s) * 1_000_000)
}

function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.ceil(seconds % 60)
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

async function cleanupPassLogs(passLogPath: string): Promise<void> {
  const candidates = [
    passLogPath,
    passLogPath + '-0.log',
    passLogPath + '-0.log.mbtree',
    passLogPath + '.log',
    passLogPath + '.log.mbtree'
  ]
  for (const f of candidates) {
    try {
      await unlink(f)
      console.log(`[two-pass] cleanup pass log: ${f}`)
    } catch { /* ignore — file may not exist */ }
  }
  const logDir = dirname(passLogPath)
  try {
    await rm(logDir, { recursive: true, force: true })
    console.log(`[two-pass] cleanup pass log dir: ${logDir}`)
  } catch (err) {
    console.log(`[two-pass] cleanup failed: ${logDir}`, err)
  }
}

function buildSizeResult(
  plan: CompressionPlan,
  originalSize: number,
  outputSize: number,
  success: boolean,
  error?: string
): CompressionResult {
  const savedSize = originalSize - outputSize
  const compressionRatio = originalSize > 0 ? outputSize / originalSize : 0
  const actualSizeMB = outputSize / (1024 * 1024)
  const targetSizeMB = plan.targetSizeMB
  const sizeErrorPercent = targetSizeMB && targetSizeMB > 0
    ? (actualSizeMB - targetSizeMB) / targetSizeMB * 100
    : undefined

  return {
    success,
    originalSize,
    outputSize,
    savedSize,
    compressionRatio,
    outputPath: plan.outputPath,
    error,
    targetSizeMB,
    actualSizeMB,
    sizeErrorPercent,
    accuracyMode: plan.accuracyMode
  }
}

function spawnFfmpeg(
  ffmpeg: string,
  args: string[],
  durationSeconds: number,
  onProgress: (progress: CompressionProgress) => void,
  progressOffset: number,
  progressScale: number,
  startTime: number,
  canceled: { value: boolean },
  label: string,
  phase: CompressionPhase
): { child: ChildProcess; promise: Promise<{ code: number | null; signal: string | null }> } {
  const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

  let stdoutBuffer = ''
  const progressState: Record<string, string> = {}

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString()
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx)
      const value = trimmed.slice(eqIdx + 1)
      parseProgressLine(key, value, progressState)

      if (key === 'progress') {
        const outTimeUs = parseOutTimeUs(progressState)
        const durationUs = durationSeconds * 1_000_000
        const rawPercent = durationUs > 0 ? (outTimeUs / durationUs) * 100 : 0
        const percent = Math.min(Math.max(rawPercent, 0), 100)
        const mappedPercent = Math.round((progressOffset + percent * progressScale) * 10) / 10
        const elapsedSeconds = (Date.now() - startTime) / 1000
        const speed = progressState['speed'] || '--'

        let remainingLabel: string
        let remainingSeconds: number
        if (mappedPercent < 5) {
          remainingLabel = 'Estimating'
          remainingSeconds = -1
        } else {
          const totalEstimated = (elapsedSeconds / mappedPercent) * 100
          const remaining = Math.max(totalEstimated - elapsedSeconds, 0)
          remainingSeconds = Math.round(remaining)
          remainingLabel = formatRemaining(remaining)
        }

        console.log(`[FFmpeg] ${label}: ${mappedPercent}% speed=${speed}`)
        onProgress({
          percent: mappedPercent,
          elapsedSeconds: Math.round(elapsedSeconds),
          remainingLabel,
          remainingSeconds,
          speed,
          outTimeUs,
          phase
        })

        for (const k of Object.keys(progressState)) {
          delete progressState[k]
        }
      }
    }
  })

  child.stderr?.on('data', () => {})

  const promise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ code, signal })
    })
    child.on('error', () => {
      resolve({ code: 1, signal: null })
    })
  })

  return { child, promise }
}

export function runCompression(
  plan: CompressionPlan,
  durationSeconds: number,
  onProgress: (progress: CompressionProgress) => void
): { promise: Promise<CompressionResult>; cancel: () => void } {
  const ffmpeg = getFfmpegPath()
  let currentChild: ChildProcess | null = null
  let canceled = false
  const startTime = Date.now()

  const promise = new Promise<CompressionResult>((resolve) => {
    void (async () => {
    const fileName = plan.inputPath.split(/[/\\]/).pop() || plan.inputPath

    // Two-pass encoding
    if (plan.twoPass) {
      const { pass1Args, pass2Args, passLogPath } = plan.twoPass
      console.log(`[two-pass] Started: ${fileName} → ${plan.outputPath}`)

      try {
        // Pass 1: analysis (0% → 50%)
        console.log(`[two-pass] Pass 1: ${fileName}`)
        const pass1 = spawnFfmpeg(ffmpeg, pass1Args, durationSeconds, onProgress, 0, 0.5, startTime, { get value() { return canceled }, set value(v: boolean) { canceled = v } }, `Pass 1 ${fileName}`, 'two_pass_analyze')
        currentChild = pass1.child
        const pass1Result = await pass1.promise

        if (canceled) {
          resolve({
            success: false,
            originalSize: 0,
            outputSize: 0,
            savedSize: 0,
            compressionRatio: 0,
            outputPath: plan.outputPath,
            error: 'Canceled',
            targetSizeMB: plan.targetSizeMB,
            accuracyMode: plan.accuracyMode
          })
          return
        }

        if (pass1Result.code !== 0) {
          resolve({
            success: false,
            originalSize: 0,
            outputSize: 0,
            savedSize: 0,
            compressionRatio: 0,
            outputPath: plan.outputPath,
            error: `Pass 1 failed: FFmpeg exited with code ${pass1Result.code}`,
            targetSizeMB: plan.targetSizeMB,
            accuracyMode: plan.accuracyMode
          })
          return
        }

        // Pass 2: encoding (50% → 100%)
        console.log(`[two-pass] Pass 2: ${fileName}`)
        const pass2 = spawnFfmpeg(ffmpeg, pass2Args, durationSeconds, onProgress, 50, 0.5, startTime, { get value() { return canceled }, set value(v: boolean) { canceled = v } }, `Pass 2 ${fileName}`, 'two_pass_encode')
        currentChild = pass2.child
        const pass2Result = await pass2.promise

        if (canceled) {
          resolve({
            success: false,
            originalSize: 0,
            outputSize: 0,
            savedSize: 0,
            compressionRatio: 0,
            outputPath: plan.outputPath,
            error: 'Canceled',
            targetSizeMB: plan.targetSizeMB,
            accuracyMode: plan.accuracyMode
          })
          return
        }

        if (pass2Result.code !== 0) {
          resolve({
            success: false,
            originalSize: 0,
            outputSize: 0,
            savedSize: 0,
            compressionRatio: 0,
            outputPath: plan.outputPath,
            error: `Pass 2 failed: FFmpeg exited with code ${pass2Result.code}`,
            targetSizeMB: plan.targetSizeMB,
            accuracyMode: plan.accuracyMode
          })
          return
        }

        // Both passes succeeded — stat files
        const [inputStat, outputStat] = await Promise.all([
          stat(plan.inputPath),
          stat(plan.outputPath)
        ])

        // Emit final 100%
        onProgress({
          percent: 100,
          elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
          remainingLabel: '0s',
          remainingSeconds: 0,
          speed: '--',
          outTimeUs: durationSeconds * 1_000_000,
          phase: 'two_pass_encode'
        })

        console.log(`[two-pass] Completed: ${fileName} saved=${inputStat.size - outputStat.size} bytes`)
        resolve(buildSizeResult(plan, inputStat.size, outputStat.size, true))
      } catch (err) {
        resolve({
          success: false,
          originalSize: 0,
          outputSize: 0,
          savedSize: 0,
          compressionRatio: 0,
          outputPath: plan.outputPath,
          error: err instanceof Error ? err.message : 'Two-pass compression failed',
          targetSizeMB: plan.targetSizeMB,
          accuracyMode: plan.accuracyMode
        })
      } finally {
        await cleanupPassLogs(passLogPath)
      }
      return
    }

    // Single-pass encoding (existing logic)
    const args = [...plan.ffmpegArgs]
    const outputPath = args[args.length - 1]
    const inputArgs = args.slice(0, -1)
    const fullArgs = [...inputArgs, '-progress', 'pipe:1', '-nostats', outputPath]

    console.log(`[FFmpeg] Started: ${fileName} → ${plan.outputPath}`)
    const child = spawn(ffmpeg, fullArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    currentChild = child

    let stdoutBuffer = ''
    const progressState: Record<string, string> = {}

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx)
        const value = trimmed.slice(eqIdx + 1)
        parseProgressLine(key, value, progressState)

        if (key === 'progress') {
          const outTimeUs = parseOutTimeUs(progressState)
          const durationUs = durationSeconds * 1_000_000
          const rawPercent = durationUs > 0 ? (outTimeUs / durationUs) * 100 : 0
          const percent = Math.min(Math.max(rawPercent, 0), 100)
          const elapsedSeconds = (Date.now() - startTime) / 1000
          const speed = progressState['speed'] || '--'

          let remainingLabel: string
          let remainingSeconds: number
          if (percent < 5) {
            remainingLabel = 'Estimating'
            remainingSeconds = -1
          } else {
            const totalEstimated = (elapsedSeconds / percent) * 100
            const remaining = Math.max(totalEstimated - elapsedSeconds, 0)
            remainingSeconds = Math.round(remaining)
            remainingLabel = formatRemaining(remaining)
          }

          const roundedPercent = Math.round(percent * 10) / 10
          console.log(`[FFmpeg] Progress: ${fileName} ${roundedPercent}% speed=${speed}`)
          onProgress({
            percent: roundedPercent,
            elapsedSeconds: Math.round(elapsedSeconds),
            remainingLabel,
            remainingSeconds,
            speed,
            outTimeUs,
            phase: 'single'
          })

          for (const k of Object.keys(progressState)) {
            delete progressState[k]
          }
        }
      }
    })

    child.stderr?.on('data', () => {})

    child.on('close', async (code, signal) => {
      console.log(`[FFmpeg] Closed: ${fileName} code=${code} signal=${signal}`)
      if (canceled) {
        resolve({
          success: false,
          originalSize: 0,
          outputSize: 0,
          savedSize: 0,
          compressionRatio: 0,
          outputPath: plan.outputPath,
          error: 'Canceled',
          targetSizeMB: plan.targetSizeMB,
          accuracyMode: plan.accuracyMode
        })
        return
      }

      try {
        const [inputStat, outputStat] = await Promise.all([
          stat(plan.inputPath),
          stat(plan.outputPath)
        ])
        console.log(`[FFmpeg] Output: ${plan.outputPath} size=${outputStat.size}`)

        if (code !== 0) {
          console.log(`[FFmpeg] Failed: ${fileName} exit code ${code}`)
          resolve(buildSizeResult(plan, inputStat.size, outputStat.size, false, `FFmpeg exited with code ${code}`))
          return
        }

        console.log(`[FFmpeg] Completed: ${fileName} saved=${inputStat.size - outputStat.size} bytes`)
        resolve(buildSizeResult(plan, inputStat.size, outputStat.size, true))
      } catch (err) {
        resolve({
          success: false,
          originalSize: 0,
          outputSize: 0,
          savedSize: 0,
          compressionRatio: 0,
          outputPath: plan.outputPath,
          error: err instanceof Error ? err.message : 'Failed to stat output file',
          targetSizeMB: plan.targetSizeMB,
          accuracyMode: plan.accuracyMode
        })
      }
    })

    child.on('error', (err) => {
      resolve({
        success: false,
        originalSize: 0,
        outputSize: 0,
        savedSize: 0,
        compressionRatio: 0,
        outputPath: plan.outputPath,
        error: err.message,
        targetSizeMB: plan.targetSizeMB,
        accuracyMode: plan.accuracyMode
      })
    })
    })()
  })

  const cancel = () => {
    canceled = true
    if (currentChild && !currentChild.killed) {
      currentChild.kill('SIGTERM')
    }
  }

  return { promise, cancel }
}
