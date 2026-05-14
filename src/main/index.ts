import { app, shell, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { scanPaths, type ScanProgressEvent } from './modules/file-scanner'
import { analyzeVideo } from './modules/video-analyzer'
import {
  checkFFmpegAvailable, checkFFprobeAvailable,
  getFFmpegInfo, updateFFmpeg, openFFmpegFolder,
  removeUpdatedFFmpeg, setActiveCompression,
  repairFFmpegUpdateState, checkFFmpegUpdate
} from './modules/ffmpeg-manager'
import { generatePlan, type CompressionMode, type CompressionInput, type CompressionPlan } from './modules/compression-planner'
import type { SaveStrategy, ConflictAction } from './modules/output-manager'
import { runCompression } from './modules/ffmpeg-runner'
import { TaskQueue } from './modules/task-queue'
import { checkOutputDir, checkDiskSpace, detectConflict } from './modules/output-manager'
import { getSettings, saveSettings } from './modules/settings-store'
import { getHistory, addHistory, deleteHistory, exportHistoryJSON, exportHistoryCSV } from './modules/history-store'
import { getDeviceProfile } from './modules/device-profiler'
import { estimateEta, runQuickProbe } from './modules/eta-estimator'
import { addBenchmark, getResolutionBucket, getAllBenchmarks, deleteBenchmark } from './modules/benchmark-store'

let mainWindow: BrowserWindow | null = null
let currentLang = 'en'
let activeCancel: (() => void) | null = null
let activeQueue: TaskQueue | null = null
let activeScanAbortController: AbortController | null = null
let activeAnalysisAbortController: AbortController | null = null

const menuLabels: Record<string, Record<string, string>> = {
  en: {
    file: 'File',
    quit: 'Quit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Toggle Developer Tools',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    resetZoom: 'Reset Zoom',
    toggleFullscreen: 'Toggle Fullscreen',
    window: 'Window',
    minimize: 'Minimize',
    close: 'Close'
  },
  zh: {
    file: '文件',
    quit: '退出',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '切换开发者工具',
    zoomIn: '放大',
    zoomOut: '缩小',
    resetZoom: '重置缩放',
    toggleFullscreen: '切换全屏',
    window: '窗口',
    minimize: '最小化',
    close: '关闭'
  }
}

function buildMenu(lang: string): void {
  const labels = menuLabels[lang] || menuLabels['en']

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: labels.file,
      submenu: [
        { label: labels.quit, role: 'quit' }
      ]
    },
    {
      label: labels.edit,
      submenu: [
        { label: labels.undo, role: 'undo' },
        { label: labels.redo, role: 'redo' },
        { type: 'separator' },
        { label: labels.cut, role: 'cut' },
        { label: labels.copy, role: 'copy' },
        { label: labels.paste, role: 'paste' },
        { label: labels.selectAll, role: 'selectAll' }
      ]
    },
    {
      label: labels.view,
      submenu: [
        { label: labels.reload, role: 'reload' },
        { label: labels.forceReload, role: 'forceReload' },
        { label: labels.toggleDevTools, role: 'toggleDevTools' },
        { type: 'separator' },
        { label: labels.zoomIn, role: 'zoomIn' },
        { label: labels.zoomOut, role: 'zoomOut' },
        { label: labels.resetZoom, role: 'resetZoom' },
        { type: 'separator' },
        { label: labels.toggleFullscreen, role: 'togglefullscreen' }
      ]
    },
    {
      label: labels.window,
      submenu: [
        { label: labels.minimize, role: 'minimize' },
        { label: labels.close, role: 'close' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  buildMenu(currentLang)

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    center: true,
    backgroundColor: '#11111b',
    icon: is.dev ? join(process.cwd(), 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Startup repair: fix any interrupted FFmpeg update state
  await repairFFmpegUpdateState()

  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.on('set-language', (_event, lang: string) => {
    currentLang = lang
    buildMenu(lang)
  })

  ipcMain.handle('check-ffprobe', async () => {
    return checkFFprobeAvailable()
  })

  ipcMain.handle('check-ffmpeg-availability', async () => {
    const [ffmpeg, ffprobe] = await Promise.all([
      checkFFmpegAvailable(),
      checkFFprobeAvailable()
    ])
    return { ffmpeg, ffprobe }
  })

  ipcMain.handle('select-videos', async () => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] }]
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle('select-folder', async () => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  })

  ipcMain.handle('scan-paths', async (_event, paths: string[], options?: { recursive?: boolean }) => {
    // Cancel any previous scan
    if (activeScanAbortController) {
      activeScanAbortController.abort()
    }
    const abortController = new AbortController()
    activeScanAbortController = abortController

    try {
      const result = await scanPaths(paths, {
        recursive: options?.recursive,
        signal: abortController.signal,
        onProgress: (progress: ScanProgressEvent) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scanner:progress', progress)
          }
        }
      })
      return result
    } catch (err) {
      if (err instanceof Error && err.name === 'ScanCanceledError') {
        // Scan was canceled — return empty result instead of throwing
        return { videos: [], skipped: [], scannedFolders: 0, skippedFolders: 0, scannedFiles: 0 }
      }
      throw err
    } finally {
      if (activeScanAbortController === abortController) {
        activeScanAbortController = null
      }
    }
  })

  ipcMain.on('cancel-scan', () => {
    if (activeScanAbortController) {
      activeScanAbortController.abort()
      activeScanAbortController = null
    }
  })

  ipcMain.handle('analyze-videos', async (_event, videoList: { id: string; filePath: string }[]) => {
    // Cancel any previous analysis
    if (activeAnalysisAbortController) {
      activeAnalysisAbortController.abort()
    }
    const abortController = new AbortController()
    activeAnalysisAbortController = abortController
    const signal = abortController.signal

    const MAX_CONCURRENT = 2
    let index = 0

    async function runNext(): Promise<void> {
      while (index < videoList.length) {
        if (signal.aborted) break
        if (!mainWindow || mainWindow.isDestroyed()) break
        const video = videoList[index++]
        const result = await analyzeVideo(video.filePath)
        if (signal.aborted) break
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('video:analyzed', {
            id: video.id,
            success: result.success,
            metadata: result.metadata,
            error: result.error
          })
        }
      }
    }

    try {
      const workers = Array.from({ length: Math.min(MAX_CONCURRENT, videoList.length) }, () => runNext())
      await Promise.all(workers)
      return { done: true }
    } finally {
      if (activeAnalysisAbortController === abortController) {
        activeAnalysisAbortController = null
      }
    }
  })

  ipcMain.on('cancel-analysis', () => {
    if (activeAnalysisAbortController) {
      activeAnalysisAbortController.abort()
      activeAnalysisAbortController = null
    }
  })

  ipcMain.handle('generate-plan', async (_event, input: CompressionInput, mode: CompressionMode, targetSizeMB?: number, saveStrategy?: SaveStrategy, conflictAction?: ConflictAction) => {
    try {
      const result = await generatePlan(input, mode, targetSizeMB, saveStrategy, conflictAction)
      return { success: true, result }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  ipcMain.handle('detect-conflict', async (_event, inputPath: string, outputPath: string) => {
    return detectConflict(inputPath, outputPath)
  })

  ipcMain.handle('compress-video', async (_event, plan: CompressionPlan, duration: number) => {
    if (activeCancel) {
      return { success: false, error: 'Another compression is already running' }
    }

    const { promise, cancel } = runCompression(plan, duration, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('video:compress-progress', progress)
      }
    })
    activeCancel = cancel
    setActiveCompression(true)

    try {
      const result = await promise
      return result
    } finally {
      activeCancel = null
      setActiveCompression(false)
    }
  })

  ipcMain.on('cancel-compression', () => {
    if (activeCancel) {
      activeCancel()
      activeCancel = null
    }
  })

  ipcMain.handle('start-queue', async (_event, items: { id: string; plan: CompressionPlan; duration: number; height?: number }[]) => {
    if (activeQueue && activeQueue.getStatus() === 'running') {
      return { success: false, error: 'A queue is already running' }
    }

    const queue = new TaskQueue(items)
    activeQueue = queue
    setActiveCompression(true)

    // Track compression start times for benchmark recording
    const compressStartTimes = new Map<string, number>()
    const itemLookup = new Map<string, { duration: number; height: number; mode: string; outputCodec: string }>()
    for (const item of items) {
      // Resolve outputCodec from plan's ffmpegArgs (look for libx264, libx265, etc.)
      const args = item.plan.ffmpegArgs
      let outputCodec = 'h264'
      for (const arg of args) {
        if (arg === 'libx265' || arg === 'hevc') { outputCodec = 'hevc'; break }
        if (arg === 'libx264' || arg === 'h264') { outputCodec = 'h264'; break }
        if (arg === 'libvpx-vp9' || arg === 'vp9') { outputCodec = 'vp9'; break }
        if (arg === 'libaom-av1' || arg === 'av1') { outputCodec = 'av1'; break }
      }
      itemLookup.set(item.id, {
        duration: item.duration,
        height: item.height ?? 0,
        mode: item.plan.mode,
        outputCodec
      })
    }

    queue.on('progress', (progress) => {
      // Track when a video starts compressing
      if (progress.currentItem && progress.currentItem.percent < 1) {
        if (!compressStartTimes.has(progress.currentItem.id)) {
          compressStartTimes.set(progress.currentItem.id, Date.now())
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('queue:progress', progress)
      }
    })

    queue.on('item-done', (itemResult) => {
      // Record benchmark for completed items
      if (itemResult.status === 'completed' && itemResult.result?.success) {
        const startTime = compressStartTimes.get(itemResult.id)
        const lookup = itemLookup.get(itemResult.id)
        if (startTime && lookup && lookup.duration > 0) {
          const actualSeconds = (Date.now() - startTime) / 1000
          if (actualSeconds > 0.5) {
            const resolutionBucket = getResolutionBucket(lookup.height)
            addBenchmark(app.getPath('userData'), {
              mode: lookup.mode as any,
              resolutionBucket,
              outputCodec: lookup.outputCodec,
              encoderType: 'cpu',
              videoDurationSeconds: lookup.duration,
              actualCompressionSeconds: actualSeconds
            }).catch((err) => {
              console.error('[benchmark] Failed to save:', err)
            })
          }
        }
      }
      compressStartTimes.delete(itemResult.id)

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('queue:item-done', itemResult)
      }
    })

    queue.on('task-finished', (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('queue:task-finished', event)
      }
    })

    try {
      const result = await queue.start()
      return { success: true, result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    } finally {
      if (activeQueue === queue) {
        activeQueue = null
      }
      setActiveCompression(false)
    }
  })

  ipcMain.on('cancel-queue', () => {
    if (activeQueue) {
      activeQueue.cancel()
    }
  })

  ipcMain.handle('check-output-dir', async (_event, dir: string) => {
    return checkOutputDir(dir)
  })

  ipcMain.handle('check-disk-space', async (_event, dir: string, totalInputBytes: number) => {
    return checkDiskSpace(dir, totalInputBytes)
  })

  ipcMain.on('open-output-folder', (_event, folderPath: string) => {
    shell.openPath(folderPath)
  })

  ipcMain.handle('settings:get', async () => {
    return getSettings(app.getPath('userData'))
  })

  ipcMain.handle('settings:save', async (_event, partial) => {
    return saveSettings(app.getPath('userData'), partial)
  })

  ipcMain.handle('history:get', async () => {
    return getHistory(app.getPath('userData'))
  })

  ipcMain.handle('history:add', async (_event, data) => {
    return addHistory(app.getPath('userData'), data)
  })

  ipcMain.handle('history:delete', async (_event, id: string) => {
    return deleteHistory(app.getPath('userData'), id)
  })

  ipcMain.handle('history:export-json', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export History as JSON',
      defaultPath: 'shrinkflow-history.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      await exportHistoryJSON(app.getPath('userData'), result.filePath)
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Export failed' }
    }
  })

  ipcMain.handle('history:export-csv', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export History as CSV',
      defaultPath: 'shrinkflow-history.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      await exportHistoryCSV(app.getPath('userData'), result.filePath)
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Export failed' }
    }
  })

  ipcMain.handle('benchmarks:get', async () => {
    return getAllBenchmarks(app.getPath('userData'))
  })

  ipcMain.handle('benchmarks:delete', async (_event, id: string) => {
    return deleteBenchmark(app.getPath('userData'), id)
  })

  ipcMain.handle('get-device-profile', async () => {
    return getDeviceProfile()
  })

  ipcMain.handle('estimate-eta', async (_event, videos, mode, deviceProfile, probeSpeedX) => {
    return estimateEta(videos, mode, deviceProfile, app.getPath('userData'), probeSpeedX)
  })

  ipcMain.handle('quick-probe', async (_event, inputPath, videoDuration, plan) => {
    try {
      const speedX = await runQuickProbe(inputPath, videoDuration, plan)
      return { success: true, speedX }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Probe failed' }
    }
  })

  // FFmpeg Manager IPC handlers
  ipcMain.handle('ffmpeg:get-info', async () => {
    return getFFmpegInfo()
  })

  ipcMain.handle('ffmpeg:update', async () => {
    return updateFFmpeg(mainWindow)
  })

  ipcMain.handle('ffmpeg:open-folder', async () => {
    return openFFmpegFolder()
  })

  ipcMain.handle('ffmpeg:remove-updated', async () => {
    return removeUpdatedFFmpeg()
  })

  ipcMain.handle('ffmpeg:check-update', async () => {
    return checkFFmpegUpdate()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
