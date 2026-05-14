import type { CompressionMode } from '../../../preload/index.d'
import type { AdviceAction, AdviceReasonCode, QualityRisk, ShrinkGoal, VideoInput, VideoShrinkAdvice } from './types'
import { computeBpp, estimateSaving } from './estimate'

function safeNum(v: number | undefined | null, fallback: number): number {
  if (v == null || !isFinite(v) || isNaN(v)) return fallback
  return v
}

function hasCoreMetadata(video: VideoInput): boolean {
  return safeNum(video.duration, 0) > 0 &&
    safeNum(video.width, 0) > 0 &&
    safeNum(video.height, 0) > 0 &&
    video.fileSize > 0
}

function isH264(codec: string | undefined): boolean {
  if (!codec) return false
  const c = codec.toLowerCase()
  return c === 'h264' || c === 'h.264' || c === 'avc1' || c === 'avc'
}

function isEfficientCodec(codec: string | undefined): boolean {
  if (!codec) return false
  const c = codec.toLowerCase()
  return c === 'hevc' || c === 'h265' || c === 'h.265' || c === 'av1' || c === 'vp9'
}

function isEditingCodec(codec: string | undefined): boolean {
  if (!codec) return false
  const c = codec.toLowerCase()
  return c === 'prores' || c === 'dnxhd' || c === 'dnxhr' || c === 'mjpeg' || c === 'rawvideo'
}

type CodecClass = 'efficient' | 'common' | 'editing' | 'unknown'

function getCodecClass(codec: string | undefined): CodecClass {
  if (isEfficientCodec(codec)) return 'efficient'
  if (isH264(codec)) return 'common'
  if (isEditingCodec(codec)) return 'editing'
  return 'unknown'
}

type BppfTier = 'already_compressed' | 'low' | 'medium' | 'high' | 'very_high' | 'unknown'

function getBppfTier(bpp: number | null): BppfTier {
  if (bpp === null) return 'unknown'
  if (bpp <= 0.045) return 'already_compressed'
  if (bpp <= 0.075) return 'low'
  if (bpp <= 0.12) return 'medium'
  if (bpp <= 0.20) return 'high'
  return 'very_high'
}

function isHighResolution(w: number, h: number): boolean {
  return w * h >= 3840 * 2160 || w >= 3840 || h >= 2160
}

