# ShrinkFlow 完整可执行开发计划

版本：V1.0  
项目类型：桌面端本地视频压缩工具  
核心定位：本地优先、目标导向、批量处理、进度透明、硬件感知 ETA 的智能视频压缩工作流工具

---

## 0. 开发计划总览

ShrinkFlow 的开发不建议一上来就追求“完整智能化”，而应按 **MVP → P1 增强 → P2 智能亮点** 三层推进。

第一版目标不是做一个功能很多但不稳定的压缩软件，而是做出一个可以完整演示的闭环：

```text
导入视频 / 文件夹
  ↓
扫描视频信息
  ↓
选择压缩模式
  ↓
开始本地压缩
  ↓
展示实时进度和剩余时间
  ↓
输出压缩结果报告
```

开发优先级原则：

1. **先跑通主链路，再做智能化。**
2. **先保证原文件安全，再追求压缩效率。**
3. **先支持单任务稳定，再做批量队列。**
4. **先做压缩中 ETA，再做压缩前 ETA。**
5. **先用规则推荐，再升级为硬件感知和历史校准。**

---

# 一、项目边界确认

## 1.1 MVP 范围

MVP 必须完成以下能力：

| 模块 | MVP 功能 |
|---|---|
| 桌面应用 | Electron + React + TypeScript 基础应用 |
| 文件导入 | 单文件、多文件、文件夹导入 |
| 文件扫描 | 识别视频文件、过滤非视频、跳过不支持格式 |
| 视频分析 | 使用 FFprobe 读取时长、大小、分辨率、编码格式、码率 |
| 压缩模式 | Balanced、Quality First、Smallest Size、Fast Target Size |
| 压缩执行 | 使用 FFmpeg 本地压缩 |
| 输出管理 | 选择输出目录、默认输出目录、文件名冲突保护 |
| 进度展示 | 当前文件进度、整体任务进度 |
| ETA | 压缩中剩余时间估算 |
| 任务控制 | 开始、取消、失败跳过 |
| 结果报告 | 原始大小、压缩后大小、节省空间、成功/失败数量 |

## 1.2 MVP 暂不做的功能

以下功能不进入第一版，避免项目过大：

| 功能 | 暂不做原因 | 放入阶段 |
|---|---|---|
| 压缩前硬件感知 ETA | 依赖设备画像和历史速度模型 | P1 |
| Accurate Target Size two-pass | 技术复杂度高于单次编码 | P1 |
| 暂停当前 FFmpeg 编码 | 跨平台实现不稳定 | P2 或不做 |
| GPU 自动加速 | 不同系统差异大 | P2 |
| 画质评分 | 需要抽帧和质量算法 | P2 |
| 压缩前后画面对比 | 需要截图和对比 UI | P2 |
| 自动更新 | 与核心功能无关 | P2 |
| 多语言 | 非核心链路 | P2 |

## 1.3 第一版推荐平台

优先开发：

```text
Windows 桌面端
```

原因：

- 用户更可能在 Windows 上处理本地视频文件。
- 文件夹选择、FFmpeg 调用、Electron 打包路径都需要优先跑通一个平台。
- macOS 可以作为第二平台适配。

---

# 二、技术方案落地版

## 2.1 最终技术栈

| 层级 | 技术 | 用途 |
|---|---|---|
| 桌面框架 | Electron | 访问本地文件系统、调用 FFmpeg |
| 前端框架 | React | 构建用户界面 |
| 语言 | TypeScript | 类型安全和工程规范 |
| 构建工具 | Vite / electron-vite | 提升开发效率 |
| UI 样式 | Tailwind CSS | 快速构建现代界面 |
| UI 组件 | shadcn/ui | Button、Card、Progress、Dialog、Table 等 |
| 状态管理 | Zustand | 管理视频列表、任务状态、压缩配置 |
| 视频分析 | FFprobe | 读取视频元信息 |
| 视频压缩 | FFmpeg | 执行本地压缩 |
| 本地存储 | SQLite / JSON Store | 保存历史记录、设置、性能数据 |
| 打包 | electron-builder | 打包 Windows / macOS 应用 |

## 2.2 MVP 存储策略

为了降低第一版开发复杂度，建议分两步：

### MVP 早期

使用轻量 JSON 本地存储，保存：

- 用户设置
- 最近任务记录
- 默认输出目录

