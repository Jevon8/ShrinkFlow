# ShrinkFlow Project Cleanup Audit

## 1. 基本信息

| 项目 | 值 |
|------|-----|
| 项目路径 | `D:\AI_Project\ShrinkFlow` |
| 审计时间 | 2026-05-14 21:22 |
| 当前目标版本 | v1.2.0 |
| 本轮是否有删除文件 | 否 |
| 本轮是否有移动文件 | 否 |
| 本轮是否有修改文件 | 除本报告外否 |
| 是否有 .git 目录 | 否（有 .gitignore） |

---

## 2. 顶层目录大小排行

| 目录 | 大小 MB | 最后修改时间 | 初步判断 |
|------|---------|-------------|---------|
| `dist_build/` | 1004 | 2026-05-14 21:15 | 可重新生成的构建产物，含旧版安装包 |
| `node_modules/` | 689 | 2026-05-10 10:31 | npm 依赖，可通过 npm install 恢复 |
| `resources/` | 386 | 2026-05-05 21:28 | 必须保留（FFmpeg 捆绑二进制） |
| `release-final/` | 169 | 2026-05-14 21:16 | 必须保留（最终发布物） |
| `dist/` | 12 | 2026-05-13 23:05 | 可重新生成的旧构建产物 |
| `build/` | 1.9 | 2026-05-14 20:51 | 必须保留（应用图标） |
| `out/` | 0.86 | 2026-05-11 21:55 | 可重新生成的 electron-vite 输出 |
| `docs/` | 0.74 | 2026-05-14 02:43 | 必须保留（展示材料） |
| `src/` | 0.69 | 2026-05-04 11:36 | 必须保留（源码） |
| `scripts/` | 0.025 | — | 必须保留（构建脚本） |
| `.claude/` | 0.001 | 2026-05-11 00:15 | 需用户确认 |
| `.tmp/` | 0 | 2026-05-09 22:58 | 空目录，可清理 |

---

## 3. 必须保留

| 路径 | 原因 |
|------|------|
| `src/` | 全部源码（main/preload/renderer/modules） |
| `package.json` | 项目配置，版本号 1.2.0 |
| `package-lock.json` | 依赖锁定文件 |
| `electron-builder.yml` | 打包配置，含图标路径 |
| `electron.vite.config.ts` | 构建配置 |
| `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` | TypeScript 配置 |
| `eslint.config.mjs` | ESLint 配置 |
| `vitest.config.ts` | 测试配置 |
| `tailwind.config.js` | Tailwind CSS 配置 |
| `postcss.config.js` | PostCSS 配置 |
| `.gitignore` | Git 忽略规则 |
| `README.md` | 项目说明 |
| `LICENSE` | MIT 许可证 |
| `CLAUDE.md` | Claude Code 项目指引 |
| `ShrinkFlow.png` | 应用图标源文件 (1.7 MB) |
| `build/icon.png` | 应用图标 PNG（从 ShrinkFlow.png 复制） |
| `build/icon.ico` | 应用图标 ICO（FFmpeg 生成） |
| `resources/ffmpeg/win32/x64/` | 捆绑的 FFmpeg/FFprobe 二进制 (386 MB) |
| `release-final/` | 最终发布物（安装包 + SHA256 + 说明） |
| `docs/showcase/` | 7 个 Markdown 展示文档 |
| `docs/showcase-site/` | 静态展示页（index.html + 截图） |
| `docs/screenshots-checklist.md` | 截图清单 |
| `docs/demo-script.md` | 演示脚本 |
| `docs/product-case-study.md` | 产品案例研究 |
| `docs/resume-and-interview.md` | 简历与面试材料 |
| `scripts/` | 构建脚本（clean.js, download-bundled-ffmpeg.js 等） |
| `vitest.config.ts` | 测试配置 |
| 所有 `*.test.ts` | 测试文件 |

---

## 4. 建议保留

| 路径 | 原因 |
|------|------|
| `shrink_flow_development_plan.md` | 完整开发计划文档 (32 KB)，有历史参考价值 |
| `index.js` | 根目录下 121 KB 编译输出文件（3387 行），疑似旧构建残留，但可能是某个脚本的输出 |

---

## 5. 可归档

| 路径 | 大小 | 原因 | 风险 |
|------|------|------|------|
| `docs/showcase/PORTFOLIO_CN.md` | 8.5 KB | 含 v0.1.0 → v1.2.0 对比，展示材料 | 无，已整合到 showcase-site |
| `docs/showcase/INTERVIEW_SCRIPT_CN.md` | 10.5 KB | 含 v0.1.0 历史引用 | 无，面试脚本 |
| `docs/showcase/DEMO_SCRIPT_CN.md` | 7.0 KB | 演示脚本 | 无 |
| `docs/showcase/ONE_PAGE_SUMMARY_CN.md` | 2.0 KB | 一页摘要 | 无 |
| `docs/showcase/README_SHOWCASE.md` | 8.5 KB | 展示说明 | 无 |
| `docs/showcase/ROADMAP_V0.3_CN.md` | 9.1 KB | v0.3 路线图 | 无 |
| `docs/showcase/SCREENSHOT_GUIDE_CN.md` | 6.8 KB | 截图指南 | 无 |

