import { ElectronAPI } from '@electron-toolkit/preload'

interface ScanProgressEvent {
  status: 'scanning' | 'completed' | 'failed' | 'canceled'
  currentPath?: string
  scannedFolders: number
  scannedFiles: number
  foundVideos: number
  skippedFiles: number
  skippedFolders: number
}

interface ScanResult {
  videos: ScannedVideo[]
  skipped: SkippedFile[]
  scannedFolders: number
  skippedFolders: number
  scannedFiles: number
}

interface ScannedVideo {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  extension: string
  status: 'scanned'
}

interface SkippedFile {
  path: string
  reason: 'unsupported_format' | 'permission_denied' | 'duplicate' | 'unknown_error' | 'symbolic_link_skipped' | 'output_directory_skipped'
}

interface DialogResult {
  canceled: boolean
  filePaths: string[]
}

interface FFprobeCheckResult {
  available: boolean
  error?: string
}

interface BinaryCheckResult {
  available: boolean
  path: string
  version?: string
  error?: string
}

interface FfmpegAvailability {
  ffmpeg: BinaryCheckResult
  ffprobe: BinaryCheckResult
}

interface VideoMetadata {
  duration: number
  width: number
  height: number
  format: string
  videoCodec: string
  audioCodec: string
  bitrate: number
  frameRate: number
}

interface VideoAnalyzedEvent {
  id: string
  success: boolean
  metadata?: VideoMetadata
  error?: string
}

type CompressionMode = 'balanced' | 'quality_first' | 'smallest_size' | 'target_size_fast' | 'target_size_accurate' | 'compatible_high_quality' | 'heavy_balanced'

type SaveStrategy =
  | { type: 'replace_original' }
  | { type: 'save_as'; outputDir: string }
  | { type: 'default' }

interface OutputPlan {
  inputPath: string
  ffmpegOutputPath: string
  finalOutputPath: string
  outputDir: string
  shouldReplaceOriginal: boolean
  shouldOverwriteExisting?: boolean
}

interface CompressionInput {
  filePath: string
  duration: number
  width: number
  height: number
  videoCodec: string
  bitrate: number
  frameRate: number
}

interface CompressionPlan {
  inputPath: string
  outputPath: string
  outputDir: string
  mode: CompressionMode
  ffmpegArgs: string[]
  warnings: string[]
  estimatedSizeMB?: number
  targetSizeMB?: number
  accuracyMode?: 'fast' | 'accurate'
  twoPass?: {
    pass1Args: string[]
    pass2Args: string[]
    passLogPath: string
  }
  outputPlan?: OutputPlan
}

type PlanResult =
  | { ok: true; plan: CompressionPlan }
  | { ok: false; reason: string }
  | { ok: false; conflict: true; message: string; conflictType: string }

interface GeneratePlanResult {
  success: boolean
  result?: PlanResult
  error?: string
}

interface CompressionProgress {
  percent: number
  elapsedSeconds: number
  remainingLabel: string
  remainingSeconds: number
  speed: string
  outTimeUs: number
}

interface CompressionResult {
  success: boolean
  originalSize: number
  outputSize: number
  savedSize: number
  compressionRatio: number
  outputPath: string
  error?: string
  targetSizeMB?: number
  actualSizeMB?: number
  sizeErrorPercent?: number
  accuracyMode?: 'fast' | 'accurate'
  outputLargerThanInput?: boolean
  noSaving?: boolean
}

type ConflictType = 'same_as_input' | 'existing_output_file'

interface ConflictInfo {
  inputPath: string
  outputPath: string
  conflictType: ConflictType
}

type ConflictResolution = 'overwrite' | 'rename' | 'skip' | 'cancel'

type QueueItemStatus = 'pending' | 'compressing' | 'completed' | 'failed' | 'canceled' | 'skipped'
type QueueStatus = 'idle' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'canceled'

interface QueueProgress {
  status: QueueStatus
  currentItem: {
    id: string
    fileName: string
    percent: number
    elapsedSeconds: number
    remainingLabel: string
    remainingSeconds: number
    speed: string
    phase?: 'single' | 'two_pass_analyze' | 'two_pass_encode'
  } | null
  overallPercent: number
  totalFiles: number
  completedFiles: number
  failedFiles: number
  canceledFiles: number
  skippedFiles: number
  elapsedSeconds?: number
  estimatedRemainingSeconds?: number
}

interface QueueItemResult {
  id: string
  status: QueueItemStatus
  result?: CompressionResult
  error?: string
  compressionElapsedSeconds?: number
}

