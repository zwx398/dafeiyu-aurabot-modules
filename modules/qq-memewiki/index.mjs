import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// QQ 梗百科：把 DSH 梗百科的离线词库接到 Aurabot 的 QQ 消息上。
// 词库是 dsh-memewiki 的 memes.db（7105 条），只读、不碰原数据。
//
// 为什么不用 dsh-memewiki 自己的预查：它读的是 DSH 会话最后一条 user 消息，QQ 里那条长这样
// 「【私聊】夏.(3104145086)：乐子」——它只认裸词/问梗句式，带前缀整句直接判不出来，
// 所以在 QQ 这条链路上等于没预查。这里自己做：预查 + 模型主动查 + 教梗反馈 + 串子尺度。
//
// v1.5.0（2026-11-27）：不再「先猜句子类型、再按句式查」。
//   旧写法句尾必须正好落在「什么梗/什么意思」上，多一个「来着」整句就判死；判成随口说之后
//   还会被「整句像在问别的事」那道守卫再扔一次，于是静默 —— 听感就是「换个语气词又不认识了」。
//   现在：先把句尾的语气/疑问尾巴反复剥掉，再拿整句去撞词条；命中强弱分两档，
//   强档给参考（核心一句 + 接法示例），弱档只给一句「可能沾梗，没在玩就当没看见」。
//   日常词（表情包 / token / 清楚…）不进预查，低置信反复命中的词条自动降级。
//   理由和验证记录见 AGENTS.md「梗百科 v1.5.0」。

const 纯接句 = /^(?:那|这|它|你)?(?:下一句|下句|后半句|后面呢|接下来|然后呢|接什么|接下一句)(?:是什么|是啥|啥|呢|啊|呀)?[？?！!。～~]*$/u
const 接句 = /(?:下一句|下句|后半句|后面接|怎么接)/u
const 疑问 = /[什么啥怎咋哪吗呢来着到底究竟多少几]/u
const 唤醒 = /^(?:大肥鱼|小肥鱼|鱼鱼|小鲸鱼|大鲸鱼|大飞鱼|大尾鱼|deepseek)[\s，,:：]+/iu
const 教梗 = /(?:这|那)(?:个)?(?:梗)?(?:其实|本来|就)?是\s*[「“"'『]?([^，,。！!？?：:；;\s「」“”"'『』]{1,16})[」”"'』]?\s*的(?:梗|段子|说法|出处|来源)/u
const 疑问开头 = /^(?:谁|啥|什么|哪|哪个|哪位|咋|怎么|为什么|多少|几)/u

// 句尾的语气/疑问尾巴：反复剥，剥到剥不动为止
// 「大狗叫本来是什么意思来着」→「大狗叫」；「这是啥鱼」→「是啥鱼」（后面靠子串命中）
const 剥尾 = /(?:来着|本来是|本来|原本|刚刚|刚才|之前|以前|到底|究竟|这是|这个|那个|是啥意思|是什么意思|是啥梗|是什么梗|啥意思|什么意思|什么梗|啥梗|什么来头|什么出处|什么来历|怎么用|怎么接|怎么玩|有?没有|是不是|啊|呀|呢|嘛|吧|哦|啦|咯|诶|哎|喂|哈|了)+$/u
const 剥首 = /^(?:那|这|所以|话说|对了|我想问|我问一下|问你个事|你刚才说的|刚才说的|你说的)+/u

// 口语里常见的叫法，词库里没有独立词条，先归到最接近的那条。
// 词库更新后如果收了这些词，把对应行删掉就行。
const 口语变体 = new Map([
  ['难绷', '绷不住'],
  ['破绷', '绷不住'],
  ['蚌埠住了', '绷不住'],
  ['东子', '乐子'],
])

