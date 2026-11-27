# 大肥鱼 · Aurabot 模块

> 给 [Aurabot](https://github.com/aureth-labs/dsh-aurabot-qq) 的 AI 伙伴「大肥鱼」写的模块集合：
> 语音克隆、梗百科接梗、群聊隐私、抖音评论区增强、跨平台记忆桥。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Aurabot Module](https://img.shields.io/badge/Aurabot-module-6f42c1.svg)](https://github.com/aureth-labs/dsh-aurabot-qq)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#环境要求)
[![Modules](https://img.shields.io/badge/modules-10-brightgreen.svg)](#模块清单)
[![Stars](https://img.shields.io/github/stars/zwx398/dafeiyu-aurabot-modules?style=social)](https://github.com/zwx398/dafeiyu-aurabot-modules)

## 这是什么

「大肥鱼」是跑在 Aurabot 上的 QQ / 抖音 AI 伙伴。这个仓库放的是**我给自己那条鱼写的模块**，
以及一份改过的抖音模块，公开出来做备份、也给同样在折腾 Aurabot 的人抄作业。

每个 `modules/<名字>/` 都是一个可以直接用的 Aurabot 模块（ESM，`api: 1`）。

## 特性

- **语音克隆**：接 Breeze TTS 2，用自己的音色念 QQ 语音；带音色自检、五档语气、语速校正、多条挑最好的一条
- **梗百科预查**：消息进来先查本地梗库，命中就接梗；查不到不硬编、不装懂
- **群聊隐私**：敏感词拦截、发送白名单、群聊里语音段放行
- **群聊自我认知**：让她分得清「她指的是自己」，知道自己去别的平台干过什么
- **抖音增强**：读评论区 @、楼中楼回复、评论表情收藏、图片评论、按链接读整段评论区、把表情图取给模型看
- **跨平台记忆**：DSH 客户端、QQ、抖音共用同一条鱼的记忆，另有素材导出给视频工厂
- **开箱即用**：`install.ps1` 自动找目录、拷模块、体检依赖；路径自动探测，换机器不用改代码

## 快速开始

### 方式一：一条命令（推荐）

把下面这句丢给任意 agent（DeepSeek Harness / Claude Code / Cursor 都行）：

> 帮我把这个仓库的模块装进本机的 Aurabot：先跑 `install.ps1 -DryRun` 看会做什么，再正式跑一遍，
> 然后按它列出的「缺」把依赖补齐，最后重启 Aurabot 并确认日志里有各模块的启动行。

自己动手也行：

```powershell
git clone https://github.com/zwx398/dafeiyu-aurabot-modules.git
cd dafeiyu-aurabot-modules
powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun   # 只看会做什么
powershell -ExecutionPolicy Bypass -File install.ps1            # 真装
```

没有 git 就直接下载 ZIP 解压，双击 `install.cmd`。

### 方式二：手动

1. 把 `modules/<模块名>` 整个目录拷到 Aurabot 的 `data/modules/` 下
2. 重启 Aurabot（或在面板「已安装」页重载）
3. 看日志有没有该模块的启动行；缺依赖会打印提示，不会崩
4. 模块设置存在 `plugins-data/aurabot/config.json` 的 `modules.<模块 id>` 下

## 环境要求

| 需要 | 说明 |
| --- | --- |
| Windows | 安装脚本是 PowerShell，路径按 `\` 写的；其它系统要自己改 |
| Aurabot | DSH 插件 [`dsh-aurabot-qq`](https://github.com/aureth-labs/dsh-aurabot-qq)，并且 QQ 能正常收发 |
| Node.js | Aurabot 自带运行时即可；`dsh-memory-bridge` 解 zstd 需要一个独立 `node.exe` |
| Breeze TTS 2 | 只有 `voice` / `voice-bridge` 要：`breeze-cli.exe` + q8 权重（约 3.4G）+ 一个 `.breeze` 音色 |
| ffmpeg | 语音后处理、音色自检要 |
| dsh-memewiki | 只有 `qq-memewiki` 要：读它的 `memes.db` 词库（只读） |
| dsh-douyin-studio | 只有 `voice-bridge` / `douyin-memory-bridge` 要 |
| 抖音登录态 | 只有 `douyin` / `douyin-at` 要（本机浏览器登录过抖音网页版） |

缺依赖时对应模块会自己跳过，不影响别的模块。跑一次 `install.ps1` 就能看到缺哪几项。

## 模块清单

| 模块 | 作用 | 额外依赖 |
| --- | --- | --- |
| [`voice`](modules/voice) | 语音克隆：给 QQ 语音条换上指定嗓子，带音色自检、语气档位、语速校正 | Breeze TTS 2 + 权重 + 音色 + ffmpeg |
| [`voice-bridge`](modules/voice-bridge) | 配音桥：把 QQ 那把嗓子借给抖音视频工厂配音 | `voice` + `dsh-douyin-studio` |
| [`qq-memewiki`](modules/qq-memewiki) | 梗百科预查：命中就接梗，不硬编出处 | `dsh-memewiki` 的词库 |
| [`qq-group-privacy`](modules/qq-group-privacy) | 群聊隐私防护：敏感词、发送白名单、语音段放行 | 无 |
| [`qq-group-self`](modules/qq-group-self) | 群聊里的自我认知：分清「她」是谁、知道自己在别处做过什么 | `memory` |
| [`qq-reply-guard`](modules/qq-reply-guard) | 回复兜底清洗：模型把英文自检念头打进正文、或把整段回答重抄一遍，发出去前削掉 | 无 |
| [`douyin`](modules/douyin) | 抖音增强：读 @、楼中楼、表情收藏、图片评论、评论区读图（基于社区 2.3.8） | 抖音登录态 |
| [`douyin-at`](modules/douyin-at) | 抖音动作小桥：评论某条视频并真 @ 主人，做成 HTTP 接口 | `douyin` |
| [`douyin-memory-bridge`](modules/douyin-memory-bridge) | 把记忆实时同步给抖音视频工厂当素材 | `memory` + 视频工厂 |
| [`dsh-memory-bridge`](modules/dsh-memory-bridge) | 把 DSH 客户端的对话写进同一条鱼的记忆 | `memory` + `node.exe` |

## 目录结构

```
.
├── modules/
│   ├── voice/                 # 语音克隆（index / clone / backend / paths）
│   ├── voice-bridge/
│   ├── qq-memewiki/
│   ├── qq-group-privacy/
│   ├── qq-group-self/
│   ├── douyin/                # 社区 2.3.8 的 fork（index + lib/*）
│   ├── douyin-at/
│   ├── douyin-memory-bridge/
│   └── dsh-memory-bridge/
├── patches/
│   └── dsh-aurabot-qq/        # 插件本体的小改动（表情包三件套 + 说明）
├── install.ps1                # 一键安装 + 依赖体检
├── install.cmd                # 双击版
├── README.md / README_EN.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── NOTICE-douyin.md
└── LICENSE
```

## 配置

### 路径怎么找

模块按「配置 → 环境变量 → 自动探测」的顺序找自己要用的东西（见 [`modules/voice/paths.mjs`](modules/voice/paths.mjs)），
所以换机器**不用改代码**。

### 环境变量

| 变量 | 作用 |
| --- | --- |
| `DAFEIYU_DATA_DIR` | Aurabot 的 `data` 目录（里面有 `modules/`） |
| `DAFEIYU_BREEZE_HOME` | Breeze TTS 根目录（里面有 `bin/<版本>/breeze-cli.exe`） |
| `DAFEIYU_BREEZE_CLI` / `_MODEL` | 直接指定引擎 / 模型文件 |
| `DAFEIYU_VOICES_DIR` | 音色目录 |
| `DAFEIYU_FFMPEG` | ffmpeg 路径 |
| `DAFEIYU_MOOD` / `_BASELINE` / `_CHATLOG` | 心情文件 / 基准音 / 聊天流水 |
| `DAFEIYU_STUDIO_MEMORY` | 抖音视频工厂的 memory 目录 |
| `DSH_HOME` | DSH 数据目录（默认 `~/.dsh`） |

也可以直接写进 `plugins-data/aurabot/modules-data/voice/backend.json`（优先级最高）：
`cli`、`model`、`voicesDir`、`ffmpeg`、`moodPath`、`baselinePath`、`chatlogPath`。

## 常见问题

**装完一点反应都没有？**
先看 Aurabot 日志有没有该模块的启动行。没有就是没加载（目录放错 / 重启没生效），
有但报错就是缺依赖——跑 `install.ps1` 看缺哪项。

**语音没声音，或者退回机器音？**
`voice` 缺引擎 / 权重 / 音色时会自动退回系统 TTS。三样都要齐：`breeze-cli.exe`、q8 权重、`.breeze` 音色。

**梗百科还是不懂梗？**
它只读 `dsh-memewiki` 的词库。没装那个插件就没有词条可查；词库里没有的新梗也不会硬编。

**抖音那几个模块不动？**
`douyin` 需要本机浏览器登录过抖音网页版；`voice-bridge` / `douyin-memory-bridge` 需要视频工厂在跑。

**会把我账号搞坏吗？**
抖音那份建议直接装社区原版，把这里的改动当参考搬。评论被折叠、被限流是账号风控问题，跟模块无关。

## 已知限制

- 只在 Windows 上跑过（PowerShell 脚本、路径写法都按 Windows）
- `modules/douyin` 是社区 2.3.8 的 **fork**，可能落后上游；上游大改后要手动重放改动
- 仓库里**不含**音色文件、梗词库、模型权重、登录态、配置、记忆库——这些得自己准备
- 抖音评论区功能依赖网页版接口，平台一改就得跟着修

## 贡献

欢迎 issue / PR。改模块时请保持 `api: 1` 兼容，别把个人路径写死（走 `paths.mjs` 那套），
提交说明写清「改了什么 + 为什么」。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

- [Aurabot / dsh-aurabot-qq](https://github.com/aureth-labs/dsh-aurabot-qq) —— 宿主插件，模块系统与 API
- [dsh-memewiki](https://github.com/) —— 梗百科词库（本仓库只读它的词库，不含其代码）
- Aurabot contributors —— 社区抖音模块 2.3.8，本仓库的 `modules/douyin` 基于它修改
- [HoppouAI/Breeze-TTS-2.cpp](https://github.com/HoppouAI/Breeze-TTS-2.cpp) —— 语音克隆引擎

## 许可

- 除 `modules/douyin` 外，本仓库代码使用 **MIT**，见 [LICENSE](LICENSE)
- `modules/douyin` 基于 Aurabot 社区抖音模块 2.3.8（MIT，Copyright (c) 2026 Aurabot contributors），
  原 `LICENSE` 保留在模块目录内，详见 [NOTICE-douyin.md](NOTICE-douyin.md)
