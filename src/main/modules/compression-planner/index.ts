import { generateOutputPath, createOutputPlan, type SaveStrategy, type ConflictAction, type OutputPlanConflict } from '../output-manager'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { join } from 'path'

export type CompressionMode = 'balanced' | 'quality_first' | 'smallest_size' | 'target_size_fast' | 'target_size_accurate' | 'compatible_high_quality' | 'heavy_balanced'

export interface CompressionInput {
  filePath: string
  duration: number
  width: number
  height: number
  videoCodec: string
  bitrate: number
  frameRate: number
}

export interface CompressionPlan {
  inputPath: string
  outputPath: string
  outputDir: string
  mode: CompressionMode
  ffmpegArgs: string[]
  warnings: string[]
  estimatedSizeMB?: number
  targetSizeMB?: number
  accuracyMode?: 'fast' | 'accurate'
  twoPass?: {
    pass1Args: string[]
    pass2Args: string[]
    passLogPath: string
  }
  outputPlan?: {
    inputPath: string
    ffmpegOutputPath: string
    finalOutputPath: string
    outputDir: string
    shouldReplaceOriginal: boolean
    shouldOverwriteExisting?: boolean
  }
}

export type PlanResult =
  | { ok: true; plan: CompressionPlan }
  | { ok: false; reason: string }
  | { ok: false; conflict: true; message: string; conflictType: string }

// ShrinkFlow treats target size MB as MiB (1024 * 1024 bytes), matching file size display
const BYTES_PER_MB = 1024 * 1024

function validateInput(input: CompressionInput): string | null {
  if (!input.filePath) return 'Input file path is required'
  if (!input.duration || input.duration <= 0) return 'Missing or invalid duration'
  if (!input.width || input.width <= 0 || !input.height || input.height <= 0) return 'Missing or invalid resolution'
  if (!input.videoCodec) return 'Missing video codec'
  return null
}

function buildBaseArgs(inputPath: string): string[] {
  return ['-y', '-i', inputPath, '-c:v', 'libx264', '-c:a', 'aac']
}

function buildScaleArgs(height: number): string[] {
  if (height > 720) {
    return ['-vf', 'scale=-2:720']
  }
  return []
}

async function buildBalanced(input: CompressionInput): Promise<CompressionPlan> {
  const { outputPath, outputDir } = await generateOutputPath(input.filePath)
  const args = [
    ...buildBaseArgs(input.filePath),
    '-preset', 'medium',
    '-crf', '24',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  ]
  return {
    inputPath: input.filePath,
    outputPath,
    outputDir,
    mode: 'balanced',
    ffmpegArgs: args,
    warnings: []
  }
}

async function buildQualityFirst(input: CompressionInput): Promise<CompressionPlan> {
  const { outputPath, outputDir } = await generateOutputPath(input.filePath)
  const args = [
    ...buildBaseArgs(input.filePath),
    '-preset', 'slow',
    '-crf', '20',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath
  ]
  return {
    inputPath: input.filePath,
    outputPath,
    outputDir,
    mode: 'quality_first',
    ffmpegArgs: args,
    warnings: []
  }
}

async function buildSmallestSize(input: CompressionInput): Promise<CompressionPlan> {
  const { outputPath, outputDir } = await generateOutputPath(input.filePath)
  const args = [
    ...buildBaseArgs(input.filePath),
    '-preset', 'medium',
    '-crf', '30',
    '-b:a', '96k',
    ...buildScaleArgs(input.height),
    '-movflags', '+faststart',
    outputPath
  ]
  const warnings: string[] = []
  if (input.height > 720) {
    warnings.push('Resolution will be scaled down to 720p')
  }
  return {
    inputPath: input.filePath,
    outputPath,
    outputDir,
    mode: 'smallest_size',
    ffmpegArgs: args,
    warnings
  }
}

