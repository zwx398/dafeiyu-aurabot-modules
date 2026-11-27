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

## 安装

把 `modules/<模块名>` 整个目录拷到 Aurabot 的 `data/modules/` 下，重启（或在面板里启用）即可。
模块依赖宿主注入的 `api`，接口见 Aurabot 自带的 `data/modules/API.md`。

## 这个仓库里没有什么

只放代码。模型权重、语音包、配置、登录态、cookie、聊天记录、表情包、备份文件一律不在仓库里。

## 许可

- 除 `modules/douyin` 外，本仓库的代码使用 MIT，见 `LICENSE`。
- `modules/douyin` 在社区模块（Aurabot community 2.3.8，MIT，Copyright (c) 2026 Aurabot contributors）
  基础上修改，原 `LICENSE` 原样保留在模块目录里，详见 `NOTICE-douyin.md`。
