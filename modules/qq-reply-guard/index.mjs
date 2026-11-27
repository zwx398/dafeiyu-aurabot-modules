// QQ 回复兜底清洗：模型偶尔把「自我核对」的念头打进正文，还顺手把整段回答重抄一遍。
//
// 2026-11-27 23:49 真发给主人的那一条：
//   哦 以后改了代码都推到 GitHub
//   那我记住这规矩了 改插件和模块前先提交
//   <sticker:收到> — hmm that tag may not match. Use 卖萌.哦 以后改了代码都推到 GitHub
//   那我记住这规矩了 改插件和模块前先提交
//   <sticker:卖萌>
// 结果是同一段话发了两遍，中间夹一句英文。查下来根因在模型输出本身（assistant 原文就这样），
// 而插件的 cleanOutboundText 只认中文思考标签（【思考】/分析：/最终回答：…），
// 夹在中文中间的英文小句子、以及重复段落都漏过去了。
//
// 这里在 reply 钩子上补两刀（不动插件核心，升级不会被覆盖）：
//   1. 剥掉夹在中文里的英文自检片段：3 个英文词以上、含 hmm/wait/may not match/tag/use… 这类元信息词，
//      左边是中文（或刚结束的标签）、右边也是中文 —— 正常的英文回复、夹个品牌名/文件名都不会动。
//   2. 同一条回复里重复出现的段落只留一份；重复块尾部的表情标签一起丢掉。
//
// 只在真改动了文字时返回新值，其它情况原样放行。

