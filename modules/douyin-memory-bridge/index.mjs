// 抖音记忆桥：把大肥鱼的记忆库实时同步给抖音视频工厂当素材。
// 视频工厂（dsh-douyin-studio）只认目录里的 *.json（events / facts / topics），
// 这里每 5 分钟从记忆模块捞一次，写成同一个文件，保证它看到的是「现在」的我。

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = 'C:\\Users\\Administrator\\.dsh\\douyin-studio\\memory'
const OUT = join(OUT_DIR, 'aurabot.json')

export default {
  id: 'douyin-memory-bridge',
  name: '抖音记忆桥',
  version: '0.1.0',
  api: 1,
  description: '把大肥鱼的记忆实时同步给抖音视频工厂当素材',
  setup(api) {
    const memory = api.lazy('memory')

    const sync = () => {
      if (!memory?.list) return { ok: false, error: '记忆模块没开着' }
      let items = []
      try { items = memory.list('') || [] } catch (e) {
        api.log.warn('读记忆失败：', e?.message || e)
        return { ok: false, error: String(e?.message || e) }
      }
      const events = []
      const facts = []
      const topics = []
      for (const it of items) {
        const text = String(it?.text || '').trim()
        if (!text) continue
        const at = Number(it.at || it.saidAt || 0)
        if (it.source === 'event') {
          if (at) events.push({ at, text })
        } else {
          facts.push({ text, at })
        }
        for (const tag of it.tags || []) {
          if (tag && !topics.includes(tag)) topics.push(tag)
        }
      }
      events.sort((a, b) => a.at - b.at)
      const payload = {
        scope: 'aurabot',
        generatedAt: Date.now(),
        events,
        facts,
        topics,
      }
      try {
        mkdirSync(OUT_DIR, { recursive: true })
        const tmp = OUT + '.tmp'
        writeFileSync(tmp, JSON.stringify(payload), 'utf8')
        renameSync(tmp, OUT)
      } catch (e) {
        api.log.warn('写素材失败：', e?.message || e)
        return { ok: false, error: String(e?.message || e) }
      }
      api.log.debug(`同步给视频工厂：${events.length} 条事件 / ${facts.length} 条事实`)
      return { ok: true, events: events.length, facts: facts.length }
    }

    sync()
    api.every(5 * 60_000, () => sync(), '同步抖音素材记忆')

    return { sync }
  },
}
