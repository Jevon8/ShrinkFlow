import { useTranslation } from 'react-i18next'

interface Props {
  outputDir: string | null
}

export default function OutputSettingsPanel({ outputDir }: Props) {
  const { t } = useTranslation()

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-sidebar-text">{t('plan.outputSettings')}</h3>
      <div className="flex items-center gap-2">
        <span className="text-xs text-sidebar-muted">{t('plan.outputDir')}:</span>
        <span className="text-xs text-sidebar-text truncate">
          {outputDir || t('plan.defaultOutputDir')}
        </span>
      </div>
    </div>
  )
}
