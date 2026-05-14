import { EventEmitter } from 'events'
import { unlink, rename, stat, copyFile } from 'fs/promises'
import { resolve } from 'path'
import { runCompression, type CompressionProgress, type CompressionResult } from '../ffmpeg-runner'
import type { CompressionPlan } from '../compression-planner'

/**
 * Safely replace a target file with a temp file using a backup-then-swap strategy.
 *
 * Flow:
 * 1. Verify temp file exists and has size > 0
 * 2. If target exists, rename target → backupPath
 * 3. Rename temp → target
 * 4. If step 3 succeeds, delete backupPath (best-effort)
 * 5. If step 3 fails, attempt rollback: rename backupPath → target
 * 6. If rollback also fails, throw with clear error
 *
 * Cross-device rename: falls back to copyFile + unlink with same rollback guarantees.
 */
async function safeReplaceFile(tempPath: string, targetPath: string): Promise<number> {
  // 1. Verify temp file
  const tempStat = await stat(tempPath)
  if (tempStat.size === 0) {
    throw new Error('Compressed file is empty')
  }

  const backupPath = `${targetPath}.shrinkflow_backup_${Date.now()}`
  let backupCreated = false

  try {
    // 2. If target exists, move it to backup
    try {
      const targetStat = await stat(targetPath)
      if (targetStat) {
        await rename(targetPath, backupPath)
        backupCreated = true
      }
    } catch (statErr: unknown) {
      // ENOENT is fine — target doesn't exist yet
      if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`failed to backup original: ${statErr instanceof Error ? statErr.message : String(statErr)}`)
      }
    }

    // 3. Move temp into place
    try {
      await rename(tempPath, targetPath)
    } catch (renameErr: unknown) {
      // Cross-device error: fall back to copyFile + unlink
      if ((renameErr as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(tempPath, targetPath)
        await unlink(tempPath).catch(() => {})
      } else {
        throw renameErr
      }
    }

    // 4. Success — clean up backup (best-effort)
    if (backupCreated) {
      await unlink(backupPath).catch(() => {})
    }

    return tempStat.size
  } catch (moveErr) {
    // 5. Rollback: try to restore backup
    if (backupCreated) {
      try {
        await rename(backupPath, targetPath)
      } catch (rollbackErr) {
        // 6. Rollback failed — report both errors
        throw new Error(
          `failed to move compressed file into place: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}; ` +
          `rollback also failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`
        )
      }
    }

    // If we get here, rollback succeeded — throw original move error
    throw new Error(
      `failed to move compressed file into place: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`
    )
  }
}

export type QueueItemStatus = 'pending' | 'compressing' | 'completed' | 'failed' | 'canceled' | 'skipped'

async function cleanupOutputIfSafe(outputPath: string, inputPath: string): Promise<void> {
  if (resolve(outputPath) === resolve(inputPath)) {
    console.warn('[Queue] Skip cleanup because output path equals input path:', outputPath)
    return
  }
  try {
    await unlink(outputPath)
  } catch {
    // best-effort
  }
}
export type QueueStatus = 'idle' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled'

export interface QueueItem {
  id: string
  plan: CompressionPlan
  duration: number
  status: QueueItemStatus
  result?: CompressionResult
  error?: string
  compressionElapsedSeconds?: number
  inputPath?: string
}

export interface QueueProgress {
  status: QueueStatus
  currentItem: {
    id: string
    fileName: string
    percent: number
    elapsedSeconds: number
    remainingLabel: string
    remainingSeconds: number
    speed: string
    phase?: 'single' | 'two_pass_analyze' | 'two_pass_encode'
  } | null
  overallPercent: number
  totalFiles: number
  completedFiles: number
  failedFiles: number
  canceledFiles: number
  skippedFiles: number
  elapsedSeconds?: number
  estimatedRemainingSeconds?: number
}

export interface QueueResult {
  status: QueueStatus
  totalFiles: number
  completedFiles: number
  failedFiles: number
  canceledFiles: number
  skippedFiles: number
  items: QueueItem[]
  totalElapsedSeconds?: number
}

export interface TaskFinishedResult {
  id: string
  filePath: string
  status: 'completed' | 'failed' | 'canceled' | 'skipped'
  result?: CompressionResult
  error?: string
  compressionElapsedSeconds?: number
}

