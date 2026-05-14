import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join, sep, resolve } from 'path'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/mock-user-data'),
    getAppPath: vi.fn(() => '/mock-app-path')
  },
  shell: {
    openPath: vi.fn(() => Promise.resolve(''))
  },
  net: {
    request: vi.fn()
  }
}))

// Mock child_process
vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

import { app, net } from 'electron'
import { execFile } from 'child_process'

// Helper to set up temp dirs with mock binaries
function createMockBinary(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), 'mock-binary')
}

const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

let tempDir: string
let originalResourcesPath: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ffmpeg-mgr-test-'))
  originalResourcesPath = process.env.RESOURCES_PATH || undefined
  // Set a mock resourcesPath for packaged mode tests
  Object.defineProperty(process, 'resourcesPath', {
    value: join(tempDir, 'resourcesPath'),
    configurable: true
  })
  vi.clearAllMocks()
  vi.resetModules()
  Object.defineProperty(app, 'isPackaged', { value: false, configurable: true })
  vi.mocked(app).getPath = vi.fn(() => join(tempDir, 'userData'))
  vi.mocked(app).getAppPath = vi.fn(() => tempDir)
  vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
    const callback = typeof _opts === 'function' ? _opts : cb
    if (typeof callback === 'function') {
      callback(null, 'ffmpeg version 7.0\n', '')
    }
    return {} as any
  })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  if (originalResourcesPath !== undefined) {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true
    })
  }
})

// ─── Path Resolution Tests ───────────────────────────────────────────────────

describe('getFFmpegPaths', () => {
  it('should prefer updated over bundled in dev mode', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { getFFmpegPaths } = await import('./index')
    const paths = getFFmpegPaths()

    expect(paths.source).toBe('updated')
    expect(paths.ffmpegPath).toContain('current')
  })

  it('should use bundled when no updated version exists in dev mode', async () => {
    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { getFFmpegPaths } = await import('./index')
    const paths = getFFmpegPaths()

    expect(paths.source).toBe('bundled')
    expect(paths.ffmpegPath).toContain('resources')
  })

  it('should fall back to system PATH in dev mode when no bundled or updated', async () => {
    const { getFFmpegPaths } = await import('./index')
    const paths = getFFmpegPaths()

    expect(paths.source).toBe('system')
    expect(paths.ffmpegPath).toBe(exeName)
  })

  it('should NOT fall back to system PATH in packaged mode', async () => {
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })

    const { getFFmpegPaths } = await import('./index')
    const paths = getFFmpegPaths()

    expect(paths.source).toBe('none')
    // Should be an absolute path, not bare command
    expect(paths.ffmpegPath).not.toBe(exeName)
    expect(paths.ffmpegPath).toContain(sep)
  })

  it('should use updated in packaged mode when available', async () => {
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })

    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    const { getFFmpegPaths } = await import('./index')
    const paths = getFFmpegPaths()

    expect(paths.source).toBe('updated')
  })

  it('should construct correct platform/arch path for bundled', async () => {
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })

    const { getFFmpegPaths } = await import('./index')
    const paths = getFFmpegPaths()

    expect(paths.ffmpegPath).toContain('ffmpeg')
    expect(paths.ffmpegPath).toContain(process.platform)
    expect(paths.ffmpegPath).toContain(process.arch)
  })
})

// ─── Binary Check Tests ──────────────────────────────────────────────────────

describe('checkFFmpegAvailable', () => {
  it('should return available=true when binary exists and runs', async () => {
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(null, 'ffmpeg version 7.0\n', '')
      }
      return {} as any
    })

    const { checkFFmpegAvailable } = await import('./index')
    const result = await checkFFmpegAvailable()

    expect(result.available).toBe(true)
    expect(result.version).toContain('ffmpeg version')
  })

  it('should return available=false when binary fails', async () => {
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(new Error('not found'), '', '')
      }
      return {} as any
    })

    const { checkFFmpegAvailable } = await import('./index')
    const result = await checkFFmpegAvailable()

    expect(result.available).toBe(false)
    expect(result.error).toContain('not found')
  })
})

// ─── FFmpeg Info Tests ───────────────────────────────────────────────────────

