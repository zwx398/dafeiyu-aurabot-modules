// 共享上下文：DSH 这边聊过的，她在这边（QQ / 抖音）也接得上。
//
// 为什么要它：她（大肥鱼）在 QQ/抖音的会话和 DSH 客户端是两份对话，只有记忆是一份，
// 而记忆靠关键词召回——换个话题就捞不到，于是「我在 DSH 说过」她转头又问一遍。
// 这个模块不做摘要模型调用，只做两件便宜事，每轮当背景塞进她的提示：
//   1) 最近几条原始对话（谁说的、说了什么，截断）
//   2) 主人早先说过的几句要点（窗口之外的，按时间倒序取前 N 条）
// 成本：每轮多几百字，不额外跑模型。

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const SESSIONS_ROOT = path.join(os.homedir(), '.dsh', 'sessions')
const BOT_WORKSPACE = /\\\\aurobot\\\\|\\aurobot\\/i

/** 她自己后台回合 / 系统脚手架，不该进共享上下文。 */
function isNoise(text) {
  const t = String(text || '').trim()
  if (!t) return true
  if (t.startsWith('<')) return true
  if (t.startsWith('【')) return true
  if (/^Time sampled while preparing/.test(t)) return true
  if (t.startsWith('[{"') || t.startsWith('[{ "')) return true
  if (t.includes('system-reminder')) return true
  if (t.startsWith('（刚才聊到的')) return true
  return false
}

function entryOf(ev) {
  if (!ev || typeof ev !== 'object') return null
  const at = Number(ev.time) || Date.now()
  if (ev.type === 'user/message') {
    const parts = ev?.data?.content
    if (!Array.isArray(parts)) return null
    const texts = parts.filter((p) => p?.type === 'text' && p.text).map((p) => String(p.text))
    const hasImage = parts.some((p) => p?.type === 'image')
    const text = texts.join('\n').trim() || (hasImage ? '[发了一张图]' : '')
    return text ? { who: 'user', text, at } : null
  }
  if (ev.type === 'assistant/message') {
    const parts = ev?.data?.message?.content
    if (!Array.isArray(parts)) return null
    const text = parts.filter((p) => p?.type === 'text' && p.text).map((p) => String(p.text)).join('\n').trim()
    return text ? { who: 'bot', text, at } : null
  }
  return null
}

/**
 * 会话文件是多帧 zstd 追加，整体解压会报「Unknown frame descriptor」（只能拿到第一帧 = 只有 session 头）。
 * 所以按 zstd 魔数 0x28B52FFD 切帧，逐帧解；某帧解不开就往后并一段再试（防止魔数偶然出现在压缩数据里）。
 */
function readLines(file) {
  let buf
  try { buf = fs.readFileSync(file) } catch { return [] }
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i)
  }
  if (!starts.length) return []
  const chunks = []
  let i = 0
  while (i < starts.length) {
    let ok = null
    for (let j = i + 1; j <= starts.length && !ok; j++) {
      const end = j < starts.length ? starts[j] : buf.length
      try { ok = { out: zlib.zstdDecompressSync(buf.subarray(starts[i], end)), next: j } } catch { /* 扩一段再试 */ }
    }
    if (!ok) break
    chunks.push(ok.out)
    i = ok.next
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean)
}

const clip = (t, n) => [...String(t ?? '').replace(/\s+/g, ' ').trim()].slice(0, n).join('')

