# AGENTS.md — dsh-points-checkin

Package-local guidance for AI agents.

- Standalone plugin package (not part of the dsh-web monorepo workspace); install via `dsh plugin --profile web add link:<dir>` and restart `dsh web` to mount a rebuilt bundle.
- The client bundle must keep the closure-factory artifact shape (`window.__ModuleLoader__.load`) configured in `tsdown.config.ts`; only `react`/`react-dom`/module-table entries may stay external.
- All `@deepseek-ai/*` usage in `src/client` must stay type-only; runtime services are reached through the cordis context. A value import from dsh packages would either throw in the frozen module table or duplicate runtime state.
- The sidebar entry must register into `sidebar.footer.action` (additive list seat declared by dsh-client-ui-sidebar). Registering into `sidebar` itself replaces the whole navigation column.
- The upstream APIs send no CORS headers: the browser half must only talk to the host bridge (`src/client/api.ts`); all upstream HTTP stays in `src/host/trae.ts` / `src/host/workbuddy.ts`, with the fetch seam injectable for tests.
- Tokens live only in `~/.dsh-points-checkin/credentials.json` (0600) and must never be logged or committed; the bridge rejects non-localhost Origin headers — keep that guard.
- No emoji in code, comments, docs, or commit messages.
