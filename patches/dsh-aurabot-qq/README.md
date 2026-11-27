# dsh-aurabot-qq 补丁（表情包相关）

改的是**插件本体**，不是 Aurabot 的模块，所以单独放这里。

- 目标包：`dsh-aurabot-qq` **1.2.1**（MIT，作者 aureth-labs，仓库
  https://github.com/aureth-labs/dsh-aurabot-qq ）
- 安装位置：`<DSH profile>/node_modules/dsh-aurabot-qq/`
- 为什么改：QQ 里发表情包时会「老是同几张」，而且一个情绪只有 1~2 张能用。

## 改了哪三个文件

| 文件 | 改了什么 |
| --- | --- |
| `src/features/stickers.js` | 表情匹配重做：同一情绪的多种说法归成一组（`FEELING_ALIASES`）；命中词去重后再匹配；同组凑不满时用相近情绪补齐，避免「怎么挑都是那两张」 |
| `src/core/config.js` | 新增两个配置：`stickers.repeatWindowHours`（默认 2 小时）、`stickers.maxSameInWindow`（默认 3 次）——同一张图在窗口里发够次数就不发了 |
| `src/chat/hub.js` | `sendSticker()` 接住「换成同感觉的另一张」：窗口内重复时静默换一张，不提示也不解释 |

## 怎么用

1. 确认装的还是 1.2.1（版本不对就先别覆盖，可能已经合进上游或接口变了）。
2. 备份原文件，再把 `files/src/...` 里的文件覆盖过去。
3. 重启 DSH（插件是 node_modules 里的代码，热重载不一定吃到）。

**升级插件会把它冲掉**，到时候要么按新版重新合一遍，要么看看上游有没有把这三处收进去。

原文件备份在原来的 `.bak-20261127-2145`（只在本人机器上，不进仓库）。
