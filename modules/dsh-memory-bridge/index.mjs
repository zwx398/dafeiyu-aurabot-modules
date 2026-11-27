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
 * 坑：DSH 宿主（Electron）的 zlib.zstdDecompressSync 只解第一帧，而会话文件是多次追加的多帧 zstd，
 * 解出来只有 session 头那一行。所以默认用外部 node（v24.22 能一次解完）跑一段小脚本；
 * 外部 node 不在时退回内置解压（可能只有一行，等于这个文件先跳过）。
 */
function readLines(file, nodePath) {
  const script = `
const fs=require('node:fs'),z=require('node:zlib')
const b=z.zstdDecompressSync(fs.readFileSync(process.argv[1]))
process.stdout.write(b)
`
  if (nodePath && fs.existsSync(nodePath)) {
    const out = execFileSync(nodePath, ['-e', script, '--', file], { maxBuffer: 256 * 1024 * 1024 })
    return out.toString('utf8').split(/\r?\n/).filter(Boolean)
  }
  const buf = zlib.zstdDecompressSync(fs.readFileSync(file))
  return buf.toString('utf8').split(/\r?\n/).filter(Boolean)
}

export default {
  id: 'dsh-memory-bridge',
  name: 'DSH 记忆桥',
  api: 1,
  version: '0.2.0',
  description: '把 DSH 客户端里的对话写进同一份记忆（和 QQ、抖音共用一条鱼）',
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
  },
  settings: [
    { key: 'enabled', label: '启用', type: 'switch' },
    { key: 'dryRunMode', label: '干跑（只打日志不写记忆）', type: 'switch' },
    { key: 'intervalSec', label: '多久看一次（秒）', type: 'number', min: 30, max: 3600, step: 30 },
    { key: 'nodePath', label: '解压用的 node.exe', type: 'text' },
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
      let seen = new Set()

      for (const item of files) {
        const prev = state[item.file]
        let lines
        try {
          lines = readLines(item.file, cfg.nodePath)
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

    api.log.info(`已启动（${api.settings().dryRunMode ? '干跑' : '正式写'}，每 ${api.settings().intervalSec} 秒看一次）`)
  },
}
