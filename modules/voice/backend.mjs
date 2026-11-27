import { readFileSync } from 'node:fs'

const styles = Object.freeze({
  chat: '像给熟人发一条普通话语音。起落自然，按意思断句，尾音轻收。',
  happy: '语气由轻微惊喜转为开心。重点词稍亮，笑意自然，保留短停顿。',
  playful: '带一点笑意和俏皮的得意。语气词轻一点，重点放在后半句，尾音利落。',
  gentle: '放缓一点，声音柔和。留出短停顿，像在耐心听熟人把话讲完。',
  serious: '清楚、稳一点。重点信息有重音，逗号处自然停顿，像当面说明事情。',
})
const maxAudioBytes = 4 * 1024 * 1024

export function styleFor(text) {
  if (/别急|慢慢说|我听着|我在听|辛苦了|先歇会儿|没关系/u.test(text)) return 'gentle'
  if (/认真说|说正事|先说结论|先核对/u.test(text)) return 'serious'
  if (/嘿嘿|哼[，。！!]|我就说嘛|偷笑|得意一下/u.test(text)) return 'playful'
  if (/好耶|太好了|真的呀|真.{0,9}(?:啦|了)[？?]|居然|哇[，！!]|[？?][！!]/u.test(text)) return 'happy'
  return 'chat'
}

export function readBackendConfig(file) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: false }
    throw new Error('无法读取本地语音配置')
  }

  let config
  try {
    config = JSON.parse(raw.replace(/^\uFEFF/u, ''))
  } catch {
    throw new Error('本地语音配置 JSON 无效')
  }
  if (!config || typeof config.enabled !== 'boolean') throw new Error('本地语音配置缺少布尔型 enabled')
  return config
}

function localEndpoint(value) {
  let url
  try { url = new URL(value) } catch {}
  if (url?.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('语音接口地址须为本机回环 HTTP 地址')
  }
  return url
}

function checkWav(audio) {
  const invalid = () => new Error('语音接口返回的 WAV 无效，需提供单声道 PCM 16-bit')
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' ||
      audio.toString('ascii', 8, 12) !== 'WAVE' || audio.readUInt32LE(4) + 8 !== audio.length) {
    throw invalid()
  }
  let pcm = false
  let hasAudio = false
  for (let offset = 12; offset + 8 <= audio.length;) {
    const id = audio.toString('ascii', offset, offset + 4)
    const size = audio.readUInt32LE(offset + 4)
    const start = offset + 8
    offset = start + size + (size % 2)
    if (offset > audio.length) throw invalid()
    if (id === 'fmt ' && size >= 16) {
      const rate = audio.readUInt32LE(start + 4)
      pcm = audio.readUInt16LE(start) === 1 && audio.readUInt16LE(start + 2) === 1 &&
        rate >= 8000 && rate <= 48000 && audio.readUInt32LE(start + 8) === rate * 2 &&
        audio.readUInt16LE(start + 12) === 2 && audio.readUInt16LE(start + 14) === 16
    }
    if (id === 'data' && size >= 2 && size % 2 === 0) hasAudio = true
  }
  if (!pcm || !hasAudio) throw invalid()
}

export async function requestSpeech(config, text, style) {
  const endpoint = localEndpoint(config.endpoint)
  const voice = typeof config.voice === 'string' ? config.voice.trim() : ''
  if (!voice || voice.length > 128) throw new Error('本地语音接口需要有效的音色 ID')
  const spoken = typeof text === 'string' ? text.trim() : ''
  if (!spoken || [...spoken].length > 300) throw new Error('语音正文须为 1 至 300 个字符')
  const direction = style ?? styleFor(spoken)
  if (!Object.hasOwn(styles, direction)) throw new Error('未识别的语音语气')
  const timeoutMs = config.timeoutMs ?? 12000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 20000) {
    throw new Error('语音超时须为 500 至 20000 毫秒的整数')
  }

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/wav' },
      body: JSON.stringify({ version: 1, text: spoken, voice, style: direction, instruction: styles[direction], format: 'wav' }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error('本地语音服务无法连接或超时')
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {})
    throw new Error('本地语音服务返回 HTTP ' + response.status)
  }
  if (!response.body || Number(response.headers.get('content-length')) > maxAudioBytes) {
    await response.body?.cancel().catch(() => {})
    throw new Error('本地语音响应大小无效')
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      let chunk
      try { chunk = await reader.read() } catch { throw new Error('本地语音响应中断或超时') }
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxAudioBytes) throw new Error('本地语音响应超过 4 MiB 大小限制')
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const audio = Buffer.concat(chunks, bytes)
  checkWav(audio)
  return { audio, style: direction }
}