async function buildTargetSizeFast(
  input: CompressionInput,
  targetSizeMB: number
): Promise<CompressionPlan> {
  const { outputPath, outputDir } = await generateOutputPath(input.filePath)
  const warnings: string[] = []

  const targetSizeBits = targetSizeMB * 8 * BYTES_PER_MB
  const audioBitrate = 128000 // 128 kbps
  const audioSizeBits = audioBitrate * input.duration
  const videoSizeBits = targetSizeBits - audioSizeBits

  if (videoSizeBits <= 0) {
    throw new Error('Target size is too small — not enough space for audio')
  }

  const videoBitrate = Math.floor(videoSizeBits / input.duration)

  if (videoBitrate < 100000) {
    throw new Error(
      `Target size ${targetSizeMB}MB is too small for a ${Math.round(input.duration)}s video. ` +
      `Calculated video bitrate would be ${Math.round(videoBitrate / 1000)} kbps, which is unreasonably low.`
    )
  }

  if (videoBitrate < 500000) {
    warnings.push(
      `Target size ${targetSizeMB}MB results in a low video bitrate of ${Math.round(videoBitrate / 1000)} kbps. ` +
      `Quality may be significantly degraded.`
    )
  }

  const estimatedSizeMB = Math.round((videoBitrate * input.duration + audioSizeBits) / (8 * BYTES_PER_MB))

  const args = [
    '-y', '-i', input.filePath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-b:v', `${videoBitrate}`,
    '-maxrate', `${Math.floor(videoBitrate * 1.5)}`,
    '-bufsize', `${videoBitrate * 2}`,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  ]

  return {
    inputPath: input.filePath,
    outputPath,
    outputDir,
    mode: 'target_size_fast',
    ffmpegArgs: args,
    warnings,
    estimatedSizeMB,
    targetSizeMB,
    accuracyMode: 'fast'
  }
}

async function buildTargetSizeAccurate(
  input: CompressionInput,
  targetSizeMB: number
): Promise<CompressionPlan> {
  const { outputPath, outputDir } = await generateOutputPath(input.filePath)
  const warnings: string[] = []

  // Bitrate calculation with container overhead reservation
  const targetSizeBits = targetSizeMB * BYTES_PER_MB * 8
  const targetTotalBitrate = targetSizeBits / input.duration
  const containerOverheadRatio = 0.95
  const audioBitrate = 128000
  const videoBitrate = Math.floor(targetTotalBitrate * containerOverheadRatio - audioBitrate)

  if (videoBitrate <= 0) {
    throw new Error('Target size is too small — not enough space for audio')
  }

  if (videoBitrate < 100000) {
    throw new Error(
      `Target size ${targetSizeMB}MB is too small for a ${Math.round(input.duration)}s video. ` +
      `Calculated video bitrate would be ${Math.round(videoBitrate / 1000)} kbps, which is unreasonably low.`
    )
  }

  if (videoBitrate < 500000) {
    warnings.push(
      `Target size ${targetSizeMB}MB results in a low video bitrate of ${Math.round(videoBitrate / 1000)} kbps. ` +
      `Quality may be significantly degraded.`
    )
  }

  const estimatedSizeMB = Math.round((videoBitrate * input.duration + audioBitrate * input.duration) / (8 * BYTES_PER_MB))

  // Pass log in system temp directory
  const logDir = join(tmpdir(), 'shrinkflow-two-pass', randomUUID())
  await mkdir(logDir, { recursive: true })
  const passLogPath = join(logDir, 'ffmpeg2pass')
  console.log(`[two-pass] pass log dir: ${logDir}`)

  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const bitrateStr = `${videoBitrate}`
  const maxrateStr = `${Math.floor(videoBitrate * 1.5)}`
  const bufsizeStr = `${videoBitrate * 2}`

  // Pass 1: analysis (no audio, output to null)
  const pass1Args = [
    '-y', '-i', input.filePath,
    '-c:v', 'libx264', '-preset', 'medium',
    '-b:v', bitrateStr, '-maxrate', maxrateStr, '-bufsize', bufsizeStr,
    '-pass', '1', '-passlogfile', passLogPath,
    '-an', '-f', 'null',
    '-progress', 'pipe:1', '-nostats',
    nullDevice
  ]

  // Pass 2: encoding with audio
  const pass2Args = [
    '-y', '-i', input.filePath,
    '-c:v', 'libx264', '-preset', 'medium',
    '-b:v', bitrateStr, '-maxrate', maxrateStr, '-bufsize', bufsizeStr,
    '-pass', '2', '-passlogfile', passLogPath,
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    outputPath
  ]

  return {
    inputPath: input.filePath,
    outputPath,
    outputDir,
    mode: 'target_size_accurate',
    ffmpegArgs: pass2Args,
    warnings,
    estimatedSizeMB,
    targetSizeMB,
    accuracyMode: 'accurate',
    twoPass: { pass1Args, pass2Args, passLogPath }
  }
}

