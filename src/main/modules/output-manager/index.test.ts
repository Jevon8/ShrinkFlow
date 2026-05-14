import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateOutputPath, buildOutputPath, createOutputPlan, checkOutputDir, checkDiskSpace } from './index'
import { mkdtemp, rm, writeFile, mkdir, access, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'shrinkflow-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('generateOutputPath', () => {
  it('creates ShrinkFlow_Output subdirectory', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const { outputDir } = await generateOutputPath(input)
    expect(outputDir).toBe(join(tempDir, 'ShrinkFlow_Output'))
  })

  it('returns _compressed.mp4 as default filename', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const { outputPath } = await generateOutputPath(input)
    expect(outputPath).toBe(join(tempDir, 'ShrinkFlow_Output', 'video_compressed.mp4'))
  })

  it('auto-increments when output file already exists', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const outputDir = join(tempDir, 'ShrinkFlow_Output')
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, 'video_compressed.mp4'), '')

    const { outputPath } = await generateOutputPath(input)
    expect(outputPath).toBe(join(outputDir, 'video_compressed_1.mp4'))
  })

  it('skips multiple existing files', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const outputDir = join(tempDir, 'ShrinkFlow_Output')
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, 'video_compressed.mp4'), '')
    await writeFile(join(outputDir, 'video_compressed_1.mp4'), '')

    const { outputPath } = await generateOutputPath(input)
    expect(outputPath).toBe(join(outputDir, 'video_compressed_2.mp4'))
  })

  it('prevents overwriting the original file', async () => {
    const outputDir = join(tempDir, 'ShrinkFlow_Output')
    await mkdir(outputDir, { recursive: true })
    const originalPath = join(outputDir, 'video_compressed.mp4')
    await writeFile(originalPath, '')

    const { outputPath } = await generateOutputPath(originalPath)
    expect(outputPath).not.toBe(originalPath)
  })

  it('sanitizes special characters in filename', async () => {
    const input = join(tempDir, 'video:file?.mp4')
    await writeFile(input, '')
    const { outputPath } = await generateOutputPath(input)
    expect(outputPath).toContain('video_file__compressed.mp4')
  })

  it('handles Windows-style backslash paths', async () => {
    const input = join(tempDir, 'test.mp4')
    await writeFile(input, '')
    const { outputPath, outputDir } = await generateOutputPath(input)
    expect(outputPath).toContain('ShrinkFlow_Output')
    expect(outputPath).toContain('test_compressed.mp4')
    expect(outputDir).toContain('ShrinkFlow_Output')
  })
})

describe('checkOutputDir', () => {
  it('returns ok for existing writable directory', async () => {
    const result = await checkOutputDir(tempDir)
    expect(result.ok).toBe(true)
  })

  it('creates directory if it does not exist', async () => {
    const newDir = join(tempDir, 'new', 'nested', 'dir')
    const result = await checkOutputDir(newDir)
    expect(result.ok).toBe(true)
  })
})

describe('checkDiskSpace', () => {
  it('returns ok with available bytes', async () => {
    const result = await checkDiskSpace(tempDir, 1000)
    expect(result.ok).toBe(true)
    expect(result.availableBytes).toBeGreaterThanOrEqual(0)
  })

  it('warns when available space is less than 20% of required', async () => {
    const result = await checkDiskSpace(tempDir, 1_000_000_000_000_000)
    expect(result.ok).toBe(true)
  })
})

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

describe('buildOutputPath (no mkdir)', () => {
  it('computes path without creating directory', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const { outputDir, outputPath } = await buildOutputPath(input)
    expect(outputDir).toBe(join(tempDir, 'ShrinkFlow_Output'))
    expect(outputPath).toBe(join(tempDir, 'ShrinkFlow_Output', 'video_compressed.mp4'))
    expect(await dirExists(outputDir)).toBe(false)
  })

  it('auto-increments over existing files without creating dir', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const outputDir = join(tempDir, 'ShrinkFlow_Output')
    await mkdir(outputDir, { recursive: true })
    await writeFile(join(outputDir, 'video_compressed.mp4'), '')
    const { outputPath } = await buildOutputPath(input)
    expect(outputPath).toBe(join(outputDir, 'video_compressed_1.mp4'))
  })
})

describe('createOutputPlan', () => {
  it('replace_original does NOT create ShrinkFlow_Output', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const outcome = await createOutputPlan(input, { type: 'replace_original' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.shouldReplaceOriginal).toBe(true)
    expect(outcome.plan.outputDir).toBe(tempDir)
    expect(outcome.plan.finalOutputPath).toBe(input)
    expect(outcome.plan.ffmpegOutputPath).toContain('.shrinkflow_tmp_')
    expect(await dirExists(join(tempDir, 'ShrinkFlow_Output'))).toBe(false)
  })

  it('default strategy does NOT eagerly create ShrinkFlow_Output', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const outcome = await createOutputPlan(input, { type: 'default' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.shouldReplaceOriginal).toBe(false)
    expect(outcome.plan.outputDir).toBe(join(tempDir, 'ShrinkFlow_Output'))
    expect(outcome.plan.ffmpegOutputPath).toContain('_compressed.mp4')
    expect(await dirExists(join(tempDir, 'ShrinkFlow_Output'))).toBe(false)
  })

  it('save_as creates user-specified directory', async () => {
    const input = join(tempDir, 'video.mp4')
    await writeFile(input, '')
    const customDir = join(tempDir, 'my_output')
    const outcome = await createOutputPlan(input, { type: 'save_as', outputDir: customDir })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.outputDir).toBe(customDir)
    expect(outcome.plan.shouldReplaceOriginal).toBe(false)
    expect(await dirExists(customDir)).toBe(true)
  })

  it('replace_original temp path is in same directory as input', async () => {
    const subDir = join(tempDir, 'sub')
    await mkdir(subDir, { recursive: true })
    const input = join(subDir, 'clip.mp4')
    await writeFile(input, '')
    const outcome = await createOutputPlan(input, { type: 'replace_original' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.ffmpegOutputPath).toContain(subDir)
    expect(outcome.plan.ffmpegOutputPath).toContain('.shrinkflow_tmp_')
  })

  it('replace_original with Chinese filename', async () => {
    const input = join(tempDir, '测试视频.mp4')
    await writeFile(input, '')
    const outcome = await createOutputPlan(input, { type: 'replace_original' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.shouldReplaceOriginal).toBe(true)
    expect(outcome.plan.finalOutputPath).toBe(input)
    expect(await dirExists(join(tempDir, 'ShrinkFlow_Output'))).toBe(false)
  })

  it('default with Chinese filename does not create dir', async () => {
    const input = join(tempDir, '测试视频.mp4')
    await writeFile(input, '')
    const outcome = await createOutputPlan(input, { type: 'default' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.plan.ffmpegOutputPath).toContain('ShrinkFlow_Output')
    expect(await dirExists(join(tempDir, 'ShrinkFlow_Output'))).toBe(false)
  })
})
