# 大肥鱼 · Aurabot 模块

「大肥鱼」是跑在 Aurabot 上的 QQ / 抖音 AI 伙伴（蓝发鲸鱼耳女仆那条鱼）。
这个仓库放的是**我自己写的 Aurabot 模块**，以及一份改过的抖音模块，用来做备份和开源。

## 模块清单

| 模块 | 作用 |
| --- | --- |
| `modules/voice` | 语音克隆（Breeze TTS 2）：给 QQ 语音条换上指定的嗓子，带音色自检、语气档位、语速校正 |
| `modules/voice-bridge` | 配音桥：把 QQ 用的那把嗓子借给抖音视频工厂（`dsh-douyin-studio`）配音 |
| `modules/qq-memewiki` | 梗百科预查：消息进来先查本地词库，命中就接梗，不懂的梗不硬编 |
| `modules/qq-group-privacy` | 群聊隐私防护：敏感词拦截、发送白名单、群聊语音段放行 |
| `modules/qq-group-self` | 群聊里的自我认知：让她知道「她」指的是自己、知道自己在别处做过什么 |
| `modules/douyin` | 抖音（基于社区模块 2.3.8 修改）：读 @、楼中楼回复、表情收藏、图片评论、评论区读图 |
| `modules/douyin-at` | 抖音动作的小桥：把「评论某条视频并真 @ 主人」做成 HTTP 接口 |
| `modules/douyin-memory-bridge` | 把她的记忆实时同步给抖音视频工厂当素材 |
| `modules/dsh-memory-bridge` | 把 DSH 客户端的对话写进和 QQ / 抖音同一份记忆 |

## patches/ 目录

除了模块，还放了对**第三方包本体**的小改动（直接改的 `node_modules`，没法按模块格式分发）：

| 目录 | 目标 | 干什么 |
| --- | --- | --- |
| `patches/dsh-aurabot-qq` | DSH 插件 `dsh-aurabot-qq` 1.2.1 | QQ 发表情包：情绪别名表、重复窗口、同一张重复时静默换一张 |

## 关于 qq-memewiki 的词库

梗百科模块只**读** DSH 梗百科插件（`dsh-memewiki`）的词库文件 `memes.db`（只读，不写不改），
词条内容是那边的；匹配、预查、注入这些逻辑是我自己重写的，仓库里没有 `dsh-memewiki` 的代码。

## 怎么用（先看这段）

**前提：先装好 Aurabot**（DSH 插件 `dsh-aurabot-qq`），并且它能正常收发 QQ 消息。
这些模块不是独立程序，只是插件里的功能件——宿主不在，拷进去也不会动。

### 通用步骤

1. 把 `modules/<模块名>` 整个目录拷到 Aurabot 的 `data/modules/` 下。
2. 重启 Aurabot（或在面板「已安装」页里重载模块）。
3. 看日志有没有这个模块的启动行。报错多半是缺依赖，对照下表。
4. 模块的设置存在 `plugins-data/aurabot/config.json` 的 `modules.<模块 id>` 下面，面板上能改。

### 每个模块还要准备什么

| 模块 | 额外依赖 |
| --- | --- |
| `voice` | Breeze TTS 2 引擎（`breeze-cli.exe`）+ q8 权重 + `.breeze` 音色文件 + ffmpeg；缺一个就会退回系统 TTS |
| `voice-bridge` | `voice` 模块在跑，并且 `dsh-douyin-studio`（视频工厂）在跑 |
| `qq-memewiki` | DSH 梗百科插件 `dsh-memewiki`（只读它的 `memes.db`） |
| `qq-group-privacy` | 无；想用自己的表情图就放 `public-stickers.json` 同款的 sha256 索引 |
| `qq-group-self` | `memory` 模块在跑 |
| `douyin` | 抖音网页端登录态（Edge + CDP）；**更推荐装社区原版**，这份当改动参考 |
| `douyin-at` | `douyin` 模块在跑 |
| `douyin-memory-bridge` | `memory` 模块在跑 + 视频工厂的 memory 目录存在 |
| `dsh-memory-bridge` | `memory` 模块在跑 + 一个能解 zstd 的 `node.exe`；第一次建议先开干跑看日志 |

### 要改成自己机器的地方（路径是写死的）

- `modules/voice/clone.mjs` 里的 `DEFAULTS`：`breeze-cli.exe`、q8 模型、`voices` 目录、`ffmpeg`、
  `mood.json`、`baseline.wav`、`chatlog` 目录——一共 7 处，全部要换成自己机器上的路径。
- `modules/douyin-memory-bridge/index.mjs` 的 `OUT_DIR`：视频工厂的 memory 目录。
- `dsh-memory-bridge` 的 `defaults.nodePath`：解压会话文件用的 `node.exe`（可以在面板设置里改）。

原文按 Windows 写的（`C:\...`、`E:\...`），换系统要自己改分隔符。

### 建议的上手顺序

先 `dsh-memory-bridge`（能开干跑，只看日志不写记忆）→ `qq-memewiki`（只读词库，最安全）→
`voice`（要引擎，最麻烦）→ 抖音那几个（要登录态）。

## 这个仓库里没有什么

只放代码。模型权重、语音包、配置、登录态、cookie、聊天记录、表情包、备份文件一律不在仓库里。

## 许可

- 除 `modules/douyin` 外，本仓库的代码使用 MIT，见 `LICENSE`。
- `modules/douyin` 在社区模块（Aurabot community 2.3.8，MIT，Copyright (c) 2026 Aurabot contributors）
  基础上修改，原 `LICENSE` 原样保留在模块目录里，详见 `NOTICE-douyin.md`。