### MVP 后期 / P1

再迁移到 SQLite，保存：

- 压缩历史
- 视频元信息
- 任务结果
- 设备画像
- 历史压缩速度
- ETA 估算误差

这样做的好处：

1. 第一阶段可以更快跑通主链路。
2. 避免 Electron + SQLite 原生依赖配置阻塞项目。
3. 后续再引入 SQLite 时，可以作为一次明确的架构升级点。

---

# 三、推荐目录结构

```text
shrinkflow/
  package.json
  README.md
  electron-builder.yml
  public/
    ffmpeg/
      win/
      mac/
  src/
    main/
      index.ts
      preload.ts
      modules/
        file-scanner/
          index.ts
          types.ts
        video-analyzer/
          index.ts
          types.ts
        compression-planner/
          index.ts
          presets.ts
          types.ts
        ffmpeg-runner/
          index.ts
          progress-parser.ts
          command-builder.ts
          types.ts
        task-queue/
          index.ts
          types.ts
        output-manager/
          index.ts
          types.ts
        settings-store/
          index.ts
        history-store/
          index.ts
        device-profiler/
          index.ts
          types.ts
        eta-estimator/
          index.ts
          types.ts
      ipc/
        file.ipc.ts
        video.ipc.ts
        compression.ipc.ts
        settings.ipc.ts
        history.ipc.ts
    preload/
      index.ts
    renderer/
      main.tsx
      App.tsx
      pages/
        CompressPage.tsx
        HistoryPage.tsx
        SettingsPage.tsx
      components/
        layout/
          AppShell.tsx
          Sidebar.tsx
          TopBar.tsx
        import/
          ImportDropzone.tsx
          ScanSummary.tsx
        videos/
          VideoTable.tsx
          VideoDetailDrawer.tsx
        compression/
          CompressionModeCards.tsx
          TargetSizePanel.tsx
          AdvancedSettingsPanel.tsx
          OutputSettingsPanel.tsx
        progress/
          CurrentFileProgress.tsx
          OverallProgress.tsx
          TaskControlBar.tsx
        result/
          ResultSummary.tsx
          ResultTable.tsx
        common/
          EmptyState.tsx
          StatusBadge.tsx
          ConfirmDialog.tsx
      stores/
        videoStore.ts
        compressionStore.ts
        taskStore.ts
        settingsStore.ts
      types/
        video.ts
        compression.ts
        task.ts
        settings.ts
      utils/
        formatBytes.ts
        formatDuration.ts
        path.ts
```

---

# 四、核心开发里程碑

## Milestone 0：项目初始化与工程骨架

### 目标

搭建可运行的 Electron + React + TypeScript 桌面应用骨架。

### 开发任务

- 初始化 Electron + React + TypeScript 项目。
- 配置 Vite 或 electron-vite。
- 配置 Tailwind CSS。
- 配置基础 ESLint / Prettier。
- 创建主进程、预加载脚本、渲染进程。
- 建立安全 IPC 通信方式。
- 搭建基础页面布局：Sidebar + TopBar + Main Workspace。
- 创建 Compress、History、Settings 三个页面入口。

### 关键文件

```text
src/main/index.ts
src/preload/index.ts
src/renderer/App.tsx
src/renderer/pages/CompressPage.tsx
```

### 验收标准

- 应用可以在本地启动。
- 页面可以显示 ShrinkFlow 主界面。
- 左侧导航可以切换 Compress / History / Settings。
- Renderer 不能直接访问 Node API，必须通过 preload 暴露安全方法。
- 主进程和渲染进程可以完成一次简单 IPC 测试。

---

## Milestone 1：文件导入与扫描模块

### 目标

支持用户选择视频文件和文件夹，并将有效视频加入列表。

### 开发任务

#### 1. 文件选择 IPC

实现：

```ts
window.shrinkflow.selectVideos()
window.shrinkflow.selectFolders()
```

对应主进程能力：

- 打开文件选择器。
- 支持多选视频文件。
- 支持选择文件夹。
- 返回本地路径列表。

#### 2. 文件扫描模块 FileScanner

实现能力：

- 接收文件路径和文件夹路径。
- 识别支持的视频扩展名。
- 过滤非视频文件。
- 默认不递归扫描子文件夹。
- 支持可选 includeSubfolders。
- 检测重复路径。
- 跳过无权限路径。
- 返回扫描结果和跳过原因。