// 这些是日常寒暄/高频口语，不当梗查，免得每句话都塞一条词条。
const 停用词 = new Set([
  '哈哈', '哈哈哈', '好的', '好吧', '谢谢', '早安', '晚安', '你好', '在吗', '不在', '没事', '收到', '吃饭', '睡觉',
  '可以', '这样', '那样', '什么', '怎么', '为什么', '知道', '不知道', '是的', '不是', '真的', '假的', '嗯嗯', '哦哦',
  '行吧', '笑死', '好耶', '这个', '那个', '一下', '现在', '今天', '明天', '昨天', '有点', '没有', '还是',
  '还有', '一起', '打开', '看看', '已经', '刚才', '然后', '所以', '就是', '觉得', '知道', '不知道',
])

// 词条本身就是日常词/技术词：主线聊天里出现它们不代表在玩梗，永远不进预查
// （工具 search_meme_wiki 照样查得到）
const 日常词条 = new Set(['表情包', 'token', '清楚', '好烂', '三件事', '回答我', '蒙面斗士'])

function 清行(line) {
  let t = String(line || '').trim()
  if (!t) return ''
  t = t.replace(/^【私聊】[^：:\n]*[：:]\s*/u, '')
  t = t.replace(/^【群聊[^】]*】[^：:\n]*[：:]\s*/u, '')
  t = t.replace(/^\[\d+\]\s*[^：:\n]{0,40}[：:]\s*/u, '')
  t = t.replace(/^(@\S+\s*)+/u, '')
  t = t.replace(唤醒, '')
  return t.trim()
}

function keyOf(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '')
}

/** 把句尾的「来着 / 到底 / 是什么意思 / 啊呀呢」这类剥掉，剩下真正的词。 */
function 提取查询(text) {
  let q = String(text || '').trim()
  for (let i = 0; i < 8; i++) {
    const next = q.replace(剥尾, '').replace(剥首, '').trim()
    if (next === q) break
    q = next
  }
  return q
}

/** 判断这句话是想干嘛：问梗 / 接后半句 / 只是随口说（可能带梗）。 */
function 读意图(line) {
  const text = 清行(line)
  if (!text || text.length > 240) return
  if (/https?:\/\//iu.test(text)) return
  // 占位符：QQ 里图片/表情/语音都可能变成 [动画表情]、[图片] 这种，整行都是括号就别查
  if (/^\[[^\]\n]{1,12}\]$/u.test(text)) return
  if (/^（[^）\n]{1,12}）$/u.test(text)) return
  if (纯接句.test(text)) return { query: '', intent: 'continue' }

  const query = 提取查询(text) || text
  const 整句 = keyOf(text)
  const qkey = keyOf(query)
  if (qkey.length < 2) return // 「好」「嗯」这种一个字的不查
  if (停用词.has(整句) || 停用词.has(qkey)) return
  if (/^(.{2,3})\1$/u.test(整句)) return // 「这个这个」「可以可以」不是梗

  const 在问 = 疑问.test(text) || /[？?]\s*$/u.test(text)
  const intent = 接句.test(text) ? 'continue' : 在问 ? 'explain' : 'play'
  return { query, intent }
}

/** 用户在给你讲一个梗（「这是康康的梗」）：先接住，再问要不要补进梗维基。 */
function 提取教梗(line) {
  const text = 清行(line)
  if (!text) return ''
  const m = 教梗.exec(text)
  if (!m) return ''
  if (疑问开头.test(m[1])) return ''
  return text
}

// ---------- 词条索引（内存里做，避免每轮打 SQL） ----------

let 词库连接 = null
let 索引 = null
let 索引版本 = ''

function 库文件(dshHome) {
  return join(dshHome, 'profiles', 'desktop', 'node_modules', 'dsh-memewiki', 'data', 'memes.db')
}

function 版本号(path) {
  return [path, `${path}-wal`].map((file) => {
    const info = statSync(file, { bigint: true, throwIfNoEntry: false })
    return info ? `${info.ino}:${info.size}:${info.mtimeNs}` : ''
  }).join('|')
}

