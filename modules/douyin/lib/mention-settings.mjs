// 「读 @我」的模块设置。默认只读、不自动回：读通知不改账号任何状态，回评论是额外动作要显式打开。

export const MENTION_DEFAULTS = {
  mentionPollMinutes: 10, // 隔几分钟看一次「通知 → 互动消息 → 提到了你」（0 = 不看）
  mentionReply: false, // 主人在评论区 @ 我之后，要不要用自己的口气回一条（默认关，打开后是楼中楼回复）
  mentionWindowHours: 72, // 只处理最近多少小时内的 @
}

export const MENTION_SETTINGS = [
  { key: 'mentionPollMinutes', label: '多久看一次「@我」', type: 'number', min: 0, max: 240, step: 1, hint: '分钟。0 = 不看。只读抖音首页「通知」面板里的互动消息，不点赞不评论。' },
  { key: 'mentionReply', label: '主人 @ 我时自动回一条', type: 'switch', hint: '默认关。打开后才会在她的作品/别人作品评论区发一条新评论（真 @ 你），受评论次数和间隔限制。' },
  { key: 'mentionWindowHours', label: '只看最近多少小时内的 @', type: 'number', min: 1, max: 168, step: 1, hint: '小时。更早的 @ 只标成已读，不回。' },
]

/** 面板可能存成字符串 / 缺省：收成稳定类型。 */
export function normalizeMentionOptions(value) {
  const v = value && typeof value === 'object' ? value : {}
  const minutes = Number(v.mentionPollMinutes)
  const hours = Number(v.mentionWindowHours)
  return {
    mentionPollMinutes: Number.isFinite(minutes) ? Math.min(240, Math.max(0, Math.round(minutes))) : MENTION_DEFAULTS.mentionPollMinutes,
    mentionReply: typeof v.mentionReply === 'boolean' ? v.mentionReply : MENTION_DEFAULTS.mentionReply,
    mentionWindowHours: Number.isFinite(hours) ? Math.min(168, Math.max(1, Math.round(hours))) : MENTION_DEFAULTS.mentionWindowHours,
  }
}