export function classifyVideo(video: VideoInput, goal: ShrinkGoal): VideoShrinkAdvice {
  const reasonCodes: AdviceReasonCode[] = []
  const duration = safeNum(video.duration, 0)
  const width = safeNum(video.width, 0)
  const height = safeNum(video.height, 0)
  const size = safeNum(video.fileSize, 0)
  const bpp = computeBpp(video)
  const codecClass = getCodecClass(video.videoCodec)
  const bppfTier = getBppfTier(bpp)

  // ─── Layer 1: Hard exclusions ───

  // 1a. Core metadata missing / damaged / invalid
  if (!hasCoreMetadata(video)) {
    const saving = estimateSaving(video, goal)
    return {
      videoId: video.id,
      action: 'skip',
      recommendedMode: goal.recommendedMode,
      qualityRisk: 'unknown',
      estimatedSaving: saving,
      reasonCodes: ['damaged_or_invalid', 'unsupported_metadata'],
      selectedByDefault: false
    }
  }

  // 1b. Small file (< 20MB)
  if (size < 20 * 1024 * 1024) {
    const saving = estimateSaving(video, goal)
    if (goal.id === 'light_30') {
      return {
        videoId: video.id,
        action: 'skip',
        recommendedMode: goal.recommendedMode,
        qualityRisk: 'low',
        estimatedSaving: saving,
        reasonCodes: ['small_file', 'low_return'],
        selectedByDefault: false
      }
    }
    // balanced_50 / deep_70: compress with low_return
    return {
      videoId: video.id,
      action: 'compress',
      recommendedMode: goal.recommendedMode,
      qualityRisk: 'low',
      estimatedSaving: saving,
      reasonCodes: ['small_file', 'low_return'],
      selectedByDefault: true
    }
  }

  // 1c. Short video (< 5s)
  if (duration < 5) {
    const saving = estimateSaving(video, goal)
    if (goal.id === 'light_30') {
      return {
        videoId: video.id,
        action: 'skip',
        recommendedMode: goal.recommendedMode,
        qualityRisk: 'low',
        estimatedSaving: saving,
        reasonCodes: ['short_video', 'low_return'],
        selectedByDefault: false
      }
    }
    // balanced_50 / deep_70: compress with low_return
    return {
      videoId: video.id,
      action: 'compress',
      recommendedMode: goal.recommendedMode,
      qualityRisk: 'low',
      estimatedSaving: saving,
      reasonCodes: ['short_video', 'low_return'],
      selectedByDefault: true
    }
  }

  // 1d. Already compressed (bppf <= 0.045)
  if (bppfTier === 'already_compressed') {
    const saving = estimateSaving(video, goal)
    if (goal.id === 'deep_70' && size >= 100 * 1024 * 1024) {
      // deep_70 + large file: confirm with probe recommendation
      return {
        videoId: video.id,
        action: 'confirm',
        recommendedMode: goal.recommendedMode,
        qualityRisk: 'medium',
        estimatedSaving: saving,
        reasonCodes: ['already_compressed', 'probe_recommended'],
        selectedByDefault: false
      }
    }
    return {
      videoId: video.id,
      action: 'skip',
      recommendedMode: goal.recommendedMode,
      qualityRisk: 'medium',
      estimatedSaving: saving,
      reasonCodes: ['already_compressed'],
      selectedByDefault: false
    }
  }

  // ─── Layer 2: Codec class pre-classification ───
  // (affects evidence and risk, not yet action)

  // ─── Layer 3: Evidence collection ───
  if (bppfTier === 'very_high') {
    reasonCodes.push('very_high_bitrate')
  } else if (bppfTier === 'high') {
    reasonCodes.push('high_bitrate')
  }

  if (isHighResolution(width, height)) {
    reasonCodes.push('high_resolution')
  }

  if (codecClass === 'efficient') {
    reasonCodes.push('efficient_codec')
  } else if (codecClass === 'editing') {
    reasonCodes.push('editing_codec')
  } else if (codecClass === 'unknown') {
    reasonCodes.push('non_h264_codec')
  }

  if (size >= 500 * 1024 * 1024) {
    reasonCodes.push('large_file')
  }

  // ─── Layer 4: Goal-based decision ───
  const saving = estimateSaving(video, goal)
  let action: AdviceAction = 'compress'
  let recommendedMode: CompressionMode = goal.recommendedMode
  let selectedByDefault = true

  const hasHighBpp = bppfTier === 'high' || bppfTier === 'very_high'
  const hasLargeFile = reasonCodes.includes('large_file')

  switch (goal.id) {
    case 'light_30': {
      recommendedMode = 'quality_first'
      if (codecClass === 'efficient') {
        // Efficient codec: always confirm/probe — never auto-compress in light mode
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      } else if (codecClass === 'editing') {
        if (size >= 100 * 1024 * 1024) {
          action = 'compress'
          recommendedMode = 'quality_first'
        } else {
          action = 'skip'
          selectedByDefault = false
        }
      } else if (codecClass === 'unknown') {
        // Unknown codec: confirm + probe
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      } else if (codecClass === 'common') {
        if (hasHighBpp) {
          action = 'compress'
          recommendedMode = 'quality_first'
        } else if (bppfTier === 'medium') {
          action = 'confirm'
          selectedByDefault = false
        } else {
          action = 'skip'
          selectedByDefault = false
        }
      }
      break
    }
    case 'balanced_50': {
      recommendedMode = 'compatible_high_quality'
      if (codecClass === 'efficient') {
        // Efficient codec: always confirm/probe
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      } else if (codecClass === 'editing') {
        action = 'compress'
        recommendedMode = 'compatible_high_quality'
      } else if (codecClass === 'unknown') {
        // Unknown codec: confirm + probe
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      } else if (codecClass === 'common') {
        if (hasHighBpp || bppfTier === 'medium') {
          action = 'compress'
          recommendedMode = 'compatible_high_quality'
        } else if (bppfTier === 'low') {
          // Low bppf H.264: confirm + probe
          action = 'confirm'
          selectedByDefault = false
          reasonCodes.push('probe_recommended')
        } else {
          action = 'skip'
          selectedByDefault = false
        }
      }
      break
    }
    case 'deep_70': {
      recommendedMode = 'heavy_balanced'
      if (codecClass === 'efficient') {
        // Efficient codec: always confirm/probe — never auto-compress
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      } else if (codecClass === 'editing') {
        action = 'compress'
        recommendedMode = 'heavy_balanced'
        reasonCodes.push('minor_quality_loss')
      } else if (codecClass === 'unknown') {
        // Unknown codec: confirm + probe (only compress if high confidence + high bppf)
        if (hasHighBpp && saving.confidence === 'high') {
          action = 'compress'
          recommendedMode = 'heavy_balanced'
          reasonCodes.push('minor_quality_loss')
        } else {
          action = 'confirm'
          selectedByDefault = false
          reasonCodes.push('probe_recommended')
        }
      } else if (codecClass === 'common') {
        if (hasHighBpp || bppfTier === 'medium') {
          action = 'compress'
          recommendedMode = 'heavy_balanced'
          reasonCodes.push('minor_quality_loss')
        } else if (bppfTier === 'low') {
          // Low bppf H.264: confirm, depends on saving
          if (hasLargeFile && saving.maxBytes != null && saving.maxBytes >= 20 * 1024 * 1024) {
            action = 'confirm'
            selectedByDefault = false
          } else {
            action = 'skip'
            selectedByDefault = false
          }
        } else {
          action = 'skip'
          selectedByDefault = false
        }
      }
      break
    }
    default: {
      // folder_budget — use compatible_high_quality
      recommendedMode = 'compatible_high_quality'
      if (codecClass === 'efficient') {
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      } else if (codecClass === 'editing' || codecClass === 'common') {
        action = 'compress'
      } else {
        action = 'confirm'
        selectedByDefault = false
        reasonCodes.push('probe_recommended')
      }
      break
    }
  }

  // ─── Layer 5: High-risk override ───
  // If action is compress but risk conditions apply, downgrade to confirm
  // Does NOT blanket-convert all deep_70 items
  if (action === 'compress') {
    const qualityRisk = calculateQualityRisk(video, goal, saving, bpp, reasonCodes, codecClass, bppfTier)
    if (qualityRisk === 'high') {
      action = 'confirm'
      selectedByDefault = false
    }
  }

  // ─── Layer 6: Low-saving downgrade ───
  if (action === 'compress' || action === 'confirm') {
    if (goal.id === 'light_30') {
      // Light: strict threshold — skip if low saving
      const isLowSaving =
        saving.maxPercent < 15 ||
        (saving.maxBytes != null && saving.maxBytes < 10 * 1024 * 1024)
      if (isLowSaving) {
        if (codecClass === 'editing' && size >= 100 * 1024 * 1024) {
          action = 'confirm'
          selectedByDefault = false
        } else {
          if (!reasonCodes.includes('low_estimated_saving')) {
            reasonCodes.push('low_estimated_saving')
          }
          action = 'skip'
          selectedByDefault = false
        }
      }
    } else if (goal.id === 'balanced_50') {
      // Balanced: moderate threshold
      const isVeryLowSaving =
        saving.maxPercent < 5 ||
        (saving.maxBytes != null && saving.maxBytes < 3 * 1024 * 1024)
      const isLowSaving =
        saving.maxPercent < 15 ||
        (saving.maxBytes != null && saving.maxBytes < 10 * 1024 * 1024)
      if (isVeryLowSaving) {
        if (codecClass === 'editing' && size >= 100 * 1024 * 1024) {
          action = 'confirm'
          selectedByDefault = false
        } else {
          if (!reasonCodes.includes('low_estimated_saving')) {
            reasonCodes.push('low_estimated_saving')
          }
          action = 'skip'
          selectedByDefault = false
        }
      } else if (isLowSaving && action === 'compress') {
        // Low but not very low: keep compress but add low_return tag
        reasonCodes.push('low_return')
      }
    } else if (goal.id === 'deep_70') {
      // Deep: very low threshold — only skip if almost no saving
      const isVeryLowSaving =
        saving.maxPercent < 3 ||
        (saving.maxBytes != null && saving.maxBytes < 2 * 1024 * 1024)
      if (isVeryLowSaving) {
        if (codecClass === 'editing' && size >= 100 * 1024 * 1024) {
          action = 'confirm'
          selectedByDefault = false
        } else {
          if (!reasonCodes.includes('low_estimated_saving')) {
            reasonCodes.push('low_estimated_saving')
          }
          action = 'skip'
          selectedByDefault = false
        }
      }
    } else {
      // folder_budget: moderate threshold
      const isLowSaving =
        saving.maxPercent < 10 ||
        (saving.maxBytes != null && saving.maxBytes < 5 * 1024 * 1024)
      if (isLowSaving) {
        if (codecClass === 'editing' && size >= 100 * 1024 * 1024) {
          action = 'confirm'
          selectedByDefault = false
        } else {
          if (!reasonCodes.includes('low_estimated_saving')) {
            reasonCodes.push('low_estimated_saving')
          }
          action = 'skip'
          selectedByDefault = false
        }
      }
    }
  }

  // Final quality risk (for return value)
  const qualityRisk = calculateQualityRisk(video, goal, saving, bpp, reasonCodes, codecClass, bppfTier)

  return {
    videoId: video.id,
    action,
    recommendedMode,
    qualityRisk,
    estimatedSaving: saving,
    reasonCodes,
    selectedByDefault
  }
}