function 建索引(db) {
  const byKey = new Map() // 归一化后的标题/别名 → 标题
  const titles = [] // { title, key }：参与「标题包含/被包含」匹配
  const 加大 = (spelling, title, rank) => {
    const key = keyOf(spelling)
    if (!key) return
    const old = byKey.get(key)
    if (!old) byKey.set(key, { title, rank })
    else if (old.rank < rank) byKey.set(key, { title, rank })
  }
  const rows = db.prepare('SELECT title, aliases FROM memes ORDER BY title').all()
  for (const { title, aliases } of rows) {
    if (!title) continue
    加大(title, title, 2)
    for (const alias of String(aliases || '').split(/[,，]/u)) 加大(alias.trim(), title, 1)
    const key = keyOf(title)
    if (key.length >= 2) titles.push({ title, key })
  }
  titles.sort((a, b) => b.key.length - a.key.length)
  return { byKey, titles, db }
}

// 词条正文反查的缓存：整句歌词/原句 → 命中的词条标题
const 正文缓存 = new Map()

/** 整句是某词条正文里的歌词/原句（「有人钢枪有人伏地」→「钢枪伏地」）。 */
function 正文反查(index, query) {
  const raw = String(query).trim()
  const key = keyOf(raw)
  if (!key || key.length < 5) return null
  if (正文缓存.has(key)) return 正文缓存.get(key)
  try {
    const row = index.db.prepare(
      'SELECT title FROM memes WHERE length(title) >= 2 AND (instr(usage, ?) > 0 OR instr(summary, ?) > 0 OR instr(origin, ?) > 0) ORDER BY length(title) ASC LIMIT 1',
    ).get(raw, raw, raw)
    const title = row?.title || null
    if (正文缓存.size > 500) 正文缓存.clear()
    正文缓存.set(key, title)
    return title
  } catch (error) {
    return null
  }
}

/** 词库里查一条：精确 → 口语变体 → 句中嵌词条 → 前缀 → 标题含查询词 → 正文反查。 */
function 查词条(index, query) {
  const qkey = keyOf(query)
  if (!qkey) return null

  const exact = index.byKey.get(qkey)
  if (exact) return { title: exact.title, via: 'exact' }

  // 纯数字（666 / 233）日常用法跟词条差很远，别拿前缀硬套
  if (/^\d{1,6}$/u.test(qkey)) return null

  // 口语叫法先归到最接近的词条（「难绷」→「绷不住」）
  const 变体 = 口语变体.get(qkey)
  if (变体) {
    const row = 查词条(index, 变体)
    if (row) return { title: row.title, via: 'variant' }
  }
  // 整句里嵌着口语变体（群聊常见：「真的难绷」）
  for (const [word, target] of 口语变体) {
    if (qkey !== word && qkey.includes(word)) {
      const row = 查词条(index, target)
      if (row) return { title: row.title, via: 'variant' }
    }
  }

  // 句子里嵌着的词条：枚举查询的所有子串，比遍历 7105 条快，而且只认完整词条、不乱中
  let embedded = null
  const max = Math.min(qkey.length, 24)
  for (let len = max; len >= 2; len--) {
    for (let i = 0; i + len <= qkey.length; i++) {
      const hit = index.byKey.get(qkey.slice(i, i + len))
      if (hit && hit.title && hit.title !== query) { embedded = hit; break }
    }
    if (embedded) break
  }
  if (embedded) return { title: embedded.title, via: 'embedded' }

  // 「乐乐」→「乐乐（网络梗）」：标题以查询词开头，取最短的那条
  let prefix = null
  for (const t of index.titles) {
    if (t.key.length > qkey.length && t.key.startsWith(qkey)) {
      if (!prefix || t.key.length < prefix.key.length) prefix = t
    }
  }
  if (prefix) return { title: prefix.title, via: 'prefix' }

  // 「绷不住」→「小胖孩绷不住了」：标题里含查询词。两字中文不放宽，纯字母数字才放宽。
  const 短词放宽 = qkey.length >= 2 && /^[0-9a-z]+$/i.test(qkey)
  if (qkey.length >= 3 || 短词放宽) {
    let contains = null
    for (const t of index.titles) {
      if (t.key.length > qkey.length && t.key.includes(qkey)) {
        if (!contains || t.key.length < contains.key.length) contains = t
      }
    }
    if (contains) return { title: contains.title, via: 'contains' }
  }

  // 整句是词条正文里的原句（歌词、台词）：「有人钢枪有人伏地」→「钢枪伏地」
  const 正文 = 正文反查(index, query)
  if (正文) return { title: 正文, via: 'body' }

  return null
}