支持格式 MVP：

```text
.mp4
.mov
.mkv
.avi
.webm
.m4v
```

#### 3. 前端导入 UI

组件：

```text
ImportDropzone
ScanSummary
VideoTable
```

UI 行为：

- 空状态展示拖拽区域。
- 点击 Add Videos 打开文件选择器。
- 点击 Add Folders 打开文件夹选择器。
- 导入后展示视频列表。
- 扫描完成后展示 found / skipped summary。

### 数据类型

```ts
type ScanResult = {
  videos: ScannedVideoFile[];
  skipped: SkippedFile[];
};

type ScannedVideoFile = {
  id: string;
  fileName: string;
  filePath: string;
  extension: string;
  fileSize: number;
  status: 'scanned';
};

type SkippedFile = {
  path: string;
  reason: 'unsupported_format' | 'permission_denied' | 'duplicate' | 'unknown_error';
};
```

### 验收标准

- 可以选择单个视频并加入列表。
- 可以一次选择多个视频并加入列表。
- 可以选择一个文件夹并扫描其中视频。
- 非视频文件不会加入列表。
- 重复路径不会重复加入。
- 跳过文件会在 Scan Summary 中展示原因。
- 大文件夹扫描时 UI 不应卡死。

---

## Milestone 2：视频元信息分析模块

### 目标

使用 FFprobe 分析视频，获取压缩决策所需的基础数据。

### 开发任务

#### 1. 集成 FFprobe

实现模块：

```text
video-analyzer
```

读取字段：

- duration
- width
- height
- videoCodec
- audioCodec
- bitrate
- frameRate
- format
- audioBitrate

#### 2. 分析队列

导入视频后，逐个调用 FFprobe。

状态变化：

```text
scanned → analyzing → ready / failed
```

#### 3. 前端展示元信息

VideoTable 增加字段：

| 字段 | 示例 |
|---|---|
| Size | 1.2 GB |
| Duration | 00:12:35 |
| Resolution | 1920 × 1080 |
| Codec | H.264 |
| Bitrate | 8500 kbps |
| Status | Ready |

### 数据类型

```ts
type VideoFile = {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  extension: string;
  duration?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  frameRate?: number;
  status: 'scanned' | 'analyzing' | 'ready' | 'failed';
  errorMessage?: string;
};
```

### 验收标准

- 导入视频后可以自动分析元信息。
- 分析失败的视频显示 Failed 和错误原因。
- 分析失败不影响其他视频继续分析。
- 10 个视频连续分析时 UI 不卡死。
- 视频元信息能正确显示在列表中。

---

## Milestone 3：压缩策略与参数生成

### 目标

根据用户选择的压缩模式，生成对应的 FFmpeg 参数。

### 开发任务

#### 1. CompressionPlanner 模块

实现：

```ts
planCompression(video: VideoFile, settings: CompressionSettings): CompressionPlan
```

输入：

- 视频元信息
- 用户选择的模式
- 目标大小
- 输出路径

输出：

- FFmpeg 参数
- 预计输出格式
- 预计风险提示

#### 2. 支持四种 MVP 模式

##### Balanced

默认推荐模式：

```text
codec: libx264
preset: medium
crf: 24
audio: aac 128k
resolution: original
```

##### Quality First

偏画质：

```text
codec: libx264
preset: slow
crf: 20
audio: aac 192k
resolution: original
```

##### Smallest Size

偏体积：

```text
codec: libx264
preset: medium
crf: 30
audio: aac 96k
resolution: max 720p
```

##### Fast Target Size

基于目标大小计算视频码率：

```text
targetTotalBitrate = targetSizeBits / durationSeconds
videoBitrate = targetTotalBitrate - audioBitrate
```

需要加入保护规则：

- 如果目标码率过低，提示画质风险。
- 如果目标大小小于合理下限，阻止开始压缩。
- 音频码率最低不低于 64k。

#### 3. 前端压缩设置 UI

组件：

```text
CompressionModeCards
TargetSizePanel
OutputSettingsPanel
AdvancedSettingsPanel
```

MVP 默认隐藏高级参数。

### 数据类型

