# ShrinkFlow

**本地优先的智能视频压缩桌面工具** — 基于 Electron + FFmpeg，支持批量压缩、目标大小精确压缩、two-pass 编码、历史记录管理和内嵌 FFmpeg 生命周期管理。

---

## 项目定位

ShrinkFlow 面向需要批量压缩视频的个人用户，解决以下痛点：

- 视频体积过大，上传/分享/存储不便
- 批量处理多个视频时手动操作繁琐
- FFmpeg 命令行门槛高，参数复杂难记
- 压缩后文件覆盖导致原始数据丢失
- 不确定压缩需要多长时间

这是一个面向作品集展示的桌面工具项目，重点体现产品设计、FFmpeg 工程化封装、Electron 安全边界和用户数据安全设计。

---

## 核心功能

### 视频导入
- **文件选择** — 通过系统文件对话框选择多个视频文件
- **文件夹递归扫描** — 选择文件夹后自动递归扫描所有子目录中的视频
- **拖拽添加** — 直接拖拽文件或文件夹到应用窗口
- **重复文件处理** — 自动按路径去重，重复文件移入 skipped 列表

支持格式：`.mp4`、`.mov`、`.mkv`、`.avi`、`.webm`、`.m4v`

### 视频分析
- 通过 FFprobe 读取视频元信息：时长、分辨率、编码格式、码率、帧率、音频编码
- 并发分析（最多 2 个文件同时），逐个发送分析结果到前端
- 损坏视频检测（无视频流、文件为空等）

### 压缩模式

| 模式 | 说明 | 特点 |
|---|---|---|
| **默认 / Default** | 兼容高质量 | CRF 21, yuv420p, 最大兼容性 |
| **Balanced** | 均衡模式 | CRF 24, medium preset |
| **Quality First** | 质量优先 | CRF 20, slow preset, 192k AAC |
| **Smallest Size** | 最小体积 | CRF 30, 自动降分辨率到 720p |
| **Target Size Fast** | 目标大小（快速） | 单次编码，根据目标大小计算码率 |
| **Target Size Accurate** | 目标大小（精确） | **Two-pass 编码**，预留 5% 容器开销 |

### 批量任务
- 单文件压缩进度（百分比、速度、ETA）
- 整体队列进度（已完成/总数、总百分比）
- 支持取消当前压缩任务，并终止后续队列处理
- 单文件失败后继续处理剩余文件
- 队列完成后状态汇总（completed / partial_failed / failed / canceled）

### 输出策略
- **默认输出** — 在原文件旁创建 `ShrinkFlow_Output` 子目录，文件名添加 `_compressed` 后缀
- **另存为** — 用户选择输出目录
- **替换原文件** — 使用临时文件 + 安全替换流程
- **同名冲突处理** — 支持覆盖（安全替换）、重命名（自动递增后缀）、跳过
- **Backup-then-swap** — 替换原文件时先备份 → 写入新文件 → 成功后删除备份，失败则回滚

### ETA 预估系统
- **规则估算** — 基于像素复杂度因子和模式速度系数的启发式估算
- **历史 Benchmark** — 基于历史压缩记录的中位数速度
- **Quick Probe** — 压缩 5 秒片段实测编码速度（不接触真实输出文件）
- 置信度等级：low / medium / high

### 历史记录
- 保存每次压缩任务的完整记录：文件数、总大小、节省空间、耗时
- 每个文件的详细结果：原始大小、压缩后大小、节省百分比、耗时
- 支持删除单条记录
- 支持导出为 JSON 和 CSV（通过系统保存对话框）

### FFmpeg 管理
- **内嵌 FFmpeg** — 打包时自带 FFmpeg/FFprobe，用户无需手动安装
- **检查更新** — 应用内检查 GitHub 上的最新 FFmpeg 构建
- **用户确认后更新** — 下载后校验（manifest 提供 sha256 时执行 SHA-256 校验，GitHub fallback 场景至少验证 ffmpeg.exe / ffprobe.exe 可执行），使用 staging / current / previous 目录切换，失败可回滚
- **删除更新** — 回退到内嵌版本
- **启动修复** — 自动恢复中断的更新操作

### 其他
- **双语支持** — 中文/英文运行时切换，原生菜单同步更新
- **设备信息** — CPU、内存、FFmpeg 版本、硬件编码器检测（NVENC/QSV/AMF 等）
- **磁盘空间检查** — 压缩前检查可用空间，不足时警告

---

## 产品亮点

