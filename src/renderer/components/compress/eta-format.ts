/**
 * Format a single duration in minutes to a human-readable string.
 * Rounds to 5-min granularity. Uses h/min units.
 */
export function formatSingle(minutes: number): string {
  const rounded = Math.round(minutes / 5) * 5
  if (rounded < 60) return `${Math.max(rounded, 1)} min`
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/**
 * Format an ETA range (min/max in seconds) to a human-readable string.
 * Rules:
 * - <15s: ~X sec
 * - <60s: <1 min
 * - 1-59 min: X min (5-min granularity)
 * - >=60 min: X h / X h Y min (5-min granularity)
 * - Ranges with same hour: compact "1 h 5–20 min"
 */
export function formatEta(minSeconds: number, maxSeconds: number): string {
  if (maxSeconds < 15) {
    return `~${Math.max(Math.round(maxSeconds / 5) * 5, 5)} sec`
  }
  if (maxSeconds < 60) {
    return '<1 min'
  }

  const minM = minSeconds / 60
  const maxM = maxSeconds / 60
  const minRounded = Math.round(minM / 5) * 5
  const maxRounded = Math.round(maxM / 5) * 5

  if (minRounded === maxRounded) {
    return formatSingle(minRounded)
  }

  const minH = Math.floor(minRounded / 60)
  const minRem = minRounded % 60
  const maxH = Math.floor(maxRounded / 60)
  const maxRem = maxRounded % 60

  // Both under 60 min
  if (minRounded < 60 && maxRounded < 60) {
    return `${minRounded}–${maxRounded} min`
  }

  // Same hour — compact form
  if (minH === maxH) {
    if (minRem === 0 && maxRem === 0) return `${minH} h`
    if (minRem === 0) return `${minH} h–${maxRem} min`
    if (maxRem === 0) return `${minH} h ${minRem} min–${minH + 1} h`
    return `${minH} h ${minRem}–${maxRem} min`
  }

  // Min under 60, max over 60
  if (minRounded < 60) {
    if (maxRem === 0) return `${minRounded} min–${maxH} h`
    return `${minRounded} min–${maxH} h ${maxRem} min`
  }

  // Both over 60, different hours
  if (minRem === 0 && maxRem === 0) return `${minH}–${maxH} h`
  const loStr = minRem === 0 ? `${minH} h` : `${minH} h ${minRem} min`
  const hiStr = maxRem === 0 ? `${maxH} h` : `${maxH} h ${maxRem} min`
  return `${loStr}–${hiStr}`
}