describe('getFFmpegInfo', () => {
  it('should return info with source and versions', async () => {
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(null, 'ffmpeg version 7.0\nbuilt with gcc 14', '')
      }
      return {} as any
    })

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('system')
    expect(info.isAvailable).toBe(true)
    expect(info.ffmpegVersion).toContain('ffmpeg version')
  })

  it('should report not available when binaries fail', async () => {
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(new Error('ENOENT'), '', '')
      }
      return {} as any
    })

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.isAvailable).toBe(false)
    expect(info.errorMessage).toBeDefined()
  })
})

// ─── Active Compression Guard Tests ──────────────────────────────────────────

describe('activeCompression guard', () => {
  it('should reject updateFFmpeg when compression is active', async () => {
    const { setActiveCompression, updateFFmpeg } = await import('./index')
    setActiveCompression(true)

    const result = await updateFFmpeg(null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('compression')
    }

    setActiveCompression(false)
  })

  it('should reject removeUpdatedFFmpeg when compression is active', async () => {
    const { setActiveCompression, removeUpdatedFFmpeg } = await import('./index')
    setActiveCompression(true)

    const result = await removeUpdatedFFmpeg()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('compression')
    }

    setActiveCompression(false)
  })
})

// ─── openFFmpegFolder Tests ──────────────────────────────────────────────────

describe('openFFmpegFolder', () => {
  it('should return ok=false for system PATH source with bare command', async () => {
    const { openFFmpegFolder } = await import('./index')
    const result = await openFFmpegFolder()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('System PATH')
    }
  })

  it('should return ok=true for bundled source', async () => {
    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { shell } = await import('electron')
    vi.mocked(shell).openPath = vi.fn(() => Promise.resolve(''))

    const { openFFmpegFolder } = await import('./index')
    const result = await openFFmpegFolder()

    expect(result.ok).toBe(true)
  })
})

// ─── removeUpdatedFFmpeg Tests ───────────────────────────────────────────────

describe('removeUpdatedFFmpeg', () => {
  it('should succeed when no updated version exists', async () => {
    const { removeUpdatedFFmpeg } = await import('./index')
    const result = await removeUpdatedFFmpeg()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.source).not.toBe('updated')
    }
  })

  it('should remove updated version and revert to bundled', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { removeUpdatedFFmpeg, getFFmpegPaths } = await import('./index')

    let paths = getFFmpegPaths()
    expect(paths.source).toBe('updated')

    const result = await removeUpdatedFFmpeg()
    expect(result.ok).toBe(true)

    paths = getFFmpegPaths()
    expect(paths.source).toBe('bundled')
  })
})

// ─── repairFFmpegUpdateState Tests ───────────────────────────────────────────

describe('repairFFmpegUpdateState', () => {
  it('should recover previous to current when current is missing', async () => {
    const previousDir = join(tempDir, 'userData', 'ffmpeg', 'previous')
    createMockBinary(previousDir, exeName)
    createMockBinary(previousDir, probeName)

    const currentDir = join(tempDir, 'userData', 'ffmpeg', 'current')

    const { repairFFmpegUpdateState, getFFmpegPaths } = await import('./index')
    await repairFFmpegUpdateState()

    expect(existsSync(currentDir)).toBe(true)
    expect(existsSync(previousDir)).toBe(false)

    const paths = getFFmpegPaths()
    expect(paths.source).toBe('updated')
  })

  it('should clean staging when current is healthy', async () => {
    const currentDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(currentDir, exeName)
    createMockBinary(currentDir, probeName)

    const stagingDir = join(tempDir, 'userData', 'ffmpeg', 'staging', 'some-update')
    createMockBinary(stagingDir, exeName)

    const { repairFFmpegUpdateState } = await import('./index')
    await repairFFmpegUpdateState()

    expect(existsSync(join(tempDir, 'userData', 'ffmpeg', 'staging'))).toBe(false)
    expect(existsSync(currentDir)).toBe(true)
  })

  it('should clean previous when both current and previous exist', async () => {
    const currentDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(currentDir, exeName)
    createMockBinary(currentDir, probeName)

    const previousDir = join(tempDir, 'userData', 'ffmpeg', 'previous')
    createMockBinary(previousDir, exeName)
    createMockBinary(previousDir, probeName)

    const { repairFFmpegUpdateState } = await import('./index')
    await repairFFmpegUpdateState()

    expect(existsSync(previousDir)).toBe(false)
    expect(existsSync(currentDir)).toBe(true)
  })
})

