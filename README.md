# dsh-points-checkin

DSH plugin: points and daily check-in for WorkBuddy and TRAE, inside the DSH sidebar. A footer action beside Settings opens an expanding card showing each service's points, today's check-in state, and a one-click claim button; token setup lives in the same card. The host half runs a startup catch-up pass, so anything not yet checked in today is claimed when DSH boots.

The upstream APIs (`api.trae.cn`, the WorkBuddy meter service) send no CORS headers, so the browser half never calls them directly. The host half runs a small localhost bridge on 127.0.0.1 (ports 27182-27191) that the panel discovers and talks to; tokens are stored by the host under `~/.dsh-points-checkin/credentials.json` (mode 0600, never logged).

## Requirements

- DSH `>=0.1.1-rc.1` (built and tested against 0.1.1-rc.2).
- Tokens for TRAE and/or WorkBuddy (see below).

## Install

```sh
dsh plugin --profile web add link:<this directory>
```

Then restart `dsh web` and reload the page. The entry appears at the sidebar foot, beside Settings; when the sidebar is collapsed it renders as a rail icon.

## Getting the tokens

The plugin stores tokens only; it does not implement third-party login.

- **WorkBuddy** (Bearer token): open `https://www.codebuddy.cn/profile/plan`, sign in with the same Tencent account as the WorkBuddy client, open DevTools > Network, and copy the `Authorization: Bearer <token>` header from any `/billing/meter/...` request (plus `X-User-Id` when present).
- **TRAE** (Cloud-IDE-JWT token): open `https://www.trae.cn`, sign in, open DevTools > Network, find a request to `api.trae.cn`, and copy the `authorization: Cloud-IDE-JWT <token>` header value.

Paste both into the card's Settings section and save; the panel probes immediately and shows each service's state. When a token expires the card flags it and the value needs to be re-copied.

## Notes

- Host half: check-in orchestrator (status, claim, startup catch-up), token store, localhost bridge; all upstream API details are quarantined in `src/host/trae.ts` and `src/host/workbuddy.ts`.
- Client half: sidebar footer action + expanding card; every request goes through the host bridge (port probing with retry, CORS plus Private-Network preflight handled host-side). Non-localhost origins are rejected by the bridge.
- WorkBuddy's points figure is parsed heuristically from the meter payload (the exact balance field is still unconfirmed); when parsing fails the card shows a placeholder and the raw data stays available in `/state`.
- No emoji in code, comments, docs, or commit messages.

## License

MIT
