// 用本机 Breeze TTS 2 合成大肥鱼的声音（音色 tt_feiyu3）。
// 目标：任何一句话念出来都像人，而不是靠给某几句打补丁。
//
// 三层：
//   1) 情绪从哪来 —— 先看调用方指定，再看 AuraBot 的心情值（mood.json），最后才看这句话本身。
//   2) 念成什么样 —— 每档语气 = 一句固定嗓子说明 + 几个字的说法 + 一个声音事件标签。
//   3) 挑哪一条 —— 生成 N 条，用「像不像人」的统一分数挑：语速、停顿、音高起伏、能量起伏、浊音干净度。
//      分数只看这五件事，跟具体是哪句话无关，所以换句话一样适用。
import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, unlink } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { styleFor } from './backend.mjs'
import { resolveVoicePaths } from './paths.mjs'

// 克隆音色的底座：只写「怎么说」，绝不写「声音长什么样」。
// 引擎文档说 instruction 在克隆场景是「delivery direction」；一旦写进「音调偏高」这种音色描述，
// 引导会把克隆出来的声线往描述上拽——这就是换声的根本原因。
const VOICE_BASE = '像给熟人发语音，自然一点。'

// 五档：说法只加几个字（长指令会把声音带沙），标签靠 cfg 2.1+ 才真触发。
export const STYLES = {
  chat: { label: '日常接话', tail: '', tag: '', cfgScale: 1.9, rate: 0.3 },
  playful: { label: '得意玩笑', tail: '带点笑。', tag: '(轻笑) ', cfgScale: 2.1, rate: 0.27 },
  happy: { label: '惊喜分享', tail: '轻快些。', tag: '(轻笑) ', cfgScale: 2.1, rate: 0.27 },
  gentle: { label: '安慰倾听', tail: '慢一点，柔一点。', tag: '(放低声音) ', cfgScale: 2.0, rate: 0.38 },
  serious: { label: '认真交代', tail: '稳一点。', tag: '', cfgScale: 1.9, rate: 0.33 },
}

// 路径自动探测：配置里给的 > 环境变量 > 自动找（见 paths.mjs）。换机器不用改代码。
const PATHS = resolveVoicePaths()

const DEFAULTS = {
  cli: PATHS.cli,
  model: PATHS.model,
  voicesDir: PATHS.voicesDir,
  ffmpeg: PATHS.ffmpeg,
  moodPath: PATHS.moodPath,
  baselinePath: PATHS.baselinePath,
  chatlogPath: PATHS.chatlogPath,
  voice: 'tt_feiyu3',
  seed: 42,
  takes: 3,
  gpuIndex: '0',
  timeoutMs: 60000,
  maxChars: 300,
}

let chain = Promise.resolve()
function serialize(task) {
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}

function run(cmd, args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...env } })
    let out = ''
    const take = (d) => { out += String(d); if (out.length > 8000) out = out.slice(-8000) }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const timer = setTimeout(() => { try { child.kill() } catch { /* 超时杀掉 */ } }, timeoutMs)
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, out: out + String(e?.message ?? e) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, out }) })
  })
}

/** 读心情：0~100，读不到就当中性 70。 */
export function readMood(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
    const v = Number(j?.value)
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 70
  } catch {
    return 70
  }
}

/**
 * 上下文：看最近几条主人说的话，给一个 0~100 的「当下气氛」。
 * 不是拿关键词改声学，只是让心情值和当下气氛一起决定语气档。
 */
