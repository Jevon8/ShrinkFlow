import { readdir, stat, lstat, realpath } from 'fs/promises'
import { extname, join, basename } from 'path'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v'])
const DEBUG_SCAN_VERBOSE = false

// Directories to skip during recursive scan (case-insensitive)
const SKIP_DIRECTORY_NAMES = new Set([
  'shrinkflow_output',
  '.shrinkflow',
  '.shrinkflow_tmp',
  'node_modules',
  'dist',
  'release',
  'out'
])

// Progress throttling constants
const PROGRESS_THROTTLE_MS = 300
const PROGRESS_THROTTLE_FILES = 100

export interface ScannedVideo {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  extension: string
  status: 'scanned'
}

export interface SkippedFile {
  path: string
  reason: 'unsupported_format' | 'permission_denied' | 'duplicate' | 'unknown_error' | 'symbolic_link_skipped' | 'output_directory_skipped'
}

export interface ScanProgressEvent {
  status: 'scanning' | 'completed' | 'failed' | 'canceled'
  currentPath?: string
  scannedFolders: number
  scannedFiles: number
  foundVideos: number
  skippedFiles: number
  skippedFolders: number
}

export interface ScanResult {
  videos: ScannedVideo[]
  skipped: SkippedFile[]
  scannedFolders: number
  skippedFolders: number
  scannedFiles: number
}

export class ScanCanceledError extends Error {
  constructor() {
    super('Scan canceled')
    this.name = 'ScanCanceledError'
  }
}

export interface ScanOptions {
  recursive?: boolean
  onProgress?: (event: ScanProgressEvent) => void
  signal?: AbortSignal
}

let nextId = 1

function generateId(): string {
  return `v_${Date.now()}_${nextId++}`
}

async function scanFile(filePath: string): Promise<{ video?: ScannedVideo; skipped?: SkippedFile }> {
  const ext = extname(filePath).toLowerCase()

  if (!VIDEO_EXTENSIONS.has(ext)) {
    return { skipped: { path: filePath, reason: 'unsupported_format' } }
  }

  try {
    const info = await stat(filePath)
    if (!info.isFile()) {
      return { skipped: { path: filePath, reason: 'unsupported_format' } }
    }

    return {
      video: {
        id: generateId(),
        fileName: basename(filePath),
        filePath,
        fileSize: info.size,
        extension: ext,
        status: 'scanned'
      }
    }
  } catch {
    return { skipped: { path: filePath, reason: 'permission_denied' } }
  }
}

interface ScanContext {
  seenPaths: Set<string>
  videos: ScannedVideo[]
  skipped: SkippedFile[]
  scannedFolders: number
  skippedFolders: number
  scannedFiles: number
  onProgress?: (event: ScanProgressEvent) => void
  signal?: AbortSignal
  visitedRealpaths: Set<string>
  rootPath: string
  lastProgressTime: number
  lastProgressFiles: number
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ScanCanceledError()
  }
}

function emitProgress(ctx: ScanContext, currentPath?: string): void {
  if (!ctx.onProgress) return
  const now = Date.now()
  const filesSinceLast = ctx.scannedFiles - ctx.lastProgressFiles
  if (now - ctx.lastProgressTime < PROGRESS_THROTTLE_MS && filesSinceLast < PROGRESS_THROTTLE_FILES) {
    return
  }
  ctx.lastProgressTime = now
  ctx.lastProgressFiles = ctx.scannedFiles
  ctx.onProgress({
    status: 'scanning',
    currentPath,
    scannedFolders: ctx.scannedFolders,
    scannedFiles: ctx.scannedFiles,
    foundVideos: ctx.videos.length,
    skippedFiles: ctx.skipped.length,
    skippedFolders: ctx.skippedFolders
  })
}

async function scanDirectoryRecursive(dirPath: string, context: ScanContext): Promise<void> {
  checkAborted(context.signal)

  // Resolve realpath to detect symlink cycles
  try {
    const real = await realpath(dirPath)
    if (context.visitedRealpaths.has(real)) {
      return
    }
    context.visitedRealpaths.add(real)
  } catch {
    // If realpath fails, continue with the original path
  }

  context.scannedFolders++

  if (DEBUG_SCAN_VERBOSE) {
    console.log(`[file-scanner] scanning directory #${context.scannedFolders}: ${dirPath}`)
  }

  // Use plain readdir (returns string[]) — no Dirent ambiguity
  let names: string[]
  try {
    names = await readdir(dirPath)
  } catch (err) {
    if (DEBUG_SCAN_VERBOSE) {
      console.log(`[file-scanner] cannot read directory: ${dirPath}`, err)
    }
    context.skippedFolders++
    context.skipped.push({ path: dirPath, reason: 'permission_denied' })
    return
  }

  if (DEBUG_SCAN_VERBOSE) {
    console.log(`[file-scanner] ${dirPath} contains ${names.length} entries`)
  }

  for (const name of names) {
    checkAborted(context.signal)
    const fullPath = join(dirPath, name)

    // Use lstat to determine entry type — works reliably on all platforms
    let st
    try {
      st = await lstat(fullPath)
    } catch (err) {
      if (DEBUG_SCAN_VERBOSE) {
        console.log(`[file-scanner] lstat failed: ${fullPath}`, err)
      }
      context.skipped.push({ path: fullPath, reason: 'permission_denied' })
      continue
    }

    if (st.isSymbolicLink()) {
      context.skipped.push({ path: fullPath, reason: 'symbolic_link_skipped' })
      continue
    }

    if (st.isDirectory()) {
      // Skip known output/tool directories
      const dirBase = basename(fullPath).toLowerCase()
      if (SKIP_DIRECTORY_NAMES.has(dirBase)) {
        console.log(`[file-scanner] skipped output directory: ${fullPath}`)
        context.skippedFolders++
        context.skipped.push({ path: fullPath, reason: 'output_directory_skipped' })
        continue
      }
      await scanDirectoryRecursive(fullPath, context)
      continue
    }

    if (st.isFile()) {
      context.scannedFiles++

      if (context.seenPaths.has(fullPath)) {
        context.skipped.push({ path: fullPath, reason: 'duplicate' })
        continue
      }
      context.seenPaths.add(fullPath)

      const result = await scanFile(fullPath)
      if (result.video) {
        context.videos.push(result.video)
      }
      if (result.skipped) {
        context.skipped.push(result.skipped)
      }

      emitProgress(context, fullPath)

      // Log summary every 500 files
      if (DEBUG_SCAN_VERBOSE && context.scannedFiles % 500 === 0) {
        console.log(`[file-scanner] progress: ${context.scannedFiles} files, ${context.videos.length} videos, ${context.scannedFolders} folders`)
      }
      continue
    }

    // Not a file, directory, or symlink — skip
    if (DEBUG_SCAN_VERBOSE) {
      console.log(`[file-scanner] unknown entry: ${fullPath} (mode=${st.mode})`)
    }
  }
}

