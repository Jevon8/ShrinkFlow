import { useTranslation } from 'react-i18next'

const modes = [
  { key: 'compatible_high_quality', labelKey: 'mode.compatibleHighQuality', descKey: 'plan.compatibleHighQualityDesc' },
  { key: 'balanced', labelKey: 'mode.balanced', descKey: 'plan.balancedDesc' },
  { key: 'quality_first', labelKey: 'mode.qualityFirst', descKey: 'plan.qualityFirstDesc' },
  { key: 'heavy_balanced', labelKey: 'mode.heavyBalanced', descKey: 'plan.heavyBalancedDesc' },
  { key: 'smallest_size', labelKey: 'mode.smallestSize', descKey: 'plan.smallestSizeDesc' },
  { key: 'target_size_fast', labelKey: 'mode.targetSizeFast', descKey: 'plan.targetSizeFastDesc' }
] as const

interface Props {
  selected: string
  onSelect: (mode: string) => void
}

export default function CompressionModeCards({ selected, onSelect }: Props) {
  const { t } = useTranslation()

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-sidebar-text">{t('plan.selectMode')}</h3>
      <div className="grid grid-cols-2 gap-2">
        {modes.map((m) => (
          <button
            key={m.key}
            onClick={() => onSelect(m.key)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              selected === m.key
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-topbar-border bg-sidebar-bg text-sidebar-text hover:border-sidebar-active'
            }`}
          >
            <p className="text-sm font-medium">{t(m.labelKey)}</p>
            <p className="mt-0.5 text-xs opacity-70">{t(m.descKey)}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
