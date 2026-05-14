import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  ping: () => ipcRenderer.send('ping'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setLanguage: (lang: string) => ipcRenderer.send('set-language', lang),
  checkFFprobe: () => ipcRenderer.invoke('check-ffprobe'),
  checkFfmpegAvailability: () => ipcRenderer.invoke('check-ffmpeg-availability'),
  selectVideos: () => ipcRenderer.invoke('select-videos'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanPaths: (paths: string[], options?: { recursive?: boolean }) => ipcRenderer.invoke('scan-paths', paths, options),
  analyzeVideos: (videoList: { id: string; filePath: string }[]) =>
    ipcRenderer.invoke('analyze-videos', videoList),
  generatePlan: (input: unknown, mode: string, targetSizeMB?: number, saveStrategy?: unknown, conflictAction?: string) =>
    ipcRenderer.invoke('generate-plan', input, mode, targetSizeMB, saveStrategy, conflictAction),
  compressVideo: (plan: unknown, duration: number) =>
    ipcRenderer.invoke('compress-video', plan, duration),
  cancelCompression: () => ipcRenderer.send('cancel-compression'),
  startQueue: (items: unknown[]) =>
    ipcRenderer.invoke('start-queue', items),
  cancelQueue: () => ipcRenderer.send('cancel-queue'),
  cancelScan: () => ipcRenderer.send('cancel-scan'),
  cancelAnalysis: () => ipcRenderer.send('cancel-analysis'),
  checkOutputDir: (dir: string) => ipcRenderer.invoke('check-output-dir', dir),
  checkDiskSpace: (dir: string, totalInputBytes: number) => ipcRenderer.invoke('check-disk-space', dir, totalInputBytes),
  openOutputFolder: (folderPath: string) => ipcRenderer.send('open-output-folder', folderPath),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial: unknown) => ipcRenderer.invoke('settings:save', partial),
  getHistory: () => ipcRenderer.invoke('history:get'),
  addHistory: (data: unknown) => ipcRenderer.invoke('history:add', data),
  deleteHistory: (id: string) => ipcRenderer.invoke('history:delete', id),
  exportHistoryJSON: () => ipcRenderer.invoke('history:export-json'),
  exportHistoryCSV: () => ipcRenderer.invoke('history:export-csv'),
  detectConflict: (inputPath: string, outputPath: string) =>
    ipcRenderer.invoke('detect-conflict', inputPath, outputPath),
  getDeviceProfile: () => ipcRenderer.invoke('get-device-profile'),
  estimateEta: (videos: unknown[], mode: string, deviceProfile: unknown, probeSpeedX?: number) =>
    ipcRenderer.invoke('estimate-eta', videos, mode, deviceProfile, probeSpeedX),
  quickProbe: (inputPath: string, videoDuration: number, plan: unknown) =>
    ipcRenderer.invoke('quick-probe', inputPath, videoDuration, plan),
  getBenchmarks: () => ipcRenderer.invoke('benchmarks:get'),
  deleteBenchmark: (id: string) => ipcRenderer.invoke('benchmarks:delete', id),
  onVideoAnalyzed: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('video:analyzed', handler)
    return () => ipcRenderer.removeListener('video:analyzed', handler)
  },
  onCompressProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('video:compress-progress', handler)
    return () => ipcRenderer.removeListener('video:compress-progress', handler)
  },
  onQueueProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('queue:progress', handler)
    return () => ipcRenderer.removeListener('queue:progress', handler)
  },
  onQueueItemDone: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('queue:item-done', handler)
    return () => ipcRenderer.removeListener('queue:item-done', handler)
  },
  onTaskFinished: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('queue:task-finished', handler)
    return () => ipcRenderer.removeListener('queue:task-finished', handler)
  },
  onScanProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('scanner:progress', handler)
    return () => ipcRenderer.removeListener('scanner:progress', handler)
  },
  getFFmpegInfo: () => ipcRenderer.invoke('ffmpeg:get-info'),
  updateFFmpeg: () => ipcRenderer.invoke('ffmpeg:update'),
  openFFmpegFolder: () => ipcRenderer.invoke('ffmpeg:open-folder'),
  removeUpdatedFFmpeg: () => ipcRenderer.invoke('ffmpeg:remove-updated'),
  checkFFmpegUpdate: () => ipcRenderer.invoke('ffmpeg:check-update'),
  onFFmpegUpdateProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => callback(data)
    ipcRenderer.on('ffmpeg:update-progress', handler)
    return () => ipcRenderer.removeListener('ffmpeg:update-progress', handler)
  },
  getDroppedFilePaths: (files: File[]): string[] => {
    return files.map((file) => webUtils.getPathForFile(file))
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error (define in dts)
  window.electron = electronAPI
  // @ts-expect-error (define in dts)
  window.api = api
}