interface QueueResult {
  status: QueueStatus
  totalFiles: number
  completedFiles: number
  failedFiles: number
  canceledFiles: number
  skippedFiles: number
  items: { id: string; status: QueueItemStatus; result?: CompressionResult; error?: string; compressionElapsedSeconds?: number; inputPath?: string }[]
  totalElapsedSeconds?: number
}

interface TaskFinishedResult {
  id: string
  filePath: string
  status: 'completed' | 'failed' | 'canceled' | 'skipped'
  result?: CompressionResult
  error?: string
  compressionElapsedSeconds?: number
}

interface TaskFinishedEvent {
  status: QueueStatus
  results: TaskFinishedResult[]
}

interface StartQueueResult {
  success: boolean
  result?: QueueResult
  error?: string
}

interface DirCheckResult {
  ok: boolean
  error?: string
}

interface SpaceCheckResult {
  ok: boolean
  availableBytes: number
  requiredBytes: number
  warning?: string
}

interface AppSettings {
  defaultOutputDir: string
  defaultCompressionMode: CompressionMode
  theme: 'dark' | 'light'
  autoOpenOutputFolder: boolean
}

interface HistoryTaskItem {
  videoId: string
  fileName: string
  inputPath: string
  outputPath?: string
  status: 'completed' | 'failed' | 'skipped' | 'canceled'
  originalSize?: number
  outputSize?: number
  savedSize?: number
  savedPercent?: number
  compressionElapsedSeconds?: number
  errorMessage?: string
  targetSizeMB?: number
  actualSizeMB?: number
  sizeErrorPercent?: number
  accuracyMode?: 'fast' | 'accurate'
  outputLargerThanInput?: boolean
  noSaving?: boolean
  mode?: string
}

interface ShrinkPlanSummary {
  goalId: string
  recommendedMode: string
  originalTotalBytes: number
  estimatedSavingBytesMin?: number
  estimatedSavingBytesMax?: number
  compressCount: number
  skipCount: number
  confirmCount: number
  highRiskCount: number
  applied: boolean
}

interface HistoryRecord {
  id: string
  createdAt: number
  totalFiles: number
  successCount: number
  failedCount: number
  originalTotalSize: number
  outputTotalSize: number
  savedSize: number
  savedPercent: number
  mode: string
  outputDir: string
  status: string
  saveStrategy?: string
  skippedCount?: number
  totalElapsedSeconds?: number
  results?: HistoryTaskItem[]
  shrinkPlanSummary?: ShrinkPlanSummary
}

interface DeviceProfile {
  platform: string
  cpuModel: string
  cpuCores: number
  totalMemoryBytes: number
  freeMemoryBytes: number
  ffmpegVersion: string | null
  availableHardwareEncoders: string[]
}

interface EtaEstimateInput {
  duration: number
  width: number
  height: number
  videoCodec: string
  bitrate: number
  frameRate?: number
}

interface VideoEtaEstimate {
  videoIndex: number
  durationSeconds: number
  pixelFactor: number
  estimatedSecondsMin: number
  estimatedSecondsMax: number
}

interface EtaEstimateResult {
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
    perVideo: VideoEtaEstimate[]
  }
}

interface EtaEstimateUnavailable {
  available: false
  reasons: string[]
}

type ResolutionBucket = '480p' | '720p' | '1080p' | '1440p' | '4k' | 'unknown'

interface CompressionBenchmark {
  id: string
  mode: CompressionMode
  resolutionBucket: ResolutionBucket
  outputCodec: string
  encoderType: 'cpu' | 'gpu' | 'unknown'
  videoDurationSeconds: number
  actualCompressionSeconds: number
  speedMultiplier: number
  createdAt: number
}

type FFmpegSource = 'bundled' | 'updated' | 'system' | 'none'

interface FFmpegUpdateMetadata {
  provider: string
  version?: string
  assetName?: string
  assetId?: string
  downloadUrl?: string
  downloadedAt: string
  ffmpegVersion?: string
  ffprobeVersion?: string
}

interface FFmpegInfo {
  ffmpegPath: string
  ffprobePath: string
  source: FFmpegSource
  ffmpegVersion?: string
  ffprobeVersion?: string
  isAvailable: boolean
  errorMessage?: string
  updateMetadata?: FFmpegUpdateMetadata
}

interface FFmpegUpdateProgress {
  status: 'idle' | 'checking' | 'downloading' | 'extracting' | 'verifying' | 'completed' | 'failed'
  percent?: number
  message?: string
  errorMessage?: string
}

