export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm.toString().padStart(2, '0')}m`
}

export function formatRemaining(seconds: number): string {
  if (seconds < 0) return ''
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm.toString().padStart(2, '0')}m`
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `~${m}m ${s.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `~${h}h ${rm.toString().padStart(2, '0')}m`
}

export function getPhaseLabel(phase: string | undefined, t: (key: string) => string): string {
  if (!phase || phase === 'single') return t('compress.compressing')
  if (phase === 'two_pass_analyze') return t('compress.twoPassAnalyze')
  if (phase === 'two_pass_encode') return t('compress.twoPassEncode')
  return t('compress.compressing')
}

export function buildFallbackProgress(totalPlanned: number): QueueProgress {
  return {
    status: 'running',
    currentItem: null,
    overallPercent: 0,
    totalFiles: totalPlanned,
    completedFiles: 0,
    failedFiles: 0,
    canceledFiles: 0,
    skippedFiles: 0,
    elapsedSeconds: 0,
    estimatedRemainingSeconds: undefined
  }
}
