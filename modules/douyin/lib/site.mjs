// 抖音网页上的具体操作。数据都走抖音网页自己的接口（在页面里 fetch，签名由页面脚本自动加），
// 不读屏、不截图；点赞 / 评论在视频页上真点按钮，再等接口返回确认成没成功。

import { setTimeout as sleep } from 'node:timers/promises'
import { existsSync } from 'node:fs'

const HOME = 'https://www.douyin.com/'
export const videoLink = (id) => `https://www.douyin.com/video/${id}`

// 网页端接口的公共参数（和网页自己发的一样）
const BASE = { device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', pc_client_type: '1', version_code: '290100', version_name: '29.1.0', cookie_enabled: 'true', platform: 'PC', downlink: '10' }
// 这些业务码说明没登录
const NOT_LOGIN = new Set([8, 2190008])

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const clean = (t, max = 300) => [...String(t ?? '').replace(/\s+/g, ' ').trim()].slice(0, max).join('')

/** 编辑器可能把 emoji 显示成图片；比较可见文字时保留标点，不能把半句话当完整。 */
export function dmComparable(text) {
  return String(text || '').normalize('NFC').replace(/[\s\u00a0\u200b\u200d\ufe0f]|\p{Extended_Pictographic}|\p{Emoji_Modifier}/gu, '')
}

function dmEqual(actual, expected) {
  const target = dmComparable(expected)
  return target ? dmComparable(actual) === target : String(actual || '').trim() === String(expected || '').trim()
}

/** 从一段文字里认视频：完整链接 / modal_id / 图文 note / v.douyin.com 短链。 */
export function findAwemeId(text) {
  const s = String(text || '')
  const m = s.match(/douyin\.com\/(?:video|note)\/(\d{15,})/) || s.match(/[?&]modal_id=(\d{15,})/) || s.match(/iesdouyin\.com\/share\/(?:video|note)\/(\d{15,})/)
  if (m) return { awemeId: m[1] }
  const short = s.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?/)
  if (short) return { short: short[0] }
  if (/^\d{15,}$/.test(s.trim())) return { awemeId: s.trim() }
  return null
}