export default {
  id: 'shared-context',
  name: '共享上下文',
  api: 1,
  version: '0.1.0',
  description: '把 DSH 这边刚聊过的内容当背景注入她的 QQ/抖音回合（最近窗口 + 主人早先说过的话）',
  defaults: {
    enabled: true,
    intervalSec: 120,
    nodePath: 'C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe',
    sessionsRoot: SESSIONS_ROOT,
    windowSize: 8,
    earlierCount: 5,
    entryChars: 90,
    maxAgeHours: 12,
    injectLimitChars: 900,
  },
  settings: [
    { key: 'enabled', label: '启用', type: 'switch' },
    { key: 'intervalSec', label: '多久扫一次（秒）', type: 'number', min: 30, max: 3600, step: 30 },
    { key: 'nodePath', label: '解压会话用的 node.exe', type: 'text' },
    { key: 'maxAgeHours', label: '多久之前的就不带了（小时）', type: 'number', min: 1, max: 72, step: 1 },
  ],

  setup(api) {
    const stateFile = () => path.join(api.dataDir(), 'state.json')
    const load = () => {
      try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {} } catch { return {} }
    }
    const save = (s) => {
      try {
        fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
        fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2))
      } catch (e) { api.log.warn('存共享上下文失败：', e?.message || e) }
    }

    function listSessionFiles() {
      const root = String(api.settings().sessionsRoot || SESSIONS_ROOT)
      const out = []
      let dirs = []
      try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { return out }
      for (const d of dirs) {
        if (BOT_WORKSPACE.test(d.name)) continue // 她自己后台回合的会话
        const wsDir = path.join(root, d.name)
        let subs = []
        try { subs = fs.readdirSync(wsDir, { withFileTypes: true }).filter((x) => x.isDirectory()) } catch { continue }
        for (const s of subs) {
          const f = path.join(wsDir, s.name, 'session.v4.jsonl.zstd')
          try {
            const st = fs.statSync(f)
            if (st.size > 0) out.push({ file: f, size: st.size, mtime: st.mtimeMs })
          } catch { /* 没这个文件 */ }
        }
      }
      return out.sort((a, b) => a.mtime - b.mtime)
    }

    /** 扫一遍最近动过的 DSH 会话，把「谁说了什么」攒进 state.entries(最近) 和 state.earlier(更早)。 */
    async function tick() {
      const cfg = api.settings()
      if (!cfg.enabled) return { ok: true, skipped: 'off' }
      const st = load()
      const offsets = st.offsets || {}
      const fresh = []
      const files = listSessionFiles().slice(-4) // 只看最近动过的几个会话，够用
      for (const f of files) {
        const known = Number(offsets[f.file] || 0)
        if (f.size <= known) continue
        const lines = readLines(f.file)
        const parsed = []
        for (const line of lines) {
          try {
            const ev = JSON.parse(line)
            const en = entryOf(ev)
            if (!en) continue
            const clean = String(en.text)
            if (isNoise(clean)) continue
            if (/system-reminder|工具调用|tool_result/.test(clean)) continue
            parsed.push(en)
          } catch { /* 半行 */ }
        }
        offsets[f.file] = f.size
        fresh.push(...parsed)
      }
      if (fresh.length) {
        fresh.sort((a, b) => a.at - b.at)
        const all = [...(st.all || []), ...fresh].sort((a, b) => a.at - b.at)
        st.all = all.slice(-400)
      }
      st.offsets = offsets
      st.updatedAt = Date.now()
      save(st)
      return { ok: true, added: fresh.length, total: (st.all || []).length }
    }

    /** 拼给她的那段背景。 */
    function buildInjection() {
      const cfg = api.settings()
      const st = load()
      const all = Array.isArray(st.all) ? st.all : []
      const age = Number(cfg.maxAgeHours || 12) * 3600_000
      const now = Date.now()
      const alive = all.filter((e) => e && e.at && now - e.at < age)
      if (!alive.length) return ''
      const win = 8
      const chars = 90
      const recent = alive.slice(-win)
      const earlier = alive.slice(0, Math.max(0, alive.length - win))
        .filter((e) => e.who === 'user')
        .slice(-5)
      const lines = []
      lines.push('【背景：你刚才在 DSH 那边跟主人聊过下面这些。这段不是主人现在说的话，是你记得的事，别当成新消息回。】')
      if (earlier.length) {
        lines.push('主人早先说过：')
        for (const e of earlier) lines.push('- ' + clip(e.text, chars))
      }
      lines.push('最近几句：')
      for (const e of recent) lines.push(`${e.who === 'user' ? '主人' : '你'}：${clip(e.text, chars)}`)
      let text = lines.join('\n')
      const limit = 900
      if (text.length > limit) text = text.slice(0, limit) + '…'
      return text
    }

    // 每轮都塞：只给主人的私聊和抖音私信回合，群聊/陌生人不给（省 token 也省隐私）
    api.on('prompt', (content, info) => {
      try {
        if (!Array.isArray(content)) return content
        const cfg = api.settings()
        if (!cfg.enabled) return content
        const chat = info?.chat || {}
        const ownerQQ = String(api.config().ownerQQ || '')
        const isOwnerPrivate = chat.kind === 'private' && String(chat.userId || '') === ownerQQ
        const isDouyinDm = chat.kind === 'system' && /^system:douyin-dm/.test(String(chat.chatId || ''))
        if (!isOwnerPrivate && !isDouyinDm) return content
        const text = buildInjection()
        if (!text) return content
        api.log.info(`注入共享上下文 ${text.length} 字（${isDouyinDm ? '抖音私信' : 'QQ 私聊'}）`)
        return [{ type: 'text', text }, ...content]
      } catch (error) {
        api.log.warn('注入共享上下文失败：', error?.message || error)
        return content
      }
    })

    api.every(Math.max(30, Number(api.settings().intervalSec) || 120) * 1000, () => { tick().catch(() => {}) }, '扫 DSH 会话')

    api.route('/preview', async () => ({ ok: true, text: buildInjection(), state: { total: (load().all || []).length, updatedAt: load().updatedAt } }))
    api.route('/tick', async () => tick())
    api.route('/clear', async () => { save({}); return { ok: true } })
  },
}
// reload 2026-11-28T20:47