function calculateQualityRisk(
  video: VideoInput,
  goal: ShrinkGoal,
  saving: { maxPercent: number },
  bpp: number | null,
  reasonCodes: AdviceReasonCode[],
  codecClass: CodecClass,
  bppfTier: BppfTier
): QualityRisk {
  const duration = safeNum(video.duration, 0)
  const width = safeNum(video.width, 0)
  const height = safeNum(video.height, 0)

  // Unknown if core metadata insufficient
  if (!width || !height || duration <= 0) return 'unknown'

  // ─── High risk conditions (any of) ───

  // 1. Efficient codec being re-compressed
  if (codecClass === 'efficient') return 'high'

  // 2. Low bppf AND being compressed
  if (bppfTier === 'low' && reasonCodes.includes('low_estimated_saving') === false) {
    return 'high'
  }

  // 3. Very aggressive saving target (editing codecs naturally have high %)
  if (codecClass === 'editing') {
    if (saving.maxPercent > 85) return 'high'
  } else {
    if (saving.maxPercent > 75) return 'high'
  }

  // 4. Confidence would be low (check estimate.ts signals)
  if (!video.frameRate || video.frameRate <= 0) return 'high'

  // 5. Unknown codec AND large file
  if (codecClass === 'unknown' && reasonCodes.includes('large_file')) return 'high'

  // ─── Medium risk conditions ───

  // Space Saver (heavy_balanced CRF25) — moderate risk for common codecs
  if (goal.id === 'deep_70') {
    // Efficient codec already handled above as high
    // Low bppf in Space Saver
    if (bppfTier === 'low') return 'high'
    // High saving with heavy compression
    if (saving.maxPercent > 65) return 'medium'
    // H.264 high/medium bppf or editing codec → medium (heavy_balanced is less aggressive than smallest_size)
    return 'medium'
  }

  // Medium bppf
  if (bppfTier === 'medium') return 'medium'

  // High resolution is auxiliary — increases risk but doesn't alone trigger compress
  if (reasonCodes.includes('high_resolution')) return 'medium'

  // Unknown codec
  if (codecClass === 'unknown') return 'medium'

  // ─── Low risk ───
  if (goal.id === 'light_30') {
    if (saving.maxPercent <= 35) return 'low'
    return 'medium'
  }

  if (goal.id === 'balanced_50') {
    if (codecClass === 'editing') {
      // Editing codecs naturally have high saving %
      if (saving.maxPercent <= 85) return 'medium'
      return 'high'
    }
    if (saving.maxPercent <= 40) return 'low'
    if (saving.maxPercent <= 65) return 'medium'
    return 'high'
  }

  // Default
  if (saving.maxPercent <= 35) return 'low'
  if (saving.maxPercent <= 55) return 'medium'
  return 'high'
}