export function readContext(path, maxLines = 4) {
  try {
    let file = String(path || '')
    if (!file) return 50
    if (!/\.jsonl$/i.test(file)) {
      const dir = file
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
      if (!files.length) return 50
      file = join(dir, files[files.length - 1])
    }
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-40)
    const recent = []
    for (const line of lines) {
      try {
        const j = JSON.parse(line)
        if (j.who && j.who !== 'bot' && j.text) recent.push(String(j.text))
      } catch { /* 跳过坏行 */ }
    }
    const tail = recent.slice(-maxLines).join(' ')
    if (!tail) return 50
    let score = 0
    score += (tail.match(/(哈哈|嘿嘿|笑死|好耶|喜欢|可爱|乖|厉害|开心|谢谢)/g) || []).length
    score -= (tail.match(/(难过|烦|累|生气|滚|难受|不开心|别烦)/g) || []).length
    score += (tail.match(/[！!]{1,}/g) || []).length * 0.5
    return Math.max(0, Math.min(100, 50 + score * 12))
  } catch {
    return 50
  }
}

/** 语气档：句子本身 + 心情值 + 当下气氛。心情高走活泼可爱，平稳走温柔，低落更软。 */
export function chooseStyle(text, explicit, mood = 70) {
  const want = String(explicit || '').trim()
  if (want && Object.hasOwn(STYLES, want)) return want
  const fromText = styleFor(String(text || ''))
  if (fromText === 'serious') return 'serious'
  if (fromText === 'gentle') return 'gentle'
  if (fromText === 'playful' || fromText === 'happy') return fromText
  return mood < 45 ? 'gentle' : 'chat'
}

/** 心情对语速的影响：心情好略快，心情差略慢，最多 ±12%。 */
export function moodRateFactor(mood = 70) {
  const m = Math.max(0, Math.min(100, Number(mood) || 70))
  return 1 + (55 - m) / 55 * 0.12
}

export function instructionFor(style, extra = '') {
  const s = STYLES[style] || STYLES.chat
  return `${VOICE_BASE}${s.tail}${String(extra || '').trim()}`
}

/** 读 WAV（16-bit PCM）→ 12k 单声道。降采样用平均（抗混叠），直接抽点会让基频测歪。 */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null
  let off = 12
  let fmt = null
  let data = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const start = off + 8
    if (id === 'fmt ') fmt = start
    if (id === 'data') { data = { start, size }; break }
    off = start + size + (size % 2)
  }
  if (!fmt || !data) return null
  const channels = buf.readUInt16LE(fmt + 2)
  const rate = buf.readUInt32LE(fmt + 4)
  if (buf.readUInt16LE(fmt) !== 1 || buf.readUInt16LE(fmt + 14) !== 16) return null
  const frames = Math.floor(Math.min(data.size, buf.length - data.start) / (2 * channels))
  const step = Math.max(1, Math.round(rate / 12000))
  const out = []
  for (let i = 0; i + step <= frames; i += step) {
    let acc = 0
    for (let k = 0; k < step; k++) {
      for (let c = 0; c < channels; c++) acc += buf.readInt16LE(data.start + ((i + k) * channels + c) * 2)
    }
    out.push(acc / (step * channels) / 32768)
  }
  return { samples: Float32Array.from(out), rate: rate / step }
}