```ts
type CompressionMode =
  | 'balanced'
  | 'quality_first'
  | 'smallest_size'
  | 'target_size_fast';

type CompressionSettings = {
  mode: CompressionMode;
  targetSizeMB?: number;
  outputDir: string;
  outputFormat: 'mp4';
  overwritePolicy: 'rename';
};

type CompressionPlan = {
  videoId: string;
  inputPath: string;
  outputPath: string;
  args: string[];
  warnings: string[];
};
```

### 验收标准

- 选择不同模式时可以生成不同 FFmpeg 参数。
- Target Size 模式能根据时长计算目标码率。
- 不合理目标大小会显示警告。
- 输出路径不会覆盖原文件。
- 所有 ready 视频都能生成 CompressionPlan。

---

## Milestone 4：FFmpeg 压缩执行与进度解析

### 目标

真正执行视频压缩，并将 FFmpeg 进度实时推送到前端。

### 开发任务

#### 1. FFmpegRunner 模块

职责：

- 根据 CompressionPlan 启动 FFmpeg 子进程。
- 监听 stdout / stderr。
- 解析 progress 信息。
- 支持取消当前任务。
- 任务结束后返回结果。

推荐使用：

```bash
-progress pipe:1 -nostats
```

解析字段：

```text
out_time_ms
speed
progress
```

#### 2. 单文件进度计算

```text
currentPercent = outTimeSeconds / videoDurationSeconds * 100
```

#### 3. 单文件 ETA

```text
eta = elapsedSeconds * (100 - currentPercent) / currentPercent
```

当进度小于 5%：

```text
Estimating...
```

#### 4. 前端进度 UI

组件：

```text
CurrentFileProgress
OverallProgress
TaskControlBar
```

展示内容：

- 当前文件名
- 当前文件进度
- 当前文件 ETA
- 编码速度
- 已完成数量
- 总进度
- 成功/失败/等待数量

### 数据类型

```ts
type CompressionProgress = {
  taskId: string;
  videoId: string;
  fileName: string;
  percent: number;
  outTimeSeconds: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds?: number;
  speed?: string;
  status: 'compressing' | 'completed' | 'failed' | 'canceled';
};
```

### 验收标准

- 可以成功压缩一个视频。
- 前端可以实时看到进度条变化。
- 当前文件 ETA 可以动态更新。
- 压缩完成后输出文件存在且可播放。
- 压缩失败时可以看到错误原因。
- 用户点击 Cancel 可以终止当前 FFmpeg 进程。

---

## Milestone 5：批量任务队列

### 目标

支持多个视频按队列依次压缩，并展示整体进度。

### 开发任务

#### 1. TaskQueue 模块

职责：

- 接收多个 CompressionPlan。
- 默认串行执行。
- 当前任务完成后自动执行下一个。
- 单个任务失败不影响后续任务。
- 支持取消整个队列。

状态流转：

```text
pending → compressing → completed / failed / canceled
```

#### 2. 总进度计算

MVP 使用文件数量方式：

```text
overallPercent = (completedFiles + currentFilePercent / 100) / totalFiles * 100
```

P1 再升级为按视频时长加权。

#### 3. 失败处理

失败文件应记录：

- 文件名
- 失败阶段
- FFmpeg 错误信息
- 是否可重试

#### 4. 前端任务状态

列表中每一行展示状态：

```text
Ready
Queued
Compressing
Done
Failed
Canceled
```

### 数据类型

```ts
type CompressionTask = {
  id: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'partial_failed' | 'canceled';
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentVideoId?: string;
  startedAt?: string;
  completedAt?: string;
};

type TaskItem = {
  id: string;
  taskId: string;
  videoId: string;
  status: 'pending' | 'compressing' | 'completed' | 'failed' | 'canceled';
  outputPath?: string;
  errorMessage?: string;
};
```

### 验收标准

- 多个视频可以依次压缩。
- 某个视频失败后，后续视频仍继续处理。
- 总进度可以正确更新。
- 任务完成后可以看到成功数和失败数。
- 取消队列后，当前 FFmpeg 被终止，等待任务变为 canceled。

---

## Milestone 6：输出管理与结果报告

### 目标

保证原文件安全，生成清晰的压缩结果报告。

### 开发任务

#### 1. OutputManager 模块

职责：

- 生成输出目录。
- 生成输出文件名。
- 防止覆盖原文件。
- 处理同名文件冲突。
- 检查磁盘空间。

默认输出规则：

```text
原文件目录/ShrinkFlow_Output/原文件名_compressed.mp4
```

