// 「叫 DSH 帮忙」：她在 QQ / 抖音里判断自己做不了的活，派给 DSH 的子智能体去干。
//
// 为什么要有这个：她（大肥鱼）在 QQ / 抖音上的会话是 DSH 会话，但按档位只挂了很少的工具
// （social 档一个本地工具都没有）。需要动手的时候她可以调 ask_dsh，把任务书交给
// hub.runSubagentTurn 生出来的子智能体——那个子级用 aurabot-subagent preset，带 pwsh / 文件 / 网页。
// 子级看不到任何聊天历史，所以任务书必须自足（这里替她拼好环境说明）。

const __lib = globalThis.aurabot.lib
const { defineTool, str } = __lib('tools/tools.js')
const { isOwner } = __lib('chat/access.js')

const NODE = 'C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe'
const WORKSPACE = 'E:\\Deepseek-workspace\\优化大肥鱼'
const EDGE_PORT_FILE = 'E:\\Aurobot\\data\\douyin\\edge-profile\\DevToolsActivePort'

/** 子智能体看不到对话，任务书得自己带够上下文。 */
function buildPrompt(task, { from = '', who = '主人' } = {}) {
  return [
    '你在替「大肥鱼」跑腿。她本人在 QQ / 抖音上跟' + who + '聊天，手上没有电脑操作工具，所以把活派给你。',
    '你有这台 Windows 的本机权限（pwsh、读写文件、抓网页）。',
    '',
    '【环境】',
    `- 工作区：${WORKSPACE}（文档在 docs\\，踩坑记录很全，动手前先看相关的那一份）`,
    `- 抖音专用 Edge：登录的是白饭鲸这个号，CDP 端口写在 ${EDGE_PORT_FILE}（读完拿 http://127.0.0.1:<端口>/json/list）`,
    `- Node（带全局 WebSocket）：${NODE}`,
    '- 抖音经验：docs\\douyin.md 的「她自己的作品」一节——楼中楼回复要 reply_id=<父 cid> + reply_to_reply_id=0；',
    '  comment/delete 的 URL 必须带 BASE 参数（device_platform=webapp&aid=6383&channel=channel_pc_web…），',
    '  少了会假报「用户未登录」；别用 PowerShell 发中文 JSON（中文会变成问号），改用 Node 脚本或页面内 fetch。',
    '',
    '【任务】',
    String(task || '').trim(),
    '',
    '【要求】',
    '- 只做任务里说的事，别顺手点赞、关注、发新作品、改资料。',
    '- 有写操作（发评论、发私信）要做完核对一遍真的生效，别报假成功。',
    '- 最后用两三句话说清：做了什么、结果如何、没成就卡在哪。',
  ].join('\n')
}

