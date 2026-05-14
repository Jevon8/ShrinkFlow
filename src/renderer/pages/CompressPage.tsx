import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useVideoStore, isTerminalStatus } from '../stores/videoStore'
import { formatBytes } from '../utils/formatBytes'
import { formatDuration } from '../utils/formatDuration'

type SaveStrategy =
  | { type: 'replace_original' }
  | { type: 'save_as'; outputDir: string }
  | { type: 'default' }
import CompressionModeCards from '../components/compress/CompressionModeCards'
import TargetSizePanel from '../components/compress/TargetSizePanel'
import OutputSettingsPanel from '../components/compress/OutputSettingsPanel'
import SaveStrategyModal from '../components/compress/SaveStrategyModal'
import ConflictResolutionModal, { type ConflictItem } from '../components/compress/ConflictResolutionModal'
import OverallProgress from '../components/compress/OverallProgress'
import PreCompressionEta from '../components/compress/PreCompressionEta'
import SmartShrinkPlanPanel from '../components/compress/SmartShrinkPlanPanel'
import VideoAdviceBadge from '../components/compress/VideoAdviceBadge'
import type { ShrinkGoalId, SmartShrinkPlan, VideoShrinkAdvice } from '../modules/smart-shrink/types'
import { buildSmartShrinkPlan, SHRINK_GOALS } from '../modules/smart-shrink/buildPlan'

const VALID_MODES: CompressionMode[] = [
  'balanced', 'quality_first', 'smallest_size',
  'target_size_fast', 'target_size_accurate', 'compatible_high_quality',
  'heavy_balanced'
]

function resolveVideoCompressionMode(
  video: { shrinkAdvice?: { action?: string; recommendedMode?: string } },
  fallbackMode: CompressionMode,
  adviceOverride?: VideoShrinkAdvice
): CompressionMode {
  const advice = adviceOverride ?? video.shrinkAdvice
  if (!advice) return fallbackMode
  if (advice.action === 'skip') return fallbackMode
  const mode = advice.recommendedMode as CompressionMode | undefined
  if (!mode) return fallbackMode
  if (mode === 'target_size_fast' || mode === 'target_size_accurate') return fallbackMode
  if (!VALID_MODES.includes(mode)) {
    console.warn(`[resolveVideoMode] Invalid recommendedMode "${mode}", falling back to ${fallbackMode}`)
    return fallbackMode
  }
  return mode
}

