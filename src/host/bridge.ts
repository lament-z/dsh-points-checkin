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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { ApiError } from './errors.ts'
import { CheckinOrchestrator } from './checkin.ts'
import { readCredentials, type Credentials } from './store.ts'

/** Ports probed, in order, by the browser half. */
export const PORT_CANDIDATES = [27182, 27183, 27184, 27185, 27186, 27187, 27188, 27189, 27190, 27191]

const MAX_BODY_BYTES = 1 << 20

type JsonRecord = Record<string, unknown>

function isLocalOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('protocol', 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text) as JsonRecord)
      } catch {
        reject(new ApiError('protocol', 'request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

export interface Bridge {
  /** The bound port (resolved during start). */
  port: number
  close(): void
}

/**
 * Start the bridge. Tries PORT_CANDIDATES in order; returns null when every
 * port is taken (the client panel will report "unreachable").
 */
export function startBridge(
  orchestrator: CheckinOrchestrator,
  log: (message: string) => void,
  ports: readonly number[] = PORT_CANDIDATES,
): Promise<Bridge | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (bridge: Bridge | null): void => {
      if (settled) return
      settled = true
      resolve(bridge)
    }
    const server: Server = createServer((req, res) => {
      void handle(req, res, orchestrator, log)
    })
    tryNext(server, 0, ports, (port) => {
      if (port === null) {
        log('bridge failed to bind any candidate port')
        finish(null)
        return
      }
      log(`bridge listening on 127.0.0.1:${port}`)
      finish({ port, close: () => server.close() })
    })
  })
}

function tryNext(server: Server, index: number, ports: readonly number[], done: (port: number | null) => void): void {
  if (index >= ports.length) {
    done(null)
    return
  }
  const port = ports[index]
  const onError = (): void => {
    server.removeListener('listening', onListening)
    tryNext(server, index + 1, ports, done)
  }
  const onListening = (): void => {
    server.removeListener('error', onError)
    done(port)
  }
  server.once('error', onError)
  server.once('listening', onListening)
  server.listen(port, '127.0.0.1')
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: CheckinOrchestrator,
  log: (message: string) => void,
): Promise<void> {
  cors(res)
  const origin = req.headers.origin
  if (!isLocalOrigin(typeof origin === 'string' ? origin : undefined)) {
    sendJson(res, 403, { error: 'cross-origin requests are not allowed' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const method = req.method ?? 'GET'
  try {
    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (method === 'GET' && url.pathname === '/ping') {
      sendJson(res, 200, { ok: true, plugin: 'points-checkin' })
      return
    }
    if (method === 'GET' && url.pathname === '/state') {
      const force = url.searchParams.get('refresh') === '1'
      sendJson(res, 200, await orchestrator.snapshot(force))
      return
    }
    const checkinMatch = /^\/checkin\/(trae|workbuddy)$/.exec(url.pathname)
    if (method === 'POST' && checkinMatch) {
      await orchestrator.checkin(checkinMatch[1] as 'trae' | 'workbuddy')
      sendJson(res, 200, await orchestrator.snapshot(true))
      return
    }
    if (method === 'GET' && url.pathname === '/credentials') {
      // Tokens are echoed back so the panel can show the stored value; the
      // bridge only ever answers localhost origins.
      const stored = await readCredentials()
      sendJson(res, 200, {
        trae: {
          configured: Boolean(stored.trae?.token),
          token: stored.trae?.token ?? '',
          deviceId: stored.trae?.deviceId ?? '',
        },
        workbuddy: {
          configured: Boolean(stored.workbuddy?.token),
          token: stored.workbuddy?.token ?? '',
          userId: stored.workbuddy?.userId ?? '',
        },
      })
      return
    }
    if (method === 'POST' && url.pathname === '/credentials') {
      const body = await readBody(req)
      await orchestrator.setCredentials(body as {
        trae?: Partial<Credentials['trae']>
        workbuddy?: Partial<Credentials['workbuddy']>
      })
      sendJson(res, 200, await orchestrator.snapshot(true))
      return
    }
    if (method === 'POST' && url.pathname === '/refresh') {
      await orchestrator.ensureToday()
      sendJson(res, 200, await orchestrator.snapshot(true))
      return
    }
    sendJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const apiError = cause instanceof ApiError ? cause : undefined
    const status = apiError?.kind === 'auth' ? 401 : 500
    log(`bridge error on ${method} ${url.pathname}: ${String(cause)}`)
    sendJson(res, status, { error: cause instanceof Error ? cause.message : String(cause), kind: apiError?.kind })
  }
}
