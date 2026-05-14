import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ShrinkGoalId, SmartShrinkPlan } from '../../modules/smart-shrink/types'
import { formatBytes } from '../../utils/formatBytes'

interface Props {
  plan: SmartShrinkPlan | null
  selectedGoal: ShrinkGoalId
  onGoalChange: (goalId: ShrinkGoalId) => void
  onApply: () => void
  onRegenerate: () => void
  onToggleSkipped: () => void
  onResetOverrides: () => void
  showSkipped: boolean
  hasUserOverrides: boolean
  visible: boolean
  onShowConfirm?: () => void
  confirmFilterActive?: boolean
  actualConfirmCount?: number
}

const GOAL_PILLS: { id: ShrinkGoalId; labelKey: string; subtitleKey: string }[] = [
  { id: 'light_30', labelKey: 'smartShrink.goal.light.name', subtitleKey: 'smartShrink.pill.light' },
  { id: 'balanced_50', labelKey: 'smartShrink.goal.balanced.name', subtitleKey: 'smartShrink.pill.balanced' },
  { id: 'deep_70', labelKey: 'smartShrink.goal.deep.name', subtitleKey: 'smartShrink.pill.deep' }
]

export default function SmartShrinkPlanPanel({
  plan,
  selectedGoal,
  onGoalChange,
  onApply,
  onRegenerate,
  onToggleSkipped,
  onResetOverrides,
  showSkipped,
  hasUserOverrides,
  visible,
  onShowConfirm,
  confirmFilterActive,
  actualConfirmCount
}: Props) {
  const { t } = useTranslation()
  const [showDetails, setShowDetails] = useState(false)

  if (!visible) return null

  const summary = plan?.summary

  return (
    <div className="rounded-lg border border-topbar-border bg-sidebar-bg px-4 py-3 space-y-2.5">
      {/* Row 1: Title + estimate badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-sidebar-text">{t('smartShrink.title')}</h3>
          <span className="rounded bg-sidebar-hover px-1.5 py-0.5 text-[10px] text-sidebar-muted">
            {t('smartShrink.summary.estimatedSaving')}
          </span>
        </div>
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="text-[11px] text-sidebar-muted hover:text-sidebar-text transition-colors"
        >
          {showDetails ? t('smartShrink.action.hideDetails') : t('smartShrink.action.showDetails')}
        </button>
      </div>

      {/* Row 2: Goal pills */}
      <div className="flex items-center gap-1.5">
        {GOAL_PILLS.map(({ id, labelKey, subtitleKey }) => {
          const isActive = selectedGoal === id
          return (
            <button
              key={id}
              onClick={() => onGoalChange(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border border-accent/50 bg-accent/10 text-accent'
                  : 'border border-topbar-border text-sidebar-muted hover:border-sidebar-active hover:text-sidebar-text'
              }`}
            >
              <span>{t(labelKey)}</span>
              <span className={`block text-[10px] font-normal ${isActive ? 'opacity-70' : 'opacity-50'}`}>
                {t(subtitleKey)}
              </span>
            </button>
          )
        })}
        <span className="ml-1 rounded-md border border-topbar-border/50 px-3 py-1 text-xs text-sidebar-muted/40 cursor-not-allowed">
          {t('smartShrink.goal.folderBudget.name')} · {t('smartShrink.goal.folderBudget.comingSoon')}
        </span>
      </div>

      {/* Row 3: Key metrics */}
      {summary && (
        <div className="flex items-center gap-5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-sidebar-muted">{t('smartShrink.summary.estimatedSaving')}</span>
            <span className="font-medium text-success">
              {summary.estimatedSavingBytesMin != null && summary.estimatedSavingBytesMax != null
                ? `${formatBytes(summary.estimatedSavingBytesMin)} – ${formatBytes(summary.estimatedSavingBytesMax)}`
                : '--'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sidebar-muted">{t('smartShrink.summary.compressCount')}</span>
            <span className="font-medium text-accent">{summary.compressCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sidebar-muted">{t('smartShrink.summary.skipCount')}</span>
            <span className="font-medium text-sidebar-muted">{summary.skipCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sidebar-muted">{t('smartShrink.summary.confirmCount')}</span>
            {onShowConfirm ? (
              <button
                onClick={onShowConfirm}
                className={`font-medium transition-colors ${confirmFilterActive ? 'text-yellow-300 underline' : 'text-yellow-400 hover:text-yellow-300'}`}
              >
                {actualConfirmCount ?? summary.confirmCount}
              </button>
            ) : (
              <span className="font-medium text-yellow-400">{actualConfirmCount ?? summary.confirmCount}</span>
            )}
          </div>
        </div>
      )}

      {/* Row 4: Action buttons + inline disclaimer */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-sidebar-muted/50 truncate flex-1">
          {t('smartShrink.notice.estimateOnly')}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onApply}
            disabled={!plan}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-workspace-bg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('smartShrink.action.applyPlan')}
          </button>
          <button
            onClick={onRegenerate}
            className="rounded-md border border-topbar-border px-2.5 py-1 text-xs text-sidebar-muted hover:text-sidebar-text hover:bg-sidebar-hover transition-colors"
          >
            {t('smartShrink.action.regenerate')}
          </button>
          <button
            onClick={onToggleSkipped}
            className="rounded-md border border-topbar-border px-2.5 py-1 text-xs text-sidebar-muted hover:text-sidebar-hover transition-colors"
          >
            {showSkipped ? t('smartShrink.action.hideSkipped') : t('smartShrink.action.showSkipped')}
          </button>
          {(actualConfirmCount ?? summary?.confirmCount ?? 0) > 0 && onShowConfirm && (
            <button
              onClick={onShowConfirm}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                confirmFilterActive
                  ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-400'
                  : 'border-topbar-border text-sidebar-muted hover:text-sidebar-hover'
              }`}
            >
              {confirmFilterActive ? t('smartShrink.action.hideConfirm') : t('smartShrink.action.showConfirm')}
            </button>
          )}
          {hasUserOverrides && (
            <button
              onClick={onResetOverrides}
              className="rounded-md border border-warning/20 px-2.5 py-1 text-[11px] text-warning/70 hover:text-warning hover:bg-warning/5 transition-colors"
            >
              {t('smartShrink.action.resetOverrides')}
            </button>
          )}
        </div>
      </div>

      {/* Expandable details */}
      {showDetails && summary && (
        <div className="border-t border-topbar-border pt-2.5 grid grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-[10px] text-sidebar-muted">{t('smartShrink.summary.originalSize')}</p>
            <p className="font-medium text-sidebar-text">{formatBytes(summary.originalTotalBytes)}</p>
          </div>
          <div>
            <p className="text-[10px] text-sidebar-muted">{t('smartShrink.summary.estimatedOutput')}</p>
            <p className="font-medium text-sidebar-text">
              {summary.estimatedOutputBytesMin != null && summary.estimatedOutputBytesMax != null
                ? `${formatBytes(summary.estimatedOutputBytesMin)} – ${formatBytes(summary.estimatedOutputBytesMax)}`
                : '--'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-sidebar-muted">{t('smartShrink.summary.highRiskCount')}</p>
            <p className="font-medium text-red-400">{summary.highRiskCount}</p>
          </div>
          <div>
            <p className="text-[10px] text-sidebar-muted">{t('smartShrink.summary.totalVideos')}</p>
            <p className="font-medium text-sidebar-text">{summary.totalVideos}</p>
          </div>
        </div>
      )}
    </div>
  )
}
