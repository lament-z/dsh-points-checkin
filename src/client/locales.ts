/**
 * Locale dictionaries for the points-checkin plugin. `zh` is the key-set
 * source of truth; `en` keeps a full key-for-key mirror. Registered through
 * ctx.locale.register(NS, { zh, en }).
 */

/** Simplified Chinese dictionary (key-set source of truth). */
export const zh = {
  'action.label': '积分签到',
  'action.iconLabel': '积分签到',
  'panel.title': '积分与签到',
  'panel.unreachable': '无法连接 DSH 宿主服务，请确认 DSH 正在运行。',
  'panel.loading': '加载中…',
  'service.trae': 'TRAE',
  'service.workbuddy': 'WorkBuddy',
  'status.notConfigured': '未配置 token',
  'status.authFailed': 'token 已失效',
  'status.checkedIn': '今日已签到',
  'status.notCheckedIn': '今日未签到',
  'status.disabled': '活动未开启',
  'status.unknown': '状态未知',
  'points.label': '积分',
  'points.unknown': '—',
  'checkin.button': '签到',
  'checkin.doing': '签到中…',
  'checkin.done': '已完成',
  'checkin.failed': '签到失败',
  'lastCheckin.label': '上次签到',
  'settings.title': 'Token 设置',
  'settings.expand': '设置',
  'settings.traeToken': 'TRAE token',
  'settings.traeDevice': 'TRAE 设备 ID（可选）',
  'settings.wbToken': 'WorkBuddy token',
  'settings.wbUser': 'WorkBuddy 用户 ID（可选）',
  'settings.save': '保存',
  'settings.saving': '保存中…',
  'settings.saved': '已保存',
  'settings.placeholder': '粘贴 token',
  'settings.howTo': '在网页控制台登录后，用 DevTools 从请求头中复制；详见插件 README。',
  'error.prefix': '错误',
}

/** The points-checkin namespace key union. */
export type PointsKey = keyof typeof zh

/** English dictionary, key-for-key complete against zh. */
export const en: Record<PointsKey, string> = {
  'action.label': 'Points & check-in',
  'action.iconLabel': 'Points & check-in',
  'panel.title': 'Points & daily check-in',
  'panel.unreachable': 'Cannot reach the DSH host bridge. Make sure DSH is running.',
  'panel.loading': 'Loading…',
  'service.trae': 'TRAE',
  'service.workbuddy': 'WorkBuddy',
  'status.notConfigured': 'Token not configured',
  'status.authFailed': 'Token expired',
  'status.checkedIn': 'Checked in today',
  'status.notCheckedIn': 'Not checked in today',
  'status.disabled': 'Campaign disabled',
  'status.unknown': 'Unknown status',
  'points.label': 'Points',
  'points.unknown': '—',
  'checkin.button': 'Check in',
  'checkin.doing': 'Checking in…',
  'checkin.done': 'Done',
  'checkin.failed': 'Check-in failed',
  'lastCheckin.label': 'Last check-in',
  'settings.title': 'Token settings',
  'settings.expand': 'Settings',
  'settings.traeToken': 'TRAE token',
  'settings.traeDevice': 'TRAE device ID (optional)',
  'settings.wbToken': 'WorkBuddy token',
  'settings.wbUser': 'WorkBuddy user ID (optional)',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.placeholder': 'Paste token',
  'settings.howTo': 'Log in on the web console and copy the header value with DevTools; see the plugin README.',
  'error.prefix': 'Error',
}