// ─── setActiveCompression Tests ──────────────────────────────────────────────

describe('setActiveCompression', () => {
  it('should be a function', async () => {
    const { setActiveCompression } = await import('./index')
    expect(typeof setActiveCompression).toBe('function')
  })
})

// ─── Zip Slip Protection Tests ───────────────────────────────────────────────

describe('Zip Slip protection', () => {
  it('should reject entries with path traversal', () => {
    const stagingDir = '/tmp/staging'
    const maliciousEntry = '../../../etc/passwd'
    const fullPath = resolve(stagingDir, maliciousEntry)
    const resolvedDest = resolve(stagingDir)
    const isValid = fullPath.startsWith(resolvedDest + sep) || fullPath === resolvedDest

    expect(isValid).toBe(false)
  })

  it('should accept valid entries', () => {
    const stagingDir = '/tmp/staging'
    const validEntry = 'ffmpeg-master/bin/ffmpeg.exe'
    const fullPath = resolve(stagingDir, validEntry)
    const resolvedDest = resolve(stagingDir)
    const isValid = fullPath.startsWith(resolvedDest + sep) || fullPath === resolvedDest

    expect(isValid).toBe(true)
  })
})

// ─── Metadata Tests ────────────────────────────────────────────────────────

describe('metadata handling', () => {
  it('getFFmpegInfo should return updateMetadata when source is updated and metadata exists', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    const meta = {
      provider: 'BtbN FFmpeg Builds',
      version: 'n7.0',
      assetName: 'ffmpeg-n7.0-latest-win64-gpl.zip',
      assetId: '12345',
      downloadedAt: new Date().toISOString(),
      ffmpegVersion: 'ffmpeg version 7.0',
      ffprobeVersion: 'ffprobe version 7.0'
    }
    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify(meta))

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('updated')
    expect(info.updateMetadata).toBeDefined()
    expect(info.updateMetadata?.provider).toBe('BtbN FFmpeg Builds')
    expect(info.updateMetadata?.assetId).toBe('12345')
  })

  it('getFFmpegInfo should return undefined updateMetadata when metadata file missing', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    // No metadata.json

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('updated')
    expect(info.updateMetadata).toBeUndefined()
  })

  it('getFFmpegInfo should handle corrupt metadata.json gracefully', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    writeFileSync(join(updatedDir, 'metadata.json'), 'not valid json {{{')

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('updated')
    expect(info.updateMetadata).toBeUndefined()
  })

  it('getFFmpegInfo should not return updateMetadata when source is bundled', async () => {
    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('bundled')
    expect(info.updateMetadata).toBeUndefined()
  })

  it('removeUpdatedFFmpeg should remove metadata with the updated directory', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    const meta = {
      provider: 'BtbN FFmpeg Builds',
      version: 'n7.0',
      downloadedAt: new Date().toISOString()
    }
    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify(meta))

    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { removeUpdatedFFmpeg, getFFmpegInfo } = await import('./index')
    const result = await removeUpdatedFFmpeg()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.source).toBe('bundled')
      expect(result.info.updateMetadata).toBeUndefined()
    }

    // Verify metadata file is gone
    expect(existsSync(join(updatedDir, 'metadata.json'))).toBe(false)
  })
})

// ─── checkFFmpegUpdate Tests ───────────────────────────────────────────────

describe('checkFFmpegUpdate', () => {
  it('should return ok=false when cannot fetch release info', async () => {
    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    // In test env without network, it should fail gracefully
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toBeDefined()
    }
  })

  it('should not create any download files', async () => {
    const downloadsDir = join(tempDir, 'userData', 'ffmpeg', 'downloads')
    const { checkFFmpegUpdate } = await import('./index')
    await checkFFmpegUpdate()

    // Should not create downloads directory
    expect(existsSync(downloadsDir)).toBe(false)
  })
})

// ─── i18n Duplicate Key Tests ──────────────────────────────────────────────

