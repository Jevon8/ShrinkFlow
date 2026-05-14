# ShrinkFlow

**Metadata-aware video batch compression desktop app with explainable per-video strategy.**

ShrinkFlow is a local-first Windows desktop app for batch video compression.
It analyzes each video's codec, bitrate, resolution, duration, and file size, then recommends whether the file should be compressed, skipped, or manually reviewed.

> Portfolio project by **Jevon** — built with Electron, React, TypeScript, FFmpeg, and an explainable rule-based decision engine.

---

## Live Showcase

- **Portfolio showcase:** https://jevon8.github.io/ShrinkFlow/showcase-site/
- **Latest release:** https://github.com/jevon8/ShrinkFlow/releases/tag/v1.2.0
- **Repository:** https://github.com/jevon8/ShrinkFlow

---

## Why ShrinkFlow

Most compression tools expose technical parameters such as CRF, preset, bitrate, codec, and pixel format.
ShrinkFlow turns these engineering parameters into user-facing compression decisions:

- **Compress** — the video is a good compression candidate
- **Skip** — expected saving is too low or risk is not worth it
- **Confirm** — high-risk case that needs user review

The goal is simple:
**Every video gets its own compression strategy.**

---

## Key Features

### Smart Shrink Plan

ShrinkFlow generates a batch-level plan based on each video's metadata.

- Per-video `compress / skip / confirm` decision
- Per-video recommended compression mode
- Estimated saving range
- High-risk video count
- User confirmation flow for risky cases

### Explainable Rule Engine

The decision engine is rule-based and transparent, not a black box.

It considers:

- Codec type: H.264, HEVC, AV1, VP9, ProRes, DNxHD
- Bitrate and Bits Per Pixel Per Frame (BPPF)
- Resolution and duration
- File size
- Expected saving
- Recompression risk

Each recommendation includes reason codes so users can understand why a file is compressed, skipped, or marked for review.

### Safety-first Compression

ShrinkFlow avoids damaging original files.

- Output-larger-than-input protection
- Backup-then-swap replacement flow
- High-risk confirmation
- Conflict handling
- History record for every compression task

### Local-first Desktop App

- Bundled FFmpeg / FFprobe
- No cloud upload required
- Works as a Windows desktop installer
- Suitable for private local video files

---

## Product Flow

```text
Import videos
  ↓
Read metadata with FFprobe
  ↓
Build Smart Shrink Plan
  ↓
Apply per-video strategy
  ↓
Run FFmpeg compression
  ↓
Protect output and original files
  ↓
Save history and export records
```

---

## Architecture

```text
Renderer (React + Zustand)
  ↓ typed IPC
Preload (contextBridge)
  ↓
Main Process (Node.js)
  ↓
FFmpeg / FFprobe
```

Key modules: `file-scanner`, `video-analyzer`, `compression-planner`, `ffmpeg-runner`, `task-queue`, `output-manager`, `ffmpeg-manager`, `history-store`, `eta-estimator`, `benchmark-store`, `settings-store`, `device-profiler`

---

## Compression Modes

| Mode | CRF | Preset | Audio | Role |
|---|---|---|---|---|
| Default | 21 | medium | AAC 128k | General purpose |
| Balanced | 24 | medium | AAC 128k | Manual balanced |
| Quality First | 20 | slow | AAC 192k | Safer visual quality |
| Heavy Balanced | 25 | medium | AAC 128k | Space saver, minor loss |
| Smallest Size | 30 | medium | AAC 96k | Manual extreme, may downscale to 720p |
| Target Size Fast | — | medium | AAC 128k | Target bitrate, single pass |
| Target Size Accurate | — | medium | AAC 128k | Two-pass target size |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Electron 33 |
| Frontend | React 18, React Router 6 |
| Language | TypeScript 5.9 |
| Build | electron-vite (Vite 5) |
| Styling | Tailwind CSS 3.4 |
| State | Zustand 5 |
| i18n | i18next 26 |
| Testing | Vitest 4 |
| Packaging | electron-builder 25 |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Development

```bash
npm install
npm run dev
```

### Quality Checks

```bash
npm run typecheck
npm run lint
npm test
```

### Build and Package

```bash
npm run build
npm run dist
```

---

## Showcase

The portfolio showcase page is available at `docs/showcase-site/`.

Open `docs/showcase-site/index.html` directly in a browser — no build step, no server, no dependencies.

It includes:

- Full product case study in Chinese and English
- 8 product screenshots
- Decision engine breakdown
- Architecture overview
- Roadmap and project value summary

---

## License

ShrinkFlow source code is licensed under MIT License, Copyright (c) 2026 Jevon.

This project uses FFmpeg / FFprobe as third-party open-source components. FFmpeg licensing depends on the actual build used; GPL builds require compliance with GPL terms. Before public distribution, verify that `resources/ffmpeg/win32/x64/LICENSE.txt` matches the shipped FFmpeg build.

FFmpeg and FFprobe are independent projects by the FFmpeg team (https://ffmpeg.org) and are not part of ShrinkFlow's own code.
