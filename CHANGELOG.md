# Changelog

本文件记录仓库的改动。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added

- **`modules/qq-reply-guard`（新）**：回复兜底清洗。模型偶尔把英文自我核对的念头打进正文、
  还把整段回答重抄一遍（2026-11-27 23:49 真机：`<sticker:收到> — hmm that tag may not match.
  Use 卖萌.` 后面又接了一遍原文），插件核心只认中文思考标签，这种漏网。现在在 `reply` 钩子上
  补两刀：夹在中文里的英文自检片段（3 词以上 + 含 hmm/tag/use… 元信息词、左右都是中文）削掉；
  同一条回复里重复的段落只留一份（重复块尾部的表情标签一起丢）。
  带 10 条回归用例（`modules/qq-reply-guard/test.mjs`），正常回复一个字不动。

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
