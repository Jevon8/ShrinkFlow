import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generatePlan, type CompressionInput, type PlanResult } from './index'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

function getReason(result: PlanResult): string {
  if (!result.ok && 'reason' in result) return result.reason
  if (!result.ok && 'message' in result) return result.message
  return ''
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'shrinkflow-plan-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makeInput(overrides?: Partial<CompressionInput>): CompressionInput {
  return {
    filePath: join(tempDir, 'test.mp4'),
    duration: 120,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    bitrate: 5000000,
    frameRate: 30,
    ...overrides
  }
}

// ─── Balanced mode ───

describe('balanced mode', () => {
  it('generates correct ffmpeg args', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'balanced')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.mode).toBe('balanced')
    expect(result.plan.ffmpegArgs).toContain('-c:v')
    expect(result.plan.ffmpegArgs).toContain('libx264')
    expect(result.plan.ffmpegArgs).toContain('-preset')
    expect(result.plan.ffmpegArgs).toContain('medium')
    expect(result.plan.ffmpegArgs).toContain('-crf')
    expect(result.plan.ffmpegArgs).toContain('24')
    expect(result.plan.ffmpegArgs).toContain('-b:a')
    expect(result.plan.ffmpegArgs).toContain('128k')
    expect(result.plan.ffmpegArgs).toContain('-y')
    expect(result.plan.warnings).toEqual([])
  })

  it('output path ends with _compressed.mp4', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'balanced')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.outputPath).toMatch(/_compressed\.mp4$/)
  })
})

// ─── Quality First mode ───

describe('quality_first mode', () => {
  it('uses slow preset and CRF 20', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'quality_first')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.ffmpegArgs).toContain('slow')
    expect(result.plan.ffmpegArgs).toContain('20')
    expect(result.plan.ffmpegArgs).toContain('192k')
  })
})

// ─── Smallest Size mode ───

describe('smallest_size mode', () => {
  it('uses CRF 30 and 96k audio', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ height: 480 }), 'smallest_size')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.ffmpegArgs).toContain('30')
    expect(result.plan.ffmpegArgs).toContain('96k')
    expect(result.plan.warnings).toEqual([])
  })

  it('scales down when height > 720', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ height: 1080 }), 'smallest_size')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.ffmpegArgs).toContain('-vf')
    expect(result.plan.ffmpegArgs).toContain('scale=-2:720')
    expect(result.plan.warnings).toHaveLength(1)
    expect(result.plan.warnings[0]).toContain('720p')
  })

  it('does not scale when height <= 720', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ height: 720 }), 'smallest_size')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.ffmpegArgs).not.toContain('-vf')
    expect(result.plan.warnings).toEqual([])
  })
})

// ─── Target Size Fast mode ───

describe('target_size_fast mode', () => {
  it('calculates bitrate from target size and duration', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 60 }), 'target_size_fast', 50)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 50MB = 400,000,000 bits. Audio = 128000*60 = 7,680,000 bits.
    // Video = 392,320,000 bits. Bitrate = 392320000/60 = 6,538,666 bps
    const bIdx = result.plan.ffmpegArgs.indexOf('-b:v')
    expect(bIdx).toBeGreaterThan(-1)
    const videoBitrate = parseInt(result.plan.ffmpegArgs[bIdx + 1])
    expect(videoBitrate).toBeGreaterThan(500000)
    expect(videoBitrate).toBeLessThan(10000000)
  })

  it('returns error when duration is missing', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 0 }), 'target_size_fast', 50)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('duration')
  })

  it('returns error when target size is too small for audio', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 600 }), 'target_size_fast', 0.01)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('too small')
  })

  it('returns error when calculated bitrate is unreasonably low (<100kbps)', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 600 }), 'target_size_fast', 10)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('unreasonably low')
  })

  it('warns when bitrate is low (<500kbps)', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 300 }), 'target_size_fast', 10)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.warnings.length).toBeGreaterThan(0)
    expect(result.plan.warnings[0]).toContain('low video bitrate')
  })

  it('has no warnings for reasonable target', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 60 }), 'target_size_fast', 100)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.warnings).toEqual([])
  })

  it('calculates estimatedSizeMB', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 60 }), 'target_size_fast', 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.estimatedSizeMB).toBeDefined()
    expect(result.plan.estimatedSizeMB!).toBeGreaterThan(0)
    expect(result.plan.estimatedSizeMB!).toBeGreaterThan(40)
    expect(result.plan.estimatedSizeMB!).toBeLessThan(60)
  })

  it('includes -maxrate and -bufsize', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 60 }), 'target_size_fast', 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.ffmpegArgs).toContain('-maxrate')
    expect(result.plan.ffmpegArgs).toContain('-bufsize')
  })

  it('returns error when targetSizeMB is not provided', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'target_size_fast')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('Target size is required')
  })

  it('returns error when targetSizeMB <= 0', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'target_size_fast', -5)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('Target size is required')
  })
})