export default {
  id: 'dsh-handoff',
  name: '叫 DSH 帮忙',
  version: '0.1.0',
  api: 1,
  description: '她在 QQ / 抖音里判断自己做不了的活，派给 DSH 的子智能体用本机工具去做，做完把结果拿回来。',
  setup(api) {
    const { hub, http } = api.core
    const log = api.log
    const svc = (name) => {
      try { return api.dsh?.get ? api.dsh.get(name) : (api.dsh ? api.dsh[name] : null) } catch { return null }
    }
    // 插件的 hub.runSubagentTurn 和这一版 DSH 对不上（它把 parent 塞在 request 里，新版要顶层 parent），
    // 所以这里自己起一个常驻「调度」父级 agent，按新版规矩调 subagents.startActivation。
    let parentAgent = null
    const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()
    async function ensureParent() {
      const agentsSvc = svc('agents')
      if (parentAgent && agentsSvc?.get?.(parentAgent.id) === parentAgent) return parentAgent
      parentAgent = null
      const controller = svc('sessionController')
      const reg = svc('workspaceRegistry')
      if (!controller || !reg) throw new Error('宿主缺少 sessionController / workspaceRegistry')
      const dir = api.config().workspaceDir || 'E:\\Deepseek-workspace\\优化大肥鱼'
      let ws = (reg.list?.() || []).find((w) => norm(w.path) === norm(dir))
      if (!ws) ws = await reg.create(dir, 'Aurabot 干活')
      const made = await controller.create({ workspaceId: ws.id, agentPreset: 'aurabot-subagent' })
      const sid = String(made.sessionId)
      const r = await controller.resolveAgent(sid)
      if (!r?.agent) throw new Error('调度父级没起来')
      parentAgent = r.agent
      log.info(`起了调度父级 agent ${sid.slice(-8)}`)
      return parentAgent
    }

    /** 把子智能体最终消息里的文字收出来（不要 reasoning / 工具块）。 */
    function textOf(result) {
      const out = []
      const walk = (v) => {
        if (v == null || out.length >= 40) return
        if (typeof v === 'string') { if (v.trim()) out.push(v); return }
        if (Array.isArray(v)) { for (const x of v) walk(x); return }
        if (typeof v === 'object') {
          if (v.type === 'text' && typeof v.text === 'string') { if (v.text.trim()) out.push(v.text); return }
          if (v.type && v.type !== 'text') return
          for (const k of ['output', 'content', 'text', 'message']) if (v[k] !== undefined) walk(v[k])
        }
      }
      walk(result)
      return out.join('\n').trim()
    }

    async function handoff(task, { timeoutMs = 420000, from = '' } = {}) {
      const t = String(task || '').trim()
      if (!t) return { ok: false, message: '要干什么没说清楚' }
      if (t.length > 2000) return { ok: false, message: '任务写太长了，压到 2000 字以内' }
      const subagents = svc('subagents')
      if (!subagents || typeof subagents.startActivation !== 'function') return { ok: false, message: '这个 DSH 版本没有子智能体委派服务' }
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(new Error('超时')), Math.max(30000, Number(timeoutMs) || 420000))
      try {
        const parent = await ensureParent()
        const activation = await subagents.startActivation({
          provider: 'spawn',
          label: t.slice(0, 40),
          parent,
          prompt: [{ type: 'text', text: buildPrompt(t, { who: api.config().ownerName || '主人', from }) }],
          agentPreset: 'aurabot-subagent',
          signal: ac.signal,
          delivery: 'caller',
        })
        const r = await activation.result
        if (r && r.error) throw new Error(`子智能体执行失败：${r.error}`)
        if (r && typeof r === 'object' && 'stopReason' in r && r.stopReason !== 'completed') throw new Error('子智能体没跑完')
        const reply = textOf(r)
        if (!reply) return { ok: false, message: '跑完了但没有任何回复' }
        log.info(`替她跑了一趟：${t.slice(0, 40)}`)
        return { ok: true, message: reply }
      } catch (error) {
        log.warn('叫 DSH 帮忙没成：', error.message)
        log.warn('堆栈：' + String(error.stack || '').split('\n').slice(0, 6).join(' | '))
        return { ok: false, message: '没跑成：' + error.message }
      } finally {
        clearTimeout(timer)
      }
    }

    api.tool(({ chat }) => {
      const isDmTurn = chat.kind === 'system' && /^system:douyin-dm/.test(String(chat.chatId || ''))
      const ownerPrivate = chat.kind === 'private' && isOwner(api.config(), chat.userId)
      if (!isDmTurn && !ownerPrivate) return []
      return [
        defineTool({
          name: 'ask_dsh',
          description: '你自己做不了的活（要动电脑、开浏览器点页面、写文件、查本机的东西）交给 DSH 的子智能体去做：它在这台 Windows 上有 shell / 文件 / 网页工具。任务书必须自己写清楚（它看不到你们的聊天），比如「去抖音她自己的主页，读《鱼的第一条抖音》下的评论，然后楼中楼回复最新那条」。要一两分钟，做完把结果拿回来再跟主人说；结果没回来之前别跟主人说已经做完了。',
          properties: {
            task: str('要它做什么：具体、自足，带上必要的链接/作品名/要说什么'),
          },
          required: ['task'],
          execute: async ({ task }) => handoff(String(task || ''), { from: chat.chatId }),
        }),
      ]
    })

    // 排查/自测用：POST /handoff { task, timeoutMs }
    api.route('/handoff', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      const r = await handoff(String(b?.task || ''), { timeoutMs: Number(b?.timeoutMs) || 120000, from: 'route' })
      return r
    })

    api.route('/state', async () => ({ ok: true, subagentBackground: api.config().subagentBackground === true }))

    // 排查用：看看当前有哪些活着的 agent、subagents 服务在不在
    api.route('/probe', async () => {
      const out = { hasSubagents: false, hasAgents: false, agents: [] }
      try {
        const sub = api.dsh?.get ? api.dsh.get('subagents') : null
        out.hasSubagents = Boolean(sub && typeof sub.startActivation === 'function')
      } catch (error) { out.subagentsError = error.message }
      try {
        const svc = api.dsh?.agents || (api.dsh?.get ? api.dsh.get('agents') : null)
        out.hasAgents = Boolean(svc)
        const push = (a) => { if (a && out.agents.length < 20) out.agents.push({ id: a.id, name: a.name || '', preset: a.preset || a.agentPreset || '' }) }
        if (svc?.values) for (const a of svc.values()) push(a)
        else if (svc?.forEach) svc.forEach(push)
      } catch (error) { out.agentsError = error.message }
      return { ok: true, ...out }
    })

    // 抖音私信这类「主人不在 QQ 上」的场合要派活，得打开后台委派开关
    api.route('/bg', async (req) => {
      const b = await http.body(req).catch(() => ({}))
      const on = b?.on !== false
      api.setConfig((cur) => ({ ...cur, subagentBackground: on }))
      return { ok: true, subagentBackground: api.config().subagentBackground === true }
    })
  },
}
