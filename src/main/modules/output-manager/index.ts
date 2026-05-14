import { join, basename, extname, dirname, resolve } from 'path'
import { access, mkdir, constants } from 'fs/promises'

export interface OutputResult {
  outputPath: string
  outputDir: string
}

export interface DirCheckResult {
  ok: boolean
  error?: string
}

export interface SpaceCheckResult {
  ok: boolean
  availableBytes: number
  requiredBytes: number
  warning?: string
}

export interface OutputPlanResult {
  ok: true
  plan: {
    inputPath: string
    ffmpegOutputPath: string
    finalOutputPath: string
    outputDir: string
    shouldReplaceOriginal: boolean
    shouldOverwriteExisting?: boolean
    isSameAsInput?: boolean
  }
}

export interface OutputPlanConflict {
  ok: false
  conflict: true
  message: string
  conflictType: ConflictType
}

export type OutputPlanOutcome = OutputPlanResult | OutputPlanConflict

export type SaveStrategy =
  | { type: 'replace_original' }
  | { type: 'save_as'; outputDir: string }
  | { type: 'default' }

export type ConflictAction = 'overwrite' | 'rename' | 'skip'

export type ConflictType = 'same_as_input' | 'existing_output_file'

export interface ConflictDetail {
  conflictType: ConflictType
}

