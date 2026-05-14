export function formatElapsedTime(seconds?: number): string {
  if (seconds == null || seconds <= 0) return '--'

  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  if (h > 0) {
    return `${h} h ${pad2(m)} min ${pad2(s)} sec`
  }
  if (m > 0) {
    return `${m} min ${pad2(s)} sec`
  }
  return `${s} sec`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