/** 短链跳一下，拿到真实视频 id。 */
export async function resolveShort(url, fetchImpl = fetch) {
  let cur = url
  for (let i = 0; i < 4; i++) {
    const r = await fetchImpl(cur, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' }, signal: AbortSignal.timeout(10000) })
    const loc = r.headers.get('location')
    if (!loc) break
    cur = new URL(loc, cur).toString()
    const id = findAwemeId(cur)
    if (id?.awemeId) return id.awemeId
  }
  return ''
}

/** 接口里的一条视频整理成她看的样子；广告 / 直播 / 没 id 的返回 null。 */
export function normalizeAweme(raw) {
  const a = raw?.aweme_info || raw?.aweme_detail || raw
  if (!a || typeof a !== 'object') return null
  const id = String(a.aweme_id || '')
  if (!id || a.is_ads || a.cell_room || a.is_live || a.live_reason) return null
  const st = a.statistics || {}
  const au = a.author || {}
  const desc = clean(a.desc, 300)
  return {
    awemeId: id,
    title: clean(a.item_title, 80) || desc.replace(/#\S+/g, '').trim().slice(0, 80),
    desc,
    author: clean(au.nickname, 40),
    authorSecUid: String(au.sec_uid || ''),
    likes: num(st.digg_count),
    comments: num(st.comment_count),
    shares: num(st.share_count),
    collects: num(st.collect_count),
    duration: Math.round(num(a.video?.duration || a.duration) / 1000),
    tags: (a.text_extra || []).map((t) => t?.hashtag_name).filter(Boolean).slice(0, 8),
    category: (a.video_tag || []).map((t) => t?.tag_name).filter(Boolean),
    summary: clean(a.chapter_abstract, 600), // 抖音自己生成的内容摘要，长一点的视频常有
    chapters: (a.chapter_list || []).map((c) => clean([c.desc, c.detail].filter(Boolean).join('：'), 120)).filter(Boolean).slice(0, 8),
    music: a.music?.title ? clean(`${a.music.title}${a.music.author ? ' - ' + a.music.author : ''}`, 60) : '',
    isImages: Array.isArray(a.images) && a.images.length > 0,
    createdAt: num(a.create_time) * 1000,
  }
}

/** 评论接口 → 按赞数排的热评 [{name, text, likes}]。 */
export function parseComments(json, max = 8) {
  return (json?.comments || [])
    .map((c) => ({ name: clean(c.user?.nickname, 20), text: clean(c.text, 120), likes: num(c.digg_count) }))
    .filter((c) => c.text)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, max)
}

/**
 * 某条评论的回复列表接口（/comment/list/reply/）→ 从旧到新 [{id, uid, nickname, text, replyId, replyToReplyId, at, likes}]。
 * 只看有 cid 和正文的；时间用毫秒，方便和「只接最近多久」比较。
 */
export function parseReplies(json, max = 20) {
  return (json?.comments || [])
    .map((c) => ({
      id: String(c.cid || ''),
      uid: String(c.user?.uid || ''),
      nickname: clean(c.user?.nickname, 40),
      text: clean(c.text, 300),
      replyId: String(c.reply_id || ''),
      replyToReplyId: String(c.reply_to_reply_id || ''),
      at: num(c.create_time) * 1000,
      likes: num(c.digg_count),
    }))
    .filter((c) => c.id && c.text)
    .sort((a, b) => a.at - b.at)
    .slice(-max)
}

const wan = (n) => (n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + '万' : String(n))

/** 一个视频交给她看的样子：标题、作者、数据、分类、摘要 / 章节、文案、音乐、热评。 */
export function digestOf(v, comments = []) {
  return [
    `《${v.title || '（无标题）'}》 作者：${v.author || '?'}  赞 ${wan(v.likes)}  评论 ${wan(v.comments)}${v.duration ? '  ' + v.duration + ' 秒' : ''}${v.isImages ? '  图文' : ''}`,
    v.category.length ? `分类：${v.category.join(' / ')}` : '',
    v.summary ? `内容摘要：${v.summary}` : '',
    v.chapters.length ? '分段：\n' + v.chapters.map((c) => '  - ' + c).join('\n') : '',
    v.desc && v.desc !== v.title ? `文案：${v.desc}` : '',
    v.music ? `配乐：${v.music}` : '',
    comments.length ? '热评：\n' + comments.map((c) => `  ${c.name}：${c.text}（${wan(c.likes)} 赞）`).join('\n') : '',
  ].filter(Boolean).join('\n')
}

/** 页面上现在有没有看得见的验证码 / 滑块。每次现查，不留标记（以前查到一次就永久「要验证」）。 */
export const VERIFY_PROBE = `(() => {
  const big = (n) => { const r = n.getBoundingClientRect(); const s = getComputedStyle(n); return r.width > 200 && r.height > 150 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1 }
  const nodes = [...document.querySelectorAll('#captcha_container, .captcha_verify_container, [id^=captcha], iframe[src*="verifycenter"], iframe[src*="captcha"]')]
  const hit = nodes.find(big)
  if (!hit) return ''
  const t = (hit.innerText || '').slice(0, 60)
  return t || '页面弹了验证码'
})()`

export function createSite({ browser, log }) {
  const b = browser

  /** 浏览器连上并停在抖音域名下（接口要同源才带登录态）。 */
  async function ensure() {
    const r = await b.open()
    if (!r.ok) return r
    const href = String(await b.evaluate('location.href').catch(() => ''))
    if (!/^https:\/\/www\.douyin\.com\//.test(href)) {
      await b.goto(HOME)
      await sleep(1500)
    }
    return { ok: true }
  }

  /** 在页面里调网页端 GET 接口。没登录 / 业务出错会抛带 code 的错。 */
  async function api(path, params = {}) {
    const u = new URL(path, HOME)
    for (const [k, v] of Object.entries({ ...BASE, ...params })) u.searchParams.set(k, String(v))
    const r = await b.evaluate(`fetch(${JSON.stringify(u.toString())}, { credentials: 'include' }).then(async (r) => ({ status: r.status, text: await r.text() }))`)
    if (!r || r.status !== 200) throw Object.assign(new Error(`抖音接口返回 ${r?.status || '空'}`), { code: r?.status })
    if (!r.text) throw Object.assign(new Error('抖音接口返回空内容（可能被风控了）'), { code: 'empty' })
    let json
    try { json = JSON.parse(r.text) } catch (error) { throw Object.assign(new Error('抖音接口返回的不是 JSON'), { code: 'bad' }) }
    const code = Number(json.status_code || 0)
    if (NOT_LOGIN.has(code)) throw Object.assign(new Error('抖音还没登录'), { code: 'login' })
    if (code) throw Object.assign(new Error(json.status_msg || `抖音接口出错（${code}）`), { code })
    return json
  }

  /** 当前登录的号；没登录返回 null。 */
  async function self() {
    try {
      const j = await api('/aweme/v1/web/user/profile/self/', { publish_video_strategy_type: 2, source: 'channel_pc_web', personal_center_strategy: 1 })
      const u = j.user || {}
      return u.sec_uid ? { secUid: String(u.sec_uid), nickname: clean(u.nickname, 40), uid: String(u.uid || '') } : null
    } catch (error) {
      if (error.code === 'login') return null
      throw error
    }
  }

  /** 推荐流一页。 */
  async function feed(refreshIndex = 1) {
    const j = await api('/aweme/v1/web/tab/feed/', { count: 10, refresh_index: refreshIndex, video_type_select: 1, aweme_pc_rec_raw_data: '{}', globalwid: '', pull_type: refreshIndex > 1 ? 2 : 0, min_window: 0, free_right: 0 })
    return (j.aweme_list || []).map(normalizeAweme).filter(Boolean)
  }

  async function detail(id) {
    const v = normalizeAweme((await api('/aweme/v1/web/aweme/detail/', { aweme_id: id })).aweme_detail)
    if (!v) throw new Error('这个视频打不开（删了、私密或者是直播）')
    return v
  }

  async function comments(id) {
    return parseComments(await api('/aweme/v1/web/comment/list/', { aweme_id: id, cursor: 0, count: 20, item_type: 0 }))
  }

  /** 某条评论下面的回复（含主人回复她的那条）。接口用 item_id，评论列表接口用 aweme_id，名字不一样。 */
  async function replies(id, commentId, { cursor = 0, count = 20 } = {}) {
    return parseReplies(await api('/aweme/v1/web/comment/list/reply/', { item_id: id, comment_id: commentId, cursor, count, item_type: 0 }), count)
  }

  /** 按关键词搜视频（私信里「转发」只给标题、不给链接时，用它把链接捞回来）。 */
  async function searchVideo(keyword, { count = 5 } = {}) {
    const kw = String(keyword || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!kw) return []
    const j = await api('/aweme/v1/web/search/item/', { search_channel: 'aweme_general', keyword: kw, offset: 0, count })
    return (j.data || []).map((x) => normalizeAweme(x?.aweme_info)).filter(Boolean).slice(0, count)
  }

  /** 某个人的作品列表（主页「作品」那栏的接口版），给「扫她作品下的评论」用。 */  async function userPosts(secUid, { count = 6 } = {}) {
    const j = await api('/aweme/v1/web/aweme/post/', { sec_user_id: String(secUid || ''), count, max_cursor: 0 })
    return (j.aweme_list || []).map(normalizeAweme).filter(Boolean).slice(0, count)
  }

  /**
   * 一条视频的评论（带 cid/uid/时间，不做热度排序），给「认出主人在自己作品下的留言」用。
   * 要的条数超过一页（50）时会翻页拿满——以前只读第一页，评论一多就漏。
   */
  async function commentsRaw(id, { count = 50, maxPages = 3 } = {}) {
    const want = Math.max(1, Number(count) || 50)
    const all = []
    let cursor = 0
    for (let i = 0; i < maxPages && all.length < want; i++) {
      const j = await api('/aweme/v1/web/comment/list/', { aweme_id: String(id), cursor, count: Math.min(50, want - all.length), item_type: 0 })
      const list = j.comments || []
      all.push(...list)
      const next = num(j.cursor)
      if (!j.has_more || !list.length || next === cursor) break
      cursor = next
    }
    return all.map((c) => ({
      cid: String(c.cid || ''),
      uid: String(c.user?.uid || ''),
      nickname: clean(c.user?.nickname, 40),
      text: clean(c.text, 300),
      at: num(c.create_time) * 1000,
      likes: num(c.digg_count),
      replies: num(c.reply_comment_total),
      sticker: c.sticker ? {
        id: String(c.sticker.id_str || ''),
        uri: c.sticker.animate_url?.uri || c.sticker.static_url?.uri || '',
        url: (c.sticker.static_url?.url_list || [])[0] || '',
        type: num(c.sticker.sticker_type),
        resourceId: String(c.sticker.origin_package_id || ''),
      } : null,
      images: (c.image_list || []).map((im) => ({
        uri: im.thumb_url?.uri || im.origin_url?.uri || '',
        // 图片评论的 origin 是 `~tplv-x-get:.image` 那种加密/非图格式，缩略图才是能直接下载的图
        url: (im.thumb_url?.url_list || im.origin_url?.url_list || [])[0] || '',
        w: num(im.thumb_url?.width || im.origin_url?.width || im.width),
        h: num(im.thumb_url?.height || im.origin_url?.height || im.height),
      })),
    })).filter((c) => c.cid && (c.text || c.sticker || c.images.length))
  }

  /**
   * 按 cid 拿一条评论的正文。通知里只有「@了谁」，正文得这么捞：
   * 评论列表接口带 insert_ids 会把指定的那条排在最前面返回（不用翻页、不用签名）。
   */
  async function commentById(id, cid) {
    const want = String(cid || '')
    if (!/^[0-9]+$/.test(want)) return null
    const j = await api('/aweme/v1/web/comment/list/', { aweme_id: id, cursor: 0, count: 20, item_type: 0, insert_ids: want })
    const c = (j.comments || []).find((x) => String(x.cid) === want)
    if (!c) return null
    return {
      cid: want,
      text: clean(c.text, 300),
      nickname: clean(c.user?.nickname, 40),
      uid: String(c.user?.uid || ''),
      at: num(c.create_time) * 1000,
      likes: num(c.digg_count),
      replies: num(c.reply_comment_total),
    }
  }

  /**
   * 直接在别人的评论下面回复（楼中楼）：POST comment/publish，body 带 reply_id + reply_to_reply_id。
   * 不走 UI、不另发一条新评论。返回 { ok, cid }。
   */
  async function replyComment(id, cid, text, { at, replyId = '', replyToReplyId = '0' } = {}) {
    const want = String(cid || '')
    if (!/^[0-9]+$/.test(want)) throw new Error('要回复哪条评论？cid 不对')
    const say = String(text ?? '').trim()
    if (!say) throw new Error('回复内容是空的')
    // 真 @：正文前面挂「@昵称」，同时把这个位置写进 text_extra（type 0），抖音才会渲染成可点的 @ 并通知对方
    const nick = at ? String(at.nickname || '').trim() : ''
    const mention = nick ? `@${nick}` : ''
    const body = mention ? `${mention} ${say}` : say
    const extra = mention
      ? JSON.stringify([{ user_id: String(at.uid || ''), sec_uid: String(at.secUid || ''), type: 0, start: 0, end: [...mention].length }])
      : '[]'
    const u = new URL('/aweme/v1/web/comment/publish/', HOME)
    for (const [k, v] of Object.entries(BASE)) u.searchParams.set(k, String(v))
    const form = new URLSearchParams({
      aweme_id: String(id),
      text: body,
      text_extra: extra,
      // 回一级评论：reply_id = 她的 cid、reply_to_reply_id = 0；
      // 回某条子回复：reply_id = 父评论 cid、reply_to_reply_id = 那条子回复的 cid
      reply_id: String(replyId || want),
      reply_to_reply_id: String(replyToReplyId || '0'),
      comment_type: '1',
      aweme_type: '0',
    }).toString()
    const r = await b.evaluate(`fetch(${JSON.stringify(u.toString())}, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: ${JSON.stringify(form)} }).then(async (r) => ({ status: r.status, text: await r.text(), headers: Object.fromEntries([...r.headers.entries()]) }))`)
    if (!r) throw new Error('回复没发出去（没等到抖音的回应）')
    const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    if (h['x-tt-verify-passport-decision']) throw Object.assign(new Error('抖音拦下了回复并返回账号验证标记，请在手机抖音检查账号安全或实名状态'), { code: 'verify' })
    let json = null
    try { json = JSON.parse(r.text) } catch {}
    if (!json) throw Object.assign(new Error(`回复没发出去（HTTP ${r.status}，抖音没返回结果）`), { code: 'empty' })
    if (Number(json.status_code) !== 0) throw Object.assign(new Error(json.status_msg || `回复失败（${json.status_code}）`), { code: json.status_code })
    const c = json.comment || {}
    return { ok: true, cid: String(c.cid || ''), replyId: String(c.reply_id || '') }
  }

  // ---------- 通知 / @我（首页右上角「通知」面板；数据从 React fiber 里读，不碰要签名的接口） ----------
  const NOTICE_ICON = '[data-aurabot="notice-icon"]'

  /**
   * 面板里每条通知的结构化数据（type 45 = 评论区 @了我）。
   * 面板是 React 渲染的，DOM 上只有「111 在评论中提到了你 18:43」这种文字，
   * 真正有用的 aweme_id / cid / 谁 @ 的，都在 fiber 的 memoizedProps.notice 里。
   */
  const NOTICE_PROBE = `(() => {
    const out = []
    const seen = new Set()
    for (const n of document.querySelectorAll('div')) {
      const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$'))
      if (!k) continue
      let f = n[k]
      for (let i = 0; i < 4 && f; i++, f = f.return) {
        const nt = f.memoizedProps && f.memoizedProps.notice
        if (!nt || !nt.nid_str || seen.has(nt.nid_str)) continue
        seen.add(nt.nid_str)
        const at = nt.at || {}
        const gen = nt.general_notice || {}
        const schema = String(at.schema_url || gen.schema_url || '')
        const afterDetail = schema.includes('/detail/') ? schema.split('/detail/')[1] : ''
        const idm = afterDetail.match(/^[0-9]+/)
        const afterCid = schema.includes('cid=') ? schema.split('cid=')[1] : ''
        const cidm = afterCid.match(/^[0-9]+/)
        const u = at.user_info || {}
        const aw = at.aweme || {}
        const a = aw.author || {}
        out.push({
          nid: String(nt.nid_str),
          type: Number(nt.type || 0),
          at: Number(nt.create_time || 0) * 1000,
          content: String(at.content || gen.content || '').slice(0, 200),
          awemeId: idm ? idm[0] : String(aw.aweme_id || ''),
          cid: cidm ? cidm[0] : '',
          fromUid: String(u.uid || ''),
          fromNick: String(u.nickname || '').slice(0, 40),
          fromSecUid: String(u.sec_uid || ''),
          awemeAuthor: String(a.nickname || '').slice(0, 40),
          awemeDesc: String(aw.desc || '').slice(0, 120),
          title: String(aw.item_title || '').slice(0, 80),
        })
      }
    }
    return out
  })()`

  /** 在首页顶栏找到「通知」并点开（真实鼠标事件，React 才认）。 */
  async function openNotice() {
    const marked = await b.evaluate(`(() => {
      const cands = [...document.querySelectorAll('div')].filter((n) => {
        const r = n.getBoundingClientRect()
        return (n.innerText || '').trim() === '通知' && r.width > 16 && r.width < 90 && r.height > 16 && r.y < 90
      })
      if (!cands.length) return false
      cands.sort((a, c) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - c.getBoundingClientRect().width * c.getBoundingClientRect().height)
      document.querySelectorAll(${JSON.stringify(NOTICE_ICON)}).forEach((x) => x.removeAttribute('data-aurabot'))
      cands[0].setAttribute('data-aurabot', 'notice-icon')
      return true
    })()`).catch(() => false)
    if (!marked) throw new Error('页面上没找到「通知」入口（页面可能还没加载完）')
    await b.press(NOTICE_ICON)
  }

  /**
   * 读「通知 → 互动消息」。返回 [{ nid, type, at, content, awemeId, cid, fromUid, fromNick, awemeAuthor, awemeDesc, title }]。
   * type 45 = 评论区 @了我，31 = 评论/回复，其他类型也一起给出去（调用方自己筛）。
   */
  async function readMentions({ limit = 20 } = {}) {
    await ensure()
    const href = String(await b.evaluate('location.href').catch(() => ''))
    if (!/^https:\/\/www\.douyin\.com\/(jingxuan|$|\?)/.test(href)) {
      await b.goto(HOME)
      await sleep(2500)
    }
    // 面板可能已经开着（上次没关）：先探一次，没数据再点
    let list = await b.evaluate(NOTICE_PROBE).catch(() => [])
    if (!Array.isArray(list) || !list.length) {
      await openNotice()
      list = []
      for (let i = 0; i < 12 && !list.length; i++) {
        await sleep(800)
        const got = await b.evaluate(NOTICE_PROBE).catch(() => [])
        if (Array.isArray(got)) list = got
      }
      await b.press(NOTICE_ICON).catch(() => {}) // 收起，别挡着后面的操作
    }
    if (!Array.isArray(list)) list = []
    return list.slice(0, limit)
  }

  /** 现在有没有验证码；有就返回原因。 */
  const verify = () => b.evaluate(VERIFY_PROBE).catch(() => '')

  /**
   * 点赞 / 评论的接口回应：只有明确返回 status_code 0 才算成功。
   * 账号被要求身份验证时，抖音回 200 + 空内容，响应头里带 x-tt-verify-passport-decision（以前把这种当成了成功）。
   */
  function checkWrite(r, what) {
    if (!r) throw new Error(`${what}没发出去（没等到抖音的回应）`)
    const h = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    if (h['x-tt-verify-passport-decision']) throw Object.assign(new Error(`抖音拦下了${what}并返回账号验证标记，网页不一定会显示验证码。请在手机抖音检查账号安全或实名状态，再在面板显示专用浏览器窗口核对；未确认前不要反复重试`), { code: 'verify' })
    if (!r.json) throw new Error(`${what}没发出去（抖音没返回结果）`)
    if (r.json.status_code !== 0) throw Object.assign(new Error(r.json.status_msg || `${what}失败（${r.json.status_code}）`), { code: r.json.status_code })
  }

  // 弹层播放器里正在播的那个视频（带着视频 id），点赞 / 评论按钮都只在它里面找，不会点到别的视频上
  const scope = (id) => `[data-e2e="feed-active-video"][data-e2e-vid="${id}"]`
  const EDITOR = '.comment-input-inner-container [contenteditable="true"]'

  /**
   * 用弹层播放器打开视频（和网页上点开一个视频一样；她真的在看，抖音那边也记成看过）。
   * 视频详情页那排按钮没有稳定的标记，弹层播放器的有。正在播的已经是它就不重开
   * （弹层开着「连播」，播完会自己跳到下一个，网址却不一定变，所以按正在播的视频判断）。
   */
  async function openVideo(id) {
    if (!/^\d{15,}$/.test(String(id))) throw new Error('视频 id 不对')
    if (!(await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(scope(id))}))`).catch(() => false))) await b.goto(`${HOME}jingxuan?modal_id=${id}`)
    const why = await verify()
    if (why) throw Object.assign(new Error('要验证：' + why), { code: 'verify' })
    if (!(await b.waitFor(scope(id), 12000))) throw new Error('视频没打开（可能删了或者是私密的）')
  }

  /** 看一个视频 ms 毫秒（静音播放）。 */
  async function watch(id, ms) {
    await openVideo(id)
    await b.evaluate(`document.querySelectorAll(${JSON.stringify(scope(id) + ' video')}).forEach((v) => { v.muted = true; v.play && v.play().catch(() => {}) })`).catch(() => {})
    await sleep(ms)
  }

  /** 点赞：已经赞过就不点（再点会变成取消）；点完等接口确认。 */
  async function like(id) {
    await openVideo(id)
    const sel = `${scope(id)} [data-e2e="video-player-digg"]`
    const btn = await b.waitFor(sel, 10000)
    if (!btn) throw new Error('页面上找不到点赞按钮')
    if (/digged/.test(btn.state) && !/no-digged/.test(btn.state)) return { ok: true, already: true }
    const resp = b.waitResponse(/\/aweme\/v1\/web\/commit\/item\/digg\//, 10000)
    await b.press(sel)
    const r = await resp
    checkWrite(r, '点赞')
    return { ok: true }
  }

  /** 评论框里的文字；清空评论框。 */
  const editorText = () => b.evaluate(`(document.querySelector(${JSON.stringify(EDITOR)}) || {}).innerText || ''`).catch(() => '')
  const clearEditor = () => b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(EDITOR)}); if (!e) return; e.focus(); document.execCommand('selectAll'); document.execCommand('delete') })()`).catch(() => {})

  /** 打开评论面板，把光标放进评论框（评论框空着时编辑器要点一下才出来）。 */
  async function focusEditor(id) {
    // 评论按钮是开 / 关切换：右边面板留在别的标签页时，第一下可能是把它关上，没出来就再点一下
    // （面板加载慢，等够了再点第二下，不然会把刚打开的又关上）
    for (let i = 0; i < 2 && !(await b.evaluate(`Boolean(document.querySelector('.comment-input-inner-container'))`)); i++) {
      if (!(await b.press(`${scope(id)} [data-e2e="feed-comment-icon"]`))) throw new Error('页面上找不到评论按钮')
      await b.waitFor('.comment-input-inner-container', 7000)
    }
    if (!(await b.evaluate(`Boolean(document.querySelector('.comment-input-inner-container'))`))) throw new Error('评论框没打开')
    for (let i = 0; i < 4; i++) {
      await b.press('.comment-input-inner-container')
      await sleep(300)
      const ok = await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(EDITOR)}); if (!e) return false; e.focus(); return document.activeElement === e })()`)
      if (ok) return
    }
    throw new Error('评论框点不进去')
  }

  /**
   * 在评论框里真·@一个人：打「@昵称」，从弹出的候选里按 sec_uid / uid 认出这个人点选，
   * 再确认编辑器里出现了抖音的提及标记（douyin_mention_word）。认不出就清空评论框，不发假 @。
   */
  async function mention(who) {
    await b.type('@' + who.nickname)
    const want = JSON.stringify({ secUid: who.secUid, uid: who.uid })
    let picked = null
    for (let i = 0; i < 12 && !picked?.ok; i++) {
      await sleep(500)
      picked = await b.evaluate(`(() => {
        const want = ${want}
        const of = (n) => {
          const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$'))
          for (let f = k && n[k], j = 0; f && j < 4; f = f.return, j++) {
            const m = f.memoizedProps && f.memoizedProps.mention
            if (m && (m.secUid || m.sec_uid || m.uid)) return { sec: String(m.secUid || m.sec_uid || ''), uid: String(m.uid || '') }
          }
          return null
        }
        const box = document.querySelector('.atBox-inner-container')
        if (!box) return { ok: false }
        const hit = [...box.querySelectorAll('div')].reverse().find((n) => { const m = of(n); return m && ((want.secUid && m.sec === want.secUid) || (want.uid && m.uid === want.uid)) })
        if (!hit) return { ok: false, listed: true }
        for (const t of ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click']) hit.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }))
        return { ok: true }
      })()`).catch(() => null)
    }
    await sleep(400)
    const tagged = await b.evaluate(`[...document.querySelectorAll(${JSON.stringify(EDITOR + ' .douyin_mention_word')})].some((n) => n.innerText.trim() === ${JSON.stringify('@' + who.nickname)})`).catch(() => false)
    if (picked?.ok && tagged) return true
    await clearEditor()
    throw Object.assign(new Error(picked?.listed ? '@ 候选里没找到主人（可能互相没关注）' : '@ 候选没弹出来'), { code: 'mention' })
  }

  /**
   * 发评论：打开评论面板、点输入框，要 @ 人就先真·@，再像人一样打字、回车，等发评论接口返回成功。
   * at = { secUid, uid, nickname }：发出去以后再核对一遍，返回里被 @ 的确实是这个人。
   */
  async function comment(id, text, { at } = {}) {
    await openVideo(id)
    await focusEditor(id)
    if ((await editorText()).trim()) await clearEditor() // 上次没发出去的残留
    if (at) await mention(at)
    await b.type(text)
    await sleep(500 + Math.random() * 800)
    // 发送：点评论框右边的红色箭头（打了字才出现，是那一排图标里最右边的一个）。页面看不见时回车不管用，所以不靠回车
    const marked = await b.evaluate(`(() => {
      let bar = document.querySelector('.comment-input-inner-container')
      for (let i = 0; i < 3 && bar; i++) bar = bar.parentElement
      const icons = bar ? [...bar.querySelectorAll('span')].filter((n) => n.querySelector('svg') && n.getBoundingClientRect().width > 10) : []
      const send = icons.sort((x, y) => x.getBoundingClientRect().x - y.getBoundingClientRect().x).at(-1)
      if (send) send.setAttribute('data-aurabot', 'send')
      return Boolean(send)
    })()`).catch(() => false)
    const resp = b.waitResponse(/\/aweme\/v1\/web\/comment\/publish/, 12000)
    void resp.catch(() => {}) // The response can reject before the click command returns.
    let r
    try {
      if (marked) await b.press('[data-aurabot="send"]')
      else await b.pressEnter()
      r = await resp
      checkWrite(r, '评论')
    } catch (error) {
      // 清掉编辑框里可能残留的草稿；点击后的状态须以平台回执为准。
      await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(EDITOR)}); e && e.focus() })()`).catch(() => {})
      await b.clearFocused().catch(() => {})
      if (error.code !== 'verify' && !Number.isFinite(r?.json?.status_code)) {
        throw Object.assign(new Error('抖音评论提交结果不确定，请先核对作品评论区'), { code: 'comment_uncertain' })
      }
      throw error
    }
    const c = r.json?.comment || {}
    const atOwner = Boolean(at) && (c.text_extra || []).some((x) => (at.secUid && x.sec_uid === at.secUid) || (at.uid && String(x.user_id) === String(at.uid)))
    return { ok: true, cid: String(c.cid || ''), atOwner }
  }

  /**
   * 在抖音里把视频私信分享给一个人（视频卡片）：打开视频的「分享」面板，在「分享给朋友」里按 sec_uid 认出这个人
   * （最近联系人里没有就用面板的搜索框搜昵称），点他那一行的「分享」，等私信接口发送成功才算数。认不出就不发。
   * 这一页里分享过的，那一行按钮会变成「捎句话」，就不再点（换页面后这个状态会丢，去重靠 duty 自己记）。
   * 「捎句话」（在私信框里再打一句话）页面看不见时发不稳，暂时不做，想让主人看到她的话就同时发 QQ。
   * who = { secUid, nickname }；返回 { ok, already }
   */
  async function share(id, who) {
    await openVideo(id)
    // 找到这个人那一行，给它的按钮做个记号；分享过的按钮是「捎句话」
    const findRow = () => b.evaluate(`(() => {
      const want = ${JSON.stringify(who.secUid)}
      const secOf = (n) => {
        const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$'))
        for (let f = k && n[k], j = 0; f && j < 6; f = f.return, j++) {
          for (const v of Object.values(f.memoizedProps || {})) if (v && typeof v === 'object' && (v.sec_uid || v.secUid)) return String(v.sec_uid || v.secUid)
        }
        return ''
      }
      const rows = [...document.querySelectorAll('div')].filter((n) => /(分享|捎句话)$/.test((n.innerText || '').trim()) && n.getBoundingClientRect().height > 30 && n.getBoundingClientRect().height < 90 && secOf(n))
      const row = rows.find((n) => secOf(n) === want)
      if (!row) return { found: false, listed: rows.length }
      const btn = [...row.querySelectorAll('*')].reverse().find((n) => ['分享', '捎句话'].includes((n.innerText || '').trim()))
      if (!btn) return { found: false, listed: rows.length }
      document.querySelectorAll('[data-aurabot="share-to"]').forEach((n) => n.removeAttribute('data-aurabot'))
      btn.setAttribute('data-aurabot', 'share-to')
      return { found: true, done: btn.innerText.trim() === '捎句话' }
    })()`).catch(() => ({ found: false }))
    // 分享按钮是开 / 关切换：面板已经开着就不点；点了等不到就再点一下
    let hit = await findRow()
    for (let tries = 0; tries < 2 && !hit?.found; tries++) {
      if (!(await b.press(`${scope(id)} [data-e2e="video-player-share"]`))) throw new Error('页面上找不到分享按钮')
      for (let i = 0; i < 16 && !hit?.found; i++) {
        await sleep(500)
        hit = await findRow()
      }
    }
    // 最近联系人里没有：用分享面板里的搜索框搜昵称（先清空，免得接在上次的字后面）
    if (!hit?.found && who.nickname) {
      const searched = await b.evaluate(`(() => {
        const box = [...document.querySelectorAll('input')].find((n) => n.getAttribute('placeholder') === '搜索' && n.getBoundingClientRect().width > 0)
        if (!box) return false
        box.focus()
        box.select()
        return true
      })()`).catch(() => false)
      if (searched) {
        await b.type(who.nickname)
        for (let i = 0; i < 10 && !hit?.found; i++) {
          await sleep(600)
          hit = await findRow()
        }
      }
    }
    if (!hit?.found) throw Object.assign(new Error('分享面板里没找到主人（可能互相没关注、私信不通）'), { code: 'share' })
    const sent = /\/v1\/message\/send/
    const already = Boolean(hit.done) // 这个视频之前就分享给他过了，不再重复分享
    if (!already) {
      const resp = b.waitResponse(sent, 12000)
      await b.press('[data-aurabot="share-to"]')
      const r = await resp
      if (!r) throw new Error('点了分享，但没等到抖音私信的回应')
      if (r.status !== 200) throw new Error(`抖音私信没发出去（HTTP ${r.status}）`)
    }
    return { ok: true, already }
  }

  // ---------- 私信（独立聊天页 douyin.com/chat） ----------
  const CHAT = `${HOME}chat?isPopup=1`
  const DM_EDIT = '[data-aurabot="dm-edit"]'

  /** 打开和某人的私信会话：会话 id 是「0:1:双方 uid」，按 uid 认人。页面在后台时列表要十几秒才出来。 */
  async function openChat(uid, { secUid = '' } = {}) {
    if (!String(await b.evaluate('location.href').catch(() => '')).startsWith(CHAT)) await b.goto(CHAT)
    let found = false
    for (let i = 0; i < 40 && !found; i++) {
      found = await b.evaluate(`(() => {
        const want = ${JSON.stringify(String(uid))}
        // 外层容器和里面那一行都能对上会话 id，点击要落在最里层那一行上才会打开会话
        let hit = null
        for (const n of document.querySelectorAll('div')) {
          const r = n.getBoundingClientRect()
          if (!(r.height > 40 && r.height < 120 && r.x < 450)) continue
          const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); if (!k) continue
          let match = false
          for (let f = n[k], j = 0; f && j < 3 && !match; f = f.return, j++) {
            for (const v of Object.values(f.memoizedProps || {})) {
              if (!v || typeof v !== 'object') continue
              let id = ''
              try { id = String(v.conversationId || v.id || '') } catch (e) {}
              if (/^0:1:/.test(id) && id.split(':').includes(want)) { match = true; break }
            }
          }
          if (match && (!hit || hit.contains(n))) hit = n
        }
        if (!hit) return false
        document.querySelectorAll('[data-aurabot="conv"]').forEach((x) => x.removeAttribute('data-aurabot'))
        hit.setAttribute('data-aurabot', 'conv')
        return true
      })()`).catch(() => false)
      if (!found) await sleep(1000)
    }
    // 列表里没有：用主页的「私信」按钮开一个新会话（陌生人也能主动发起）
    if (!found && secUid) found = await openFromProfile(secUid)
    if (!found) throw Object.assign(new Error('私信列表里没找到这个人，主页也没有可用的「私信」入口（可能对方关闭了私信）'), { code: 'dm' })
    await b.press('[data-aurabot="conv"]')
    await sleep(1500)
  }

  /** 打开某人的主页，点「私信」发起会话（列表里还没有的陌生人）。只打开会话，不发消息。 */
  async function openFromProfile(secUid) {
    const id = String(secUid || '')
    if (!/^MS4w[\w-]+$/.test(id)) return false
    await b.goto(`https://www.douyin.com/user/${id}`)
    const marked = await (async () => {
      for (let i = 0; i < 25; i++) {
        const ok = await b.evaluate(`(() => {
          // 「私信」可能在 button 里，也可能是个 div / span；取可见元素里最小（最像按钮）的那个
          const nodes = [...document.querySelectorAll('button,[role="button"],div,span,a,[data-e2e]')]
            .filter((n) => (n.innerText || '').trim() === '私信')
            .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 10 && r.height > 10 })
          if (!nodes.length) return false
          nodes.sort((a, c) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) - (c.getBoundingClientRect().width * c.getBoundingClientRect().height))
          const hit = nodes[0]
          document.querySelectorAll('[data-aurabot="dm-open"]').forEach((x) => x.removeAttribute('data-aurabot'))
          hit.setAttribute('data-aurabot', 'dm-open')
          return true
        })()`).catch(() => false)
        if (ok) return true
        await sleep(1000)
      }
      return false
    })()
    if (!marked) return false
    await b.press('[data-aurabot="dm-open"]')
    // 点完可能停在私信页，也可能弹出会话：等到输入框出现，再按 uid 核对一次会话
    for (let i = 0; i < 20; i++) {
      await sleep(1000)
      const href = String(await b.evaluate('location.href').catch(() => ''))
      // URL 可能不带 isPopup 参数，按域名 + 路径判断，再看输入框是否真的出现
      if (/^https:\/\/www\.douyin\.com\/chat/.test(href) && await b.evaluate(`Boolean(document.querySelector('.editor-kit-container[contenteditable="true"]'))`).catch(() => false)) return true
    }
    return false
  }

  /** 当前会话里的消息（从旧到新）：{ id, uid, text, at, card }；card = 分享的视频 { awemeId, title }。 */
  async function readChat() {
    const list = await b.evaluate(`(() => {
      const out = [], seen = new Set()
      for (const n of document.querySelectorAll('div')) {
        const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); if (!k) continue
        let m = null
        for (let f = n[k], j = 0; f && j < 3 && !m; f = f.return, j++) { const v = f.memoizedProps && f.memoizedProps.message; if (v && typeof v === 'object' && 'isMyMessage' in v) m = v }
        if (!m) continue
        const id = String(m.serverId ?? '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        const p = m.parsedContent || {}
        const at = m.createdAt instanceof Date ? m.createdAt.getTime() : Number(m.createdAt) || 0
        // 分享 / 转发卡片的 id 藏在好几个地方，都试一遍；只有标题没有 id 的先留着，稍后按标题搜
        const cardId = String(p.itemId || p.item_id || p.aweme_id || p.itemIdStr || (p.content && (p.content.itemId || p.content.item_id)) || '')
        const cardTitle = String(p.content_title || p.title || '').slice(0, 120)
        // 表情消息（aweType 501）：id / package_id / url JSON 都在 parsedContent 里，收藏要用
        let sticker = null
        if (String(p.aweType) === '501' && p.id) {
          let ur = {}
          try { ur = typeof p.url === 'string' ? JSON.parse(p.url) : (p.url || {}) } catch (error) {}
          sticker = { id: String(p.id), uri: ur.uri || '', url: (ur.url_list || [])[0] || '', type: Number(p.sticker_type || 1), resourceId: String(p.package_id || '') }
        }
        out.push({ id, uid: String(m.sender ?? ''), mine: m.isMyMessage === true, text: String(p.text || '').slice(0, 500), at, card: (cardId || cardTitle) ? { awemeId: cardId, title: cardTitle } : null, sticker })
      }
      return out.sort((a, c) => a.at - c.at)
    })()`).catch(() => [])
    return Array.isArray(list) ? list : []
  }

  /** 和这个人的私信：打开会话、读最近的消息（页面在后台时消息要过一会儿才加载出来，等一等）。 */
  async function dms(uid, { secUid = '' } = {}) {
    await openChat(uid, { secUid })
    let list = []
    for (let i = 0; i < 15 && !list.length; i++) {
      list = await readChat()
      if (!list.length) await sleep(1000)
    }
    return list
  }

  /**
   * 给一个已经核对过的人发一条纯文字私信：先按 uid 打开会话（列表里没有就从主页发起），再发。
   * 和 dms() 分开是为了让调用方看清「这是发给谁的」，不会误发到当前打开的会话里。
   * text 为空直接拒绝；返回 sendDm() 的结果（不确定时抛 code=dm_uncertain）。
   */
  async function dm(uid, text, { secUid = '' } = {}) {
    const want = String(uid || '')
    const say = String(text ?? '').trim()
    if (!want) throw new Error('要发给谁？没有核对过对方的抖音 uid')
    if (!say) throw new Error('私信内容是空的')
    await openChat(want, { secUid })
    return sendDm(say)
  }

  /** 在当前打开的会话里发一条私信：清空输入框、打字、回车（页面在后台时按键照样送得到），等私信接口发送成功。 */
  async function sendDm(text) {
    const ok = await b.evaluate(`(() => {
      // 按输入框自己的样子认（占位文字「发送消息」），别按位置：窗口宽窄不同，会话列表的宽度也不同
      const e = document.querySelector('.editor-kit-container[contenteditable="true"]') || [...document.querySelectorAll('[contenteditable="true"]')].find((x) => /发送消息/.test(x.getAttribute('data-placeholder') || x.getAttribute('placeholder') || ''))
      if (!e) return false
      e.setAttribute('data-aurabot', 'dm-edit')
      e.focus()
      return document.activeElement === e
    })()`).catch(() => false)
    if (!ok) throw new Error('私信输入框点不进去')
    // 打完字先核对框里是不是完整的这句（遇到过只发出去半句的），不对就清掉重打一次
    const inBox = () => b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(DM_EDIT)}); return e ? e.innerText : '' })()`).catch(() => '')
    for (let tries = 0; ; tries++) {
      await b.clearFocused()
      await b.type(text)
      await sleep(400 + Math.random() * 600)
      const typed = await inBox()
      if (dmEqual(typed, text)) break
      if (tries >= 1) { await b.clearFocused().catch(() => {}); throw new Error('私信输入框里的字对不上，没发') }
    }
    const startedAt = Date.now()
    const sent = /\/v1\/message\/send/
    let resp = b.waitResponse(sent, 8000)
    await b.pressEnter()
    let r = await resp
    // 没等到回执不代表失败，不能再点一次发送（IM 可能自动重发）。
    // 只认本账号、发送开始之后的新消息；不能拿主人说过的同一句当成功。
    if (!r) {
      await sleep(1500)
      const mine = (await readChat()).some((m) => m.mine && m.at >= startedAt - 2000 && dmEqual(m.text, text))
      if (mine) return { ok: true }
      const remaining = await inBox()
      // 仍完整留在输入框，且没有新消息：回车没触发发送，可安全点击一次按钮。
      if (dmEqual(remaining, text)) {
        const marked = await b.evaluate(`(() => { const s = document.querySelector('[class*="publishBtn"]'); if (!s) return false; s.setAttribute('data-aurabot', 'dm-send'); return true })()`).catch(() => false)
        if (marked) {
          const response = b.waitResponse(sent, 8000)
          await b.press('[data-aurabot="dm-send"]')
          r = await response
          if (!r) {
            await sleep(1500)
            const confirmed = (await readChat()).some((m) => m.mine && m.at >= startedAt - 2000 && dmEqual(m.text, text))
            if (confirmed) return { ok: true }
          }
        }
      }
      if (!r) throw Object.assign(new Error('私信发送状态不确定，已暂停重试，避免重复发送'), { code: 'dm_uncertain' })
    }
    if (r.status !== 200) {
      await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(DM_EDIT)}); e && e.focus() })()`).catch(() => {})
      await b.clearFocused().catch(() => {}) // 没发出去的字别留在框里，免得下次接在后面
      throw new Error(`私信没发出去（HTTP ${r.status}）`)
    }
    return { ok: true }
  }

  /**
   * 在当前打开的私信会话里发一张本地图片（表情包）。
   * 抖音私信的发图入口是输入框右边那个「选择文件」（semi-upload 组件，input[type=file] 是隐藏的）：
   * 塞文件后它会弹「发送给 X」的确认框，点「发送」才算真发出去。
   * 返回 { ok }；没找到上传框 / 弹窗没出来会抛错（调用方按失败处理，别当成功）。
   */
  async function dmImage(file) {
    const src = String(file || '')
    if (!src) throw new Error('要发的图是空的')
    if (!existsSync(src)) throw new Error('要发的表情图不存在：' + src)
    // 图片格式是抖音自己限定的那几种；gif 之类先别硬塞
    if (!/\.(png|jpe?g|webp|bmp)$/i.test(src)) throw new Error('抖音私信只收 png/jpg/webp/bmp：' + src)
    const input = '.messageMsgInputinputAction input[type=file]'
    const n = await b.setFiles(input, [src])
    if (!n) throw new Error('私信输入框旁边没找到发图入口')
    // 塞进去后抖音会弹预览框，等它出来
    const sure = await b.waitFor('[class*="MsgInputSendFileModalbtnSure"]', 25000)
    if (!sure) throw new Error('发图确认框没弹出来（可能图太大或格式不对）')
    await sleep(400 + Math.random() * 600)
    await b.press('[class*="MsgInputSendFileModalbtnSure"]')
    // 弹窗消失 = 已提交；一直不消失就是没发出去，不能报成功
    for (let i = 0; i < 25; i++) {
      await sleep(400)
      const gone = await b.evaluate('!document.querySelector(\'[class*="MsgInputSendFileModalbtnSure"]\')').catch(() => true)
      if (gone) return { ok: true }
    }
    throw new Error('点了发送但确认框没关，图可能没发出去')
  }

  /**
   * 发一条「带表情」的评论（表情来自她的抖音收藏）。
   * 网页端 UI 没有发表情评论的入口，但页面组件用的就是这组字段
   * （从评论组件的 JS 里挖出来的：sticker_id / sticker_uri / sticker_width /
   *  sticker_height / sticker_type / sticker_format），页面内 fetch 就能发。
   * 返回 { ok, cid }；发不出去抛错。
   */
  async function commentSticker(id, text, sticker) {
    const s = sticker || {}
    if (!s.id || !s.uri) throw new Error('表情缺 id / uri，发不了')
    const u = new URL('/aweme/v1/web/comment/publish/', HOME)
    u.searchParams.set('device_platform', 'webapp')
    u.searchParams.set('aid', '6383')
    u.searchParams.set('channel', 'channel_pc_web')
    const form = new URLSearchParams({
      aweme_id: String(id),
      text: String(text || ''),
      text_extra: '[]',
      sticker_id: String(s.id),
      sticker_uri: String(s.uri),
      sticker_width: String(s.w || 300),
      sticker_height: String(s.h || 300),
      sticker_type: String(s.type ?? 0),
      sticker_format: String(s.format || 'webp'),
    })
    const r = await b.evaluate(`fetch(${JSON.stringify(u.toString())}, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: ${JSON.stringify(form.toString())} }).then(async (r) => ({ status: r.status, text: await r.text() }))`)
    let json = null
    try { json = JSON.parse(r?.text || '') } catch (error) {}
    const c = json?.comment || {}
    if (!c.cid) throw new Error(`表情评论没发出去（HTTP ${r?.status}）`)
    return { ok: true, cid: String(c.cid) }
  }

  /**
   * 收藏一个表情（评论区别人发的表情也能收藏）。
   * 参数是从「私信右键 → 表情添加」抓包拿到的真实格式：
   *   query: action=1 / sticker_type=<type> / sticker_ids=[<id>] / sticker_uri / sticker_url
   *          / resource_id=<origin_package_id，可选>
   *   body: {}
   * 返回 { ok, code, msg }；code 7280 = 已添加（也算成功）。
   */
  async function collectSticker({ id, uri, url = '', type = 2, resourceId = '' } = {}) {
    if (!id) throw new Error('表情缺 id，收藏不了')
    await ensure()
    const u = new URL('/aweme/v1/web/im/resource/sticker/collect/', HOME)
    u.searchParams.set('device_platform', 'webapp')
    u.searchParams.set('aid', '1128')
    u.searchParams.set('channel', 'channel_pc_web')
    u.searchParams.set('app_id', '1128')
    u.searchParams.set('action', '1')
    u.searchParams.set('sticker_type', String(type))
    u.searchParams.set('sticker_ids', `[${id}]`)
    if (uri) u.searchParams.set('sticker_uri', String(uri))
    if (url) u.searchParams.set('sticker_url', String(url))
    if (resourceId) u.searchParams.set('resource_id', String(resourceId))
    const r = await b.evaluate(`fetch(${JSON.stringify(u.toString())}, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }).then(async (r) => ({ status: r.status, text: await r.text() }))`)
    let json = null
    try { json = JSON.parse(r?.text || '') } catch (error) {}
    const code = json?.status_code
    if (code !== 0 && code !== 7280) throw new Error(`收藏表情失败：${json?.status_msg || 'HTTP ' + r?.status}`)
    return { ok: true, code, msg: json?.status_msg || '' }
  }

  /**
   * 把当前视频页的评论区展开（表情图要渲染出来才截得到）。
   * 找「评论(数字)」那个 tab 点一下；已经展开就什么都不做。
   */
  async function openComments() {
    const r = await b.evaluate(`(() => {
      const hit = [...document.querySelectorAll('span,div')].find((n) => /^评论\\s*\\(?\\d*\\)?$/.test((n.innerText || '').trim()) && n.getBoundingClientRect().width > 20)
      if (!hit) return 'no tab'
      hit.click()
      return 'clicked'
    })()`).catch(() => '')
    if (r === 'clicked') await new Promise((res) => setTimeout(res, 2500))
    return r === 'clicked'
  }

  /**
   * 把页面上某个表情的图截下来（返回 data URL），给模型「看图」用。
   * 用表情的 uri 去 img.src 里匹配元素，按它的 boundingRect 截一块。
   * 只在视频页/评论区当前渲染了这张表情时有效；找不到就返回 ''。
   */
  async function stickerImage(uri) {
    const find = uri
      ? `[...document.querySelectorAll('img')].find((n) => (n.src || '').includes(${JSON.stringify(String(uri))}))`
      : `[...document.querySelectorAll('img')].find((n) => n.getBoundingClientRect().width > 80)`
    // 先把那张图滚到视口中间，不然它可能没渲染（宽高为 0），截图就是空的
    const moved = await b.evaluate(`(() => {
      const img = ${find}
      if (!img) return false
      img.scrollIntoView({ block: 'center' })
      return true
    })()`).catch(() => false)
    if (!moved) return ''
    await new Promise((res) => setTimeout(res, 700))
    const rect = await b.evaluate(`(() => {
      const img = ${find}
      if (!img) return ''
      const r = img.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) return ''
      return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
    })()`).catch(() => '')
    if (!rect) return ''
    let c = null
    try { c = JSON.parse(rect) } catch (error) {}
    if (!c || !c.width || !c.height) return ''
    return b.screenshot(c).catch(() => '')
  }

  /**
   * 下载一张图片的数据（base64 + mediaType），给模型「看图」用。
   * 抖音图片有防盗链：必须带浏览器里的 cookie + Referer，用 Node 直接 fetch 才拿得到真图
   * （页面里 fetch 会跨域，截图又常常因为图没渲染而截到空白）。
   */
  async function imageData(url) {
    if (!url) return null
    let jar = ''
    try {
      const cs = await b.cookies()
      jar = (cs || []).filter((c) => /douyin/.test(String(c.domain))).map((c) => `${c.name}=${c.value}`).join('; ')
    } catch (error) {}
    const r = await fetch(url, {
      headers: {
        ...(jar ? { Cookie: jar } : {}),
        Referer: 'https://www.douyin.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    }).catch((error) => ({ ok: false, status: 0, headers: { get: () => '' }, text: async () => String(error.message) }))
    if (!r || !r.ok) return { error: `HTTP ${r?.status || '?'}` }
    const type = String(r.headers.get('content-type') || '')
    if (!type.startsWith('image/')) return { error: `不是图片（${type || '无类型'}）` }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length) return { error: '空文件' }
    if (buf.length > 8 * 1024 * 1024) return { error: `太大 ${Math.round(buf.length / 1024 / 1024)}MB` }
    return { data: buf.toString('base64'), mediaType: type.split(';')[0] }
  }

  /** 按消息 sid 找那条表情消息的图地址（发完用 sid 精确定位，别拿错上一条）。 */
  async function stickerUrlBySid(sid) {
    if (!sid) return ''
    const v = await b.evaluate(`(() => {
      const want = ${JSON.stringify(String(sid))}
      for (const n of document.querySelectorAll('div')) {
        const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); if (!k) continue
        let m = null
        for (let f = n[k], j = 0; f && j < 3 && !m; f = f.return, j++) { const v = f.memoizedProps && f.memoizedProps.message; if (v && typeof v === 'object' && 'isMyMessage' in v) m = v }
        if (!m || String(m.serverId || '') !== want) continue
        const p = m.parsedContent || {}
        if (String(p.aweType) !== '501') continue
        let ur = {}
        try { ur = typeof p.url === 'string' ? JSON.parse(p.url) : (p.url || {}) } catch (e) {}
        return (ur.url_list || [])[0] || ''
      }
      return ''
    })()`).catch(() => '')
    return String(v || '')
  }

  /** 当前会话里「我发的最后一条表情消息」的图地址（发完表情后拿它看一眼，写进记录）。 */
  async function lastMyStickerImage() {
    const src = await b.evaluate(`(() => {
      let hit = ''
      for (const n of document.querySelectorAll('div')) {
        const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); if (!k) continue
        let m = null
        for (let f = n[k], j = 0; f && j < 3 && !m; f = f.return, j++) { const v = f.memoizedProps && f.memoizedProps.message; if (v && typeof v === 'object' && 'isMyMessage' in v) m = v }
        if (!m || m.isMyMessage !== true) continue
        const p = m.parsedContent || {}
        if (String(p.aweType) !== '501') continue
        let ur = {}
        try { ur = typeof p.url === 'string' ? JSON.parse(p.url) : (p.url || {}) } catch (e) {}
        const u = (ur.url_list || [])[0] || ''
        if (u) hit = u
      }
      return hit
    })()`).catch(() => '')
    return String(src || '')
  }

  /**
   * 从「我的表情」里挑一张，发到当前私信会话（点面板 → 我的表情 tab → 点一张）。
   * 用法前要先把会话打开（site.dms / site.dm）。index 是第几张，默认第一张。
   */
  async function dmSticker({ index = 0 } = {}) {
    await ensure()
    const rectOf = async (expr) => {
      const r0 = await b.evaluate(`(() => {
        const el = ${expr}
        if (!el) return ''
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) return ''
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) })
      })()`).catch(() => '')
      if (!r0) return null
      try { return JSON.parse(r0) } catch (error) { return null }
    }
    const lastSid = async () => {
      const v = await b.evaluate(`(() => {
        let hit = ''
        for (const n of document.querySelectorAll('div')) {
          const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); if (!k) continue
          let m = null
          for (let f = n[k], j = 0; f && j < 3 && !m; f = f.return, j++) { const v = f.memoizedProps && f.memoizedProps.message; if (v && typeof v === 'object' && 'isMyMessage' in v) m = v }
          if (!m || m.isMyMessage !== true) continue
          const p = m.parsedContent || {}
          if (String(p.aweType) !== '501') continue
          hit = String(m.serverId || '')
        }
        return hit
      })()`).catch(() => '')
      return String(v || '')
    }
    const before = await lastSid()
    const btn = await rectOf(`(() => { const act = document.querySelector('[class*="messageMsgInputinputAction"]'); return act ? (act.querySelectorAll('svg')[1] || '') : '' })()`)
    if (!btn) throw new Error('找不到私信表情按钮')
    await b.click(btn.x, btn.y)
    await sleep(1500)
    const tab = await rectOf(`(() => { const t = document.querySelectorAll('[class*="subTab"]'); return t[2] || '' })()`)
    if (tab) { await b.click(tab.x, tab.y); await sleep(1800) }
    // 面板里的 img 用鼠标坐标点（DOM click 不触发 React 的 pointer 事件）
    const face = await rectOf(`(() => {
      const p = document.querySelector('.componentsemojiemojiPanel')
      if (!p) return ''
      return [...p.querySelectorAll('img')][${Number(index) || 0}] || ''
    })()`)
    if (!face) throw new Error('表情面板里没找到图')
    // 点之前把那张图的地址等出来（面板是懒加载，刚点开 src 还是空的）；
    // 拿不到 src 再退回截图。两种都比「发完去翻上一条」准。
    let imgSrc = ''
    for (let i = 0; i < 12; i++) {
      imgSrc = await b.evaluate(`(() => {
        const p = document.querySelector('.componentsemojiemojiPanel')
        if (!p) return ''
        const img = [...p.querySelectorAll('img')][${Number(index) || 0}]
        return img ? (img.src || '') : ''
      })()`).catch(() => '')
      if (imgSrc) break
      await sleep(300)
    }
    let shot = ''
    if (!imgSrc) {
      shot = await b.screenshot({ x: face.x - Math.round(face.w / 2), y: face.y - Math.round(face.h / 2), width: face.w, height: face.h }).catch(() => '')
    }
    await b.click(face.x, face.y)
    await sleep(2200)
    const after = await lastSid()
    await b.click(btn.x, btn.y).catch(() => {})
    await sleep(400)
    // 检测只是辅助：面板里的图点了以后 DOM 常常还是旧统计，别把它当失败，不然记录就丢了
    const changed = !!after && after !== before
    return { ok: true, sid: after, confirmed: changed, imgSrc: String(imgSrc || ''), shot: String(shot || '') }
  }

  /**
   * 她自己的抖音表情收藏（App 里加的会同步过来）。
   * 分页拉 /aweme/v1/web/im/resource/list/aggregation?scenes=CUSTOM_STICKER_PAGE。
   */
  async function myStickers({ limit = 200 } = {}) {
    await ensure()
    const raw = await b.evaluate(`(async () => {
      const all = []
      let cursor = 0
      for (let n = 0; n < 20; n++) {
        const u = 'https://www.douyin.com/aweme/v1/web/im/resource/list/aggregation/?device_platform=webapp&aid=1128&channel=channel_pc_web&app_id=1128&scenes=CUSTOM_STICKER_PAGE&custom_cursor=' + cursor + '&custom_page_size=50'
        const d = JSON.parse(await (await fetch(u, { credentials: 'include' })).text())
        const page = d.custom_sticker_page_list || {}
        for (const res of (page.resources || [])) {
          for (const s of (res.stickers || [])) {
            const a = s.animate_url || s.static_url || {}
            all.push({ id: String(s.id_str || ''), uri: a.uri || '', w: a.width || 0, h: a.height || 0, format: s.animate_type || 'webp', type: 2 })
          }
        }
        const next = page.next_cursor
        if (page.is_completed || !next || next === cursor) break
        cursor = next
      }
      return JSON.stringify(all)
    })()`)
    let stickers = []
    try { stickers = JSON.parse(raw || '[]') } catch (error) {}
    return { ok: true, stickers: stickers.filter((s) => s.id && s.uri).slice(0, limit) }
  }

  /** 按 sec_uid 查一个人（@ 之前拿最新昵称；核对主人用）。 */
  async function user(secUid) {
    const u = (await api('/aweme/v1/web/user/profile/other/', { sec_user_id: secUid, source: 'channel_pc_web' })).user || {}
    if (!u.sec_uid) throw new Error('找不到这个抖音号')
    return { secUid: String(u.sec_uid), uid: String(u.uid || ''), nickname: clean(u.nickname, 40), douyinId: String(u.unique_id || u.short_id || '') }
  }

  /**
   * 认一个人：主页链接 / secUid 直接查；v.douyin.com 短链先在浏览器里跳一下取主页；
   * 其余当抖音号搜。找不到会抛错。
   */
  async function profileOf(link) {
    const s = String(link || '').trim()
    if (!s) throw new Error('没给抖音主页链接或抖音号')
    const direct = s.match(/douyin\.com\/user\/(MS4w[\w-]+)/)?.[1] || (/^MS4w[\w-]+$/.test(s) ? s : '')
    if (direct) return user(direct)
    if (/^https?:\/\//i.test(s)) {
      await b.goto(s)
      for (let i = 0; i < 10; i++) {
        const href = String(await b.evaluate('location.href').catch(() => ''))
        const sec = href.match(/douyin\.com\/user\/(MS4w[\w-]+)/)?.[1]
        if (sec) return user(sec)
        await sleep(1000)
      }
      throw new Error('这个链接不是抖音主页（或者没跳过去）')
    }
    return findByDouyinId(s.replace(/^@/, ''))
  }

  /** 按抖音号搜人，只认抖音号完全一样的。 */
  async function findByDouyinId(douyinId) {
    const j = await api('/aweme/v1/web/discover/search/', { keyword: douyinId, search_channel: 'aweme_user_web', search_source: 'normal_search', query_correct_type: 1, is_filter_search: 0, offset: 0, count: 10 })
    const hit = (j.user_list || []).map((x) => x.user_info || {}).find((u) => [u.unique_id, u.short_id].map(String).includes(String(douyinId)))
    if (!hit?.sec_uid) throw new Error('按抖音号没搜到这个人，换成主页链接试试')
    return user(hit.sec_uid)
  }

  /** 截登录弹窗（二维码、扫完待确认、二次验证都在里面）；弹窗不在就截整页。 */
  async function loginShot() {
    const box = await b.evaluate(`(() => {
      const n = document.querySelector('#login-panel-new') || document.querySelector('#douyin_login_comp_flat_panel')
      if (!n) return null
      const r = n.getBoundingClientRect()
      return r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null
    })()`).catch(() => null)
    return b.screenshot(box || undefined).catch(() => '')
  }

  /** 开始扫码登录：已登录直接返回；否则点右上角「登录」，等二维码出来。 */
  async function loginStart() {
    const ok = await ensure()
    if (!ok.ok) return ok
    const me = await self()
    if (me) {
      const why = await b.evaluate(VERIFY_PROBE)
      if (typeof why !== 'string') throw new Error('无法确认抖音验证状态')
      return why ? { ok: true, loggedIn: false, shot: await loginShot() } : { ok: true, loggedIn: true, me }
    }
    // 右上角「登录」：先做个记号再点（页面看不见时也点得到）
    const marked = await b.evaluate(`(() => {
      const all = [...document.querySelectorAll('button,div,span,a,p')].filter((n) => (n.innerText || '').trim() === '登录' && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().top < 120)
      const n = all.sort((a, c) => a.getBoundingClientRect().width - c.getBoundingClientRect().width)[0]
      if (n) n.setAttribute('data-aurabot', 'login')
      return Boolean(n)
    })()`).catch(() => false)
    if (marked) await b.press('[data-aurabot="login"]')
    await b.waitFor('#douyin_login_comp_scan_code img, #douyin_login_comp_scan_code canvas', 12000)
    return { ok: true, loggedIn: false, shot: await loginShot() }
  }

  /** 扫码中途看一眼：登上了就返回号，没登上就给最新的弹窗截图。 */
  async function loginPoll() {
    if (!b.connected()) return { ok: true, loggedIn: false, shot: '' }
    // 扫码后仍可能需要短信或安全验证，主人处理完再算登录完成。
    const why = await b.evaluate(VERIFY_PROBE)
    if (typeof why !== 'string') throw new Error('无法确认抖音验证状态')
    if (why) return { ok: true, loggedIn: false, shot: await loginShot() }
    const me = await self().catch(() => null)
    if (me) return { ok: true, loggedIn: true, me }
    return { ok: true, loggedIn: false, shot: await loginShot() }
  }

  return { ensure, self, user, profileOf, findByDouyinId, feed, detail, comments, commentsRaw, userPosts, searchVideo, replies, commentById, replyComment, readMentions, verify, watch, like, comment, commentSticker, myStickers, collectSticker, stickerImage, openComments, imageData, dmImage, dmSticker, lastMyStickerImage, stickerUrlBySid, share, dms, dm, sendDm, screenshot: () => b.screenshot().catch(() => ''), loginStart, loginPoll, show: (v) => b.show(v), connected: () => b.connected() }
}
