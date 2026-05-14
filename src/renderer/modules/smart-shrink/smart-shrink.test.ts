import { describe, it, expect } from 'vitest'
import type { ShrinkGoalId, VideoInput } from './types'
import { classifyVideo } from './rules'
import { estimateSaving } from './estimate'
import { buildSmartShrinkPlan, SHRINK_GOALS } from './buildPlan'

function makeVideo(overrides: Partial<VideoInput> = {}): VideoInput {
  return {
    id: 'test-1',
    fileSize: 500 * 1024 * 1024, // 500MB
    duration: 120,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    bitrate: 5_000_000,
    frameRate: 30,
    ...overrides
  }
}

function classify(video: VideoInput, goalId: ShrinkGoalId) {
  return classifyVideo(video, SHRINK_GOALS[goalId])
}

describe('smart-shrink', () => {
  // ─── Goal independence from fixed percentages ───

  // Test 1: Safe Optimize not dependent on fixed 30%
  it('Safe Optimize not dependent on fixed 30% target', () => {
    const video = makeVideo({ bitrate: 15_000_000 }) // very_high bppf
    const advice = classify(video, 'light_30')
    const saving = advice.estimatedSaving
    // Should not have exactly 30% as target — check range differs from old fixed base
    // Old: light_30 was always 15-35. New: depends on compressibility
    expect(saving.maxPercent).toBeGreaterThan(35) // very_high bppf should exceed old cap
  })

  // Test 2: Smart Recommend not dependent on fixed 50%
  it('Smart Recommend not dependent on fixed 50% target', () => {
    const video = makeVideo({ bitrate: 5_000_000 })
    const advice = classify(video, 'balanced_50')
    const saving = advice.estimatedSaving
    expect(saving.maxPercent).not.toBe(55) // old balanced max
    expect(saving.minPercent).not.toBe(30) // old balanced min
  })

  // Test 3: Space Saver not dependent on fixed 70%
  it('Space Saver not dependent on fixed 70% target', () => {
    const video = makeVideo({ bitrate: 8_000_000 })
    const advice = classify(video, 'deep_70')
    const saving = advice.estimatedSaving
    expect(saving.maxPercent).not.toBe(75) // old deep max
    expect(saving.minPercent).not.toBe(50) // old deep min
  })

  // ─── Codec classification ───

  // Test 4: HEVC low bppf → confirm+probe in balanced_50 (efficient codec always confirm)
  it('HEVC low bppf → confirm+probe in balanced_50', () => {
    const video = makeVideo({ videoCodec: 'hevc', bitrate: 3_000_000 }) // low bppf (bppf ~0.048)
    const advice = classify(video, 'balanced_50')
    // Efficient codec: always confirm+probe in balanced_50 (Layer 4 fires)
    expect(advice.action).toBe('confirm')
    expect(advice.reasonCodes).toContain('efficient_codec')
    expect(advice.reasonCodes).toContain('probe_recommended')
  })

  // Test 5: AV1 low bppf → skip
  it('AV1 low bppf → skip', () => {
    const video = makeVideo({ videoCodec: 'av1', bitrate: 1_500_000 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('skip')
  })

  // Test 6: VP9 low bppf → skip
  it('VP9 low bppf → skip', () => {
    const video = makeVideo({ videoCodec: 'vp9', bitrate: 1_500_000 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('skip')
  })

  // Test 7: HEVC high bppf large file in Smart Recommend → confirm (not compress)
  it('HEVC high bppf large file in Smart Recommend → confirm', () => {
    const video = makeVideo({ videoCodec: 'hevc', bitrate: 15_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('confirm')
    expect(advice.selectedByDefault).toBe(false)
  })

  // Test 8: ProRes large file → compress
  it('ProRes large file → compress', () => {
    const video = makeVideo({ videoCodec: 'prores', fileSize: 2 * 1024 * 1024 * 1024, bitrate: 200_000_000 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('editing_codec')
  })

  // Test 9: MJPEG large file → compress
  it('MJPEG large file → compress', () => {
    const video = makeVideo({ videoCodec: 'mjpeg', fileSize: 1 * 1024 * 1024 * 1024, bitrate: 100_000_000 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('editing_codec')
  })

  // ─── Resolution behavior ───

  // Test 10: High resolution + low bppf → not default compress
  it('high resolution + low bppf does not default compress', () => {
    const video = makeVideo({ width: 3840, height: 2160, bitrate: 3_000_000 }) // low bppf for 4K
    const advice = classify(video, 'balanced_50')
    // Should not be compress — high_res is auxiliary only
    expect(['skip', 'confirm']).toContain(advice.action)
  })

  // Test 11: Low resolution + high bppf → can compress
  it('low resolution + high bppf can compress', () => {
    const video = makeVideo({ width: 640, height: 480, bitrate: 1_500_000 }) // high bppf (~0.16) for 480p
    const advice = classify(video, 'balanced_50')
    // high bppf + H.264 → should compress
    expect(advice.action).toBe('compress')
  })

  // ─── Low saving rules ───

  // Test 12: Low saving: maxPercent < 15 → skip for balanced_50 (very low threshold)
  it('low saving maxPercent < 5 → skip for balanced_50', () => {
    const video = makeVideo({ bitrate: 1_800_000 }) // low bppf, low saving
    const advice = classify(video, 'balanced_50')
    if (advice.estimatedSaving.maxPercent < 5) {
      expect(advice.action).toBe('skip')
      expect(advice.reasonCodes).toContain('low_estimated_saving')
    }
  })

  // Test 13: Low saving: maxBytes < 10MB → skip for light_30
  it('low saving maxBytes < 10MB → skip for light_30', () => {
    const video = makeVideo({ fileSize: 30 * 1024 * 1024, bitrate: 1_800_000 })
    const advice = classify(video, 'light_30')
    if (advice.estimatedSaving.maxBytes != null && advice.estimatedSaving.maxBytes < 10 * 1024 * 1024) {
      expect(advice.action).toBe('skip')
    }
  })

  // Test 14: Editing codec large file not low-saving-skipped
  it('editing codec large file not skipped by low saving', () => {
    const video = makeVideo({
      videoCodec: 'prores',
      fileSize: 500 * 1024 * 1024,
      bitrate: 50_000_000
    })
    const advice = classify(video, 'balanced_50')
    // Editing codec large file should at least confirm, not skip
    expect(['compress', 'confirm']).toContain(advice.action)
    expect(advice.action).not.toBe('skip')
  })

  // ─── Goal conservatism ───

  // Test 15: Safe Optimize more conservative than Smart Recommend
  it('Safe Optimize more conservative than Smart Recommend', () => {
    const videos: VideoInput[] = [
      makeVideo({ id: 'v1', bitrate: 8_000_000 }),
      makeVideo({ id: 'v2', bitrate: 6_000_000 }),
      makeVideo({ id: 'v3', bitrate: 4_000_000 }),
      makeVideo({ id: 'v4', fileSize: 100 * 1024 * 1024, bitrate: 3_000_000 })
    ]
    const planLight = buildSmartShrinkPlan(videos, 'light_30')
    const planBalanced = buildSmartShrinkPlan(videos, 'balanced_50')
    const lightActionable = planLight.summary.compressCount + planLight.summary.confirmCount
    const balancedActionable = planBalanced.summary.compressCount + planBalanced.summary.confirmCount
    expect(lightActionable).toBeLessThanOrEqual(balancedActionable)
  })

  // Test 16: Space Saver covers more but high risk → confirm
  it('Space Saver covers more videos but high risk defaults to confirm', () => {
    const videos: VideoInput[] = [
      makeVideo({ id: 'v1', bitrate: 8_000_000 }),
      makeVideo({ id: 'v2', bitrate: 4_000_000 }),
      makeVideo({ id: 'v3', width: 3840, height: 2160, bitrate: 25_000_000 })
    ]
    const planDeep = buildSmartShrinkPlan(videos, 'deep_70')
    const planBalanced = buildSmartShrinkPlan(videos, 'balanced_50')
    const deepActionable = planDeep.summary.compressCount + planDeep.summary.confirmCount
    const balancedActionable = planBalanced.summary.compressCount + planBalanced.summary.confirmCount
    expect(deepActionable).toBeGreaterThanOrEqual(balancedActionable)
  })

  // ─── Metadata handling ───

  // Test 17: Core metadata missing → skip, risk unknown
  it('core metadata missing → skip, risk unknown', () => {
    const video = makeVideo({ duration: 0, width: 0, height: 0 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('skip')
    expect(advice.qualityRisk).toBe('unknown')
  })

  // Test 18: Non-core metadata missing → no NaN
  it('non-core metadata missing does not produce NaN', () => {
    const video = makeVideo({ bitrate: undefined, frameRate: undefined, videoCodec: undefined })
    const advice = classify(video, 'balanced_50')
    expect(isNaN(advice.estimatedSaving.minPercent)).toBe(false)
    expect(isNaN(advice.estimatedSaving.maxPercent)).toBe(false)
    expect(isNaN(advice.estimatedSaving.minBytes!)).toBe(false)
    expect(isNaN(advice.estimatedSaving.maxBytes!)).toBe(false)
  })

  // Test 19: Confidence low → risk at least medium
  it('confidence low → risk at least medium', () => {
    const video = makeVideo({ frameRate: undefined })
    const advice = classify(video, 'balanced_50')
    if (advice.estimatedSaving.confidence === 'low') {
      expect(['medium', 'high']).toContain(advice.qualityRisk)
    }
  })

  // ─── Estimation ───

  // Test 20: Estimation uses mode profile savingFactor, not raw goal caps
  it('estimation uses mode profile savingFactor per goal', () => {
    const video = makeVideo({ bitrate: 10_000_000, fileSize: 200 * 1024 * 1024 }) // high bppf, <500MB
    const savingLight = estimateSaving(video, SHRINK_GOALS['light_30'])
    const savingBalanced = estimateSaving(video, SHRINK_GOALS['balanced_50'])
    const savingDeep = estimateSaving(video, SHRINK_GOALS['deep_70'])
    // high bppf base: 30-60, no size adjustment (<500MB)
    // light_30: factor 0.80 → 24-48
    // balanced_50: factor 0.90 → 27-54
    // deep_70: factor 1.10 → 33-66
    expect(savingLight.maxPercent).toBeLessThan(savingBalanced.maxPercent)
    expect(savingBalanced.maxPercent).toBeLessThan(savingDeep.maxPercent)
    expect(savingLight.maxPercent).toBeCloseTo(48, 0)
    expect(savingBalanced.maxPercent).toBeCloseTo(54, 0)
    expect(savingDeep.maxPercent).toBeCloseTo(66, 0)
  })

  // ─── i18n ───

  // Test 21: History goalId maps to new names via i18n keys
  it('goal labelKeys point to new names', () => {
    expect(SHRINK_GOALS.light_30.labelKey).toBe('smartShrink.goal.light.name')
    expect(SHRINK_GOALS.balanced_50.labelKey).toBe('smartShrink.goal.balanced.name')
    expect(SHRINK_GOALS.deep_70.labelKey).toBe('smartShrink.goal.deep.name')
  })

  // Test 22: i18n no duplicate keys (structural check)
  it('SHRINK_GOALS has no targetSavingRatio field', () => {
    for (const goal of Object.values(SHRINK_GOALS)) {
      expect(goal).not.toHaveProperty('targetSavingRatio')
    }
  })

  // ─── Misc ───

  // Test 23: folder_budget still disabled
  it('folder_budget goal exists in SHRINK_GOALS', () => {
    expect(SHRINK_GOALS.folder_budget).toBeDefined()
    expect(SHRINK_GOALS.folder_budget.id).toBe('folder_budget')
  })

  // Test 24: selectedForCompression logic unchanged
  it('selectedByDefault matches action', () => {
    const video = makeVideo({ bitrate: 15_000_000 })
    const advice = classify(video, 'balanced_50')
    if (advice.action === 'compress') {
      expect(advice.selectedByDefault).toBe(true)
    } else {
      expect(advice.selectedByDefault).toBe(false)
    }
  })

  // Test 25: Estimated bytes non-negative, minPercent <= maxPercent
  it('estimated bytes non-negative and minPercent <= maxPercent', () => {
    const videos: VideoInput[] = [
      makeVideo({ id: 'v1', bitrate: 500_000 }),
      makeVideo({ id: 'v2', bitrate: 50_000_000 }),
      makeVideo({ id: 'v3', fileSize: 5 * 1024 * 1024 }),
      makeVideo({ id: 'v4', duration: 2 }),
      makeVideo({ id: 'v5', videoCodec: 'hevc' }),
      makeVideo({ id: 'v6', videoCodec: 'prores', bitrate: 200_000_000 })
    ]
    for (const video of videos) {
      for (const goalId of ['light_30', 'balanced_50', 'deep_70'] as ShrinkGoalId[]) {
        const saving = estimateSaving(video, SHRINK_GOALS[goalId])
        expect(saving.minPercent).toBeLessThanOrEqual(saving.maxPercent)
        expect(saving.minPercent).toBeGreaterThanOrEqual(0)
        expect(saving.maxPercent).toBeLessThanOrEqual(85)
        if (saving.minBytes != null) expect(saving.minBytes).toBeGreaterThanOrEqual(0)
        if (saving.maxBytes != null) expect(saving.maxBytes).toBeGreaterThanOrEqual(0)
      }
    }
  })

  // ─── Risk semantics (new) ───

  // Test 26: small_file skipped with qualityRisk = low (not unknown) for light_30
  it('small_file skipped with qualityRisk = low for light_30', () => {
    const video = makeVideo({ fileSize: 10 * 1024 * 1024 })
    const advice = classify(video, 'light_30')
    expect(advice.action).toBe('skip')
    expect(advice.qualityRisk).toBe('low')
    expect(advice.reasonCodes).toContain('small_file')
    expect(advice.reasonCodes).toContain('low_return')
  })

  // Test 27: short_video skipped with qualityRisk = low (not unknown) for light_30
  it('short_video skipped with qualityRisk = low for light_30', () => {
    const video = makeVideo({ duration: 3 })
    const advice = classify(video, 'light_30')
    expect(advice.action).toBe('skip')
    expect(advice.qualityRisk).toBe('low')
    expect(advice.reasonCodes).toContain('short_video')
    expect(advice.reasonCodes).toContain('low_return')
  })

  // Test 28: already_compressed skipped with qualityRisk != unknown
  it('already_compressed skipped with qualityRisk != unknown', () => {
    const video = makeVideo({ bitrate: 200_000 }) // very low bppf
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('skip')
    expect(advice.qualityRisk).not.toBe('unknown')
    expect(advice.reasonCodes).toContain('already_compressed')
  })

  // Test 29: core metadata missing → skip, qualityRisk = unknown
  it('core metadata missing → skip, qualityRisk = unknown', () => {
    const video = makeVideo({ width: undefined, height: undefined })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('skip')
    expect(advice.qualityRisk).toBe('unknown')
  })

  // ─── Space Saver behavior ───

  // Test 30: Space Saver + H.264 high bppf large file → compress (not downgraded)
  it('Space Saver + H.264 high bppf large file → compress', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('compress')
    expect(advice.selectedByDefault).toBe(true)
  })

  // Test 31: Space Saver + editing codec large file → compress
  it('Space Saver + editing codec large file → compress', () => {
    const video = makeVideo({ videoCodec: 'prores', fileSize: 2 * 1024 * 1024 * 1024, bitrate: 200_000_000 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('compress')
  })

  // Test 32: Space Saver + efficient codec → confirm
  it('Space Saver + efficient codec → confirm', () => {
    const video = makeVideo({ videoCodec: 'hevc', bitrate: 10_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('confirm')
    expect(advice.selectedByDefault).toBe(false)
  })

  // Test 33: Space Saver + low bppf large file → confirm or skip (not default compress)
  it('Space Saver + low bppf large file → confirm or skip', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 2_000_000, fileSize: 600 * 1024 * 1024 }) // low bppf
    const advice = classify(video, 'deep_70')
    expect(['confirm', 'skip']).toContain(advice.action)
  })

  // Test 34: qualityRisk medium for H.264 in deep_70 (not high)
  it('qualityRisk medium for H.264 high bppf in deep_70', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    expect(advice.qualityRisk).toBe('medium')
    expect(advice.action).toBe('compress')
  })

  // Test 35: high-risk override does NOT turn all deep_70 compress into confirm
  it('high-risk override does not blanket-convert deep_70 compress', () => {
    const videos: VideoInput[] = [
      makeVideo({ id: 'v1', videoCodec: 'h264', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 }),
      makeVideo({ id: 'v2', videoCodec: 'h264', bitrate: 8_000_000, fileSize: 500 * 1024 * 1024 }),
      makeVideo({ id: 'v3', videoCodec: 'mjpeg', fileSize: 1 * 1024 * 1024 * 1024, bitrate: 100_000_000 })
    ]
    const plan = buildSmartShrinkPlan(videos, 'deep_70')
    // At least some should be compress, not all confirm
    expect(plan.summary.compressCount).toBeGreaterThan(0)
  })

  // ─── New: recommendedMode per goal ───

  // Test 36: light_30 → quality_first recommendedMode
  it('light_30 uses quality_first as recommendedMode', () => {
    const video = makeVideo({ bitrate: 12_000_000 })
    const advice = classify(video, 'light_30')
    expect(advice.recommendedMode).toBe('quality_first')
  })

  // Test 37: balanced_50 → compatible_high_quality recommendedMode
  it('balanced_50 uses compatible_high_quality as recommendedMode', () => {
    const video = makeVideo({ bitrate: 12_000_000 })
    const advice = classify(video, 'balanced_50')
    expect(advice.recommendedMode).toBe('compatible_high_quality')
  })

  // Test 38: deep_70 → heavy_balanced recommendedMode
  it('deep_70 uses heavy_balanced as recommendedMode', () => {
    const video = makeVideo({ bitrate: 12_000_000 })
    const advice = classify(video, 'deep_70')
    expect(advice.recommendedMode).toBe('heavy_balanced')
  })

  // Test 39: SHRINK_GOALS default modes match expected values
  it('SHRINK_GOALS default modes are correct', () => {
    expect(SHRINK_GOALS.light_30.recommendedMode).toBe('quality_first')
    expect(SHRINK_GOALS.balanced_50.recommendedMode).toBe('compatible_high_quality')
    expect(SHRINK_GOALS.deep_70.recommendedMode).toBe('heavy_balanced')
    expect(SHRINK_GOALS.folder_budget.recommendedMode).toBe('compatible_high_quality')
  })

  // ─── New: small file / short video behavior per goal ───

  // Test 40: small file + balanced_50 → compress + low_return (not skip)
  it('small file + balanced_50 → compress + low_return', () => {
    const video = makeVideo({ fileSize: 10 * 1024 * 1024 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('low_return')
    expect(advice.selectedByDefault).toBe(true)
  })

  // Test 41: small file + deep_70 → compress + low_return (not skip)
  it('small file + deep_70 → compress + low_return', () => {
    const video = makeVideo({ fileSize: 10 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('low_return')
    expect(advice.selectedByDefault).toBe(true)
  })

  // Test 42: short video + balanced_50 → compress + low_return
  it('short video + balanced_50 → compress + low_return', () => {
    const video = makeVideo({ duration: 3 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('low_return')
    expect(advice.selectedByDefault).toBe(true)
  })

  // Test 43: short video + deep_70 → compress + low_return
  it('short video + deep_70 → compress + low_return', () => {
    const video = makeVideo({ duration: 3 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('low_return')
    expect(advice.selectedByDefault).toBe(true)
  })

  // ─── New: already_compressed + deep_70 large file ───

  // Test 44: already_compressed + deep_70 + large file → confirm + probe_recommended
  it('already_compressed + deep_70 + large file → confirm + probe_recommended', () => {
    const video = makeVideo({ bitrate: 200_000, fileSize: 200 * 1024 * 1024 }) // very low bppf, large
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('confirm')
    expect(advice.reasonCodes).toContain('already_compressed')
    expect(advice.reasonCodes).toContain('probe_recommended')
    expect(advice.selectedByDefault).toBe(false)
  })

  // ─── New: deep_70 + minor_quality_loss reason code ───

  // Test 45: deep_70 + H.264 high bppf → compress + minor_quality_loss
  it('deep_70 + H.264 high bppf → compress + minor_quality_loss', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('minor_quality_loss')
  })

  // Test 46: deep_70 + editing codec → compress + minor_quality_loss
  it('deep_70 + editing codec → compress + minor_quality_loss', () => {
    const video = makeVideo({ videoCodec: 'prores', fileSize: 2 * 1024 * 1024 * 1024, bitrate: 200_000_000 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('compress')
    expect(advice.reasonCodes).toContain('minor_quality_loss')
  })

  // ─── New: unknown codec in deep_70 ───

  // Test 47: unknown codec + deep_70 + low bppf → confirm + probe (not compress)
  it('unknown codec + deep_70 + low bppf → confirm + probe', () => {
    const video = makeVideo({ videoCodec: 'mpeg2', bitrate: 2_000_000 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('confirm')
    expect(advice.reasonCodes).toContain('probe_recommended')
    expect(advice.selectedByDefault).toBe(false)
  })

  // Test 48: unknown codec + deep_70 + high bppf + high confidence → compress
  it('unknown codec + deep_70 + high bppf + high confidence → compress', () => {
    const video = makeVideo({ videoCodec: 'mpeg2', bitrate: 15_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    // High bppf + large file → confidence should be high enough
    // But mpeg2 is unknown codec, so confidence depends on metadata
    if (advice.estimatedSaving.confidence === 'high') {
      expect(advice.action).toBe('compress')
      expect(advice.reasonCodes).toContain('minor_quality_loss')
    } else {
      expect(advice.action).toBe('confirm')
      expect(advice.reasonCodes).toContain('probe_recommended')
    }
  })

  // ─── New: balanced_50 + low bppf H.264 → confirm + probe ───

  // Test 49: balanced_50 + very low bppf H.264 → skip (already_compressed, Layer 1d)
  it('balanced_50 + very low bppf H.264 → skip (already_compressed)', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 2_000_000 }) // bppf ~0.032 = already_compressed
    const advice = classify(video, 'balanced_50')
    // Layer 1d (already_compressed) fires before Layer 4 → skip
    expect(advice.action).toBe('skip')
    expect(advice.reasonCodes).toContain('already_compressed')
  })

  // ─── New: efficient codec always confirm in all goals ───

  // Test 50: efficient codec + light_30 → confirm + probe
  it('efficient codec + light_30 → confirm + probe', () => {
    const video = makeVideo({ videoCodec: 'hevc', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'light_30')
    expect(advice.action).toBe('confirm')
    expect(advice.reasonCodes).toContain('probe_recommended')
    expect(advice.selectedByDefault).toBe(false)
  })

  // Test 51: efficient codec + balanced_50 → confirm + probe
  it('efficient codec + balanced_50 → confirm + probe', () => {
    const video = makeVideo({ videoCodec: 'av1', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'balanced_50')
    expect(advice.action).toBe('confirm')
    expect(advice.reasonCodes).toContain('probe_recommended')
    expect(advice.selectedByDefault).toBe(false)
  })

  // Test 52: efficient codec + deep_70 → confirm + probe
  it('efficient codec + deep_70 → confirm + probe', () => {
    const video = makeVideo({ videoCodec: 'vp9', bitrate: 12_000_000, fileSize: 600 * 1024 * 1024 })
    const advice = classify(video, 'deep_70')
    expect(advice.action).toBe('confirm')
    expect(advice.reasonCodes).toContain('probe_recommended')
    expect(advice.selectedByDefault).toBe(false)
  })

  // ─── New: estimateSaving mode profile factors ───

  // Test 53: estimateSaving applies mode profile savingFactor correctly
  it('estimateSaving applies mode profile savingFactor', () => {
    // medium bppf H.264: base range 15-40, size=500MB → +5 to max = 15-45
    const video = makeVideo({ videoCodec: 'h264', bitrate: 6_000_000, fileSize: 200 * 1024 * 1024 })
    const savingLight = estimateSaving(video, SHRINK_GOALS['light_30'])
    const savingBalanced = estimateSaving(video, SHRINK_GOALS['balanced_50'])
    const savingDeep = estimateSaving(video, SHRINK_GOALS['deep_70'])

    // base: 15-40 (no size adjustment for 200MB)
    // light_30: factor 0.80 → 12-32
    expect(savingLight.minPercent).toBeCloseTo(12, 0)
    expect(savingLight.maxPercent).toBeCloseTo(32, 0)

    // balanced_50: factor 0.90 → 13.5-36
    expect(savingBalanced.minPercent).toBeCloseTo(13.5, 0)
    expect(savingBalanced.maxPercent).toBeCloseTo(36, 0)

    // deep_70: factor 1.10 → 16.5-44
    expect(savingDeep.minPercent).toBeCloseTo(16.5, 0)
    expect(savingDeep.maxPercent).toBeCloseTo(44, 0)
  })

  // Test 54: light_30 + H.264 medium bppf → confirm (not compress)
  it('light_30 + H.264 medium bppf → confirm', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 6_000_000 }) // medium bppf
    const advice = classify(video, 'light_30')
    expect(advice.action).toBe('confirm')
    expect(advice.selectedByDefault).toBe(false)
  })

  // Test 55: light_30 + H.264 low bppf → skip
  it('light_30 + H.264 low bppf → skip', () => {
    const video = makeVideo({ videoCodec: 'h264', bitrate: 2_000_000 }) // low bppf
    const advice = classify(video, 'light_30')
    expect(advice.action).toBe('skip')
    expect(advice.selectedByDefault).toBe(false)
  })
})