const 汉字 = /[\p{Script=Han}]/u
const 英文段 = /[A-Za-z][A-Za-z0-9'’._\-,;:!? ]*/g
const 英词 = /[A-Za-z][A-Za-z0-9'’_-]*/g
// 只有带这些词的英文才当成「自我核对」，避免把转述的英文原话削掉
const 元信息 = /\b(?:hmm+|umm?|wait|actually|let me|i should|i think|seems?|may not|doesn'?t match|not match|mismatch|tag|sticker|emoji|use)\b/i
// 标签结尾：<sticker:收到> 这类
const 标签尾 = /[>＞】」）)]/
const 空白 = /[ \t\u00a0\u3000]/

function 词数(s) {
  return (s.match(英词) || []).length
}

/** 从 start 往左跳过空格和破折号，返回真正要保留到的位置。 */
function 左边界(text, start) {
  let i = start
  while (i > 0 && 空白.test(text[i - 1])) i--
  while (i > 0 && (text[i - 1] === '—' || text[i - 1] === '–' || text[i - 1] === '-')) i--
  while (i > 0 && 空白.test(text[i - 1])) i--
  return i
}

/** start 左边（跳过空格/破折号）那个字符；行首返回空串。 */
function 左字(text, start) {
  let i = start - 1
  while (i >= 0) {
    const c = text[i]
    if (空白.test(c) || c === '—' || c === '–' || c === '-') { i--; continue }
    return c
  }
  return ''
}

function 剥英文自检(line) {
  let out = String(line || '')
  for (let round = 0; round < 8; round++) {
    let 命中 = null
    for (const m of out.matchAll(英文段)) {
      const 片段 = m[0].trim()
      if (词数(片段) < 3 || 片段.length < 10) continue
      if (!元信息.test(片段)) continue
      const start = m.index
      let j = start + m[0].length
      while (j < out.length && 空白.test(out[j])) j++
      const 左 = 左字(out, start)
      const 右 = out[j] || ''
      const 左像中文 = 左 === '' || 汉字.test(左) || 标签尾.test(左)
      if (!左像中文 || !汉字.test(右)) continue
      // 「Use 卖萌.」「Use 开心 instead.」这类尾巴一并削掉：先吃掉那个短词，再吃掉英文尾巴
      let end = j
      const 尾巴 = /^\s*([\p{Script=Han}A-Za-z0-9]{1,10})(?:[ \t]*[A-Za-z][A-Za-z0-9'’._\-,;:!? ]*)?[.。](?=\s*(?:[\p{Script=Han}]|<\/|$))/u.exec(out.slice(j))
      if (尾巴) end = j + 尾巴[0].length
      命中 = [左边界(out, start), end]
      break
    }
    if (!命中) break
    out = out.slice(0, 命中[0]) + out.slice(命中[1])
  }
  return out
}

/** 一行拆成「开头的标签」和「剩下的正文」。 */
function 拆标签(line) {
  const 标签 = []
  let rest = line
  for (;;) {
    const m = /^\s*(<(?:sticker|voice|face|at|reply):[^>]*>|<\/?(?:voice|sticker|face)>|<poke\s*\/?>)\s*/i.exec(rest)
    if (!m) break
    标签.push(m[1])
    rest = rest.slice(m[0].length)
  }
  return { 标签, 正文: rest.trim() }
}

function 去掉重复(text) {
  const 原 = String(text)
  const 行 = 原.split('\n').map((l) => l.trim()).filter(Boolean)
  let 删了 = false
  // A. 尾巴整段重复（模型把上一段原样接在后面）：从最早能对上的位置截掉
  for (let i = 1; i < 行.length && !删了; i++) {
    const 长 = 行.length - i
    // 单行尾巴只有够长才当「重抄」；「嘿嘿」这种短句连发两条是正常的
    if (长 < 2 && 行[i].length < 8) continue
    for (let j = 0; j < i; j++) {
      let 同 = true
      for (let k = 0; k < 长; k++) if (行[j + k] !== 行[i + k]) { 同 = false; break }
      if (!同) continue
      行.splice(i)
      删了 = true
      break
    }
  }
  // B. 逐行去重：长句或带表情/语音标签的行，重复出现的只留第一份
  const 看过 = new Set()
  const 结果 = []
  let 上一行被删 = false
  for (const 行文本 of 行) {
    const { 标签, 正文 } = 拆标签(行文本)
    if (!正文) {
      if (上一行被删) { 上一行被删 = false; continue }
      结果.push(行文本)
      continue
    }
    const key = 正文.replace(/\s+/g, ' ')
    if ((key.length >= 8 || 标签.length > 0) && 看过.has(key)) {
      上一行被删 = true
      删了 = true
      if (标签.length) 结果.push(标签.join(' '))
      continue
    }
    看过.add(key)
    结果.push(行文本)
    上一行被删 = false
  }
  if (!删了) return 原
  return 结果.join('\n')
}

export function 清洗(text) {
  const 原 = String(text || '')
  let out = 原
    .split('\n')
    .map((line) => 剥英文自检(line))
    .join('\n')
  out = 去掉重复(out)
  if (out === 原) return 原
  out = out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return out || 原 // 全被削掉就别乱动
}

// 规则改写（2026-11-28，主人要求「一句话原本的意思不能被搞坏」）：
// 插件自带的规则里有一行「像真人打字一样，一句一行…一般两三条就够」，它会把回复往「短」上压，
// 真机就压出过病句：01:35 那条「QQ 头像那张是同一只想，但我在里面看它」，
// 本意是「同一只，只是我在表情库里看它（姿势不一样）」，主谓和连接词被压掉了。
// 这里只改这一行：保留「像真人打字、拆条发」的意思，加上「每句要说完整，宁可多打几个字」。
const 原来那行 = /^([ \t]*(?:[-*]\s*)?)[^\n]*一句一行[^\n]*$/mu
const 新规则 = '像真人打字一样发消息：想说的多就拆成几条、每条单独发，但每一句都要说完整——宁可多打几个字，也别为了短把主语、动词、连接词压掉。一般两三条就够，别刷屏。'

export function 改规则(text) {
  const 原 = String(text || '')
  if (!原来那行.test(原)) return 原
  const 后 = 原.replace(原来那行, (line, 缩进) => `${缩进}${新规则}`)
  return 后 === 原 ? 原 : 后
}

export default {
  id: 'qq-reply-guard',
  name: '回复兜底清洗',
  version: '1.1.0',
  api: 1,
  description: '模型把英文自检念头打进正文、或把整段回答重抄一遍时，发出去之前削掉；并把「一句一行越短越好」的规则改成「每句要说完整」。',
  setup(api) {
    api.on('reply', (text, { chatId } = {}) => {
      const 原 = String(text || '')
      const 后 = 清洗(原)
      if (后 === 原) return undefined
      api.log?.info(`[reply-guard] ${chatId || '?'} 清掉一段跑偏的回复：${原.length} → ${后.length} 字`)
      return 后
    })

    // 同步钩子：提示词变量不等异步
    api.on('rules', (text, kind) => {
      const 原 = String(text || '')
      const 后 = 改规则(原)
      if (后 === 原) return undefined
      api.log?.debug?.(`[reply-guard] 规则（${kind || '?'}）里的「一句一行」改成「每句说完整」`)
      return 后
    })
  },
}
