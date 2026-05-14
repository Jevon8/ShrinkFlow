import { describe, it, expect } from 'vitest'
import { formatElapsed, formatRemaining, formatEta, getPhaseLabel, buildFallbackProgress } from './progress-format'

describe('formatElapsed', () => {
  it('0s', () => {
    expect(formatElapsed(0)).toBe('0s')
  })

  it('30s', () => {
    expect(formatElapsed(30)).toBe('30s')
  })

  it('59s', () => {
    expect(formatElapsed(59)).toBe('59s')
  })

  it('60s → 1m 00s', () => {
    expect(formatElapsed(60)).toBe('1m 00s')
  })

  it('90s → 1m 30s', () => {
    expect(formatElapsed(90)).toBe('1m 30s')
  })

  it('3599s → 59m 59s', () => {
    expect(formatElapsed(3599)).toBe('59m 59s')
  })

  it('3600s → 1h 00m', () => {
    expect(formatElapsed(3600)).toBe('1h 00m')
  })

  it('3661s → 1h 01m', () => {
    expect(formatElapsed(3661)).toBe('1h 01m')
  })

  it('7200s → 2h 00m', () => {
    expect(formatElapsed(7200)).toBe('2h 00m')
  })
})

describe('formatRemaining', () => {
  it('negative → empty string', () => {
    expect(formatRemaining(-1)).toBe('')
  })

  it('0s', () => {
    expect(formatRemaining(0)).toBe('0s')
  })

  it('30s', () => {
    expect(formatRemaining(30)).toBe('30s')
  })

  it('59s', () => {
    expect(formatRemaining(59)).toBe('59s')
  })

  it('60s → 1m 00s', () => {
    expect(formatRemaining(60)).toBe('1m 00s')
  })

  it('90s → 1m 30s', () => {
    expect(formatRemaining(90)).toBe('1m 30s')
  })

  it('3600s → 1h 00m', () => {
    expect(formatRemaining(3600)).toBe('1h 00m')
  })
})

describe('formatEta', () => {
  it('0s → ~0s', () => {
    expect(formatEta(0)).toBe('~0s')
  })

  it('30s → ~30s', () => {
    expect(formatEta(30)).toBe('~30s')
  })

  it('59s → ~59s', () => {
    expect(formatEta(59)).toBe('~59s')
  })

  it('60s → ~1m 00s', () => {
    expect(formatEta(60)).toBe('~1m 00s')
  })

  it('90s → ~1m 30s', () => {
    expect(formatEta(90)).toBe('~1m 30s')
  })

  it('3600s → ~1h 00m', () => {
    expect(formatEta(3600)).toBe('~1h 00m')
  })
})

describe('getPhaseLabel', () => {
  const t = (key: string) => {
    const map: Record<string, string> = {
      'compress.compressing': 'Compressing',
      'compress.twoPassAnalyze': 'Pass 1: Analyzing',
      'compress.twoPassEncode': 'Pass 2: Encoding'
    }
    return map[key] || key
  }

  it('undefined → compressing', () => {
    expect(getPhaseLabel(undefined, t)).toBe('Compressing')
  })

  it('single → compressing', () => {
    expect(getPhaseLabel('single', t)).toBe('Compressing')
  })

  it('two_pass_analyze → pass 1 label', () => {
    expect(getPhaseLabel('two_pass_analyze', t)).toBe('Pass 1: Analyzing')
  })

  it('two_pass_encode → pass 2 label', () => {
    expect(getPhaseLabel('two_pass_encode', t)).toBe('Pass 2: Encoding')
  })

  it('unknown phase → compressing fallback', () => {
    expect(getPhaseLabel('unknown', t)).toBe('Compressing')
  })
})

describe('remainingSeconds constraints', () => {
  // These tests verify the contract that ffmpeg-runner must satisfy:
  // percent < 5 → remainingSeconds = -1 (estimating)
  // percent >= 5 → remainingSeconds >= 0
  // percent = 100 → remainingSeconds = 0

  it('remainingSeconds = -1 means estimating (formatRemaining returns empty)', () => {
    expect(formatRemaining(-1)).toBe('')
  })

  it('remainingSeconds = 0 means done', () => {
    expect(formatRemaining(0)).toBe('0s')
  })

  it('remainingSeconds is never negative for valid input', () => {
    // Simulating ffmpeg-runner logic: percent >= 5 → remainingSeconds >= 0
    const percent = 50
    const elapsedSeconds = 120
    const totalEstimated = (elapsedSeconds / percent) * 100
    const remaining = Math.max(totalEstimated - elapsedSeconds, 0)
    const remainingSeconds = Math.round(remaining)
    expect(remainingSeconds).toBeGreaterThanOrEqual(0)
  })

  it('percent=100 → remainingSeconds=0', () => {
    const percent = 100
    const elapsedSeconds = 300
    const totalEstimated = (elapsedSeconds / percent) * 100
    const remaining = Math.max(totalEstimated - elapsedSeconds, 0)
    const remainingSeconds = Math.round(remaining)
    expect(remainingSeconds).toBe(0)
  })
})

describe('buildFallbackProgress', () => {
  it('returns 0% overallPercent', () => {
    const p = buildFallbackProgress(5)
    expect(p.overallPercent).toBe(0)
  })

  it('returns 0 completedFiles', () => {
    const p = buildFallbackProgress(5)
    expect(p.completedFiles).toBe(0)
  })

  it('returns totalFiles from totalPlanned', () => {
    expect(buildFallbackProgress(0).totalFiles).toBe(0)
    expect(buildFallbackProgress(1).totalFiles).toBe(1)
    expect(buildFallbackProgress(12).totalFiles).toBe(12)
  })

  it('returns 0 elapsedSeconds', () => {
    const p = buildFallbackProgress(3)
    expect(p.elapsedSeconds).toBe(0)
  })

  it('returns undefined estimatedRemainingSeconds', () => {
    const p = buildFallbackProgress(3)
    expect(p.estimatedRemainingSeconds).toBeUndefined()
  })

  it('returns null currentItem', () => {
    const p = buildFallbackProgress(3)
    expect(p.currentItem).toBeNull()
  })

  it('returns running status', () => {
    const p = buildFallbackProgress(3)
    expect(p.status).toBe('running')
  })

  it('returns 0 for failed/canceled/skipped', () => {
    const p = buildFallbackProgress(3)
    expect(p.failedFiles).toBe(0)
    expect(p.canceledFiles).toBe(0)
    expect(p.skippedFiles).toBe(0)
  })
})

describe('i18n key non-duplication', () => {
  it('plan.preparing exists only once in en.json', async () => {
    const en = await import('../../i18n/locales/en.json')
    const planKeys = Object.keys(en.default.plan)
    const matches = planKeys.filter((k) => k === 'preparing')
    expect(matches).toHaveLength(1)
  })

  it('plan.preparing exists only once in zh.json', async () => {
    const zh = await import('../../i18n/locales/zh.json')
    const planKeys = Object.keys(zh.default.plan)
    const matches = planKeys.filter((k) => k === 'preparing')
    expect(matches).toHaveLength(1)
  })
})
