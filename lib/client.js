window.__ModuleLoader__.load({
	id: "@lament-z/dsh-points-checkin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/**
		* Browser-side client for the host bridge. The port is discovered by probing
		* a short fixed range for /ping (see host/bridge.ts); the working port is
		* cached for the page session.
		*/
		/** Ports the host bridge may be listening on, in probe order. */
		const PORT_CANDIDATES = [
			27182,
			27183,
			27184,
			27185,
			27186,
			27187,
			27188,
			27189,
			27190,
			27191
		];
		const PROBE_TIMEOUT_MS = 800;
		const REQUEST_TIMEOUT_MS = 15e3;
		/** Unreachable bridge (no candidate port answered). */
		var BridgeUnreachableError = class extends Error {
			constructor() {
				super("bridge unreachable");
				this.name = "BridgeUnreachableError";
			}
		};
		let cachedPort = null;
		let probing = null;
		async function probeOnce() {
			for (const port of PORT_CANDIDATES) {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
				try {
					const res = await fetch(`http://127.0.0.1:${port}/ping`, { signal: controller.signal });
					if (res.ok) {
						const body = await res.json();
						if (body.ok && body.plugin === "points-checkin") return port;
					}
				} catch {} finally {
					clearTimeout(timer);
				}
			}
			return null;
		}
		/** Probe rounds (the host may still be booting when the panel mounts). */
		const PROBE_ROUNDS = 3;
		const PROBE_ROUND_DELAY_MS = 700;
		async function probe() {
			for (let round = 0; round < PROBE_ROUNDS; round += 1) {
				if (round > 0) await new Promise((resolve) => setTimeout(resolve, PROBE_ROUND_DELAY_MS));
				const found = await probeOnce();
				if (found !== null) return found;
			}
			return null;
		}
		/** Resolve the bridge port, probing once per page session. */
		async function bridgePort() {
			if (cachedPort !== null) return cachedPort;
			if (!probing) probing = probe().finally(() => {
				probing = null;
			});
			const found = await probing;
			if (found === null) return null;
			cachedPort = found;
			return found;
		}
		/** Forget the cached port (call after connection failures). */
		function resetBridgePort() {
			cachedPort = null;
		}
		async function call(path, init) {
			const port = await bridgePort();
			if (port === null) throw new BridgeUnreachableError();
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
			try {
				const res = await fetch(`http://127.0.0.1:${port}${path}`, {
					...init,
					signal: controller.signal
				});
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					const error = new Error(body.error ?? `bridge returned HTTP ${res.status}`);
					error.kind = body.kind;
					throw error;
				}
				return await res.json();
			} catch (cause) {
				if (cause instanceof TypeError) resetBridgePort();
				throw cause;
			} finally {
				clearTimeout(timer);
			}
		}
		/** Fetch the full snapshot (pass refresh to force upstream probes). */
		function fetchState(refresh = false) {
			return call(`/state${refresh ? "?refresh=1" : ""}`);
		}
		/** Claim one service's daily reward, then the refreshed snapshot. */
		function checkin(service) {
			return call(`/checkin/${service}`, { method: "POST" });
		}
		/** Load the stored credentials (values included; localhost-only bridge). */
		function fetchCredentials() {
			return call("/credentials");
		}
		/** Save a credentials patch, returning the refreshed snapshot. */
		function saveCredentials(patch) {
			return call("/credentials", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch)
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Stylesheet for the points-checkin panel, injected once per document.
		* Colors follow system Canvas tokens so the card tracks the app theme
		* (same discipline as the chat-timeline plugin).
		*/
		const STYLE_ID = "dsh-points-checkin-styles";
		/** Inject the plugin stylesheet once; safe to call on every mount. */
		function ensureStyles() {
			if (document.getElementById(STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
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
`;
			document.head.appendChild(style);
		}
		//#endregion
		//#region src/client/panel.tsx
		/**
		* PointsPanel — the sidebar.footer.action entry. Wide mode renders a trigger
		* row beside Settings; collapsed mode renders a 24px-rail icon. Clicking
		* opens an expanding card with per-service points, check-in status, manual
		* claim, and token settings. All upstream facts come from the host bridge
		* (see api.ts); the panel itself holds no tokens.
		*/
		function CoinIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "dshpc-icon",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "8",
					cy: "8",
					r: "6.4",
					stroke: "currentColor",
					strokeWidth: "1.4"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 4.6v6.8M6.2 6.4h3.2a1.5 1.5 0 0 1 0 3H6.2",
					stroke: "currentColor",
					strokeWidth: "1.3",
					strokeLinecap: "round"
				})]
			});
		}
		function dotClass(service) {
			if (!service.configured) return "";
			if (service.error === "auth") return " bad";
			if (service.checkedIn) return " ok";
			if (service.checkinEnabled === false) return "";
			return " pending";
		}
		function statusText(service, t) {
			if (!service.configured) return t("status.notConfigured");
			if (service.error === "auth") return t("status.authFailed");
			if (service.checkinEnabled === false) return t("status.disabled");
			if (service.checkedIn === true) return t("status.checkedIn");
			if (service.checkedIn === false) return t("status.notCheckedIn");
			return t("status.unknown");
		}
		function canCheckin(service) {
			return Boolean(service.configured && service.error !== "auth" && service.checkinEnabled !== false && service.checkedIn !== true);
		}
		function ServiceCard(props) {
			const { service, name, busy, onCheckin, t } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshpc-service",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-service-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dshpc-dot${dotClass(service)}` }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshpc-service-name",
								children: name
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshpc-status",
								children: statusText(service, t)
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-points",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshpc-points-value",
							children: service.points ?? t("points.unknown")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshpc-points-label",
							children: t("points.label")
						})]
					}),
					service.errorMessage && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-error",
						children: [
							t("error.prefix"),
							": ",
							service.errorMessage
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshpc-button primary",
							disabled: !canCheckin(service) || busy,
							onClick: onCheckin,
							children: busy ? t("checkin.doing") : t("checkin.button")
						}), service.lastCheckin && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dshpc-muted",
							children: [
								t("lastCheckin.label"),
								": ",
								service.lastCheckin
							]
						})]
					})
				]
			});
		}
		function SettingsSection(props) {
			const { open, form, saving, saved, onChange, onSave, t } = props;
			if (!open) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshpc-settings",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "dshpc-trae-token",
							children: t("settings.traeToken")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "dshpc-trae-token",
							className: "dshpc-input",
							type: "password",
							autoComplete: "off",
							placeholder: t("settings.placeholder"),
							value: form.traeToken,
							onChange: (event) => onChange({ traeToken: event.target.value })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "dshpc-trae-device",
							children: t("settings.traeDevice")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "dshpc-trae-device",
							className: "dshpc-input",
							type: "text",
							autoComplete: "off",
							value: form.traeDevice,
							onChange: (event) => onChange({ traeDevice: event.target.value })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "dshpc-wb-token",
							children: t("settings.wbToken")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "dshpc-wb-token",
							className: "dshpc-input",
							type: "password",
							autoComplete: "off",
							placeholder: t("settings.placeholder"),
							value: form.wbToken,
							onChange: (event) => onChange({ wbToken: event.target.value })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-field",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							htmlFor: "dshpc-wb-user",
							children: t("settings.wbUser")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							id: "dshpc-wb-user",
							className: "dshpc-input",
							type: "text",
							autoComplete: "off",
							value: form.wbUser,
							onChange: (event) => onChange({ wbUser: event.target.value })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshpc-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshpc-button",
							disabled: saving,
							onClick: onSave,
							children: saving ? t("settings.saving") : t("settings.save")
						}), saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshpc-muted",
							children: t("settings.saved")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshpc-hint",
						children: t("settings.howTo")
					})
				]
			});
		}
		/** The sidebar footer action and its expanding card. */
		function PointsPanel(props) {
			const { wide, t } = props;
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [unreachable, setUnreachable] = (0, react.useState)(false);
			const [busyService, setBusyService] = (0, react.useState)(null);
			const [settingsOpen, setSettingsOpen] = (0, react.useState)(false);
			const [form, setForm] = (0, react.useState)({
				traeToken: "",
				traeDevice: "",
				wbToken: "",
				wbUser: ""
			});
			const [saving, setSaving] = (0, react.useState)(false);
			const [saved, setSaved] = (0, react.useState)(false);
			const cardRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => ensureStyles(), []);
			const loadState = (0, react.useCallback)(async (refresh = false) => {
				try {
					const next = await fetchState(refresh);
					setSnapshot(next);
					setUnreachable(false);
				} catch (cause) {
					if (cause instanceof BridgeUnreachableError) setUnreachable(true);
				}
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				loadState(true);
				fetchCredentials().then((creds) => {
					setForm({
						traeToken: creds.trae.token,
						traeDevice: creds.trae.deviceId,
						wbToken: creds.workbuddy.token,
						wbUser: creds.workbuddy.userId
					});
				}).catch(() => {});
				const timer = setInterval(() => {
					loadState(false);
				}, 6e4);
				return () => clearInterval(timer);
			}, [open, loadState]);
			const doCheckin = (0, react.useCallback)(async (service) => {
				setBusyService(service);
				try {
					const next = await checkin(service);
					setSnapshot(next);
					setUnreachable(false);
				} catch (cause) {
					if (cause instanceof BridgeUnreachableError) setUnreachable(true);
				} finally {
					setBusyService(null);
				}
			}, []);
			const doSave = (0, react.useCallback)(async () => {
				setSaving(true);
				setSaved(false);
				try {
					const next = await saveCredentials({
						trae: {
							token: form.traeToken,
							deviceId: form.traeDevice || void 0
						},
						workbuddy: {
							token: form.wbToken,
							userId: form.wbUser || void 0
						}
					});
					setSnapshot(next);
					setUnreachable(false);
					setSaved(true);
				} catch {} finally {
					setSaving(false);
				}
			}, [form]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dshpc-action",
				onClick: () => setOpen(!open),
				"aria-expanded": open,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CoinIcon, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("action.label") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `dshpc-dot${snapshot ? dotClass(snapshot.trae) || dotClass(snapshot.workbuddy) : ""}` })
				]
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dshpc-action",
				onClick: () => setOpen(!open),
				"aria-expanded": open,
				"aria-label": t("action.iconLabel"),
				title: t("action.iconLabel"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CoinIcon, {})
			}), open && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshpc-overlay",
				onClick: () => setOpen(false)
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshpc-card",
				ref: cardRef,
				role: "dialog",
				"aria-label": t("panel.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						className: "dshpc-title",
						children: t("panel.title")
					}),
					unreachable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshpc-error",
						children: t("panel.unreachable")
					}),
					!snapshot && !unreachable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshpc-muted",
						children: t("panel.loading")
					}),
					snapshot && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServiceCard, {
						service: snapshot.trae,
						name: t("service.trae"),
						busy: busyService === "trae",
						onCheckin: () => void doCheckin("trae"),
						t
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServiceCard, {
						service: snapshot.workbuddy,
						name: t("service.workbuddy"),
						busy: busyService === "workbuddy",
						onCheckin: () => void doCheckin("workbuddy"),
						t
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshpc-row",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dshpc-button",
							onClick: () => setSettingsOpen(!settingsOpen),
							children: t("settings.expand")
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsSection, {
						open: settingsOpen,
						form,
						saving,
						saved,
						onChange: (patch) => setForm((current) => ({
							...current,
							...patch
						})),
						onSave: () => void doSave(),
						t
					})
				]
			})] }), document.body)] });
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Locale dictionaries for the points-checkin plugin. `zh` is the key-set
		* source of truth; `en` keeps a full key-for-key mirror. Registered through
		* ctx.locale.register(NS, { zh, en }).
		*/
		/** Simplified Chinese dictionary (key-set source of truth). */
		const zh = {
			"action.label": "积分签到",
			"action.iconLabel": "积分签到",
			"panel.title": "积分与签到",
			"panel.unreachable": "无法连接 DSH 宿主服务，请确认 DSH 正在运行。",
			"panel.loading": "加载中…",
			"service.trae": "TRAE",
			"service.workbuddy": "WorkBuddy",
			"status.notConfigured": "未配置 token",
			"status.authFailed": "token 已失效",
			"status.checkedIn": "今日已签到",
			"status.notCheckedIn": "今日未签到",
			"status.disabled": "活动未开启",
			"status.unknown": "状态未知",
			"points.label": "积分",
			"points.unknown": "—",
			"checkin.button": "签到",
			"checkin.doing": "签到中…",
			"checkin.done": "已完成",
			"checkin.failed": "签到失败",
			"lastCheckin.label": "上次签到",
			"settings.title": "Token 设置",
			"settings.expand": "设置",
			"settings.traeToken": "TRAE token",
			"settings.traeDevice": "TRAE 设备 ID（可选）",
			"settings.wbToken": "WorkBuddy token",
			"settings.wbUser": "WorkBuddy 用户 ID（可选）",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.saved": "已保存",
			"settings.placeholder": "粘贴 token",
			"settings.howTo": "在网页控制台登录后，用 DevTools 从请求头中复制；详见插件 README。",
			"error.prefix": "错误"
		};
		/** English dictionary, key-for-key complete against zh. */
		const en = {
			"action.label": "Points & check-in",
			"action.iconLabel": "Points & check-in",
			"panel.title": "Points & daily check-in",
			"panel.unreachable": "Cannot reach the DSH host bridge. Make sure DSH is running.",
			"panel.loading": "Loading…",
			"service.trae": "TRAE",
			"service.workbuddy": "WorkBuddy",
			"status.notConfigured": "Token not configured",
			"status.authFailed": "Token expired",
			"status.checkedIn": "Checked in today",
			"status.notCheckedIn": "Not checked in today",
			"status.disabled": "Campaign disabled",
			"status.unknown": "Unknown status",
			"points.label": "Points",
			"points.unknown": "—",
			"checkin.button": "Check in",
			"checkin.doing": "Checking in…",
			"checkin.done": "Done",
			"checkin.failed": "Check-in failed",
			"lastCheckin.label": "Last check-in",
			"settings.title": "Token settings",
			"settings.expand": "Settings",
			"settings.traeToken": "TRAE token",
			"settings.traeDevice": "TRAE device ID (optional)",
			"settings.wbToken": "WorkBuddy token",
			"settings.wbUser": "WorkBuddy user ID (optional)",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saved": "Saved",
			"settings.placeholder": "Paste token",
			"settings.howTo": "Log in on the web console and copy the header value with DevTools; see the plugin README.",
			"error.prefix": "Error"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "points-checkin";
		/** Unique occupant id inside the sidebar footer action list. */
		const ENTRY_ID = "points-checkin";
		/** Services required by this plugin. */
		const inject = ["slots", "locale"];
		/**
		* Register the sidebar entry.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				try {
					return ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {
					return () => {};
				}
			}, "points-checkin: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => {
				try {
					return ctx.slots.register({
						name: "sidebar.footer.action",
						id: ENTRY_ID,
						locale: NS
					}, PointsPanel);
				} catch {
					return () => {};
				}
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map