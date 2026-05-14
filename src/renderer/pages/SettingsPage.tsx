import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BUILD_INFO } from '../../shared/build-info'
import { formatBytes } from '../utils/formatBytes'
import { useVideoStore } from '../stores/videoStore'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegAvailability | null>(null)
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null)
  const [benchmarks, setBenchmarks] = useState<CompressionBenchmark[]>([])
  const [ffmpegInfo, setFfmpegInfo] = useState<FFmpegInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState<FFmpegUpdateProgress | null>(null)
  const [showPath, setShowPath] = useState(false)
  const [ffmpegError, setFfmpegError] = useState<string | null>(null)
  const [ffmpegSuccess, setFfmpegSuccess] = useState<string | null>(null)
  const [isCheckingFFmpeg, setIsCheckingFFmpeg] = useState(false)
  const [updatePrompt, setUpdatePrompt] = useState<{
    latest: FFmpegUpdateCheckLatest
    currentInfo: FFmpegInfo
    reason?: string
  } | null>(null)
  const isCompressing = useVideoStore((s) => s.queueStatus === 'running')

  useEffect(() => {
    window.api.getSettings().then(setSettings).catch(() => {})
    window.api.checkFfmpegAvailability().then(setFfmpegStatus).catch(() => {})
    window.api.getDeviceProfile().then(setDeviceProfile).catch(() => {})
    window.api.getBenchmarks().then(setBenchmarks).catch(() => {})
    window.api.getFFmpegInfo().then(setFfmpegInfo).catch(() => {})
    const unsub = window.api.onFFmpegUpdateProgress(setUpdateProgress)
    return unsub
  }, [])

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('shrinkflow-lang', lang)
    window.api.setLanguage(lang)
  }

  const handleSave = async (partial: Partial<AppSettings>) => {
    const updated = await window.api.saveSettings(partial)
    setSettings(updated)
  }

  const handleChooseOutputDir = async () => {
    const result = await window.api.selectFolder()
    if (!result.canceled && result.filePaths[0]) {
      handleSave({ defaultOutputDir: result.filePaths[0] })
    }
  }

  const avgSpeed = benchmarks.length > 0
    ? benchmarks.reduce((sum, b) => sum + b.speedMultiplier, 0) / benchmarks.length
    : 0

  const handleClearBenchmarks = async () => {
    for (const b of benchmarks) {
      await window.api.deleteBenchmark(b.id)
    }
    setBenchmarks([])
  }

  const isUpdating = updateProgress?.status === 'downloading'
    || updateProgress?.status === 'extracting'
    || updateProgress?.status === 'verifying'
    || updateProgress?.status === 'checking'
  const disableUpdate = isCompressing || isUpdating
  const disableRemove = isCompressing || isUpdating

  const handleCheckFFmpeg = async () => {
    setFfmpegError(null)
    setFfmpegSuccess(null)
    setUpdatePrompt(null)
    setIsCheckingFFmpeg(true)
    try {
      const result = await window.api.checkFFmpegUpdate()
      if (!result.ok) {
        if (result.currentInfo) setFfmpegInfo(result.currentInfo)
        setFfmpegError(result.errorMessage)
        return
      }
      setFfmpegInfo(result.currentInfo)
      if (result.isLatest) {
        setFfmpegSuccess(t('settings.ffmpegAlreadyLatest'))
        setUpdatePrompt(null)
      } else {
        setUpdatePrompt({
          latest: result.latest,
          currentInfo: result.currentInfo,
          reason: result.reason
        })
        setFfmpegSuccess(t('settings.ffmpegUpdateAvailable'))
      }
    } catch {
      setFfmpegError(t('settings.ffmpegCheckUpdateFailed'))
    } finally {
      setIsCheckingFFmpeg(false)
    }
  }

  const handleUpdateFFmpeg = async () => {
    setFfmpegError(null)
    setFfmpegSuccess(null)
    try {
      const result = await window.api.updateFFmpeg()
      if (result.ok) {
        setFfmpegInfo(result.info)
        setUpdatePrompt(null)
        if (result.alreadyUpToDate) {
          setFfmpegSuccess(t('settings.ffmpegAlreadyLatest'))
          setUpdateProgress(null)
        } else {
          setFfmpegSuccess(t('settings.ffmpegUpdateSuccess'))
        }
      } else {
        setFfmpegError(result.errorMessage)
      }
    } catch {
      setFfmpegError(t('settings.ffmpegUpdateFailed'))
    }
  }

  const handleOpenFFmpegFolder = async () => {
    const result = await window.api.openFFmpegFolder()
    if (!result.ok) {
      setFfmpegError(result.errorMessage)
    }
  }

  const handleRemoveUpdated = async () => {
    setFfmpegError(null)
    setFfmpegSuccess(null)
    try {
      const result = await window.api.removeUpdatedFFmpeg()
      if (result.ok) {
        setFfmpegInfo(result.info)
        setFfmpegSuccess(t('settings.ffmpegRevertedBundled'))
      } else {
        setFfmpegError(result.errorMessage)
      }
    } catch {
      setFfmpegError(t('settings.ffmpegRemoveUpdateFailed'))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-6 text-2xl font-bold">{t('settings.title')}</h2>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <section className="rounded-xl bg-sidebar-bg p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sidebar-muted">
            {t('settings.general')}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-sidebar-text">{t('settings.language')}</p>
                <p className="text-xs text-sidebar-muted">{t('settings.languageDesc')}</p>
              </div>
              <select
                value={i18n.language}
                onChange={(e) => handleLanguageChange(e.target.value)}
                className="rounded-lg border border-sidebar-active bg-workspace-bg px-3 py-1.5 text-xs text-sidebar-text outline-none"
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-sidebar-text">{t('settings.defaultOutputDir')}</p>
                <p className="text-xs text-sidebar-muted">{t('settings.defaultOutputDirDesc')}</p>
              </div>
              <div className="flex items-center gap-2">
                {settings?.defaultOutputDir && (
                  <span className="max-w-[200px] truncate text-xs text-sidebar-muted">
                    {settings.defaultOutputDir}
                  </span>
                )}
                <button
                  onClick={handleChooseOutputDir}
                  className="rounded-lg border border-sidebar-active px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors"
                >
                  {t('settings.choose')}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-sidebar-text">{t('settings.defaultMode')}</p>
                <p className="text-xs text-sidebar-muted">{t('settings.defaultModeDesc')}</p>
              </div>
              <select
                value={settings?.defaultCompressionMode || 'compatible_high_quality'}
                onChange={(e) => handleSave({ defaultCompressionMode: e.target.value as AppSettings['defaultCompressionMode'] })}
                className="rounded-lg border border-sidebar-active bg-workspace-bg px-3 py-1.5 text-xs text-sidebar-text outline-none"
              >
                <option value="compatible_high_quality">{t('mode.compatibleHighQuality')}</option>
                <option value="balanced">{t('mode.balanced')}</option>
                <option value="quality_first">{t('mode.qualityFirst')}</option>
                <option value="heavy_balanced">{t('mode.heavyBalanced')}</option>
                <option value="smallest_size">{t('mode.smallestSize')}</option>
                <option value="target_size_fast">{t('mode.targetSizeFast')}</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-sidebar-bg p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sidebar-muted">
            {t('settings.environment')}
          </h3>
          <p className="mb-3 text-xs text-sidebar-muted">{t('settings.ffmpegStatusDesc')}</p>
          <div className="space-y-3">
            {(['ffmpeg', 'ffprobe'] as const).map((tool) => {
              const info = ffmpegStatus?.[tool]
              const available = info?.available ?? false
              const label = tool === 'ffmpeg' ? t('settings.ffmpegAvailable') : t('settings.ffprobeAvailable')
              return (
                <div key={tool} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${available ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-sidebar-text">{label}</span>
                  </div>
                  <div className="text-right">
                    {available ? (
                      <span className="text-xs text-sidebar-muted">{info?.version}</span>
                    ) : (
                      <span className="text-xs text-red-400">{t('settings.ffmpegMissing')}</span>
                    )}
                  </div>
                </div>
              )
            })}
            {ffmpegStatus && (!ffmpegStatus.ffmpeg.available || !ffmpegStatus.ffprobe.available) && (
              <p className="mt-2 rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
                {t('settings.ffmpegInstallHint')}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl bg-sidebar-bg p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sidebar-muted">
            {t('settings.ffmpegSection')}
          </h3>
          <p className="mb-3 text-xs text-sidebar-muted">{t('settings.ffmpegSectionDesc')}</p>
          <div className="space-y-3">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${ffmpegInfo?.isAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm font-medium text-sidebar-text">
                  {ffmpegInfo?.isAvailable ? t('settings.ffmpegAvailable') : t('settings.ffmpegNotAvailable')}
                </span>
              </div>
            </div>

            {/* Source */}
            {ffmpegInfo && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-sidebar-muted">{t('settings.ffmpegSource')}</span>
                <span className="text-sm font-medium text-sidebar-text">
                  {ffmpegInfo.source === 'bundled' && t('settings.ffmpegSourceBundled')}
                  {ffmpegInfo.source === 'updated' && t('settings.ffmpegSourceUpdated')}
                  {ffmpegInfo.source === 'system' && t('settings.ffmpegSourceSystem')}
                  {ffmpegInfo.source === 'none' && t('settings.ffmpegSourceNone')}
                </span>
              </div>
            )}

            {/* FFmpeg Version */}
            {ffmpegInfo?.ffmpegVersion && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-sidebar-muted">{t('settings.ffmpegVersionLabel')}</span>
                <span className="max-w-[300px] truncate text-sm font-medium text-sidebar-text" title={ffmpegInfo.ffmpegVersion}>
                  {ffmpegInfo.ffmpegVersion}
                </span>
              </div>
            )}

            {/* FFprobe Version */}
            {ffmpegInfo?.ffprobeVersion && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-sidebar-muted">{t('settings.ffprobeVersionLabel')}</span>
                <span className="max-w-[300px] truncate text-sm font-medium text-sidebar-text" title={ffmpegInfo.ffprobeVersion}>
                  {ffmpegInfo.ffprobeVersion}
                </span>
              </div>
            )}

            {/* Path (collapsible) */}
            {ffmpegInfo?.ffmpegPath && (
              <div>
                <button
                  onClick={() => setShowPath(!showPath)}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {showPath ? '▼' : '▶'} {t('settings.ffmpegPathLabel')}
                </button>
                {showPath && (
                  <p className="mt-1 break-all rounded bg-workspace-bg p-2 text-xs text-sidebar-muted font-mono">
                    {ffmpegInfo.ffmpegPath}
                  </p>
                )}
              </div>
            )}

            {/* Update Progress */}
            {isUpdating && updateProgress && (
              <div className="space-y-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-workspace-bg">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${updateProgress.percent ?? 0}%` }}
                  />
                </div>
                <p className="text-xs text-sidebar-muted">
                  {updateProgress.message || t('settings.ffmpegUpdating')}
                </p>
              </div>
            )}

            {/* Error */}
            {ffmpegError && (
              <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">
                {ffmpegError}
              </p>
            )}

            {/* Success */}
            {ffmpegSuccess && (
              <p className="rounded-lg bg-green-500/10 p-3 text-xs text-green-400">
                {ffmpegSuccess}
              </p>
            )}

            {/* Update Prompt Card */}
            {updatePrompt && (
              <div className="rounded-lg bg-accent/10 p-3 space-y-2">
                <p className="text-sm font-medium text-accent">{t('settings.ffmpegUpdateAvailable')}</p>
                <div className="text-xs text-sidebar-muted space-y-1">
                  <p>{t('settings.ffmpegCurrentVersion')}: {updatePrompt.currentInfo.ffmpegVersion || 'unknown'}</p>
                  <p>{t('settings.ffmpegLatestVersion')}: {updatePrompt.latest.version || updatePrompt.latest.assetName || 'unknown'}</p>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleUpdateFFmpeg}
                    disabled={disableUpdate}
                    className="rounded-lg border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isUpdating ? t('settings.ffmpegUpdating') : t('settings.ffmpegUpdateNow')}
                  </button>
                  <button
                    onClick={() => { setUpdatePrompt(null); setFfmpegSuccess(t('settings.ffmpegUpdateSkipped')) }}
                    className="rounded-lg border border-sidebar-active px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors"
                  >
                    {t('settings.ffmpegNotNow')}
                  </button>
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={handleCheckFFmpeg}
                disabled={isCheckingFFmpeg}
                className="rounded-lg border border-sidebar-active px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCheckingFFmpeg ? t('settings.ffmpegCheckingUpdate') : t('settings.ffmpegCheck')}
              </button>
              <button
                onClick={handleCheckFFmpeg}
                disabled={disableUpdate || isCheckingFFmpeg}
                className="rounded-lg border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isCheckingFFmpeg ? t('settings.ffmpegCheckingUpdate') : t('settings.ffmpegCheckUpdates')}
              </button>
              <button
                onClick={handleOpenFFmpegFolder}
                className="rounded-lg border border-sidebar-active px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors"
              >
                {t('settings.ffmpegOpenFolder')}
              </button>
              {ffmpegInfo?.source === 'updated' && (
                <button
                  onClick={handleRemoveUpdated}
                  disabled={disableRemove}
                  className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('settings.ffmpegRemoveUpdate')}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl bg-sidebar-bg p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sidebar-muted">
            {t('settings.deviceProfile')}
          </h3>
          <p className="mb-3 text-xs text-sidebar-muted">{t('settings.deviceProfileDesc')}</p>
          {deviceProfile ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-sidebar-muted">{t('settings.platform')}</span>
                <span className="font-medium text-sidebar-text">{deviceProfile.platform}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sidebar-muted">{t('settings.cpuModel')}</span>
                <span className="max-w-[280px] truncate font-medium text-sidebar-text" title={deviceProfile.cpuModel}>
                  {deviceProfile.cpuModel}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sidebar-muted">{t('settings.cpuCores')}</span>
                <span className="font-medium text-sidebar-text">{deviceProfile.cpuCores}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sidebar-muted">{t('settings.totalMemory')}</span>
                <span className="font-medium text-sidebar-text">{formatBytes(deviceProfile.totalMemoryBytes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sidebar-muted">{t('settings.freeMemory')}</span>
                <span className="font-medium text-sidebar-text">{formatBytes(deviceProfile.freeMemoryBytes)}</span>
              </div>
              {deviceProfile.ffmpegVersion && (
                <div className="flex items-center justify-between">
                  <span className="text-sidebar-muted">{t('settings.ffmpegVersion')}</span>
                  <span className="font-medium text-sidebar-text">{deviceProfile.ffmpegVersion}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sidebar-muted">{t('settings.hardwareEncoders')}</span>
                <div className="text-right">
                  {deviceProfile.availableHardwareEncoders.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {deviceProfile.availableHardwareEncoders.map((enc) => (
                        <span key={enc} className="rounded bg-green-500/15 px-1.5 py-0.5 text-xs text-green-400">
                          {enc}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-sidebar-muted">{t('settings.noHardwareEncoders')}</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-sidebar-muted">Loading...</p>
          )}
        </section>

        <section className="rounded-xl bg-sidebar-bg p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sidebar-muted">
            {t('settings.performanceHistory')}
          </h3>
          <p className="mb-3 text-xs text-sidebar-muted">{t('settings.performanceHistoryDesc')}</p>
          {benchmarks.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-sidebar-muted">{t('settings.averageSpeed')}</span>
                <span className="font-medium text-sidebar-text">{avgSpeed.toFixed(1)}x</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-sidebar-muted">{t('settings.sampleCount')}</span>
                <span className="font-medium text-sidebar-text">{benchmarks.length}</span>
              </div>
              <button
                onClick={handleClearBenchmarks}
                className="mt-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
              >
                {t('settings.clearBenchmarks')}
              </button>
            </div>
          ) : (
            <p className="text-xs text-sidebar-muted">{t('settings.noBenchmarks')}</p>
          )}
        </section>

        <section className="rounded-xl bg-sidebar-bg p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-sidebar-muted">
            {t('settings.about')}
          </h3>
          <div className="space-y-3">
            <p className="text-sm font-medium text-sidebar-text">ShrinkFlow</p>
            <p className="text-xs text-sidebar-muted">{t('settings.aboutDesc')}</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <span className="text-sidebar-muted">{t('settings.version')}</span>
              <span className="text-sidebar-text">{BUILD_INFO.version}</span>
              <span className="text-sidebar-muted">{t('settings.buildTime')}</span>
              <span className="text-sidebar-text">{BUILD_INFO.buildTime}</span>
              <span className="text-sidebar-muted">{t('settings.environment')}</span>
              <span className="text-sidebar-text">{BUILD_INFO.environment === 'production' ? t('settings.envProduction') : t('settings.envDevelopment')}</span>
              <span className="text-sidebar-muted">{t('settings.author')}</span>
              <span className="text-sidebar-text">Jevon</span>
              <span className="text-sidebar-muted">{t('settings.copyright')}</span>
              <span className="text-sidebar-text">&copy; 2026 Jevon</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
