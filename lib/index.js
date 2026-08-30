import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path, { join } from "node:path";
import { createServer } from "node:http";
//#region src/host/errors.ts
var ApiError = class extends Error {
	kind;
	/** Upstream business code, when the failure came from a code != 0 body. */
	code;
	constructor(kind, message, code) {
		super(message);
		this.name = "ApiError";
		this.kind = kind;
		this.code = code;
	}
};
//#endregion
//#region src/host/store.ts
/**
* Durable storage for the points-checkin plugin: credentials and check-in
* state as JSON files under ~/.dsh-points-checkin (0600). Tokens never reach
* logs; the directory can be overridden for tests.
*/
/** Storage directory (overridable for tests via DSH_POINTS_CHECKIN_DIR). */
function storeDir() {
	return process.env.DSH_POINTS_CHECKIN_DIR ?? path.join(homedir(), ".dsh-points-checkin");
}
async function readJson(file) {
	try {
		return JSON.parse(await readFile(path.join(storeDir(), file), "utf8"));
	} catch {
		return;
	}
}
async function writeJson(file, value) {
	const dir = storeDir();
	await mkdir(dir, { recursive: true });
	const tmp = path.join(dir, `${file}.tmp`);
	await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 384 });
	await chmod(tmp, 384);
	await rename(tmp, path.join(dir, file));
}
/** Load credentials; undefined fields mean unset. */
async function readCredentials() {
	return await readJson("credentials.json") ?? {};
}
/** Persist credentials atomically with owner-only permissions. */
async function writeCredentials(credentials) {
	await writeJson("credentials.json", credentials);
}
/** Load check-in state. */
async function readState() {
	return await readJson("state.json") ?? {};
}
/** Persist check-in state atomically. */
async function writeState(state) {
	await writeJson("state.json", state);
}
/** Local calendar date (YYYY-MM-DD) for "checked in today" comparisons. */
function todayLocal() {
	const now = /* @__PURE__ */ new Date();
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}
/** Default settings; a fresh install checks in at 09:00 local time. */
const DEFAULT_SETTINGS = { checkinTime: "09:00" };
function normalizeTime(value) {
	return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : DEFAULT_SETTINGS.checkinTime;
}
/** Load plugin settings with defaults filled in. */
async function readSettings() {
	return { checkinTime: normalizeTime((await readJson("settings.json"))?.checkinTime) };
}
/** Persist plugin settings atomically. */
async function writeSettings(settings) {
	await writeJson("settings.json", settings);
}
//#endregion
//#region src/host/trae.ts
/**
* TRAE check-in credits API client, modeled on dsh-trae-connect's credential
* path (the sanctioned integration this plugin defers to).
*
* Credential: the desktop app's `x-ide-token` (the same value the web console
* stores as `Cloud-IDE-Token`). Sources, latest expiry winning:
*   1. a manually pasted token (plugin settings; explicit user choice),
*   2. the bridge export `<appDir>/trae-auth.json` (written by
*      dsh-trae-connect's capture tool),
*   3. dsh-trae-connect's plugin-owned copy `~/.dsh/.trae-auth.json`
*      (read-only; kept fresh by its refresh scheduler),
*   4. this plugin's own copy under its store dir (refreshes we perform).
*
* Refresh: the two-step OAuth ExchangeToken on api.trae.cn rotates the
* refresh token and mints a fresh ideToken, persisted to our own copy.
* Both endpoints here authenticate with `Authorization: Cloud-IDE-JWT` plus
* the x-device-id header (NOT Bearer).
*/
const TRAE_BASE = "https://api.trae.cn";
/** Public CN OAuth client id (not a secret; required by the ExchangeToken path). */
const CN_CLIENT_ID = "ono9krqynydwx5";
/** Fallback device id when the credential carries no device block. */
const FALLBACK_DEVICE_ID = "dsh-points-checkin";
const STATUS_PATH = "/trae/api/v2/ug/checkin_credits/status";
const CLAIM_PATH = "/trae/api/v2/ug/checkin_credits/claim";
const ENTITLEMENTS_PATH = "/trae/api/v2/pay/user_current_entitlement_list";
const EXCHANGE_PATH = "/cloudide/api/v3/trae/oauth/ExchangeToken";
/** Normalize an expiry that may arrive in seconds or milliseconds. */
function expiryToMs$1(value) {
	if (value <= 0) return 0;
	return value > 0xe8d4a51000 ? value : value * 1e3;
}
/** Read the real expiry out of the ideToken JWT's exp claim. */
function ideTokenExpiryMs(ideToken) {
	try {
		const payload = ideToken.split(".")[1];
		if (!payload) return 0;
		const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
		const exp = JSON.parse(Buffer.from(padded, "base64").toString("utf8")).exp;
		return typeof exp === "number" ? expiryToMs$1(exp) : 0;
	} catch {
		return 0;
	}
}
function randomDeviceId() {
	return String(Math.floor(Math.random() * 9e15) + 0x38d7ea4c68000);
}
/**
* Parse a TRAE auth document: either the bridge export shape
* `{ideToken, appId, clientId?, userId?, refreshToken?, expiresAt?, device?}`
* or the plugin-owned-copy shape `{version:1, credential:{...}}`.
*/
function parseTraeAuth(text, source) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const doc = parsed;
	const inner = typeof doc["credential"] === "object" && doc["credential"] !== null ? doc["credential"] : doc;
	const ideToken = typeof inner["ideToken"] === "string" ? inner["ideToken"] : "";
	if (ideToken === "") return void 0;
	const rawDevice = typeof inner["device"] === "object" && inner["device"] !== null ? inner["device"] : {};
	const device = {
		deviceId: typeof rawDevice["deviceId"] === "string" && rawDevice["deviceId"] !== "" ? rawDevice["deviceId"] : randomDeviceId(),
		...typeof rawDevice["deviceBrand"] === "string" ? { deviceBrand: rawDevice["deviceBrand"] } : {},
		...typeof rawDevice["deviceType"] === "string" ? { deviceType: rawDevice["deviceType"] } : {}
	};
	const expiresAtMs = typeof inner["expiresAt"] === "number" ? expiryToMs$1(inner["expiresAt"]) : typeof inner["tokenExpiresAtMs"] === "number" && inner["tokenExpiresAtMs"] > 0 ? expiryToMs$1(inner["tokenExpiresAtMs"]) : ideTokenExpiryMs(ideToken);
	return {
		ideToken,
		appId: typeof inner["appId"] === "string" ? inner["appId"] : "",
		clientId: typeof inner["clientId"] === "string" ? inner["clientId"] : "",
		userId: typeof inner["userId"] === "string" ? inner["userId"] : "",
		...typeof inner["refreshToken"] === "string" && inner["refreshToken"] !== "" ? { refreshToken: inner["refreshToken"] } : {},
		expiresAtMs,
		device,
		source
	};
}
/** Desktop app-dir candidates (probe order; mirrors dsh-trae-connect). */
function traeAppDirCandidates() {
	const home = homedir();
	const fromEnv = process.env.TRAE_APP_DIR?.trim();
	if (fromEnv) return [fromEnv];
	if (process.platform === "darwin") {
		const base = join(home, "Library", "Application Support");
		return [join(base, "TRAE SOLO CN"), join(base, "Trae")];
	}
	if (process.platform === "win32") {
		const base = process.env.APPDATA ?? join(home, "AppData", "Roaming");
		return [join(base, "TRAE SOLO CN"), join(base, "Trae")];
	}
	const base = join(home, ".config");
	return [join(base, "TRAE SOLO CN"), join(base, "Trae")];
}
/** dsh-trae-connect's plugin-owned copy (read-only for us). */
function traeConnectOwnPath() {
	return join(homedir(), ".dsh", ".trae-auth.json");
}
/** This plugin's own refreshed-token copy. */
function ownCopyPath$1() {
	return join(storeDir(), "trae-auth-copy.json");
}
/** Later non-zero expiry wins. */
function laterExpiry$1(a, b) {
	return (b.expiresAtMs || 0) > (a.expiresAtMs || 0) ? b : a;
}
/**
* Best available credential. The manual token participates in the same
* latest-expiry comparison as the file sources, so a stale pasted token
* automatically yields to a fresher desktop capture instead of blocking it.
*/
async function resolveTraeCredential(manualToken) {
	let credential;
	if (manualToken) credential = {
		ideToken: manualToken,
		appId: "",
		clientId: "",
		userId: "",
		expiresAtMs: ideTokenExpiryMs(manualToken),
		device: { deviceId: FALLBACK_DEVICE_ID },
		source: "manual"
	};
	const candidates = [
		...traeAppDirCandidates().map((dir) => [join(dir, "trae-auth.json"), "trae-desktop"]),
		[traeConnectOwnPath(), "dsh"],
		[ownCopyPath$1(), "points-checkin"]
	];
	for (const [path, source] of candidates) try {
		const parsed = parseTraeAuth(await readFile(path, "utf8"), source);
		if (!parsed) continue;
		credential = credential ? laterExpiry$1(credential, parsed) : parsed;
	} catch {}
	return credential;
}
/** Persist a refreshed credential to this plugin's own copy (0600). */
async function persistTraeCredential(credential) {
	await writeFile(ownCopyPath$1(), JSON.stringify({
		version: 1,
		credential
	}, null, 2), { mode: 384 });
}
function headers(credential) {
	const out = {
		"content-type": "application/json",
		authorization: `Cloud-IDE-JWT ${credential.ideToken}`,
		"x-device-id": credential.device.deviceId || FALLBACK_DEVICE_ID
	};
	if (credential.device.deviceBrand) out["x-device-brand"] = credential.device.deviceBrand;
	if (credential.device.deviceType) out["x-device-type"] = credential.device.deviceType;
	return out;
}
/** Whether an HTTP status / business code means "the ideToken is dead". */
function isAuthFailure(code, http) {
	return http === 401 || http === 403 || code === 1001;
}
async function post(path, credential, fetchFn) {
	let res;
	try {
		res = await fetchFn(`${TRAE_BASE}${path}`, {
			method: "POST",
			headers: headers(credential),
			body: "{}",
			signal: AbortSignal.timeout(3e4)
		});
	} catch (cause) {
		throw new ApiError("network", `trae ${path} request failed: ${String(cause)}`);
	}
	let body;
	try {
		body = await res.json();
	} catch {
		if (!res.ok) throw new ApiError("network", `trae ${path} returned HTTP ${res.status}`);
		throw new ApiError("protocol", `trae ${path} returned a non-JSON body`);
	}
	const code = typeof body.code === "number" ? body.code : void 0;
	if (isAuthFailure(code, res.status)) throw new ApiError("auth", `trae ${path} rejected the credential (HTTP ${res.status} code ${code})`);
	if (!res.ok) throw new ApiError("network", `trae ${path} returned HTTP ${res.status}`);
	if (code !== void 0 && code !== 0) throw new ApiError("business", `trae ${path} business error ${code}: ${body.message ?? ""}`, code);
	return body;
}
function flat(body) {
	return body.data ?? body;
}
/** Query the daily check-in status. */
async function traeStatus(credential, fetchFn = fetch) {
	const flatBody = flat(await post(STATUS_PATH, credential, fetchFn));
	if (typeof flatBody.enable !== "boolean" || typeof flatBody.checked_in !== "boolean") throw new ApiError("protocol", "trae status body missed enable/checked_in");
	const credits = typeof flatBody.credits === "number" ? flatBody.credits : void 0;
	return {
		enable: flatBody.enable,
		checkedIn: flatBody.checked_in,
		credits
	};
}
/** Claim today's check-in credits. */
async function traeClaim(credential, fetchFn = fetch) {
	await post(CLAIM_PATH, credential, fetchFn);
}
/**
* Query the credits ledger — the dashboard's own source for 总可用积分.
* checkin_credits/status's `credits` field is only the check-in sub-wallet.
*/
async function traeEntitlements(credential, fetchFn = fetch) {
	const summary = flat(await post(ENTITLEMENTS_PATH, credential, fetchFn))["usage_summary"] ?? {};
	const total = typeof summary["total_amount"] === "number" ? summary["total_amount"] : NaN;
	const consumed = typeof summary["consumed_amount"] === "number" ? summary["consumed_amount"] : NaN;
	if (Number.isNaN(total) || Number.isNaN(consumed)) throw new ApiError("protocol", "trae entitlement list missed usage_summary amounts");
	return {
		remaining: Math.max(0, Math.round((total - consumed) * 100) / 100),
		totalAmount: total,
		consumedAmount: consumed
	};
}
/**
* Two-step OAuth exchange: refreshToken -> rotated refreshToken -> ideToken.
* The result is persisted to this plugin's own copy so it wins on next resolve.
*/
async function traeRefresh(credential, fetchFn = fetch) {
	const clientId = credential.clientId || CN_CLIENT_ID;
	if (!credential.refreshToken || !credential.userId) throw new ApiError("auth", "trae credential has no refresh token/user id; re-capture from the desktop app");
	const exchange = async (refreshToken) => {
		let res;
		try {
			res = await fetchFn(`${TRAE_BASE}${EXCHANGE_PATH}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					ClientID: clientId,
					RefreshToken: refreshToken,
					ClientSecret: "-",
					UserID: credential.userId
				}),
				signal: AbortSignal.timeout(3e4)
			});
		} catch (cause) {
			throw new ApiError("network", `trae token exchange failed: ${String(cause)}`);
		}
		if (!res.ok) throw new ApiError("auth", `trae token exchange failed (HTTP ${res.status})`);
		const json = await res.json().catch(() => ({}));
		if (!json.Result?.Token) throw new ApiError("auth", "trae token exchange returned no Token");
		return json.Result;
	};
	const first = await exchange(credential.refreshToken);
	const second = await exchange(first.RefreshToken ?? credential.refreshToken);
	const refreshed = {
		...credential,
		ideToken: second.Token ?? first.Token ?? credential.ideToken,
		expiresAtMs: second.TokenExpireAt ?? first.TokenExpireAt ?? 0,
		refreshToken: second.RefreshToken ?? first.RefreshToken ?? credential.refreshToken,
		source: "points-checkin"
	};
	await persistTraeCredential(refreshed);
	return refreshed;
}
//#endregion
//#region src/host/workbuddy.ts
/**
* WorkBuddy (CodeBuddy) upstream client, modeled on dsh-workbuddy-connect
* 0.2.3 (the sanctioned integration this plugin defers to).
*
* Credential source: the WorkBuddy desktop app stores a plaintext auth
* document (accessToken/refreshToken/expiry + account identity) at
* ~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/
* workbuddy-desktop.info. This module reads it read-only, keeps refreshed
* tokens in its own copy under the plugin store (the later expiry wins, so
* a refresh by either side is honored), and auto-refreshes via the
* X-Refresh-Token endpoint before expiry.
*
* Endpoints (CN): billing https://www.codebuddy.cn (meter paths carry the
* /v2 prefix with Bearer auth), chat https://copilot.tencent.com.
*/
/** Desktop auth file candidates (probe order; mirrors dsh-workbuddy-connect). */
function desktopAuthCandidates() {
	const home = homedir();
	if (process.platform === "darwin") return [join(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info")];
	if (process.platform === "win32") return [join(home, "AppData", "Local", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info"), join(home, "AppData", "Roaming", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info")];
	return [join(home, ".config", "CodeBuddyExtension", "Data", "Public", "auth", "workbuddy-desktop.info")];
}
/** Expiry may arrive in seconds or milliseconds. */
function expiryToMs(value) {
	if (value <= 0) return 0;
	return value > 0xe8d4a51000 ? value : value * 1e3;
}
function optionalString(value) {
	return typeof value === "string" && value !== "" ? value : void 0;
}
/** Parse the desktop document in either shape (nested auth/account or flat). */
function parseDesktopAuth(text) {
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		return;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
	const document = parsed;
	const auth = typeof document["auth"] === "object" && document["auth"] !== null ? document["auth"] : document;
	const identity = typeof document["auth"] === "object" && document["auth"] !== null ? document["account"] ?? {} : document;
	const accessToken = typeof auth["accessToken"] === "string" ? auth["accessToken"] : "";
	if (accessToken === "") return void 0;
	const enterpriseId = optionalString(identity["enterpriseId"]);
	return {
		accessToken,
		refreshToken: typeof auth["refreshToken"] === "string" ? auth["refreshToken"] : "",
		expiresAtMs: typeof auth["expiresAt"] === "number" ? expiryToMs(auth["expiresAt"]) : 0,
		...typeof auth["refreshExpiresAt"] === "number" ? { refreshExpiresAtMs: expiryToMs(auth["refreshExpiresAt"]) } : {},
		uid: optionalString(identity["uid"]) ?? "",
		...enterpriseId === void 0 ? {} : { enterpriseId },
		domain: optionalString(auth["domain"]) ?? "",
		source: "desktop"
	};
}
/** Plugin-owned copy path (refreshed tokens land here; desktop file is never written). */
function ownCopyPath() {
	return join(storeDir(), "workbuddy-auth-copy.json");
}
async function readOwnCopy() {
	try {
		const text = await readFile(ownCopyPath(), "utf8");
		const parsed = JSON.parse(text);
		if (parsed?.credential?.accessToken) return {
			...parsed.credential,
			source: "plugin-copy"
		};
	} catch {}
}
async function writeOwnCopy(credential) {
	await writeFile(ownCopyPath(), JSON.stringify({
		version: 1,
		credential
	}, null, 2), { mode: 384 });
}
/** Later expiry wins, so a refresh by either the app or this plugin is honored. */
function laterExpiry(a, b) {
	return (b.expiresAtMs || 0) > (a.expiresAtMs || 0) ? b : a;
}
/** Best available credential: manual token, else plugin copy vs desktop file. */
async function resolveStoredCredential(manualToken) {
	if (manualToken) return {
		accessToken: manualToken,
		refreshToken: "",
		expiresAtMs: 0,
		uid: "",
		domain: "",
		source: "manual"
	};
	let credential = await readOwnCopy();
	for (const candidate of desktopAuthCandidates()) try {
		const parsed = parseDesktopAuth(await readFile(candidate, "utf8"));
		if (!parsed) continue;
		credential = credential ? laterExpiry(credential, parsed) : parsed;
	} catch {}
	return credential;
}
/** Persist a refreshed credential into the plugin-owned copy. */
async function persistRefreshedCredential(credential) {
	await writeOwnCopy(credential);
}
const CN_BILLING_BASE = "https://www.codebuddy.cn";
const GLOBAL_BILLING_BASE = "https://www.workbuddy.ai";
const CN_CHAT_BASE = "https://copilot.tencent.com";
const GLOBAL_CHAT_BASE = "https://www.workbuddy.ai";
/** Mirrors the official CLI UA the upstream expects. */
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
function isGlobal(domain) {
	const lowered = domain.trim().toLowerCase();
	return lowered === "workbuddy.ai" || lowered.endsWith(".workbuddy.ai");
}
function billingBase(credential) {
	return isGlobal(credential.domain) ? GLOBAL_BILLING_BASE : CN_BILLING_BASE;
}
function chatBase(credential) {
	return isGlobal(credential.domain) ? GLOBAL_CHAT_BASE : CN_CHAT_BASE;
}
function billingHeaders(credential) {
	const headers = {
		authorization: `Bearer ${credential.accessToken}`,
		accept: "application/json",
		"content-type": "application/json",
		"user-agent": CLIENT_UA
	};
	if (credential.uid !== "") headers["x-user-id"] = credential.uid;
	if (credential.enterpriseId) {
		headers["x-enterprise-id"] = credential.enterpriseId;
		headers["x-tenant-id"] = credential.enterpriseId;
	}
	if (credential.domain !== "") headers["x-domain"] = credential.domain;
	return headers;
}
async function readEnvelope(res) {
	try {
		return await res.json();
	} catch {
		throw new ApiError("protocol", "workbuddy returned a non-JSON body");
	}
}
async function billingPost(credential, path, body, fetchFn) {
	let res;
	try {
		res = await fetchFn(`${billingBase(credential)}${path}`, {
			method: "POST",
			headers: billingHeaders(credential),
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(3e4)
		});
	} catch (cause) {
		throw new ApiError("network", `workbuddy ${path} request failed: ${String(cause)}`);
	}
	if (res.status === 401 || res.status === 403) throw new ApiError("auth", `workbuddy ${path} rejected the credential (HTTP ${res.status})`);
	let envelope = {};
	try {
		envelope = await res.json();
	} catch {
		if (!res.ok) throw new ApiError("network", `workbuddy ${path} returned HTTP ${res.status}`);
		throw new ApiError("protocol", `workbuddy ${path} returned a non-JSON body`);
	}
	if (typeof envelope.code === "number" && envelope.code !== 0) throw new ApiError("business", `workbuddy ${path} business error ${envelope.code}: ${envelope.msg ?? ""}`, envelope.code);
	if (!res.ok) throw new ApiError("network", `workbuddy ${path} returned HTTP ${res.status}`);
	return envelope.data ?? envelope;
}
/** POST with the /v2 prefix first, falling back to the bare path (web-console shape). */
async function billingPostWithFallback(credential, path, body, fetchFn) {
	try {
		return await billingPost(credential, `/v2${path}`, body, fetchFn);
	} catch (cause) {
		if (cause instanceof ApiError && (cause.kind === "protocol" || cause.message.includes("HTTP 404"))) return billingPost(credential, path, body, fetchFn);
		throw cause;
	}
}
function extractRemain(account) {
	const num = (key) => typeof account[key] === "number" ? account[key] : 0;
	const size = num("CycleCapacitySize");
	const cycleRemain = num("CycleCapacityRemain");
	const cycleUsed = num("CycleCapacityUsed");
	const remain = size > 0 || cycleRemain > 0 || cycleUsed > 0 ? cycleRemain : num("CapacityRemain");
	return {
		remain: Math.max(0, remain),
		size: size > 0 ? size : num("CapacitySize")
	};
}
/** Sum remaining credit across packages, per the official client's algorithm. */
function parseAccounts(data) {
	const wrapper = data ?? {};
	const inner = (wrapper["Response"] ?? {})["Data"] ?? wrapper["Data"] ?? {};
	const rawAccounts = Array.isArray(inner["Accounts"]) ? inner["Accounts"] : [];
	const accounts = [];
	for (const raw of rawAccounts) {
		if (typeof raw !== "object" || raw === null) continue;
		const account = raw;
		const { remain, size } = extractRemain(account);
		accounts.push({
			packageName: typeof account["PackageName"] === "string" ? account["PackageName"] : "(unnamed)",
			remain,
			size
		});
	}
	return accounts;
}
function formatLocal(date) {
	const pad = (n, width = 2) => n.toString().padStart(width, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
/** Query the aggregated remaining credit (and package breakdown). */
async function workbuddyPoints(credential, fetchFn = fetch) {
	const now = /* @__PURE__ */ new Date();
	return parseAccounts(await billingPostWithFallback(credential, "/billing/meter/get-user-resource", {
		PageNumber: 1,
		PageSize: 100,
		ProductCode: "p_tcaca",
		Status: [0, 3],
		PackageEndTimeRangeBegin: formatLocal(now),
		PackageEndTimeRangeEnd: formatLocal(new Date(now.getTime() + 3185136e6))
	}, fetchFn));
}
function parseCheckedIn(data) {
	if (typeof data !== "object" || data === null) return null;
	const record = data;
	for (const [key, value] of Object.entries(record)) if (/checked|signed|is_check|today/i.test(key) && typeof value === "boolean") return value;
	return null;
}
/**
* Query the daily check-in status. The check-in endpoints are known only in
* the web-console shape (no /v2 evidence exists), so only the bare path is
* tried; an unknown data shape surfaces as null rather than an error.
*/
async function workbuddyStatus(credential, fetchFn = fetch) {
	return {
		checkedIn: parseCheckedIn(await billingPost(credential, "/billing/meter/checkin-status", {}, fetchFn)),
		points: null,
		accounts: []
	};
}
/** Business code the upstream returns when today's reward was already claimed. */
const ALREADY_CHECKED_IN_CODE = 10001;
/** Claim today's check-in reward; an already-claimed day counts as success. */
async function workbuddyClaim(credential, fetchFn = fetch) {
	try {
		await billingPost(credential, "/billing/meter/daily-checkin", {}, fetchFn);
	} catch (cause) {
		if (cause instanceof ApiError && cause.kind === "business" && cause.code === ALREADY_CHECKED_IN_CODE) return;
		throw cause;
	}
}
/** Exchange the refresh token for a fresh access token. */
async function workbuddyRefresh(credential, fetchFn = fetch) {
	if (credential.refreshToken === "") throw new ApiError("auth", "workbuddy credential has no refresh token; sign in again in the WorkBuddy app");
	let res;
	try {
		res = await fetchFn(`${chatBase(credential)}/v2/plugin/auth/token/refresh`, {
			method: "POST",
			headers: {
				accept: "application/json",
				"x-refresh-token": credential.refreshToken,
				"x-auth-refresh-source": "workbuddy",
				"user-agent": CLIENT_UA
			},
			signal: AbortSignal.timeout(3e4)
		});
	} catch (cause) {
		throw new ApiError("network", `workbuddy token refresh failed: ${String(cause)}`);
	}
	const envelope = await readEnvelope(res);
	if (!res.ok || envelope.code !== 0) throw new ApiError("auth", `workbuddy token refresh failed (HTTP ${res.status} code ${envelope.code})`);
	const data = envelope.data ?? {};
	const accessToken = typeof data["accessToken"] === "string" ? data["accessToken"] : "";
	if (accessToken === "") throw new ApiError("auth", "workbuddy token refresh returned no accessToken");
	const refreshed = {
		...credential,
		accessToken,
		...typeof data["refreshToken"] === "string" && data["refreshToken"] !== "" ? { refreshToken: data["refreshToken"] } : {},
		...typeof data["expiresIn"] === "number" && data["expiresIn"] > 0 ? { expiresAtMs: Date.now() + data["expiresIn"] * 1e3 } : {}
	};
	await persistRefreshedCredential(refreshed);
	return refreshed;
}
//#endregion
//#region src/host/checkin.ts
/**
* Check-in orchestrator: a per-service snapshot for the client panel, manual
* claim, and the startup catch-up (ensureToday) that claims any configured
* service whose local date has not been checked in yet.
*/
const SERVICES = ["trae", "workbuddy"];
/** Default adapters over the real API clients. */
function defaultApis() {
	return {
		trae: {
			resolve: (manualToken) => resolveTraeCredential(manualToken),
			status: traeStatus,
			entitlements: traeEntitlements,
			claim: traeClaim,
			refresh: traeRefresh
		},
		workbuddy: {
			resolve: (manualToken) => resolveStoredCredential(manualToken),
			status: workbuddyStatus,
			points: workbuddyPoints,
			claim: workbuddyClaim,
			refresh: workbuddyRefresh
		}
	};
}
const SNAPSHOT_TTL_MS = 3e4;
function emptyRuntime(credentials, lastCheckin) {
	return {
		credentials,
		lastCheckin,
		authOk: null,
		checkedIn: null,
		checkinEnabled: null,
		points: null,
		probedAt: 0
	};
}
var CheckinOrchestrator = class {
	apis;
	runtime;
	refreshing = {
		trae: void 0,
		workbuddy: void 0
	};
	constructor(apis = defaultApis()) {
		this.apis = apis;
		this.runtime = {
			trae: emptyRuntime(void 0, null),
			workbuddy: emptyRuntime(void 0, null)
		};
	}
	/** (Re)load credentials and state from disk. */
	async reload() {
		const [credentials, state] = [await readCredentials(), await readState()];
		this.runtime.trae = emptyRuntime(credentials.trae, state.trae?.lastCheckin ?? null);
		this.runtime.workbuddy = emptyRuntime(credentials.workbuddy, state.workbuddy?.lastCheckin ?? null);
	}
	/** Merge a credentials patch (per service) and persist it. */
	async setCredentials(patch) {
		const current = await readCredentials();
		if (patch.trae) {
			const token = patch.trae.token ?? current.trae?.token ?? "";
			const deviceId = patch.trae.deviceId ?? current.trae?.deviceId;
			if (token) current.trae = deviceId ? {
				token,
				deviceId
			} : { token };
			else delete current.trae;
		}
		if (patch.workbuddy) {
			const token = patch.workbuddy.token ?? current.workbuddy?.token ?? "";
			const userId = patch.workbuddy.userId ?? current.workbuddy?.userId;
			if (token) current.workbuddy = userId ? {
				token,
				userId
			} : { token };
			else delete current.workbuddy;
		}
		await writeCredentials(current);
		await this.reload();
	}
	/** Current client-facing snapshot (probes are cached for SNAPSHOT_TTL_MS). */
	async snapshot(force = false) {
		await Promise.all(SERVICES.map((service) => this.probe(service, force)));
		return {
			trae: this.toSnapshot("trae"),
			workbuddy: this.toSnapshot("workbuddy")
		};
	}
	/** Claim today's reward for one service; records the date on success. */
	async checkin(service) {
		const runtime = this.runtime[service];
		const credential = service === "trae" ? runtime.resolved ?? await this.apis.trae.resolve(runtime.credentials?.token) : runtime.resolved ?? await this.apis.workbuddy.resolve(runtime.credentials?.token);
		if (!credential) throw new ApiError("auth", `${service} is not configured (no credential found)`);
		try {
			if (service === "trae") await this.apis.trae.claim(credential);
			else await this.apis.workbuddy.claim(credential);
		} catch (cause) {
			if (service === "trae" && cause instanceof ApiError && cause.kind === "auth") {
				const refreshed = await this.apis.trae.refresh(credential);
				runtime.resolved = refreshed;
				await this.apis.trae.claim(refreshed);
			} else if (service === "workbuddy" && cause instanceof ApiError && cause.kind === "auth") {
				const refreshed = await this.apis.workbuddy.refresh(credential);
				runtime.resolved = refreshed;
				await this.apis.workbuddy.claim(refreshed);
			} else throw cause;
		}
		runtime.checkedIn = true;
		runtime.lastCheckin = todayLocal();
		runtime.error = void 0;
		runtime.errorMessage = void 0;
		await this.persistState(service);
	}
	/**
	* Startup catch-up: for every configured service, probe; claim when the
	* upstream reports enabled-and-not-checked-in. Errors are recorded on the
	* runtime (surfaced by the panel) and never propagate.
	*/
	async ensureToday() {
		await Promise.all(SERVICES.map((service) => this.ensureTodayOne(service)));
	}
	async ensureTodayOne(service) {
		if (this.refreshing[service]) return this.refreshing[service];
		const task = (async () => {
			try {
				await this.probe(service, true);
				const runtime = this.runtime[service];
				if (!(service === "workbuddy" ? Boolean(runtime.resolved || runtime.credentials?.token) : Boolean(runtime.resolved || runtime.credentials?.token))) return;
				if (runtime.checkinEnabled === false) return;
				if (runtime.checkedIn) return;
				await this.checkin(service);
				await this.probe(service, true);
			} catch {} finally {
				this.refreshing[service] = void 0;
			}
		})();
		this.refreshing[service] = task;
		return task;
	}
	async probe(service, force) {
		const runtime = this.runtime[service];
		const claimedToday = runtime.lastCheckin === todayLocal();
		if (service === "workbuddy") {
			await this.probeWorkbuddy(runtime, force, claimedToday);
			return;
		}
		await this.probeTrae(runtime, force, claimedToday);
	}
	async probeTrae(runtime, force, claimedToday) {
		if (Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS && !force) return;
		let credential;
		try {
			credential = runtime.authOk === true && runtime.resolved || await this.apis.trae.resolve(runtime.credentials?.token);
			if (!credential) {
				runtime.authOk = null;
				return;
			}
			let active = credential;
			try {
				await this.probeTraeOnce(runtime, active, claimedToday);
			} catch (cause) {
				if (!(cause instanceof ApiError && cause.kind === "auth")) throw cause;
				active = await this.apis.trae.refresh(active);
				await this.probeTraeOnce(runtime, active, claimedToday);
			}
			runtime.resolved = active;
		} catch (cause) {
			this.recordError(runtime, cause);
			if (cause instanceof ApiError && cause.kind === "auth") runtime.authOk = false;
		} finally {
			runtime.probedAt = Date.now();
		}
	}
	async probeTraeOnce(runtime, active, claimedToday) {
		const status = await this.apis.trae.status(active);
		runtime.authOk = true;
		runtime.checkinEnabled = status.enable;
		runtime.checkedIn = status.checkedIn || claimedToday;
		try {
			const ledger = await this.apis.trae.entitlements(active);
			runtime.points = ledger.remaining;
			runtime.pointsRaw = ledger;
		} catch {
			runtime.points = status.credits ?? null;
		}
		runtime.error = void 0;
		runtime.errorMessage = void 0;
	}
	async probeWorkbuddy(runtime, force, claimedToday) {
		if (Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS && !force) return;
		let credential;
		try {
			credential = (runtime.authOk === true ? runtime.resolved : void 0) ?? await this.apis.workbuddy.resolve(runtime.credentials?.token);
			if (!credential) {
				runtime.authOk = null;
				return;
			}
			let active = credential;
			try {
				const [status, accounts] = await Promise.all([this.apis.workbuddy.status(active), this.apis.workbuddy.points(active)]);
				runtime.authOk = true;
				runtime.checkedIn = (status.checkedIn ?? false) || claimedToday;
				runtime.points = accounts.reduce((sum, entry) => sum + entry.remain, 0);
				runtime.pointsRaw = accounts;
				runtime.error = void 0;
				runtime.errorMessage = void 0;
			} catch (cause) {
				if (cause instanceof ApiError && cause.kind === "auth" && active.refreshToken !== "") {
					active = await this.apis.workbuddy.refresh(active);
					const [status, accounts] = await Promise.all([this.apis.workbuddy.status(active), this.apis.workbuddy.points(active)]);
					runtime.authOk = true;
					runtime.checkedIn = (status.checkedIn ?? false) || claimedToday;
					runtime.points = accounts.reduce((sum, entry) => sum + entry.remain, 0);
					runtime.pointsRaw = accounts;
					runtime.error = void 0;
					runtime.errorMessage = void 0;
				} else throw cause;
			}
			runtime.resolved = active;
		} catch (cause) {
			this.recordError(runtime, cause);
			if (cause instanceof ApiError && cause.kind === "auth") runtime.authOk = false;
		} finally {
			runtime.probedAt = Date.now();
		}
	}
	recordError(runtime, cause) {
		const apiError = cause instanceof ApiError ? cause : void 0;
		runtime.authOk = apiError?.kind === "auth" ? false : runtime.authOk;
		runtime.error = apiError?.kind ?? "network";
		runtime.errorMessage = cause instanceof Error ? cause.message : String(cause);
	}
	toSnapshot(service) {
		const runtime = this.runtime[service];
		return {
			service,
			configured: Boolean(runtime.resolved || runtime.credentials?.token),
			authOk: runtime.authOk,
			checkedIn: runtime.checkedIn,
			checkinEnabled: runtime.checkinEnabled,
			points: runtime.points,
			pointsRaw: runtime.pointsRaw,
			lastCheckin: runtime.lastCheckin,
			error: runtime.error,
			errorMessage: runtime.errorMessage,
			...runtime.resolved ? { credentialSource: runtime.resolved.source } : {}
		};
	}
	async persistState(service) {
		const state = await readState();
		state[service] = { lastCheckin: this.runtime[service].lastCheckin ?? void 0 };
		await writeState(state);
	}
};
//#endregion
//#region src/host/bridge.ts
/**
* Localhost bridge between the browser half and the host orchestrator.
*
* The upstream APIs (api.trae.cn, www.codebuddy.cn) send no CORS headers, so
* the browser half cannot call them directly; the host half runs this small
* HTTP server on 127.0.0.1 instead. The browser probes a short fixed port
* range for /ping (no shared state is available for port discovery).
*
* Security posture: bind 127.0.0.1 only; requests carrying a non-localhost
* Origin are rejected, so arbitrary web pages cannot read the stored tokens.
*/
/** Ports probed, in order, by the browser half. */
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
const MAX_BODY_BYTES = 1 << 20;
function isLocalOrigin(origin) {
	if (origin === void 0) return true;
	return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function cors(res) {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	res.setHeader("Access-Control-Allow-Private-Network", "true");
}
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(body);
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new ApiError("protocol", "request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf8");
			if (!text) return resolve({});
			try {
				resolve(JSON.parse(text));
			} catch {
				reject(new ApiError("protocol", "request body is not valid JSON"));
			}
		});
		req.on("error", reject);
	});
}
/**
* Start the bridge. Tries PORT_CANDIDATES in order; returns null when every
* port is taken (the client panel will report "unreachable").
*/
function startBridge(orchestrator, log, ports = PORT_CANDIDATES) {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (bridge) => {
			if (settled) return;
			settled = true;
			resolve(bridge);
		};
		const server = createServer((req, res) => {
			handle(req, res, orchestrator, log);
		});
		tryNext(server, 0, ports, (port) => {
			if (port === null) {
				log("bridge failed to bind any candidate port");
				finish(null);
				return;
			}
			log(`bridge listening on 127.0.0.1:${port}`);
			finish({
				port,
				close: () => server.close()
			});
		});
	});
}
function tryNext(server, index, ports, done) {
	if (index >= ports.length) {
		done(null);
		return;
	}
	const port = ports[index];
	const onError = () => {
		server.removeListener("listening", onListening);
		tryNext(server, index + 1, ports, done);
	};
	const onListening = () => {
		server.removeListener("error", onError);
		done(port);
	};
	server.once("error", onError);
	server.once("listening", onListening);
	server.listen(port, "127.0.0.1");
}
async function handle(req, res, orchestrator, log) {
	cors(res);
	const origin = req.headers.origin;
	if (!isLocalOrigin(typeof origin === "string" ? origin : void 0)) {
		sendJson(res, 403, { error: "cross-origin requests are not allowed" });
		return;
	}
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const method = req.method ?? "GET";
	try {
		if (method === "OPTIONS") {
			res.statusCode = 204;
			res.end();
			return;
		}
		if (method === "GET" && url.pathname === "/ping") {
			sendJson(res, 200, {
				ok: true,
				plugin: "points-checkin"
			});
			return;
		}
		if (method === "GET" && url.pathname === "/state") {
			const force = url.searchParams.get("refresh") === "1";
			sendJson(res, 200, await orchestrator.snapshot(force));
			return;
		}
		const checkinMatch = /^\/checkin\/(trae|workbuddy)$/.exec(url.pathname);
		if (method === "POST" && checkinMatch) {
			await orchestrator.checkin(checkinMatch[1]);
			sendJson(res, 200, await orchestrator.snapshot(true));
			return;
		}
		if (method === "GET" && url.pathname === "/credentials") {
			const stored = await readCredentials();
			sendJson(res, 200, {
				trae: {
					configured: Boolean(stored.trae?.token),
					token: stored.trae?.token ?? "",
					deviceId: stored.trae?.deviceId ?? ""
				},
				workbuddy: {
					configured: Boolean(stored.workbuddy?.token),
					token: stored.workbuddy?.token ?? "",
					userId: stored.workbuddy?.userId ?? ""
				}
			});
			return;
		}
		if (method === "POST" && url.pathname === "/credentials") {
			const body = await readBody(req);
			await orchestrator.setCredentials(body);
			sendJson(res, 200, await orchestrator.snapshot(true));
			return;
		}
		if (method === "GET" && url.pathname === "/settings") {
			sendJson(res, 200, await readSettings());
			return;
		}
		if (method === "POST" && url.pathname === "/settings") {
			const time = (await readBody(req)).checkinTime;
			if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ApiError("protocol", "checkinTime must be HH:mm (00:00-23:59)");
			await writeSettings({ checkinTime: time });
			sendJson(res, 200, await readSettings());
			return;
		}
		if (method === "POST" && url.pathname === "/refresh") {
			await orchestrator.ensureToday();
			sendJson(res, 200, await orchestrator.snapshot(true));
			return;
		}
		sendJson(res, 404, { error: "not found" });
	} catch (cause) {
		const apiError = cause instanceof ApiError ? cause : void 0;
		const status = apiError?.kind === "auth" ? 401 : 500;
		log(`bridge error on ${method} ${url.pathname}: ${String(cause)}`);
		sendJson(res, status, {
			error: cause instanceof Error ? cause.message : String(cause),
			kind: apiError?.kind
		});
	}
}
//#endregion
//#region src/host/index.ts
const SCHEDULE_TICK_MS = 3e4;
/**
* Start the plugin's host-side services on the given context. Returns a
* disposer for tests.
*/
async function startPointsCheckin(ctx) {
	const log = (message) => {
		try {
			ctx.logger("points-checkin").info(message);
		} catch {}
	};
	const orchestrator = new CheckinOrchestrator();
	await orchestrator.reload();
	const bridge = await startBridge(orchestrator, log);
	if (!bridge) {
		log("bridge unavailable; the panel will show the plugin as unreachable");
		return () => {};
	}
	const catchup = setTimeout(() => {
		orchestrator.ensureToday();
	}, 3e3);
	let lastScheduledDate = null;
	const scheduler = setInterval(() => {
		(async () => {
			try {
				const { checkinTime } = await readSettings();
				const [hour, minute] = checkinTime.split(":").map(Number);
				const now = /* @__PURE__ */ new Date();
				if (!(now.getHours() > hour || now.getHours() === hour && now.getMinutes() >= minute) || lastScheduledDate === todayLocal()) return;
				lastScheduledDate = todayLocal();
				log(`scheduled check-in fired (${checkinTime})`);
				await orchestrator.ensureToday();
			} catch {}
		})();
	}, SCHEDULE_TICK_MS);
	const dispose = () => {
		clearTimeout(catchup);
		clearInterval(scheduler);
		bridge.close();
	};
	if (typeof ctx.effect === "function") ctx.effect(() => dispose, "points-checkin: bridge");
	else log("ctx.effect unavailable; the bridge will outlive plugin disposal");
	return dispose;
}
//#endregion
//#region src/index.ts
/** Apply the host half. */
function apply(ctx) {
	startPointsCheckin(ctx);
}
//#endregion
export { apply };