export async function scanPaths(paths: string[], options?: ScanOptions): Promise<ScanResult> {
  const recursive = options?.recursive ?? false
  const onProgress = options?.onProgress
  const signal = options?.signal

  if (DEBUG_SCAN_VERBOSE) {
    console.log(`[file-scanner] scanPaths called: paths=${JSON.stringify(paths)}, recursive=${recursive}`)
  }

  const allVideos: ScannedVideo[] = []
  const allSkipped: SkippedFile[] = []
  const seenPaths = new Set<string>()
  let scannedFolders = 0
  let skippedFolders = 0
  let scannedFiles = 0

  try {
    for (const inputPath of paths) {
      checkAborted(signal)
      try {
        const info = await stat(inputPath)

        if (info.isDirectory()) {
          if (recursive) {
            if (DEBUG_SCAN_VERBOSE) {
              console.log(`[file-scanner] RECURSIVE mode for: ${inputPath}`)
            }
            const context: ScanContext = {
              seenPaths,
              videos: allVideos,
              skipped: allSkipped,
              scannedFolders,
              skippedFolders,
              scannedFiles,
              onProgress,
              signal,
              visitedRealpaths: new Set<string>(),
              rootPath: inputPath,
              lastProgressTime: 0,
              lastProgressFiles: 0
            }
            await scanDirectoryRecursive(inputPath, context)
            scannedFolders = context.scannedFolders
            skippedFolders = context.skippedFolders
            scannedFiles = context.scannedFiles
          } else {
            if (DEBUG_SCAN_VERBOSE) {
              console.log(`[file-scanner] NON-RECURSIVE mode for: ${inputPath}`)
            }
            scannedFolders++
            const names = await readdir(inputPath)
            for (const name of names) {
              checkAborted(signal)
              const fullPath = join(inputPath, name)
              try {
                const st = await lstat(fullPath)
                if (!st.isFile()) continue
              } catch {
                continue
              }
              scannedFiles++
              if (seenPaths.has(fullPath)) {
                allSkipped.push({ path: fullPath, reason: 'duplicate' })
                continue
              }
              seenPaths.add(fullPath)
              const result = await scanFile(fullPath)
              if (result.video) allVideos.push(result.video)
              if (result.skipped) allSkipped.push(result.skipped)
            }
          }
        } else if (info.isFile()) {
          scannedFiles++
          if (seenPaths.has(inputPath)) {
            allSkipped.push({ path: inputPath, reason: 'duplicate' })
            continue
          }
          seenPaths.add(inputPath)
          const result = await scanFile(inputPath)
          if (result.video) allVideos.push(result.video)
          if (result.skipped) allSkipped.push(result.skipped)
        }
      } catch {
        allSkipped.push({ path: inputPath, reason: 'permission_denied' })
      }
    }
  } catch (err) {
    if (err instanceof ScanCanceledError) {
      console.log(`[file-scanner] SCAN CANCELED: videos=${allVideos.length}, folders=${scannedFolders}, files=${scannedFiles}`)
      if (onProgress) {
        onProgress({
          status: 'canceled',
          scannedFolders,
          scannedFiles,
          foundVideos: allVideos.length,
          skippedFiles: allSkipped.length,
          skippedFolders
        })
      }
      throw err
    }
    throw err
  }

  console.log(`[file-scanner] SCAN COMPLETED: videos=${allVideos.length}, folders=${scannedFolders}, files=${scannedFiles}, skipped=${allSkipped.length}`)

  if (onProgress) {
    onProgress({
      status: 'completed',
      scannedFolders,
      scannedFiles,
      foundVideos: allVideos.length,
      skippedFiles: allSkipped.length,
      skippedFolders
    })
  }

  return { videos: allVideos, skipped: allSkipped, scannedFolders, skippedFolders, scannedFiles }
}
