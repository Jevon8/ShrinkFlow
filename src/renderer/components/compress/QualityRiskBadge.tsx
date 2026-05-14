import { useTranslation } from 'react-i18next'
import type { QualityRisk } from '../../modules/smart-shrink/types'

const RISK_COLORS: Record<QualityRisk, string> = {
  low: 'bg-green-500/20 text-green-400 border-green-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
}

interface Props {
  risk: QualityRisk
}

export default function QualityRiskBadge({ risk }: Props) {
  const { t } = useTranslation()
  const riskKey = `smartShrink.risk.${risk}` as const
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${RISK_COLORS[risk]}`}>
      {t(riskKey)}
    </span>
  )
}
