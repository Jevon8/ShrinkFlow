import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConflictItem {
  videoId: string
  fileName: string
  inputPath: string
  outputPath: string
  conflictType: 'same_as_input' | 'existing_output_file'
}

interface Props {
  visible: boolean
  conflicts: ConflictItem[]
  onResolve: (resolution: 'overwrite' | 'rename' | 'skip', applyToAll: boolean) => void
  onCancel: () => void
}

export default function ConflictResolutionModal({ visible, conflicts, onResolve, onCancel }: Props) {
  const { t } = useTranslation()
  const [applyToAll, setApplyToAll] = useState(false)

  if (!visible || conflicts.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-topbar-border bg-sidebar-bg p-6 shadow-2xl">
        <h2 className="mb-2 text-lg font-semibold text-sidebar-text">
          {t('conflict.title')}
        </h2>
        <p className="mb-4 text-sm text-sidebar-text/70">
          {t('conflict.description')}
        </p>

        {/* Conflict list */}
        <div className="mb-4 max-h-48 space-y-2 overflow-y-auto rounded-lg border border-topbar-border bg-workspace-bg p-3">
          {conflicts.map((c, i) => (
            <div key={`${c.videoId}-${i}`} className="rounded-lg bg-sidebar-bg p-3">
              <p className="text-sm font-medium text-sidebar-text">{c.fileName}</p>
              <p className="mt-1 text-xs text-sidebar-muted truncate" title={c.outputPath}>
                {c.outputPath}
              </p>
              <p className="mt-1 text-xs text-yellow-400">
                {c.conflictType === 'same_as_input'
                  ? t('conflict.sameAsInput')
                  : t('conflict.existingFile')}
              </p>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="mb-4 space-y-3">
          <button
            onClick={() => onResolve('overwrite', applyToAll)}
            className="w-full rounded-lg border border-topbar-border bg-sidebar-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
          >
            <p className="text-sm font-medium text-sidebar-text">
              {t('conflict.overwrite')}
            </p>
            <p className="mt-1 text-xs text-sidebar-text/60">
              {t('conflict.overwriteDesc')}
            </p>
          </button>

          <button
            onClick={() => onResolve('rename', applyToAll)}
            className="w-full rounded-lg border border-topbar-border bg-sidebar-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
          >
            <p className="text-sm font-medium text-sidebar-text">
              {t('conflict.rename')}
            </p>
            <p className="mt-1 text-xs text-sidebar-text/60">
              {t('conflict.renameDesc')}
            </p>
          </button>

          <button
            onClick={() => onResolve('skip', applyToAll)}
            className="w-full rounded-lg border border-topbar-border bg-sidebar-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent/5"
          >
            <p className="text-sm font-medium text-sidebar-text">
              {t('conflict.skip')}
            </p>
            <p className="mt-1 text-xs text-sidebar-text/60">
              {t('conflict.skipDesc')}
            </p>
          </button>
        </div>

        {/* Apply to all checkbox */}
        {conflicts.length > 1 && (
          <label className="mb-4 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="h-4 w-4 rounded border-topbar-border bg-sidebar-bg text-accent focus:ring-accent"
            />
            <span className="text-sm text-sidebar-text">
              {t('conflict.applyToAll', { count: conflicts.length })}
            </span>
          </label>
        )}

        {/* Warning */}
        <div className="mb-4 rounded-lg bg-yellow-500/10 p-3">
          <p className="text-xs text-yellow-400">
            {t('conflict.warning')}
          </p>
        </div>

        {/* Cancel button */}
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="rounded-lg border border-topbar-border px-4 py-2 text-sm text-sidebar-text transition-colors hover:bg-topbar-border/30"
          >
            {t('conflict.cancelTask')}
          </button>
        </div>
      </div>
    </div>
  )
}
