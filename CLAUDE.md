# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start Electron + Vite dev server
npm run build            # Build all (main, preload, renderer) via electron-vite
npm run typecheck        # Typecheck both tsconfig.node.json and tsconfig.web.json
npm run typecheck:node   # Typecheck main + preload only
npm run typecheck:web    # Typecheck renderer only
npm run lint             # ESLint (flat config, eslint.config.mjs)
npm test                 # Run all tests (vitest run)
npm run test:watch       # Vitest watch mode
npm run dist             # Build + package (electron-vite build + electron-builder)
npm run package:win      # Clean + build + package from scratch
npm run clean            # Remove dist/, release/, out/ directories
```

Single test file: `npx vitest run src/main/modules/task-queue/index.test.ts`

## Architecture

ShrinkFlow is an Electron desktop app (contextIsolation enabled, nodeIntegration disabled) for batch video compression via FFmpeg/FFprobe. Three-process architecture:

**Main process** (`src/main/index.ts`) — Creates BrowserWindow, registers 36 IPC handlers (7 `on` + 29 `handle`), orchestrates all backend modules. Entry point for `electron-vite`.

**Preload** (`src/preload/index.ts`) — Bridges IPC via `contextBridge.exposeInMainWorld`. Exposes `window.electron` (electron-toolkit) and `window.api` (methods + event listeners). Event listeners return unsubscribe functions.

**Renderer** (`src/renderer/`) — React 18 SPA with React Router (HashRouter), Zustand state, i18next i18n, Tailwind CSS. Routes: `/compress`, `/history`, `/settings`. Video table limited to 200 visible rows with "show more" pagination for performance.

## Key Backend Modules (src/main/modules/)

| Module | Purpose |
|---|---|
| `file-scanner` | Scan files/folders for video extensions (.mp4/.mov/.mkv/.avi/.webm/.m4v). Supports recursive directory scanning via `ScanOptions.recursive` with symlink cycle detection (realpath tracking + lstat). Emits `ScanProgressEvent` via `onProgress` callback (throttled: max every 300ms or 100 files). `ScanResult` includes `scannedFolders`, `skippedFolders`, `scannedFiles` summary counts. Skip reasons: `unsupported_format`, `permission_denied`, `duplicate`, `unknown_error`, `symbolic_link_skipped`, `output_directory_skipped`. `SKIP_DIRECTORY_NAMES` set auto-skips: `shrinkflow_output`, `.shrinkflow`, `.shrinkflow_tmp`, `node_modules`, `dist`, `release`, `out`. Debug logging controlled by `DEBUG_SCAN_VERBOSE` flag (default false). Cancellable via `ScanOptions.signal` (AbortSignal) — throws `ScanCanceledError` on abort, emits `canceled` progress event |
| `ffmpeg-path` | Shared FFmpeg/FFprobe path resolution (`getFfmpegPath`, `getFfprobePath`) and availability check (`checkFFmpegAvailable`, `checkFFprobeAvailable`). Used by both `ffmpeg-runner` and `video-analyzer`. Re-exports from `ffmpeg-manager`. In packaged mode, checks bundled binary via `existsSync`; if missing, returns `source: 'none'` (no fallback to system PATH). Dev mode falls back to system PATH |
| `video-analyzer` | FFprobe metadata extraction (duration, codec, resolution, bitrate, fps). Re-exports `checkFFprobeAvailable` from `ffmpeg-path` |
| `compression-planner` | Generate FFmpeg args for 6 modes (balanced, quality_first, smallest_size, target_size_fast, target_size_accurate, compatible_high_quality). `target_size_accurate` uses two-pass FFmpeg encoding with temp pass logs in `os.tmpdir()`. `PlanResult` is a discriminated union: `ok:true` with plan, `ok:false` with reason, or `ok:false` with `conflict:true` |
| `ffmpeg-runner` | Spawn FFmpeg with `-progress pipe:1 -nostats`, parse progress, cancel via SIGTERM. Supports two-pass encoding (`plan.twoPass`): pass 1 progress maps to 0-50%, pass 2 to 50-100%. Pass logs cleaned up in `finally` block via `cleanupPassLogs()` |
| `task-queue` | EventEmitter-based serial queue. Events: progress, item-done, task-finished, queue-done. Post-processes `shouldReplaceOriginal` and `shouldOverwriteExisting` with temp-file safe replace via `safeReplaceFile()` (backup-then-swap with rollback). ETA smoothing (`smoothEta`) caps upward jumps at `max(prev+15, prev*1.15)`, allows fast drops. Monotonic progress (`monotonicPercent`) ensures displayed percent never regresses. Stale event rejection: ignores progress from non-`compressing` items. **Output-larger-than-input protection**: after compression, stats both input and output files. If output ≥ input: replace_original → skipped (temp cleaned, original preserved); default/save_as → completed with `outputLargerThanInput=true`, `noSaving=true`. Uses `cleanupOutputIfSafe()` helper that checks `resolve(outputPath) !== resolve(inputPath)` before unlink. All size fields (`originalSize`, `outputSize`, `savedSize`, `compressionRatio`) synced from fresh stat values |
| `output-manager` | Output path generation, dir/space checks, 3 save strategies (default, replace_original, save_as). Conflict detection (`detectConflict`), rename path generation (`generateRenamePath`). `buildOutputPath()` computes paths without creating directories (pure); `generateOutputPath()` wraps it with mkdir. `createOutputPlan()` default branch uses `buildOutputPath()` — directory creation deferred to `checkOutputDir()` at compression time |
| `settings-store` | JSON persistence at `{userData}/settings.json` with `migrationVersion` field for schema versioning and dev-environment migrations |
| `history-store` | JSON persistence at `{userData}/history.json`. `exportHistoryJSON()` and `exportHistoryCSV()` for data export via `dialog.showSaveDialog` |
| `device-profiler` | Hardware info collection (platform, CPU, memory) and hardware encoder detection via `ffmpeg -encoders`. Exports `getDeviceProfile()` returning `DeviceProfile` with `availableHardwareEncoders` array. Checks 8 encoders: nvenc, qsv, videotoolbox, amf variants |
| `eta-estimator` | Pre-compression ETA estimation. Pixel-based speed model: `computePixelFactor(w,h) = (w*h)/(1920*1080)`. Speed range per mode with `getModeSpeedFactor()` (target_size_accurate uses 0.4, roughly 2x slower than fast). Data sources ranked: probe > history > rule. `runQuickProbe()` compresses a 5-second segment in a temp dir to measure actual encoding speed (never touches real output). `estimateEta()` is the main entry point |
| `benchmark-store` | JSON persistence at `{userData}/benchmarks.json` (max 100 records). Records actual compression speed after each job. `addBenchmark()`, `queryBenchmarks()`, `getResolutionBucket()`. Used by eta-estimator for history-based estimates |
| `ffmpeg-manager` | FFmpeg binary lifecycle: download, update, check-for-update, remove-updated. Sources: bundled (`resources/ffmpeg/win32/x64/`), updated (`{userData}/ffmpeg/current/`), system PATH (dev only). Priority: updated > bundled > system (dev) / none (packaged). `FFmpegSource` type: `'bundled' | 'updated' | 'system' | 'none'`. `checkFFmpegUpdate()` checks for new versions without downloading. `updateFFmpeg()` downloads with atomic replace (staging → current). `metadata.json` in current dir tracks `assetId`/`version` to prevent re-downloads. IPC channels: `ffmpeg:get-info`, `ffmpeg:update`, `ffmpeg:check-update`, `ffmpeg:open-folder`, `ffmpeg:remove-updated` |

## Smart Shrink Module (src/renderer/modules/smart-shrink/)

Renderer-side module for intelligent compression decision-making. Classifies videos into compress/skip/confirm actions based on codec, bppf (bits-per-pixel-frame), file size, and goal-specific risk tolerance.

**Files**: `types.ts`, `rules.ts`, `estimate.ts`, `buildPlan.ts`, `smart-shrink.test.ts`

**Three goals** (internal IDs unchanged, display names via i18n):
- `light_30` → 安全优化 / Safe Optimize — conservative, quality-first
- `balanced_50` → 智能推荐 / Smart Recommend — balanced risk and savings
- `deep_70` → 空间优先 / Space Saver — size-first, high-risk requires confirmation

**Codec classification** (priority: efficient > common > editing > unknown):
- Efficient: HEVC/H.265, AV1, VP9
- Common: H.264/AVC1
- Editing: ProRes, DNxHD, DNxHR, MJPEG, rawvideo

**Bppf tiers**: already_compressed (≤0.045), low (≤0.075), medium (≤0.12), high (≤0.20), very_high (>0.20)

**Decision flow** (in `classifyVideo()`):
1. Layer 1: Hard exclusions (missing metadata → skip, small file <20MB → skip, short video <5s → skip, already compressed → skip)
2. Layer 2: Codec class pre-classification
3. Layer 3: Evidence collection (reasonCodes)
4. Layer 4: Goal-based compress/skip/confirm decision
5. Layer 5: High-risk override (efficient codec re-compression → high risk)
6. Layer 6: Low-saving downgrade (maxPercent <15 or maxBytes <10MB → skip)

**Estimation** (in `estimateSaving()`): Compressibility-driven base ranges (not goal-fixed). Size adjustment before goal cap. Confidence levels: high/medium/low/unknown based on metadata completeness.

## IPC Flow for Compression

1. Renderer calls `scanPaths(paths, { recursive? })` → file-scanner returns videos + skipped + summary counts. If recursive, emits `scanner:progress` events (listened via `onScanProgress` in preload).
2. Renderer calls `analyzeVideos` → video-analyzer processes up to 2 files concurrently, emits `video:analyzed` per file
3. Renderer calls `generatePlan` → compression-planner returns plan with FFmpeg args
4. Renderer calls `startQueue` → task-queue processes serially, emitting `queue:progress`, `queue:item-done`, `queue:task-finished`
5. On `queue:task-finished`, renderer calls `reconcileFinalResults` to fix any stale states

### Cancellation IPC Channels

- `cancel-scan` (`ipcRenderer.send`) — Aborts active file scan via `AbortController`. Main process calls `activeScanAbortController.abort()`. Scanner throws `ScanCanceledError`, handler returns empty result.
- `cancel-analysis` (`ipcRenderer.send`) — Aborts active video analysis via `AbortController`. Main process calls `activeAnalysisAbortController.abort()`. Analysis loop checks `signal.aborted` between files and breaks.
- `cancel-compression` (existing) — Cancels task-queue via `taskQueue.cancel()`, which SIGTERMs active FFmpeg process.

### Task Lifecycle & Stale Result Prevention

**sessionId pattern**: `videoStore` has a `sessionId` counter (starts at 0). `clearAll` increments it. All async IPC callbacks (`handleVideoAnalyzed`, `handleQueueProgress`, `handleQueueItemDone`, `handleTaskFinished`, `handleScanProgress`) capture `sessionIdRef.current` at registration time and compare against `useVideoStore.getState().sessionId` on each event. Mismatches are silently dropped, preventing stale results from populating a cleared list.

**isBusy guard**: `CompressPage` computes `isBusy = isScanning || isAnalyzing || (queueStarted && !isQueueTerminal) || generating`. When `isBusy`:
- Add video/folder buttons are disabled with tooltip
- Drag-and-drop shows warning overlay
- `handleSelectVideos` / `handleSelectFolder` / `handleDrop` return early

**safe clearAll flow** (`handleClearAll` in CompressPage):
1. If `isBusy`, show confirmation dialog
2. Cancel all active tasks: `cancelQueue()`, `cancelCompression()`, `cancelScan()`, `cancelAnalysis()`
3. Wait 200ms for cancellation propagation
4. Clear UI state via `clearAll()` (which increments sessionId)
5. Reset analyzing state

## Conflict Resolution Flow

When `compatible_high_quality` (默认 / Default) mode + `save_as` strategy produces an output path that already exists, the planner returns `{ ok: false, conflict: true }` instead of throwing. The renderer collects these conflicts and shows `ConflictResolutionModal` before starting the queue. Four resolutions: overwrite (temp-file + safe replace), rename (`{base}_{N}{ext}`), skip (`skipped` terminal status), cancel (videos stay `ready`).

Cross-module coordination:
- `output-manager`: `detectConflict()` checks `same_as_input` vs `existing_output_file`; `createOutputPlan` accepts `conflictAction` param; `generateRenamePath()` produces `{base}_{N}{ext}` (no `_compressed` suffix)
- `compression-planner`: `PlanResult` union includes `{ ok: false; conflict: true; message; conflictType }` variant
- `task-queue`: post-processing for `shouldOverwriteExisting` (stat temp → unlink old → rename temp) and `shouldReplaceOriginal`
- `videoStore`: `skipped` is a terminal status in `TERMINAL_STATUSES`; `setSkipped()` action; `reconcileFinalResults` handles `skipped`

Standard modes (`default` strategy) auto-rename with `_compressed` suffix via `buildOutputPath` (pure path computation, no mkdir) and never trigger the conflict modal. Directory creation is deferred to `checkOutputDir()` at compression time.

## State Management (videoStore.ts)

Zustand store with terminal state guards. Video status lifecycle: `scanned → analyzing → ready → pending → compressing → completed|failed|canceled|skipped`.

Critical patterns:
- **Queue-level guard**: `updateCompressionProgress` skips updates when `queueStatus` is terminal (completed/failed/canceled)
- **Per-video terminal guard**: Videos in terminal state ignore stale progress events
- **Queue status regression guard**: `setQueueStatus` blocks terminal→non-terminal transitions
- **Final reconciliation**: `reconcileFinalResults` force-corrects videos stuck in `compressing` after queue ends
- **sessionId stale-result guard**: `sessionId` counter incremented by `clearAll`; async callbacks check it before applying results

## Build & Packaging

`electron-vite` builds three targets (main, preload, renderer) from `electron.vite.config.ts`. No separate vite.config.ts exists.

Packaging via `electron-builder` (electron-builder.yml): Windows NSIS installer. FFmpeg is bundled via `extraResources` (not inside app.asar). The `files` array includes `!resources/**` to exclude resources from app.asar; do not add `asarUnpack: resources/**` (this caused FFmpeg duplication in earlier versions).

FFmpeg paths: dev uses system PATH; packaged mode checks `resources/ffmpeg/win32/x64/` via `existsSync`, returns `source: 'none'` if bundled binary not found (no system PATH fallback). Path resolution is centralized in `ffmpeg-manager/index.ts` (re-exported via `ffmpeg-path.ts`). The `predist` script (`npm run download:ffmpeg && npm run check-ffmpeg`) auto-downloads FFmpeg binaries before `npm run dist`; manual placement is only needed if the download fails.

Packaging: `npm run dist` runs electron-vite build + electron-builder. Config uses `signAndEditExecutable: false` to avoid winCodeSign symlink issues on Windows without Developer Mode.

## TypeScript

Solution-style `tsconfig.json` references two projects:
- `tsconfig.node.json` — main + preload (ESNext modules, bundler resolution)
- `tsconfig.web.json` — renderer (adds jsx: react-jsx, `@/*` path alias → `src/renderer/*`)

Type declarations live in two places that must stay in sync:
- `src/preload/index.d.ts` — canonical type definitions for the IPC API
- `src/renderer/global.d.ts` — ambient Window.api types (mirrors preload/index.d.ts)

## i18n

i18next with two locales (`src/renderer/i18n/locales/en.json`, `zh.json`). Default language is `zh` (Chinese), with migration logic for existing dev environments. Language persisted in localStorage. Main process menus rebuilt on language change via `set-language` IPC event.

Key namespaces: `plan.*` (compression planning, progress, results), `compress.*` (file list, scanning, mode selection, task lifecycle — includes `busyCannotAdd`, `waitUntilDoneOrCancel`, `confirmClearRunning`, `canceling`, `clearFailed`), `status.*` (video status labels), `error.*` (analysis errors), `conflict.*` (output file conflicts), `settings.*`, `history.*` (includes `outputLargerThanInput`, `originalNotReplacedOutputLarger`), `mode.*` (compression modes), `saveStrategy.*`, `smartShrink.*` (goal names, reasons, summary labels).

## Theme

Catppuccin Mocha-inspired dark theme. Tailwind custom colors: sidebar-*, topbar-*, workspace-*, accent-*, success, warning, error. No light theme implementation despite `theme` setting in AppSettings.

## Compression Progress UI

The `OverallProgress` component (`src/renderer/components/compress/OverallProgress.tsx`) renders the queue-level progress panel. It is placed **outside** the compression planning conditional block in `CompressPage.tsx`, between the scan summary and the video table, so it remains visible throughout compression.

Key behavior:
- When `queueStarted=true` but `queueProgress` is null (before first FFmpeg progress event), uses `buildFallbackProgress(totalPlanned)` from `progress-format.ts` to show: 0%, 0/N completed, "Preparing" status
- During compression: shows overall percent, progress bar, elapsed time, ETA, stats grid, and current file detail panel
- After completion: retains final state (100%, final counts, elapsed time)
- `queueStarted` is only reset to `false` on `clearAll`

Progress data chain: `ffmpeg-runner` → `task-queue` (computes `overallPercent` with monotonic protection, `estimatedRemainingSeconds` with ETA smoothing) → IPC → `CompressPage` → `OverallProgress`

Two-pass encoding: `ffmpeg-runner` emits `phase: 'two_pass_analyze'` for pass 1 and `phase: 'two_pass_encode'` for pass 2. `OverallProgress` shows phase badges via `getPhaseLabel()`.

Formatting utilities in `src/renderer/components/compress/progress-format.ts`: `formatElapsed`, `formatRemaining`, `formatEta`, `getPhaseLabel`, `buildFallbackProgress`.

## Tests

Vitest with `src/**/*.test.ts` pattern, node environment. Test files:
- `src/main/modules/compression-planner/index.test.ts`
- `src/main/modules/output-manager/index.test.ts`
- `src/main/modules/task-queue/index.test.ts`
- `src/main/modules/eta-estimator/index.test.ts`
- `src/main/modules/file-scanner/index.test.ts`
- `src/main/modules/ffmpeg-manager/index.test.ts`
- `src/renderer/components/compress/eta-format.test.ts`
- `src/renderer/components/compress/progress-format.test.ts`
- `src/renderer/modules/smart-shrink/smart-shrink.test.ts`

Tests use real temp dirs (mkdtemp) where possible; task-queue mocks ffmpeg-runner. The eta-format and progress-format tests run in a jsdom environment (renderer-side).
