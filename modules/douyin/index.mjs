const __lib = globalThis.aurabot.lib // 插件内部源码（复制出来后靠它找到插件里的文件）
// 社区模块（原内置）：刷抖音。专用浏览器里登录一次；定时自己刷推荐、点赞、评论（特别想让主人看的会在评论里真·@主人），看到好玩的分享给主人（抖音私信 / QQ）；
// 别人发来抖音链接，她也能点开看完再聊。浏览 / 点赞 / 评论 / 分享各有权限（面板「权限」页），默认仅主人。

import { createDouyin } from './lib/duty.mjs'
import { existsSync } from 'node:fs'
import { SHARE_TEXT_DEFAULTS, SHARE_TEXT_SETTINGS } from './lib/share-settings.mjs'
import { COMMENT_REPLY_DEFAULTS, COMMENT_REPLY_SETTINGS } from './lib/reply-settings.mjs'
import { MENTION_DEFAULTS, MENTION_SETTINGS } from './lib/mention-settings.mjs'
const { defineTool, str } = __lib('tools/tools.js')
const { profileToolVisible, profilePermits } = __lib('chat/access.js')

// 只读结果的排版（QQ 工具和抖音后台回合共用）
const formatCommentList = (r) => {
  const lines = (r.comments || []).map((c, i) => {
    const when = c.at ? new Date(c.at).toLocaleString('zh-CN', { hour12: false }) : ''
    const head = `${i + 1}. ${c.nickname}${c.mine ? '（我）' : ''}：${c.text}（${c.likes} 赞${c.replyCount ? `，${c.replyCount} 条回复` : ''}）${when ? ' ' + when : ''}`
    const thread = (c.thread || []).map((x) => `　↳ ${x.nickname}：${x.text}`).join('\n')
    return thread ? `${head}\n${thread}` : head
  })
  return `《${r.title || '无标题'}》 作者：${r.author || '?'}\n` + (lines.length ? lines.join('\n') : '这条视频评论区是空的，或者没读到')
}
const formatMentions = (r) => {
  const lines = (r.mentions || []).map((m) => {
    const when = m.at ? new Date(m.at).toLocaleString('zh-CN', { hour12: false }) : ''
    const where = m.awemeDesc || m.title || '没标题'
    const url = m.awemeId ? `https://www.douyin.com/video/${m.awemeId}` : ''
    return `《${where}》 ${m.text || m.content || ''} ${when}${url ? ' ' + url : ''}`.trim()
  })
  return lines.length ? lines.join('\n') : '最近没有被 @ 的记录'
}
const formatInbox = (r) => {
  const lines = (r.messages || []).map((m) => `${m.from === 'owner' ? '主人' : '我'}：${m.card ? `[分享视频《${m.card.title || '没标题'}》]` : (m.text || '[表情/图片]')}`)
  return lines.length ? lines.join('\n') : '私信里没有消息'
}

