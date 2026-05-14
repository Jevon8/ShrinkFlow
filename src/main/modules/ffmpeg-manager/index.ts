import { join, resolve, sep, basename, dirname } from 'path'
import { execFile } from 'child_process'
import { existsSync, createWriteStream, createReadStream, mkdirSync, readdirSync, statSync, renameSync, rmSync, unlinkSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { app, shell, net } from 'electron'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import extractZip from 'extract-zip'

// ─── Types ───────────────────────────────────────────────────────────────────

export type FFmpegSource = 'bundled' | 'updated' | 'system' | 'none'

export interface FFmpegUpdateMetadata {
  provider: string
  version?: string
  assetName?: string
  assetId?: string
  downloadUrl?: string
  downloadedAt: string
  ffmpegVersion?: string
  ffprobeVersion?: string
}

export interface FFmpegInfo {
  ffmpegPath: string
  ffprobePath: string
  source: FFmpegSource
  ffmpegVersion?: string
  ffprobeVersion?: string
  isAvailable: boolean
  errorMessage?: string
  updateMetadata?: FFmpegUpdateMetadata
}

export interface FFmpegUpdateProgress {
  status: 'idle' | 'checking' | 'downloading' | 'extracting' | 'verifying' | 'completed' | 'failed'
  percent?: number
  message?: string
  errorMessage?: string
}

export type FFmpegUpdateResult =
  | { ok: true; info: FFmpegInfo; alreadyUpToDate?: boolean }
  | { ok: false; errorMessage: string; progress?: FFmpegUpdateProgress }

export type FFmpegRemoveResult =
  | { ok: true; info: FFmpegInfo }
  | { ok: false; errorMessage: string }

export type FFmpegOpenFolderResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

export interface FFmpegUpdateCheckLatest {
  provider: string
  version?: string
  assetName?: string
  assetId?: string
  downloadUrl?: string
}

export type FFmpegUpdateCheckResult =
  | { ok: true; currentInfo: FFmpegInfo; isLatest: true; latest?: FFmpegUpdateCheckLatest }
  | { ok: true; currentInfo: FFmpegInfo; isLatest: false; latest: FFmpegUpdateCheckLatest; reason?: string }
  | { ok: false; currentInfo?: FFmpegInfo; errorMessage: string }

// Legacy compatibility types (matching ffmpeg-path.ts exports)
export interface BinaryCheckResult {
  available: boolean
  path: string
  version?: string
  error?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FFMPEG_UPDATE_MANIFEST_URL = process.env.FFMPEG_UPDATE_MANIFEST_URL || ''

const FFMPEG_UPDATE_PROVIDER = {
  name: 'BtbN FFmpeg Builds',
  apiUrl: 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest'
}

// ─── Internal State ──────────────────────────────────────────────────────────

let activeCompression = false
let updateInProgress = false

export function setActiveCompression(active: boolean): void {
  activeCompression = active
}

// ─── Path Helpers ────────────────────────────────────────────────────────────

function getPlatformArch(): { platform: string; arch: string } {
  return { platform: process.platform, arch: process.arch }
}

function getExeName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

function getResourcesBase(): string {
  if (app.isPackaged) {
    return process.resourcesPath || ''
  }
  // Dev mode: app.getAppPath() returns project root in electron-vite
  return join(app.getAppPath(), 'resources')
}

function getUserDataBase(): string {
  return join(app.getPath('userData'), 'ffmpeg')
}

function getUpdatedDir(): string {
  return join(getUserDataBase(), 'current')
}

function getDownloadsDir(): string {
  return join(getUserDataBase(), 'downloads')
}

function getStagingDir(): string {
  return join(getUserDataBase(), 'staging')
}

function getPreviousDir(): string {
  return join(getUserDataBase(), 'previous')
}

// ─── Path Resolution (Sync) ─────────────────────────────────────────────────

export interface FFmpegPaths {
  ffmpegPath: string
  ffprobePath: string
  source: FFmpegSource
}

export function getFFmpegPaths(): FFmpegPaths {
  const { platform, arch } = getPlatformArch()
  const ffmpegExe = getExeName('ffmpeg')
  const ffprobeExe = getExeName('ffprobe')

  // Priority 1: User-updated version
  const updatedFfmpeg = join(getUpdatedDir(), ffmpegExe)
  const updatedFfprobe = join(getUpdatedDir(), ffprobeExe)
  if (existsSync(updatedFfmpeg) && existsSync(updatedFfprobe)) {
    return { ffmpegPath: updatedFfmpeg, ffprobePath: updatedFfprobe, source: 'updated' }
  }

  // Priority 2: Bundled version
  const resourcesBase = getResourcesBase()
  const bundledFfmpeg = join(resourcesBase, 'ffmpeg', platform, arch, ffmpegExe)
  const bundledFfprobe = join(resourcesBase, 'ffmpeg', platform, arch, ffprobeExe)
  if (existsSync(bundledFfmpeg) && existsSync(bundledFfprobe)) {
    return { ffmpegPath: bundledFfmpeg, ffprobePath: bundledFfprobe, source: 'bundled' }
  }

  // Priority 3: System PATH (dev only)
  if (!app.isPackaged) {
    return { ffmpegPath: ffmpegExe, ffprobePath: ffprobeExe, source: 'system' }
  }

  // Packaged mode: no fallback to system PATH
  return { ffmpegPath: bundledFfmpeg, ffprobePath: bundledFfprobe, source: 'none' }
}

export function getFfmpegPath(): string {
  return getFFmpegPaths().ffmpegPath
}

export function getFfprobePath(): string {
  return getFFmpegPaths().ffprobePath
}

// ─── Binary Check ────────────────────────────────────────────────────────────

function checkBinary(binaryPath: string, name: string): Promise<BinaryCheckResult> {
  return new Promise((resolve) => {
    execFile(binaryPath, ['-version'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve({ available: false, path: binaryPath, error: error.message })
        return
      }
      const versionLine = stdout.split('\n')[0] || 'unknown'
      resolve({ available: true, path: binaryPath, version: versionLine })
    })
  })
}

export async function checkFFmpegAvailable(): Promise<BinaryCheckResult> {
  return checkBinary(getFfmpegPath(), 'FFmpeg')
}

export async function checkFFprobeAvailable(): Promise<BinaryCheckResult> {
  return checkBinary(getFfprobePath(), 'FFprobe')
}

// ─── FFmpeg Info ─────────────────────────────────────────────────────────────

export async function getFFmpegInfo(): Promise<FFmpegInfo> {
  const paths = getFFmpegPaths()

  const [ffmpegCheck, ffprobeCheck] = await Promise.all([
    checkBinary(paths.ffmpegPath, 'FFmpeg'),
    checkBinary(paths.ffprobePath, 'FFprobe')
  ])

  const isAvailable = ffmpegCheck.available && ffprobeCheck.available

  const info: FFmpegInfo = {
    ffmpegPath: paths.ffmpegPath,
    ffprobePath: paths.ffprobePath,
    source: paths.source,
    ffmpegVersion: ffmpegCheck.version,
    ffprobeVersion: ffprobeCheck.version,
    isAvailable,
    errorMessage: isAvailable
      ? undefined
      : !ffmpegCheck.available
        ? `FFmpeg not available: ${ffmpegCheck.error || 'not found'}`
        : `FFprobe not available: ${ffprobeCheck.error || 'not found'}`
  }

  if (paths.source === 'updated') {
    info.updateMetadata = readMetadata() || undefined
  }

  return info
}

// ─── Download Helpers ────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET' })
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      let data = ''
      response.on('data', (chunk: Buffer) => { data += chunk.toString() })
      response.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    request.on('error', reject)
    request.end()
  })
}

