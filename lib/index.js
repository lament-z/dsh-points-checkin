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
//#region src/host/trae.ts
/**
* TRAE check-in credits API client (reverse-engineered from the TRAE SOLO CN
* 2.3.78099 bundle; see .scratch/points-checkin/spec.md).
*
* Base: https://api.trae.cn. Both endpoints are POST with an empty JSON body;
* auth is `Authorization: Cloud-IDE-JWT <token>` plus the device headers the
* client attaches. Response bodies are flat: {code, enable, checked_in,
* credits} for status.
*/
/** TRAE ugApi base for the CN environment (product.json bootConfig.ug.trae.normal). */
const TRAE_BASE = "https://api.trae.cn";
const STATUS_PATH = "/trae/api/v2/ug/checkin_credits/status";
const CLAIM_PATH = "/trae/api/v2/ug/checkin_credits/claim";
function headers(token, deviceId) {
	return {
		"content-type": "application/json",
		authorization: `Cloud-IDE-JWT ${token}`,
		"x-device-id": deviceId
	};
}
async function post(path, token, deviceId, fetchFn) {
	let res;
	try {
		res = await fetchFn(`${TRAE_BASE}${path}`, {
			method: "POST",
			headers: headers(token, deviceId),
			body: "{}"
		});
	} catch (cause) {
		throw new ApiError("network", `trae ${path} request failed: ${String(cause)}`);
	}
	if (res.status === 401 || res.status === 403) throw new ApiError("auth", `trae ${path} rejected the token (HTTP ${res.status})`);
	if (!res.ok) throw new ApiError("network", `trae ${path} returned HTTP ${res.status}`);
	let body;
	try {
		body = await res.json();
	} catch {
		throw new ApiError("protocol", `trae ${path} returned a non-JSON body`);
	}
	if (typeof body.code === "number" && body.code !== 0) throw new ApiError("business", `trae ${path} business error ${body.code}: ${body.message ?? ""}`, body.code);
	return body;
}
/** Flatten {code, data:{...}} and flat {code, enable, ...} shapes alike. */
function flat(body) {
	return body.data ?? body;
}
/** Query the daily check-in status (and current credits when present). */
async function traeStatus(token, deviceId, fetchFn = fetch) {
	const flatBody = flat(await post(STATUS_PATH, token, deviceId, fetchFn));
	if (typeof flatBody.enable !== "boolean" || typeof flatBody.checked_in !== "boolean") throw new ApiError("protocol", "trae status body missed enable/checked_in");
	const credits = typeof flatBody.credits === "number" ? flatBody.credits : void 0;
	return {
		enable: flatBody.enable,
		checkedIn: flatBody.checked_in,
		credits
	};
}
/** Claim today's check-in credits. */
async function traeClaim(token, deviceId, fetchFn = fetch) {
	await post(CLAIM_PATH, token, deviceId, fetchFn);
}
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
	if (!res.ok) throw new ApiError("network", `workbuddy ${path} returned HTTP ${res.status}`);
	const envelope = await readEnvelope(res);
	if (typeof envelope.code === "number" && envelope.code !== 0) throw new ApiError("business", `workbuddy ${path} business error ${envelope.code}: ${envelope.msg ?? ""}`, envelope.code);
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
			status: traeStatus,
			claim: traeClaim
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
		if (service === "trae") {
			if (!runtime.credentials?.token) throw new ApiError("auth", "trae is not configured");
			await this.apis.trae.claim(runtime.credentials.token, runtime.credentials.deviceId ?? "");
		} else {
			const credential = runtime.resolved ?? await this.apis.workbuddy.resolve(runtime.credentials?.token);
			if (!credential) throw new ApiError("auth", "workbuddy is not configured (desktop app not signed in?)");
			await this.apis.workbuddy.claim(credential);
			runtime.resolved = credential;
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
				if (!runtime.credentials?.token) return;
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
		if (!runtime.credentials?.token) return;
		if (Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS && !force) return;
		try {
			const status = await this.apis.trae.status(runtime.credentials.token, runtime.credentials.deviceId ?? "");
			runtime.authOk = true;
			runtime.checkinEnabled = status.enable;
			runtime.checkedIn = status.checkedIn || claimedToday;
			runtime.points = status.credits ?? null;
			runtime.error = void 0;
			runtime.errorMessage = void 0;
		} catch (cause) {
			this.recordError(runtime, cause);
		} finally {
			runtime.probedAt = Date.now();
		}
	}
	async probeWorkbuddy(runtime, force, claimedToday) {
		if (Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS && !force) return;
		let credential;
		try {
			credential = runtime.authOk === true && runtime.resolved || await this.apis.workbuddy.resolve(runtime.credentials?.token);
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
			configured: service === "workbuddy" ? Boolean(runtime.resolved || runtime.credentials?.token) : Boolean(runtime.credentials?.token),
			authOk: runtime.authOk,
			checkedIn: runtime.checkedIn,
			checkinEnabled: runtime.checkinEnabled,
			points: runtime.points,
			pointsRaw: runtime.pointsRaw,
			lastCheckin: runtime.lastCheckin,
			error: runtime.error,
			errorMessage: runtime.errorMessage,
			...service === "workbuddy" && runtime.resolved ? { credentialSource: runtime.resolved.source } : {}
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
function startBridge(orchestrator, log) {
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
		tryNext(server, 0, (port) => {
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
function tryNext(server, index, done) {
	if (index >= PORT_CANDIDATES.length) {
		done(null);
		return;
	}
	const port = PORT_CANDIDATES[index];
	const onError = () => {
		server.removeListener("listening", onListening);
		tryNext(server, index + 1, done);
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
/** Install the plugin's host-side services on the given context. */
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
		return;
	}
	const catchup = setTimeout(() => {
		orchestrator.ensureToday();
	}, 3e3);
	const dispose = () => {
		clearTimeout(catchup);
		bridge.close();
	};
	if (typeof ctx.effect === "function") ctx.effect(() => dispose, "points-checkin: bridge");
	else log("ctx.effect unavailable; the bridge will outlive plugin disposal");
}
//#endregion
//#region src/index.ts
/** Apply the host half. */
function apply(ctx) {
	startPointsCheckin(ctx);
}
//#endregion
export { apply };
