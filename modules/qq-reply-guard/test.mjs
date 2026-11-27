// 回归用例：真机踩到的那条 + 容易误伤的日常回复。
// 跑法（仓库根目录）：node modules/qq-reply-guard/test.mjs

import { 清洗, 改规则 } from './index.mjs'

const 真机 = [
  '哦 以后改了代码都推到 GitHub',
  '那我记住这规矩了 改插件和模块前先提交',
  '<sticker:收到> — hmm that tag may not match. Use 卖萌.哦 以后改了代码都推到 GitHub',
  '那我记住这规矩了 改插件和模块前先提交',
  '<sticker:卖萌>',
].join('\n\n')

const 日常 = [
  '哦 以后改了代码都推到 GitHub',
  '',
  '那我记住这规矩了 改插件和模块前先提交',
  '',
  '<sticker:收到>',
].join('\n')

const 案例 = [
  ['真机那条：剥掉英文自检、重复段只留一份', 真机,
    '哦 以后改了代码都推到 GitHub\n那我记住这规矩了 改插件和模块前先提交\n<sticker:收到>'],
  ['正常的三段回复：一个字都不动', 日常, 日常],
  ['整条英文回复：不动', 'Sure, I can do that. Give me a minute.', 'Sure, I can do that. Give me a minute.'],
  ['中文里带品牌名：不动', '推到 GitHub 就行，我这边也提交了', '推到 GitHub 就行，我这边也提交了'],
  ['中文里带英文文件名：不动', '改的是 reply.js 里的 cleanOutboundText 函数', '改的是 reply.js 里的 cleanOutboundText 函数'],
  ['转述别人的英文原话：不动', '他说 OK I will do it 然后就走了', '他说 OK I will do it 然后就走了'],
  ['短句重复：不动（别把「嘿嘿」删成一句）', '嘿嘿\n嘿嘿', '嘿嘿\n嘿嘿'],
  ['只有一句英文自检、没重复：削掉', '好的呀 — hmm that tag may not match. Use 卖萌.', '好的呀'],
  ['表情和正文一起重复：只留一份', '好呀 那就这样\n<sticker:开心>\n好呀 那就这样\n<sticker:开心>',
    '好呀 那就这样\n<sticker:开心>'],
  ['语音台词里夹英文自检：削掉', '<voice>嗯嗯 好呀 — wait maybe use 开心 instead.</voice>',
    '<voice>嗯嗯 好呀</voice>'],
]

let 失败 = 0
for (const [名字, 输入, 期望] of 案例) {
  const 实际 = 清洗(输入)
  const ok = 实际 === 期望
  if (!ok) 失败++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${名字}`)
  if (!ok) {
    console.log(`  期望：${JSON.stringify(期望)}`)
    console.log(`  实际：${JSON.stringify(实际)}`)
  }
}
console.log(失败 ? `\n${失败} 条没过` : `\n${案例.length} 条全过`)

// ---- 规则改写：把「一句一行越短越好」换成「每句要说完整」 ----
const 真规则 = [
  '【回复方式】',
  '- 像真人打字一样，一句一行，每一行会单独发成一条消息（也可以用 ||| 隔开）；一般两三条就够，别刷屏。',
  '- 对方明确让你发语音时，一定要把要说的话放进 <voice></voice>。',
].join('\n')
const 改后 = 改规则(真规则)
const 规则用例 = [
  ['规则里那一行被换掉', 改后.includes('每一句都要说完整'), true],
  ['规则里不再要求「一句一行」', 改后.includes('一句一行'), false],
  ['其它规则行原样保留', 改后.includes('对方明确让你发语音时'), true],
  ['开头那行也保留', 改后.startsWith('【回复方式】'), true],
  ['没有那行时不动', 改规则('【回复方式】\n- 随便聊聊就好。'), '【回复方式】\n- 随便聊聊就好。'],
]
for (const [名字, 实际, 期望] of 规则用例) {
  const ok = 实际 === 期望
  if (!ok) 失败++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${名字}`)
  if (!ok) console.log(`  期望：${JSON.stringify(期望)}\n  实际：${JSON.stringify(实际)}`)
}

console.log(失败 ? `\n${失败} 条没过` : `\n规则用例也全过`)
process.exit(失败 ? 1 : 0)