interface ManifestInfo {
  version: string
  platform: string
  arch: string
  url: string
  sha256?: string
  assetId?: string
  assetName?: string
}

async function tryFetchManifest(): Promise<ManifestInfo | null> {
  if (!FFMPEG_UPDATE_MANIFEST_URL) return null
  try {
    const data = await fetchJson(FFMPEG_UPDATE_MANIFEST_URL) as ManifestInfo
    if (data.url && data.version) return data
    return null
  } catch {
    return null
  }
}

interface GitHubAsset {
  id: number
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

async function tryFetchGitHubRelease(): Promise<{ url: string; version: string; assetId: string; assetName: string } | null> {
  try {
    const release = await fetchJson(FFMPEG_UPDATE_PROVIDER.apiUrl) as GitHubRelease
    if (!release?.assets?.length) return null

    // Filter assets: win64, gpl, zip, exclude shared/dev/debug/source/symbols
    const candidates = release.assets.filter((a) => {
      const n = a.name.toLowerCase()
      return n.includes('win64')
        && (n.includes('gpl') || n.includes('lgpl'))
        && n.endsWith('.zip')
        && !n.includes('shared')
        && !n.includes('-dev')
        && !n.includes('debug')
        && !n.includes('source')
        && !n.includes('symbols')
    })

    if (candidates.length === 0) return null

    const chosen = candidates[0]
    console.log(`[ffmpeg-manager] GitHub fallback: selected ${chosen.name} from ${release.tag_name}`)
    return { url: chosen.browser_download_url, version: release.tag_name, assetId: String(chosen.id), assetName: chosen.name }
  } catch (err) {
    console.error('[ffmpeg-manager] GitHub fallback failed:', err)
    return null
  }
}

async function downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: 'GET' })
    request.on('response', (response) => {
      if (response.statusCode !== 200 && response.statusCode !== 302) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      // Handle redirect
      if (response.statusCode === 302) {
        const location = String(response.headers['location'] || response.headers['Location'] || '')
        if (location) {
          downloadFile(location, destPath, onProgress).then(resolve).catch(reject)
          return
        }
      }

      const totalSize = parseInt(String(response.headers['content-length'] || '0'), 10)
      let downloaded = 0

      const fileStream = createWriteStream(destPath)

      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length
        fileStream.write(chunk)
        if (totalSize > 0 && onProgress) {
          onProgress(Math.round((downloaded / totalSize) * 100))
        }
      })

      response.on('end', () => {
        fileStream.end(() => resolve())
      })

      response.on('error', (err: Error) => {
        fileStream.destroy()
        reject(err)
      })
    })
    request.on('error', reject)
    request.end()
  })
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (d) => hash.update(d))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// ─── Zip Extraction with Zip Slip Protection ─────────────────────────────────

