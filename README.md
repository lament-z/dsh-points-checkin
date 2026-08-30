# dsh-points-checkin

DSH plugin: points and daily check-in for WorkBuddy and TRAE, inside the DSH sidebar. A footer action beside Settings opens an expanding card showing each service's points, today's check-in state, and a one-click claim button. The card's settings page shows where each credential came from (fetched automatically - nothing to paste), any fetch error with its upstream reason, and the daily automatic check-in time. The host half runs a startup catch-up pass and a daily scheduler at the configured time, so anything not yet checked in is claimed without manual action.

The upstream APIs (`api.trae.cn`, the WorkBuddy meter service) send no CORS headers, so the browser half never calls them directly. The host half runs a small localhost bridge on 127.0.0.1 (ports 27182-27191) that the panel discovers and talks to; tokens are stored by the host under `~/.dsh-points-checkin/credentials.json` (mode 0600, never logged).

## Requirements

- DSH `>=0.1.1-rc.1` (built and tested against 0.1.1-rc.2).
- Tokens for TRAE and/or WorkBuddy (see below).

## Install

```sh
# Preferred: from npm
dsh plugin --profile web add @lament_z/dsh-points-checkin

# From GitHub (no clone needed; prebuilt lib is committed)
dsh plugin --profile web add github:lament-z/dsh-points-checkin

# Or from a local clone / working copy
dsh plugin --profile web add link:<this directory>
```

Then restart `dsh web` and reload the page. The entry appears at the sidebar foot, beside Settings; when the sidebar is collapsed it renders as a rail icon.

## Credentials (automatic)

No tokens to paste. Both services reuse their desktop app's sign-in state and refresh themselves when they expire:

- **WorkBuddy**: reads the WorkBuddy desktop app's plaintext auth document (same source as dsh-workbuddy-connect); expired tokens refresh through the official endpoint.
- **TRAE**: reads the desktop-captured ideToken (`<appDir>/trae-auth.json` or `~/.dsh/.trae-auth.json`, same path as dsh-trae-connect); expired tokens refresh through the OAuth ExchangeToken endpoint.

The card's Settings page shows each service's credential source and the exact upstream error whenever a fetch fails. If neither source is available, sign in to the corresponding desktop app and reload.

## Notes

- Host half: check-in orchestrator (status, claim, startup catch-up), token store, localhost bridge; all upstream API details are quarantined in `src/host/trae.ts` and `src/host/workbuddy.ts`.
- Client half: sidebar footer action + expanding card; every request goes through the host bridge (port probing with retry, CORS plus Private-Network preflight handled host-side). Non-localhost origins are rejected by the bridge.
- WorkBuddy points are the official sum of package CycleCapacityRemain values; TRAE points are the credits ledger's total minus consumed (the dashboard's own figure).
- No emoji in code, comments, docs, or commit messages.

## License

MIT
