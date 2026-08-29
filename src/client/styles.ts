/**
 * Stylesheet for the points-checkin panel, injected once per document.
 * Colors follow system Canvas tokens so the card tracks the app theme
 * (same discipline as the chat-timeline plugin).
 */
const STYLE_ID = 'dsh-points-checkin-styles'

/** Inject the plugin stylesheet once; safe to call on every mount. */
export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.dshpc-action {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 0; background: transparent; color: CanvasText; cursor: pointer;
  font: inherit; padding: 6px 10px; border-radius: 6px; text-align: left;
}
.dshpc-action:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
.dshpc-icon { width: 16px; height: 16px; flex: none; }
.dshpc-dot { width: 7px; height: 7px; border-radius: 999px; flex: none; background: color-mix(in srgb, CanvasText 30%, transparent); }
.dshpc-dot.ok { background: #34a853; }
.dshpc-dot.pending { background: #f5a623; }
.dshpc-dot.bad { background: #d93025; }
.dshpc-overlay {
  position: fixed; inset: 0; z-index: 60; background: transparent;
}
.dshpc-card {
  position: fixed; z-index: 61; left: 64px; top: 56px; width: 340px;
  max-height: calc(100vh - 80px); overflow: auto;
  background: Canvas; color: CanvasText; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
  border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 14px;
  font: 13px/1.5 system-ui, sans-serif;
}
.dshpc-title { font-size: 13px; font-weight: 600; margin: 0 0 10px; }
.dshpc-service { border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent); padding: 10px 0; }
.dshpc-service:first-of-type { border-top: 0; padding-top: 2px; }
.dshpc-service-head { display: flex; align-items: center; gap: 8px; }
.dshpc-service-name { font-weight: 600; }
.dshpc-status { color: color-mix(in srgb, CanvasText 55%, Canvas); margin-left: auto; }
.dshpc-points { display: flex; align-items: baseline; gap: 6px; margin-top: 6px; }
.dshpc-points-value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
.dshpc-points-label { color: color-mix(in srgb, CanvasText 55%, Canvas); }
.dshpc-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.dshpc-button {
  border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); background: Canvas;
  color: CanvasText; border-radius: 8px; padding: 4px 12px; cursor: pointer; font: inherit;
}
.dshpc-button:disabled { opacity: .55; cursor: default; }
.dshpc-button.primary { background: CanvasText; color: Canvas; }
.dshpc-error { color: #d93025; margin-top: 6px; font-size: 12px; }
.dshpc-muted { color: color-mix(in srgb, CanvasText 55%, Canvas); }
.dshpc-settings { margin-top: 10px; border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent); padding-top: 10px; }
.dshpc-field { margin-top: 8px; }
.dshpc-field label { display: block; font-size: 12px; margin-bottom: 3px; color: color-mix(in srgb, CanvasText 70%, Canvas); }
.dshpc-input {
  width: 100%; box-sizing: border-box; padding: 5px 8px; border-radius: 6px;
  border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
  background: Canvas; color: CanvasText; font: inherit; font-size: 12px;
}
.dshpc-hint { font-size: 12px; color: color-mix(in srgb, CanvasText 55%, Canvas); margin-top: 8px; }
`
  document.head.appendChild(style)
}