export interface TaskFinishedEvent {
  status: QueueStatus
  results: TaskFinishedResult[]
}

export class TaskQueue extends EventEmitter {
  private items: QueueItem[] = []
  private status: QueueStatus = 'idle'
  private currentIndex = -1
  private cancelFn: (() => void) | null = null
  private aborted = false
  private startTime = 0
  private lastDisplayedEta: number | undefined = undefined
  private lastDisplayedOverallPercent = 0

  constructor(items: { id: string; plan: CompressionPlan; duration: number }[]) {
    super()
    this.items = items.map((item) => ({
      ...item,
      status: 'pending' as QueueItemStatus
    }))
  }

  getStatus(): QueueStatus {
    return this.status
  }

  async start(): Promise<QueueResult> {
    if (this.status === 'running') {
      throw new Error('Queue is already running')
    }

    this.status = 'running'
    this.aborted = false
    this.startTime = Date.now()
    this.lastDisplayedEta = undefined
    this.lastDisplayedOverallPercent = 0

    for (let i = 0; i < this.items.length; i++) {
      if (this.aborted) {
        // Mark remaining items (including current if still pending) as canceled
        for (let j = i; j < this.items.length; j++) {
          if (this.items[j].status === 'pending' || this.items[j].status === 'compressing') {
            this.items[j].status = 'canceled'
          }
        }
        break
      }

      const item = this.items[i]
      const fileName = item.plan.inputPath.split(/[/\\]/).pop() || item.plan.inputPath
      this.currentIndex = i
      item.status = 'compressing'
      const itemStartTime = Date.now()
      console.log(`[Queue] Compressing: ${fileName} (${i + 1}/${this.items.length})`)

      this.emitProgress()

      try {
        const { promise, cancel } = runCompression(
          item.plan,
          item.duration,
          (progress) => this.handleItemProgress(item, progress)
        )
        this.cancelFn = cancel

        const result = await promise
        this.cancelFn = null

        if (this.aborted || result.error === 'Canceled') {
          item.status = 'canceled'
        } else if (result.success) {
          // ── Output-larger-than-input protection ──
          const inputPath = item.plan.inputPath
          const isReplaceOriginal = item.plan.outputPlan?.shouldReplaceOriginal === true

          // Resolve output path: replace_original must use ffmpegOutputPath (temp file)
          let outputPath: string | undefined
          if (isReplaceOriginal) {
            outputPath = item.plan.outputPlan?.ffmpegOutputPath
            if (!outputPath) {
              item.status = 'failed'
              item.error = 'Missing temporary output file path for replace-original operation.'
              item.result = result
              this.emitItemDone(item)
              continue
            }
          } else {
            outputPath = item.plan.outputPlan?.ffmpegOutputPath ?? result.outputPath
            if (!outputPath) {
              item.status = 'failed'
              item.error = 'Missing output file path after compression.'
              item.result = result
              this.emitItemDone(item)
              continue
            }
          }

          // Guard: outputPath must not be same as inputPath
          if (resolve(outputPath) === resolve(inputPath)) {
            item.status = 'failed'
            item.error = 'Output path resolved to original file path. Original file preserved.'
            item.result = result
            this.emitItemDone(item)
            continue
          }

          // Phase 1: stat output file
          let outputSize: number
          try {
            const outputStat = await stat(outputPath)
            outputSize = outputStat.size
          } catch {
            item.status = 'failed'
            item.error = 'Could not verify output file size. Output file is missing or unreadable.'
            await cleanupOutputIfSafe(outputPath, inputPath)
            item.result = result
            this.emitItemDone(item)
            continue
          }

          if (outputSize <= 0) {
            item.status = 'failed'
            item.error = 'Compressed file is empty or unreadable.'
            await cleanupOutputIfSafe(outputPath, inputPath)
            item.result = result
            this.emitItemDone(item)
            continue
          }

          // Phase 2: stat input file
          let inputSize: number | undefined
          try {
            const inputStat = await stat(inputPath)
            inputSize = inputStat.size
          } catch {
            if (isReplaceOriginal) {
              item.status = 'failed'
              item.error = 'Could not read original file size. Original file preserved.'
              await cleanupOutputIfSafe(outputPath, inputPath)
              item.result = result
              this.emitItemDone(item)
              continue
            }
            console.warn(`[Queue] Could not read original file size for comparison: ${fileName}`)
          }

          // Phase 3: compare sizes (both stats succeeded)
          if (typeof inputSize === 'number' && inputSize > 0) {
            result.originalSize = inputSize
            result.outputSize = outputSize
            result.savedSize = Math.max(0, inputSize - outputSize)
            result.compressionRatio = outputSize / inputSize

            if (outputSize >= inputSize) {
              result.outputLargerThanInput = true
              result.noSaving = true
              result.savedSize = 0
              console.log(`[Queue] Output not smaller: ${fileName} (${inputSize} -> ${outputSize})`)

              if (isReplaceOriginal) {
                await cleanupOutputIfSafe(outputPath, inputPath)
                item.status = 'skipped'
                item.error = 'Output file was not smaller than original. Original file preserved.'
                item.result = result
                this.emitItemDone(item)
                continue
              }
            }
          } else if (typeof inputSize === 'number' && inputSize <= 0) {
            if (isReplaceOriginal) {
              item.status = 'failed'
              item.error = 'Invalid original file size. Original file preserved.'
              await cleanupOutputIfSafe(outputPath, inputPath)
              item.result = result
              this.emitItemDone(item)
              continue
            }
            console.warn(`[Queue] Invalid original file size (${inputSize}): ${fileName}`)
          }

          // Post-processing for replace_original strategy
          if (isReplaceOriginal) {
            try {
              const size = await safeReplaceFile(outputPath, inputPath)
              result.outputPath = inputPath
              result.outputSize = size
              console.log(`[Queue] Replace-original success: ${inputPath}`)
            } catch (replaceErr) {
              item.status = 'failed'
              item.error = `Replace original failed: ${replaceErr instanceof Error ? replaceErr.message : 'Unknown error'}`
              item.result = result
              console.error(`[Queue] Replace-original failed for ${fileName}:`, replaceErr)
              this.emitItemDone(item)
              continue
            }
          }
          // Post-processing for overwrite-existing (conflict resolution)
          if (item.plan.outputPlan?.shouldOverwriteExisting) {
            const tempPath = item.plan.outputPlan.ffmpegOutputPath
            const targetPath = item.plan.outputPlan.finalOutputPath
            try {
              const size = await safeReplaceFile(tempPath, targetPath)
              result.outputPath = targetPath
              result.outputSize = size
              console.log(`[Queue] Overwrite-existing success: ${targetPath}`)
            } catch (overwriteErr) {
              item.status = 'failed'
              item.error = `Overwrite failed: ${overwriteErr instanceof Error ? overwriteErr.message : 'Unknown error'}`
              item.result = result
              console.error(`[Queue] Overwrite-existing failed for ${fileName}:`, overwriteErr)
              this.emitItemDone(item)
              continue
            }
          }
          item.status = 'completed'
          item.result = result
        } else {
          item.status = 'failed'
          item.error = result.error
          item.result = result
        }
      } catch (err) {
        item.status = this.aborted ? 'canceled' : 'failed'
        if (!this.aborted) {
          item.error = err instanceof Error ? err.message : 'Unknown error'
        }
        this.cancelFn = null
      }

      // Record per-item elapsed time
      item.compressionElapsedSeconds = Math.max(1, Math.round((Date.now() - itemStartTime) / 1000))

      console.log(`[Queue] Item done: ${fileName} status=${item.status}`)
      this.emitItemDone(item)
      this.emitProgressAfterItemDone()
    }

    // Determine final status
    const completed = this.items.filter((it) => it.status === 'completed').length
    const failed = this.items.filter((it) => it.status === 'failed').length
    const canceled = this.items.filter((it) => it.status === 'canceled').length
    const skipped = this.items.filter((it) => it.status === 'skipped').length

    if (this.aborted) {
      // User-initiated cancel always results in canceled status
      this.status = 'canceled'
    } else if (completed === this.items.length) {
      this.status = 'completed'
    } else if (failed === this.items.length) {
      this.status = 'failed'
    } else if (completed > 0 || failed > 0) {
      // Mix of completed/failed (and possibly canceled)
      this.status = 'partial_failed'
    } else {
      // All canceled (shouldn't reach here without aborted, but safety)
      this.status = 'canceled'
    }

    const result: QueueResult = {
      status: this.status,
      totalFiles: this.items.length,
      completedFiles: completed,
      failedFiles: failed,
      canceledFiles: canceled,
      skippedFiles: skipped,
      items: this.items.map((it) => ({ ...it, inputPath: it.plan.inputPath })),
      totalElapsedSeconds: Math.max(1, Math.round((Date.now() - this.startTime) / 1000))
    }

    // Emit final progress with monotonic protection
    // completed/partial_failed/failed → 100%; canceled → monotonic (no regression)
    const finalElapsed = Math.floor((Date.now() - this.startTime) / 1000)
    const isTerminal = this.status === 'completed' || this.status === 'partial_failed' || this.status === 'failed'
    const finalPercent = isTerminal ? this.monotonicPercent(100) : this.monotonicPercent((completed + failed + canceled + skipped) / this.items.length * 100)
    const finalProgress: QueueProgress = {
      status: this.status,
      currentItem: null,
      overallPercent: finalPercent,
      totalFiles: this.items.length,
      completedFiles: completed,
      failedFiles: failed,
      canceledFiles: canceled,
      skippedFiles: skipped,
      elapsedSeconds: finalElapsed,
      estimatedRemainingSeconds: isTerminal ? this.smoothEta(0) : this.smoothEta(undefined)
    }
    this.emit('progress', finalProgress)

    console.log(`[Queue] Finished: status=${this.status} overall=${finalPercent}% completed=${completed} failed=${failed} canceled=${canceled} skipped=${skipped}`)

    // Emit task-finished with per-item final results for reconciliation
    const taskFinishedEvent: TaskFinishedEvent = {
      status: this.status,
      results: this.items.map((it) => ({
        id: it.id,
        filePath: it.plan.inputPath,
        status: it.status === 'completed' ? 'completed' as const :
                it.status === 'failed' ? 'failed' as const :
                it.status === 'skipped' ? 'skipped' as const : 'canceled' as const,
        result: it.result,
        error: it.error,
        compressionElapsedSeconds: it.compressionElapsedSeconds
      }))
    }
    console.log(`[Queue] Emitting task-finished: ${taskFinishedEvent.results.length} results`)
    this.emit('task-finished', taskFinishedEvent)

    this.emit('queue-done', result)
    return result
  }

