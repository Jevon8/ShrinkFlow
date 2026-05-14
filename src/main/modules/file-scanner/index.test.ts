import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scanPaths, ScanCanceledError } from './index'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'shrinkflow-scanner-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('scanPaths - recursive scanning', () => {
  it('scans only root level when recursive=false', async () => {
    // Create structure:
    //   root.mp4
    //   sub1/
    //     child.mp4
    await writeFile(join(tempDir, 'root.mp4'), '')
    await mkdir(join(tempDir, 'sub1'))
    await writeFile(join(tempDir, 'sub1', 'child.mp4'), '')

    const result = await scanPaths([tempDir], { recursive: false })

    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].fileName).toBe('root.mp4')
  })

  it('scans all subdirectories when recursive=true', async () => {
    // Create structure:
    //   root.mp4
    //   sub1/
    //     child.mp4
    //   sub2/
    //     sub3/
    //       deep.mov
    await writeFile(join(tempDir, 'root.mp4'), '')
    await mkdir(join(tempDir, 'sub1'))
    await writeFile(join(tempDir, 'sub1', 'child.mp4'), '')
    await mkdir(join(tempDir, 'sub2', 'sub3'), { recursive: true })
    await writeFile(join(tempDir, 'sub2', 'sub3', 'deep.mov'), '')

    const result = await scanPaths([tempDir], { recursive: true })

    const names = result.videos.map((v) => v.fileName).sort()
    expect(names).toEqual(['child.mp4', 'deep.mov', 'root.mp4'])
    expect(result.videos).toHaveLength(3)
  })

  it('skips non-video files', async () => {
    await writeFile(join(tempDir, 'video.mp4'), '')
    await writeFile(join(tempDir, 'cover.png'), '')
    await writeFile(join(tempDir, 'readme.txt'), '')
    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'data.json'), '')
    await writeFile(join(tempDir, 'sub', 'clip.webm'), '')

    const result = await scanPaths([tempDir], { recursive: true })

    expect(result.videos).toHaveLength(2)
    const names = result.videos.map((v) => v.fileName).sort()
    expect(names).toEqual(['clip.webm', 'video.mp4'])
  })

  it('handles empty subdirectories', async () => {
    await mkdir(join(tempDir, 'empty1'), { recursive: true })
    await mkdir(join(tempDir, 'empty2', 'empty3'), { recursive: true })

    const result = await scanPaths([tempDir], { recursive: true })

    expect(result.videos).toHaveLength(0)
    expect(result.scannedFolders).toBeGreaterThanOrEqual(3)
  })

  it('handles deeply nested directories', async () => {
    // Create: a/b/c/d/e/deep.mp4
    const deepDir = join(tempDir, 'a', 'b', 'c', 'd', 'e')
    await mkdir(deepDir, { recursive: true })
    await writeFile(join(deepDir, 'deep.mp4'), '')

    const result = await scanPaths([tempDir], { recursive: true })

    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].fileName).toBe('deep.mp4')
    expect(result.scannedFolders).toBeGreaterThanOrEqual(6)
  })

  it('deduplicates by full path', async () => {
    await writeFile(join(tempDir, 'video.mp4'), '')

    const result = await scanPaths([tempDir, tempDir], { recursive: true })

    expect(result.videos).toHaveLength(1)
    const dupes = result.skipped.filter((s) => s.reason === 'duplicate')
    expect(dupes.length).toBeGreaterThanOrEqual(1)
  })

  it('scans multiple root paths', async () => {
    const dir1 = join(tempDir, 'folder1')
    const dir2 = join(tempDir, 'folder2')
    await mkdir(dir1)
    await mkdir(dir2)
    await writeFile(join(dir1, 'a.mp4'), '')
    await writeFile(join(dir2, 'b.mov'), '')

    const result = await scanPaths([dir1, dir2], { recursive: true })

    expect(result.videos).toHaveLength(2)
    const names = result.videos.map((v) => v.fileName).sort()
    expect(names).toEqual(['a.mp4', 'b.mov'])
  })

  it('scans files passed directly', async () => {
    await writeFile(join(tempDir, 'direct.mp4'), '')

    const result = await scanPaths([join(tempDir, 'direct.mp4')])

    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].fileName).toBe('direct.mp4')
  })

  it('supports all video extensions', async () => {
    const exts = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']
    for (const ext of exts) {
      await writeFile(join(tempDir, `video${ext}`), '')
    }

    const result = await scanPaths([tempDir], { recursive: true })

    expect(result.videos).toHaveLength(exts.length)
  })

  it('handles Chinese filenames and paths', async () => {
    const subDir = join(tempDir, '测试文件夹')
    await mkdir(join(subDir, '子目录'), { recursive: true })
    await writeFile(join(subDir, '无水印视频.mp4'), '')
    await writeFile(join(subDir, '子目录', '深藏视频.mov'), '')

    const result = await scanPaths([tempDir], { recursive: true })

    expect(result.videos).toHaveLength(2)
    const names = result.videos.map((v) => v.fileName).sort()
    expect(names).toEqual(['无水印视频.mp4', '深藏视频.mov'])
  })

  it('emits progress events during recursive scan', async () => {
    await writeFile(join(tempDir, 'root.mp4'), '')
    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'child.mp4'), '')

    const events: { status: string; foundVideos: number }[] = []
    await scanPaths([tempDir], {
      recursive: true,
      onProgress: (e) => events.push({ status: e.status, foundVideos: e.foundVideos })
    })

    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].status).toBe('scanning')
    expect(events[events.length - 1].status).toBe('completed')
    expect(events[events.length - 1].foundVideos).toBe(2)
  })

  it('returns correct summary counts', async () => {
    await writeFile(join(tempDir, 'a.mp4'), '')
    await mkdir(join(tempDir, 'sub1'))
    await writeFile(join(tempDir, 'sub1', 'b.mp4'), '')
    await mkdir(join(tempDir, 'sub2', 'sub3'), { recursive: true })
    await writeFile(join(tempDir, 'sub2', 'sub3', 'c.mov'), '')
    await writeFile(join(tempDir, 'cover.png'), '')

    const result = await scanPaths([tempDir], { recursive: true })

    expect(result.videos).toHaveLength(3)
    expect(result.scannedFolders).toBeGreaterThanOrEqual(4) // root + sub1 + sub2 + sub3
    expect(result.scannedFiles).toBeGreaterThanOrEqual(4) // 3 videos + 1 png
  })

  it('non-recursive defaults to false', async () => {
    await writeFile(join(tempDir, 'root.mp4'), '')
    await mkdir(join(tempDir, 'sub'))
    await writeFile(join(tempDir, 'sub', 'child.mp4'), '')

    const result = await scanPaths([tempDir])

    expect(result.videos).toHaveLength(1)
    expect(result.videos[0].fileName).toBe('root.mp4')
  })
})

