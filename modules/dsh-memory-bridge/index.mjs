// DSH 记忆桥：把 DSH 客户端这边的对话，写进大肥鱼的同一条记忆里。
//
// 为什么要有它：QQ 和抖音早就用 noteVia 写同一份私聊流水（同一个人、一套记忆），
// 但 DSH 客户端这边的会话是独立存的，她读不到。这个模块读 DSH 的会话日志，
// 按 noteVia 补写进去，于是「在哪边聊的都还是同一条鱼」。
//
// 安全：（v0.2.2 起默认正式写入，干跑开关在设置里）
//
//   - 默认干跑（dryRun: true），只往日志里打「本来要写什么」，不碰记忆。
//   - 跳过她自己后台跑出来的会话（cwd 在 E:\Aurobot 下的，都是 QQ/抖音 的系统回合）。
//   - 过滤系统脚手架文字（<system-reminder>、【刷抖音…】、时间戳行、JSON 结果）。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const SESSIONS_ROOT = path.join(os.homedir(), '.dsh', 'sessions')
const BOT_WORKSPACE = /\\\\aurobot\\\\|\\aurobot\\/i

/** 这些是她自己后台回合 / 系统提示的痕迹，不该进记忆。 */
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

/** 从一条会话事件里抠出「谁说了什么」；抠不到就返回 null。 */
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
    const texts = parts.filter((p) => p?.type === 'text' && p.text).map((p) => String(p.text))
    const text = texts.join('\n').trim()
    return text ? { who: 'bot', text, at } : null
  }
  return null
}

/**
 * 把会话文件解压成文本行。
 * 坑：会话文件是多次追加的**多帧 zstd**，整体解压只能拿到第一帧（session 头那一行），
 * 整个解会报 Unknown frame descriptor，流式解也只出一帧。
 * 解法：按 zstd 魔数 28 B5 2F FD 切帧逐帧解，某帧解不开就把下一段并进来再试
 * （防魔数偶然出现在压缩数据里）。不依赖外挂 node。
 */