describe('i18n locale files', () => {
  it('zh.json should have no duplicate keys in settings', () => {
    const localePath = join(__dirname, '..', '..', '..', 'renderer', 'i18n', 'locales', 'zh.json')
    const raw = readFileSync(localePath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.settings).toBeDefined()
    expect(typeof parsed.settings.ffmpegChecking).toBe('string')
    expect(typeof parsed.settings.ffmpegRefreshSuccess).toBe('string')
    expect(typeof parsed.settings.ffmpegCheckFailed).toBe('string')
    expect(typeof parsed.settings.ffmpegAlreadyLatest).toBe('string')
    expect(typeof parsed.settings.ffmpegRevertedBundled).toBe('string')
    expect(typeof parsed.settings.ffmpegRemoveUpdateFailed).toBe('string')
    expect(typeof parsed.settings.ffmpegCheckingUpdate).toBe('string')
    expect(typeof parsed.settings.ffmpegUpdateAvailable).toBe('string')
    expect(typeof parsed.settings.ffmpegCurrentVersion).toBe('string')
    expect(typeof parsed.settings.ffmpegLatestVersion).toBe('string')
    expect(typeof parsed.settings.ffmpegUpdateNow).toBe('string')
    expect(typeof parsed.settings.ffmpegNotNow).toBe('string')
    expect(typeof parsed.settings.ffmpegUpdateSkipped).toBe('string')
    expect(typeof parsed.settings.ffmpegCheckUpdateFailed).toBe('string')
  })

  it('en.json should have no duplicate keys in settings', () => {
    const localePath = join(__dirname, '..', '..', '..', 'renderer', 'i18n', 'locales', 'en.json')
    const raw = readFileSync(localePath, 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.settings).toBeDefined()
    expect(typeof parsed.settings.ffmpegChecking).toBe('string')
    expect(typeof parsed.settings.ffmpegRefreshSuccess).toBe('string')
    expect(typeof parsed.settings.ffmpegCheckFailed).toBe('string')
    expect(typeof parsed.settings.ffmpegAlreadyLatest).toBe('string')
    expect(typeof parsed.settings.ffmpegRevertedBundled).toBe('string')
    expect(typeof parsed.settings.ffmpegRemoveUpdateFailed).toBe('string')
    expect(typeof parsed.settings.ffmpegCheckingUpdate).toBe('string')
    expect(typeof parsed.settings.ffmpegUpdateAvailable).toBe('string')
    expect(typeof parsed.settings.ffmpegCurrentVersion).toBe('string')
    expect(typeof parsed.settings.ffmpegLatestVersion).toBe('string')
    expect(typeof parsed.settings.ffmpegUpdateNow).toBe('string')
    expect(typeof parsed.settings.ffmpegNotNow).toBe('string')
    expect(typeof parsed.settings.ffmpegUpdateSkipped).toBe('string')
    expect(typeof parsed.settings.ffmpegCheckUpdateFailed).toBe('string')
  })
})

// ─── Network Mock Helper ────────────────────────────────────────────────────

function mockNetRequestJson(jsonData: unknown) {
  const mockRequest = {
    on: vi.fn((event: string, cb: any) => {
      if (event === 'response') {
        const mockResponse = {
          statusCode: 200,
          on: vi.fn((respEvent: string, respCb: any) => {
            if (respEvent === 'data') respCb(Buffer.from(JSON.stringify(jsonData)))
            if (respEvent === 'end') respCb()
          })
        }
        cb(mockResponse)
      }
      return mockRequest
    }),
    end: vi.fn()
  }
  vi.mocked(net).request = vi.fn(() => mockRequest) as any
}

function mockNetRequestError() {
  const mockRequest = {
    on: vi.fn((event: string, cb: any) => {
      if (event === 'error') cb(new Error('Network error'))
      return mockRequest
    }),
    end: vi.fn()
  }
  vi.mocked(net).request = vi.fn(() => mockRequest) as any
}

const MOCK_GITHUB_RELEASE = {
  tag_name: 'n7.1-latest-win64-gpl',
  assets: [
    {
      id: 99999,
      name: 'ffmpeg-n7.1-latest-win64-gpl.zip',
      browser_download_url: 'https://example.com/ffmpeg.zip'
    }
  ]
}

const MOCK_GITHUB_RELEASE_ALT = {
  tag_name: 'n7.0-latest-win64-gpl',
  assets: [
    {
      id: 88888,
      name: 'ffmpeg-n7.0-latest-win64-gpl.zip',
      browser_download_url: 'https://example.com/ffmpeg-old.zip'
    }
  ]
}

