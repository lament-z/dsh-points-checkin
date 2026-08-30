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
  fetchSettings,
  fetchState,
  saveCheckinTime,
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

/** One credential-source line in the settings block. */
function CredentialLine(
  props: { service: ServiceSnapshot; name: string } & PropsLocale<'points-checkin'>,
): React.ReactElement {
  const { service, name, t } = props
  const source = service.credentialSource
  const sourceLabel = source ? t(`cred.${source}` as Parameters<typeof t>[0]) : t('cred.unavailable')
  return (
    <div className="dshpc-cred-line">
      <span className={`dshpc-dot${service.error ? ' bad' : service.authOk ? ' ok' : ''}`} />
      <span className="dshpc-service-name">{name}</span>
      <span className="dshpc-status">{sourceLabel}</span>
      {service.errorMessage && (
        <div className="dshpc-error">{t('settings.credError')}: {service.errorMessage}</div>
      )}
    </div>
  )
}

function SettingsSection(
  props: {
    open: boolean
    snapshot: Snapshot | null
    time: string
    saving: boolean
    saved: boolean
    onTimeChange: (time: string) => void
    onSave: () => void
  } & PropsLocale<'points-checkin'>,
): React.ReactElement | null {
  const { open, snapshot, time, saving, saved, onTimeChange, onSave, t } = props
  if (!open) return null
  return (
    <div className="dshpc-settings">
      <p className="dshpc-hint">{t('settings.credTitle')}</p>
      {snapshot ? (
        <>
          <CredentialLine service={snapshot.trae} name={t('service.trae')} t={t} />
          <CredentialLine service={snapshot.workbuddy} name={t('service.workbuddy')} t={t} />
        </>
      ) : (
        <p className="dshpc-muted">{t('panel.loading')}</p>
      )}
      <div className="dshpc-field">
        <label htmlFor="dshpc-checkin-time">{t('settings.schedule')}</label>
        <input
          id="dshpc-checkin-time"
          className="dshpc-input"
          type="time"
          value={time}
          onChange={(event) => onTimeChange(event.target.value)}
        />
        <p className="dshpc-hint">{t('settings.scheduleHint')}</p>
      </div>
      <div className="dshpc-row">
        <button type="button" className="dshpc-button" disabled={saving || !time} onClick={onSave}>
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        {saved && <span className="dshpc-muted">{t('settings.saved')}</span>}
      </div>
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
  const [checkinTime, setCheckinTime] = useState('09:00')
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
    void fetchSettings()
      .then((settings) => setCheckinTime(settings.checkinTime))
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
      const settings = await saveCheckinTime(checkinTime)
      setCheckinTime(settings.checkinTime)
      setSaved(true)
    } catch {
      // The next save attempt retries; invalid values are rejected host-side.
    } finally {
      setSaving(false)
    }
  }, [checkinTime])

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
              snapshot={snapshot}
              time={checkinTime}
              saving={saving}
              saved={saved}
              onTimeChange={setCheckinTime}
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
