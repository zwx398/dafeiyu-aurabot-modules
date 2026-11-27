# Changelog

本文件记录仓库的改动。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

## [0.2.0] - 2026-11-28

### Added

- **路径自动探测**：新增 `modules/voice/paths.mjs`，按「配置 > 环境变量 > 自动探测」解析
  引擎、模型、音色、ffmpeg、心情、基准音、聊天流水；`voice/clone.mjs` 改用这套。
  换机器不再需要改代码。
- **一键安装**：`install.ps1` + `install.cmd`。自动找 Aurabot 的 `data/modules`、
  拷贝 9 个模块（已存在跳过，`-Force` 覆盖）、体检 7 项依赖，支持 `-DryRun`。
- **文档**：README 重排成常见开源项目结构（特性 / 快速开始 / 环境要求 / 模块表 / 配置 / FAQ / 已知限制 / 贡献 / 致谢）；
  新增 `CONTRIBUTING.md`、`README_EN.md`、本 `CHANGELOG.md`。

### Changed

- `modules/douyin-memory-bridge`：输出目录改为 `DAFEIYU_STUDIO_MEMORY` 或
  「DSH 数据目录 / douyin-studio / memory」，不再写死。

## [0.1.0] - 2026-11-27

### Added

- 首次公开：9 个 Aurabot 模块（voice、voice-bridge、qq-memewiki、qq-group-privacy、qq-group-self、
  douyin、douyin-at、douyin-memory-bridge、dsh-memory-bridge）。
- `patches/dsh-aurabot-qq`：插件本体的表情包改动（情绪别名表、重复窗口、重复时静默换一张）。
- `NOTICE-douyin.md`：说明 `modules/douyin` 来自社区模块 2.3.8。