/**
 * 命中有多可信：high → 给参考；low → 只给一句「可能沾梗」的短提示。
 * 长度 4 以上的词条歧义小，整句大半是词条也算可信；长句里只沾两三个字就是 low。
 */
function 置信度(hit, query, intent) {
  const tkey = keyOf(hit.title)
  const qkey = keyOf(query)
  if (!tkey || !qkey) return 'low'
  if (hit.via === 'exact' || hit.via === 'variant' || hit.via === 'body') return 'high'
  const cover = tkey.length / Math.max(qkey.length, 1)
  // 在问的这个梗（「梗百科没写大狗叫是什么意思吗」）：命中就是命中，别因为句子长就降档
  if (hit.via === 'embedded' && intent === 'explain') return 'high'
  if (hit.via === 'embedded') return tkey.length >= 4 || cover >= 0.5 || qkey.length <= 6 ? 'high' : 'low'
  return cover > 0.6 ? 'high' : 'low'
}

const 弱匹配 = (hit) => hit.via === 'prefix' || hit.via === 'contains' || hit.via === 'body'

// ---------- 给模型看的文本 ----------

const 截 = (s, n) => {
  const text = String(s ?? '').replace(/\s+/gu, ' ').trim()
  return text.length > n ? text.slice(0, n) + '…' : text
}