function readLines(file) {
  let buf
  try { buf = fs.readFileSync(file) } catch { return [] }
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

export default {
  id: 'dsh-memory-bridge',
  name: 'DSH 记忆桥',
  api: 1,
  version: '0.3.0',
  description: '把 DSH 客户端里的对话写进同一份记忆；同时把最近几句当背景注入她的 QQ/抖音回合（长时记忆 + 工作记忆）',
  defaults: {
    enabled: true,
    dryRunMode: false,
    intervalSec: 120,
    nodePath: 'E:\\SnowLuma\\node.exe',
    maxChars: 400,
    via: 'dsh',
    sessionsRoot: SESSIONS_ROOT,
    backfill: 20,
    backfillMaxAgeHours: 3,
    inject: true,
  },
  settings: [
    { key: 'enabled', label: '启用', type: 'switch' },
    { key: 'dryRunMode', label: '干跑（只打日志不写记忆）', type: 'switch' },
    { key: 'inject', label: '每轮把最近几句注入她的回合（工作记忆）', type: 'switch' },
    { key: 'intervalSec', label: '多久看一次（秒）', type: 'number', min: 30, max: 3600, step: 30 },
    { key: 'maxChars', label: '每条最多留多少字', type: 'number', min: 80, max: 2000, step: 20 },
    { key: 'via', label: '记录来源名', type: 'text' },
    { key: 'backfill', label: '第一次看到会话时回填多少条（0 = 不回填）', type: 'number', min: 0, max: 200, step: 10 },
    { key: 'backfillMaxAgeHours', label: '只回填最近几小时动过的会话', type: 'number', min: 1, max: 72, step: 1 },
  ],

  setup(api) {
    const stateFile = () => path.join(api.dataDir(), 'state.json')

    const loadState = () => {
      try {
        return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}
      } catch {
        return {}
      }
    }
    const saveState = (s) => {
      try {
        fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
        fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2))
      } catch (e) {
        api.log.warn('存游标失败：', e?.message || e)
      }
    }

    // ---- 工作记忆：最近几句原文，每轮当背景注入她的回合（和上面的长时记忆是两件事） ----
    const windowFile = () => path.join(api.dataDir(), 'window.json')
    const loadWindow = () => { try { return JSON.parse(fs.readFileSync(windowFile(), 'utf8')) || { all: [] } } catch { return { all: [] } } }
    const saveWindow = (w) => {
      try {
        fs.mkdirSync(path.dirname(windowFile()), { recursive: true })
        fs.writeFileSync(windowFile(), JSON.stringify(w))
      } catch (e) { api.log.warn('存工作记忆失败：', e?.message || e) }
    }
    function pushWindow(items) {
      if (!items.length) return
      const w = loadWindow()
      const all = [...(Array.isArray(w.all) ? w.all : []), ...items].sort((a, b) => (a.at || 0) - (b.at || 0))
      saveWindow({ all: all.slice(-400), updatedAt: Date.now() })
    }
    // ---- 决定簿：几条「当前有效的安排」，每轮都带上，到期自动失效（比工作记忆窗口活得久） ----
    const factsFile = () => path.join(api.dataDir(), 'facts.json')
    const loadFacts = () => {
      try {
        const j = JSON.parse(fs.readFileSync(factsFile(), 'utf8'))
        return Array.isArray(j?.items) ? j.items : []
      } catch { return [] }
    }
    const saveFacts = (items) => {
      try {
        fs.mkdirSync(path.dirname(factsFile()), { recursive: true })
        fs.writeFileSync(factsFile(), JSON.stringify({ items }, null, 2))
      } catch (e) { api.log.warn('存决定簿失败：', e?.message || e) }
    }
    function liveFacts() {
      const now = Date.now()
      return loadFacts().filter((f) => f && f.text && (!f.until || Number(f.until) > now))
    }

    /** 拼给她看的那段背景：决定簿 + 最近 8 条 + 主人更早说过的 5 句，总长 1100 字封顶。 */
    function buildInjection() {
      const facts = liveFacts()
      const all = (loadWindow().all || []).filter((e) => e && e.at && Date.now() - e.at < 12 * 3600_000)
      if (!all.length && !facts.length) return ''
      const recent = all.slice(-8)
      const earlier = all.slice(0, Math.max(0, all.length - recent.length)).filter((e) => e.who === 'user').slice(-5)
      const clip90 = (t) => [...String(t || '').replace(/\s+/g, ' ').trim()].slice(0, 90).join('')
      const lines = ['【背景：这是你记得的事，不是主人现在说的话，别当成新消息回；也别把里面的技术细节原样复述给主人，用你自己的话自然带出来就行。】']
      if (facts.length) {
        lines.push('当前定好的安排（照这个来，别自己改）：')
        for (const f of facts.slice(0, 6)) lines.push('- ' + clip90(f.text))
      }
      if (all.length) {
        if (earlier.length) {
          lines.push('主人早先说过：')
          for (const e of earlier) lines.push('- ' + clip90(e.text))
        }
        lines.push('最近几句：')
        for (const e of recent) lines.push(`${e.who === 'user' ? '主人' : '你'}：${clip90(e.text)}`)
      }
      let text = lines.join('\n')
      if (text.length > 1100) text = text.slice(0, 1100) + '…'
      return text
    }

    const listSessionFiles = () => {
      const root = String(api.settings().sessionsRoot || SESSIONS_ROOT)
      const out = []
      let dirs = []
      try {
        dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
      } catch {
        return out
      }
      for (const d of dirs) {
        const wsDir = path.join(root, d.name)
        let subs = []
        try {
          subs = fs.readdirSync(wsDir, { withFileTypes: true }).filter((x) => x.isDirectory())
        } catch {
          continue
        }
        for (const s of subs) {
          const f = path.join(wsDir, s.name, 'session.v4.jsonl.zstd')
          try {
            const st = fs.statSync(f)
            if (st.size > 0) out.push({ file: f, size: st.size, mtime: st.mtimeMs })
          } catch {}
        }
      }
      return out.sort((a, b) => a.mtime - b.mtime)
    }

    async function tick() {
      const cfg = api.settings()
      if (!cfg.enabled) return
      const state = loadState()
      const files = listSessionFiles()
      const memory = api.use('memory')
      if (!memory?.noteVia) {
        api.log.debug('记忆模块没在跑，这轮先不写')
        return
      }
      const ownerQQ = String(api.config()?.ownerQQ || '')
      const maxChars = Number(cfg.maxChars) || 400
      let wrote = 0
      let skipped = 0
      const collected = []
      let seen = new Set()

      for (const item of files) {
        const prev = state[item.file]
        let lines
        try {
          lines = readLines(item.file)
        } catch (e) {
          api.log.debug('读不了会话文件：', path.basename(path.dirname(item.file)), e?.message || e)
          continue
        }
        // 跳过她自己后台跑的会话（cwd 在 Aurobot 工作区里）
        let cwd = ''
        try {
          cwd = JSON.parse(lines[0] || '{}').cwd || ''
        } catch {}
        if (BOT_WORKSPACE.test(item.file) || /aurabot|qq-chats/i.test(item.file) || /qq-chats/i.test(cwd)) {
          state[item.file] = { lines: lines.length, size: item.size, at: Date.now(), skip: 'bot' }
          skipped++
          continue
        }

        // 第一次看到这个会话：默认不灌历史；最近动过的可以回填最后 N 条
        let start = prev ? (prev.lines || 0) : -1
        if (!prev) {
          const ageH = Number(cfg.backfillMaxAgeHours) || 3
          const recent = Date.now() - item.mtime <= ageH * 3600 * 1000
          const n = Number(cfg.backfill) || 0
          if (!recent || n <= 0) {
            state[item.file] = { lines: lines.length, size: item.size, at: Date.now() }
            continue
          }
          start = Math.max(0, lines.length - n)
        }
        if (start >= lines.length) {
          state[item.file] = { lines: lines.length, size: item.size, at: Date.now() }
          continue
        }

        for (const raw of lines.slice(start)) {
          let ev
          try {
            ev = JSON.parse(raw)
          } catch {
            continue
          }
          const ent = entryOf(ev)
          if (!ent) continue
          const text = ent.text.replace(/\s+/g, ' ').trim()
          if (text.length < 2 || isNoise(text)) continue
          const key = `${ent.who}:${text.slice(0, 60)}`
          if (seen.has(key)) continue
          seen.add(key)
          const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
          collected.push({ who: ent.who, text: clipped, at: ent.at })
          if (cfg.dryRunMode) {
            api.log.info(`[干跑] ${ent.who === 'user' ? '主人' : '鱼'}：${clipped.slice(0, 70)}`)
            continue
          }
          try {
            await memory.noteVia({ via: cfg.via || 'dsh', qq: ownerQQ, who: ent.who, text: clipped, at: ent.at })
            wrote++
          } catch (e) {
            api.log.warn('写记忆失败：', e?.message || e)
          }
        }
        state[item.file] = { lines: lines.length, size: item.size, at: Date.now() }
      }
      saveState(state)
      pushWindow(collected)
      if (cfg.dryRunMode) api.log.info(`[干跑] 这轮扫了 ${files.length} 个会话，跳过她自己的 ${skipped} 个`)
      else if (wrote) api.log.info(`把 ${wrote} 条 DSH 对话写进记忆`)
    }

    api.every(Math.max(30, Number(api.settings().intervalSec) || 120) * 1000, async () => {
      try {
        await tick()
      } catch (e) {
        api.log.warn('这轮出错：', e?.message || e)
      }
    }, 'dsh-memory-bridge')

    api.later(8000, () => tick().catch((e) => api.log.warn('首轮出错：', e?.message || e)))

    api.command({
      name: 'dsh记忆',
      desc: '立刻扫一遍 DSH 会话（干跑时只打日志）',
      run: async () => {
        await tick()
        return api.settings().dryRunMode ? '扫完了，现在是干跑，只打日志没写记忆' : '扫完了，已经写进记忆'
      },
    })

    // 每轮把「最近几句」塞进她看到的内容里：只给主人私聊和抖音私信回合（群里不塞，省 token 也省隐私）
    api.on('prompt', (content, info) => {
      try {
        if (!Array.isArray(content)) return content
        if (!api.settings().inject) return content
        const chat = info?.chat || {}
        const ownerQQ = String(api.config()?.ownerQQ || '')
        const isOwnerPrivate = chat.kind === 'private' && String(chat.userId || '') === ownerQQ
        const isDouyinDm = chat.kind === 'system' && /^system:douyin-dm/.test(String(chat.chatId || ''))
        if (!isOwnerPrivate && !isDouyinDm) return content
        const text = buildInjection()
        if (!text) return content
        api.log.info(`注入工作记忆 ${text.length} 字（${isDouyinDm ? '抖音私信' : 'QQ 私聊'}）`)
        return [{ type: 'text', text }, ...content]
      } catch (e) {
        api.log.warn('注入工作记忆失败：', e?.message || e)
        return content
      }
    })

    api.route('/window', async () => ({ ok: true, text: buildInjection(), total: (loadWindow().all || []).length }))
    // 决定簿：GET 看、POST { key, text, until } 写（同 key 覆盖；until 是毫秒时间戳或 ISO 字符串，空=不过期）
    api.route('/facts', async (req) => {
      if (req.method === 'GET') return { ok: true, items: loadFacts() }
      const b = await api.core.http.body(req).catch(() => ({}))
      const text = String(b?.text || '').trim()
      if (!text) return { ok: false, message: 'text 要给我' }
      const key = String(b?.key || text.slice(0, 20))
      let until = 0
      if (b?.until) {
        const n = typeof b.until === 'number' ? b.until : Date.parse(String(b.until))
        until = Number.isFinite(n) ? n : 0
      }
      const items = loadFacts().filter((f) => f && f.key !== key)
      items.push({ key, text, until, at: Date.now() })
      saveFacts(items)
      return { ok: true, items }
    })
    api.route('/tick', async () => { await tick(); return { ok: true, total: (loadWindow().all || []).length } })
    api.route('/window/clear', async () => { saveWindow({ all: [] }); return { ok: true } })
    // 一次性把最近几个会话的尾巴灌进工作记忆（刚合并过来、或者想立刻有上下文时用）
    api.route('/window/backfill', async (req) => {
      const n = Math.max(4, Math.min(80, Number((await api.core.http.body(req).catch(() => ({})))?.n) || 30))
      const files = listSessionFiles().slice(-3)
      const got = []
      for (const item of files) {
        const lines = readLines(item.file)
        const cwd = (() => { try { return JSON.parse(lines[0] || '{}').cwd || '' } catch { return '' } })()
        if (BOT_WORKSPACE.test(item.file) || /aurobot|qq-chats/i.test(item.file) || /qq-chats/i.test(cwd)) continue
        const ents = []
        for (const raw of lines) {
          try { const e = entryOf(JSON.parse(raw)); if (e && !isNoise(e.text)) ents.push(e) } catch { /* 半行 */ }
        }
        got.push(...ents.slice(-n))
      }
      got.sort((a, b) => a.at - b.at)
      pushWindow(got.map((e) => ({ who: e.who, text: e.text.replace(/\s+/g, ' ').trim().slice(0, 400), at: e.at })))
      return { ok: true, added: got.length, total: (loadWindow().all || []).length }
    })

    api.log.info(`已启动（${api.settings().dryRunMode ? '干跑' : '正式写'}，每 ${api.settings().intervalSec} 秒看一次）`)

    // 给别的模块用：抖音私信那几轮不经过 QQ 的 prompt 钩子，由 douyin 模块自己把这段塞进提示词
    return { windowText: () => buildInjection(), memoryWritten: () => ((loadState().offsets && true) || false) }
  },
}
