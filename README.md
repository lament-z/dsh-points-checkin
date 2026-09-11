# dsh-points-checkin

English | [简体中文](./README.zh.md)

DSH plugin for points and daily check-in across WorkBuddy and TRAE, inside the DSH sidebar. A footer action beside Settings opens an expanding card showing each service's current points, today's check-in state, and a one-click claim button. The card's settings page shows where each credential came from (fetched automatically — nothing to paste), any fetch error with its upstream reason, and the daily automatic check-in time. The host half runs a startup catch-up pass and a daily scheduler at the configured time, so anything not yet checked in gets claimed without manual action.

The upstream APIs (`api.trae.cn`, the WorkBuddy meter service) send no CORS headers, so the browser half never calls them directly. The host half runs a small localhost bridge on `127.0.0.1` (ports 27182-27191) that the panel discovers and talks to; when the page is served through a reverse proxy (for example the direct gateway of [dsh-bridge-gateway](https://github.com/lament-z/dsh-bridge-gateway)), the panel uses the same-origin `/points-checkin/*` proxy path instead. Tokens are stored by the host under `~/.dsh-points-checkin/credentials.json` (mode 0600, never logged).

## Features

- **One entry for both services.** Points balance, today's check-in state, and a claim button per service, in one expanding card at the sidebar foot.
- **Fully automatic credentials.** No token pasting anywhere; both services reuse their desktop app's sign-in state and refresh themselves when they expire (details below).
- **One-click check-in.** Claim either service from the card and see the points change immediately; upstream errors are shown verbatim when a claim fails.
- **Daily automatic check-in.** Configure a time (HH:mm, default 09:00) in the card's settings page; the host scheduler ticks every 30 seconds and claims whatever is still unchecked-in at the configured time.
- **Startup catch-up.** On host boot, anything not yet checked in today is claimed right away, so a host that was off at the scheduled time does not miss the day.
- **Works over remote access.** Through the dsh-bridge-gateway direct gateway or any reverse proxy forwarding `/points-checkin/*`, the panel uses the same-origin path; locally it falls back to the localhost bridge automatically.
- **Transparent settings page.** Each service's credential source, the exact upstream error on failure, and the daily check-in time — all visible in one place.

## Requirements

- DSH `>=0.1.1-rc.1` (built and tested against `0.1.5-rc.2`).
- The WorkBuddy and/or TRAE desktop app signed in (for automatic credentials), or an exported token file for TRAE.

## Install

```sh
# Preferred: install straight from GitHub (no npm involved; prebuilt lib is committed)
dsh plugin --profile web add github:lament-z/dsh-points-checkin

# Alternative: from npm
dsh plugin --profile web add @lament_z/dsh-points-checkin

# From a local clone / working copy
dsh plugin --profile web add link:<this directory>
```

Then restart `dsh web` and reload the page. The entry appears at the sidebar foot, beside Settings; when the sidebar is collapsed it renders as a rail icon.

## Credentials (automatic)

No tokens to paste. Both services reuse their desktop app's sign-in state and refresh themselves when they expire:

- **WorkBuddy**: reads the WorkBuddy desktop app's plaintext auth document (same source as dsh-workbuddy-connect); expired tokens refresh through the official endpoint with automatic `X-Refresh-Token` rotation.
- **TRAE**: reads the desktop-captured ideToken (`<appDir>/trae-auth.json` or `~/.dsh/.trae-auth.json`, same path as dsh-trae-connect); expired tokens refresh through the OAuth ExchangeToken endpoint.

A manually provided token participates in a "newer wins" comparison rather than overriding unconditionally — this prevents an expired web token from shadowing fresh desktop credentials. The card's settings page shows each service's credential source and the exact upstream error whenever a fetch fails. If neither source is available, sign in to the corresponding desktop app and reload.

## Usage

1. Install and restart `dsh web` (see above).
2. Click the sidebar footer entry: the card expands and shows both services' points and check-in state.
3. Click a service's check-in button to claim today's reward immediately.
4. Open the card's settings page to review credential sources, see fetch errors, and set the daily automatic check-in time (HH:mm, default 09:00, stored in `~/.dsh-points-checkin/settings.json`).

## Notes

- Host half: check-in orchestrator (status, claim, startup catch-up, daily scheduler), token store, localhost bridge; all upstream API details are quarantined in `src/host/trae.ts` and `src/host/workbuddy.ts`.
- Client half: sidebar footer action + expanding card; requests go through the gateway proxy path when available, otherwise the localhost bridge (port probing with retry, CORS plus Private-Network preflight handled host-side). Non-localhost origins are rejected by the bridge.
- WorkBuddy points are the official sum of package `CycleCapacityRemain` values; TRAE points are the credits ledger's total minus consumed (the dashboard's own figure).
- No emoji in code, comments, docs, or commit messages.

## Troubleshooting

- **A service shows a credential error.** Sign in to the corresponding desktop app (WorkBuddy or TRAE), then reload the page — credentials are re-read automatically.
- **Check-in claims failure code 10001 but points increased.** WorkBuddy's status endpoint sometimes reports "not checked in" after a successful claim; the plugin treats 10001 as success and trusts the claim result.
- **The card cannot reach the bridge through remote access.** The page must be served through a proxy that forwards `/points-checkin/*` to the host (dsh-bridge-gateway's direct gateway does); plain LAN/tunnel access falls back to the localhost bridge, which only exists on the host machine.

## License

MIT