export default {
  id: 'douyin',
  name: '刷抖音',
  version: '2.3.8',
  api: 1,
  description: '用专用浏览器刷抖音：看推荐、点赞评论，把好玩的视频分享给主人，也能看别人发来的抖音链接。',
  tab: 'douyin',
  defaults: { ...SHARE_TEXT_DEFAULTS, ...COMMENT_REPLY_DEFAULTS, ...MENTION_DEFAULTS },
  settings: [...SHARE_TEXT_SETTINGS, ...COMMENT_REPLY_SETTINGS, ...MENTION_SETTINGS],
  setup(api) {
    const { hub, http } = api.core
    // 主人的抖音号只由「核对」写入（面板存配置时不能直接改 secUid）
    const setOwner = (owner) => api.setConfig((cur) => ({ ...cur, douyin: { ...cur.douyin, owner } }))
    // 出站治理面：旧主仓没有 api.proactive 时为 undefined，duty 内部可选链降级回 hub.sendText。
    // 表情库和 QQ 那边是同一套（plugins-data/aurabot/stickers）：按名字/情绪词挑一张，返回磁盘路径。
    const { loadLibrary, stickerPath, matchSticker } = __lib('features/stickers.js')
    const stickerFile = (query) => {
      try {
        const item = matchSticker(loadLibrary().items, String(query || ''))
        if (!item) return ''
        const path = stickerPath(item)
        return existsSync(path) ? path : ''
      } catch (error) {
        api.log.warn('找表情失败：', error.message)
        return ''
      }
    }
    const dy = createDouyin({ getConfig: api.config, getSettings: api.settings, setOwner, hub, memory: api.lazy('memory'), log: api.log, proactive: api.proactive, sticker: stickerFile, dsh: api.dsh })
    api.every(60_000, () => dy.tick(), '刷抖音')
    api.onDispose(() => dy.dispose())

    api.tool(({ chat, sessionId }) => {
      const cfg = api.config()
      if (!cfg.douyin.enabled) return []
      // 后台回合（刷抖音 / 抖音私信 / 被艾特）：只给只读工具，能查评论、通知、私信；写操作一律不给
      // 抖音私信那一轮（system:douyin-dm）是核对过的主人在说话：给全套工具，跟 QQ 那边一样
      const isDmTurn = chat.kind === 'system' && /^system:douyin-dm/.test(String(chat.chatId || ''))
      // 其他后台回合（刷抖音 / 被艾特）只给只读工具，别让它一边刷一边自己评论
      if (chat.kind === 'system' && !isDmTurn) {
        return [
          defineTool({
            name: 'douyin_comments',
            description: '读一个抖音视频的评论区（只读，可选连楼中楼）。有人问评论区在说什么、有没有人提到你时用；要视频链接。',
            properties: {
              link: str('抖音视频链接（v.douyin.com 短链也行）'),
              count: str('读多少条，默认 20，最多 50'),
              replies: str('要连楼中楼就填 true'),
            },
            required: ['link'],
            execute: async ({ link, count, replies }) => {
              const r = await dy.readComments(String(link || ''), { count: Number(count) || 20, withReplies: String(replies || '').toLowerCase() === 'true' })
              if (!r.ok) return r
              return { ok: true, message: formatCommentList(r) }
            },
          }),
          defineTool({
            name: 'douyin_mentions',
            description: '读抖音通知里主人 @ 过你的记录（只读）。',
            properties: {},
            execute: async () => {
              const r = await dy.listMentions({ hours: 72 })
              if (!r.ok) return r
              return { ok: true, message: formatMentions(r) }
            },
          }),
          defineTool({
            name: 'douyin_inbox',
            description: '读你和主人在抖音私信里最近几条消息（只读）。',
            properties: {},
            execute: async () => {
              const r = await dy.readInbox({ limit: 10 })
              if (!r.ok) return r
              return { ok: true, message: formatInbox(r) }
            },
          }),
        ]
      }
      // 抖音私信那一轮按主人权限放行；其他情况照旧看权限面板
      const visible = (key) => (isDmTurn ? true : profileToolVisible(cfg, key, chat))
      // 执行时再查一遍权限（面板可能刚改过）
      const guarded = (key, run) => async (args) => {
        const c = api.config()
        if (!c.douyin.enabled) return { ok: false, message: '抖音没打开' }
        if (isDmTurn) return run(args) // 私信是核对过的本人，按主人权限放行
        const p = profilePermits(c, key, chat, hub.turnSendersAllOwner(sessionId))
        if (!p.ok) return p
        return run(args)
      }
      const tools = []
      if (visible('douyinBrowse')) {
        tools.push(defineTool({
          name: 'douyin_watch',
          description: '打开一个抖音视频看看：读标题、分类、内容摘要和热评，看完再聊。别人发来抖音链接（v.douyin.com 短链也行）时用。',
          properties: { link: str('抖音视频链接或 v.douyin.com 短链') },
          required: ['link'],
          execute: guarded('douyinBrowse', ({ link }) => dy.watch(String(link || ''))),
        }))
        tools.push(defineTool({
          name: 'douyin_comments',
          description: '读一个抖音视频的评论区（只读，热评优先，可选连每条下面的楼中楼）。有人问「这个视频评论区在说什么」「最新评论有没有提到我」「我作品下面有人说了啥」时用；要视频链接，会打开浏览器，十几秒。',
          properties: {
            link: str('抖音视频链接（v.douyin.com 短链也行）'),
            count: str('读多少条，默认 20，最多 50'),
            replies: str('要不要连每条下面的楼中楼一起读：填 true 就要'),
          },
          required: ['link'],
          execute: guarded('douyinBrowse', async ({ link, count, replies }) => {
            const r = await dy.readComments(String(link || ''), { count: Number(count) || 20, withReplies: String(replies || '').toLowerCase() === 'true' })
            if (!r.ok) return r
            const lines = (r.comments || []).map((c, i) => {
              const when = c.at ? new Date(c.at).toLocaleString('zh-CN', { hour12: false }) : ''
              const head = `${i + 1}. ${c.nickname}${c.mine ? '（我）' : ''}：${c.text}（${c.likes} 赞${c.replyCount ? `，${c.replyCount} 条回复` : ''}）${when ? ' ' + when : ''}`
              const thread = (c.thread || []).map((x) => `　↳ ${x.nickname}：${x.text}`).join('\n')
              return thread ? `${head}\n${thread}` : head
            })
            return { ok: true, message: `《${r.title || '无标题'}》 作者：${r.author || '?'}\n` + (lines.length ? lines.join('\n') : '这条视频评论区是空的，或者没读到') }
          }),
        }))
        tools.push(defineTool({
          name: 'douyin_mentions',
          description: '读抖音「通知 → 互动消息」里主人 @ 过你的记录（只读，不改账号）。有人问「我刚才在评论区艾特你看到没」「最近谁 @ 我了」时用；会打开浏览器，要十几秒。',
          properties: {},
          execute: guarded('douyinBrowse', async () => {
            const r = await dy.listMentions({ hours: 72 })
            if (!r.ok) return r
            const lines = (r.mentions || []).map((m) => {
              const when = m.at ? new Date(m.at).toLocaleString('zh-CN', { hour12: false }) : ''
              const where = m.awemeDesc || m.title || '没标题'
              const url = m.awemeId ? `https://www.douyin.com/video/${m.awemeId}` : ''
              const body = m.text || m.content || ''
              return `《${where}》 ${body} ${when}${url ? ' ' + url : ''}`.trim()
            })
            return { ok: true, message: lines.length ? lines.join('\n') : '最近 72 小时没有被 @ 的记录' }
          }),
        }))
        tools.push(defineTool({
          name: 'douyin_inbox',
          description: '读你和主人在抖音私信里最近几条消息（只读，不回）。有人问「我抖音私信你收到了吗」时用；会打开浏览器，要十几秒。',
          properties: {},
          execute: guarded('douyinBrowse', async () => {
            const r = await dy.readInbox({ limit: 10 })
            if (!r.ok) return r
            const lines = (r.messages || []).map((m) => `${m.from === 'owner' ? '主人' : '我'}：${m.card ? `[分享视频《${m.card.title || '没标题'}》]` : (m.text || '[表情/图片]')}`)
            return { ok: true, message: lines.length ? lines.join('\n') : '私信里没有消息' }
          }),
        }))
        tools.push(defineTool({
          name: 'douyin_recent',
          description: '查最近刷过的抖音视频及真实链接。有人问刚才刷了什么、要分享或评论刚看过的视频时先用；没有记录就如实说。',
          properties: {},
          execute: guarded('douyinBrowse', async () => {
            const videos = dy.recentVideos()
            return { ok: true, message: videos.length ? videos.map((v) => `《${v.title || '无标题'}》${v.url}`).join('\n') : '最近没有能找到链接的视频记录', videos }
          }),
        }))
        tools.push(defineTool({
          name: 'douyin_browse',
          description: '现在去刷一会儿抖音推荐，有人让你去刷抖音、找个视频给他时用。只是开始刷：要几分钟，刷完系统会把结果（看了什么、分享了哪个）告诉你，在那之前别说已经分享了 / 已经发了。主人开口要的话，这轮一定会挑一个分享给主人。',
          properties: {},
          execute: guarded('douyinBrowse', async () => dy.browse({ ownerAsked: hub.turnHasOwner(sessionId), report: chat })),
        }))
      }
      if (visible('douyinShareOwner')) tools.push(defineTool({
        name: 'douyin_share_owner',
        description: '主人明确要求分享某个抖音视频给自己时用；link 填真实链接或视频 id。发到面板设置的抖音私信、QQ 或两边。',
        properties: { link: str('抖音视频链接或视频 id') },
        required: ['link'],
        execute: guarded('douyinShareOwner', ({ link }) => dy.shareVideo(String(link || ''))),
      }))
      if (visible('douyinDm')) tools.push(defineTool({
        name: 'douyin_send_dm',
        description: '主人明确要求你给某个抖音用户发私信时用。target 填对方的主页链接或抖音号，text 是要说的话（300 字以内）。只发给主人指定的人。',
        properties: { target: str('对方抖音主页链接或抖音号'), text: str('要说的话') },
        required: ['target', 'text'],
        execute: guarded('douyinDm', ({ target, text }) => dy.directDm({ target, text })),
      }))
      if (visible('douyinLike')) tools.push(defineTool({
        name: 'douyin_like',
        description: '给一个抖音视频点赞。有人明确让你点赞时用。link 填视频链接。',
        properties: { link: str('抖音视频链接') },
        required: ['link'],
        execute: guarded('douyinLike', ({ link }) => dy.likeVideo(String(link || ''))),
      }))
      if (visible('douyinComment')) tools.push(defineTool({
        name: 'douyin_comment',
        description: '在一个抖音视频下发评论。有人明确让你去评论时用。link 填视频链接，text 是评论内容（100 字以内）。',
        properties: { link: str('抖音视频链接'), text: str('评论内容') },
        required: ['link', 'text'],
        execute: guarded('douyinComment', ({ link, text }) => dy.commentVideo(String(link || ''), String(text || ''))),
      }))
      return tools
    })

    // 面板：/douyin/state 只读文件，绝不为了显示状态去开浏览器
    api.route('/douyin/state', async () => ({ ok: true, ...dy.state() }))
    api.route('/douyin/account', async () => dy.account(true))
    api.route('/douyin/login', async () => dy.loginStep(true))
    api.route('/douyin/login/status', async () => dy.loginStep(false))
    api.route('/douyin/window', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      return dy.showWindow(Boolean(b?.visible))
    })
    api.route('/douyin/run', async () => dy.browse())
    api.route('/douyin/dms', async () => dy.checkOwnerDms())
    api.route('/douyin/comment-replies', async () => dy.checkCommentReplies('主人要求'))
    api.route('/douyin/mentions', async () => dy.checkMentions('主人要求'))
    api.route('/douyin/inbox', async () => dy.readInbox({ limit: 10 }))
    // 她自己抖音收藏里的表情（只读，给面板/排查用）
    api.route('/douyin/stickers', async () => dy.myStickers())
    // 收藏一个表情（评论区别人发的也行）：body { id, uri, url, type, resourceId }
    api.route('/douyin/collect-sticker', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      if (!b?.id) return { ok: false, error: '缺 id' }
      return dy.collectSticker({ id: String(b.id), uri: String(b.uri || ''), url: String(b.url || ''), type: Number(b.type ?? 2), resourceId: b.resourceId ? String(b.resourceId) : '' })
    })
    // 补记：把漏记的表情私信补进流水（带图描述），body { count }
    api.route('/douyin/backfill-stickers', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      try { return await dy.backfillStickerNotes(Number(b?.count ?? 4)) } catch (error) { return { ok: false, error: error.message } }
    })
    // 试：从收藏里发一张表情给主人（body { index }）
    api.route('/douyin/send-sticker', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      try { return { ok: true, ...(await dy.sendOwnerSticker(Number(b?.index ?? 0))) } } catch (error) { return { ok: false, error: error.message } }
    })
    // 试：看一张表情图画的是什么（body { url } 或 { uri }；url 是 static_url 那种能直接下载的地址）
    api.route('/douyin/look', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      const text = await dy.describeSticker(String(b?.url || b?.uri || ''))
      return { ok: !!text, text }
    })
    api.route('/douyin/confirm-owner', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      return dy.confirmOwner(String(b?.input ?? api.config().douyin.owner.input ?? ''))
    })
    return dy
  },
}

// reload 触发：2026-11-25T15:51:58.7860590+08:00