// ─── Heavy Balanced mode ───

describe('heavy_balanced mode', () => {
  it('uses CRF 25, medium preset, yuv420p, AAC 128k', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'heavy_balanced')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.mode).toBe('heavy_balanced')
    expect(result.plan.ffmpegArgs).toContain('-c:v')
    expect(result.plan.ffmpegArgs).toContain('libx264')
    expect(result.plan.ffmpegArgs).toContain('-crf')
    expect(result.plan.ffmpegArgs).toContain('25')
    expect(result.plan.ffmpegArgs).toContain('-preset')
    expect(result.plan.ffmpegArgs).toContain('medium')
    expect(result.plan.ffmpegArgs).toContain('-pix_fmt')
    expect(result.plan.ffmpegArgs).toContain('yuv420p')
    expect(result.plan.ffmpegArgs).toContain('-c:a')
    expect(result.plan.ffmpegArgs).toContain('aac')
    expect(result.plan.ffmpegArgs).toContain('-b:a')
    expect(result.plan.ffmpegArgs).toContain('128k')
    expect(result.plan.ffmpegArgs).toContain('-movflags')
    expect(result.plan.ffmpegArgs).toContain('+faststart')
    expect(result.plan.ffmpegArgs).toContain('-y')
    expect(result.plan.warnings).toEqual([])
  })

  it('does NOT scale down regardless of resolution', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ height: 2160 }), 'heavy_balanced')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.ffmpegArgs).not.toContain('-vf')
    expect(result.plan.warnings).toEqual([])
  })

  it('output path ends with _compressed.mp4', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'heavy_balanced')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.outputPath).toMatch(/_compressed\.mp4$/)
  })
})

// ─── Input validation ───

describe('input validation', () => {
  it('returns error when filePath is empty', async () => {
    const result = await generatePlan(makeInput({ filePath: '' }), 'balanced')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('file path')
  })

  it('returns error when dimensions are invalid', async () => {
    const result = await generatePlan(makeInput({ width: 0, height: 1080 }), 'balanced')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('resolution')
  })

  it('returns error for unknown mode', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput(), 'unknown_mode' as any)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(getReason(result)).toContain('Unknown compression mode')
  })
})

// ─── All args are arrays (not concatenated strings) ───

describe('ffmpeg args format', () => {
  it('returns args as string array with no shell concatenation', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const modes = ['balanced', 'quality_first', 'smallest_size'] as const

    for (const mode of modes) {
      const result = await generatePlan(makeInput(), mode)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(Array.isArray(result.plan.ffmpegArgs)).toBe(true)
      for (const arg of result.plan.ffmpegArgs) {
        if (arg.startsWith('-') || arg.includes('=')) continue
        expect(typeof arg).toBe('string')
      }
    }
  })

  it('target_size_fast args are also a proper array', async () => {
    await writeFile(join(tempDir, 'test.mp4'), '')
    const result = await generatePlan(makeInput({ duration: 60 }), 'target_size_fast', 50)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.isArray(result.plan.ffmpegArgs)).toBe(true)
    const bIdx = result.plan.ffmpegArgs.indexOf('-b:v')
    expect(result.plan.ffmpegArgs[bIdx + 1]).toMatch(/^\d+$/)
  })
})