describe('scanPaths - cancellation', () => {
  it('throws ScanCanceledError when signal is already aborted', async () => {
    await writeFile(join(tempDir, 'video.mp4'), '')
    const controller = new AbortController()
    controller.abort()

    await expect(
      scanPaths([tempDir], { recursive: true, signal: controller.signal })
    ).rejects.toThrow(ScanCanceledError)
  })

  it('emits canceled progress event when scan is aborted', async () => {
    // Create many files to give us time to abort
    const subDir = join(tempDir, 'manyfiles')
    await mkdir(subDir)
    for (let i = 0; i < 100; i++) {
      await writeFile(join(subDir, `video${i}.mp4`), '')
    }

    const controller = new AbortController()
    const events: { status: string }[] = []

    // Abort immediately
    controller.abort()

    try {
      await scanPaths([tempDir], {
        recursive: true,
        signal: controller.signal,
        onProgress: (e) => events.push({ status: e.status })
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ScanCanceledError)
    }

    const canceledEvents = events.filter((e) => e.status === 'canceled')
    expect(canceledEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('does not throw when signal is not aborted', async () => {
    await writeFile(join(tempDir, 'video.mp4'), '')
    const controller = new AbortController()

    const result = await scanPaths([tempDir], {
      recursive: true,
      signal: controller.signal
    })

    expect(result.videos).toHaveLength(1)
  })
})
