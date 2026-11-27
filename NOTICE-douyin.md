# 关于 modules/douyin 的来源

`modules/douyin` **不是我从零写的**，它是在 Aurabot 的社区模块「抖音」（community 2.3.8）基础上修改的。

- 原模块：Aurabot 社区模块 `douyin` 2.3.8，安装时间 2026-11-23，SHA256 记在目录里的 `.aurabot-source.json`。
- 原许可：**MIT**，Copyright (c) 2026 Aurabot contributors。
  原 `LICENSE` 文件保留在 `modules/douyin/LICENSE`，没有改动。MIT 允许复制、修改和再分发，
  所以把它（含我的改动）放进这个公开仓库是符合原许可的。
- 本仓库为什么放整份：我对它改动较多，需要一份「改完之后完整能跑」的备份；
  只留 diff 的话，原模块一升级就丢了上下文。
- 我改了什么（大致）：读评论区 @ 提醒、楼中楼回复（回一级评论时 `reply_to_reply_id` 必须传 0）、
  评论表情收藏、图片评论、按链接读整段评论区、评论区表情取图给模型看等。
  想看得更细，可以拿社区 2.3.8 原版对照 `lib/site.mjs`、`lib/duty.mjs`。

## 用这个仓库的人注意

想用抖音模块，请优先装 Aurabot 的**社区原版**，再把这里的改动当参考搬过去。
直接拷这份等于用了一个可能落后于上游的分支。

## 原作者

如果原模块作者不希望这份改动后的副本公开，开个 issue 说一声，我会把 `modules/douyin`
从公开仓库移除，只留我自己写的那些模块。
