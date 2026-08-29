import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
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
const STATUS_PATH$1 = "/trae/api/v2/ug/checkin_credits/status";
const CLAIM_PATH$1 = "/trae/api/v2/ug/checkin_credits/claim";
function headers(token, deviceId) {
	return {
		"content-type": "application/json",
		authorization: `Cloud-IDE-JWT ${token}`,
		"x-device-id": deviceId
	};
}
async function post$1(path, token, deviceId, fetchFn) {
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
	const flatBody = flat(await post$1(STATUS_PATH$1, token, deviceId, fetchFn));
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
	await post$1(CLAIM_PATH$1, token, deviceId, fetchFn);
}
//#endregion
//#region src/host/workbuddy.ts
/**
* WorkBuddy (CodeBuddy) meter API client (reverse-engineered from the
* WorkBuddy.app 5.3.14 asar; see .scratch/points-checkin/spec.md).
*
* Base: https://www.codebuddy.cn (highest-confidence meter host; confirm on
* first live run). Endpoints are POSTs with JSON bodies; auth is
* `Authorization: Bearer <token>` plus the account headers the renderer's
* AccountService injects. Response shape: {code, data, msg, requestId}.
*/
/** Meter base (spec open item 1: confirm against a live capture). */
const WORKBUDDY_BASE = "https://www.codebuddy.cn";
const STATUS_PATH = "/billing/meter/checkin-status";
const CLAIM_PATH = "/billing/meter/daily-checkin";
const RESOURCE_PATH = "/billing/meter/get-user-resource";
async function post(path, account, body, fetchFn) {
	const requestHeaders = {
		"content-type": "application/json",
		authorization: `Bearer ${account.token}`
	};
	if (account.userId) requestHeaders["x-user-id"] = account.userId;
	let res;
	try {
		res = await fetchFn(`${WORKBUDDY_BASE}${path}`, {
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify(body)
		});
	} catch (cause) {
		throw new ApiError("network", `workbuddy ${path} request failed: ${String(cause)}`);
	}
	if (res.status === 401 || res.status === 403) throw new ApiError("auth", `workbuddy ${path} rejected the token (HTTP ${res.status})`);
	if (!res.ok) throw new ApiError("network", `workbuddy ${path} returned HTTP ${res.status}`);
	let bodyJson;
	try {
		bodyJson = await res.json();
	} catch {
		throw new ApiError("protocol", `workbuddy ${path} returned a non-JSON body`);
	}
	if (typeof bodyJson.code === "number" && bodyJson.code !== 0) throw new ApiError("business", `workbuddy ${path} business error ${bodyJson.code}: ${bodyJson.msg ?? ""}`, bodyJson.code);
	return bodyJson.data ?? bodyJson;
}
function pickNumber(value, depth = 0) {
	if (depth > 3 || value == null || typeof value !== "object") return void 0;
	const record = value;
	for (const [key, field] of Object.entries(record)) if (/credit|point|balance|remain|quota/i.test(key) && typeof field === "number") return field;
	for (const field of Object.values(record)) {
		const found = pickNumber(field, depth + 1);
		if (found !== void 0) return found;
	}
}
function parseCheckedIn(value) {
	const record = value;
	if (record == null || typeof record !== "object") return false;
	for (const [key, field] of Object.entries(record)) if (/checked|signed|is_check|today/i.test(key) && typeof field === "boolean") return field;
	return false;
}
/** Query the daily check-in status for the configured account. */
async function workbuddyStatus(account, fetchFn = fetch) {
	const data = await post(STATUS_PATH, account, {}, fetchFn);
	if (typeof data !== "object" || data == null) throw new ApiError("protocol", "workbuddy checkin-status returned an unexpected shape");
	return {
		checkedIn: parseCheckedIn(data),
		points: pickNumber(data)
	};
}
/** Claim today's check-in reward. */
async function workbuddyClaim(account, fetchFn = fetch) {
	await post(CLAIM_PATH, account, {}, fetchFn);
}
/**
* Query the plan/resource snapshot (spec: get-user-resource with the
* p_tcaca product code). The exact balance field is an open item; the raw
* data is surfaced to the client for display heuristics.
*/
async function workbuddyResource(account, fetchFn = fetch) {
	return post(RESOURCE_PATH, account, {
		PageNumber: 1,
		PageSize: 100,
		ProductCode: "p_tcaca",
		Status: [1, 2]
	}, fetchFn);
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
			status: workbuddyStatus,
			claim: workbuddyClaim,
			resource: workbuddyResource
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
		if (!runtime.credentials?.token) throw new ApiError("auth", `${service} is not configured`);
		if (service === "trae") await this.apis.trae.claim(runtime.credentials.token, runtime.credentials.deviceId ?? "");
		else await this.apis.workbuddy.claim(runtime.credentials);
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
		if (!runtime.credentials?.token) return;
		if (Date.now() - runtime.probedAt < SNAPSHOT_TTL_MS && !force) return;
		const claimedToday = runtime.lastCheckin === todayLocal();
		try {
			if (service === "trae") {
				const status = await this.apis.trae.status(runtime.credentials.token, runtime.credentials.deviceId ?? "");
				runtime.authOk = true;
				runtime.checkinEnabled = status.enable;
				runtime.checkedIn = status.checkedIn || claimedToday;
				runtime.points = status.credits ?? null;
			} else {
				const status = await this.apis.workbuddy.status(runtime.credentials);
				runtime.authOk = true;
				runtime.checkedIn = status.checkedIn || claimedToday;
				runtime.points = status.points ?? null;
				try {
					runtime.pointsRaw = await this.apis.workbuddy.resource(runtime.credentials);
				} catch {}
			}
			runtime.error = void 0;
			runtime.errorMessage = void 0;
		} catch (cause) {
			const apiError = cause instanceof ApiError ? cause : void 0;
			runtime.authOk = apiError?.kind === "auth" ? false : runtime.authOk;
			runtime.error = apiError?.kind ?? "network";
			runtime.errorMessage = cause instanceof Error ? cause.message : String(cause);
		} finally {
			runtime.probedAt = Date.now();
		}
	}
	toSnapshot(service) {
		const runtime = this.runtime[service];
		return {
			service,
			configured: Boolean(runtime.credentials?.token),
			authOk: runtime.authOk,
			checkedIn: runtime.checkedIn,
			checkinEnabled: runtime.checkinEnabled,
			points: runtime.points,
			pointsRaw: runtime.pointsRaw,
			lastCheckin: runtime.lastCheckin,
			error: runtime.error,
			errorMessage: runtime.errorMessage
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
