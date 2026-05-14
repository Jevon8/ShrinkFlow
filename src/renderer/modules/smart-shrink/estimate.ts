import type { EstimatedSaving, ShrinkGoal, VideoInput } from './types'

function safeNum(v: number | undefined | null, fallback: number): number {
  if (v == null || !isFinite(v) || isNaN(v)) return fallback
  return v
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

export function computeBpp(video: VideoInput): number | null {
  const w = safeNum(video.width, 0)
  const h = safeNum(video.height, 0)
  const fps = safeNum(video.frameRate, 30)
  if (w <= 0 || h <= 0 || fps <= 0) return null

  let bitrate = safeNum(video.bitrate, 0)
  if (bitrate <= 0 && video.duration && video.duration > 0) {
    bitrate = (video.fileSize * 8) / video.duration
  }
  if (bitrate <= 0) return null

  return bitrate / (w * h * fps)
}

function getBppfTier(bpp: number | null): 'already_compressed' | 'low' | 'medium' | 'high' | 'very_high' | 'unknown' {
  if (bpp === null) return 'unknown'
  if (bpp <= 0.045) return 'already_compressed'
  if (bpp <= 0.075) return 'low'
  if (bpp <= 0.12) return 'medium'
  if (bpp <= 0.20) return 'high'
  return 'very_high'
}

function getBaseRange(tier: ReturnType<typeof getBppfTier>, codecClass: 'efficient' | 'common' | 'editing' | 'unknown'): { min: number; max: number } {
  if (codecClass === 'editing') return { min: 50, max: 85 }
  if (codecClass === 'efficient') return { min: 0, max: 25 }

  switch (tier) {
    case 'already_compressed': return { min: 0, max: 10 }
    case 'low': return { min: 5, max: 20 }
    case 'medium': return { min: 15, max: 40 }
    case 'high': return { min: 30, max: 60 }
    case 'very_high': return { min: 45, max: 75 }
    default: return { min: 10, max: 35 }
  }
}

function getCodecClass(codec: string | undefined): 'efficient' | 'common' | 'editing' | 'unknown' {
  if (isEfficientCodec(codec)) return 'efficient'
  if (isEditingCodec(codec)) return 'editing'
  if (!codec) return 'unknown'
  const c = codec.toLowerCase()
  if (c === 'h264' || c === 'h.264' || c === 'avc1' || c === 'avc') return 'common'
  return 'unknown'
}

export function estimateSaving(video: VideoInput, goal: ShrinkGoal): EstimatedSaving {
  const bpp = computeBpp(video)
  const size = safeNum(video.fileSize, 0)

  const tier = getBppfTier(bpp)
  const codecClass = getCodecClass(video.videoCodec)
  const base = getBaseRange(tier, codecClass)

  // For efficient codec + very_high bppf, widen range
  if (codecClass === 'efficient' && tier === 'very_high') {
    base.max = 45
  }

  let minPct = base.min
  let maxPct = base.max

  // Size adjustments (before goal caps)
  if (size >= 500 * 1024 * 1024) {
    maxPct = Math.min(85, maxPct + 5)
  }

  // Goal adjustments — mode profile savingFactor
  // Base range is from codecClass + bppfTier (video characteristics).
  // Mode profile adjusts based on the compression mode's actual encoding capability.
  switch (goal.id) {
    case 'light_30': {
      // quality_first (CRF20, slow) — lower compression than baseline
      maxPct = maxPct * 0.80
      minPct = minPct * 0.80
      break
    }
    case 'balanced_50': {
      // compatible_high_quality (CRF21, medium) — close to baseline
      maxPct = maxPct * 0.90
      minPct = minPct * 0.90
      break
    }
    case 'deep_70': {
      // heavy_balanced (CRF25, medium) — higher compression than baseline
      maxPct = maxPct * 1.10
      minPct = minPct * 1.10
      break
    }
    default: {
      break
    }
  }

  // Clamp
  minPct = Math.max(0, Math.min(85, minPct))
  maxPct = Math.max(0, Math.min(85, maxPct))
  if (minPct > maxPct) minPct = maxPct

  // Bytes
  const minBytes = size > 0 ? Math.max(0, Math.round(size * minPct / 100)) : undefined
  const maxBytes = size > 0 ? Math.max(0, Math.round(size * maxPct / 100)) : undefined

  // Confidence
  let confidence: EstimatedSaving['confidence'] = 'high'
  const hasCore = safeNum(video.duration, 0) > 0 && safeNum(video.width, 0) > 0 && safeNum(video.height, 0) > 0 && size > 0

  if (!hasCore) {
    confidence = 'unknown'
  } else {
    if (!video.bitrate || video.bitrate <= 0) {
      confidence = 'medium'
    }
    if (!video.frameRate || video.frameRate <= 0) {
      confidence = 'low'
    }
    // Non-core metadata missing: codec unknown
    if (codecClass === 'unknown') {
      confidence = confidence === 'high' ? 'medium' : confidence
    }
  }

  return { minPercent: minPct, maxPercent: maxPct, minBytes, maxBytes, confidence }
}
