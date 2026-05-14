import { useTranslation } from 'react-i18next'
import type { VideoShrinkAdvice } from '../../modules/smart-shrink/types'

const ACTION_COLORS: Record<string, string> = {
  compress: 'text-accent',
  skip: 'text-sidebar-muted/50',
  confirm: 'text-yellow-400'
}

const RISK_COLORS: Record<string, string> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-red-400',
  unknown: 'text-gray-400'
}

interface Props {
  advice: VideoShrinkAdvice
}

export default function VideoAdviceBadge({ advice }: Props) {
  const { t } = useTranslation()
  const actionKey = `smartShrink.badge.${advice.action}` as const

  // Show up to 2 reason codes
  const reasonKeys = advice.reasonCodes.slice(0, 2).map((rc) => {
    const camel = rc.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    return `smartShrink.reason.${camel}`
  })

  return (
    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] leading-tight">
      <span className={`font-medium ${ACTION_COLORS[advice.action]}`}>
        {t(actionKey)}
      </span>
      <span className="text-sidebar-muted/30">·</span>
      <span className={`${RISK_COLORS[advice.qualityRisk]}`}>
        {t(`smartShrink.risk.${advice.qualityRisk}`)}
      </span>
      <span className="text-sidebar-muted/30">·</span>
      <span className="text-sidebar-muted">
        {advice.estimatedSaving.minPercent}%–{advice.estimatedSaving.maxPercent}%
      </span>
      {reasonKeys.length > 0 && (
        <>
          <span className="text-sidebar-muted/30">·</span>
          <span className="text-sidebar-muted/50 truncate">
            {reasonKeys.map((key) => t(key)).join(' / ')}
          </span>
        </>
      )}
    </div>
  )
}