  cancel(): void {
    this.aborted = true
    if (this.cancelFn) {
      this.cancelFn()
      this.cancelFn = null
    }
  }

  private monotonicPercent(rawPercent: number): number {
    const clamped = Math.min(Math.max(rawPercent, 0), 100)
    const displayed = Math.max(this.lastDisplayedOverallPercent, clamped)
    this.lastDisplayedOverallPercent = displayed
    return Math.round(displayed * 10) / 10
  }

  private smoothEta(rawEta: number | undefined): number | undefined {
    // Terminal states: don't update ETA
    if (this.status === 'failed' || this.status === 'canceled') {
      return this.lastDisplayedEta
    }
    // Completed: always return 0
    if (this.status === 'completed') {
      this.lastDisplayedEta = 0
      return 0
    }
    // Invalid raw ETA (percent too low or bad data)
    if (rawEta === undefined || !isFinite(rawEta) || rawEta < 0) {
      return undefined
    }
    // No previous ETA: use raw
    if (this.lastDisplayedEta === undefined) {
      this.lastDisplayedEta = rawEta
      return rawEta
    }
    // Allow fast drop
    if (rawEta < this.lastDisplayedEta) {
      this.lastDisplayedEta = rawEta
      return rawEta
    }
    // Cap upward jumps
    const maxAllowed = Math.max(this.lastDisplayedEta + 15, Math.round(this.lastDisplayedEta * 1.15))
    const capped = Math.min(rawEta, maxAllowed)
    this.lastDisplayedEta = capped
    return capped
  }