async function buildCompatibleHighQuality(
  input: CompressionInput,
  saveStrategy: SaveStrategy,
  conflictAction?: ConflictAction
): Promise<CompressionPlan | OutputPlanConflict> {
  const outcome = await createOutputPlan(input.filePath, saveStrategy, conflictAction)
  if (!outcome.ok) {
    return outcome
  }
  const op = outcome.plan

  const args = [
    '-y', '-i', input.filePath,
    '-c:v', 'libx264',
    '-crf', '21',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    op.ffmpegOutputPath
  ]

  return {
    inputPath: input.filePath,
    outputPath: op.finalOutputPath,
    outputDir: op.outputDir,
    mode: 'compatible_high_quality',
    ffmpegArgs: args,
    warnings: [],
    outputPlan: op
  }
}

async function buildHeavyBalanced(
  input: CompressionInput,
  saveStrategy: SaveStrategy,
  conflictAction?: ConflictAction
): Promise<CompressionPlan | OutputPlanConflict> {
  const outcome = await createOutputPlan(input.filePath, saveStrategy, conflictAction)
  if (!outcome.ok) {
    return outcome
  }
  const op = outcome.plan

  const args = [
    '-y', '-i', input.filePath,
    '-c:v', 'libx264',
    '-crf', '25',
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    op.ffmpegOutputPath
  ]

  return {
    inputPath: input.filePath,
    outputPath: op.finalOutputPath,
    outputDir: op.outputDir,
    mode: 'heavy_balanced',
    ffmpegArgs: args,
    warnings: [],
    outputPlan: op
  }
}

export async function generatePlan(
  input: CompressionInput,
  mode: CompressionMode,
  targetSizeMB?: number,
  saveStrategy?: SaveStrategy,
  conflictAction?: ConflictAction
): Promise<PlanResult> {
  const validationError = validateInput(input)
  if (validationError) {
    return { ok: false, reason: validationError }
  }

  try {
    let plan: CompressionPlan
    switch (mode) {
      case 'balanced':
        plan = await buildBalanced(input)
        break
      case 'quality_first':
        plan = await buildQualityFirst(input)
        break
      case 'smallest_size':
        plan = await buildSmallestSize(input)
        break
      case 'target_size_fast':
        if (!targetSizeMB || targetSizeMB <= 0) {
          return { ok: false, reason: 'Target size is required for target_size_fast mode' }
        }
        plan = await buildTargetSizeFast(input, targetSizeMB)
        break
      case 'target_size_accurate':
        if (!targetSizeMB || targetSizeMB <= 0) {
          return { ok: false, reason: 'Target size is required for target_size_accurate mode' }
        }
        plan = await buildTargetSizeAccurate(input, targetSizeMB)
        break
      case 'compatible_high_quality': {
        const outcome = await buildCompatibleHighQuality(input, saveStrategy || { type: 'default' }, conflictAction)
        if ('conflict' in outcome) {
          return { ok: false, conflict: true, message: outcome.message, conflictType: outcome.conflictType }
        }
        plan = outcome
        break
      }
      case 'heavy_balanced': {
        const outcome = await buildHeavyBalanced(input, saveStrategy || { type: 'default' }, conflictAction)
        if ('conflict' in outcome) {
          return { ok: false, conflict: true, message: outcome.message, conflictType: outcome.conflictType }
        }
        plan = outcome
        break
      }
      default:
        return { ok: false, reason: `Unknown compression mode: ${mode}` }
    }
    return { ok: true, plan }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unknown planning error' }
  }
}
