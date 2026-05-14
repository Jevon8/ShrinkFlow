import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { estimateEta, type EtaEstimateInput, type EtaEstimateResult, type EtaEstimateUnavailable } from './index'
import { addBenchmark } from '../benchmark-store'
import type { DeviceProfile } from '../device-profiler'
import type { CompressionMode } from '../compression-planner'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

function makeVideo(overrides?: Partial<EtaEstimateInput>): EtaEstimateInput {
  return {
    duration: 120,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    bitrate: 5000000,
    ...overrides
  }
}

function makeProfile(overrides?: Partial<DeviceProfile>): DeviceProfile {
  return {
    platform: 'win32',
    cpuModel: 'Intel Core i7',
    cpuCores: 8,
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    freeMemoryBytes: 8 * 1024 * 1024 * 1024,
    ffmpegVersion: '6.0',
    availableHardwareEncoders: [],
    ...overrides
  }
}

function isAvailable(result: EtaEstimateResult | EtaEstimateUnavailable): result is EtaEstimateResult {
  return 'estimatedSecondsMin' in result
}

function isUnavailable(result: EtaEstimateResult | EtaEstimateUnavailable): result is EtaEstimateUnavailable {
  return 'available' in result && !result.available
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'shrinkflow-eta-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('estimateEta', () => {
  // === Realism test 1: short 576x1024 videos should NOT show 15-85 min ===
  it('Test 1: 9x 576x1024 30fps videos, 30 min total, compatible_high_quality, no history', async () => {
    // 9 videos, each ~3.3 min, 576x1024 portrait
    const videos: EtaEstimateInput[] = Array.from({ length: 9 }, () =>
      makeVideo({ duration: 200, width: 576, height: 1024, frameRate: 30 })
    )
    const result = await estimateEta(videos, 'compatible_high_quality', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      // 576x1024 = 589,824 pixels. Reference 1080p = 2,073,600. pixelFactor ≈ 0.284
      // For 30 min (1800s) total at compatible_high_quality (modeFactor 0.9):
      // base minSpeed = 2 * 0.9 = 1.8, base maxSpeed = 12 * 0.9 = 10.8
      // adjusted for 0.284 pixelFactor: minSpeed = 1.8/0.284 ≈ 6.3, maxSpeed = 10.8/0.284 ≈ 38
      // minTime = 1800/38 ≈ 47s, maxTime = 1800/6.3 ≈ 286s (< 5 min)
      // Should NOT be 15-85 min
      expect(result.estimatedSecondsMax).toBeLessThan(600) // under 10 min
      expect(result.confidence).toBe('low')
      expect(result.source).toBe('rule')
      expect(result.estimatedVideosCount).toBe(9)
      expect(result.debugBreakdown.averagePixelFactor).toBeLessThan(0.5)
    }
  })

  // === Test 2: quick probe reduces estimate ===
  it('Test 2: same videos with probe speed=12x → ~2.5 min', async () => {
    const videos: EtaEstimateInput[] = Array.from({ length: 9 }, () =>
      makeVideo({ duration: 200, width: 576, height: 1024, frameRate: 30 })
    )
    // totalDuration = 1800s, speed 12x → 1800/12 = 150s ≈ 2.5 min
    const result = await estimateEta(videos, 'compatible_high_quality', makeProfile(), tempDir, 12)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.source).toBe('probe')
      expect(result.confidence).toBe('medium')
      expect(result.estimatedSecondsMin).toBeLessThan(200)
      expect(result.estimatedSecondsMax).toBeLessThan(250)
      expect(result.debugBreakdown.probeSpeedX).toBe(12)
    }
  })

  // === Test 3: history speed=12x → similar to probe ===
  it('Test 3: with 3 history records speed≈12x → history source, high confidence', async () => {
    for (let i = 0; i < 3; i++) {
      await addBenchmark(tempDir, {
        mode: 'compatible_high_quality',
        resolutionBucket: '1080p',
        outputCodec: 'h264',
        encoderType: 'cpu',
        videoDurationSeconds: 200,
        actualCompressionSeconds: 16.7 // ~12x speed
      })
    }

    const videos: EtaEstimateInput[] = Array.from({ length: 9 }, () =>
      makeVideo({ duration: 200, width: 576, height: 1024 })
    )
    const result = await estimateEta(videos, 'compatible_high_quality', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.source).toBe('history')
      expect(result.confidence).toBe('high')
      expect(result.debugBreakdown.historySampleCount).toBe(3)
    }
  })

  // === Test 4: 10 min 4K quality_first → longer estimate OK ===
  it('Test 4: 10 min 4K quality_first → longer estimate allowed', async () => {
    const videos = [makeVideo({ duration: 600, width: 3840, height: 2160 })]
    const result = await estimateEta(videos, 'quality_first', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      // 4K = pixelFactor 4.0, quality_first modeFactor 0.45
      // Should be several minutes
      expect(result.estimatedSecondsMin).toBeGreaterThan(60)
      expect(result.confidence).toBe('low')
    }
  })

  // === Test 5: missing duration → unavailable ===
  it('Test 5: missing duration → unavailable', async () => {
    const videos = [makeVideo({ duration: 0, height: 1080 })]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)
    expect(isUnavailable(result)).toBe(true)
  })

  // === Test 6: missing width AND height → unavailable ===
  it('Test 6: missing width and height → unavailable', async () => {
    const videos = [makeVideo({ duration: 120, width: 0, height: 0 })]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)
    expect(isUnavailable(result)).toBe(true)
  })

  // === Structural tests ===

  it('returns unavailable for empty video list', async () => {
    const result = await estimateEta([], 'balanced', makeProfile(), tempDir)
    expect(isUnavailable(result)).toBe(true)
  })

  it('pixel-based: 576x1024 is faster than 1920x1080', async () => {
    const portrait = [makeVideo({ duration: 120, width: 576, height: 1024 })]
    const landscape = [makeVideo({ duration: 120, width: 1920, height: 1080 })]
    const profile = makeProfile()

    const rPortrait = await estimateEta(portrait, 'balanced', profile, tempDir)
    const rLandscape = await estimateEta(landscape, 'balanced', profile, tempDir)

    expect(isAvailable(rPortrait)).toBe(true)
    expect(isAvailable(rLandscape)).toBe(true)
    if (isAvailable(rPortrait) && isAvailable(rLandscape)) {
      expect(rPortrait.estimatedSecondsMax).toBeLessThan(rLandscape.estimatedSecondsMax)
    }
  })

  it('quality_first is slower than balanced', async () => {
    const videos = [makeVideo()]
    const profile = makeProfile()

    const balanced = await estimateEta(videos, 'balanced', profile, tempDir)
    const quality = await estimateEta(videos, 'quality_first', profile, tempDir)

    expect(isAvailable(balanced)).toBe(true)
    expect(isAvailable(quality)).toBe(true)
    if (isAvailable(balanced) && isAvailable(quality)) {
      expect(quality.estimatedSecondsMax).toBeGreaterThan(balanced.estimatedSecondsMax)
    }
  })

  it('per-video estimation sums correctly for mixed resolutions', async () => {
    const videos = [
      makeVideo({ duration: 60, width: 1280, height: 720 }),
      makeVideo({ duration: 120, width: 1920, height: 1080 })
    ]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.debugBreakdown.totalDurationSeconds).toBe(180)
      expect(result.debugBreakdown.perVideo.length).toBe(2)
      // Different pixel factors should produce different per-video estimates
      const v1 = result.debugBreakdown.perVideo[0]
      const v2 = result.debugBreakdown.perVideo[1]
      expect(v1.pixelFactor).toBeLessThan(v2.pixelFactor)
    }
  })

  it('single video without history → confidence=low', async () => {
    const videos = [makeVideo()]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.confidence).toBe('low')
      expect(result.source).toBe('rule')
    }
  })

  it('1-2 history records → confidence=medium', async () => {
    await addBenchmark(tempDir, {
      mode: 'balanced',
      resolutionBucket: '1080p',
      outputCodec: 'h264',
      encoderType: 'cpu',
      videoDurationSeconds: 120,
      actualCompressionSeconds: 10
    })

    const videos = [makeVideo()]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.confidence).toBe('medium')
      expect(result.source).toBe('history')
    }
  })

  it('debugBreakdown always present with perVideo', async () => {
    const videos = [makeVideo(), makeVideo({ duration: 60, width: 1280, height: 720 })]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.debugBreakdown).toBeDefined()
      expect(result.debugBreakdown.perVideo.length).toBe(2)
      expect(result.debugBreakdown.formula).toBeTruthy()
      expect(result.debugBreakdown.averagePixelFactor).toBeGreaterThan(0)
    }
  })

  it('ignored videos counted correctly', async () => {
    const videos = [
      makeVideo({ duration: 120, width: 1920, height: 1080 }),
      makeVideo({ duration: 0, width: 1920, height: 1080 }), // missing duration
      makeVideo({ duration: 60, width: 0, height: 0 }) // missing resolution
    ]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(true)
    if (isAvailable(result)) {
      expect(result.estimatedVideosCount).toBe(1)
      expect(result.ignoredVideosCount).toBe(2)
      expect(result.ignoredReasons).toContain('missing_duration')
      expect(result.ignoredReasons).toContain('missing_resolution')
    }
  })

  it('width-only missing → ignored with missing_resolution', async () => {
    const videos = [makeVideo({ duration: 120, width: 0, height: 1080 })]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(false)
    if (isUnavailable(result)) {
      expect(result.reasons[0]).toBeTruthy()
    }
  })

  it('height-only missing → ignored with missing_resolution', async () => {
    const videos = [makeVideo({ duration: 120, width: 1920, height: 0 })]
    const result = await estimateEta(videos, 'balanced', makeProfile(), tempDir)

    expect(isAvailable(result)).toBe(false)
    if (isUnavailable(result)) {
      expect(result.reasons[0]).toBeTruthy()
    }
  })

  it('heavy_balanced is slightly slower than balanced', async () => {
    const videos = [makeVideo()]
    const profile = makeProfile()

    const balanced = await estimateEta(videos, 'balanced', profile, tempDir)
    const heavy = await estimateEta(videos, 'heavy_balanced', profile, tempDir)

    expect(isAvailable(balanced)).toBe(true)
    expect(isAvailable(heavy)).toBe(true)
    if (isAvailable(balanced) && isAvailable(heavy)) {
      // heavy_balanced factor=0.9 (10% slower) → longer ETA
      expect(heavy.estimatedSecondsMax).toBeGreaterThan(balanced.estimatedSecondsMax)
    }
  })

  it('fps factor affects estimation', async () => {
    const video30fps = [makeVideo({ duration: 120, width: 1920, height: 1080, frameRate: 30 })]
    const video60fps = [makeVideo({ duration: 120, width: 1920, height: 1080, frameRate: 60 })]
    const profile = makeProfile()

    const r30 = await estimateEta(video30fps, 'balanced', profile, tempDir)
    const r60 = await estimateEta(video60fps, 'balanced', profile, tempDir)

    expect(isAvailable(r30)).toBe(true)
    expect(isAvailable(r60)).toBe(true)
    if (isAvailable(r30) && isAvailable(r60)) {
      // 60fps should take longer than 30fps
      expect(r60.estimatedSecondsMax).toBeGreaterThan(r30.estimatedSecondsMax)
    }
  })
})