/** 一帧一帧看：浊音干净度、基频、能量、停顿。 */
function analyze(buf) {
  const w = readWav(buf)
  if (!w) return { f0: 0, clean: 0, f0sd: 0, edyn: 0, pauses: 0, lead: 0, tail: 0, dur: 0 }
  const { samples, rate } = w
  const win = Math.round(rate * 0.04)
  const hop = Math.round(win / 2)
  const minLag = Math.max(2, Math.floor(rate / 500))
  const maxLag = Math.ceil(rate / 70)
  const voiced = []
  const energies = []
  const f0s = []
  for (let i = 0; i + win + maxLag < samples.length; i += hop) {
    let energy = 0
    for (let k = 0; k < win; k++) energy += samples[i + k] * samples[i + k]
    const rms = Math.sqrt(energy / win)
    energies.push({ t: i / rate, rms })
    if (rms < 0.02) continue
    let bestAcc = 0
    let bestLag = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0
      for (let k = 0; k < win; k++) acc += samples[i + k] * samples[i + k + lag]
      if (acc > bestAcc) { bestAcc = acc; bestLag = lag }
    }
    const periodicity = bestAcc / energy
    voiced.push(periodicity)
    // 只有真的像人声（周期性强）的帧才拿来算基频，噪声帧会把中位数拉歪
    if (bestLag && periodicity > 0.45) f0s.push(rate / bestLag)
  }
  const dur = samples.length / rate
  // 停顿：中间那些 0.12~1.5 秒的静音段
  let pauses = 0
  let run = 0
  let firstVoice = -1
  let lastVoice = -1
  for (const e of energies) {
    const silent = e.rms < 0.02
    if (!silent) {
      if (firstVoice < 0) firstVoice = e.t
      lastVoice = e.t
      if (run * 0.02 >= 0.12 && run * 0.02 <= 1.5) pauses += 1
    }
    run = silent ? run + 1 : 0
  }
  const sorted = [...f0s].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  let v = 0
  for (const f of f0s) v += Math.pow(12 * Math.log2(f / median), 2)
  const logs = energies.filter((e) => e.rms > 0.02).map((e) => Math.log(e.rms + 1e-9))
  const mean = logs.reduce((a, b) => a + b, 0) / (logs.length || 1)
  const edyn = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length || 1))
  return {
    f0: median,
    clean: voiced.length ? voiced.reduce((a, b) => a + b, 0) / voiced.length : 0,
    f0sd: f0s.length ? Math.sqrt(v / f0s.length) : 0,
    edyn,
    pauses,
    lead: firstVoice > 0 ? firstVoice : 0,
    tail: lastVoice > 0 ? Math.max(0, dur - lastVoice) : 0,
    dur,
    profile: spectralProfile(samples, rate),
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))

/**
 * 音色指纹：18 个对数间隔频率点上的能量分布（Goertzel 逐个算，不引第三方库）。
 * 只用来比「这条 take 的音色离基准有多远」——短句最容易在这里跑偏。
 */
const PROFILE_FREQS = Array.from({ length: 18 }, (_, i) => 150 * Math.pow(6000 / 150, i / 17))

function spectralProfile(samples, rate) {
  const win = Math.round(rate * 0.03)
  const hop = Math.round(win)
  const acc = new Float64Array(PROFILE_FREQS.length)
  let frames = 0
  for (let start = 0; start + win <= samples.length; start += hop) {
    let energy = 0
    for (let k = 0; k < win; k++) energy += samples[start + k] * samples[start + k]
    if (energy / win < 4e-4) continue
    for (let fi = 0; fi < PROFILE_FREQS.length; fi++) {
      const w = 2 * Math.PI * PROFILE_FREQS[fi] / rate
      const coeff = 2 * Math.cos(w)
      let s0 = 0
      let s1 = 0
      let s2 = 0
      for (let k = 0; k < win; k++) {
        s0 = samples[start + k] + coeff * s1 - s2
        s2 = s1
        s1 = s0
      }
      acc[fi] += s1 * s1 + s2 * s2 - coeff * s1 * s2
    }
    frames++
  }
  if (!frames) return null
  const logProfile = Array.from(acc, (v) => Math.log(v / frames + 1e-12))
  const mean = logProfile.reduce((a, b) => a + b, 0) / logProfile.length
  return logProfile.map((v) => v - mean) // 去掉整体响度，只比形状
}