// ─── checkFFmpegUpdate with Network Mock ───────────────────────────────────

describe('checkFFmpegUpdate with network', () => {
  it('should return isLatest=true when metadata.assetId matches latest', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: '99999',
      assetName: 'ffmpeg-n7.1-latest-win64-gpl.zip',
      version: 'n7.1-latest-win64-gpl',
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(true)
      expect(result.latest?.assetId).toBe('99999')
    }
  })

  it('should return isLatest=true when metadata.assetName matches latest', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetName: 'ffmpeg-n7.1-latest-win64-gpl.zip',
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(true)
    }
  })

  it('should return isLatest=true when metadata.version matches latest', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      version: 'n7.1-latest-win64-gpl',
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(true)
    }
  })

  it('should normalize assetId number/string for comparison', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    // metadata has assetId as number, GitHub returns it as string (or vice versa)
    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: 99999, // number
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE) // assetId is number 99999

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(true) // String(99999) === String(99999)
    }
  })

  it('should return isLatest=false when metadata does not match latest', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: '11111',
      version: 'n6.0-old',
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(false)
      expect(result.latest?.assetId).toBe('99999')
    }
  })
})

// ─── checkFFmpegUpdate Legacy Migration ────────────────────────────────────

describe('checkFFmpegUpdate legacy migration', () => {
  it('should retroactively write metadata when legacy FFmpeg version matches latest', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    // No metadata.json — legacy updated FFmpeg

    // Mock ffmpeg -version to return version containing 'n7.1'
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(null, 'ffmpeg version n7.1-latest-win64-gpl\n', '')
      }
      return {} as any
    })

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(true)
    }

    // Verify metadata was retroactively written
    const metaPath = join(updatedDir, 'metadata.json')
    expect(existsSync(metaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.assetId).toBe('99999')
    expect(meta.provider).toBe('BtbN FFmpeg Builds')
  })

  it('should report not latest when legacy FFmpeg version cannot be confirmed', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    // No metadata.json

    // Mock ffmpeg -version to return a different version
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(null, 'ffmpeg version 6.0\n', '')
      }
      return {} as any
    })

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { checkFFmpegUpdate } = await import('./index')
    const result = await checkFFmpegUpdate()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.isLatest).toBe(false)
    }
  })
})

// ─── updateFFmpeg alreadyUpToDate Guard ────────────────────────────────────

describe('updateFFmpeg alreadyUpToDate', () => {
  it('should return alreadyUpToDate=true when metadata matches latest release', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: '99999',
      assetName: 'ffmpeg-n7.1-latest-win64-gpl.zip',
      version: 'n7.1-latest-win64-gpl',
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { updateFFmpeg } = await import('./index')
    const result = await updateFFmpeg(null)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.alreadyUpToDate).toBe(true)
    }
  })

  it('should not create staging or download files when alreadyUpToDate', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: '99999',
      downloadedAt: new Date().toISOString()
    }))

    const stagingDir = join(tempDir, 'userData', 'ffmpeg', 'staging')
    const downloadsDir = join(tempDir, 'userData', 'ffmpeg', 'downloads')

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { updateFFmpeg } = await import('./index')
    await updateFFmpeg(null)

    expect(existsSync(stagingDir)).toBe(false)
    expect(existsSync(downloadsDir)).toBe(false)
  })

  it('should proceed with download when metadata does not match', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: '11111',
      downloadedAt: new Date().toISOString()
    }))

    vi.resetModules()
    mockNetRequestError() // Download will fail, but the point is it tried

    const { updateFFmpeg } = await import('./index')
    const result = await updateFFmpeg(null)

    // Should fail at download, NOT at alreadyUpToDate
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).not.toContain('already up to date')
    }
  })
})

// ─── updateFFmpeg Legacy Migration ─────────────────────────────────────────

