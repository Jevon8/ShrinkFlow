import { useTranslation } from 'react-i18next'
import { formatEta } from './eta-format'

interface EtaResult {
  estimatedSecondsMin: number
  estimatedSecondsMax: number
  confidence: 'low' | 'medium' | 'high'
  source: 'history' | 'rule' | 'probe'
  reasons: string[]
  estimatedVideosCount: number
  ignoredVideosCount: number
  ignoredReasons: string[]
  debugBreakdown: {
    totalDurationSeconds: number
    averagePixelFactor: number
    mode: string
    speedRange?: { minSpeedX: number; maxSpeedX: number }
    selectedSpeedX?: number
    historySampleCount?: number
    probeSpeedX?: number
    formula: string
    perVideo: {
      videoIndex: number
      durationSeconds: number
      pixelFactor: number
      estimatedSecondsMin: number
      estimatedSecondsMax: number
    }[]
  }
}

interface EtaUnavailable {
  available: false
  reasons: string[]
}

type EtaData = EtaResult | EtaUnavailable | null

interface Props {
  eta: EtaData
  visible: boolean
  onQuickProbe?: () => void
  probing?: boolean
}

function isEtaUnavailable(eta: EtaData): eta is EtaUnavailable {
  return eta !== null && 'available' in eta && !eta.available
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

const confidenceColors: Record<string, string> = {
  low: 'text-red-400',
  medium: 'text-yellow-400',
  high: 'text-emerald-400'
}

const sourceKeys: Record<string, string> = {
  rule: 'plan.preEtaSourceRule',
  history: 'plan.preEtaSourceHistory',
  probe: 'plan.preEtaSourceProbe'
}

const hintKeys: Record<string, string> = {
  rule: 'plan.preEtaHintRule',
  history: 'plan.preEtaHintHistory',
  probe: 'plan.preEtaHintProbe'
}

export default function PreCompressionEta({ eta, visible, onQuickProbe, probing }: Props) {
  const { t } = useTranslation()

  if (!visible || !eta) return null

  const unavailable = isEtaUnavailable(eta)

  return (
    <div className="rounded-lg border border-topbar-border bg-workspace-bg px-4 py-3 space-y-1.5">
      {/* Estimated time */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-sidebar-muted">{t('plan.preEta')}:</span>
        {unavailable ? (
          <span className="text-sidebar-muted">{t('plan.preEtaNotAvailable')}</span>
        ) : (
          <span className="font-medium text-sidebar-text">
            {formatEta(eta.estimatedSecondsMin, eta.estimatedSecondsMax)}
          </span>
        )}
      </div>

      {!unavailable && (
        <>
          {/* Video count + total duration */}
          <div className="flex items-center gap-4 text-xs text-sidebar-muted">
            <span>{t('plan.preEtaVideos', { count: eta.estimatedVideosCount })}</span>
            <span>{t('plan.preEtaTotalDuration')}: {formatDuration(eta.debugBreakdown.totalDurationSeconds)}</span>
            {eta.ignoredVideosCount > 0 && (
              <span className="text-yellow-500/70">
                ({eta.ignoredVideosCount} {t('plan.preEtaIgnored')})
              </span>
            )}
          </div>

          {/* Confidence + Source */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-sidebar-muted">{t('plan.preEtaConfidence')}:</span>
              <span className={`font-medium ${confidenceColors[eta.confidence]}`}>
                {t(`plan.preEtaConf${eta.confidence.charAt(0).toUpperCase() + eta.confidence.slice(1)}`)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sidebar-muted">{t('plan.preEtaSource')}:</span>
              <span className="text-sidebar-text">{t(sourceKeys[eta.source])}</span>
            </div>
          </div>

          {/* Source-specific hint */}
          <p className="text-xs text-sidebar-muted">
            {t(hintKeys[eta.source])}
          </p>

          {/* Quick probe button (available for all sources) */}
          {onQuickProbe && (
            <button
              onClick={onQuickProbe}
              disabled={probing}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              {probing
                ? t('plan.preEtaProbing')
                : eta.source === 'rule'
                  ? t('plan.preEtaRunProbe')
                  : t('plan.preEtaReProbe')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
