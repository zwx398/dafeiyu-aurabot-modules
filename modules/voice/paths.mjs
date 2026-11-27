// 路径解析：配置里给的 > 环境变量 > 自动探测。
//
// 目的：换一台机器不用改代码。装好 Aurabot / Breeze TTS 之后，
// 这个文件把路径自己找出来；找不到就返回空字符串，让调用方报出「缺什么」而不是崩掉。
//
// 环境变量（都可选）：
//   DAFEIYU_DATA_DIR      Aurabot 的 data 目录（里面要有 modules/）
//   DAFEIYU_BREEZE_HOME   Breeze TTS 2 根目录（里面有 bin/<版本>/breeze-cli.exe）
//   DAFEIYU_BREEZE_CLI    直接指定 breeze-cli.exe
//   DAFEIYU_BREEZE_MODEL  直接指定 q8 模型
//   DAFEIYU_VOICES_DIR    直接指定音色目录
//   DAFEIYU_FFMPEG        直接指定 ffmpeg
//   DAFEIYU_MOOD          心情文件
//   DAFEIYU_BASELINE      基准音（音色自检用）
//   DAFEIYU_CHATLOG       聊天流水目录
//   DSH_HOME              DeepSeek Harness 的数据目录（默认 ~/.dsh）
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function exists(p) {
  try { return Boolean(p) && existsSync(p) } catch { return false }
}

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Aurabot 的 data 目录候选（有 modules/ 才算）。 */
export function aurabotDataCandidates() {
  const out = []
  for (const v of [process.env.DAFEIYU_DATA_DIR, process.env.AURABOT_DATA]) if (v) out.push(v)
  out.push(join(dshHome(), 'plugins-data', 'aurabot'))
  out.push(join(homedir(), '.dsh', 'plugins-data', 'aurabot'))
  out.push('C:\\Aurobot\\data', 'D:\\Aurobot\\data', 'E:\\Aurobot\\data')
  return out
}

export function findAurabotData() {
  for (const dir of aurabotDataCandidates()) {
    if (exists(join(dir, 'modules'))) return dir
  }
  return ''
}

/** 在 Breeze 根目录里找 breeze-cli.exe（版本号目录会变，所以扫一层 bin/）。 */
export function findBreezeCli(home) {
  if (!home) return ''
  const flat = join(home, 'bin', 'breeze-cli.exe')
  if (exists(flat)) return flat
  try {
    const entries = readdirSync(join(home, 'bin'), { withFileTypes: true })
    for (const d of entries) {
      if (!d.isDirectory()) continue
      const p = join(home, 'bin', d.name, 'breeze-cli.exe')
      if (exists(p)) return p
    }
  } catch { /* 没 bin/ 就算了 */ }
  return ''
}

export function breezeHomeCandidates(dataDir) {
  const out = []
  if (process.env.DAFEIYU_BREEZE_HOME) out.push(process.env.DAFEIYU_BREEZE_HOME)
  if (dataDir) out.push(join(dataDir, 'breeze-tts2'), join(dataDir, 'breeze-tts-2'))
  out.push(join(dshHome(), 'plugins-data', 'aurabot', 'breeze-tts2'))
  out.push('C:\\breeze-tts2', join(homedir(), 'breeze-tts2'))
  return out
}

export function findBreezeHome(dataDir) {
  for (const home of breezeHomeCandidates(dataDir)) {
    if (findBreezeCli(home)) return home
  }
  return ''
}

/**
 * 把语音要用的几个路径解出来。全部允许为空——调用方发现是空就告诉用户缺哪一步。
 * 返回 { cli, model, voicesDir, ffmpeg, moodPath, baselinePath, chatlogPath, dataDir }
 */
export function resolveVoicePaths(env = process.env) {
  const dataDir = env.DAFEIYU_DATA_DIR && exists(join(env.DAFEIYU_DATA_DIR, 'modules'))
    ? env.DAFEIYU_DATA_DIR
    : findAurabotData()
  const breezeHome = findBreezeHome(dataDir)

  const cli = env.DAFEIYU_BREEZE_CLI || findBreezeCli(breezeHome)
  const model = env.DAFEIYU_BREEZE_MODEL
    || (breezeHome ? join(breezeHome, 'models', 'breeze-tts-2-q8_0.gguf') : '')
  const voicesDir = env.DAFEIYU_VOICES_DIR || (breezeHome ? join(breezeHome, 'voices') : '')

  const ffmpegCandidates = [
    env.DAFEIYU_FFMPEG,
    join(dshHome(), 'douyin-studio', 'bin', 'ffmpeg.exe'),
    dataDir ? join(dataDir, 'ffmpeg.exe') : '',
  ].filter(Boolean)
  const ffmpeg = ffmpegCandidates.find((p) => exists(p)) || 'ffmpeg'

  return {
    dataDir,
    cli,
    model,
    voicesDir,
    ffmpeg,
    moodPath: env.DAFEIYU_MOOD || (dataDir ? join(dataDir, 'mood.json') : ''),
    baselinePath: env.DAFEIYU_BASELINE || (dataDir ? join(dataDir, 'samples', 'baseline.wav') : ''),
    chatlogPath: env.DAFEIYU_CHATLOG || (dataDir ? join(dataDir, 'chatlog') : ''),
  }
}

/** 给人看的一句话：缺什么。 */
export function describeMissing(paths) {
  const miss = []
  if (!paths.cli) miss.push('breeze-cli.exe（Breeze TTS 2 引擎）')
  if (!paths.model) miss.push('breeze-tts-2-q8_0.gguf（模型权重）')
  if (!paths.voicesDir) miss.push('voices 目录（音色 .breeze）')
  return miss
}
