/**
 * PointsPanel — the sidebar.footer.action entry. Wide mode renders a trigger
 * row beside Settings; collapsed mode renders a 24px-rail icon. Clicking
 * opens an expanding card with per-service points, check-in status, manual
 * claim, and token settings. All upstream facts come from the host bridge
 * (see api.ts); the panel itself holds no tokens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  BridgeUnreachableError,
  checkin as bridgeCheckin,
  fetchCredentials,
  fetchState,
  saveCredentials,
  type CredentialsView,
  type ServiceSnapshot,
  type Snapshot,
} from './api.ts'
import type { PointsKey } from './locales.ts'
import { ensureStyles } from './styles.ts'

/** Component props: locale seat plus the sidebar's column state. */
export type PointsPanelProps = PropsLocale<'points-checkin'> & {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

function CoinIcon(): React.ReactElement {
  return (
    <svg className="dshpc-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6v6.8M6.2 6.4h3.2a1.5 1.5 0 0 1 0 3H6.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function dotClass(service: ServiceSnapshot): string {
  if (!service.configured) return ''
  if (service.error === 'auth') return ' bad'
  if (service.checkedIn) return ' ok'
  if (service.checkinEnabled === false) return ''
  return ' pending'
}

function statusText(service: ServiceSnapshot, t: (key: PointsKey) => string): string {
  if (!service.configured) return t('status.notConfigured')
  if (service.error === 'auth') return t('status.authFailed')
  if (service.checkinEnabled === false) return t('status.disabled')
  if (service.checkedIn === true) return t('status.checkedIn')
  if (service.checkedIn === false) return t('status.notCheckedIn')
  return t('status.unknown')
}

function canCheckin(service: ServiceSnapshot): boolean {
  return Boolean(
    service.configured
    && service.error !== 'auth'
    && service.checkinEnabled !== false
    && service.checkedIn !== true,
  )
}

function ServiceCard(
  props: { service: ServiceSnapshot; name: string; busy: boolean; onCheckin: () => void } & PropsLocale<'points-checkin'>,
): React.ReactElement {
  const { service, name, busy, onCheckin, t } = props
  return (
    <div className="dshpc-service">
      <div className="dshpc-service-head">
        <span className={`dshpc-dot${dotClass(service)}`} />
        <span className="dshpc-service-name">{name}</span>
        <span className="dshpc-status">{statusText(service, t)}</span>
      </div>
      <div className="dshpc-points">
        <span className="dshpc-points-value">{service.points ?? t('points.unknown')}</span>
        <span className="dshpc-points-label">{t('points.label')}</span>
      </div>
      {service.errorMessage && <div className="dshpc-error">{t('error.prefix')}: {service.errorMessage}</div>}
      <div className="dshpc-row">
        {service.checkedIn === true ? (
          <span className="dshpc-done">{t('status.checkedIn')}</span>
        ) : (
          <button
            type="button"
            className="dshpc-button primary"
            disabled={!canCheckin(service) || busy}
            onClick={onCheckin}
          >
            {busy ? t('checkin.doing') : t('checkin.button')}
          </button>
        )}
        {service.lastCheckin && service.checkedIn !== true && (
          <span className="dshpc-muted">{t('lastCheckin.label')}: {service.lastCheckin}</span>
        )}
      </div>
    </div>
  )
}

interface SettingsForm {
  traeToken: string
  traeDevice: string
  wbToken: string
  wbUser: string
}

function SettingsSection(
  props: {
    open: boolean
    form: SettingsForm
    saving: boolean
    saved: boolean
    onChange: (patch: Partial<SettingsForm>) => void
    onSave: () => void
  } & PropsLocale<'points-checkin'>,
): React.ReactElement | null {
  const { open, form, saving, saved, onChange, onSave, t } = props
  if (!open) return null
  return (
    <div className="dshpc-settings">
      <div className="dshpc-field">
        <label htmlFor="dshpc-trae-token">{t('settings.traeToken')}</label>
        <input
          id="dshpc-trae-token"
          className="dshpc-input"
          type="password"
          autoComplete="off"
          placeholder={t('settings.placeholder')}
          value={form.traeToken}
          onChange={(event) => onChange({ traeToken: event.target.value })}
        />
      </div>
      <div className="dshpc-field">
        <label htmlFor="dshpc-trae-device">{t('settings.traeDevice')}</label>
        <input
          id="dshpc-trae-device"
          className="dshpc-input"
          type="text"
          autoComplete="off"
          value={form.traeDevice}
          onChange={(event) => onChange({ traeDevice: event.target.value })}
        />
      </div>
      <div className="dshpc-field">
        <label htmlFor="dshpc-wb-token">{t('settings.wbToken')}</label>
        <input
          id="dshpc-wb-token"
          className="dshpc-input"
          type="password"
          autoComplete="off"
          placeholder={t('settings.placeholder')}
          value={form.wbToken}
          onChange={(event) => onChange({ wbToken: event.target.value })}
        />
      </div>
      <div className="dshpc-field">
        <label htmlFor="dshpc-wb-user">{t('settings.wbUser')}</label>
        <input
          id="dshpc-wb-user"
          className="dshpc-input"
          type="text"
          autoComplete="off"
          value={form.wbUser}
          onChange={(event) => onChange({ wbUser: event.target.value })}
        />
      </div>
      <div className="dshpc-row">
        <button type="button" className="dshpc-button" disabled={saving} onClick={onSave}>
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        {saved && <span className="dshpc-muted">{t('settings.saved')}</span>}
      </div>
      <p className="dshpc-hint">{t('settings.howTo')}</p>
    </div>
  )
}

/** The sidebar footer action and its expanding card. */
export function PointsPanel(props: PointsPanelProps): React.ReactElement {
  const { wide, t } = props
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [busyService, setBusyService] = useState<'trae' | 'workbuddy' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [form, setForm] = useState<SettingsForm>({ traeToken: '', traeDevice: '', wbToken: '', wbUser: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cardPos, setCardPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  useEffect(() => ensureStyles(), [])

  // Center the card in the viewport, clamped so it never leaves the screen.
  const updateCardPos = useCallback(() => {
    const width = 340
    const left = Math.max(8, Math.round((window.innerWidth - width) / 2))
    const top = Math.max(16, Math.round((window.innerHeight - 420) / 2))
    setCardPos({ left, top, maxHeight: window.innerHeight - top * 2 })
  }, [])

  const toggleOpen = useCallback(() => {
    setOpen((current) => {
      if (!current) updateCardPos()
      return !current
    })
  }, [updateCardPos])

  useEffect(() => {
    if (!open) return
    const onResize = (): void => updateCardPos()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, updateCardPos])

  const loadState = useCallback(async (refresh = false) => {
    try {
      const next = await fetchState(refresh)
      setSnapshot(next)
      setUnreachable(false)
    } catch (cause) {
      if (cause instanceof BridgeUnreachableError) setUnreachable(true)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadState(true)
    void fetchCredentials()
      .then((creds: CredentialsView) => {
        setForm({
          traeToken: creds.trae.token,
          traeDevice: creds.trae.deviceId,
          wbToken: creds.workbuddy.token,
          wbUser: creds.workbuddy.userId,
        })
      })
      .catch(() => {})
    const timer = setInterval(() => {
      void loadState(false)
    }, 60_000)
    return () => clearInterval(timer)
  }, [open, loadState])

  const doCheckin = useCallback(async (service: 'trae' | 'workbuddy') => {
    setBusyService(service)
    try {
      const next = await bridgeCheckin(service)
      setSnapshot(next)
      setUnreachable(false)
    } catch (cause) {
      if (cause instanceof BridgeUnreachableError) setUnreachable(true)
    } finally {
      setBusyService(null)
    }
  }, [])

  const doSave = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    try {
      const next = await saveCredentials({
        trae: { token: form.traeToken, deviceId: form.traeDevice || undefined },
        workbuddy: { token: form.wbToken, userId: form.wbUser || undefined },
      })
      setSnapshot(next)
      setUnreachable(false)
      setSaved(true)
    } catch {
      // Keep the form; the next refresh will surface the error kind.
    } finally {
      setSaving(false)
    }
  }, [form])

  const label = t('action.label')
  const dotClassSum = snapshot ? dotClass(snapshot.trae) || dotClass(snapshot.workbuddy) : ''
  const trigger = wide
    ? (
        <button
          type="button"
          className="dshpc-action dshpc-wide"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-label={label}
          title={label}
        >
          <CoinIcon />
          <span className="dshpc-label">{label}</span>
          <span className={`dshpc-dot${dotClassSum}`} />
        </button>
      )
    : (
        <button
          type="button"
          className="dshpc-action dshpc-rail"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-label={label}
          title={label}
        >
          <CoinIcon />
        </button>
      )

  return (
    <>
      {trigger}
      {open && cardPos && createPortal(
        <>
          <div className="dshpc-overlay" onClick={toggleOpen} />
          <div
            className="dshpc-card"
            role="dialog"
            aria-label={t('panel.title')}
            style={{ left: cardPos.left, top: cardPos.top, maxHeight: cardPos.maxHeight }}
          >
            <h2 className="dshpc-title">{t('panel.title')}</h2>
            {unreachable && <p className="dshpc-error">{t('panel.unreachable')}</p>}
            {!snapshot && !unreachable && <p className="dshpc-muted">{t('panel.loading')}</p>}
            {snapshot && (
              <>
                <ServiceCard
                  service={snapshot.trae}
                  name={t('service.trae')}
                  busy={busyService === 'trae'}
                  onCheckin={() => void doCheckin('trae')}
                  t={t}
                />
                <ServiceCard
                  service={snapshot.workbuddy}
                  name={t('service.workbuddy')}
                  busy={busyService === 'workbuddy'}
                  onCheckin={() => void doCheckin('workbuddy')}
                  t={t}
                />
              </>
            )}
            <div className="dshpc-row">
              <button type="button" className="dshpc-button" onClick={() => setSettingsOpen(!settingsOpen)}>
                {t('settings.expand')}
              </button>
            </div>
            <SettingsSection
              open={settingsOpen}
              form={form}
              saving={saving}
              saved={saved}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              onSave={() => void doSave()}
              t={t}
            />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
