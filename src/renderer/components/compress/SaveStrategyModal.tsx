import { useTranslation } from 'react-i18next'

type SaveStrategyType = 'replace_original' | 'save_as'

interface Props {
  visible: boolean
  onSelect: (type: SaveStrategyType) => void
  onCancel: () => void
}

export default function SaveStrategyModal({ visible, onSelect, onCancel }: Props) {
  const { t } = useTranslation()

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-topbar-border bg-sidebar-bg p-6 shadow-2xl">
        <h2 className="mb-2 text-lg font-semibold text-sidebar-text">
          {t('saveStrategy.title')}
        </h2>
        <p className="mb-6 text-sm text-sidebar-text/70">
          {t('saveStrategy.description')}
        </p>

        <div className="mb-6 space-y-3">
          <button
            onClick={() => onSelect('replace_original')}
            className="w-full rounded-lg border border-topbar-border bg-sidebar-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
          >
            <p className="text-sm font-medium text-sidebar-text">
              {t('saveStrategy.replaceOriginal')}
            </p>
            <p className="mt-1 text-xs text-sidebar-text/60">
              {t('saveStrategy.replaceDesc')}
            </p>
          </button>

          <button
            onClick={() => onSelect('save_as')}
            className="w-full rounded-lg border border-topbar-border bg-sidebar-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
          >
            <p className="text-sm font-medium text-sidebar-text">
              {t('saveStrategy.saveAs')}
            </p>
            <p className="mt-1 text-xs text-sidebar-text/60">
              {t('saveStrategy.saveAsDesc')}
            </p>
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-yellow-500/10 p-3">
          <p className="text-xs text-yellow-400">
            {t('saveStrategy.warning')}
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-topbar-border px-4 py-2 text-sm text-sidebar-text transition-colors hover:bg-topbar-border/30"
          >
            {t('saveStrategy.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