/** 两个音色指纹的平均绝对差（越小越像）。 */
function profileDistance(a, b) {
  if (!a || !b) return 1
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

// 频谱匹配用的频段中心（对数均匀，和人耳对音色的敏感区对齐）
const BAND_FREQS = [200, 300, 450, 650, 950, 1400, 2000, 2900, 4200, 5500]

/**
 * 频谱对齐：把这条 take 的长时频段能量往基准拉（每段最多 ±6dB）。
 * 这是「音色差一点」的兜底修法 —— 不改音高、不改语速，只调频段配比。
 */
async function matchSpectrum(cfg, file, takeProfile, baseProfile) {
  if (!cfg.ffmpeg || !takeProfile || !baseProfile) return null
  const n = PROFILE_FREQS.length - 1
  const gainAt = (freq) => {
    const t = Math.log(freq / PROFILE_FREQS[0]) / Math.log(PROFILE_FREQS[n] / PROFILE_FREQS[0])
    const pos = Math.max(0, Math.min(n, t * n))
    const i = Math.floor(pos)
    const j = Math.min(i + 1, n)
    const frac = pos - i
    const base = baseProfile[i] + (baseProfile[j] - baseProfile[i]) * frac
    const take = takeProfile[i] + (takeProfile[j] - takeProfile[i]) * frac
    return (base - take) * 4.343 // 自然对数 → dB
  }
  const filters = BAND_FREQS
    .map((f) => `equalizer=f=${f}:t=q:w=1.2:g=${Math.max(-6, Math.min(6, gainAt(f))).toFixed(1)}`)
    .join(',')
  const out = file.replace(/\.wav$/i, '-eq.wav')
  const r = await run(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-filter:a', filters, '-ar', '24000', '-ac', '1', out], {}, 30000)
  return r.ok ? out : null
}

/**
 * 声线基准：拿「已经认可的那条样音」用同一套算法量一次基频当基准。
 * 关键在「同一套算法」——估基频的代码自己有系统性偏差，两边都偏就抵消了，
 * 直接用绝对数字（238Hz）反而会被这个偏差带偏。
 */
const baselineCache = new Map()
function baselineInfo(cfg) {
  const p = String(cfg?.baselinePath || DEFAULTS.baselinePath || '')
  if (!p) return { f0: 238, profile: null }
  const cached = baselineCache.get(p)
  if (cached) return cached
  let f0 = 238
  let profile = null
  try {
    const a = analyze(readFileSync(p))
    if (a.f0 > 0) f0 = a.f0
    profile = a.profile
  } catch { /* 读不到就用默认 */ }
  const info = { f0, profile }
  baselineCache.set(p, info)
  return info
}

/**
 * 「像不像人」的分：五项都不是针对某句话的规则，任何台词都适用。
 *   语速贴不贴目标、停顿有没有、音高有没有起伏、能量有没有起伏、浊音干不干净、首尾别拖静音。
 */
function naturalness(buf, chars, targetRate, targetF0 = 238, baseProfile = null) {
  const a = analyze(buf)
  const expected = Math.max(1.2, chars * (targetRate || 0.3))
  const ratio = expected > 0 ? a.dur / expected : 1
  const rateTerm = clamp01(1 - Math.abs(Math.log(ratio)) / 0.55)
  // 人说话的音高起伏大约 2~6 个半音，太平像念稿，太飘像唱
  const pitchTerm = a.f0sd < 2.5 ? clamp01(a.f0sd / 2.5) * 0.8 : a.f0sd <= 6 ? 1 : clamp01(1 - (a.f0sd - 6) / 6)
  const energyTerm = clamp01(1 - Math.abs(a.edyn - 0.55) / 0.45)
  const cleanTerm = clamp01((a.clean - 0.7) / 0.25)
  const needPause = chars >= 12 ? 1 : 0.4
  const pauseTerm = needPause ? clamp01(a.pauses / needPause) : 1
  const edgeTerm = clamp01(1 - Math.max(0, a.lead - 0.35) / 0.6 - Math.max(0, a.tail - 0.5) / 0.6)
  // 声线一致性：基频离基准越远扣得越多，尽量别指望事后拉
  const semis = a.f0 > 0 ? Math.abs(12 * Math.log2(a.f0 / targetF0)) : 3
  const idTerm = clamp01(1 - semis / 2)
  // 音色一致性：短句最容易在这里跑偏，所以单独占一项
  const specDist = baseProfile ? profileDistance(a.profile, baseProfile) : 0.3
  const specTerm = clamp01(1 - specDist / 1.5)
  const score = rateTerm * 0.18 + pitchTerm * 0.15 + energyTerm * 0.12 + cleanTerm * 0.12 + pauseTerm * 0.08 + edgeTerm * 0.05 + idTerm * 0.14 + specTerm * 0.16
  return { ...a, ratio, score, specDist, parts: { rateTerm, pitchTerm, energyTerm, cleanTerm, pauseTerm, edgeTerm, idTerm, specTerm } }
}

async function synthesizeOnce(config, text, opts = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}), ...(opts || {}) }
  const body = String(text || '').trim().slice(0, cfg.maxChars)
  if (!body) throw new Error('没有要念的文字')

  return serialize(async () => {
    const cacheDir = cfg.cacheDir || join(process.env.TEMP || '.', 'dafeiyu-voice')
    await mkdir(cacheDir, { recursive: true })

    const mood = readMood(cfg.moodPath || DEFAULTS.moodPath)
    const ambience = readContext(cfg.chatlogPath || DEFAULTS.chatlogPath)
    const feel = mood * 0.9 + ambience * 0.1
    const style = chooseStyle(body, opts.style || cfg.style, mood)
    const preset = STYLES[style] || STYLES.chat
    const tag = String(opts.tag ?? preset.tag ?? '')
    const engineText = tag ? tag + body : body
    const instruction = instructionFor(style, opts.instruction)
    let cfgScale = Number(opts.cfgScale ?? cfg.cfgScale ?? preset.cfgScale)
    if (tag && cfgScale < 2.1) cfgScale = 2.1
    const targetRate = Number(opts.rate ?? preset.rate) * moodRateFactor(feel)
    const baseInfo = baselineInfo(cfg)
    const voiceF0 = Math.round(baseInfo.f0 * 10) / 10
    const baseProfile = baseInfo.profile
    const chars = [...body].length
    // 短句没有上下文可锚，容易跑音色；多生成几条再挑
    const wantTakes = chars <= 6 ? 5 : (Number(opts.takes ?? cfg.takes) || 3)
    const takes = Math.max(1, Math.min(5, wantTakes))
    const baseSeed = Number(opts.seed ?? cfg.seed ?? 42)

    const candidates = []
    for (let t = 0; t < takes; t++) {
      const file = join(cacheDir, `clone-${randomUUID()}.wav`)
      const args = [
        cfg.model, '--text', engineText, '--output', file,
        '--voice', cfg.voice, '--voices-dir', cfg.voicesDir,
        '--instruction', instruction,
        '--cfg-scale', String(Number.isFinite(cfgScale) ? cfgScale : 1.9),
        '--seed', String(baseSeed + t * 7),
      ]
      const r = await run(cfg.cli, args, { GGML_VK_VISIBLE_DEVICES: String(cfg.gpuIndex ?? '0') }, Number(cfg.timeoutMs) || 60000)
      if (!r.ok) {
        if (!candidates.length) throw new Error(`breeze 合成失败（exit ${r.code}）：${r.out.split('\n').slice(-2).join(' ').slice(-200)}`)
        continue
      }
      const info = await stat(file)
      if (!info.size) continue
      // 先掐掉首尾静音，再打分——不然「前面拖了半秒」也会被当成优点
      let useFile = file
      if (cfg.ffmpeg) {
        const trimmed = file.replace(/\.wav$/i, '-trim.wav')
        const tr = await run(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-filter:a',
          'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.12:start_threshold=-45dB,areverse',
          '-ar', '24000', '-ac', '1', trimmed], {}, 30000)
        if (tr.ok) {
          await unlink(file).catch(() => {})
          useFile = trimmed
        }
      }
      const useInfo = await stat(useFile)
      const buf = await readFile(useFile)
      const nat = naturalness(buf, chars, targetRate, voiceF0, baseProfile)
      candidates.push({ file: useFile, nat, bytes: useInfo.size })
    }
    if (!candidates.length) throw new Error('breeze 没写出音频文件')
    candidates.sort((a, b) => b.nat.score - a.nat.score)
    let best = candidates[0]
    for (const c of candidates.slice(1)) await unlink(c.file).catch(() => {})

    // 后处理：首尾静音每条候选都掐过了，这里只在语速明显偏的时候小幅校正（不改音高）
    const tempo = Math.min(1.15, Math.max(0.88, best.nat.ratio))
    let finalFile = best.file
    let seconds = Math.round(best.nat.dur * 100) / 100
    if (cfg.ffmpeg && Math.abs(best.nat.ratio - 1) > 0.1) {
      const stretched = best.file.replace(/\.wav$/i, '-post.wav')
      const chainFilter = `atempo=${tempo.toFixed(3)}`
      const r = await run(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', best.file, '-filter:a', chainFilter, '-ar', '24000', '-ac', '1', stretched], {}, 30000)
      if (r.ok) {
        await unlink(best.file).catch(() => {})
        finalFile = stretched
        const info = await stat(stretched)
        seconds = Math.round(((info.size - 44) / 2 / 24000) * 100) / 100
      } else {
        await unlink(stretched).catch(() => {})
      }
    }

    // 声线锁：不管刚才那句用什么语气，最后都把音高钉回这条嗓子的基准（默认 238Hz，±1.2 半音内不干预）
    let pitchShift = 1
    let f0 = 0
    if (cfg.ffmpeg) {
      const a = analyze(await readFile(finalFile))
      f0 = Math.round(a.f0 * 10) / 10
      const targetF0 = voiceF0
      if (a.f0 > 0) {
        const semis = 12 * Math.log2(a.f0 / targetF0)
        if (Math.abs(semis) > 0.35) {
          const factor = Math.min(1.2, Math.max(0.8, targetF0 / a.f0))
          const locked = finalFile.replace(/\.wav$/i, '-lock.wav')
          // 改采样率再拉回时长：只动音高，不动语速
          const filter = `asetrate=24000*${factor.toFixed(4)},aresample=24000,atempo=${(1 / factor).toFixed(4)}`
          const r = await run(cfg.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', finalFile, '-filter:a', filter, '-ar', '24000', '-ac', '1', locked], {}, 30000)
          if (r.ok) {
            await unlink(finalFile).catch(() => {})
            finalFile = locked
            pitchShift = Math.round(factor * 1000) / 1000
            const info = await stat(locked)
            seconds = Math.round(((info.size - 44) / 2 / 24000) * 100) / 100
            const after = analyze(await readFile(locked))
            f0 = Math.round(after.f0 * 10) / 10
          } else {
            await unlink(locked).catch(() => {})
          }
        }
      }
    }

    // 声线闸门（发出前自检）：音高和音色指纹都跟基准比一次，差得多就把频谱往基准拉回来
    let identity = { ok: true, specDist: 0, semis: 0, eq: false }
    if (cfg.ffmpeg && baseProfile) {
      let a = analyze(await readFile(finalFile))
      let specDist = profileDistance(a.profile, baseProfile)
      const semis = a.f0 > 0 ? Math.abs(12 * Math.log2(a.f0 / voiceF0)) : 0
      const eqTrigger = Number(cfg.eqTrigger ?? 1.0)
      if (specDist > eqTrigger) {
        const eqed = await matchSpectrum(cfg, finalFile, a.profile, baseProfile)
        if (eqed) {
          await unlink(finalFile).catch(() => {})
          finalFile = eqed
          a = analyze(await readFile(eqed))
          specDist = profileDistance(a.profile, baseProfile)
          f0 = Math.round(a.f0 * 10) / 10
          const info = await stat(eqed)
          seconds = Math.round(((info.size - 44) / 2 / 24000) * 100) / 100
          identity = { specDist, semis, eq: true }
        }
      } else {
        identity = { specDist, semis, eq: false }
      }
      identity.ok = identity.specDist <= Number(cfg.maxSpecDist ?? 1.2) && identity.semis <= Number(cfg.maxSemis ?? 2)
      identity = { ...identity, specDist: Math.round(identity.specDist * 100) / 100, semis: Math.round(identity.semis * 100) / 100 }
    }

    return {
      file: finalFile,
      engine: 'breeze-clone',
      seconds,
      style,
      instruction,
      voice: cfg.voice,
      takes: candidates.length,
      score: Math.round(best.nat.score * 1000) / 1000,
      f0: Math.round(f0 * 10) / 10,
      pitchShift,
      identity,
      parts: Object.fromEntries(Object.entries(best.nat.parts).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      tempo: Math.round(tempo * 100) / 100,
    }
  })
}

/**
 * 主人是不是明确要语音：最近两三条里出现「语音 / 念一句 / 来一句 / 听听声音」这类词就算。
 * 明确要了就必须修到能发；没明确要，自检修不好就改打字。
 */
export function explicitVoiceRequest(cfg) {
  try {
    const dir = String(cfg?.chatlogPath || DEFAULTS.chatlogPath || '')
    if (!dir) return false
    let file = dir
    if (!/\.jsonl$/i.test(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
      if (!files.length) return false
      file = join(dir, files[files.length - 1])
    }
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-30)
    const recent = []
    for (const line of lines) {
      try {
        const j = JSON.parse(line)
        if (j.who && j.who !== 'bot' && j.text) recent.push(String(j.text))
      } catch { /* 跳过坏行 */ }
    }
    return /(语音|念一句|念一下|来一句|说一句|听.{0,3}声音|发段声)/.test(recent.slice(-3).join(' '))
  } catch {
    return false
  }
}

/**
 * 对外入口：先合成，再自检。
 *   - 自检过了 → 直接用
 *   - 没过 → 换种子重来（最多 3 轮），每轮都做语速/音高/频谱修正
 *   - 还是没过 → 明确要过语音就硬发这一版（best）；没明确要就抛错，AuraBot 会改发文字
 */
export async function synthesize(config, text, opts = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}), ...(opts || {}) }
  const mustVoice = opts.mustVoice ?? explicitVoiceRequest(cfg)
  const gate = cfg.identityGate !== false
  const rank = (r) => (r.identity ? r.identity.specDist + r.identity.semis * 0.25 : 99)
  let best = null
  // 明确要语音时多给几轮（必须修到能发），没明确要就 3 轮，修不好改打字
  const maxRounds = mustVoice ? 6 : 3
  for (let round = 0; round < maxRounds; round++) {
    const seed = Number(opts.seed ?? cfg.seed ?? 42) + round * 31
    const r = await synthesizeOnce(cfg, text, { ...opts, seed, takes: round === 0 ? opts.takes : 4 })
    if (r.identity?.ok || !gate) {
      if (best) await unlink(best.file).catch(() => {})
      return r
    }
    if (!best || rank(r) < rank(best)) {
      if (best) await unlink(best.file).catch(() => {})
      best = r
    } else {
      await unlink(r.file).catch(() => {})
    }
  }
  if (mustVoice || !gate) return best
  await unlink(best.file).catch(() => {})
  throw new Error('音色自检没过（已重试 ' + maxRounds + ' 轮），改发文字')
}

export async function synthesizeBuffer(config, text, opts = {}) {
  const r = await synthesize(config, text, opts)
  const buf = await readFile(r.file)
  await unlink(r.file).catch(() => {})
  return { ...r, buffer: buf }
}

export const defaults = DEFAULTS
export { spectralProfile, profileDistance }