冲突处理：

```text
video_compressed.mp4
video_compressed_1.mp4
video_compressed_2.mp4
```

#### 2. 磁盘空间检查

开始前检查输出目录可用空间。

MVP 简化规则：

```text
如果可用空间 < 原始总大小的 20%，提示风险
```

更严格规则可以在 P1 中优化。

#### 3. 结果报告

展示总览：

- 总文件数
- 成功数
- 失败数
- 原始总大小
- 压缩后总大小
- 节省空间
- 节省比例
- 总耗时

展示单文件结果：

- 原文件大小
- 压缩后大小
- 压缩率
- 输出路径
- 耗时
- 状态
- 错误原因

### 验收标准

- 原文件不会被覆盖。
- 输出文件统一生成到正确目录。
- 同名文件会自动重命名。
- 结果报告数据准确。
- 用户可以点击 Open Output Folder 打开输出目录。

---

## Milestone 7：历史记录与设置

### 目标

保存用户常用设置和压缩历史，提升产品完整度。

### 开发任务

#### 1. SettingsStore

保存：

- 默认输出目录
- 默认压缩模式
- 是否保留文件夹结构
- 主题模式
- 是否自动打开输出目录

#### 2. HistoryStore

保存：

- 任务时间
- 文件数量
- 原始总大小
- 压缩后总大小
- 节省比例
- 输出目录
- 成功/失败状态

#### 3. History 页面

展示表格：

| Date | Files | Original | Output | Saved | Mode | Status | Action |
|---|---|---|---|---|---|---|---|

操作：

- 打开输出目录
- 删除历史记录
- 查看任务详情

### 验收标准

- 应用关闭后设置仍保留。
- 历史页面可以看到已完成任务。
- 删除历史记录不会删除输出文件。
- 默认输出目录和默认压缩模式可以修改。

---

# 五、P1 增强计划

P1 的目标是让 ShrinkFlow 从“能用的压缩工具”升级成“更智能的压缩工作流工具”。

## P1.1 硬件信息扫描

### 模块

```text
DeviceProfiler
```

### 读取内容

- 操作系统
- CPU 型号
- CPU 核心数
- 内存大小
- FFmpeg 版本
- 可用硬件编码器
- 可用磁盘空间

### 输出类型

```ts
type DeviceProfile = {
  platform: 'windows' | 'macos' | 'linux';
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  hardwareEncoders: string[];
  ffmpegVersion: string;
};
```

### 验收标准

- Settings 页面可以看到基础设备信息。
- 系统可以识别是否存在硬件编码器。
- 没有硬件编码器时不影响软件编码。

---

## P1.2 压缩前 ETA 预估

### 模块

```text
EtaEstimator
```

### 估算逻辑

```text
预计耗时 = 视频总时长 / 预计编码速度倍率
```

初始速度倍率通过规则估算：

| 条件 | 速度影响 |
|---|---|
| 720p | 较快 |
| 1080p | 标准 |
| 4K | 较慢 |
| H.264 CPU | 标准 |
| H.265 CPU | 较慢 |
| GPU 编码 | 较快 |
| Quality First | 较慢 |
| Smallest Size | 标准或偏慢 |

展示方式：

```text
Estimated time: 8–12 min
Confidence: Low / Medium / High
```

### 验收标准

- 压缩开始前可以展示预计时间范围。
- 没有历史数据时显示低置信度。
- 压缩过程中实时 ETA 会覆盖压缩前粗估。

---

## P1.3 历史速度校准

### 思路

每次压缩完成后记录：

```text
视频时长 / 实际压缩耗时 = 实际速度倍率
```

后续遇到相似任务时，用历史速度修正 ETA。

### 数据表

```text
compression_benchmarks
```

字段：

- inputCodec
- outputCodec
- resolutionBucket
- mode
- encoderType
- videoDurationSeconds
- actualDurationSeconds
- speedMultiplier

### 验收标准

- 完成任务后能记录 speedMultiplier。
- 后续 ETA 能读取历史平均速度。
- 有历史数据时 ETA confidence 提升。

---

## P1.4 Accurate Target Size

### 目标

通过 two-pass encoding 提升目标大小命中率。

### UI

```text
Accuracy:
○ Fast - quicker, approximate size
○ Accurate - slower, closer to target
```

### 技术点