---

## 6. 可能可以清理，但需要用户确认

| 路径 | 大小 | 原因 | 风险 | 建议 |
|------|------|------|------|------|
| `dist_build/` | 1004 MB | 可重新生成的构建产物。含：旧 0.2.0 安装包 (167 MB)、新 1.2.0 安装包 (169 MB)、win-unpacked (668 MB)、blockmaps、builder-debug.yml | 删除后需 npm run dist 重新生成。release-final/ 已有最终安装包备份 | **最大清理收益**。建议确认 release-final 完整后删除整个目录 |
| `dist_build/shrinkflow-0.2.0-setup.exe` | 167 MB | 旧版本安装包 | 无，release-final 已有 1.2.0 版 | 可直接删除 |
| `dist_build/win-unpacked/` | 668 MB | 可重新生成的解包目录 | 无，npm run dist 可重新生成 | 可直接删除 |
| `dist/` | 12 MB | 旧构建产物（含 0.2.0 安装包和 win-unpacked） | 无，npm run dist 可重新生成 | 可直接删除 |
| `out/` | 861 KB | electron-vite 编译输出 | 无，npm run build 可重新生成 | 可直接删除 |
| `.tmp/` | 0 | 空目录 | 无 | 可直接删除 |
| `index.js` | 121 KB | 根目录下编译输出文件，非源码 | 需确认是否被其他脚本引用 | 建议确认后删除 |
| `.claude/settings.local.json.bak` | 474 B | Claude Code 权限设置备份 | 丢失后需重新配置权限 | 建议保留或归档 |

---

## 7. 明显临时文件 / 缓存

| 路径 | 大小 | 原因 |
|------|------|------|
| `.tmp/` | 0 | 空临时目录 |
| `dist_build/builder-debug.yml` | 8 KB | electron-builder 调试日志 |
| `dist_build/shrinkflow-0.2.0-setup.exe.blockmap` | 178 KB | 旧版本 blockmap |
| `dist_build/shrinkflow-1.2.0-setup.exe.blockmap` | 180 KB | 可重新生成的 blockmap |
| `dist/win-unpacked/resources/app.asar` | 11.4 MB | 旧版 app.asar |
| `.claude/settings.local.json.bak` | 474 B | 设置备份 |

未发现：`*.tmp`、`*.bak`、`*.old`、`*.backup`、`*.part`、`*.download`、`Thumbs.db`、`desktop.ini`、`.DS_Store`（仅找到 `.claude/settings.local.json.bak`）。

未发现缓存目录：`.vite/`、`.cache/`、`coverage/`、`test-results/`、`playwright-report/`、`.nyc_output/`。

---

## 8. 旧版本残留

### 文件名命中

| 路径 | 命中内容 | 是否建议处理 | 原因 |
|------|---------|-------------|------|
| `dist_build/shrinkflow-0.2.0-setup.exe` | 0.2.0 | 是 | 旧安装包，167 MB，release-final 已有 1.2.0 |
| `dist_build/shrinkflow-0.2.0-setup.exe.blockmap` | 0.2.0 | 是 | 旧 blockmap，178 KB |

### 文本内容命中（非 node_modules）

| 路径 | 命中内容 | 是否建议处理 | 原因 |
|------|---------|-------------|------|
| `docs/showcase-site/README.md:50` | "v0.1.0" | 否 | 截图质量说明，提醒重截 |
| `docs/showcase-site/README.md:51` | "v0.1.0" | 否 | 同上 |
| `docs/showcase/PORTFOLIO_CN.md:128` | "v0.1.0" | 否 | 故意保留的版本对比 |
| `docs/showcase/PORTFOLIO_CN.md:130` | "v0.1.0" | 否 | 同上 |
| `docs/showcase/PORTFOLIO_CN.md:132` | "v0.1.0" | 否 | 同上 |
| `docs/showcase/INTERVIEW_SCRIPT_CN.md:62` | "v0.1.0" | 否 | 面试脚本中的版本对比 |
| `package-lock.json`（多处） | "0.1.0", "0.2.0" | 否 | 第三方依赖版本号（fs-extra 10.1.0, eastasianwidth 0.2.0 等），非 ShrinkFlow 版本 |

---

## 9. release-final 完整性检查

| 文件 | 是否存在 | 大小 |
|------|---------|------|
| `ShrinkFlow-v1.2.0-Windows-x64-Setup.exe` | 是 | 177,098,895 bytes (168.9 MB) |
| `ShrinkFlow-v1.2.0-Windows-x64-Setup.exe.sha256.txt` | 是 | 120 bytes |
| `INSTALL.txt` | 是 | 515 bytes |
| `RELEASE_NOTES.txt` | 是 | 1,440 bytes |

SHA256: `25924fd5ba4d59b6754e529380618b5be005d7466ce4ba5f818a0c55df66cfe8`

---