- **零 FFmpeg 门槛** — 内嵌 FFmpeg，用户无需手动安装或配置环境变量
- **Target Size Accurate two-pass** — 通过两次编码精确控制输出文件大小
- **Backup-then-swap** — 替换原文件时的数据安全保护机制，失败自动回滚
- **拖拽 + 文件夹递归扫描** — 一键导入整个视频文件夹，自动去重和跳过非视频文件
- **三层 ETA 预估** — 规则 → 历史 → 实测，越用越准
- **历史导出** — 支持 JSON/CSV 导出，方便数据分析和记录留存
- **Electron 安全桥接** — contextIsolation 启用，不开启 nodeIntegration，最小化攻击面
- **完整测试覆盖** — 138 个测试用例，覆盖核心模块
- **可打包 exe** — 一键生成 Windows NSIS 安装包

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer (React SPA)                      │
│  React 18 + React Router 6 + Zustand + Tailwind CSS + i18next│
│  Routes: /compress  /history  /settings                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge (window.api)
┌──────────────────────────▼──────────────────────────────────┐
│                    Preload (IPC Bridge)                      │
│  受控 API 暴露，事件监听返回 unsubscribe 函数                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ ipcMain.handle / ipcMain.on
┌──────────────────────────▼──────────────────────────────────┐
│                    Main Process (Node.js)                    │
│                                                             │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐   │
│  │ FileScanner   │  │VideoAnalyzer    │  │Compression   │   │
│  │ 递归扫描       │  │FFprobe 元信息   │  │Planner       │   │
│  │ 去重/跳过      │  │并发分析         │  │6 种压缩模式   │   │
│  └──────────────┘  └─────────────────┘  └──────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐   │
│  │ FFmpegRunner  │  │ TaskQueue       │  │ OutputManager│   │
│  │ 进程管理       │  │ 串行队列         │  │ 路径/冲突     │   │
│  │ 进度解析       │  │ EventEmitter    │  │ 安全替换      │   │
│  │ two-pass      │  │ 事件驱动         │  │ 磁盘检查      │   │
│  └──────────────┘  └─────────────────┘  └──────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐   │
│  │ FFmpegManager │  │ HistoryStore    │  │ EtaEstimator │   │
│  │ 三优先级解析   │  │ JSON 持久化      │  │ 三层估算      │   │
│  │ 应用内更新     │  │ JSON/CSV 导出    │  │ Quick Probe  │   │
│  │ 启动修复       │  │                 │  │ Benchmark    │   │
│  └──────────────┘  └─────────────────┘  └──────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────┐   │
│  │ SettingsStore │  │ BenchmarkStore  │  │ DeviceProfiler│  │
│  │ JSON 持久化   │  │ 速度基准记录      │  │ 硬件检测      │   │
│  │ Schema 迁移   │  │ 最多 100 条      │  │ 编码器发现    │   │
│  └──────────────┘  └─────────────────┘  └──────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ spawn / execFile (参数数组)
┌──────────────────────────▼──────────────────────────────────┐
│                    FFmpeg / FFprobe                          │
│  三优先级: 用户更新版 > 内嵌版 > 系统 PATH（仅开发模式）        │
└─────────────────────────────────────────────────────────────┘
```

**核心流程：** 添加视频 → 扫描 → FFprobe 分析 → 生成压缩计划 → FFmpeg 执行 → 输出处理 → 历史记录

---

## 安全设计

- **参数数组传递** — `spawn` / `execFile` 使用参数数组，不拼接 shell 字符串，防止命令注入
- **contextBridge 隔离** — 渲染进程通过受控 API 访问主进程能力，不暴露 Node.js 全局对象
- **打包环境隔离** — 打包后不依赖系统 PATH 中的 FFmpeg，使用内嵌或用户更新版本
- **原子更新** — FFmpeg 更新使用 staging → current → previous 目录切换，支持回滚
- **Backup-then-swap** — 文件替换先备份 → 写入 → 成功后删除备份，失败自动回滚
- **Zip Slip 防护** — FFmpeg 更新解压时校验路径，防止目录穿越攻击
- **启动修复** — 应用启动时自动检测并恢复中断的 FFmpeg 更新状态

---

## 运行方式

### 环境要求

- **Node.js 18+**
- **npm 9+**

### 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（Electron + Vite HMR）
npm run dev
```

### 代码质量

```bash
# TypeScript 类型检查
npm run typecheck

# ESLint 代码检查
npm run lint

# 运行测试（138 个测试用例）
npm test

# 监听模式运行测试
npm run test:watch
```

### 构建和打包

```bash
# 构建生产版本
npm run build

# 打包 Windows 安装程序
npm run dist

# 清理后重新打包
npm run package:win
```

---

## 打包说明

