// 配音桥：把大肥鱼在 QQ 里用的那把嗓子（voice 模块）借给 douyin-studio 配音。
// douyin-studio 只会往 `${voiceSayBase}/api/voice-say/render` 发请求，
// 所以这里把 voiceSayBase 指到本模块，接口形状对齐 voice-say。

export default {
  id: 'voice-bridge',
  name: '配音桥',
  version: '0.1.0',
  api: 1,
  description: '把 QQ 里大肥鱼的声音借给抖音视频工厂配音',
  setup(api) {
    const voice = api.lazy('voice')
    const { http } = api.core

    api.route('/api/voice-say/status', async () => ({
      ok: true,
      ready: true,
      engine: 'aurabot-voice',
      voiceCount: 0,
    }))

    api.route('/api/voice-say/render', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const text = String(body?.text || '').trim()
      if (!text) return { ok: false, error: '没有要念的文字' }
      if (!voice?.speak) return { ok: false, error: '语音模块没开着' }
      try {
        const r = await voice.speak(text)
        if (!r?.file) return { ok: false, error: '语音模块没给出发音文件' }
        return {
          ok: true,
          path: r.file,
          file: r.file,
          spoken: text,
          seconds: 0,
          engine: r.engine || 'aurabot-voice',
        }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) }
      }
    })
  },
}