- 第一遍分析。
- 第二遍正式输出。
- 处理 Windows 的 NUL 和 macOS/Linux 的 /dev/null。
- 清理 pass log 临时文件。
- 总进度按 passCount = 2 计算。

### 验收标准

- Accurate 模式能成功输出视频。
- 输出大小比 Fast 模式更接近目标大小。
- two-pass 临时文件会被清理。

---

# 六、P2 智能亮点计划

P2 用于作品集包装和差异化展示，不建议早期投入过多。

## P2.1 GPU 加速策略

提供三种模式：

```text
Quality：CPU 编码，画质优先
Speed：GPU 编码，速度优先
Auto：系统自动选择
```

注意文案：

```text
GPU acceleration is faster, but may not always produce better compression quality.
```

## P2.2 压缩前后画面对比

流程：

1. 从原视频抽取关键帧。
2. 从压缩后视频抽取同时间点帧。
3. 前端展示 before / after 对比。

## P2.3 质量评分

分为两级：

### 规则评分

根据：

- 是否降分辨率
- CRF 高低
- 目标码率是否过低
- 文件体积压缩比例是否过大

输出：

```text
Expected quality: Good / Medium / Low
```

### 算法评分

后续可研究：

- SSIM
- PSNR
- VMAF

---

# 七、开发顺序建议

严格按照以下顺序开发，不建议跳步：

```text
1. Electron 应用骨架
2. 页面布局和基础 UI
3. 文件选择 IPC
4. 文件扫描 FileScanner
5. 视频列表 VideoTable
6. FFprobe 视频分析
7. 压缩模式 UI
8. CompressionPlanner 参数生成
9. 单视频 FFmpeg 压缩
10. FFmpeg progress 解析
11. 当前文件进度条
12. 批量任务队列
13. 总进度条
14. 输出目录和文件名保护
15. 结果报告
16. 设置保存
17. 历史记录
18. 打包发布
19. P1 硬件扫描
20. P1 压缩前 ETA
21. P1 历史速度校准
22. P1 Accurate Target Size
```

原因：

- 如果没有文件扫描，就无法验证视频分析。
- 如果没有视频分析，就无法计算压缩参数和进度。
- 如果没有单视频压缩，就不该做批量队列。
- 如果没有历史任务，就不该做历史校准 ETA。

---

# 八、每日开发检查清单

每完成一个小功能，都用以下清单自检。

## 8.1 功能自检

- 这个功能是否跑通了真实输入？
- 是否处理了空状态？
- 是否处理了失败状态？
- 是否有用户可理解的错误提示？
- 是否影响原文件安全？
- 是否会阻塞 UI？

## 8.2 视频压缩自检

- 输出文件是否可播放？
- 输出文件是否真的变小？
- 输出文件是否被错误覆盖？
- 原文件是否保持不变？
- 压缩失败时是否有错误提示？
- 批量压缩时失败文件是否影响后续文件？

## 8.3 UI 自检

- 用户是否知道下一步该点哪里？
- 用户是否能看到当前状态？
- 用户是否能理解失败原因？
- 用户是否能找到输出文件？
- 用户是否能看懂压缩效果？

---

# 九、测试计划

## 9.1 测试视频准备

至少准备以下测试文件：

| 类型 | 用途 |
|---|---|
| 10 秒 720p MP4 | 快速测试 |
| 1 分钟 1080p MP4 | 常规测试 |
| 5 分钟 1080p MOV | 中等体积测试 |
| 4K 视频 | 高分辨率测试 |
| MKV 文件 | 格式兼容测试 |
| 非视频文件 | 扫描过滤测试 |
| 损坏视频文件 | 错误处理测试 |
| 中文文件名视频 | 路径兼容测试 |
| 超长文件名视频 | 文件名处理测试 |
| 同名视频 | 输出冲突测试 |

## 9.2 核心测试用例

### 文件导入

- 导入单个 MP4。
- 导入多个视频。
- 导入包含视频和非视频的文件夹。
- 导入空文件夹。
- 导入重复文件。
- 导入中文路径文件。

### 视频分析

- 正常视频能读取元信息。
- 损坏视频显示分析失败。
- 分析失败不影响其他视频。

### 压缩执行

- Balanced 模式输出成功。
- Quality First 模式输出成功。
- Smallest Size 模式输出成功。
- Target Size Fast 模式输出成功。
- 目标大小过小时显示警告。
- 用户取消时 FFmpeg 被终止。