- **Windows exe 输出目录** — `dist/shrinkflow-{version}-setup.exe`
- **内嵌 FFmpeg 文件位置** — `resources/ffmpeg/win32/x64/ffmpeg.exe` 和 `ffprobe.exe`
- **自动下载** — `npm run dist` 的 `predist` 脚本会自动检查并下载 FFmpeg 二进制文件
- **extraResources 打包** — FFmpeg 通过 electron-builder 的 `extraResources` 配置打包到应用 resources 目录，不放入 app.asar 内部，避免从 asar 中直接执行二进制文件
- **当前主要支持 Windows** — macOS/Linux 打包支持在规划中

---

## 测试结果

| 项目 | 结果 |
|---|---|
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `npm test` | 138/138 passed |
| `npm run lint` | 0 errors |
| `npm run dist` | Pass |

---

## 当前限制

- 当前主要支持 Windows，macOS/Linux 打包在规划中
- 还没有应用自动更新机制
- 还没有 Light Theme 实现（仅有 Catppuccin Mocha 暗色主题）
- Lint 仍有部分 warnings（不影响功能）
- 还没有硬件编码模式选择（已检测硬件编码器，但压缩模式使用软件编码）
- FFmpeg 构建许可证需根据实际发布版本确认（当前使用 BtbN 构建）

---

## 作品集价值

这个项目展示了以下能力：

- **桌面端产品设计能力** — 从用户痛点出发，设计完整的批量压缩工作流
- **文件处理和任务队列能力** — 递归扫描、去重、串行队列、进度追踪、失败恢复
- **FFmpeg 工程化封装能力** — 6 种压缩模式、two-pass 编码、进度解析、二进制生命周期管理
- **用户数据安全意识** — backup-then-swap、磁盘空间检查、失败回滚
- **Electron 安全边界意识** — contextBridge 隔离、参数数组传递、extraResources 隔离
- **产品从 Demo 到可打包版本的推进能力** — 完整测试、清晰的构建脚本、NSIS 安装包，具备接入 CI 的基础

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面框架 | Electron 33 |
| 前端框架 | React 18 |
| 语言 | TypeScript 5.9 |
| 构建工具 | electron-vite (Vite 5) |
| 样式 | Tailwind CSS 3.4 |
| 状态管理 | Zustand 5 |
| 路由 | React Router 6 |
| 国际化 | i18next 26 |
| 测试 | Vitest 4 |
| 打包 | electron-builder 25 |

---

## 界面预览

> 以下截图可在后续补充：
> - 压缩首页（视频列表与模式选择）
> - Target Size Accurate two-pass 压缩中
> - 压缩完成结果汇总
> - 历史记录与 CSV/JSON 导出
> - 设置页 FFmpeg 状态与检查更新

---

## 手动验收场景

以下场景需在打包后的 exe 中手动验证：

1. **拖拽单个视频导入** — 文件出现在列表中，元信息正确显示
2. **拖拽文件夹递归扫描** — 自动扫描子目录中的视频，跳过非视频文件和输出目录
3. **默认模式压缩** — 输出到 `ShrinkFlow_Output` 子目录，文件名添加 `_compressed` 后缀
4. **Target Size Accurate two-pass** — 显示 Pass 1/2 阶段提示，输出文件大小接近目标值
5. **替换原文件安全回滚** — 压缩中断后原文件仍完整保留（backup-then-swap 机制）
6. **历史 JSON / CSV 导出** — 导出文件可正常打开，数据与界面显示一致
7. **FFmpeg 检查更新** — 点击"检查更新"后显示当前状态，不会自动下载
8. **FFmpeg 更新流程** — 点击"更新 FFmpeg"后才开始下载，进度可见，完成后可回退

---

## Author

Created by **Jevon**

这是一个面向作品集展示的桌面工具项目，重点体现产品设计、Electron 桌面应用开发、FFmpeg 工程化封装和用户数据安全设计。

- GitHub: 待补充
- Portfolio: 待补充
- LinkedIn: 待补充

---

## License

ShrinkFlow 源码部分采用 MIT License，Copyright (c) 2026 Jevon。

本项目使用 FFmpeg / FFprobe 作为第三方开源组件。FFmpeg 的许可证取决于实际打包使用的构建版本；如果使用 GPL 构建，需要遵守对应 GPL 许可证要求。正式对外发布前，请确认 `resources/ffmpeg/win32/x64/LICENSE.txt` 与实际分发的 FFmpeg build 一致。

FFmpeg 和 FFprobe 是 FFmpeg 团队（https://ffmpeg.org）的独立项目，不属于 ShrinkFlow 自研组件。