  private handleItemProgress(item: QueueItem, progress: CompressionProgress): void {
    // Reject stale progress from items that are no longer active
    if (item.status !== 'compressing') return

    const completedCount = this.items.filter((it) => it.status === 'completed').length
    const failedCount = this.items.filter((it) => it.status === 'failed').length
    const canceledCount = this.items.filter((it) => it.status === 'canceled').length
    const skippedCount = this.items.filter((it) => it.status === 'skipped').length
    const processedCount = completedCount + failedCount + canceledCount + skippedCount
    const rawOverallPercent = (processedCount + progress.percent / 100) / this.items.length * 100
    const overallPercent = this.monotonicPercent(rawOverallPercent)
    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000)
    const rawEta = overallPercent >= 5
      ? Math.round(elapsedSeconds * (100 - overallPercent) / overallPercent)
      : undefined
    const estimatedRemainingSeconds = this.smoothEta(rawEta)

    const fileName = item.plan.inputPath.split(/[/\\]/).pop() || item.plan.inputPath
    console.log(`[Queue Progress] overall=${overallPercent.toFixed(1)}% completed=${completedCount} failed=${failedCount} canceled=${canceledCount} skipped=${skippedCount} current=${fileName} ${progress.percent.toFixed(1)}%`)

    const queueProgress: QueueProgress = {
      status: this.status,
      currentItem: {
        id: item.id,
        fileName,
        percent: progress.percent,
        elapsedSeconds: progress.elapsedSeconds,
        remainingLabel: progress.remainingLabel,
        remainingSeconds: progress.remainingSeconds,
        speed: progress.speed,
        phase: progress.phase
      },
      overallPercent,
      totalFiles: this.items.length,
      completedFiles: completedCount,
      failedFiles: failedCount,
      canceledFiles: canceledCount,
      skippedFiles: skippedCount,
      elapsedSeconds,
      estimatedRemainingSeconds
    }