async function extractZipSafe(zipPath: string, destDir: string): Promise<void> {
  const resolvedDest = resolve(destDir)

  await extractZip(zipPath, {
    dir: resolvedDest,
    onEntry: (entry: { fileName: string }) => {
      const fullPath = resolve(destDir, entry.fileName)
      if (!fullPath.startsWith(resolvedDest + sep) && fullPath !== resolvedDest) {
        throw new Error(`Zip Slip detected: ${entry.fileName} would extract outside target directory`)
      }
    }
  })
}

// ─── Find Binaries Recursively ───────────────────────────────────────────────

function findBinariesInDir(dir: string): { ffmpeg: string; ffprobe: string } | null {
  const ffmpegName = getExeName('ffmpeg')
  const ffprobeName = getExeName('ffprobe')

  let foundFfmpeg: string | null = null
  let foundFfprobe: string | null = null

  function search(currentDir: string): void {
    if (foundFfmpeg && foundFfprobe) return
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (foundFfmpeg && foundFfprobe) return
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          search(fullPath)
        } else if (entry.name.toLowerCase() === ffmpegName.toLowerCase()) {
          foundFfmpeg = fullPath
        } else if (entry.name.toLowerCase() === ffprobeName.toLowerCase()) {
          foundFfprobe = fullPath
        }
      }
    } catch {
      // Permission denied or other error, skip
    }
  }

  search(dir)

  if (foundFfmpeg && foundFfprobe) {
    return { ffmpeg: foundFfmpeg, ffprobe: foundFfprobe }
  }
  return null
}

// ─── Verify Binary ───────────────────────────────────────────────────────────

async function verifyBinary(binaryPath: string, name: string): Promise<boolean> {
  try {
    const result = await checkBinary(binaryPath, name)
    if (result.available) {
      console.log(`[ffmpeg-manager] Verified ${name}: ${result.version}`)
      return true
    }
    return false
  } catch {
    return false
  }
}

// ─── Ensure Directory ────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

// ─── Safe Remove Directory ───────────────────────────────────────────────────

function safeRemoveDir(dir: string): void {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch (err) {
    console.error(`[ffmpeg-manager] Failed to remove ${dir}:`, err)
  }
}

// ─── Metadata Helpers ────────────────────────────────────────────────────────

function getMetadataPath(): string {
  return join(getUpdatedDir(), 'metadata.json')
}