### 批量任务

- 3 个视频依次压缩成功。
- 中间一个失败，后续继续。
- 批量任务总进度正确。
- 完成后结果报告准确。

### 输出安全

- 不覆盖原文件。
- 同名输出自动加序号。
- 输出目录不存在时自动创建。
- 输出目录不可写时提示错误。

---

# 十、打包与发布计划

## 10.1 打包前检查

- FFmpeg 路径在开发环境和打包环境均可用。
- Windows 路径空格和中文路径可正常处理。
- 输出目录权限检查正常。
- 应用关闭时，如果有任务正在执行，需要弹窗确认。
- 打包后选择文件、压缩、打开输出目录均正常。

## 10.2 README 内容

README 应包含：

1. 项目简介
2. 产品截图
3. 核心功能
4. 技术栈
5. 本地运行方式
6. 项目架构图
7. 压缩流程图
8. 智能 ETA 规划说明
9. 后续 Roadmap

## 10.3 Demo 展示脚本

演示顺序：

```text
1. 打开 ShrinkFlow
2. 拖入多个视频
3. 展示视频扫描和元信息分析
4. 选择 Balanced 模式
5. 展示预计输出或压缩设置
6. 点击 Start Compression
7. 展示实时进度和 ETA
8. 压缩完成
9. 展示节省空间和结果报告
10. 打开输出文件夹
```

---

# 十一、风险清单与解决方案

## 11.1 FFmpeg 路径问题

风险：开发环境可用，打包后找不到 FFmpeg。

解决：

- 将 FFmpeg 作为应用资源打包。
- 根据 `process.platform` 获取不同平台路径。
- 启动时检测 FFmpeg 是否可用。

## 11.2 中文路径和空格路径问题

风险：FFmpeg 命令路径解析失败。

解决：

- 使用 spawn 参数数组，不拼接字符串命令。
- 所有路径作为独立参数传入。

## 11.3 UI 卡顿

风险：扫描文件夹或分析视频时阻塞前端。

解决：

- 所有重任务放在 Electron Main Process。
- Renderer 只接收进度事件。
- 扫描和分析使用队列逐步执行。

## 11.4 输出文件覆盖

风险：误覆盖用户原视频。

解决：

- 默认不允许覆盖。
- 输出目录默认使用 ShrinkFlow_Output。
- 同名文件自动加序号。

## 11.5 ETA 不准确

风险：用户不信任预计时间。

解决：

- MVP 只展示压缩中 ETA。
- 小于 5% 进度时显示 Estimating。
- P1 压缩前 ETA 使用范围值，不展示精确秒数。
- 历史数据足够后提升置信度。

## 11.6 Target Size 输出不准

风险：单次编码无法严格命中目标大小。

解决：

- MVP 命名为 Fast Target Size。
- UI 明确说明 approximate size。
- P1 提供 Accurate two-pass 模式。

---

# 十二、MVP 完成定义

当以下条件全部满足时，可以认为 ShrinkFlow MVP 完成：

## 12.1 功能闭环

- 用户可以导入一个或多个视频。
- 用户可以导入文件夹。
- 系统可以读取视频信息。
- 用户可以选择压缩模式。
- 系统可以完成本地压缩。
- 用户可以看到压缩进度。
- 用户可以看到剩余时间。
- 用户可以看到结果报告。
- 用户可以打开输出文件夹。

## 12.2 安全要求

- 原文件不会被覆盖。
- 输出文件名冲突会自动处理。
- 压缩失败不会导致应用崩溃。
- 批量任务中单个失败不会阻断全部任务。

## 12.3 展示要求

- 有一个可演示的视频压缩流程。
- 有 README。
- 有至少 3 张产品截图。
- 有项目架构说明。
- 有后续 Roadmap。
- 可以写入简历。

---

# 十三、推荐 Commit 拆分

为了让 GitHub 项目看起来专业，建议按功能提交：

```text
feat: initialize electron react app
feat: add app shell layout
feat: implement file picker ipc
feat: add file scanner module
feat: display imported video list
feat: integrate ffprobe video analyzer
feat: add compression mode selector
feat: implement compression planner
feat: run ffmpeg compression for single video
feat: parse ffmpeg progress events
feat: add current file progress panel
feat: implement batch task queue
feat: add output manager and conflict handling
feat: add compression result summary
feat: persist app settings
feat: add compression history page
chore: configure electron builder
chore: add README and demo assets
```