function sanitizeBaseName(fileName: string): string {
  const ext = extname(fileName)
  const base = basename(fileName, ext)
  return base.replace(/[<>:"/\\|?*]/g, '_')
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function detectConflict(
  inputPath: string,
  outputPath: string
): Promise<ConflictDetail | null> {
  const absInput = resolve(inputPath)
  const absOutput = resolve(outputPath)

  if (absInput === absOutput) {
    return { conflictType: 'same_as_input' }
  }

  if (await fileExists(absOutput)) {
    return { conflictType: 'existing_output_file' }
  }

  return null
}

export async function generateRenamePath(targetPath: string): Promise<string> {
  const dir = dirname(targetPath)
  const ext = extname(targetPath)
  const base = basename(targetPath, ext)
  let counter = 1
  let candidate = join(dir, `${base}_${counter}${ext}`)
  while (await fileExists(candidate)) {
    counter++
    candidate = join(dir, `${base}_${counter}${ext}`)
  }
  return candidate
}

export async function checkOutputDir(dir: string): Promise<DirCheckResult> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (err) {
    return { ok: false, error: `Cannot create directory: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    await access(dir, constants.W_OK)
    return { ok: true }
  } catch {
    return { ok: false, error: `Directory is not writable: ${dir}` }
  }
}

export async function checkDiskSpace(dir: string, totalInputBytes: number): Promise<SpaceCheckResult> {
  try {
    const { execFile } = await import('child_process')
    const resolvedDir = resolve(dir)
    const drive = resolvedDir.slice(0, 3) // e.g., "C:\"

    return new Promise<SpaceCheckResult>((res) => {
      if (process.platform === 'win32') {
        execFile('wmic', ['logicaldisk', 'where', `DeviceID='${drive.slice(0, 2)}'`, 'get', 'FreeSpace', '/value'], { timeout: 5000, windowsHide: true }, (err: Error | null, stdout: string) => {
          if (err) {
            res({ ok: true, availableBytes: 0, requiredBytes: totalInputBytes })
            return
          }
          const match = stdout.match(/FreeSpace=(\d+)/)
          const available = match ? parseInt(match[1], 10) : 0
          const twentyPercent = totalInputBytes * 0.2
          if (available < twentyPercent) {
            res({
              ok: true,
              availableBytes: available,
              requiredBytes: totalInputBytes,
              warning: `Low disk space: ${formatBytes(available)} available. Recommended: at least ${formatBytes(Math.ceil(twentyPercent))} (20% of input).`
            })
          } else {
            res({ ok: true, availableBytes: available, requiredBytes: totalInputBytes })
          }
        })
      } else {
        execFile('df', ['-k', resolvedDir], { timeout: 5000, windowsHide: true }, (err: Error | null, stdout: string) => {
          if (err) {
            res({ ok: true, availableBytes: 0, requiredBytes: totalInputBytes })
            return
          }
          const lines = stdout.trim().split('\n')
          if (lines.length < 2) {
            res({ ok: true, availableBytes: 0, requiredBytes: totalInputBytes })
            return
          }
          const parts = lines[1].split(/\s+/)
          const availableKB = parseInt(parts[3] || '0', 10)
          const available = availableKB * 1024
          const twentyPercent = totalInputBytes * 0.2
          if (available < twentyPercent) {
            res({
              ok: true,
              availableBytes: available,
              requiredBytes: totalInputBytes,
              warning: `Low disk space: ${formatBytes(available)} available. Recommended: at least ${formatBytes(Math.ceil(twentyPercent))} (20% of input).`
            })
          } else {
            res({ ok: true, availableBytes: available, requiredBytes: totalInputBytes })
          }
        })
      }
    })
  } catch {
    return { ok: true, availableBytes: 0, requiredBytes: totalInputBytes }
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1000))
  return `${(bytes / Math.pow(1000, i)).toFixed(1)} ${units[i]}`
}

export async function buildOutputPath(inputPath: string): Promise<OutputResult> {
  const absInput = resolve(inputPath)
  const dir = dirname(absInput)
  const ext = extname(absInput)
  const base = sanitizeBaseName(basename(absInput, ext))
  const outputDir = join(dir, 'ShrinkFlow_Output')

  let outputPath = join(outputDir, `${base}_compressed.mp4`)
  let counter = 1

  while (await fileExists(outputPath)) {
    outputPath = join(outputDir, `${base}_compressed_${counter}.mp4`)
    counter++
  }

  if (resolve(outputPath) === absInput) {
    outputPath = join(outputDir, `${base}_compressed_${counter}.mp4`)
  }

  return { outputPath, outputDir }
}

export async function generateOutputPath(inputPath: string): Promise<OutputResult> {
  const result = await buildOutputPath(inputPath)
  await mkdir(result.outputDir, { recursive: true })
  return result
}

export async function createOutputPlan(inputPath: string, strategy: SaveStrategy, conflictAction?: ConflictAction): Promise<OutputPlanOutcome> {
  const absInput = resolve(inputPath)
  const dir = dirname(absInput)
  const ext = extname(absInput)
  const base = basename(absInput, ext)
  const sanitizedBase = sanitizeBaseName(base)

  if (strategy.type === 'replace_original') {
    // FFmpeg writes to a temp file next to the original
    const tempOutputPath = join(dir, `.shrinkflow_tmp_${sanitizedBase}.mp4`)
    return {
      ok: true,
      plan: {
        inputPath: absInput,
        ffmpegOutputPath: tempOutputPath,
        finalOutputPath: absInput,
        outputDir: dir,
        shouldReplaceOriginal: true
      }
    }
  }

  if (strategy.type === 'save_as') {
    const outputDir = strategy.outputDir
    await mkdir(outputDir, { recursive: true })
    const outputPath = join(outputDir, `${sanitizedBase}.mp4`)

    const exists = await fileExists(outputPath)

    if (exists && conflictAction === 'overwrite') {
      // Overwrite: use temp file flow to safely replace existing file
      const tempOutputPath = join(outputDir, `.shrinkflow_tmp_${sanitizedBase}.mp4`)
      const isSameAsInput = resolve(outputPath) === absInput
      return {
        ok: true,
        plan: {
          inputPath: absInput,
          ffmpegOutputPath: tempOutputPath,
          finalOutputPath: outputPath,
          outputDir,
          // When same_as_input, reuse the existing replace_original flow in task-queue
          shouldReplaceOriginal: isSameAsInput,
          shouldOverwriteExisting: !isSameAsInput
        }
      }
    }

    if (exists && conflictAction === 'rename') {
      // Rename: find next available name with _N suffix
      const renamedPath = await generateRenamePath(outputPath)
      return {
        ok: true,
        plan: {
          inputPath: absInput,
          ffmpegOutputPath: renamedPath,
          finalOutputPath: renamedPath,
          outputDir,
          shouldReplaceOriginal: false
        }
      }
    }

    if (exists) {
      // No conflict action provided — report conflict
      const isSameAsInput = resolve(outputPath) === absInput
      return {
        ok: false,
        conflict: true,
        message: `Output file already exists: ${outputPath}`,
        conflictType: isSameAsInput ? 'same_as_input' : 'existing_output_file'
      }
    }

    return {
      ok: true,
      plan: {
        inputPath: absInput,
        ffmpegOutputPath: outputPath,
        finalOutputPath: outputPath,
        outputDir,
        shouldReplaceOriginal: false
      }
    }
  }

  // default strategy — compute path only; directory created by checkOutputDir() at compression time
  const { outputPath, outputDir } = await buildOutputPath(inputPath)
  return {
    ok: true,
    plan: {
      inputPath: absInput,
      ffmpegOutputPath: outputPath,
      finalOutputPath: outputPath,
      outputDir,
      shouldReplaceOriginal: false
    }
  }
}