function readMetadata(): FFmpegUpdateMetadata | null {
  try {
    const metaPath = getMetadataPath()
    if (!existsSync(metaPath)) return null
    const raw = readFileSync(metaPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as FFmpegUpdateMetadata
  } catch (err) {
    console.warn('[ffmpeg-manager] Failed to read metadata.json:', err)
    return null
  }
}

function writeMetadata(meta: FFmpegUpdateMetadata): void {
  try {
    const dir = getUpdatedDir()
    ensureDir(dir)
    const metaPath = getMetadataPath()
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    console.log('[ffmpeg-manager] metadata.json written')
  } catch (err) {
    console.error('[ffmpeg-manager] Failed to write metadata.json:', err)
  }
}

// ─── Update FFmpeg ───────────────────────────────────────────────────────────

export async function updateFFmpeg(
  mainWindow?: Electron.BrowserWindow | null,
  progressCallback?: (progress: FFmpegUpdateProgress) => void
): Promise<FFmpegUpdateResult> {
  // Guards
  if (activeCompression) {
    return { ok: false, errorMessage: 'Please wait for compression to finish before updating FFmpeg' }
  }
  if (updateInProgress) {
    return { ok: false, errorMessage: 'FFmpeg update is already in progress' }
  }

  updateInProgress = true

  const sendProgress = (progress: FFmpegUpdateProgress) => {
    progressCallback?.(progress)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ffmpeg:update-progress', progress)
    }
  }

  try {
    // Step 1: Get latest release info
    sendProgress({ status: 'checking', message: 'Checking for updates...' })

    let downloadUrl: string
    let version: string
    let sha256: string | undefined
    let assetId: string | undefined
    let assetName: string | undefined
    let provider: string

    const manifest = await tryFetchManifest()
    if (manifest) {
      downloadUrl = manifest.url
      version = manifest.version
      sha256 = manifest.sha256
      assetId = manifest.assetId
      assetName = manifest.assetName
      provider = 'Manifest'
      console.log(`[ffmpeg-manager] Using manifest: ${version}`)
    } else {
      const github = await tryFetchGitHubRelease()
      if (!github) {
        return { ok: false, errorMessage: 'Could not find FFmpeg download. No manifest configured and GitHub fallback failed.' }
      }
      downloadUrl = github.url
      version = github.version
      assetId = github.assetId
      assetName = github.assetName
      provider = FFMPEG_UPDATE_PROVIDER.name
      console.log(`[ffmpeg-manager] Using GitHub fallback: ${version}`)
    }

    // Step 1b: Check if already up to date
    const metadata = readMetadata()
    console.log(`[ffmpeg-update] checking latest release`)
    console.log(`[ffmpeg-update] current metadata: ${metadata ? JSON.stringify({ version: metadata.version, assetId: metadata.assetId, assetName: metadata.assetName }) : 'missing (legacy)'}`)
    console.log(`[ffmpeg-update] latest asset: ${JSON.stringify({ version, assetId, assetName })}`)

    if (metadata) {
      // Case A: metadata exists — compare directly
      const isUpToDate = (
        (metadata.assetId && assetId && String(metadata.assetId) === String(assetId)) ||
        (metadata.assetName && assetName && metadata.assetName === assetName) ||
        (metadata.version && version && metadata.version === version)
      )
      if (isUpToDate) {
        console.log('[ffmpeg-update] already up to date, skip download')
        const info = await getFFmpegInfo()
        sendProgress({ status: 'completed', message: 'FFmpeg is already up to date' })
        return { ok: true, info, alreadyUpToDate: true }
      }
    } else {
      // Case B: metadata missing but current/ may have binaries (legacy migration)
      const currentDir = getUpdatedDir()
      const ffmpegExe = getExeName('ffmpeg')
      const ffprobeExe = getExeName('ffprobe')
      const currentFfmpeg = join(currentDir, ffmpegExe)
      const currentFfprobe = join(currentDir, ffprobeExe)

      if (existsSync(currentFfmpeg) && existsSync(currentFfprobe)) {
        console.log('[ffmpeg-update] metadata missing, attempting version match against current binaries')
        const currentCheck = await checkBinary(currentFfmpeg, 'FFmpeg')
        console.log(`[ffmpeg-update] current ffmpeg version: ${currentCheck.version || 'unknown'}, latest release: ${version}`)

        // Conservative match: check if version string contains the release tag number
        const releaseVersion = version.replace(/^n/, '') // strip leading 'n' from tag like 'n7.0-...'
        const versionMatch = currentCheck.available && currentCheck.version &&
          (currentCheck.version.includes(releaseVersion) || currentCheck.version.includes(version))

        if (versionMatch) {
          console.log('[ffmpeg-update] version match confirmed, writing metadata retroactively')
          writeMetadata({
            provider,
            version,
            assetName,
            assetId,
            downloadUrl,
            downloadedAt: new Date().toISOString(),
            ffmpegVersion: currentCheck.version,
            ffprobeVersion: (await checkBinary(currentFfprobe, 'FFprobe')).version
          })
          const info = await getFFmpegInfo()
          sendProgress({ status: 'completed', message: 'FFmpeg is already up to date' })
          return { ok: true, info, alreadyUpToDate: true }
        }

        console.log('[ffmpeg-update] version mismatch or cannot determine, proceeding with download')
      }
    }

    // Step 2: Download
    sendProgress({ status: 'downloading', percent: 0, message: `Downloading FFmpeg ${version}...` })

    ensureDir(getDownloadsDir())
    const zipPath = join(getDownloadsDir(), `ffmpeg-${version}.zip`)

    try {
      await downloadFile(downloadUrl, zipPath, (percent) => {
        sendProgress({ status: 'downloading', percent, message: `Downloading FFmpeg ${version}... ${percent}%` })
      })
    } catch (err) {
      return { ok: false, errorMessage: `Download failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
    }

    // Step 3: Verify SHA-256 if available
    if (sha256) {
      sendProgress({ status: 'verifying', message: 'Verifying checksum...' })
      const actualHash = await computeSha256(zipPath)
      if (actualHash.toLowerCase() !== sha256.toLowerCase()) {
        unlinkSync(zipPath)
        return { ok: false, errorMessage: `Checksum mismatch: expected ${sha256}, got ${actualHash}` }
      }
    }

    // Step 4: Extract
    sendProgress({ status: 'extracting', message: 'Extracting...' })

    const stagingBase = getStagingDir()
    const stagingWork = join(stagingBase, `update-${Date.now()}`)
    ensureDir(stagingWork)

    try {
      await extractZipSafe(zipPath, stagingWork)
    } catch (err) {
      safeRemoveDir(stagingWork)
      return { ok: false, errorMessage: `Extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}` }
    }

    // Step 5: Find and verify binaries
    sendProgress({ status: 'verifying', message: 'Verifying binaries...' })

    const found = findBinariesInDir(stagingWork)
    if (!found) {
      safeRemoveDir(stagingWork)
      return { ok: false, errorMessage: 'Downloaded archive does not contain ffmpeg.exe and ffprobe.exe' }
    }

    const ffmpegCheck = await checkBinary(found.ffmpeg, 'FFmpeg')
    const ffprobeCheck = await checkBinary(found.ffprobe, 'FFprobe')

    if (!ffmpegCheck.available || !ffprobeCheck.available) {
      safeRemoveDir(stagingWork)
      return { ok: false, errorMessage: 'Downloaded FFmpeg binaries failed version check' }
    }

    // Step 6: Atomic switch
    // Move binaries to a clean directory for the switch
    const switchDir = join(stagingBase, `ready-${Date.now()}`)
    ensureDir(switchDir)

    // Copy (not move) binaries to switchDir
    copyFileSync(found.ffmpeg, join(switchDir, getExeName('ffmpeg')))
    copyFileSync(found.ffprobe, join(switchDir, getExeName('ffprobe')))

    // Atomic switch: current → previous, switchDir → current
    const currentDir = getUpdatedDir()
    const previousDir = getPreviousDir()

    try {
      // Remove old previous if exists
      safeRemoveDir(previousDir)

      // current → previous (if current exists)
      if (existsSync(currentDir)) {
        renameSync(currentDir, previousDir)
      }

      // switchDir → current
      renameSync(switchDir, currentDir)
    } catch (switchErr) {
      // Rollback: try to restore previous → current
      try {
        if (!existsSync(currentDir) && existsSync(previousDir)) {
          renameSync(previousDir, currentDir)
        }
      } catch {
        // Rollback also failed
      }
      safeRemoveDir(switchDir)
      return { ok: false, errorMessage: `Atomic switch failed: ${switchErr instanceof Error ? switchErr.message : 'Unknown error'}` }
    }

    // Step 7: Write metadata
    writeMetadata({
      provider,
      version,
      assetName,
      assetId,
      downloadUrl,
      downloadedAt: new Date().toISOString(),
      ffmpegVersion: ffmpegCheck.version,
      ffprobeVersion: ffprobeCheck.version
    })

    // Step 8: Cleanup
    safeRemoveDir(previousDir)
    safeRemoveDir(stagingWork)
    safeRemoveDir(stagingBase)
    try { if (existsSync(zipPath)) unlinkSync(zipPath) } catch { /* ignore */ }
    safeRemoveDir(getDownloadsDir())

    // Step 9: Return success
    const info = await getFFmpegInfo()
    sendProgress({ status: 'completed', message: 'FFmpeg updated successfully' })
    console.log(`[ffmpeg-update] update completed: ${info.ffmpegVersion}`)
    return { ok: true, info }

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    sendProgress({ status: 'failed', errorMessage: msg })
    return { ok: false, errorMessage: msg }
  } finally {
    updateInProgress = false
  }
}

// ─── Remove Updated FFmpeg ───────────────────────────────────────────────────

export async function removeUpdatedFFmpeg(): Promise<FFmpegRemoveResult> {
  if (activeCompression) {
    return { ok: false, errorMessage: 'Please wait for compression to finish before removing updated FFmpeg' }
  }
  if (updateInProgress) {
    return { ok: false, errorMessage: 'FFmpeg update is in progress' }
  }

  console.log('[ffmpeg-update] removing updated ffmpeg')

  const currentDir = getUpdatedDir()
  if (!existsSync(currentDir)) {
    // No updated version to remove
    const info = await getFFmpegInfo()
    return { ok: true, info }
  }

  try {
    safeRemoveDir(currentDir)
  } catch (err) {
    return { ok: false, errorMessage: `Failed to remove updated FFmpeg: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }

  const info = await getFFmpegInfo()
  console.log('[ffmpeg-update] reverted to bundled')
  return { ok: true, info }
}

// ─── Check FFmpeg Update ────────────────────────────────────────────────────

export async function checkFFmpegUpdate(): Promise<FFmpegUpdateCheckResult> {
  console.log('[ffmpeg-update] checking for updates')

  let currentInfo: FFmpegInfo
  try {
    currentInfo = await getFFmpegInfo()
  } catch (err) {
    return { ok: false, errorMessage: `Failed to get current FFmpeg info: ${err instanceof Error ? err.message : 'Unknown error'}` }
  }

  // Fetch latest release info
  let latestUrl: string
  let latestVersion: string
  let latestAssetId: string | undefined
  let latestAssetName: string | undefined
  let provider: string

  const manifest = await tryFetchManifest()
  if (manifest) {
    latestUrl = manifest.url
    latestVersion = manifest.version
    latestAssetId = manifest.assetId
    latestAssetName = manifest.assetName
    provider = 'Manifest'
  } else {
    const github = await tryFetchGitHubRelease()
    if (!github) {
      return { ok: false, currentInfo, errorMessage: 'Could not check for updates. No manifest configured and GitHub fallback failed.' }
    }
    latestUrl = github.url
    latestVersion = github.version
    latestAssetId = github.assetId
    latestAssetName = github.assetName
    provider = FFMPEG_UPDATE_PROVIDER.name
  }

  const latest: FFmpegUpdateCheckLatest = {
    provider,
    version: latestVersion,
    assetName: latestAssetName,
    assetId: latestAssetId,
    downloadUrl: latestUrl
  }

  console.log(`[ffmpeg-update] latest asset: ${JSON.stringify({ version: latestVersion, assetId: latestAssetId, assetName: latestAssetName })}`)

  // Compare with current metadata
  const metadata = readMetadata()
  console.log(`[ffmpeg-update] current metadata: ${metadata ? JSON.stringify({ version: metadata.version, assetId: metadata.assetId, assetName: metadata.assetName }) : 'missing'}`)

  if (metadata) {
    const isUpToDate = (
      (metadata.assetId && latestAssetId && String(metadata.assetId) === String(latestAssetId)) ||
      (metadata.assetName && latestAssetName && metadata.assetName === latestAssetName) ||
      (metadata.version && latestVersion && metadata.version === latestVersion)
    )
    if (isUpToDate) {
      console.log('[ffmpeg-update] already up to date')
      return { ok: true, currentInfo, isLatest: true, latest }
    }
    console.log('[ffmpeg-update] new version available')
    return { ok: true, currentInfo, isLatest: false, latest }
  }

  // Metadata missing — try conservative version match if binaries exist
  if (currentInfo.source === 'updated' && currentInfo.isAvailable) {
    console.log('[ffmpeg-update] metadata missing, attempting version match')
    const releaseVersion = latestVersion.replace(/^n/, '')
    const versionMatch = currentInfo.ffmpegVersion &&
      (currentInfo.ffmpegVersion.includes(releaseVersion) || currentInfo.ffmpegVersion.includes(latestVersion))

    if (versionMatch) {
      console.log('[ffmpeg-update] version match confirmed, writing metadata retroactively')
      writeMetadata({
        provider,
        version: latestVersion,
        assetName: latestAssetName,
        assetId: latestAssetId,
        downloadUrl: latestUrl,
        downloadedAt: new Date().toISOString(),
        ffmpegVersion: currentInfo.ffmpegVersion,
        ffprobeVersion: currentInfo.ffprobeVersion
      })
      return { ok: true, currentInfo, isLatest: true, latest }
    }

    console.log('[ffmpeg-update] cannot confirm version, reporting as not latest')
    return { ok: true, currentInfo, isLatest: false, latest, reason: 'Unable to confirm current version is latest' }
  }

  // Bundled or system source — compare bundled version with latest
  if (currentInfo.source === 'bundled' && currentInfo.isAvailable) {
    const releaseVersion = latestVersion.replace(/^n/, '')
    const versionMatch = currentInfo.ffmpegVersion &&
      (currentInfo.ffmpegVersion.includes(releaseVersion) || currentInfo.ffmpegVersion.includes(latestVersion))

    if (versionMatch) {
      console.log('[ffmpeg-update] bundled version matches latest')
      return { ok: true, currentInfo, isLatest: true, latest }
    }

    console.log('[ffmpeg-update] bundled version differs from latest')
    return { ok: true, currentInfo, isLatest: false, latest }
  }

  // System source or unavailable — report as not latest
  return { ok: true, currentInfo, isLatest: false, latest, reason: 'Current FFmpeg source is system PATH or unavailable' }
}

// ─── Open FFmpeg Folder ──────────────────────────────────────────────────────

export async function openFFmpegFolder(): Promise<FFmpegOpenFolderResult> {
  const paths = getFFmpegPaths()

  // System PATH with bare command has no local folder
  if (paths.source === 'system' && !paths.ffmpegPath.includes(sep) && !paths.ffmpegPath.includes('/')) {
    return { ok: false, errorMessage: 'System PATH FFmpeg has no local folder to open' }
  }

  const dir = dirname(paths.ffmpegPath)

  try {
    const result = await shell.openPath(dir)
    if (result) {
      // shell.openPath returns error string on failure, empty string on success
      return { ok: false, errorMessage: result }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : 'Failed to open folder' }
  }
}

// ─── Startup Repair ──────────────────────────────────────────────────────────

export async function repairFFmpegUpdateState(): Promise<void> {
  try {
    const currentDir = getUpdatedDir()
    const previousDir = getPreviousDir()
    const stagingBase = getStagingDir()
    const downloadsDir = getDownloadsDir()

    // If staging exists and current is healthy → clean staging (orphaned)
    if (existsSync(stagingBase) && existsSync(currentDir)) {
      console.log('[ffmpeg-manager] Repair: cleaning orphaned staging')
      safeRemoveDir(stagingBase)
    }

    // If previous exists and current is missing → recover previous → current
    if (existsSync(previousDir) && !existsSync(currentDir)) {
      console.log('[ffmpeg-manager] Repair: recovering previous → current')
      try {
        renameSync(previousDir, currentDir)
      } catch (err) {
        console.error('[ffmpeg-manager] Repair: recovery failed:', err)
      }
    }

    // If previous exists and current exists → clean previous
    if (existsSync(previousDir) && existsSync(currentDir)) {
      console.log('[ffmpeg-manager] Repair: cleaning old previous')
      safeRemoveDir(previousDir)
    }

    // Clean leftover downloads
    if (existsSync(downloadsDir)) {
      console.log('[ffmpeg-manager] Repair: cleaning downloads')
      safeRemoveDir(downloadsDir)
    }

    // Clean leftover staging
    if (existsSync(stagingBase)) {
      safeRemoveDir(stagingBase)
    }
  } catch (err) {
    console.error('[ffmpeg-manager] Repair failed:', err)
  }
}