type FFmpegUpdateResult =
  | { ok: true; info: FFmpegInfo; alreadyUpToDate?: boolean }
  | { ok: false; errorMessage: string; progress?: FFmpegUpdateProgress }

type FFmpegRemoveResult =
  | { ok: true; info: FFmpegInfo }
  | { ok: false; errorMessage: string }

type FFmpegOpenFolderResult =
  | { ok: true }
  | { ok: false; errorMessage: string }

interface FFmpegUpdateCheckLatest {
  provider: string
  version?: string
  assetName?: string
  assetId?: string
  downloadUrl?: string
}

type FFmpegUpdateCheckResult =
  | { ok: true; currentInfo: FFmpegInfo; isLatest: true; latest?: FFmpegUpdateCheckLatest }
  | { ok: true; currentInfo: FFmpegInfo; isLatest: false; latest: FFmpegUpdateCheckLatest; reason?: string }
  | { ok: false; currentInfo?: FFmpegInfo; errorMessage: string }

interface Api {
  ping: () => void
  getAppVersion: () => Promise<string>
  setLanguage: (lang: string) => void
  checkFFprobe: () => Promise<FFprobeCheckResult>
  checkFfmpegAvailability: () => Promise<FfmpegAvailability>
  selectVideos: () => Promise<DialogResult>
  selectFolder: () => Promise<DialogResult>
  scanPaths: (paths: string[], options?: { recursive?: boolean }) => Promise<ScanResult>
  analyzeVideos: (videoList: { id: string; filePath: string }[]) => Promise<{ done: boolean }>
  generatePlan: (input: CompressionInput, mode: CompressionMode, targetSizeMB?: number, saveStrategy?: SaveStrategy, conflictAction?: ConflictResolution) => Promise<GeneratePlanResult>
  compressVideo: (plan: CompressionPlan, duration: number) => Promise<CompressionResult>
  cancelCompression: () => void
  startQueue: (items: { id: string; plan: CompressionPlan; duration: number; height?: number }[]) => Promise<StartQueueResult>
  cancelQueue: () => void
  cancelScan: () => void
  cancelAnalysis: () => void
  checkOutputDir: (dir: string) => Promise<DirCheckResult>
  checkDiskSpace: (dir: string, totalInputBytes: number) => Promise<SpaceCheckResult>
  openOutputFolder: (folderPath: string) => void
  getSettings: () => Promise<AppSettings>
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  getHistory: () => Promise<HistoryRecord[]>
  addHistory: (data: Omit<HistoryRecord, 'id' | 'createdAt'>) => Promise<HistoryRecord>
  deleteHistory: (id: string) => Promise<void>
  exportHistoryJSON: () => Promise<{ ok: true; filePath: string } | { ok: false; canceled?: boolean; error?: string }>
  exportHistoryCSV: () => Promise<{ ok: true; filePath: string } | { ok: false; canceled?: boolean; error?: string }>
  detectConflict: (inputPath: string, outputPath: string) => Promise<ConflictInfo | null>
  getDeviceProfile: () => Promise<DeviceProfile>
  estimateEta: (videos: EtaEstimateInput[], mode: CompressionMode, deviceProfile: DeviceProfile, probeSpeedX?: number) => Promise<EtaEstimateResult | EtaEstimateUnavailable>
  quickProbe: (inputPath: string, videoDuration: number, plan: CompressionPlan) => Promise<{ success: boolean; speedX?: number; error?: string }>
  getBenchmarks: () => Promise<CompressionBenchmark[]>
  deleteBenchmark: (id: string) => Promise<void>
  onVideoAnalyzed: (callback: (data: VideoAnalyzedEvent) => void) => () => void
  onCompressProgress: (callback: (data: CompressionProgress) => void) => () => void
  onQueueProgress: (callback: (data: QueueProgress) => void) => () => void
  onQueueItemDone: (callback: (data: QueueItemResult) => void) => () => void
  onTaskFinished: (callback: (data: TaskFinishedEvent) => void) => () => void
  onScanProgress: (callback: (data: ScanProgressEvent) => void) => () => void
  getFFmpegInfo: () => Promise<FFmpegInfo>
  updateFFmpeg: () => Promise<FFmpegUpdateResult>
  openFFmpegFolder: () => Promise<FFmpegOpenFolderResult>
  removeUpdatedFFmpeg: () => Promise<FFmpegRemoveResult>
  checkFFmpegUpdate: () => Promise<FFmpegUpdateCheckResult>
  onFFmpegUpdateProgress: (callback: (data: FFmpegUpdateProgress) => void) => () => void
  getDroppedFilePaths: (files: File[]) => string[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