/** 一句话核心：标题（别名）+ 含义首句。谐音关系放在最前面，别让模型自己猜。 */
function 核心句(row) {
  const sum = String(row.summary || row.origin || '')
    .replace(/^\s*(含义|来源|意思|释义|解释|简介)[\s：:，,]*/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const first = (sum.split(/[。！!？?；;\n]/u)[0] || '').trim()
  const aliases = String(row.aliases || '').split(/[,，]/u).map((s) => s.trim()).filter(Boolean)
  const aka = aliases.length ? `（也叫「${aliases.slice(0, 3).join('」「')}」）` : ''
  return `「${row.title}」${aka}${first ? `：${截(first, 60)}` : ''}`
}

/** 词条里写好的「要回复 XXX」，或者 usage 里的前两条示例。 */
function 接法示例(row) {
  const usage = String(row.usage || '')
  const 现成 = /(?:要回复|(?:标准|常见)?接法|(?:可以|直接|常用)回复)[：:]?\s*([^\n。]{1,40})/u.exec(usage)
  if (现成) return 现成[1].trim()
  const bullets = usage.split(/\n/u).map((s) => s.trim()).filter((s) => /^[-•·*—]/u.test(s))
  if (bullets.length) {
    // 只挑短的：词条里的长段落是百科说明，不是台词，照念就变成科普了
    const 短条 = bullets
      .map((s) => s.replace(/^[-•·*—]\s*/u, '').replace(/[“”"「」]/gu, '').trim())
      .filter((s) => s && s.length <= 30)
      .sort((a, b) => a.length - b.length)
    if (!短条.length) return ''
    return 短条.slice(0, 2).join(' / ').slice(0, 45)
  }
  const first = usage.split(/\n/u).map((s) => s.trim()).find((s) => s && !/^(用法|怎么用|使用|场景|具体)/u.test(s))
  return first ? first.slice(0, 60) : ''
}

/** 给模型的一段参考。high 档带核心 + 接法；low 档只有一句短的，允许忽略。 */
function 参考块(request, row, hit, 档) {
  if (档 === 'low') {
    const aliases = String(row.aliases || '').split(/[,，]/u).map((s) => s.trim()).filter(Boolean)
    const 短意 = aliases.length
      ? aliases.slice(0, 2).join(' / ')
      : 截(String(row.summary || row.origin || '').replace(/^\s*(含义|来源|意思|释义|解释|简介)[\s：:，,]*/u, ''), 24)
    return `【梗百科·QQ 可能沾梗】这句里有「${截(row.title, 20)}」${短意 ? `（=${短意}）` : ''}。是在玩就接一句；没在玩就当没看见，别硬套。`
  }
  const 接法 = 接法示例(row)
  const 尾巴 = request.intent === 'explain'
    ? '他这在问，用你自己的话一两句说清，别念词条、别说「根据资料」。'
    : '他这是在玩，顺手接一句就行，别解释梗。'
  const 接法行 = 接法
    ? `接法示例：${截(接法, 45)}（换成你自己的口气，别原句念）`
    : '词条没给现成接法：按它的意思接一句，别把词原样念一遍。'
  const 弱行 = 弱匹配(hit) ? '\n（词库里没有这条本身，这是最接近的，别硬往上面套）' : ''
  return `【梗百科·QQ 参考】对方说的是「${截(request.query, 20)}」。\n核心：${核心句(row)}\n${接法行}${弱行}\n${尾巴}`
}

function 词条文本(row) {
  const lines = [`词条「${截(row.title, 40)}」`]
  const tags = 截(row.tags, 80)
  if (tags) lines.push(`标签：${tags}`)
  lines.push(`核心：${核心句(row)}`)
  const usage = 截(row.usage, 380)
  if (usage) lines.push(`怎么用 / 怎么接：${usage}`)
  const brief = 截(row.summary || row.origin, 200)
  if (brief) lines.push(`来历：${brief}`)
  return lines.join('\n')
}

function 教梗文案(原句) {
  return `【梗百科·对方在给你讲一个梗】用户刚说：「${截(原句, 60)}」——他是在告诉你这个梗的来历或用法，不是在考你。\n` +
    '先接住：照他给的说法用一句，别辩解、别科普。然后主动问一句「要不要把这个补进梗维基」——用你自己的话说，别像客服；他同意才调 feedback_meme_wiki。'
}

// ---------- 和 DSH 梗百科共用的设置 ----------

function 读配置(dshHome) {
  try {
    return JSON.parse(readFileSync(join(dshHome, 'memewiki.json'), 'utf8')) || {}
  } catch (error) {
    return {}
  }
}

function 自动思考梗(dshHome) {
  return 读配置(dshHome).自动思考梗 !== false // 配置缺失/坏了就按默认开
}

/** 玩梗尺度（串子程度）：设置页里开了才有。0~100，越高越放得开。 */
function 串子文案(dshHome) {
  const cfg = 读配置(dshHome)
  if (!cfg.串子开关) return ''
  const 值 = Math.max(0, Math.min(100, Math.round(Number(cfg.串子程度) || 0)))
  const 档 = 值 <= 20 ? '很低' : 值 <= 45 ? '偏低' : 值 <= 70 ? '中等' : '很高'
  const 说明 = 值 <= 20
    ? '把对面当真人尊重。可以接正面梗、自嘲、夸人；黑称一律不接、不复读，遇到侮辱性外号直接点一句它为什么不好，不跟着起哄。'
    : 值 <= 45
      ? '可以损操作、损发挥，不损长相、不损病。别人先用黑称、且明显是玩的时候，跟着接半句；不带头用，不上纲上线。'
      : 值 <= 70
        ? '按社区语境来：别人玩得开的梗就跟着玩，损操作、损战绩、损名言都行；冲家人的词不带头用。'
        : '放开串：黑称也照玩（别人先甩出来的词，接着玩，别扫兴），损操作、损战绩、损长相都接，怎么损怎么来，别端着。只对真事，不自己编新攻击。'
  return `[玩梗尺度·串子程度 ${值}/100（${档}）]\n${说明}`
}

export default {
  id: 'qq-memewiki',
  name: 'QQ 梗百科',
  version: '1.5.0',
  api: 1,
  description: 'QQ 侧的梗百科：宽扫预查、模型主动查梗、教梗反馈、串子尺度，和 DSH 梗百科共用词库与设置。',
  setup(api) {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const path = 库文件(dshHome)
    let 上次版本 = ''
    // 低置信命中反复出现的词条（「表情包」这类）自动降级，不用手写名单
    const 噪声计数 = new Map()
    const 噪声词 = new Set()

    const 拿索引 = () => {
      const now = 版本号(path)
      if (now === 上次版本 && 索引) return 索引
      if (!existsSync(path)) return null
      词库连接?.close?.()
      词库连接 = new DatabaseSync(path, { readOnly: true })
      索引 = 建索引(词库连接)
      上次版本 = now
      return 索引
    }

    const 取词条 = (title) => {
      try {
        return 词库连接?.prepare('SELECT title, usage, summary, origin, tags, aliases FROM memes WHERE title = ?').get(title) || null
      } catch (error) {
        return null
      }
    }

    const 记噪声 = (title) => {
      const n = (噪声计数.get(title) || 0) + 1
      噪声计数.set(title, n)
      if (n >= 5 && !噪声词.has(title)) {
        噪声词.add(title)
        api.log.info(`梗百科：「${title}」低置信命中 ${n} 次都没人接，降成日常词，不再进预查`)
      }
    }

    // ---------- 每轮消息：预查 + 教梗 ----------
    api.on('prompt', async (content, { chat, queryText } = {}) => {
      if ((chat?.kind !== 'private' && chat?.kind !== 'group') || typeof queryText !== 'string' || !queryText.trim()) return
      if (!Array.isArray(content)) return
      if (!自动思考梗(dshHome)) return
      try {
        const index = 拿索引()
        if (!index) return

        // 群聊一次会攒一段（最多 20 条），梗常常在靠前的几句，所以别只留最后 4 行
        const lines = queryText.split(/\r?\n/u).slice(-10)
        // 他在给你讲一个梗：先接住，再问要不要补进词维基
        for (const line of [...lines].reverse()) {
          const 原句 = 提取教梗(line)
          if (!原句) continue
          api.log.debug(`梗百科教梗（${chat.kind}）：${截(原句, 30)}`)
          return [{ type: 'text', text: 教梗文案(原句) }, ...content]
        }

        const requests = []
        let 上一句 = ''
        for (const line of lines) {
          const text = 清行(line)
          // 「下一句是什么」单独一行：问的是上一句，别把它当新句子丢掉
          if (text && 纯接句.test(text)) {
            if (上一句) requests.push({ query: 上一句, intent: 'continue' })
            continue
          }
          const req = 读意图(line)
          if (req) requests.push(req)
          if (text) 上一句 = text
        }
        if (!requests.length) return
        requests.reverse()

        for (const request of requests) {
          if (!request.query) continue
          const hit = 查词条(index, request.query)
          if (!hit) continue
          if (日常词条.has(hit.title) || 噪声词.has(hit.title)) {
            api.log.debug(`梗百科跳过日常词（${chat.kind}）：${request.query} → ${hit.title}`)
            continue
          }
          // 标题本身就是问句（「吃什么」）：只有整句正好是它才算梗，「今天吃什么」不算
          if (!(hit.via === 'exact' || hit.via === 'variant') && /(?:什么|啥|怎么|为什么|哪|谁|多少|几)$/u.test(hit.title)) {
            api.log.debug(`梗百科跳过普通问句词条（${chat.kind}）：${request.query} → ${hit.title}`)
            continue
          }
          const 档 = 置信度(hit, request.query, request.intent)
          const row = 取词条(hit.title)
          if (!row) continue
          api.log.debug(`梗百科命中（${chat.kind}）：${request.query} → ${hit.title}（${hit.via}/${request.intent}/${档}）`)
          if (档 === 'low') 记噪声(hit.title)
          return [{ type: 'text', text: 参考块(request, row, hit, 档) }, ...content]
        }
      } catch (error) {
        api.log.warn('QQ 梗百科查询失败，当前消息照常处理：', error?.message || error)
      }
    })

    // ---------- 玩梗尺度：和 DSH 梗百科共用设置页里的开关 ----------
    api.context(() => 串子文案(dshHome))

    // 没命中的梗：以前每条都要注入一句「词库没收录」，日常短句被反复砸，听感变成「什么都不懂」。
    // 现在改成一句常驻的规矩，成本固定、不会按句乱响。
    api.context(() => '[梗百科·规矩] 碰到不认识的梗或黑话，别编出处、别装懂：顺着意思接一句，或者反问一嘴、老实说没听过都行。')

    // ---------- 工具：主动查梗 + 教梗反馈 ----------
    const dsh工具 = (name) => {
      try { return api.dsh.get('tools')?.get(name) || null } catch (error) { return null }
    }

    api.tool((where) => {
      if (!where || where.chat?.kind === 'system') return []
      const tools = []

      tools.push(api.defineTool({
        name: 'search_meme_wiki',
        description: '查网络梗、黑话的意思。本地词库 7105 条，毫秒级返回。聊天里遇到没把握的梗/缩写先查，别硬猜、别编。',
        properties: { query: { type: 'string', description: '要查的词（梗名、缩写、黑话）' } },
        required: ['query'],
        execute: async ({ query }) => {
          const q = String(query || '').trim()
          if (!q) return { ok: false, message: '要查什么？给我一个词。' }
          const index = 拿索引()
          if (!index) return { ok: false, message: '词库没加载上。' }
          const hit = 查词条(index, q)
          const row = hit ? 取词条(hit.title) : null
          if (!row) return { ok: true, message: `词库里没收录「${q}」。别硬解释——说不知道，或者反问一句「这什么梗」。` }
          api.log.debug(`工具 search_meme_wiki：${q} → ${row.title}`)
          return { ok: true, message: 词条文本(row) }
        },
        render: (_args, value) => [{ type: 'text', text: String(value?.message || value?.text || '没查到') }],
      }))

      const 反馈 = dsh工具('feedback_meme_wiki')
      if (反馈?.execute) {
        tools.push(api.defineTool({
          name: 'feedback_meme_wiki',
          description: '把用户对某条梗的纠正反馈给梗维基（cnmeme.wiki），站内有 AI 和真人审核。只在用户明确同意后调用；只给要补的那一小段话（addition），插件自己拉原文、拼全文。',
          properties: {
            title: { type: 'string', description: '梗名（词库里的标题）' },
            addition: { type: 'string', description: '要补进词条的那段话，一段就行' },
            reason: { type: 'string', description: '为什么补，1~2000 字' },
            section: { type: 'string', description: '加到哪个小节，默认「用法」' },
          },
          required: ['title', 'addition', 'reason'],
          execute: async (args) => {
            const r = await 反馈.execute(args)
            return { ok: true, message: String(r || '提交完了') }
          },
          render: (_args, value) => [{ type: 'text', text: String(value?.message || '没提交上') }],
        }))
      }

      return tools
    })

    api.log.info(`QQ 梗百科已挂接：宽扫预查 + 主动查梗 + 教梗反馈 + 串子尺度（v1.5.0）${dsh工具('feedback_meme_wiki') ? '，反馈通道可用' : '，DSH 梗百科没加载，反馈工具先不挂'}`)

    return {
      dispose() {
        try { 词库连接?.close?.() } catch (error) { /* 关不掉也无所谓 */ }
        词库连接 = null
        索引 = null
        上次版本 = ''
      },
    }
  },
}