---

# 十四、给 AI 编程工具的执行提示词模板

以下提示词可以用于 Claude Code / Codex 分阶段生成代码。

## 14.1 初始化项目提示词

```text
You are helping me build ShrinkFlow, a local-first smart video compression desktop app.

Tech stack:
- Electron
- React
- TypeScript
- Vite or electron-vite
- Tailwind CSS
- Zustand

Please initialize the project structure with:
- Electron main process
- preload script with safe IPC exposure
- React renderer process
- AppShell layout
- Sidebar navigation: Compress, History, Settings
- Basic TypeScript types

Do not implement FFmpeg yet. Focus on a clean runnable skeleton.
```

## 14.2 文件导入提示词

```text
Implement file and folder import for ShrinkFlow.

Requirements:
- Add IPC methods selectVideos and selectFolders
- Use Electron dialog in the main process
- Support selecting multiple video files
- Support selecting folders
- Add a FileScanner module
- Filter supported extensions: mp4, mov, mkv, avi, webm, m4v
- Skip unsupported files with reasons
- Deduplicate paths
- Return scanned videos to the renderer
- Display videos in a VideoTable

Keep Node APIs out of the renderer. Use preload APIs only.
```

## 14.3 视频分析提示词

```text
Implement FFprobe-based video metadata analysis for ShrinkFlow.

Requirements:
- Add a VideoAnalyzer module in Electron main process
- Use ffprobe to read duration, width, height, bitrate, video codec, audio codec, frame rate
- Analyze videos after scanning
- Update each video status: analyzing, ready, failed
- Send analysis results to React through IPC
- Display metadata in the video table
- Handle corrupted or unsupported videos gracefully
```

## 14.4 压缩执行提示词

```text
Implement FFmpeg compression for a single video in ShrinkFlow.

Requirements:
- Add CompressionPlanner module
- Support modes: balanced, quality_first, smallest_size, target_size_fast
- Generate FFmpeg args safely as an array, not a shell string
- Add FFmpegRunner module
- Run ffmpeg from Electron main process using spawn
- Use -progress pipe:1 -nostats
- Parse out_time_ms and speed
- Send progress events to renderer
- Display current file progress and ETA
- Ensure original files are never overwritten
```

## 14.5 批量队列提示词

```text
Implement batch compression queue for ShrinkFlow.

Requirements:
- Add TaskQueue module
- Run compression jobs sequentially by default
- Continue queue when one file fails
- Track statuses: pending, compressing, completed, failed, canceled
- Calculate overall progress
- Send queue progress to renderer
- Add cancel task support
- Show result summary when all jobs finish
```

---

# 十五、最终开发路线图

```text
Phase 1：项目骨架
  - Electron + React + TypeScript
  - 基础布局
  - IPC 通信

Phase 2：文件导入
  - 文件选择
  - 文件夹扫描
  - 视频列表
  - 跳过文件 summary

Phase 3：视频分析
  - FFprobe 集成
  - 元信息读取
  - 分析状态管理

Phase 4：单视频压缩
  - 压缩模式
  - FFmpeg 参数生成
  - 单文件压缩
  - 实时进度

Phase 5：批量队列
  - 多视频任务队列
  - 总进度
  - 失败处理
  - 取消任务

Phase 6：结果与历史
  - 输出目录
  - 文件名保护
  - 结果报告
  - 设置保存
  - 历史记录

Phase 7：作品集包装
  - README
  - 截图
  - Demo 视频
  - 架构图
  - 简历描述

Phase 8：P1 智能增强
  - 硬件扫描
  - 压缩前 ETA
  - 历史速度校准
  - Accurate Target Size
```

---

# 十六、开发时最重要的判断标准

ShrinkFlow 不是普通“FFmpeg 图形界面壳”，而是一个围绕用户目标组织的视频压缩工作流工具。

所以开发过程中每个功能都要服务于这三个问题：

1. **用户是否更容易开始压缩？**
2. **用户是否更清楚压缩过程发生了什么？**
3. **用户是否更容易判断压缩结果是否满意？**

只要第一版能稳定回答这三个问题，ShrinkFlow 就已经具备作品集价值。

