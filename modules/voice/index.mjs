import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readBackendConfig } from './backend.mjs'
import { synthesize, synthesizeBuffer } from './clone.mjs'

const dayMs = 24 * 60 * 60 * 1000
const spokenRule = [
  '要发 QQ 语音时，用原生 <voice>台词</voice>。语音里只写真正会说出口的话。',
  '先接住对方明显的情绪，再回答事情。一两句自然短句通常就够，长步骤、代码和表格留在文字里。',
  '平常像给熟人发语音，开心时可以有一声惊喜，得意时可以轻轻嘿嘿一下，安慰时慢一点。',
  '靠台词和标点给出节奏。省去括号里的表演说明和情绪标签。保留事实、数字和限制，别为了俏皮把意思改了。',
  '不到四个字的回话（单个字母、单个语气词之类）别用语音，直接打字——太短没有上下文，声音会飘。',
].join('\n')
const groupSpokenRule = [
  '群里也能发 QQ 语音：要发时用原生 <voice>台词</voice>，一段一两句就好。',
  '群里人多，语音少用——被点名要语音、或者情绪真的上来了才发一小段，别连着发、别每句都念。',
  '不到四个字的回话别用语音（单个字母、单个语气词之类），直接打字，太短的声音会飘。',
].join('\n')

async function clearExpired(cache, before) {
  for (const entry of await readdir(cache, { withFileTypes: true })) {
    if (!entry.isFile() || !/^speech-[a-f0-9-]{36}\.wav$/u.test(entry.name)) continue
    const file = join(cache, entry.name)
    try {
      if ((await stat(file)).mtimeMs < before) await unlink(file)
    } catch {
      // Another request may have cleared the same expired file.
    }
  }
}

export default {
  id: 'voice',
  name: '语音',
  version: '1.1.0',
  api: 1,
  tab: 'voice',
  description: '复用原生语音和识别面板，支持本机音色克隆（Breeze TTS 2）。',
  async setup(api) {
    const configPath = api.dataDir('backend.json')
    const cache = api.dataDir('backend-cache')
    const engine = 'breeze-clone'
    let cleanupAfter = 0
    const native = await api.lib('modules/voice/index.js').default.setup({
      ...api,
      route(path, handler) {
        if (path !== '/voice/test') return api.route(path, handler)
        return api.route(path, async (req, res) => {
          const config = readBackendConfig(configPath)
          if (!config.enabled) return handler(req, res)
          const body = await api.core.http.body(req)
          const { buffer } = await synthesizeBuffer(config, body?.text || '你好呀，我是大肥鱼。', {
            cacheDir: join(cache, 'tmp'),
          })
          return { ok: true, engine, mime: 'audio/wav', data: buffer.toString('base64') }
        })
      },
    })

    api.rule((kind, config) => {
      if (config?.voice?.enabled === false) return ''
      try {
        if (!readBackendConfig(configPath).enabled) return ''
      } catch { return '' }
      return kind === 'private' ? spokenRule : kind === 'social' ? groupSpokenRule : ''
    })
    api.log.info('本地克隆语音接口已加载')

    return {
      ...native,
      async speak(text) {
        const config = readBackendConfig(configPath)
        if (!config.enabled) return native.speak(text)
        try {
          const cacheDir = config.cacheDir || cache
          const result = await synthesize(config, text, { cacheDir })
          // 发出前自检：音色指纹离基准多远、音高偏多少
          const id = result.identity
          if (id) {
            const line = `语音自检：音色距离 ${id.specDist}，音高偏差 ${id.semis} 半音${id.eq ? '，已做频谱对齐' : ''}`
            if (id.ok) api.log.debug?.(line)
            else api.log.warn(`语音自检没过（仍按原样发）：${line}`)
          }
          await mkdir(cache, { recursive: true })
          const now = Date.now()
          if (now >= cleanupAfter) {
            cleanupAfter = now + 60 * 60 * 1000
            await clearExpired(cache, now - dayMs).catch(() => {})
          }
          const file = join(cache, 'speech-' + randomUUID() + '.wav')
          await writeFile(file, await readFile(result.file))
          await unlink(result.file).catch(() => {})
          return { file, engine }
        } catch (error) {
          const msg = error?.message || String(error)
          // 音色自检没过（且主人没明确要语音）：别拿另一把嗓子顶，直接抛出去让 AuraBot 改发文字
          if (msg.includes('音色自检没过')) {
            api.log.warn?.('语音自检没过，这条改发文字：' + msg)
            throw error
          }
          api.log.warn?.('克隆语音失败，改用原生语音：' + msg)
          return native.speak(text)
        }
      },
    }
  },
}