## 10. showcase-site 完整性检查

| 文件 | 是否存在 | 大小 |
|------|---------|------|
| `index.html` | 是 | 65,834 bytes |
| `README.md` | 是 | 2,646 bytes |
| `01-import.png` | 是 | 40,513 bytes |
| `02-smart-plan.png` | 是 | 96,510 bytes |
| `03-plan-active.png` | 是 | 70,496 bytes |
| `04-confirm-filter.png` | 是 | 85,223 bytes |
| `05-progress.png` | 是 | 68,650 bytes |
| `06-history.png` | 是 | 85,403 bytes |
| `07-settings.png` | 是 | 68,639 bytes |
| `08-release-folder.png` | 是 | 18,395 bytes |

8 张截图全部存在，05-progress.png 已确认。

---

## 11. 图标完整性检查

| 项目 | 状态 |
|------|------|
| `ShrinkFlow.png` | 存在，1,755,168 bytes |
| `build/icon.png` | 存在，1,755,168 bytes（与 ShrinkFlow.png 一致） |
| `build/icon.ico` | 存在，205,086 bytes |
| `electron-builder.yml` 引用 `build/icon.ico` | 是：`win.icon`、`nsis.installerIcon`、`nsis.uninstallerIcon` |

---

## 12. node_modules 状态

| 项目 | 值 |
|------|-----|
| 大小 | 689 MB |
| 是否建议本轮删除 | 否 |
| 恢复方式 | `npm install` |

---

## 13. 推荐清理方案草案

| 优先级 | 建议动作 | 路径 | 原因 | 是否需要用户确认 |
|--------|---------|------|------|-----------------|
| P0 | 绝对不动 | `src/`, `package.json`, `electron-builder.yml`, `build/`, `resources/`, `release-final/`, `docs/showcase-site/` | 核心源码、配置、图标、FFmpeg、最终发布物、展示页 | 否 |
| P0 | 绝对不动 | `docs/showcase/` | 展示材料 Markdown | 否 |
| P0 | 绝对不动 | `scripts/`, `*.test.ts`, `vitest.config.ts` | 构建脚本和测试 | 否 |
| P0 | 绝对不动 | `CLAUDE.md`, `README.md`, `LICENSE`, `.gitignore` | 项目文档 | 否 |
| P1 | 建议保留 | `shrink_flow_development_plan.md` | 开发计划文档，有参考价值 | 否 |
| P1 | 建议保留 | `.claude/` | Claude Code 开发记录 | 否 |
| P2 | 可移动到 _cleanup_backup | `dist_build/shrinkflow-0.2.0-setup.exe` | 旧版安装包，167 MB | 是 |
| P2 | 可移动到 _cleanup_backup | `dist_build/shrinkflow-0.2.0-setup.exe.blockmap` | 旧版 blockmap | 是 |
| P2 | 可移动到 _cleanup_backup | `dist/` | 旧构建产物，12 MB | 是 |
| P2 | 可移动到 _cleanup_backup | `out/` | electron-vite 输出，861 KB | 是 |
| P2 | 可移动到 _cleanup_backup | `.tmp/` | 空目录 | 是 |
| P3 | 用户确认后可删除 | `dist_build/win-unpacked/` | 解包目录，668 MB，可重新生成 | 是 |
| P3 | 用户确认后可删除 | `dist_build/shrinkflow-1.2.0-setup.exe` | 1.2.0 安装包副本，release-final 已有 | 是 |
| P3 | 用户确认后可删除 | `dist_build/*.blockmap` | 可重新生成 | 是 |
| P3 | 用户确认后可删除 | `dist_build/builder-debug.yml` | 调试日志 | 是 |
| P3 | 用户确认后可删除 | `index.js`（根目录） | 121 KB 编译输出，非源码 | 是 |
| P4 | 不确定，暂不处理 | `.claude/settings.local.json.bak` | 权限设置备份，474 B | 是 |

---

## 14. 最大可清理空间估算

| 目标 | 可释放空间 | 说明 |
|------|-----------|------|
| `dist_build/` 整体删除 | ~1004 MB | 最大收益。release-final 已有最终安装包 |
| `dist_build/win-unpacked/` 删除 | ~668 MB | 占 dist_build 的 66% |
| `dist_build/shrinkflow-0.2.0-setup.exe` 删除 | ~167 MB | 旧安装包 |
| `dist/` 整体删除 | ~12 MB | 旧构建产物 |
| `out/` 删除 | ~0.86 MB | 可重新生成 |

**总计可释放约 1017 MB**（不含 node_modules 的 689 MB）。

---

## 15. 下一步建议

请把本报告发给 ChatGPT 或 Claude，由 AI 决定最终清理命令。

建议清理顺序：
1. 先删除 `dist_build/`（最大收益，1004 MB）
2. 再删除 `dist/` 和 `out/`（旧构建产物）
3. 删除 `.tmp/`（空目录）
4. 确认 `index.js`（根目录）是否可删除
5. node_modules 保持不动，直到需要清理磁盘空间

清理后如需重新构建：`npm run dist`
