import { useTranslation } from 'react-i18next'

interface Props {
  visible: boolean
  targetSizeMB: number | null
  onChange: (value: number | null) => void
  accuracy: 'fast' | 'accurate'
  onAccuracyChange: (a: 'fast' | 'accurate') => void
}

export default function TargetSizePanel({ visible, targetSizeMB, onChange, accuracy, onAccuracyChange }: Props) {
  const { t } = useTranslation()

  if (!visible) return null

  return (
    <div className="rounded-lg border border-topbar-border bg-sidebar-bg p-3 space-y-3">
      <label className="block text-sm font-semibold text-sidebar-text">
        {t('plan.targetSize')}
      </label>

      {/* Accuracy toggle */}
      <div>
        <label className="mb-1.5 block text-xs text-sidebar-muted">{t('plan.accuracy')}</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onAccuracyChange('fast')}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
              accuracy === 'fast'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-topbar-border bg-workspace-bg text-sidebar-muted hover:border-sidebar-active'
            }`}
          >
            <span className="block font-medium">{t('plan.accuracyFast')}</span>
            <span className="block mt-0.5 opacity-70">{t('plan.accuracyFastDesc')}</span>
          </button>
          <button
            type="button"
            onClick={() => onAccuracyChange('accurate')}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
              accuracy === 'accurate'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-topbar-border bg-workspace-bg text-sidebar-muted hover:border-sidebar-active'
            }`}
          >
            <span className="block font-medium">{t('plan.accuracyAccurate')}</span>
            <span className="block mt-0.5 opacity-70">{t('plan.accuracyAccurateDesc')}</span>
          </button>
        </div>
      </div>

      {/* Size input */}
      <input
        type="number"
        min={1}
        step={1}
        value={targetSizeMB ?? ''}
        onChange={(e) => {
          const val = e.target.value ? Number(e.target.value) : null
          onChange(val && val > 0 ? val : null)
        }}
        placeholder={t('plan.targetSizePlaceholder')}
        className="w-full rounded border border-topbar-border bg-workspace-bg px-3 py-2 text-sm text-sidebar-text outline-none focus:border-accent"
      />
    </div>
  )
}