const reasonKeys: Record<string, string> = {
  unsupported_format: 'compress.unsupportedFormat',
  permission_denied: 'compress.permissionDenied',
  duplicate: 'compress.duplicate',
  unknown_error: 'compress.unknownError',
  symbolic_link_skipped: 'compress.symbolicLinkSkipped',
  output_directory_skipped: 'compress.outputDirectorySkipped'
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

function translateError(t: (key: string) => string, msg: string): string {
  if (!msg) return t('error.unknown')
  const lower = msg.toLowerCase()
  if (lower.includes('file not found') || lower.includes('no such file')) return t('error.fileNotFound')
  if (lower.includes('empty output')) return t('error.emptyOutput')
  if (lower.includes('invalid json')) return t('error.invalidJson')
  if (lower.includes('no video stream') || lower.includes('no streams found')) return t('error.noVideoStream')
  if (lower.includes('invalid data')) return t('error.invalidData')
  if (lower.includes('permission denied') || lower.includes('operation not permitted')) return t('error.permissionDenied')
  if (lower.includes('end of file') || lower.includes('truncated')) return t('error.truncatedFile')
  if (lower.includes('invalid argument')) return t('error.invalidArgument')
  if (lower.includes('ffprobe reported')) return t('error.ffprobeError')
  if (lower.includes('ffprobe execution')) return t('error.ffprobeFailed')
  if (lower.includes('analysis failed')) return t('error.analysisFailed')
  return msg
}

const statusColors: Record<string, string> = {
  scanned: 'bg-accent/15 text-accent',
  analyzing: 'bg-warning/15 text-warning',
  ready: 'bg-success/15 text-success',
  pending: 'bg-sidebar-active/50 text-sidebar-muted',
  compressing: 'bg-accent/15 text-accent',
  completed: 'bg-success/15 text-success',
  failed: 'bg-error/15 text-error',
  canceled: 'bg-orange-500/15 text-orange-400',
  skipped: 'bg-sidebar-active/50 text-sidebar-muted'
}

const statusKeys: Record<string, string> = {
  scanned: 'status.scanned',
  analyzing: 'status.analyzing',
  ready: 'status.ready',
  pending: 'status.pending',
  compressing: 'status.compressing',
  completed: 'status.completed',
  failed: 'status.failed',
  canceled: 'status.canceled',
  skipped: 'status.skipped'
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${statusColors[status] || statusColors.scanned}`}>
      {t(statusKeys[status] || 'status.scanned')}
    </span>
  )
}

export default function CompressPage() {
  const { t } = useTranslation()
  const { videos, skipped, addVideos, addSkipped, removeVideo, clearAll, setVideoStatus, updateVideoMetadata, setVideoError, updateCompressionProgress, setCompressionResult, setCanceled, setSkipped, setQueueStatus, reconcileFinalResults, sessionId, queueStatus, setSelectedForCompression, applyShrinkPlan, resetSelectionOverrides } = useVideoStore()
  const [ffprobeStatus, setFfprobeStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [ffprobeError, setFfprobeError] = useState<string>('')
  const [isAnalyzingState, setIsAnalyzingState] = useState(false)
  const sessionIdRef = useRef(sessionId)

  // Compression planning state
  const [compressionMode, setCompressionMode] = useState<string>('compatible_high_quality')
  const [targetSizeMB, setTargetSizeMB] = useState<number | null>(null)
  const [targetSizeAccuracy, setTargetSizeAccuracy] = useState<'fast' | 'accurate'>('fast')
  const [generating, setGenerating] = useState(false)
  const [planResult, setPlanResult] = useState<{
    success: boolean
    warnings?: string[]
    error?: string
  } | null>(null)

  // Queue state
  const [queueRunning, setQueueRunning] = useState(false)
  const [queueProgress, setQueueProgress] = useState<QueueProgress | null>(null)
  const [queueResult, setQueueResult] = useState<QueueResult | null>(null)
  const [queueStartTime, setQueueStartTime] = useState<number | null>(null)
  const [queueElapsed, setQueueElapsed] = useState<number>(0)
  const [diskSpaceWarning, setDiskSpaceWarning] = useState<string | null>(null)
  const [outputDirError, setOutputDirError] = useState<string | null>(null)

  // Save strategy modal state
  const [showSaveModal, setShowSaveModal] = useState(false)

  // Conflict resolution state
  const [conflicts, setConflicts] = useState<ConflictItem[]>([])
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [pendingQueueItems, setPendingQueueItems] = useState<{ id: string; plan: CompressionPlan; duration: number; height?: number; mode: CompressionMode }[]>([])
  const [pendingSaveStrategy, setPendingSaveStrategy] = useState<SaveStrategy | undefined>(undefined)
  const [conflictSkippedCount, setConflictSkippedCount] = useState(0)
  const [conflictItems, setConflictItems] = useState<{ videoId: string; input: CompressionInput; duration: number }[]>([])

  // Overall progress state
  const [planSkippedCount, setPlanSkippedCount] = useState(0)
  const [queueStarted, setQueueStarted] = useState(false)

  // Scan progress state
  const [scanProgress, setScanProgress] = useState<ScanProgressEvent | null>(null)
  const [scanSummary, setScanSummary] = useState<ScanResult | null>(null)

  // Smart Shrink Plan state
  const [selectedGoal, setSelectedGoal] = useState<ShrinkGoalId>('balanced_50')
  const [showSkipped, setShowSkipped] = useState(false)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
  const [planAppliedBySmart, setPlanAppliedBySmart] = useState(false)
  const [showConfirmOnly, setShowConfirmOnly] = useState(false)

  // Device profile state
  const [hwAccelAvailable, setHwAccelAvailable] = useState<boolean | null>(null)
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null)

  // Pre-compression ETA state
  const [preEta, setPreEta] = useState<EtaEstimateResult | EtaEstimateUnavailable | null>(null)
  const [probeSpeedX, setProbeSpeedX] = useState<number | undefined>(undefined)
  const [probing, setProbing] = useState(false)

  // Keep sessionIdRef in sync with store
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // Table pagination
  const VISIBLE_ROW_LIMIT = 200
  const [visibleRows, setVisibleRows] = useState(VISIBLE_ROW_LIMIT)

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // Busy state — computed early so handlers can reference it
  const isScanning = scanProgress !== null && scanProgress.status === 'scanning'
  const isAnalyzing = isAnalyzingState
  const isQueueTerminal = isTerminalStatus(queueStatus)
  const isBusy = isScanning || isAnalyzing || (queueStarted && !isQueueTerminal) || generating

  // Effective mode: map target_size_fast + accuracy toggle to actual mode
  const effectiveMode = compressionMode === 'target_size_fast'
    ? (targetSizeAccuracy === 'accurate' ? 'target_size_accurate' : 'target_size_fast')
    : compressionMode

  // Load default settings on mount
  useEffect(() => {
    window.api.getSettings().then((settings) => {
      if (settings.defaultCompressionMode) {
        setCompressionMode(settings.defaultCompressionMode)
      }
    }).catch(() => {})
  }, [])

  // Check FFprobe availability on mount
  useEffect(() => {
    window.api.checkFFprobe().then((result) => {
      if (result.available) {
        setFfprobeStatus('ok')
      } else {
        setFfprobeStatus('error')
        setFfprobeError(result.error || 'FFprobe not found')
      }
    })
  }, [])

  // Check device profile for hardware acceleration
  useEffect(() => {
    window.api.getDeviceProfile().then((profile) => {
      setHwAccelAvailable(profile.availableHardwareEncoders.length > 0)
      setDeviceProfile(profile)
    }).catch(() => {
      setHwAccelAvailable(false)
    })
  }, [])

  // Listen for analysis results
  const handleVideoAnalyzed = useCallback(
    (data: VideoAnalyzedEvent) => {
      // Stale result guard: ignore if sessionId changed
      const currentSessionId = useVideoStore.getState().sessionId
      if (currentSessionId !== sessionIdRef.current) {
        console.log(`[CompressPage] ignored stale analysis result session=${currentSessionId}`)
        return
      }
      if (data.success && data.metadata) {
        updateVideoMetadata(data.id, { ...data.metadata, status: 'ready' })
      } else {
        setVideoError(data.id, data.error || 'Unknown error')
      }
    },
    [updateVideoMetadata, setVideoError]
  )

  useEffect(() => {
    const unsubscribe = window.api.onVideoAnalyzed(handleVideoAnalyzed)
    return unsubscribe
  }, [handleVideoAnalyzed])

  // Listen for queue progress
  const handleQueueProgress = useCallback(
    (data: QueueProgress) => {
      // Stale result guard
      const currentSessionId = useVideoStore.getState().sessionId
      if (currentSessionId !== sessionIdRef.current) {
        console.log(`[CompressPage] ignored stale queue progress session=${currentSessionId}`)
        return
      }
      setQueueProgress(data)
      // Sync queue status from progress events
      if (data.status) {
        setQueueStatus(data.status as any)
      }
      // Update per-item progress in store — skip if queue is in terminal state
      if (data.currentItem && !isTerminalStatus(data.status)) {
        const videos = useVideoStore.getState().videos
        const video = videos.find((v) => v.id === data.currentItem!.id)
        if (video && video.status !== 'completed' && video.status !== 'failed' && video.status !== 'canceled') {
          updateCompressionProgress(video.id, {
            percent: data.currentItem.percent,
            elapsedSeconds: data.currentItem.elapsedSeconds,
            remainingLabel: data.currentItem.remainingLabel,
            remainingSeconds: data.currentItem.remainingSeconds,
            speed: data.currentItem.speed,
            phase: data.currentItem.phase
          })
        }
      }
    },
    [updateCompressionProgress, setQueueStatus]
  )

  useEffect(() => {
    const unsubscribe = window.api.onQueueProgress(handleQueueProgress)
    return unsubscribe
  }, [handleQueueProgress])

  // Listen for queue item done
  const handleQueueItemDone = useCallback(
    (data: QueueItemResult) => {
      // Stale result guard
      const currentSessionId = useVideoStore.getState().sessionId
      if (currentSessionId !== sessionIdRef.current) {
        console.log(`[CompressPage] ignored stale item-done session=${currentSessionId}`)
        return
      }
      if (data.status === 'completed' && data.result) {
        setCompressionResult(data.id, {
          originalSize: data.result.originalSize,
          outputSize: data.result.outputSize,
          savedSize: data.result.savedSize,
          compressionRatio: data.result.compressionRatio,
          outputPath: data.result.outputPath,
          outputLargerThanInput: data.result.outputLargerThanInput,
          noSaving: data.result.noSaving
        })
      } else if (data.status === 'failed') {
        setVideoError(data.id, data.error || 'Compression failed')
      } else if (data.status === 'canceled') {
        setCanceled(data.id)
      } else if (data.status === 'skipped') {
        setSkipped(data.id)
      }
    },
    [setCompressionResult, setVideoError, setCanceled, setSkipped]
  )

  useEffect(() => {
    const unsubscribe = window.api.onQueueItemDone(handleQueueItemDone)
    return unsubscribe
  }, [handleQueueItemDone])

  // Listen for task-finished — final reconciliation
  const handleTaskFinished = useCallback(
    (data: TaskFinishedEvent) => {
      // Stale result guard
      const currentSessionId = useVideoStore.getState().sessionId
      if (currentSessionId !== sessionIdRef.current) {
        console.log(`[CompressPage] ignored stale task-finished session=${currentSessionId}`)
        return
      }
      reconcileFinalResults(data.results)
      setQueueStatus(data.status)
    },
    [reconcileFinalResults, setQueueStatus]
  )

  useEffect(() => {
    const unsubscribe = window.api.onTaskFinished(handleTaskFinished)
    return unsubscribe
  }, [handleTaskFinished])

  // Listen for scan progress
  const handleScanProgress = useCallback(
    (data: ScanProgressEvent) => {
      // Stale result guard
      const currentSessionId = useVideoStore.getState().sessionId
      if (currentSessionId !== sessionIdRef.current) {
        console.log(`[CompressPage] ignored stale scan progress session=${currentSessionId}`)
        return
      }
      setScanProgress(data)
    },
    []
  )

  useEffect(() => {
    const unsubscribe = window.api.onScanProgress(handleScanProgress)
    return unsubscribe
  }, [handleScanProgress])

  // Auto-analyze videos that are in 'scanned' status
  const runAnalysis = useCallback(async () => {
    if (isAnalyzingState) return
    const toAnalyze = useVideoStore.getState().videos.filter((v) => v.status === 'scanned')
    if (toAnalyze.length === 0) return

    setIsAnalyzingState(true)
    const sid = useVideoStore.getState().sessionId

    // Set all to analyzing first
    toAnalyze.forEach((v) => setVideoStatus(v.id, 'analyzing'))

    try {
      await window.api.analyzeVideos(
        toAnalyze.map((v) => ({ id: v.id, filePath: v.filePath }))
      )
    } catch (err) {
      // Mark remaining analyzing videos as failed (only if session still valid)
      if (useVideoStore.getState().sessionId === sid) {
        const currentVideos = useVideoStore.getState().videos
        currentVideos
          .filter((v) => v.status === 'analyzing')
          .forEach((v) => setVideoError(v.id, 'Analysis failed'))
      }
    } finally {
      setIsAnalyzingState(false)
    }
  }, [setVideoStatus, setVideoError])

  const handleSelectVideos = async () => {
    if (isBusy) return
    const result = await window.api.selectVideos()
    if (result.canceled || result.filePaths.length === 0) return
    const sid = useVideoStore.getState().sessionId
    const scanResult = await window.api.scanPaths(result.filePaths)
    if (useVideoStore.getState().sessionId !== sid) {
      console.log('[CompressPage] ignored stale select-videos scan result')
      return
    }
    addVideos(scanResult.videos)
    addSkipped(scanResult.skipped)
    setShowConfirmOnly(false)
    // Auto-analyze after short delay to let store update
    setTimeout(() => runAnalysis(), 50)
  }

  const handleSelectFolder = async () => {
    if (isBusy) return
    const result = await window.api.selectFolder()
    if (result.canceled || result.filePaths.length === 0) return
    const sid = useVideoStore.getState().sessionId
    setScanProgress({ status: 'scanning', scannedFolders: 0, scannedFiles: 0, foundVideos: 0, skippedFiles: 0, skippedFolders: 0 })
    setScanSummary(null)
    const scanResult = await window.api.scanPaths(result.filePaths, { recursive: true })
    if (useVideoStore.getState().sessionId !== sid) {
      console.log('[CompressPage] ignored stale select-folder scan result')
      return
    }
    setScanProgress(null)
    setScanSummary(scanResult)
    addVideos(scanResult.videos)
    addSkipped(scanResult.skipped)
    setShowConfirmOnly(false)
    setTimeout(() => runAnalysis(), 50)
  }

  const handleAnalyzeAll = () => {
    runAnalysis()
  }

  // Only count videos with complete metadata as compressible
  const compressibleVideos = useMemo(
    () => videos.filter(
      (v) => v.status === 'ready' && v.duration && v.duration > 0 && v.width && v.width > 0 && v.height && v.height > 0 && v.videoCodec && v.fileSize > 0 && v.selectedForCompression !== false
    ),
    [videos]
  )

  // Smart Shrink Plan: build when videos or goal change
  const readyVideos = useMemo(
    () => videos.filter((v) => v.status === 'ready' && v.fileSize > 0),
    [videos]
  )

  const smartPlan = useMemo(() => {
    if (readyVideos.length === 0) return null
    return buildSmartShrinkPlan(
      readyVideos.map((v) => ({
        id: v.id,
        fileSize: v.fileSize,
        duration: v.duration,
        width: v.width,
        height: v.height,
        videoCodec: v.videoCodec,
        bitrate: v.bitrate,
        frameRate: v.frameRate
      })),
      selectedGoal
    )
  }, [readyVideos, selectedGoal])

  // Unified advice source: always in sync with smartPlan.summary
  const adviceByVideoId = useMemo(() => {
    return new Map((smartPlan?.advices ? Object.entries(smartPlan.advices) : []).map(([id, advice]) => [id, advice]))
  }, [smartPlan])

  const getVideoAdvice = useCallback(
    (video: { id: string; shrinkAdvice?: VideoShrinkAdvice }): VideoShrinkAdvice | undefined => {
      return video.shrinkAdvice ?? adviceByVideoId.get(video.id)
    },
    [adviceByVideoId]
  )

  const handleApplyPlan = () => {
    if (!smartPlan) return
    // Set global compression mode
    setCompressionMode(smartPlan.goal.recommendedMode)
    // Apply selection to videos
    applyShrinkPlan(smartPlan.advices)
    setPlanAppliedBySmart(true)
    setShowConfirmOnly(false)
    // Show toast
    setPlanResult({ success: true, warnings: [t('smartShrink.notice.planApplied')] })
  }

  const handleRegenerate = () => {
    if (!smartPlan) return
    applyShrinkPlan(smartPlan.advices)
  }

  const handleResetOverrides = () => {
    if (!smartPlan) return
    resetSelectionOverrides(smartPlan.advices)
  }

  const handleToggleSkipped = () => {
    setShowSkipped((prev) => !prev)
  }

  const handleManualModeSelect = (mode: string) => {
    setCompressionMode(mode as CompressionMode)
    setPlanAppliedBySmart(false)
    setShowConfirmOnly(false)
  }

  const hasUserOverrides = useMemo(
    () => videos.some((v) => v.selectionUserOverride),
    [videos]
  )

  // Unified confirm videos — always in sync with smartPlan.summary
  const confirmVideos = useMemo(
    () => videos.filter((v) => getVideoAdvice(v)?.action === 'confirm'),
    [videos, getVideoAdvice]
  )

  const actualConfirmCount = confirmVideos.length

  // Filter videos for display based on showSkipped and showConfirmOnly
  const displayVideos = useMemo(() => {
    if (showConfirmOnly) {
      return confirmVideos
    }
    return showSkipped
      ? videos
      : videos.filter((v) => v.selectedForCompression !== false || v.status !== 'ready')
  }, [videos, showSkipped, showConfirmOnly, confirmVideos])

  const handleShowConfirm = () => {
    setShowConfirmOnly((prev) => !prev)
    if (!showConfirmOnly) setShowSkipped(true)
  }

  // Fetch pre-compression ETA when videos, mode, or device profile change
  useEffect(() => {
    const inputs: EtaEstimateInput[] = compressibleVideos.map((v) => ({
      duration: v.duration!,
      width: v.width!,
      height: v.height!,
      videoCodec: v.videoCodec || '',
      bitrate: v.bitrate || 0,
      frameRate: v.frameRate
    }))

    let canceled = false
    const timer = setTimeout(() => {
      if (compressibleVideos.length === 0 || !deviceProfile) {
        if (!canceled) setPreEta(null)
        return
      }
      window.api.estimateEta(inputs, effectiveMode as CompressionMode, deviceProfile, probeSpeedX).then((result) => {
        if (!canceled) setPreEta(result)
      }).catch(() => {
        if (!canceled) setPreEta(null)
      })
    }, 300)

    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [compressibleVideos, effectiveMode, deviceProfile, probeSpeedX])

  // Quick probe: compress a short segment of the first video to measure actual speed
  const handleQuickProbe = async () => {
    if (compressibleVideos.length === 0 || probing) return
    // Disable probe for accurate mode (two-pass probe is too slow)
    if (effectiveMode === 'target_size_accurate') return
    const firstVideo = compressibleVideos[0]
    setProbing(true)

    try {
      // Generate a plan for the first video
      const input: CompressionInput = {
        filePath: firstVideo.filePath,
        duration: firstVideo.duration!,
        width: firstVideo.width!,
        height: firstVideo.height!,
        videoCodec: firstVideo.videoCodec || '',
        bitrate: firstVideo.bitrate || 0,
        frameRate: firstVideo.frameRate || 0
      }
      const planResult = await window.api.generatePlan(input, effectiveMode as CompressionMode, effectiveMode === 'target_size_accurate' || effectiveMode === 'target_size_fast' ? (targetSizeMB ?? undefined) : undefined)
      if (!planResult.success || !planResult.result || !planResult.result.ok) {
        setProbing(false)
        return
      }

      const probeResult = await window.api.quickProbe(firstVideo.filePath, firstVideo.duration!, planResult.result.plan)
      if (probeResult.success && probeResult.speedX && probeResult.speedX > 0) {
        setProbeSpeedX(probeResult.speedX)
      }
    } catch {
      // Probe failed — leave probeSpeedX unchanged
    } finally {
      setProbing(false)
    }
  }

  const handleStartBatch = async () => {
    if (compressibleVideos.length === 0 || queueRunning) return

    // If compatible_high_quality mode, show save strategy modal first
    if (effectiveMode === 'compatible_high_quality') {
      setShowSaveModal(true)
      return
    }

    await executeBatch()
  }

  const handleSaveStrategySelect = async (type: 'replace_original' | 'save_as') => {
    setShowSaveModal(false)

    if (type === 'save_as') {
      const result = await window.api.selectFolder()
      if (result.canceled || result.filePaths.length === 0) {
        return
      }
      executeBatch({ type: 'save_as', outputDir: result.filePaths[0] })
    } else {
      executeBatch({ type: 'replace_original' })
    }
  }

  const handleSaveModalCancel = () => {
    setShowSaveModal(false)
  }

  const executeBatch = async (saveStrategy?: SaveStrategy) => {
    setGenerating(true)
    setPlanResult(null)
    setQueueResult(null)
    setDiskSpaceWarning(null)
    setOutputDirError(null)
    setConflictSkippedCount(0)

    const skippedList: { fileName: string; reason: string }[] = []
    const queueItems: { id: string; plan: CompressionPlan; duration: number; height: number; mode: CompressionMode }[] = []
    const detectedConflicts: ConflictItem[] = []
    const conflictInputData: { videoId: string; input: CompressionInput; duration: number }[] = []

    try {
      // Generate plans per-video — failures don't block the batch
      for (const video of compressibleVideos) {
        const input: CompressionInput = {
          filePath: video.filePath,
          duration: video.duration!,
          width: video.width!,
          height: video.height!,
          videoCodec: video.videoCodec || '',
          bitrate: video.bitrate || 0,
          frameRate: video.frameRate || 0
        }

        // Per-video mode: only use shrinkAdvice.recommendedMode when Smart Plan is active
        const videoMode = planAppliedBySmart
          ? resolveVideoCompressionMode(video, effectiveMode as CompressionMode, getVideoAdvice(video))
          : (effectiveMode as CompressionMode)

        const result = await window.api.generatePlan(
          input,
          videoMode,
          (videoMode === 'target_size_fast' || videoMode === 'target_size_accurate') ? (targetSizeMB ?? undefined) : undefined,
          saveStrategy
        )

        if (result.success && result.result && result.result.ok) {
          const plan = result.result.plan
          if (plan.warnings.length > 0) {
            skippedList.push({ fileName: video.fileName, reason: plan.warnings.join('; ') })
          }
          queueItems.push({ id: video.id, plan, duration: video.duration!, height: video.height!, mode: videoMode })
        } else if (result.success && result.result && !result.result.ok && 'conflict' in result.result && result.result.conflict) {
          // Conflict detected by planner — collect for resolution, don't mark as failed
          detectedConflicts.push({
            videoId: video.id,
            fileName: video.fileName,
            inputPath: video.filePath,
            outputPath: result.result.message.match(/Output file already exists: (.+)$/)?.[1] || '',
            conflictType: result.result.conflictType as 'same_as_input' | 'existing_output_file'
          })
          conflictInputData.push({ videoId: video.id, input, duration: video.duration! })
        } else {
          const reason = result.result && !result.result.ok
            ? ('reason' in result.result ? result.result.reason : result.result.message)
            : result.error || 'Unknown error'
          skippedList.push({ fileName: video.fileName, reason })
          setVideoError(video.id, reason)
        }
      }

      setGenerating(false)

      // Show conflict modal if any conflicts detected (before queue starts)
      if (detectedConflicts.length > 0) {
        setConflicts(detectedConflicts)
        setConflictItems(conflictInputData)
        setPendingQueueItems(queueItems)
        setPendingSaveStrategy(saveStrategy)
        setShowConflictModal(true)
        return
      }

      if (queueItems.length === 0) {
        setPlanResult({
          success: false,
          error: t('plan.noCompressibleVideos')
        })
        return
      }

      // No conflicts — proceed directly
      await startQueueWithItems(queueItems, skippedList, saveStrategy)
    } catch (err) {
      setPlanResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setGenerating(false)
      setQueueRunning(false)
    }
  }

  const startQueueWithItems = async (
    queueItems: { id: string; plan: CompressionPlan; duration: number; height?: number; mode: CompressionMode }[],
    skippedList: { fileName: string; reason: string }[],
    saveStrategy?: SaveStrategy
  ) => {
    // Safety check: output directories writable (check all unique dirs)
    const uniqueDirs = [...new Set(queueItems.map((item) => item.plan.outputDir))]
    for (const dir of uniqueDirs) {
      const dirCheck = await window.api.checkOutputDir(dir)
      if (!dirCheck.ok) {
        setOutputDirError(dirCheck.error || t('plan.outputDirError'))
        return
      }
    }

    // Safety check: disk space (use the first dir for the check — same drive in most cases)
    const totalInputBytes = queueItems.reduce((sum, item) => {
      const video = videos.find((v) => v.id === item.id)
      return sum + (video?.fileSize || 0)
    }, 0)
    const spaceCheck = await window.api.checkDiskSpace(uniqueDirs[0], totalInputBytes)
    if (spaceCheck.warning) {
      setDiskSpaceWarning(spaceCheck.warning)
    }

    // Show skip summary if some files were skipped
    if (skippedList.length > 0) {
      setPlanResult({
        success: true,
        warnings: skippedList.map((s) => `${s.fileName}: ${s.reason}`)
      })
    }

    setPlanSkippedCount(skippedList.length)

    // Mark queued videos as pending
    queueItems.forEach((item) => setVideoStatus(item.id, 'pending'))

    // Start queue
    setQueueRunning(true)
    setQueueStarted(true)
    setQueueStatus('running')
    const startTime = Date.now()
    setQueueStartTime(startTime)
    const queueResult = await window.api.startQueue(queueItems)

    setQueueRunning(false)
    setQueueElapsed(Date.now() - startTime)

    if (queueResult.success && queueResult.result) {
      setQueueResult(queueResult.result)
      // Save history
      const r = queueResult.result
      const completedItems = r.items.filter((it) => it.status === 'completed' && it.result)
      const originalTotal = completedItems.reduce((sum, it) => sum + it.result!.originalSize, 0)
      const outputTotal = completedItems.reduce((sum, it) => sum + it.result!.outputSize, 0)
      const savedTotal = originalTotal - outputTotal
      const firstOutputDir = completedItems[0]?.result?.outputPath
        ? completedItems[0].result.outputPath.replace(/[/\\][^/\\]+$/, '')
        : ''
      // Build per-video mode map for history recording
      const modeByVideoId = new Map(queueItems.map(item => [item.id, item.mode]))

      window.api.addHistory({
        totalFiles: r.totalFiles,
        successCount: r.completedFiles,
        failedCount: r.failedFiles,
        originalTotalSize: originalTotal,
        outputTotalSize: outputTotal,
        savedSize: savedTotal,
        savedPercent: originalTotal > 0 ? Math.round((savedTotal / originalTotal) * 1000) / 10 : 0,
        mode: effectiveMode,
        outputDir: firstOutputDir,
        status: r.status,
        saveStrategy: saveStrategy?.type,
        skippedCount: (r.skippedFiles || 0) + conflictSkippedCount,
        totalElapsedSeconds: r.totalElapsedSeconds,
        shrinkPlanSummary: smartPlan ? {
          goalId: smartPlan.goal.id,
          recommendedMode: smartPlan.summary.recommendedMode,
          originalTotalBytes: smartPlan.summary.originalTotalBytes,
          estimatedSavingBytesMin: smartPlan.summary.estimatedSavingBytesMin,
          estimatedSavingBytesMax: smartPlan.summary.estimatedSavingBytesMax,
          compressCount: smartPlan.summary.compressCount,
          skipCount: smartPlan.summary.skipCount,
          confirmCount: smartPlan.summary.confirmCount,
          highRiskCount: smartPlan.summary.highRiskCount,
          applied: true
        } : undefined,
        results: r.items.map((it) => {
          const originalSize = it.result?.originalSize
          const outputSize = it.result?.outputSize
          const savedSize = originalSize != null && outputSize != null ? Math.max(0, originalSize - outputSize) : undefined
          return {
            videoId: it.id,
            fileName: it.inputPath ? (it.inputPath.split(/[/\\]/).pop() || it.inputPath) : it.id,
            inputPath: it.inputPath || '',
            outputPath: it.result?.outputPath,
            status: it.status as 'completed' | 'failed' | 'skipped' | 'canceled',
            originalSize,
            outputSize,
            savedSize,
            savedPercent: originalSize && originalSize > 0 && savedSize != null ? Math.round((savedSize / originalSize) * 1000) / 10 : undefined,
            compressionElapsedSeconds: it.compressionElapsedSeconds,
            errorMessage: it.error,
            targetSizeMB: it.result?.targetSizeMB,
            actualSizeMB: it.result?.actualSizeMB,
            sizeErrorPercent: it.result?.sizeErrorPercent,
            accuracyMode: it.result?.accuracyMode,
            outputLargerThanInput: it.result?.outputLargerThanInput,
            noSaving: it.result?.noSaving,
            mode: modeByVideoId.get(it.id) || effectiveMode
          }
        })
      }).catch(() => {})
    } else if (!queueResult.success) {
      setPlanResult({ success: false, error: queueResult.error })
    }
  }

  const handleConflictResolve = async (resolution: 'overwrite' | 'rename' | 'skip', applyToAll: boolean) => {
    setShowConflictModal(false)

    const conflictsToProcess = applyToAll ? conflicts : [conflicts[0]]
    const remainingConflicts = applyToAll ? [] : conflicts.slice(1)
    const processIds = new Set(conflictsToProcess.map((c) => c.videoId))
    const remainingConflictItems = conflictItems.filter((ci) => !processIds.has(ci.videoId))

    if (resolution === 'skip') {
      // Mark conflicting videos as skipped
      for (const c of conflictsToProcess) {
        setSkipped(c.videoId)
      }
      setConflictSkippedCount((prev) => prev + conflictsToProcess.length)

      // Remove skipped items from pending queue
      const remainingItems = pendingQueueItems.filter((item) => !processIds.has(item.id))

      if (remainingItems.length === 0 && remainingConflicts.length === 0) {
        setPlanResult({ success: false, error: t('plan.noCompressibleVideos') })
        setConflicts([])
        setConflictItems([])
        setPendingQueueItems([])
        return
      }

      // If there are more conflicts to resolve, show modal again
      if (remainingConflicts.length > 0) {
        setConflicts(remainingConflicts)
        setConflictItems(remainingConflictItems)
        setPendingQueueItems(remainingItems)
        setShowConflictModal(true)
        return
      }

      // No more conflicts — start queue with remaining items
      setConflicts([])
      setConflictItems([])
      setPendingQueueItems([])
      await startQueueWithItems(remainingItems, [])
    } else {
      // 'overwrite' or 'rename' — re-generate plans with conflictAction for conflicting videos
      const updatedItems: typeof pendingQueueItems = []

      // Build mode lookup from pending items
      const modeByVideoId = new Map(pendingQueueItems.map(item => [item.id, item.mode]))

      for (const ci of conflictItems) {
        if (!processIds.has(ci.videoId)) continue

        const videoMode = modeByVideoId.get(ci.videoId) ?? (effectiveMode as CompressionMode)

        const result = await window.api.generatePlan(
          ci.input,
          videoMode,
          (videoMode === 'target_size_fast' || videoMode === 'target_size_accurate') ? (targetSizeMB ?? undefined) : undefined,
          pendingSaveStrategy,
          resolution
        )

        if (result.success && result.result && result.result.ok) {
          updatedItems.push({ id: ci.videoId, plan: result.result.plan, duration: ci.duration, height: ci.input.height, mode: videoMode })
        } else {
          // Re-generation failed — mark as failed
          const reason = result.result && !result.result.ok ? ('reason' in result.result ? result.result.reason : result.result.message) : result.error || 'Unknown error'
          setVideoError(ci.videoId, reason)
        }
      }

      // Merge with non-conflicting pending items
      const allItems = [...pendingQueueItems, ...updatedItems]

      if (allItems.length === 0 && remainingConflicts.length === 0) {
        setPlanResult({ success: false, error: t('plan.noCompressibleVideos') })
        setConflicts([])
        setConflictItems([])
        setPendingQueueItems([])
        return
      }

      // If there are more conflicts to resolve, show modal again
      if (remainingConflicts.length > 0) {
        setConflicts(remainingConflicts)
        setConflictItems(remainingConflictItems)
        setPendingQueueItems(allItems)
        setShowConflictModal(true)
        return
      }

      // No more conflicts — start queue
      setConflicts([])
      setConflictItems([])
      setPendingQueueItems([])
      await startQueueWithItems(allItems, [])
    }
  }

  const handleConflictCancel = () => {
    setShowConflictModal(false)
    setConflicts([])
    setConflictItems([])
    setPendingQueueItems([])
    setPendingSaveStrategy(undefined)
    // Keep all videos in their current 'ready' status — don't mark anything
  }

  const handleCancelQueue = () => {
    window.api.cancelQueue()
  }

  const [canceling, setCanceling] = useState(false)

  const handleClearAll = async () => {
    // If busy, show confirmation
    if (isBusy) {
      const confirmed = window.confirm(t('compress.confirmClearRunning'))
      if (!confirmed) return
    }

    setCanceling(true)

    try {
      // Cancel all running tasks
      window.api.cancelQueue()
      window.api.cancelCompression()
      window.api.cancelScan()
      window.api.cancelAnalysis()

      // Wait a brief moment for cancellation to propagate
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Clear UI state
      clearAll()
      setQueueStarted(false)
      setQueueRunning(false)
      setPlanSkippedCount(0)
      setQueueProgress(null)
      setQueueResult(null)
      setPlanResult(null)
      setConflicts([])
      setConflictItems([])
      setShowConflictModal(false)
      setPendingQueueItems([])
      setConflictSkippedCount(0)
      setScanProgress(null)
      setScanSummary(null)
      setVisibleRows(VISIBLE_ROW_LIMIT)
      setIsAnalyzingState(false)
      setShowConfirmOnly(false)
    } catch (err) {
      console.error('[CompressPage] clearAll failed:', err)
    } finally {
      setCanceling(false)
    }
  }

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounterRef.current = 0

    // Guard: block drop during busy state
    if (isBusy) {
      return
    }

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    let paths: string[]
    try {
      paths = window.api.getDroppedFilePaths(files)
    } catch {
      return
    }

    if (paths.length === 0) return

    const sid = useVideoStore.getState().sessionId

    // Check if any paths are directories by scanning — scanPaths handles both files and folders
    setScanProgress({ status: 'scanning', scannedFolders: 0, scannedFiles: 0, foundVideos: 0, skippedFiles: 0, skippedFolders: 0 })
    setScanSummary(null)
    const scanResult = await window.api.scanPaths(paths, { recursive: true })
    if (useVideoStore.getState().sessionId !== sid) {
      console.log('[CompressPage] ignored stale drop scan result')
      return
    }
    setScanProgress(null)
    setScanSummary(scanResult)
    addVideos(scanResult.videos)
    addSkipped(scanResult.skipped)
    setShowConfirmOnly(false)
    setTimeout(() => runAnalysis(), 50)
  }, [addVideos, addSkipped, runAnalysis, isBusy])

  const hasContent = videos.length > 0 || skipped.length > 0
  const hasScanned = videos.some((v) => v.status === 'scanned')
  const hasAnalyzing = videos.some((v) => v.status === 'analyzing')

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <SaveStrategyModal
        visible={showSaveModal}
        onSelect={handleSaveStrategySelect}
        onCancel={handleSaveModalCancel}
      />
      <ConflictResolutionModal
        visible={showConflictModal}
        conflicts={conflicts}
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('compress.title')}</h2>
        {hasContent && (
          <button
            onClick={handleClearAll}
            disabled={canceling}
            className="rounded-lg border border-sidebar-active px-3 py-1.5 text-xs font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {canceling ? t('compress.canceling') : t('compress.clearAll')}
          </button>
        )}
      </div>

      {/* Drag overlay when files already loaded */}
      {hasContent && isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-workspace-bg/80 backdrop-blur-sm">
          <div className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-12 py-16 ${isBusy ? 'border-warning bg-warning/10' : 'border-accent bg-accent/10'}`}>
            <svg className={`h-12 w-12 ${isBusy ? 'text-warning' : 'text-accent'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className={`text-lg font-medium ${isBusy ? 'text-warning' : 'text-accent'}`}>
              {isBusy ? t('compress.busyCannotAdd') : t('compress.dragDropActive')}
            </p>
          </div>
        </div>
      )}

      {/* FFprobe warning */}
      {ffprobeStatus === 'error' && (
        <div className="mb-4 rounded-lg bg-error/10 border border-error/30 p-3">
          <p className="text-sm text-error font-medium">FFprobe is not available</p>
          <p className="text-xs text-error/70 mt-1">
            {ffprobeError || 'Please install FFmpeg or configure the FFmpeg path.'}
          </p>
        </div>
      )}

      {!hasContent ? (
        <div
          className="flex flex-1 items-center justify-center"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-12 py-16 text-center transition-colors ${
            isDragging ? 'border-accent bg-accent/10' : 'border-sidebar-active'
          }`}>
            <svg className={`h-12 w-12 ${isDragging ? 'text-accent' : 'text-sidebar-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <div>
              <p className="text-lg font-medium text-sidebar-text">
                {isDragging ? (isBusy ? t('compress.busyCannotAdd') : t('compress.dragDropActive')) : t('compress.dropzone')}
              </p>
              <p className="mt-1 text-sm text-sidebar-muted">{t('compress.formats')}</p>
            </div>
            <div className="mt-2 flex gap-3">
              <button
                onClick={handleSelectVideos}
                disabled={isBusy}
                title={isBusy ? t('compress.waitUntilDoneOrCancel') : undefined}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-workspace-bg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('compress.addVideos')}
              </button>
              <button
                onClick={handleSelectFolder}
                disabled={isBusy}
                title={isBusy ? t('compress.waitUntilDoneOrCancel') : undefined}
                className="rounded-lg border border-sidebar-active px-4 py-2 text-sm font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('compress.addFolder')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto min-h-0">
          <div className="flex gap-3 items-center">
            <button
              onClick={handleSelectVideos}
              disabled={isBusy}
              title={isBusy ? t('compress.waitUntilDoneOrCancel') : undefined}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-workspace-bg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('compress.addVideos')}
            </button>
            <button
              onClick={handleSelectFolder}
              disabled={isBusy}
              title={isBusy ? t('compress.waitUntilDoneOrCancel') : undefined}
              className="rounded-lg border border-sidebar-active px-4 py-2 text-sm font-medium text-sidebar-text hover:bg-sidebar-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('compress.addFolder')}
            </button>
            {hasScanned && !hasAnalyzing && (
              <button onClick={handleAnalyzeAll} className="rounded-lg bg-accent/20 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/30 transition-colors">
                {t('compress.analyzeAll')}
              </button>
            )}
            {hasAnalyzing && (
              <span className="text-sm text-warning">{t('compress.analyzing')}</span>
            )}
          </div>

          {/* Scan progress indicator */}
          {scanProgress && scanProgress.status === 'scanning' && (
            <div className="rounded-lg border border-topbar-border bg-sidebar-bg p-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <p className="text-sm text-sidebar-text">{t('compress.scanning')}</p>
              </div>
              {scanProgress.currentPath && (
                <p className="mt-1 text-xs text-sidebar-muted truncate">
                  {t('compress.scanningPath')}: {scanProgress.currentPath}
                </p>
              )}
              <div className="mt-2 flex gap-4 text-xs text-sidebar-muted">
                <span>{scanProgress.scannedFolders} {t('compress.scanSummaryFolders')}</span>
                <span>{scanProgress.foundVideos} {t('compress.videos')}</span>
                <span>{scanProgress.skippedFiles} {t('compress.scanSummarySkippedFiles')}</span>
              </div>
            </div>
          )}

          {/* No videos found message */}
          {scanSummary && videos.length === 0 && skipped.length > 0 && !scanProgress && (
            <div className="rounded-lg border border-topbar-border bg-sidebar-bg p-3">
              <p className="text-sm text-sidebar-text">{t('compress.noVideosFound')}</p>
              <div className="mt-2 flex gap-4 text-xs text-sidebar-muted">
                <span>{scanSummary.scannedFolders} {t('compress.scanSummaryFolders')}</span>
                <span>{scanSummary.skippedFolders > 0 && `${scanSummary.skippedFolders} ${t('compress.scanSummarySkippedFolders')}`}</span>
              </div>
            </div>
          )}

          {/* Enhanced scan summary */}
          {skipped.length > 0 && !scanProgress && (
            <div className="rounded-lg border border-topbar-border bg-sidebar-bg p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
                {t('compress.scanSummary')}
              </p>
              <p className="text-sm text-sidebar-text">
                {t('compress.found')} {videos.length} {t('compress.videos')}
                {scanSummary && (
                  <span className="ml-2 text-sidebar-muted">
                    &middot; {scanSummary.scannedFolders} {t('compress.scanSummaryFolders')}
                  </span>
                )}
                <span className="ml-2 text-warning">
                  &middot; {t('compress.skipped')} {skipped.length} {t('compress.files')}
                </span>
                {scanSummary && scanSummary.skippedFolders > 0 && (
                  <span className="ml-2 text-warning">
                    &middot; {scanSummary.skippedFolders} {t('compress.scanSummarySkippedFolders')}
                  </span>
                )}
              </p>
              <ul className="mt-2 space-y-1 max-h-32 overflow-auto">
                {skipped.map((s, i) => (
                  <li key={`${s.path}-${i}`} className="text-xs text-sidebar-muted truncate">
                    {s.path.split(/[/\\]/).pop()} &mdash; {t(reasonKeys[s.reason] || 'compress.unknownError')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Smart Shrink Plan */}
          <SmartShrinkPlanPanel
            plan={smartPlan}
            selectedGoal={selectedGoal}
            onGoalChange={setSelectedGoal}
            onApply={handleApplyPlan}
            onRegenerate={handleRegenerate}
            onToggleSkipped={handleToggleSkipped}
            onResetOverrides={handleResetOverrides}
            showSkipped={showSkipped}
            hasUserOverrides={hasUserOverrides}
            visible={readyVideos.length > 0 && !queueRunning && !queueStarted}
            onShowConfirm={handleShowConfirm}
            confirmFilterActive={showConfirmOnly}
            actualConfirmCount={actualConfirmCount}
          />

          {/* Smart Plan notice banner */}
          {planAppliedBySmart && smartPlan && (
            <div className="mt-2 rounded-lg border border-accent/20 bg-accent/5 px-4 py-2.5 text-xs text-accent/80">
              {t('smartShrink.notice.smartPlanControlling')}
            </div>
          )}

          {/* Smart Plan statistics bar */}
          {smartPlan && videos.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-topbar-border bg-sidebar-bg px-4 py-2 text-xs">
              <span className="text-sidebar-muted">{t('compress.processable')} <b className="text-sidebar-text">{readyVideos.length}</b></span>
              <span className="text-sidebar-muted/30">&middot;</span>
              <span className="text-sidebar-muted">{t('compress.selectedForCompress')} <b className="text-accent">{compressibleVideos.length}</b></span>
              {actualConfirmCount > 0 && (
                <>
                  <span className="text-sidebar-muted/30">&middot;</span>
                  <button onClick={handleShowConfirm} className="text-sidebar-muted hover:text-yellow-400 transition-colors">
                    {t('compress.needsConfirm')} <b className={showConfirmOnly ? 'text-yellow-300 underline' : 'text-yellow-400'}>{actualConfirmCount}</b>
                  </button>
                </>
              )}
              {smartPlan.summary.skipCount > 0 && (
                <>
                  <span className="text-sidebar-muted/30">&middot;</span>
                  <span className="text-sidebar-muted">{t('compress.skippedByPlan')} <b className="text-sidebar-muted">{smartPlan.summary.skipCount}</b></span>
                </>
              )}
            </div>
          )}

          {/* Overall Progress — always visible when queue has started */}
          <OverallProgress
            progress={queueProgress}
            queueStatus={queueProgress?.status || 'idle'}
            skippedCount={planSkippedCount}
            totalPlanned={compressibleVideos.length}
            visible={queueStarted}
            queueStarted={queueStarted}
          />

          {/* Confirm filter empty state */}
          {showConfirmOnly && displayVideos.length === 0 && (
            <div className="rounded-lg border border-topbar-border bg-sidebar-bg p-4 text-center">
              <p className="text-sm text-sidebar-muted">{t('smartShrink.notice.noConfirmVideos')}</p>
              <button
                onClick={() => setShowConfirmOnly(false)}
                className="mt-2 text-xs text-accent hover:underline"
              >
                {t('smartShrink.action.hideConfirm')}
              </button>
            </div>
          )}

          <div className="flex-1 overflow-auto rounded-lg border border-topbar-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-sidebar-bg text-left text-xs uppercase tracking-wider text-sidebar-muted">
                <tr>
                  <th className="w-8 px-2 py-3"></th>
                  <th className="px-4 py-3">{t('compress.fileName')}</th>
                  <th className="px-4 py-3">{t('compress.fileSize')}</th>
                  <th className="px-4 py-3">{t('compress.duration')}</th>
                  <th className="px-4 py-3">{t('compress.resolution')}</th>
                  <th className="px-4 py-3">{t('compress.codec')}</th>
                  <th className="px-4 py-3">{t('compress.bitrate')}</th>
                  <th className="px-4 py-3">FPS</th>
                  <th className="px-4 py-3">{t('compress.status')}</th>
                  <th className="px-4 py-3 text-right">{t('compress.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {displayVideos.slice(0, visibleRows).map((v) => (
                  <tr key={v.id} className="border-t border-topbar-border hover:bg-sidebar-hover/30">
                    <td className="w-8 px-2 py-2.5 text-center">
                      {v.status === 'ready' && (
                        <input
                          type="checkbox"
                          checked={v.selectedForCompression !== false}
                          onChange={(e) => setSelectedForCompression(v.id, e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-sidebar-border accent-accent"
                          title={v.selectedForCompression !== false ? t('smartShrink.badge.compress') : t('smartShrink.badge.skip')}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-sidebar-text">{v.fileName}</p>
                      <p className="text-xs text-sidebar-muted truncate max-w-xs">{v.filePath}</p>
                      {v.shrinkAdvice && v.status === 'ready' && (
                        <VideoAdviceBadge advice={v.shrinkAdvice} />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-sidebar-text">{formatBytes(v.fileSize)}</td>
                    <td className="px-4 py-2.5 text-sidebar-text">{v.duration ? formatDuration(v.duration) : '--:--'}</td>
                    <td className="px-4 py-2.5 text-sidebar-text">
                      {v.width && v.height ? `${v.width}x${v.height}` : '--'}
                    </td>
                    <td className="px-4 py-2.5 text-sidebar-text">
                      {v.videoCodec || '--'}
                    </td>
                    <td className="px-4 py-2.5 text-sidebar-text">
                      {v.bitrate ? `${Math.round(v.bitrate / 1000)} kbps` : '--'}
                    </td>
                    <td className="px-4 py-2.5 text-sidebar-text">
                      {v.frameRate || '--'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={v.status} />
                      {v.status === 'compressing' && v.compressionProgress && (
                        <div className="mt-1.5 space-y-1">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sidebar-bg">
                            <div
                              className="h-full bg-accent transition-all duration-300"
                              style={{ width: `${v.compressionProgress.percent}%` }}
                            />
                          </div>
                          <p className="text-xs text-accent">
                            {v.compressionProgress.percent.toFixed(1)}%
                          </p>
                        </div>
                      )}
                      {v.status === 'completed' && v.compressionResult && (
                        <p className="mt-1 text-xs text-success">
                          {formatBytes(v.compressionResult.savedSize)} {t('plan.saved')}
                        </p>
                      )}
                      {v.status === 'failed' && v.errorMessage && (
                        <p className="mt-1 text-xs text-error truncate max-w-[160px]" title={v.errorMessage}>
                          {translateError(t, v.errorMessage)}
                        </p>
                      )}
                      {v.status === 'skipped' && (
                        <p className="mt-1 text-xs text-gray-400">
                          {t('status.skipped')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {v.status === 'compressing' || v.status === 'pending' ? (
                        queueRunning ? (
                          <button
                            onClick={handleCancelQueue}
                            className="text-xs text-warning hover:underline"
                          >
                            {t('plan.cancelQueue')}
                          </button>
                        ) : null
                      ) : (
                        <button
                          onClick={() => removeVideo(v.id)}
                          className="text-xs text-error hover:underline"
                        >
                          {t('compress.remove')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {displayVideos.length > visibleRows && (
              <div className="border-t border-topbar-border bg-sidebar-bg p-3 text-center">
                <button
                  onClick={() => setVisibleRows((prev) => prev + VISIBLE_ROW_LIMIT)}
                  className="text-sm text-accent hover:underline"
                >
                  {t('compress.showMoreRemaining', { count: displayVideos.length - visibleRows })}
                </button>
              </div>
            )}
          </div>

          {/* Compression Planning Section */}
          {videos.some((v) => v.status === 'ready') && (
            <div className="mt-2 rounded-lg border border-topbar-border bg-sidebar-bg">
              {/* Advanced settings toggle header */}
              <button
                onClick={() => setShowAdvancedSettings((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-sidebar-hover/30 transition-colors rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-sidebar-text">{t('smartShrink.advancedSettings')}</span>
                  {!showAdvancedSettings && (
                    <span className="text-[11px] text-sidebar-muted">
                      {planAppliedBySmart ? (
                        <span className="text-accent/70">{t('smartShrink.badge.smartControlling')}</span>
                      ) : (
                        t(`mode.${compressionMode === 'compatible_high_quality' ? 'compatibleHighQuality' : compressionMode === 'quality_first' ? 'qualityFirst' : compressionMode === 'smallest_size' ? 'smallestSize' : compressionMode === 'target_size_fast' ? 'targetSizeFast' : compressionMode === 'target_size_accurate' ? 'targetSizeAccurate' : compressionMode === 'heavy_balanced' ? 'heavyBalanced' : 'balanced'}`)
                      )}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-sidebar-muted">
                  {showAdvancedSettings ? t('smartShrink.action.collapseAdvanced') : t('smartShrink.action.expandAdvanced')}
                </span>
              </button>

              {/* Collapsible content */}
              {showAdvancedSettings && (
                <div className="space-y-3 px-4 pb-4 border-t border-topbar-border pt-3">
                  {planAppliedBySmart && (
                    <p className="text-[11px] text-accent/60 pb-1">
                      {t('smartShrink.notice.fallbackModeOnly')}
                    </p>
                  )}
                  <CompressionModeCards
                    selected={compressionMode}
                    onSelect={handleManualModeSelect}
                  />

                  <TargetSizePanel
                    visible={compressionMode === 'target_size_fast'}
                    targetSizeMB={targetSizeMB}
                    onChange={setTargetSizeMB}
                    accuracy={targetSizeAccuracy}
                    onAccuracyChange={setTargetSizeAccuracy}
                  />

                  <OutputSettingsPanel outputDir={null} />

                  {/* Hardware Acceleration Status */}
                  {hwAccelAvailable !== null && (
                    <div className="flex items-center gap-4 rounded-lg border border-topbar-border bg-sidebar-bg px-4 py-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${hwAccelAvailable ? 'bg-green-500' : 'bg-gray-500'}`} />
                        <span className="text-sidebar-muted">{t('settings.hwAccelAvailable')}:</span>
                        <span className={hwAccelAvailable ? 'text-green-400' : 'text-sidebar-muted'}>
                          {hwAccelAvailable ? t('settings.hwAccelYes') : t('settings.hwAccelNo')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sidebar-muted">{t('settings.recommendedMode')}:</span>
                        <span className="text-sidebar-text">
                          {hwAccelAvailable ? t('settings.recommendedAuto') : t('settings.recommendedCpu')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sticky bottom action bar */}
              <div className="flex items-center gap-3 border-t border-topbar-border px-4 py-2.5">
                <button
                  onClick={handleStartBatch}
                  disabled={generating || queueRunning || compressibleVideos.length === 0 || ((compressionMode === 'target_size_fast') && !targetSizeMB)}
                  className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-workspace-bg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? t('plan.generating') : queueRunning ? t('plan.queueRunning') : compressibleVideos.length > 0 ? t('plan.compressSelectedCount', { count: compressibleVideos.length }) : t('plan.compressSelected')}
                </button>
                {queueRunning && (
                  <button onClick={handleCancelQueue} className="text-sm text-warning hover:underline">
                    {t('plan.cancelQueue')}
                  </button>
                )}
                {compressibleVideos.length >= 1 && !queueRunning && (
                  <span className="text-xs text-sidebar-muted">
                    ({compressibleVideos.length} {t('compress.videos')})
                  </span>
                )}
                {readyVideos.length > 0 && compressibleVideos.length === 0 && !queueRunning && (
                  <span className="text-xs text-warning/70">
                    {t('smartShrink.notice.noSelectedVideos')}
                  </span>
                )}
              </div>

              {/* Pre-compression ETA */}
              {effectiveMode === 'target_size_accurate' && compressibleVideos.length > 0 && !queueRunning && !queueStarted && (
                <div className="px-4 pb-3">
                  <p className="text-xs text-sidebar-muted">{t('plan.twoPassProbeDisabled')}</p>
                </div>
              )}
              <PreCompressionEta
                eta={preEta}
                visible={compressibleVideos.length > 0 && !queueRunning && !queueStarted && effectiveMode !== 'target_size_accurate'}
                onQuickProbe={handleQuickProbe}
                probing={probing}
              />

              {/* Plan warnings (non-blocking) */}
              {planResult && planResult.success && planResult.warnings && planResult.warnings.length > 0 && (
                <div className="mx-4 mb-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <p className="text-xs font-semibold text-warning">{t('plan.warnings')}:</p>
                  {planResult.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-warning/80">{w}</p>
                  ))}
                </div>
              )}

              {/* Plan error */}
              {planResult && !planResult.success && (
                <div className="mx-4 mb-3 rounded-lg border border-error/30 bg-error/10 p-3">
                  <p className="text-sm font-medium text-error">{t('plan.planError')}</p>
                  <p className="mt-1 text-xs text-error/80">{planResult.error}</p>
                </div>
              )}

              {/* Disk space warning */}
              {diskSpaceWarning && (
                <div className="mx-4 mb-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <p className="text-xs font-semibold text-warning">{t('plan.diskSpaceWarning')}</p>
                  <p className="text-xs text-warning/80">{diskSpaceWarning}</p>
                </div>
              )}

              {/* Output dir error */}
              {outputDirError && (
                <div className="mx-4 mb-3 rounded-lg border border-error/30 bg-error/10 p-3">
                  <p className="text-sm font-medium text-error">{t('plan.outputDirError')}</p>
                  <p className="mt-1 text-xs text-error/80">{outputDirError}</p>
                </div>
              )}

              {/* Queue Result Summary */}
              {queueResult && (() => {
                const completedItems = queueResult.items.filter((it) => it.status === 'completed' && it.result)
                const originalTotal = completedItems.reduce((sum, it) => sum + it.result!.originalSize, 0)
                const outputTotal = completedItems.reduce((sum, it) => sum + it.result!.outputSize, 0)
                const savedTotal = originalTotal - outputTotal
                const savedPercent = originalTotal > 0 ? (savedTotal / originalTotal * 100) : 0

                return (
                  <div className={`rounded-lg border p-3 space-y-3 ${
                    queueResult.status === 'completed' ? 'border-success/30 bg-success/10' :
                    queueResult.status === 'canceled' ? 'border-orange-500/30 bg-orange-500/10' :
                    queueResult.status === 'failed' ? 'border-error/30 bg-error/10' :
                    'border-warning/30 bg-warning/10'
                  }`}>
                    <p className={`text-sm font-medium ${
                      queueResult.status === 'completed' ? 'text-success' :
                      queueResult.status === 'canceled' ? 'text-orange-400' :
                      queueResult.status === 'failed' ? 'text-error' :
                      'text-warning'
                    }`}>
                      {queueResult.status === 'completed' ? t('plan.queueComplete') :
                       queueResult.status === 'canceled' ? t('plan.queueCanceled') :
                       queueResult.status === 'failed' ? t('plan.queueFailed') :
                       t('plan.queuePartialFailed')}
                    </p>

                    {/* Totals */}
                    <div className="grid grid-cols-3 gap-3 text-xs text-sidebar-text">
                      <div>
                        <span className="text-sidebar-muted">{t('plan.totalFiles')}: </span>
                        {queueResult.totalFiles}
                        {queueResult.completedFiles > 0 && <span className="text-success ml-1">({queueResult.completedFiles} ok)</span>}
                        {queueResult.failedFiles > 0 && <span className="text-error ml-1">({queueResult.failedFiles} fail)</span>}
                        {queueResult.canceledFiles > 0 && <span className="text-orange-400 ml-1">({queueResult.canceledFiles} cancel)</span>}
                      </div>
                      <div>
                        <span className="text-sidebar-muted">{t('plan.originalTotalSize')}: </span>
                        {formatBytes(originalTotal)}
                      </div>
                      <div>
                        <span className="text-sidebar-muted">{t('plan.outputTotalSize')}: </span>
                        {formatBytes(outputTotal)}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-xs text-sidebar-text">
                      <div>
                        <span className="text-sidebar-muted">{t('plan.totalSaved')}: </span>
                        <span className="text-success">{formatBytes(savedTotal)}</span>
                      </div>
                      <div>
                        <span className="text-sidebar-muted">{t('plan.totalSavedPercent')}: </span>
                        <span className="text-success">{savedPercent.toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="text-sidebar-muted">{t('plan.totalElapsed')}: </span>
                        {formatElapsed(queueElapsed)}
                      </div>
                    </div>

                    {/* Per-file results table */}
                    {queueResult.items.length > 0 && (
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-sidebar-muted border-b border-white/10">
                            <tr>
                              <th className="pb-1.5 pr-3 font-medium">{t('compress.fileName')}</th>
                              <th className="pb-1.5 pr-3 font-medium">{t('plan.originalSize')}</th>
                              <th className="pb-1.5 pr-3 font-medium">{t('plan.outputSize')}</th>
                              <th className="pb-1.5 pr-3 font-medium">{t('plan.saved')}</th>
                              <th className="pb-1.5 pr-3 font-medium">{t('compress.status')}</th>
                              <th className="pb-1.5 font-medium">{t('plan.outputPath')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {queueResult.items.map((it) => {
                              const v = videos.find((v) => v.id === it.id)
                              const statusColor = it.status === 'completed' ? 'text-success' : it.status === 'failed' ? 'text-error' : 'text-orange-400'
                              return (
                                <tr key={it.id} className="border-b border-white/5">
                                  <td className="py-1.5 pr-3 text-sidebar-text truncate max-w-[180px]" title={v?.fileName}>{v?.fileName || it.id}</td>
                                  <td className="py-1.5 pr-3 text-sidebar-muted">{it.result ? formatBytes(it.result.originalSize) : '--'}</td>
                                  <td className="py-1.5 pr-3 text-sidebar-muted">{it.result ? formatBytes(it.result.outputSize) : '--'}</td>
                                  <td className={`py-1.5 pr-3 ${it.result?.outputLargerThanInput ? 'text-yellow-400' : 'text-success'}`}>{it.result ? (it.result.outputLargerThanInput ? t('history.outputLargerThanInput') : `${Math.max(0, (1 - it.result.compressionRatio) * 100).toFixed(1)}%`) : '--'}</td>
                                  <td className={`py-1.5 pr-3 ${statusColor}`}>{t(statusKeys[it.status] || 'status.failed')}</td>
                                  <td className="py-1.5 text-sidebar-muted truncate max-w-[200px]" title={it.result?.outputPath || it.error}>{it.result?.outputPath?.split(/[/\\]/).pop() || it.error || '--'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Open Output Folder button */}
                    {completedItems.length > 0 && (() => {
                      const firstPath = completedItems[0].result!.outputPath
                      const lastSlash = Math.max(firstPath.lastIndexOf('/'), firstPath.lastIndexOf('\\'))
                      const folder = lastSlash > 0 ? firstPath.substring(0, lastSlash) : firstPath
                      return (
                        <button
                          onClick={() => window.api.openOutputFolder(folder)}
                          className="mt-1 text-xs text-accent hover:underline"
                        >
                          {t('plan.openOutputFolder')}
                        </button>
                      )
                    })()}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
