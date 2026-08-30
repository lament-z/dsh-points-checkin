/**
 * Locale dictionaries for the points-checkin plugin. `zh` is the key-set
 * source of truth; `en` keeps a full key-for-key mirror. Registered through
 * ctx.locale.register(NS, { zh, en }).
 */
/** Simplified Chinese dictionary (key-set source of truth). */
export declare const zh: {
    'action.label': string;
    'action.iconLabel': string;
    'panel.title': string;
    'panel.unreachable': string;
    'panel.loading': string;
    'service.trae': string;
    'service.workbuddy': string;
    'status.notConfigured': string;
    'status.authFailed': string;
    'status.checkedIn': string;
    'status.notCheckedIn': string;
    'status.disabled': string;
    'status.unknown': string;
    'points.label': string;
    'points.unknown': string;
    'checkin.button': string;
    'checkin.doing': string;
    'checkin.done': string;
    'checkin.failed': string;
    'lastCheckin.label': string;
    'settings.title': string;
    'settings.expand': string;
    'settings.schedule': string;
    'settings.scheduleHint': string;
    'settings.save': string;
    'settings.saving': string;
    'settings.saved': string;
    'settings.credTitle': string;
    'settings.credError': string;
    'cred.trae-desktop': string;
    'cred.dsh': string;
    'cred.points-checkin': string;
    'cred.desktop': string;
    'cred.plugin-copy': string;
    'cred.manual': string;
    'cred.unavailable': string;
    'error.prefix': string;
};
/** The points-checkin namespace key union. */
export type PointsKey = keyof typeof zh;
/** English dictionary, key-for-key complete against zh. */
export declare const en: Record<PointsKey, string>;
