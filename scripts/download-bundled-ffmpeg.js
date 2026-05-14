const { existsSync, mkdirSync, createWriteStream, readdirSync, statSync, copyFileSync, writeFileSync, rmSync } = require('fs')
const { join, resolve, sep } = require('path')
const { execFileSync } = require('child_process')
const https = require('https')
const http = require('http')

if (process.platform !== 'win32') {
  console.error('download:ffmpeg currently supports Windows only.')
  process.exit(1)
}

const ROOT = join(__dirname, '..')
const TMP_DIR = join(ROOT, '.tmp')
const DOWNLOAD_DIR = join(TMP_DIR, 'ffmpeg-download')
const EXTRACT_DIR = join(TMP_DIR, 'ffmpeg-extract')
const TARGET_DIR = join(ROOT, 'resources', 'ffmpeg', 'win32', 'x64')

const GITHUB_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest'
const USER_AGENT = 'ShrinkFlow-FFmpeg-Downloader'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    mod.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/vnd.github+json'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const doDownload = (downloadUrl) => {
      mod.get(downloadUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/octet-stream'
        }
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return doDownload(res.headers.location)
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${downloadUrl}`))
          return
        }
        const totalSize = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        let lastPercent = -1

        const file = createWriteStream(destPath)
        res.on('data', (chunk) => {
          downloaded += chunk.length
          file.write(chunk)
          if (totalSize > 0) {
            const percent = Math.round((downloaded / totalSize) * 100)
            if (percent !== lastPercent && percent % 10 === 0) {
              console.log(`  Download: ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`)
              lastPercent = percent
            }
          }
        })
        res.on('end', () => {
          file.end(() => {
            console.log(`  Download complete: ${(downloaded / 1024 / 1024).toFixed(1)} MB`)
            resolve()
          })
        })
        res.on('error', (err) => {
          file.destroy()
          reject(err)
        })
      }).on('error', reject)
    }
    doDownload(url)
  })
}

async function extractZipSafe(zipPath, destDir) {
  const extractZip = require('extract-zip')
  const resolvedDest = resolve(destDir)
  await extractZip(zipPath, {
    dir: resolvedDest,
    onEntry: (entry) => {
      const dest = resolve(destDir, entry.fileName)
      if (!dest.startsWith(resolvedDest + sep)) {
        throw new Error('Unsafe zip entry path: ' + entry.fileName)
      }
    }
  })
}

function findFilesRecursive(dir, targetNames) {
  const results = []
  function search(currentDir) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          search(fullPath)
        } else if (targetNames.includes(entry.name.toLowerCase())) {
          results.push({ name: entry.name, path: fullPath })
        }
      }
    } catch { /* skip */ }
  }
  search(dir)
  return results
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

function safeRemoveDir(dir) {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch { /* ignore */ }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== ShrinkFlow FFmpeg Downloader ===\n')

  // Check if already present
  const ffmpegExe = join(TARGET_DIR, 'ffmpeg.exe')
  const ffprobeExe = join(TARGET_DIR, 'ffprobe.exe')
  const licenseTxt = join(TARGET_DIR, 'LICENSE.txt')

  if (existsSync(ffmpegExe) && existsSync(ffprobeExe) && existsSync(licenseTxt)) {
    console.log('Bundled FFmpeg already exists.')
    console.log(`  ${ffmpegExe}`)
    console.log(`  ${ffprobeExe}`)
    console.log(`  ${licenseTxt}`)
    return
  }

  // Step 1: Get latest release info
  console.log('Fetching latest release from BtbN/FFmpeg-Builds...')
  let release
  try {
    release = await fetchJson(GITHUB_API)
  } catch (err) {
    console.error(`ERROR: Failed to fetch release info: ${err.message}`)
    process.exit(1)
  }

  console.log(`  Release: ${release.tag_name}`)

  // Step 2: Find matching asset
  const candidates = (release.assets || []).filter((a) => {
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

  if (candidates.length === 0) {
    console.error('ERROR: No matching FFmpeg asset found in release.')
    console.error('Available assets:')
    for (const a of (release.assets || [])) {
      console.error(`  - ${a.name}`)
    }
    process.exit(1)
  }

  const chosen = candidates[0]
  const assetApiUrl = `https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/assets/${chosen.id}`
  console.log(`  Selected: ${chosen.name}`)
  console.log(`  Asset ID: ${chosen.id}\n`)

  // Step 3: Download via GitHub API asset endpoint (more reliable than browser_download_url)
  ensureDir(DOWNLOAD_DIR)
  ensureDir(EXTRACT_DIR)
  const zipPath = join(DOWNLOAD_DIR, chosen.name)

  try {
    console.log('Downloading...')
    if (!existsSync(zipPath)) {
      await downloadFile(assetApiUrl, zipPath)
    } else {
      console.log('  Using cached download.')
    }

    // Step 4: Extract with Zip Slip protection
    console.log('\nExtracting...')
    await extractZipSafe(zipPath, EXTRACT_DIR)
    console.log('  Extraction complete.')

    // Step 5: Find ffmpeg.exe and ffprobe.exe
    console.log('\nSearching for binaries...')
    const found = findFilesRecursive(EXTRACT_DIR, ['ffmpeg.exe', 'ffprobe.exe'])

    const ffmpegFound = found.find((f) => f.name.toLowerCase() === 'ffmpeg.exe')
    const ffprobeFound = found.find((f) => f.name.toLowerCase() === 'ffprobe.exe')

    if (!ffmpegFound || !ffprobeFound) {
      console.error('ERROR: Could not find ffmpeg.exe and/or ffprobe.exe in extracted archive.')
      console.error('Found files:')
      for (const f of found) {
        console.error(`  - ${f.path}`)
      }
      process.exit(1)
    }

    console.log(`  Found: ${ffmpegFound.path}`)
    console.log(`  Found: ${ffprobeFound.path}`)

    // Step 6: Copy to target directory
    console.log('\nCopying to target directory...')
    ensureDir(TARGET_DIR)

    copyFileSync(ffmpegFound.path, ffmpegExe)
    copyFileSync(ffprobeFound.path, ffprobeExe)
    console.log(`  ${ffmpegExe}`)
    console.log(`  ${ffprobeExe}`)

    // Step 7: Handle LICENSE.txt
    console.log('\nChecking for license file...')
    const licenseCandidates = findFilesRecursive(EXTRACT_DIR, [
      'license', 'license.txt', 'copying', 'copying.gplv2', 'copying.gplv3', 'license.md'
    ])

    if (licenseCandidates.length > 0) {
      const licenseFile = licenseCandidates[0]
      copyFileSync(licenseFile.path, licenseTxt)
      console.log(`  Copied license from: ${licenseFile.path}`)
    } else {
      const placeholder = [
        'FFmpeg License Notice',
        '=====================',
        '',
        'This is a placeholder. Replace with the actual FFmpeg build license before public release.',
        'The bundled FFmpeg binary is third-party open-source software.',
        '',
        'FFmpeg is licensed under the GNU General Public License version 2 (GPLv2) or later,',
        'or the GNU Lesser General Public License version 2.1 (LGPLv2.1) or later,',
        'depending on the build configuration.',
        '',
        'The binaries downloaded here are from BtbN/FFmpeg-Builds which typically use GPL.',
        '',
        'For the full license text, see:',
        '- GPL v2: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
        '- LGPL v2.1: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
        '',
        'Source code: https://github.com/FFmpeg/FFmpeg',
        'Build source: https://github.com/BtbN/FFmpeg-Builds',
        ''
      ].join('\n')
      writeFileSync(licenseTxt, placeholder)
      console.log('  Created placeholder LICENSE.txt (no license file found in archive)')
      console.log('  NOTE: This placeholder must be replaced with the real license before public release.')
    }

    // Step 8: Verify binaries
    console.log('\nVerifying binaries...')
    try {
      const ffmpegVersion = execFileSync(ffmpegExe, ['-version'], {
        timeout: 10000,
        windowsHide: true
      }).toString().split('\n')[0]
      console.log(`  ffmpeg: ${ffmpegVersion}`)
    } catch (err) {
      console.error(`ERROR: ffmpeg.exe -version failed: ${err.message}`)
      process.exit(1)
    }

    try {
      const ffprobeVersion = execFileSync(ffprobeExe, ['-version'], {
        timeout: 10000,
        windowsHide: true
      }).toString().split('\n')[0]
      console.log(`  ffprobe: ${ffprobeVersion}`)
    } catch (err) {
      console.error(`ERROR: ffprobe.exe -version failed: ${err.message}`)
      process.exit(1)
    }

    console.log('\n=== Download complete! ===')
    console.log(`FFmpeg binaries are in: ${TARGET_DIR}`)
  } finally {
    // Always clean up temp files
    console.log('\nCleaning up temp files...')
    safeRemoveDir(DOWNLOAD_DIR)
    safeRemoveDir(EXTRACT_DIR)
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`)
  process.exit(1)
})