    this.emit('progress', queueProgress)
  }

  private emitProgress(): void {
    const completedCount = this.items.filter((it) => it.status === 'completed').length
    const failedCount = this.items.filter((it) => it.status === 'failed').length
    const canceledCount = this.items.filter((it) => it.status === 'canceled').length
    const skippedCount = this.items.filter((it) => it.status === 'skipped').length
    const processedCount = completedCount + failedCount + canceledCount + skippedCount
    const current = this.items[this.currentIndex]
    const rawOverallPercent = processedCount / this.items.length * 100
    const overallPercent = this.monotonicPercent(rawOverallPercent)
    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000)
    const rawEta = overallPercent >= 5
      ? Math.round(elapsedSeconds * (100 - overallPercent) / overallPercent)
      : undefined
    const estimatedRemainingSeconds = this.smoothEta(rawEta)

    const queueProgress: QueueProgress = {
      status: this.status,
      currentItem: current
        ? {
            id: current.id,
            fileName: current.plan.inputPath.split(/[/\\]/).pop() || current.plan.inputPath,
            percent: 0,
            elapsedSeconds: 0,
            remainingLabel: 'Estimating',
            remainingSeconds: -1,
            speed: '--'
          }
        : null,
      overallPercent,
      totalFiles: this.items.length,
      completedFiles: completedCount,
      failedFiles: failedCount,
      canceledFiles: canceledCount,
      skippedFiles: skippedCount,
      elapsedSeconds,
      estimatedRemainingSeconds
    }

    this.emit('progress', queueProgress)
  }

  private emitItemDone(item: QueueItem): void {
    this.emit('item-done', {
      id: item.id,
      status: item.status,
      result: item.result,
      error: item.error,
      compressionElapsedSeconds: item.compressionElapsedSeconds
    })
  }

  private emitProgressAfterItemDone(): void {
    const completedCount = this.items.filter((it) => it.status === 'completed').length
    const failedCount = this.items.filter((it) => it.status === 'failed').length
    const canceledCount = this.items.filter((it) => it.status === 'canceled').length
    const skippedCount = this.items.filter((it) => it.status === 'skipped').length
    const processedCount = completedCount + failedCount + canceledCount + skippedCount
    const rawOverallPercent = (processedCount / this.items.length) * 100
    const overallPercent = this.monotonicPercent(rawOverallPercent)
    const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000)
    const rawEta = overallPercent >= 5
      ? Math.round(elapsedSeconds * (100 - overallPercent) / overallPercent)
      : undefined
    const estimatedRemainingSeconds = this.smoothEta(rawEta)

    console.log(`[Queue Progress] overall=${overallPercent.toFixed(1)}% completed=${completedCount} failed=${failedCount} canceled=${canceledCount} skipped=${skippedCount}`)

    const queueProgress: QueueProgress = {
      status: this.status,
      currentItem: null,
      overallPercent,
      totalFiles: this.items.length,
      completedFiles: completedCount,
      failedFiles: failedCount,
      canceledFiles: canceledCount,
      skippedFiles: skippedCount,
      elapsedSeconds,
      estimatedRemainingSeconds
    }

    this.emit('progress', queueProgress)
  }
}
