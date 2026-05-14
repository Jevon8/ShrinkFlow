import { useTranslation } from 'react-i18next'
import { formatElapsed, formatRemaining, formatEta, getPhaseLabel, buildFallbackProgress } from './progress-format'

interface Props {
  progress: QueueProgress | null
  queueStatus: QueueStatus
  skippedCount: number
  totalPlanned: number
  visible: boolean
  queueStarted: boolean
}

const statusColors: Record<string, string> = {
  running: 'text-accent',
  completed: 'text-success',
  partial_failed: 'text-warning',
  failed: 'text-error',
  canceled: 'text-orange-400',
  idle: 'text-sidebar-muted'
}

const statusKeys: Record<string, string> = {
  running: 'plan.queueRunning',
  completed: 'plan.queueComplete',
  partial_failed: 'plan.queuePartialFailed',
  failed: 'plan.queueFailed',
  canceled: 'plan.queueCanceled',
  idle: ''
}

export default function OverallProgress({ progress, queueStatus, skippedCount, totalPlanned, visible, queueStarted }: Props) {
  const { t } = useTranslation()

  if (!visible && !queueStarted) return null

  const isFallback = !progress && queueStarted
  const effectiveProgress = progress ?? buildFallbackProgress(totalPlanned)
  const effectiveStatus: QueueStatus = progress ? queueStatus : 'running'

  console.log(`[OverallProgress] render visible=${visible} queueStarted=${queueStarted} progress=${progress ? 'yes' : 'null'} fallback=${isFallback} status=${effectiveStatus}`)

  const { overallPercent, totalFiles, completedFiles, failedFiles, canceledFiles, skippedFiles, currentItem, elapsedSeconds, estimatedRemainingSeconds } = effectiveProgress
  const isTerminal = effectiveStatus === 'completed' || effectiveStatus === 'partial_failed' || effectiveStatus === 'failed' || effectiveStatus === 'canceled'
  const currentIndex = completedFiles + failedFiles + canceledFiles + (currentItem ? 1 : 0)

  return (
    <div data-testid="overall-progress-panel" className="rounded-lg border border-topbar-border bg-sidebar-bg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-accent">{t('plan.overallProgress')}</p>
        <span className={`text-xs font-medium ${statusColors[effectiveStatus] || 'text-sidebar-muted'}`}>
          {statusKeys[effectiveStatus] ? t(statusKeys[effectiveStatus]) : (!progress && queueStarted ? t('plan.preparing') : '')}
        </span>
      </div>

      {/* Overall percent + progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-lg font-bold text-sidebar-text">{overallPercent.toFixed(1)}%</span>
          <span className="text-xs text-sidebar-muted">
            {completedFiles} / {totalFiles} {t('plan.completedFiles').toLowerCase()}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-sidebar-bg">
          <div
            className={`h-full transition-all duration-500 ${
              effectiveStatus === 'completed' ? 'bg-success' :
              effectiveStatus === 'failed' ? 'bg-error' :
              effectiveStatus === 'canceled' ? 'bg-orange-400' :
              'bg-accent'
            }`}
            style={{ width: `${Math.min(overallPercent, 100)}%` }}
          />
        </div>
      </div>

      {/* Overall time info */}
      <div className="flex items-center gap-4 text-xs text-sidebar-text">
        {elapsedSeconds !== undefined && elapsedSeconds > 0 && (
          <div>
            <span className="text-sidebar-muted">{t('plan.elapsed')}: </span>
            {formatElapsed(elapsedSeconds)}
          </div>
        )}
        {!isTerminal && estimatedRemainingSeconds !== undefined && estimatedRemainingSeconds > 0 && (
          <div>
            <span className="text-sidebar-muted">{t('plan.estimatedRemaining')}: </span>
            {formatEta(estimatedRemainingSeconds)}
          </div>
        )}
        {!isTerminal && (overallPercent < 5 || estimatedRemainingSeconds === undefined || estimatedRemainingSeconds <= 0) && (
          <div>
            <span className="text-sidebar-muted">{t('plan.estimatedRemaining')}: </span>
            {t('plan.estimating')}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3 text-xs">
        <div className="rounded bg-sidebar-bg/50 p-2 text-center">
          <p className="text-sidebar-muted">{t('plan.totalFiles')}</p>
          <p className="mt-0.5 text-sm font-semibold text-sidebar-text">{totalFiles}</p>
        </div>
        <div className="rounded bg-sidebar-bg/50 p-2 text-center">
          <p className="text-sidebar-muted">{t('plan.completedFiles')}</p>
          <p className="mt-0.5 text-sm font-semibold text-success">{completedFiles}</p>
        </div>
        <div className="rounded bg-sidebar-bg/50 p-2 text-center">
          <p className="text-sidebar-muted">{t('plan.failedFiles')}</p>
          <p className="mt-0.5 text-sm font-semibold text-error">{failedFiles}</p>
        </div>
        <div className="rounded bg-sidebar-bg/50 p-2 text-center">
          <p className="text-sidebar-muted">{t('plan.skippedFiles')}</p>
          <p className="mt-0.5 text-sm font-semibold text-warning">{skippedFiles ?? skippedCount}</p>
        </div>
      </div>

      {/* Current file detail panel */}
      {currentItem && !isTerminal && (
        <div className="rounded-lg border border-topbar-border bg-workspace-bg p-3 space-y-2">
          {/* File name + phase + speed */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-sidebar-muted">{t('plan.currentVideo')} #{currentIndex}/{totalFiles}</span>
              <span className="text-sm font-medium text-accent truncate">{currentItem.fileName}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {currentItem.phase && currentItem.phase !== 'single' && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">
                  {getPhaseLabel(currentItem.phase, t)}
                </span>
              )}
              {currentItem.speed && currentItem.speed !== '--' && (
                <span className="text-xs text-sidebar-muted">{currentItem.speed}</span>
              )}
            </div>
          </div>

          {/* Current file progress bar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-sidebar-muted">{t('compress.currentProgress')}</span>
              <span className="text-xs font-medium text-accent">{currentItem.percent.toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-sidebar-bg">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${Math.min(currentItem.percent, 100)}%` }}
              />
            </div>
          </div>

          {/* Current file time info */}
          <div className="flex items-center gap-4 text-xs text-sidebar-text">
            <div>
              <span className="text-sidebar-muted">{t('plan.elapsed')}: </span>
              {formatElapsed(currentItem.elapsedSeconds)}
            </div>
            <div>
              <span className="text-sidebar-muted">{t('plan.remaining')}: </span>
              {currentItem.remainingSeconds >= 0
                ? formatRemaining(currentItem.remainingSeconds)
                : t('compress.calculating')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
