# ShrinkFlow

> Metadata-aware video batch compressor. Every video gets its own optimal strategy.

## What is ShrinkFlow?

ShrinkFlow is a desktop video batch compression tool that analyzes each video's encoding profile — codec, bitrate, resolution, file size — and recommends an optimal per-file compression strategy. Instead of applying the same parameters to every file, ShrinkFlow makes independent decisions for each video: compress, skip, or ask for user confirmation.

**Why it matters:** Most video compression tools use a one-size-fits-all approach. A video that's already heavily compressed gets compressed again (wasting time, risking quality), while a high-bitrate ProRes file gets the same gentle treatment as a low-bitrate H.264 clip. ShrinkFlow solves this with a per-video decision engine.

## Positioning

**English:** ShrinkFlow is a metadata-aware desktop video batch compressor. It uses an explainable rule engine to analyze each video's encoding profile and recommend an optimal per-file compression strategy, enabling non-technical users to make informed batch compression decisions without understanding CRF, bitrate, or codec internals.

**Chinese:** ShrinkFlow 是一款元数据感知的桌面端视频批量压缩工具。它用可解释的规则引擎分析每个视频的编码特征，为每个文件独立推荐最优压缩策略，让普通用户无需理解 CRF、码率、编码格式，也能完成批量压缩决策。

## Key Features

- **Smart Shrink Plan** — 6-layer rule engine classifies each video into compress / skip / confirm
- **3 Strategy Goals** — Safe Optimize, Smart Recommend, Space Saver — one click sets the risk preference for the entire batch
- **7 Compression Modes** — CRF-based (20–30) + target-size modes with two-pass encoding
- **Per-Video Mode** — each video uses its own recommended compression mode, not a global setting
- **Explainable Decisions** — every recommendation includes reason codes (17 types) so users understand *why*
- **Safety First** — output-larger-than-input protection, atomic backup-replace, high-risk confirmation, low-saving filter
- **Batch Processing** — drag-and-drop import, recursive folder scan, serial queue with cancellation
- **Real-time Progress** — overall percent, ETA with smoothing, dual-pass phase indicators
- **Compression History** — per-item mode tracking, JSON/CSV export
- **FFmpeg Bundled** — no external dependencies, auto-update support
- **Fully Offline** — zero telemetry, all processing local

## How Smart Shrink Plan Works

The Smart Shrink Plan is the core of ShrinkFlow. It takes a batch of videos and a user-selected goal, then produces a plan: for each video, an action (compress / skip / confirm), a recommended compression mode, a quality risk level, and an estimated saving range.

### The 6-Layer Decision Engine

```
Layer 1: Hard Exclusions
  └─ Skip if: metadata missing, file < 20MB, duration < 5s

Layer 2: Codec Classification
  └─ Efficient (HEVC/AV1/VP9) → Common (H.264) → Editing (ProRes/DNxHD) → Unknown

Layer 3: Evidence Collection
  └─ BPPF tier (5 levels), resolution flags, file size thresholds
  └─ Each piece of evidence becomes a reason code

Layer 4: Goal-Based Decision
  └─ light_30: conservative — skip low-value, confirm high-risk
  └─ balanced_50: balanced — compress medium+ bppf, confirm edge cases
  └─ deep_70: aggressive — compress most, confirm only efficient codecs

Layer 5: High-Risk Override
  └─ If quality risk = high → downgrade compress to confirm

Layer 6: Low-Saving Filter
  └─ Skip if estimated saving below threshold (varies by goal)
```

### BPPF (Bits Per Pixel Per Frame)

BPPF is the core metric for assessing how much a video is already compressed:

| Tier | BPPF Range | Meaning |
|------|-----------|---------|
| Already Compressed | ≤ 0.045 | Heavily compressed, minimal room |
| Low | 0.045 – 0.075 | Lightly compressed |
| Medium | 0.075 – 0.12 | Typical consumer video |
| High | 0.12 – 0.20 | High bitrate, good compression candidate |
| Very High | > 0.20 | Very high bitrate, excellent candidate |

### Codec Classes