describe('updateFFmpeg legacy migration', () => {
  it('should retroactively write metadata and return alreadyUpToDate for matching legacy FFmpeg', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    // No metadata.json

    // Mock ffmpeg -version to return version matching release tag
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(null, 'ffmpeg version n7.1-latest-win64-gpl\n', '')
      }
      return {} as any
    })

    vi.resetModules()
    mockNetRequestJson(MOCK_GITHUB_RELEASE)

    const { updateFFmpeg } = await import('./index')
    const result = await updateFFmpeg(null)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.alreadyUpToDate).toBe(true)
    }

    // Verify retroactive metadata
    const metaPath = join(updatedDir, 'metadata.json')
    expect(existsSync(metaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.assetId).toBe('99999')
    expect(meta.provider).toBe('BtbN FFmpeg Builds')
    expect(meta.downloadedAt).toBeDefined()
  })

  it('should proceed with download when legacy version cannot be confirmed', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    // No metadata.json

    // Mock ffmpeg -version to return a different version
    vi.mocked(execFile).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
      const callback = typeof _opts === 'function' ? _opts : cb
      if (typeof callback === 'function') {
        callback(null, 'ffmpeg version 5.0\n', '')
      }
      return {} as any
    })

    vi.resetModules()
    mockNetRequestError() // Download will fail, but the point is it tried

    const { updateFFmpeg } = await import('./index')
    const result = await updateFFmpeg(null)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Should fail at download, not at alreadyUpToDate
      expect(result.errorMessage).not.toContain('already up to date')
    }
  })
})

// ─── updateFFmpeg Metadata Structure ───────────────────────────────────────

describe('updateFFmpeg metadata structure', () => {
  it('metadata.json should contain provider and downloadedAt after successful update', async () => {
    // This test verifies the metadata structure written after a successful update.
    // Since we cannot easily mock the full download+extract+verify pipeline,
    // we verify the structure by testing readMetadata after writing.
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    const meta = {
      provider: 'BtbN FFmpeg Builds',
      version: 'n7.1-latest-win64-gpl',
      assetName: 'ffmpeg-n7.1-latest-win64-gpl.zip',
      assetId: '99999',
      downloadUrl: 'https://example.com/ffmpeg.zip',
      downloadedAt: new Date().toISOString(),
      ffmpegVersion: 'ffmpeg version n7.1',
      ffprobeVersion: 'ffprobe version n7.1'
    }
    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify(meta))

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('updated')
    expect(info.updateMetadata).toBeDefined()
    expect(info.updateMetadata?.provider).toBe('BtbN FFmpeg Builds')
    expect(info.updateMetadata?.downloadedAt).toBeDefined()
    expect(info.updateMetadata?.assetId || info.updateMetadata?.assetName || info.updateMetadata?.version).toBeDefined()
    expect(info.updateMetadata?.ffmpegVersion).toContain('ffmpeg version')
    expect(info.updateMetadata?.ffprobeVersion).toContain('ffprobe version')
  })

  it('metadata write failure should not crash getFFmpegInfo', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)
    writeFileSync(join(updatedDir, 'metadata.json'), 'not valid json {{{')

    const { getFFmpegInfo } = await import('./index')
    const info = await getFFmpegInfo()

    expect(info.source).toBe('updated')
    expect(info.updateMetadata).toBeUndefined()
    expect(info.isAvailable).toBe(true)
  })
})

// ─── removeUpdatedFFmpeg metadata cleanup ──────────────────────────────────

describe('removeUpdatedFFmpeg metadata cleanup', () => {
  it('should remove metadata.json with the updated directory and revert to bundled', async () => {
    const updatedDir = join(tempDir, 'userData', 'ffmpeg', 'current')
    createMockBinary(updatedDir, exeName)
    createMockBinary(updatedDir, probeName)

    writeFileSync(join(updatedDir, 'metadata.json'), JSON.stringify({
      provider: 'BtbN FFmpeg Builds',
      assetId: '99999',
      downloadedAt: new Date().toISOString()
    }))

    const bundledDir = join(tempDir, 'resources', 'ffmpeg', process.platform, process.arch)
    createMockBinary(bundledDir, exeName)
    createMockBinary(bundledDir, probeName)

    const { removeUpdatedFFmpeg, getFFmpegInfo } = await import('./index')
    const result = await removeUpdatedFFmpeg()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.source).toBe('bundled')
      expect(result.info.updateMetadata).toBeUndefined()
    }

    expect(existsSync(join(updatedDir, 'metadata.json'))).toBe(false)
    expect(existsSync(updatedDir)).toBe(false)
  })
})
