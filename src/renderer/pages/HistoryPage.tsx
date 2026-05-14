import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '../utils/formatBytes'
import { formatElapsedTime } from '../utils/formatElapsedTime'

const statusColors: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-400',
  partial_failed: 'bg-yellow-500/20 text-yellow-400',
  failed: 'bg-red-500/20 text-red-400',
  canceled: 'bg-orange-500/20 text-orange-400',
  skipped: 'bg-yellow-500/20 text-yellow-400'
}

const statusKeys: Record<string, string> = {
  completed: 'plan.queueComplete',
  partial_failed: 'plan.queuePartialFailed',
  failed: 'plan.queueFailed',
  canceled: 'plan.queueCanceled',
  skipped: 'status.skipped'
}

const modeKeys: Record<string, string> = {
  balanced: 'mode.balanced',
  quality_first: 'mode.qualityFirst',
  smallest_size: 'mode.smallestSize',
  target_size_fast: 'mode.targetSizeFast',
  target_size_accurate: 'mode.targetSizeAccurate',
  compatible_high_quality: 'mode.compatibleHighQuality',
  heavy_balanced: 'mode.heavyBalanced'
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function HistoryPage() {
  const { t } = useTranslation()
  const [records, setRecords] = useState<HistoryRecord[]>([])
  const [selected, setSelected] = useState<HistoryRecord | null>(null)

  const loadHistory = useCallback(() => {
    window.api.getHistory().then(setRecords).catch(() => {})
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('history.confirmDelete'))) return
    try {
      await window.api.deleteHistory(id)
      setRecords((prev) => prev.filter((r) => r.id !== id))
      if (selected?.id === id) setSelected(null)
    } catch (err) {
      console.error('Failed to delete history record:', err)
    }
  }

  const handleOpenFolder = (folderPath: string) => {
    window.api.openOutputFolder(folderPath)
  }

  const [exporting, setExporting] = useState(false)

  const handleExportJSON = async () => {
    setExporting(true)
    try {
      const result = await window.api.exportHistoryJSON()
      if (result.ok) {
        alert(t('history.exportSuccess'))
      } else if (!result.canceled) {
        alert(t('history.exportFailed') + (result.error ? `: ${result.error}` : ''))
      }
    } catch {
      alert(t('history.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      const result = await window.api.exportHistoryCSV()
      if (result.ok) {
        alert(t('history.exportSuccess'))
      } else if (!result.canceled) {
        alert(t('history.exportFailed') + (result.error ? `: ${result.error}` : ''))
      }
    } catch {
      alert(t('history.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('history.title')}</h2>
        {records.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={handleExportJSON}
              disabled={exporting}
              className="rounded-lg border border-topbar-border bg-sidebar-bg px-3 py-1.5 text-sm text-sidebar-text hover:bg-topbar-bg disabled:opacity-50"
            >
              {t('history.exportJSON')}
            </button>
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="rounded-lg border border-topbar-border bg-sidebar-bg px-3 py-1.5 text-sm text-sidebar-text hover:bg-topbar-bg disabled:opacity-50"
            >
              {t('history.exportCSV')}
            </button>
          </div>
        )}
      </div>

      {records.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <svg
              className="h-12 w-12 text-sidebar-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
              />
            </svg>
            <div>
              <p className="text-lg font-medium text-sidebar-text">{t('history.empty')}</p>
              <p className="mt-1 text-sm text-sidebar-muted">{t('history.emptyDesc')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* History list */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {records.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelected(r)}
                className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                  selected?.id === r.id
                    ? 'border-accent bg-accent/10'
                    : 'border-sidebar-active bg-sidebar-bg hover:border-sidebar-hover'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-sidebar-muted">{formatDate(r.createdAt)}</span>
                  <span className={`rounded px-2 py-0.5 text-xs ${statusColors[r.status] || ''}`}>
                    {t(statusKeys[r.status] || 'status.failed')}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-sidebar-text">
                  <span>{r.totalFiles} {t('compress.videos')}</span>
                  <span className="text-emerald-400">{r.savedPercent}% {t('plan.saved')}</span>
                  <span>{t(modeKeys[r.mode] || 'mode.balanced')}</span>
                  <span>{t('history.elapsedTime')}: {formatElapsedTime(r.totalElapsedSeconds)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="w-80 overflow-y-auto rounded-lg border border-sidebar-active bg-sidebar-bg p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-sidebar-text">{t('history.details')}</h3>
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs text-sidebar-muted hover:text-sidebar-text"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <DetailRow label={t('compress.status')}>
                  <span className={`rounded px-1.5 py-0.5 ${statusColors[selected.status] || ''}`}>
                    {t(statusKeys[selected.status] || 'status.failed')}
                  </span>
                </DetailRow>
                <DetailRow label={t('plan.totalFiles')}>{selected.totalFiles}</DetailRow>
                <DetailRow label={t('plan.completedFiles')}>{selected.successCount}</DetailRow>
                <DetailRow label={t('plan.failedFiles')}>{selected.failedCount}</DetailRow>
                {selected.skippedCount !== undefined && selected.skippedCount > 0 && (
                  <DetailRow label={t('plan.skippedFiles')}>
                    <span className="text-yellow-400">{selected.skippedCount}</span>
                  </DetailRow>
                )}
                <DetailRow label={t('plan.originalTotalSize')}>{formatBytes(selected.originalTotalSize)}</DetailRow>
                <DetailRow label={t('plan.outputTotalSize')}>{formatBytes(selected.outputTotalSize)}</DetailRow>
                <DetailRow label={t('plan.totalSaved')}>
                  <span className="text-emerald-400">{formatBytes(selected.savedSize)}</span>
                </DetailRow>
                <DetailRow label={t('plan.totalSavedPercent')}>
                  <span className="text-emerald-400">{selected.savedPercent}%</span>
                </DetailRow>
                <DetailRow label={t('history.totalElapsedTime')}>{formatElapsedTime(selected.totalElapsedSeconds)}</DetailRow>
                <DetailRow label={t('plan.selectMode')}>{t(modeKeys[selected.mode] || 'mode.balanced')}</DetailRow>
                <DetailRow label={t('plan.outputDir')}>
                  <span className="truncate">{selected.outputDir || '--'}</span>
                </DetailRow>
              </div>

              {/* Smart Shrink Plan Summary */}
              {selected.shrinkPlanSummary && (
                <div className="mt-3 space-y-1 text-xs">
                  <p className="font-semibold text-sidebar-text">{t('smartShrink.title')}</p>
                  <DetailRow label={t('smartShrink.summary.goalLabel')}>
                    {selected.shrinkPlanSummary.goalId === 'light_30' ? t('smartShrink.goal.light.name') :
                     selected.shrinkPlanSummary.goalId === 'balanced_50' ? t('smartShrink.goal.balanced.name') :
                     selected.shrinkPlanSummary.goalId === 'deep_70' ? t('smartShrink.goal.deep.name') :
                     selected.shrinkPlanSummary.goalId}
                  </DetailRow>
                  <DetailRow label={t('smartShrink.summary.compressCount')}>{selected.shrinkPlanSummary.compressCount}</DetailRow>
                  <DetailRow label={t('smartShrink.summary.skipCount')}>{selected.shrinkPlanSummary.skipCount}</DetailRow>
                  <DetailRow label={t('smartShrink.summary.confirmCount')}>{selected.shrinkPlanSummary.confirmCount}</DetailRow>
                  <DetailRow label={t('smartShrink.summary.highRiskCount')}>
                    <span className="text-red-400">{selected.shrinkPlanSummary.highRiskCount}</span>
                  </DetailRow>
                  {selected.shrinkPlanSummary.estimatedSavingBytesMin != null && selected.shrinkPlanSummary.estimatedSavingBytesMax != null && (
                    <DetailRow label={t('smartShrink.summary.estimatedSaving')}>
                      {formatBytes(selected.shrinkPlanSummary.estimatedSavingBytesMin)} – {formatBytes(selected.shrinkPlanSummary.estimatedSavingBytesMax)}
                    </DetailRow>
                  )}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                {selected.outputDir && (
                  <button
                    onClick={() => handleOpenFolder(selected.outputDir)}
                    className="flex-1 rounded-lg border border-sidebar-active px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors"
                  >
                    {t('history.openFolder')}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(selected.id)}
                  className="flex-1 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  {t('history.delete')}
                </button>
              </div>

              {selected.results && selected.results.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
                    {t('history.perFileTime')}
                  </h4>
                  {(() => {
                    const uniqueModes = new Set(selected.results.map(r => r.mode).filter(Boolean))
                    return uniqueModes.size > 1 ? (
                      <div className="mb-2 text-[11px] text-accent/80">{t('history.mixedModeNotice')}</div>
                    ) : null
                  })()}
                  <div className="space-y-1.5">
                    {selected.results.map((item) => (
                      <div key={item.videoId} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sidebar-text" title={item.fileName}>{item.fileName}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {item.mode && (
                              <span className="text-[11px] text-accent/60">
                                {t(modeKeys[item.mode] || 'mode.balanced')}
                              </span>
                            )}
                            <span className={`rounded px-1.5 py-0.5 ${statusColors[item.status] || ''}`}>
                              {t(statusKeys[item.status] || 'status.failed')}
                            </span>
                            <span className="text-sidebar-muted">{formatElapsedTime(item.compressionElapsedSeconds)}</span>
                          </div>
                        </div>
                        {/* Size deviation info for target_size modes */}
                        {item.targetSizeMB != null && item.actualSizeMB != null && (
                          <div className="mt-1 flex items-center gap-3 text-sidebar-muted pl-1">
                            <span>{t('plan.targetSizeLabel')}: {item.targetSizeMB.toFixed(1)} MB</span>
                            <span>{t('plan.actualSizeLabel')}: {item.actualSizeMB.toFixed(1)} MB</span>
                            {item.sizeErrorPercent != null && (
                              <span className={item.sizeErrorPercent > 0 ? 'text-yellow-400' : 'text-emerald-400'}>
                                {t('plan.deviationLabel')}: {item.sizeErrorPercent > 0 ? '+' : ''}{item.sizeErrorPercent.toFixed(1)}%
                              </span>
                            )}
                            {item.accuracyMode && (
                              <span>{t('plan.accuracyModeLabel')}: {t(item.accuracyMode === 'accurate' ? 'plan.accuracyModeAccurate' : 'plan.accuracyModeFast')}</span>
                            )}
                          </div>
                        )}
                        {item.outputLargerThanInput && (
                          <div className="mt-1 text-[11px] text-yellow-400 pl-1">
                            {item.status === 'skipped'
                              ? t('history.originalNotReplacedOutputLarger')
                              : t('history.outputLargerThanInput')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sidebar-muted">{label}</span>
      <span className="text-sidebar-text text-right">{children}</span>
    </div>
  )
}