| Class | Codecs | Behavior |
|-------|--------|----------|
| Efficient | HEVC, H.265, AV1, VP9 | Re-compression risky — always confirm |
| Common | H.264, AVC1 | Safe to compress with appropriate settings |
| Editing | ProRes, DNxHD, DNxHR, MJPEG | Large compression potential, quality-sensitive |
| Unknown | Anything else | Conservative — confirm or skip |

## Compression Modes

| Mode | CRF | Preset | Audio | Pixel Format | Notes |
|------|-----|--------|-------|-------------|-------|
| Default | 21 | medium | 128k AAC | yuv420p | General purpose |
| Balanced | 24 | medium | 128k AAC | — | Balanced quality/size |
| Quality First | 20 | slow | 192k AAC | — | Minimal quality loss |
| Heavy Balanced | 25 | medium | 128k AAC | yuv420p | Significant savings |
| Smallest Size | 30 | medium | 96k AAC | — | Downscales to 720p if needed |
| Target Size (Fast) | — | medium | 128k AAC | — | Bitrate from target size |
| Target Size (Accurate) | — | medium | 128k AAC | — | Two-pass encoding |

## Safety Mechanisms

| Mechanism | What it does |
|-----------|-------------|
| Output-larger-than-input protection | If compressed file ≥ original, skips replacement |
| Atomic backup-replace | Backup → replace → delete backup; rollback on failure |
| High-risk confirmation | Efficient codec re-compression, low BPPF, extreme compression ratio → requires user confirmation |
| Low-saving filter | Skips videos where estimated saving is below threshold |
| Disk space check | Verifies output directory has enough space before starting |
| Cancellation support | Scan, analysis, and compression can all be cancelled |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Electron 33 |
| UI | React 18 |
| State | Zustand |
| Language | TypeScript |
| Styling | Tailwind CSS (Catppuccin Mocha dark theme) |
| Compression | FFmpeg (bundled) |
| Build | electron-vite + Vite |
| Testing | Vitest |
| Packaging | electron-builder (Windows NSIS) |
| i18n | i18next (Chinese + English) |

## Architecture

```
Main Process (36 IPC handlers)
├── file-scanner        — recursive scan, symlink detection, abort support
├── video-analyzer      — FFprobe metadata extraction
├── compression-planner — FFmpeg arg generation (7 modes)
├── ffmpeg-runner       — process spawning, progress parsing, dual-pass
├── task-queue          — EventEmitter serial queue, atomic replace
├── output-manager      — path generation, conflict detection
├── ffmpeg-manager      — 3-source resolution (bundled > updated > system)
├── settings-store      — JSON persistence with schema migration
├── history-store       — compression history with per-item mode, export
├── device-profiler     — hardware encoder detection (NVENC/QSV/AMF/VT)
├── eta-estimator       — multi-source ETA (probe / history / rule)
└── benchmark-store     — compression speed benchmarks

Renderer (React SPA)
├── CompressPage        — main orchestrator, state management
├── SmartShrinkPlanPanel — goal selection, plan display, confirm filter
├── CompressionModeCards — mode selection UI
├── OverallProgress     — real-time queue progress
├── HistoryPage         — compression history with export
├── SettingsPage        — FFmpeg management, output config
└── smart-shrink/       — pure TypeScript rule engine (no side effects)
    ├── rules.ts        — 6-layer classification engine
    ├── estimate.ts     — BPPF-based saving estimation
    └── buildPlan.ts    — plan construction and summary aggregation
```

## Release

**Current version:** v1.2.0

| Artifact | Size |
|----------|------|
| ShrinkFlow-v1.2.0-Windows-x64-Setup.exe | ~167 MB (includes FFmpeg) |
| app.asar | ~12 MB |

See `release-final/` or GitHub Releases for download.

## Roadmap (v0.3)

- **Smart Probe** — 5-second quick compression test for more accurate estimation
- **History Learning** — past compression results improve future estimates
- **Quality Assessment** — SSIM/PSNR-based quality comparison after compression
- **Professional Report Page** — batch compression summary with charts
- **User Presets** — custom compression profiles (save / load / share)

## Author

Built by Jevon
