// 抖音评论小桥：把「在某个视频下评论、并且真·@主人」做成一个 HTTP 接口，
// 这样 DSH 这边也能直接叫她动手（QQ 里的工具平时挂不到这个会话上）。

export default {
  id: 'douyin-at',
  name: '抖音真@',
  version: '0.1.0',
  api: 1,
  description: '在抖音视频下发评论，可以真·@主人',
  setup(api) {
    const { http } = api.core
    const douyin = () => api.use('douyin')

    api.route('/recent', async () => {
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return { ok: true, videos: dy.recentVideos?.() || [] }
    })

    api.route('/ext', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const patch = body?.patch || {}
      api.setConfig((cur) => ({ ...cur, ext: { ...cur.ext, douyin: { ...(cur.ext?.douyin || {}), ...patch } } }))
      return { ok: true, douyin: api.config().ext?.douyin }
    })

    api.route('/quiet', async () => {
      api.setConfig((cur) => ({ ...cur, ext: { ...cur.ext, douyin: { ...(cur.ext?.douyin || {}), commentReply: false } } }))
      return { ok: true, commentReply: api.config().ext?.douyin?.commentReply }
    })

    api.route('/caps', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const patch = body?.caps || {}
      api.setConfig((cur) => ({ ...cur, douyin: { ...cur.douyin, caps: { ...cur.douyin.caps, ...patch } } }))
      return { ok: true, caps: api.config().douyin.caps }
    })

    api.route('/mentions', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      const hours = Number(body?.hours || 72)
      const r = await dy.listMentions({ hours })
      return r
    })

    api.route('/comments', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return await dy.readComments(String(body?.link || ''), { count: Number(body?.count) || 20, withReplies: body?.replies === true })
    })

    api.route('/work-comments', async () => {
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return await dy.checkWorkComments('主人要求')
    })

    api.route('/reply', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      const { awemeId, cid, text } = body || {}
      if (!awemeId || !cid || !text) return { ok: false, message: 'awemeId / cid / text 都要给' }
      return await dy.replyToComment(String(awemeId), String(cid), String(text))
    })

    api.route('/check-dms', async () => {
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return await dy.checkOwnerDms('主人要求')
    })

    api.route('/check-mentions', async () => {
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return await dy.checkMentions('主人要求')
    })

    api.route('/inbox', async () => {
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return await dy.readInbox({ limit: 10 })
    })

    api.route('/state', async () => {
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      return { ok: true, state: dy.state?.() || null }
    })

    api.route('/watch', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      const link = String(body?.link || '').trim()
      if (!link) return { ok: false, message: 'link 要给我' }
      const r = await dy.watch(link)
      return { ok: Boolean(r?.ok), result: r }
    })

    api.route('/comment', async (req) => {
      let body = {}
      try { body = await http.body(req) } catch { body = {} }
      const dy = douyin()
      if (!dy) return { ok: false, message: '抖音模块没开' }
      const link = String(body?.link || '').trim()
      const text = String(body?.text || '').trim()
      if (!link || !text) return { ok: false, message: 'link 和 text 都要给' }
      try {
        const r = await dy.commentVideo(link, text, { at: body?.at === true })
        return { ok: Boolean(r?.ok), result: r }
      } catch (e) {
        return { ok: false, message: String(e?.message || e) }
      }
    })
  },
}
