# Migration research — packages, build pipeline, and the bundled SPA

Companion to [DESKTOP-MIGRATION-PLAN.md](../DESKTOP-MIGRATION-PLAN.md). Scope: what
in `packages/` is reusable by the Vite SPA, how the desktop build/ship pipeline
works today and what changes, and what the frontend/test inventory implies for
Phase 2.

Research date 2026-08-02, against desktop `1.7.24`, Next `16.2.2`, React `19.2.4`,
Tailwind v4, Electron `^43.2.0`, electron-builder `^26.15.3`.

**Read this for the corrections, not just the inventory.** Three assumptions in the
master plan do not survive contact with the code:

1. `packages/dopl-client` **cannot** run in the renderer as-written (`node:async_hooks`).
   It is a *main-process* asset, not an SPA asset.
2. `version-skew.js` is **not** a server-side minimum-version gate. Nothing in the
   repo gates on client version. The Phase 4 rollback mitigation does not exist yet.
3. Desktop auth is **cookie**-based today (Electron session cookies), not bearer
   tokens in `safeStorage`. Phase 2's token model is a rewrite of the auth seam,
   not a reuse of it.

---

## 1. `packages/dopl-client` — typed API client

### What it is

`@dopl/client` v0.13.0, private workspace package, `main: dist/index.js` +
`types: dist/index.d.ts`, built with plain `tsc`
(`packages/dopl-client/package.json:6-8,15`). 24 source files, ~2,900 LOC.

Public surface (`packages/dopl-client/src/index.ts`):

- **One class**: `DoplClient(baseUrl, apiKey, opts)` — `client.ts:94-100`. It extends
  `ChannelAgentsClient`, which wraps a `DoplTransport`.
- **One context helper**: `workspaceContext` (`transport.ts:44`).
- **Five error classes**: `DoplAbortError`, `DoplApiError`, `DoplAuthError`,
  `DoplNetworkError`, `DoplTimeoutError` (`errors.ts`).
- **~150 exported types** across `types.ts`, `knowledge-types.ts`, `skill-types.ts`,
  `chat-types.ts`, `member-types.ts`, `channel-types.ts`, `ontology-types.ts`.

`DoplClient` exposes ~110 methods spanning clusters, workflows, workspaces,
knowledge, ontology, chats, members, and channels — e.g. `listWorkflows`
(`client.ts:142`), `getKbTree` (`client.ts:355`), `postChannelMessage`
(`client.ts:616`), `getAccessMatrix` (`client.ts:570`).

### Who consumes it

Exactly one runtime consumer: **`packages/mcp-server`**, plus the web app's MCP
route that constructs it.

| Consumer | Site |
|---|---|
| `@dopl/mcp-server` (all tools + `server.ts`) | `packages/mcp-server/src/server.ts:3` |
| Web `/api/mcp` route (constructs a loopback client) | `src/app/api/mcp/route.ts:2` |

**Nothing in `src/features/**`, `src/shared/**`, or `dopl-desktop-app/**` imports
it.** The web frontend has its own separate browser client (see below), and the
desktop main process has its own hand-rolled `apiFetch` (`dopl-desktop-app/main/api.js:14`).

### Verdict: can the SPA reuse it directly? **No — but the main process should.**

Three hard blockers for renderer use:

1. **`node:async_hooks`.** `transport.ts:2` imports `AsyncLocalStorage`, instantiated
   at module scope (`transport.ts:44`). This is a bare Node builtin with no browser
   shim in the dependency graph. Any bundler targeting the browser fails or needs a
   stub. It exists solely so MCP tool calls can override the workspace per call
   (`transport.ts:27-42`) — a concern the SPA does not have.
2. **Auth model mismatch.** The constructor takes an `apiKey` and the transport
   sends it as a bearer credential. The SPA's session is a Supabase cookie/JWT, and
   in the target architecture the renderer is not supposed to hold a credential at
   all ("Renderer never touches the network or tokens", plan §Target architecture).
3. **`debug`** (`transport.ts:1`) is a runtime dependency — browser-capable, but dead
   weight in a renderer bundle.

**Where it does fit: the main process.** Phase 2 routes every renderer read/write
through `renderer → IPC → main → HTTPS`. Main is Node, so `node:async_hooks` is a
non-issue, and `DoplClient` already provides typed methods + a retry/abort/timeout
transport that today's `main/api.js` re-implements by hand. Adopting it in main
would replace `main/api.js` and the Channels listener's duplicate copy
(`main/api.js:1-3` notes the duplication) with one typed layer — and the SPA can
import the **types only** (`import type { KnowledgeEntry } from "@dopl/client"`)
with zero runtime cost, which is the real win for typed IPC.

Caveat: `@dopl/client` ships compiled `dist/` and the desktop's `.gitignore` excludes
`dist/`; the desktop app currently has no dependency on the workspace at all. Wiring
it in means either publishing, vendoring, or making the desktop a workspace member.

### Coverage vs. the `/api` surface

123 route files under `src/app/api/**`. `@dopl/client` hits ~50 distinct paths.
Coverage is domain-shaped, not uniform: it is an **agent-facing content client**, and
the account/commerce/identity plane is entirely absent.

| Domain | Routes | dopl-client | Notes |
|---|---|---|---|
| knowledge | 21 | partial | Has path-based ops (`files`, `folders-by-path`, `move-by-path`, `tree`, `search`, `trash`, restore). **Missing** id-based CRUD (`entries/[entryId]`, `folders/[folderId]`), all `export` routes, `bases/[baseId]/entries`, `bases/[baseId]/folders` |
| workflows | 10 | good | Missing `[id]/knowledge-bases`, `[id]/skills` (attachment ops) |
| ontology | 8 | full | |
| chats | 7 | full | |
| clusters | 2 | full | |
| channels | 14 | partial | Has channels/members/messages/threads/agents/await. **Missing `consent/**`, `presence`, `trust`** — the exact three the SPA's consent inbox and presence pills need |
| workspaces | 24 | thin | Has list/get/members/teams/access-matrix/my-access. **Missing** icon upload, invitations, join-link, join-requests, team membership mutations, `trash` + `trash/purge` + `trash/restore` |
| skills | 10 | thin | Has list/get/create/update/body. **Missing** duplicate, export, history, trash, restore, versions |
| billing | 5 | none | |
| oauth (+2 well-known) | 8 | none | |
| onboarding | 3 | none | |
| user | 3 | `mcp-status` only | Missing `profile`, `delete` |
| me / join / auth / cron | 7 | none | |

**Implication for Phase 2:** roughly half the SPA's endpoint needs are already typed
in `@dopl/client`; the other half (settings, members admin, billing, trash, consent,
presence) are not. The plan's line "Add thin API endpoints where a page currently
calls services directly (most already exist for the REST/MCP surface)" is right about
the *routes* existing, but understates that the *client* does not cover them.

### The other client — the one the SPA actually inherits

`src/shared/api/api-client.ts` is the browser-side counterpart: `apiRequest<T>()` at
`:45`, `ApiError` at `:21`. It owns `x-workspace-id`, JSON encoding, the
`x-updated-at` optimistic-concurrency precondition, query-param building, `204 →
undefined`, and the `{ error: { code, message, details } }` envelope. It is
**Next-free** and 18 files depend on it, with `useApiQuery`
(`src/shared/hooks/use-api-query.ts:4`) as the mandated TanStack wrapper over it.

This is what ports to the SPA as-is. The single change it needs: `fetch(url, {
credentials: "same-origin" })` at `api-client.ts:66-72` assumes a same-origin cookie
session. Under `file://` there is no origin and no cookie jar, so this function
becomes the IPC seam — same signature, same error envelope, different transport.
Doing it here (one file) rather than at ~200 call sites is the cheapest possible
Phase 2 data-layer cut.

15 additional call sites bypass `apiRequest` with raw relative `fetch("/api/...")`
(e.g. `src/features/workspaces/components/create-workspace-dialog.tsx:56`,
`src/features/billing/components/embedded-checkout.tsx:52`,
`src/shared/layout/settings-modal/sections/plans-billing.tsx:80`). These must be
converted before the SPA can run off-origin.

---

## 2. `packages/mcp-server` — role, runtime, coupling

`@dopl/mcp-server` v1.1.0, private, single export `./factory` →
`dist/factory.js` (`packages/mcp-server/package.json:8-13`). ~120 source files,
mostly channel tooling.

**Role.** The in-process MCP server engine. `factory.ts` is the side-effect-free
entry (`packages/mcp-server/src/factory.ts:1-9`), exporting `bootServer`,
`createServer`, `buildInstructions`, `clientIdentifier`.

**Runtime: Vercel only. It is not bundled into the desktop app, and does not need to be.**

- Sole consumer: `src/app/api/mcp/route.ts:3`. That route is
  `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 300`
  (`route.ts:32-34`), streaming over
  `WebStandardStreamableHTTPServerTransport`. The 300s ceiling is load-bearing for
  the 215s `dopl_channel(op="await")` hold (`route.ts:11-28`).
- `next.config.ts:26-30` keeps `@dopl/mcp-server`, `@dopl/client`, and
  `@modelcontextprotocol/sdk` in `serverExternalPackages` (they ship precompiled
  `dist/`, and `version.ts` reads its own `package.json` at runtime).
- The desktop **connects to it remotely**: `main/config.js:22` sets
  `MCP_URL = ${API_BASE}/api/mcp`, and `main/mcp-config.js` mints a device token
  from `POST /api/auth/mcp-device-token` and hands it to spawned Claude sessions
  (via an in-memory bearer for SDK sessions, or a mode-600 `mcp-spawn.json` for CLI
  spawns). The desktop's own `@modelcontextprotocol/sdk` dependency is the *client*
  side, not this server.

**Coupling to the web UI: zero.** No import of `@/...` anywhere in
`packages/mcp-server/src` or `packages/dopl-client/src` (verified by grep). Its only
dependencies are `@dopl/client`, the MCP SDK, and zod. It talks to the app strictly
over `/api/**` via a loopback `DoplClient` constructed in the route
(`route.ts:37-56`, which deliberately uses the request's real `Host` so the
`Authorization` header survives the apex→www redirect).

**Migration impact: none through Phase 4.** The plan's Phase 4 keeps `/api/**` and
"remote MCP", which is exactly this route. The one thing to preserve: the three
desktop OAuth handoff surfaces are **Next pages, not API routes** —
`src/app/auth/desktop-start/page.tsx`, `desktop-handoff/page.tsx`,
`desktop-complete/page.tsx` (all three already `"use client"`). Phase 4's "delete RSC
pages" must carve these out or port them to routes, or desktop sign-in breaks.

---

## 3. Desktop build pipeline today

### electron-builder config

Entirely inline in `dopl-desktop-app/package.json` — no `electron-builder.yml`.

| Setting | Value | Line |
|---|---|---|
| `appId` / `productName` | `com.dopl.connect` / `Dopl` | `:35-36` |
| `mac.target` | `["zip", "dmg"]` — zip is required for the updater feed | `:38-41` |
| `mac.hardenedRuntime` | `true`, `gatekeeperAssess: false` | `:43-44` |
| `mac.entitlements(Inherit)` | `entitlements.mac.plist` (JIT, unsigned-exec-memory, disable-library-validation, apple-events) | `:45-46` |
| `mac.notarize` | **`false`** — builder's built-in notarization is off | `:47` |
| `mac.extendInfo.CFBundleURLSchemes` | `["dopl"]` — the OAuth deep link | `:50-57` |
| `afterSign` | `./scripts/notarize.js` — the hand-rolled replacement | `:60` |
| `publish` | GitHub, `SamuelrWang/Dopl` | `:61-67` |
| `files` | **`["main/**/*", "renderer/**/*"]`** | `:83-86` |
| `asarUnpack` | `@anthropic-ai/claude-agent-sdk` only | `:87-89` |

macOS-only. No Windows/Linux targets, no `npmRebuild` config, no native modules today.

### Notarization

`notarize.js` and `mac.notarize: false` are **not** contradictory — they are two
implementations and only one runs. Builder's built-in path is disabled; the
`afterSign` hook owns zip → submit → wait → staple.

- Credentials, in order (`scripts/notarize.js:34-50`): `DOPL_NOTARY_PROFILE`
  (keychain profile, preferred — no secret on the command line), else
  `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`, else **warn and return** (the build
  succeeds un-notarized).
- `SKIP_NOTARIZE=1` short-circuits (`:19-22`). Hardcoded `TEAM_ID = '7352NBAF44'` (`:17`).
- `ditto -c -k --keepParent` → `xcrun notarytool submit --wait` (20-min timeout) →
  `xcrun stapler staple` (`:61,67-71,76`). On failure it regex-extracts the
  submission UUID from stdout and fetches `notarytool log` before rethrowing (`:78-93`).
- `scripts/finish-notarize.sh` (`npm run notarize`) is the post-hoc path for a DMG
  built without creds. Note its credential precedence is the **inverse** (env first,
  then keychain profile, `:49-60`), and it has a `setup` subcommand wrapping
  `notarytool store-credentials` (`:32-38`). It ends with `stapler validate` + `spctl`.

### Auto-update

Three client-side files. **There is no server-side gate anywhere.**

`main/updater.js` (imperative shell), wired at `main/index.js:354-358` inside
`app.whenReady()`:

- Hard gate `if (!app.isPackaged) return` (`updater.js:77-81`) — dev never checks.
- One check at startup + `setInterval` (`:156-158`), `.unref()`'d.
- `autoDownload = true`, `autoInstallOnAppQuit = true`, `logger = null` (`:91-95`).
- **No `setFeedURL`.** The feed comes from the `publish` block baked into
  `app-update.yml` at build time: GitHub releases `SamuelrWang/Dopl`, consuming
  `latest-mac.yml` + the zip.
- `error` is swallowed by default and surfaced only when the operator asked
  (`:118`). `update-downloaded` (`:132`) stages the build, notifies once, and opens
  the restart dialog **only when no agent session is live** — at most once per
  process (`:150-153`).
- Never force-restarts: install happens on normal quit, or an explicit click
  (`updater.js:1-30` documents the incident this design is a response to).

`main/update-policy.js` is the pure policy/copy core (no electron, no timers, no I/O
— `:1`): interval default 4h, clamped to `[60s, 24h]` (`:32-44`, consumed at
`main/config.js:47-54` via `DOPL_UPDATE_CHECK_MS`); progress percent that degrades to
`null` rather than a fake 0% (`:51-61`); restart prompt with
`buttons: ['Later','Restart now']`, `defaultId: 0` and an explicit
`isRestartChoice` so escape/close mean Later (`:143-168`).

**`main/version-skew.js` — correcting the plan.** The master plan says: *"Keep the
server-side minimum-version gate (`version-skew.js`) so old clients can be forced
forward."* That gate does not exist.

- `version-skew.js:15-17`: *"DELIBERATELY UNDERPOWERED… Nothing here gates, blocks,
  or refuses anything."*
- It calls **no endpoint**. It reads a *peer's* build off `metadata.appVersion` on an
  inbound channel message, compares it to a hardcoded `BEHAVIOR_FLOOR = '1.7.15'`
  (`:43`), and on a stale peer prints one diag line + one silent notification + one
  disabled tray line, deduped per `(peer, version)` for the process life.
- Server side, `src/shared/auth/app-version-header.ts:20-26` explicitly forbids
  gating: *"A DIAGNOSTIC / ROUTING HINT, NEVER AN AUTHORIZATION SIGNAL… Nothing may
  gate access, capability, or trust on it."* Any device-token holder can set the
  header.

So the Phase 4 risk mitigation ("Users stuck on old shell after cutover → Minimum-
version gate + auto-update on launch") is **net-new work**: a real gate needs a
server-authoritative minimum version (a `/api/version` or a 426 on `/api/**`) plus a
client that blocks on it. Budget it.

### Smoke test and CI

`npm run smoke` → `electron scripts/smoke-test.js`. Launches a real hidden
`BrowserWindow` with **production `webPreferences`** (`:19-29`), loads
`DOPL_APP_URL || https://www.usedopl.com/`, and asserts within 30s: page loaded, body
non-empty, and **`window.dopl.isDesktop` present** (`:50-56`) — i.e. it verifies the
preload bridge landed. Prints `SMOKE_RESULT {json}`, exits 0/1.

**CI: none for the desktop app.** `.github/workflows/packages.yml` is the only
workflow in the repo. Triggers are path-filtered to `packages/**`, `package.json`,
`package-lock.json`, `src/features/knowledge/types.ts`,
`scripts/check-knowledge-type-drift.ts` (`:3-22`) — which cannot match
`dopl-desktop-app/**`. Jobs:

1. `build-test` — matrix node 20/22 × ubuntu/windows: build both packages, then
   `npm test -w @dopl/client` (`:25-51`).
2. `size-check` — 500-line hard cap over `packages/**/*.ts(x)` with an allowlist
   (`:53-78`).
3. `type-drift` — `npx tsx scripts/check-knowledge-type-drift.ts` (`:80-95`).

Not run anywhere in CI: the desktop's 128 test files, the desktop's ESLint
`max-lines: 500` cap (`dopl-desktop-app/eslint.config.js:12`, covering
`main/`, `renderer/`, `scripts/`, `test/`), the smoke test, `next build`, `lint`,
`typecheck`, and the web's 114 vitest files. **Releases are fully manual**: a human
runs `npm run release` (`electron-builder --mac --publish always`) on a Mac holding
the Developer ID cert.

---

## 4. How the bundled SPA fits in

### Where Vite output should land

`files: ["main/**/*", "renderer/**/*"]` (`package.json:83-86`) already covers anything
under `renderer/`, so **`renderer/app/` is the zero-config landing spot** — no
electron-builder change needed for inclusion.

**Gotcha:** `dopl-desktop-app/.gitignore` line 2 is a bare `dist/`, which matches at
any depth. A Vite `outDir` of `renderer/app/dist` would be silently untracked. Either
name the output something else (`renderer/app/`) or scope the ignore to `/dist/`.

Asar: builder's default `asar: true` is fine — `loadFile` reads from inside the
archive, and the session window already proves the pattern. The current `asarUnpack`
list only exists because `@anthropic-ai/claude-agent-sdk` must be spawnable from the
real filesystem. **Phase 2's `better-sqlite3` will need to join it**, plus native
rebuild against Electron's ABI (`electron-rebuild` / `npmRebuild`) — the pipeline has
no native-module handling today, so this is the largest genuinely new build step.

### The precedent already exists: `renderer/session/`

The desktop is not starting from zero on local rendering. `main/session-window.js`
creates a window that is **`loadFile` only, never a remote URL** (`:24,43`), with:

- `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, dedicated preload (`session-window.js:36-38`).
- `setWindowOpenHandler(() => ({ action: 'deny' }))` and a `will-navigate` that
  blocks anything not `file://` (`:55-58`).
- A page CSP at `renderer/session/session.html:8`:
  `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none';`

**That CSP is exactly right for the SPA too** — and it is a consequence of the target
architecture, not a constraint on it. If the renderer never touches the network (all
HTTP moves to main behind IPC), the SPA needs **no `connect-src` at all**. Keep
`default-src 'none'`; add `style-src 'self' 'unsafe-inline'` only if a dependency
injects styles, and self-host fonts so `font-src 'self'` holds.

### Main window changes (`main/index.js`)

Today: `createMainWindow()` at `:44-114` creates the window at `:51` with
`preload: ../renderer/preload.js`, `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, `spellcheck: true` (`:58-64`). It then hands the load lifecycle to
`createLoadGuard` (`:74-81`) and calls `loadApp()` (`:83`, defined `:147`), which
loads `HOME_URL = https://www.usedopl.com/canvas` (`main/config.js:10`).

There is **no CSP set by the desktop for the main window** — no `onHeadersReceived`,
no `webSecurity` override anywhere in `main/`. The main window's CSP is whatever the
remote Next app sends. Bundling means the desktop owns it for the first time (via a
meta tag, as the session window does).

What changes:

- `loadApp()` → `mainWindow.loadFile('../renderer/app/index.html')` in production.
- `main/load-guard.js` becomes largely inert. Its whole purpose is recovering hung
  *remote* loads after sleep/wake (`load-guard.js:3-8`), and it explicitly **ignores
  `file:` URLs** in both `did-finish-load` (`:192-199`) and `did-fail-load`
  (`:210-217`). A `loadFile` main window never marks `remotePainted`. Keep the module
  through Phase 3 for the rollback path (plan §Phase 2 rollback), then delete with
  the rest of the remote machinery in Phase 4 — but do not expect it to guard the
  bundled load.
- `wireNavigation` (`:165-170`, origin-locked to `APP_ORIGIN`) becomes the
  session-window pattern: deny `window.open`, block any non-`file://` navigation.

### Dev mode

The seam already exists: `main/config.js:5` is
`APP_URL = process.env.DOPL_APP_URL || 'https://www.usedopl.com/'`. Point
`DOPL_APP_URL=http://localhost:5173` and the existing `loadURL` path serves the Vite
dev server with HMR, while production takes the `loadFile` branch. Standard shape:

```js
if (!app.isPackaged && process.env.DOPL_DEV_SERVER) {
  loadGuard.load(process.env.DOPL_DEV_SERVER);   // Vite, HMR, existing guard applies
} else {
  mainWindow.loadFile(path.join(__dirname, '../renderer/app/index.html'));
}
```

Two dev-mode consequences: (a) the strict CSP must relax for Vite's inline HMR client
— use a separate dev meta CSP or omit it when not packaged; (b) `updater.js:77-81`
already no-ops when `!app.isPackaged`, so dev is unaffected by the updater.

### Preloads

Two live preloads today, and they are opposite ends of a spectrum:

| | `renderer/preload.js` (main window) | `renderer/session/session-preload.js` |
|---|---|---|
| Size | 4.2 KB | 12.3 KB |
| Trust model | **Remote page** — "we expose nothing privileged" (`preload.js:1-17`) | **Local page** — the entire privileged bridge |
| Surface | `window.dopl`: `isDesktop`, `platform`, `versions`, 5 `channels.*` ops, `sessions.reopen` | Full session control: send, permission, inbound-decision, interrupt, end, close-task, modes, model, consent, handoff, folder ops |

`renderer/preload.js` is deliberately minimal *because the page is remote*. Its
channel-folder ops return an abbreviated `~/…` label and never a raw absolute path,
precisely so a local filesystem path never reaches the web page or its server
(`preload.js:6-16`).

**Once the page is local and bundled, that constraint dissolves** and the SPA preload
should follow the `session-preload.js` model: a typed, fixed-name `invoke` surface
covering the whole data layer. The security discipline to carry over verbatim is
`§B.3` — **payloads carry no session/window id; main re-derives identity from
`event.sender`**, so a forged id can never target another window
(`main/session-ipc.js:7`, `main/session-window.js:19-23`,
`main/channel-dir-ipc.js` `mainOnly(...)` binding handlers to the main window's own
top frame). Apply the same rule to workspace scoping in the new bridge.

IPC handlers today: 15 in `main/session-ipc.js`, 6 in `main/channel-dir-ipc.js`, 2 in
`main/session-auth.js`, 1 `ipcMain.on` in `main/claude-auth.js:94`. The SPA adds a
new family (roughly one per resource domain, or one generic
`api:request(method, path, body)` mirroring `apiRequest`'s signature — see §1).

### Auth — a correction

The plan says Phase 2 auth is "token-based via the existing desktop OAuth handoff…
Tokens stored in main process (keychain via `safeStorage`)". The **handoff** exists
(`dopl://auth#access_token=…`, `PROTOCOL` at `main/config.js:15`, the three
`/auth/desktop-*` pages), but the **current transport is cookies, not bearers**:

> `main/api.js:6-7` — "Auth is via the Electron session's Supabase cookies (see
> auth.js for why not a bearer). `withUserAuth` endpoints ({ sessionOnly: true }
> included) honor them."

`apiFetch` reads `auth.getAuthCookie()` and sets a `Cookie` header (`main/api.js:14-18`).
And `main/index.js:102-107` keeps the window *hidden rather than closed* specifically
to keep the renderer alive so those cookies stay live for the background listener.

So Phase 2's token model is a **rewrite of the auth seam**, and it interacts with the
"close hides the window" design: once the renderer no longer owns the session, that
workaround may be removable — worth checking before it becomes load-bearing for
something else.

The plan's risk-register line "Token auth breaks an API route that assumed cookies →
Routes already accept Bearer (`with-auth.ts`)" is the right mitigation, but note the
migration is desktop-main → bearer, not web → bearer.

---

## 5. Frontend inventory for the port

### `src/shared/ui/` — lifts as-is. Zero Next imports.

21 files, ~2,170 LOC. Verified: no `next/link`, `next/image`, `next/navigation`,
`next/font`, `next/headers`, `next/cache`, no `"use server"`, no `server-only`. The
only two `next/` string matches in the directory are eslint-disable comments
(`src/shared/ui/avatar.tsx:47`, `avatar-stack.tsx:37`).

Components: `avatar`, `avatar-stack`, `avatar-with-presence`, `confirm-dialog`,
`copy-button`, `empty-state`, `inline-editable-row`, `popover-menu`,
`scope-share-popover`, `search-field`, `section-box`, `segmented-control`,
`select-menu`, `send-button`, `skeleton`, `switch`, `toast`, plus
`auto-grow-textarea.ts` (hook) and `wells.ts` (class-string recipes).

Also Next-free and portable: `src/shared/graph/` (14 files),
`src/shared/design/`, `src/shared/editor/` (TipTap), `src/shared/hooks/`,
`src/shared/realtime/`, most of `src/shared/lib/`,
`src/shared/api/query-provider.tsx`, `src/shared/api/api-client.ts`.

Only cross-directory coupling: `confirm-dialog.tsx` imports `ModalShell` + a CSS
module from `src/shared/layout/settings-modal/` — itself Next-free.

### Tailwind v4 — ports with one real change (fonts)

- `src/app/globals.css:1` `@import "tailwindcss"`, `:2` `tw-animate-css`,
  `:4` `@plugin "@tailwindcss/typography"`, `:12-174` `@theme inline`, `:180+` `:root`
  palette, `:563-843` `@layer components` (the UI kit).
- **No `tailwind.config.*` exists** — CSS-first v4 config. `postcss.config.mjs` is
  three lines of `@tailwindcss/postcss` with nothing Next-specific; Vite reads it
  natively, or swap to `@tailwindcss/vite`.
- **No `@custom-variant`, `@variant`, `@source`, or `@utility` anywhere.**
- **No dark mode to port.** `globals.css:6-9` and `:359-361` — one palette,
  `html { color-scheme: light; }`, the dark/light split was deleted.
- CSS Modules (4) work in Vite with no config.

**The one blocker: `next/font`.** `src/app/layout.tsx:2` pulls six Google families
(`Hanken_Grotesk`, `Geist_Mono`, `Space_Grotesk`, `JetBrains_Mono`, `Newsreader`,
`Inter`), exposing CSS variables applied to `<body>` (`layout.tsx:104`). A Vite SPA
cannot use it — replace with `@fontsource/*` or self-hosted `@font-face` (self-hosted
is required anyway for the `font-src 'self'` CSP and offline use).

Mitigating: the app UI does not actually resolve through those variables.
`globals.css:128-132` sets `--font-app: "Helvetica Neue", …` and only `--font-mono`
consumes a next/font variable, with a `ui-monospace` fallback. The authenticated app
renders in Helvetica Neue regardless — the webfonts are effectively
landing-page-scoped, and the landing pages die in Phase 4. **Low-risk substitution.**

Other env work: `NEXT_PUBLIC_*` → `import.meta.env.VITE_*`
(`src/shared/supabase/browser.ts:14-15`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` aliased at
`next.config.ts:11-13`).

### `docs/DESIGN-SYSTEM.md` — no Next coupling

119 lines, mandated reading by `CLAUDE.md`. Specifies: the no-hand-rolled-values rule
(`:3-6`); `src/app/globals.css` as source of truth (`:8-9`); an 8-step semantic type
ramp with `text-sm`/`text-xs`/`text-[13px]` explicitly banned in app UI (`:18-34`);
the color token table (`:36-52`); kit classes `.page-float`, `.bento`,
`.concave-field`, `.concave-sel`, `.concave-track`, `.raised-tab`, `.btn-light`,
`.auth-btn-3d`, `.graph-*` (`:54-69`); the CSS-Modules-for-layout +
kit-classes-for-recipes composition pattern (`:71-79`); and the `src/shared/ui/*`
primitives table (`:81-99`).

The only structurally Next-flavored line is `:109-110` ("page renders bare into the
app shell"), describing App Router nested layouts — which maps cleanly to a React
Router layout route.

**Bonus: the SPA collapses an existing duplication.**
`dopl-desktop-app/renderer/session/tokens.css:1-14` is a hand-copied subset of
`globals.css:180-261` plus the kit recipes, carrying an explicit drift warning
(REFACTOR-FINDINGS F-074): *"if globals.css lines 180-261 or the kit classes change,
update this file in lockstep."* Once the SPA is bundled with the real `globals.css`,
the session window can import from one source and F-074 closes.

### Porting burden across `src/`

705 non-test `.ts(x)` files in `src/`; ~247 non-test `.tsx`.

| Import | Sites | Where | Cost |
|---|---|---|---|
| `next/server` | 141 | `src/app/api/**`, `src/proxy.ts` | **None — backend stays** |
| `server-only` | 136 | all under `features/*/server/`, `shared/api`, `shared/auth` | **None — backend stays.** Zero in `shared/ui`, `shared/layout`, `shared/graph`, `shared/design`, `shared/editor`, `shared/hooks`, or any `features/*/components/` |
| `next/navigation` | 50 | 25 in `src/app/**`, 20 in `features/**`, 5 in `shared/**` | ~23 real client call sites; `useRouter().push/replace`, `usePathname`, `useSearchParams` shim over a router. **`router.refresh()` is the exception** — RSC-specific, becomes `invalidateQueries` |
| `next/link` | 15 | 9 features, 4 app, 2 shared | Trivial alias |
| `next/headers` | 2 | `shared/supabase/server.ts:2`, `app/auth/callback/route.ts:3` | Backend |
| `next/font/google` | 1 | `src/app/layout.tsx:2` | See above |
| `next/image` | **0** | — | None |
| `"use server"` | **0** | — | **None. No Server Actions anywhere.** |

**The single most favorable fact for this migration: zero Server Actions.** Every
mutation already goes through `src/app/api/**` over HTTP. The SPA keeps talking to
the identical API.

**The single biggest cost: 17 async server-component pages.** All pages under
`src/app/[workspaceSlug]/(app)/` are async RSCs with `export const dynamic =
"force-dynamic"`, doing server-side auth + fetch and passing props into one client
component (canonical example:
`src/app/[workspaceSlug]/(app)/knowledge/page.tsx:9-87`). Each prologue must become a
client loader. The 12 route dirs match the plan's port list: `canvas`, `canvas2`,
`channels`, `chats`, `configuration`, `knowledge`, `members`, `ontology`, `overview`,
`settings`, `skills`, `workflows`.

Feature components by size (non-test `.tsx`): channels 26, knowledge 22, ontology 21,
members 17, marketing 13 (**dies with the website**), workflows 13, configuration 10,
workspaces 7, then ≤6 each. This matches the plan's port order putting
ontology/canvas and channels last.

### TanStack Query — already in place

`@tanstack/react-query` ^5.101.2. `src/shared/api/query-provider.tsx:16-32` — a
Next-free `QueryProvider` with `staleTime: 30_000`, `gcTime: 5min`, and a retry
predicate that skips 4xx by reading `ApiError.status`. Mounted at
`src/app/layout.tsx:116-118`; moves to `main.tsx` unchanged.
`src/shared/hooks/use-api-query.ts:4` is the mandated wrapper; 14 more files use the
cache directly.

Phase 1's disk persistence (`@tanstack/query-persist-client` + idb) lands in this one
provider file and survives into the SPA.

---

## 6. Test infrastructure and what the SPA should use

| Suite | Files | Runner | Wired to a script? | In CI? |
|---|---|---|---|---|
| Web app (`src/**/*.test.ts(x)`) | 114 | vitest (`vitest.config.ts`) | **No** — root `package.json` has no `test` script | **No** |
| `@dopl/client` | 3 | vitest, `environment: "node"` | `npm test -w @dopl/client` | **Yes** |
| `@dopl/mcp-server` | 38 | vitest (`vitest.config.ts` exists) | **No** — scripts are `build`, `dev` only | **No** |
| Desktop | 128 `*.test.mjs` | `node --test 'test/**/*.mjs'` | `npm test` | **No** |
| Desktop live contract | 8 `.js` | `node test/live/run.js` | `npm run test:live` | No (by design) |

Root scripts are `dev, dev:turbo, build:packages, build, start, lint, typecheck`.
**152 vitest files across the web app and mcp-server have no npm script and no CI.**
Fixing that is cheap and worth doing before the migration, not after — it is the only
regression net the port has.

**Web vitest setup** (`vitest.config.ts`): aliases `@` → `src` and stubs the
`server-only` package with `vitest.server-only-shim.ts` (needed because the real
package throws outside a client-component context). `vitest.setup.ts` seeds Supabase
env vars. **No `environment: "jsdom"` and no `@testing-library/*`** — the 114 tests
are logic/service tests plus `react-dom/server` string snapshots (e.g.
`src/shared/ui/send-button.test.tsx`).

**Desktop tests** use Node's built-in runner with zero test dependencies, via three
techniques: source extraction (106 of 129 files `readFileSync` a `main/*.js` and
`new Function`-evaluate a sentinel-delimited pure block — see
`main/version-skew.js:33`/`:94` sliced by `test/version-skew.test.mjs:33-38`, helpers
in `test/helpers/source-probe.mjs`); require-cache priming with fake `electron` /
`electron-updater` (`test/update-restart-prompt.test.mjs:99,114`); and direct ESM
import where Electron is behind an injected boundary (`test/load-guard.test.mjs:12`).
Three files mention jsdom **only to say they deliberately avoid it**, hand-rolling a
~10-property element stub instead (`test/session-render-dom.test.mjs:22-31`).

`test/live/run.js` is an end-to-end harness against production: it creates a
throwaway `harness-<stamp>` channel, refuses the operator's real DM, and skips
cleanly (exit 0) with no credential. **Its `.js` extension is load-bearing** — `npm
test` globs `test/**/*.mjs` and `**` matches zero segments, so a `.mjs` rename would
point the ordinary suite at prod (`test/live/creds.js:5-9`).

### Recommendation for the SPA

- **Vitest + jsdom (or happy-dom) + `@testing-library/react`.** The renderer becomes
  React, so neither existing approach transfers: desktop source-extraction cannot
  test components, and the current vitest config has no DOM environment. This is
  net-new setup — one `vitest.config.ts` with
  `environment: "jsdom"`, `setupFiles` for `@testing-library/jest-dom`, and the same
  `@` alias.
- **Keep the web `vitest.config.ts` for the surviving `src/app/api/**` +
  `features/*/server/**` tests.** Those are Node-environment and unaffected. A
  workspace-level vitest projects config can run both.
- **Keep desktop `node --test` for `main/**` as-is.** It is well-adapted to
  Electron-free pure-core testing and the source-probe discipline is battle-tested.
  Do not migrate it.
- **Keep `scripts/smoke-test.js`, but repoint it.** After bundling it should
  `loadFile` the built SPA and assert first paint + the preload bridge — which makes
  it a genuine release gate for the first time (today it only proves the remote site
  is up).
- **Add CI.** Minimum viable: a `desktop` workflow on `dopl-desktop-app/**` running
  `npm run lint` + `npm test`, and a `web` workflow running `npx vitest run` +
  `npm run typecheck`. Extend the `packages.yml` matrix to run mcp-server's 38 tests
  (add a `test` script to its `package.json` first). Signed release builds can stay
  manual — they need the Developer ID cert.

---

## Summary of corrections to the master plan

| Plan statement | Reality |
|---|---|
| "Keep the server-side minimum-version gate (`version-skew.js`)" | No such gate exists. `version-skew.js:15-17` is an advisory peer diagnostic; `app-version-header.ts:20-26` forbids gating on the header. Phase 4's mitigation is net-new work. |
| "Tokens stored in main process (keychain via `safeStorage`)" | Desktop API auth is Electron **session cookies** today (`main/api.js:6-18`). Phase 2 rewrites this seam. |
| "most already exist for the REST/MCP surface" | The *routes* exist (123). `@dopl/client` covers ~50 and omits billing, oauth, onboarding, workspace admin, trash, and channel consent/presence/trust entirely. |
| (implicit) `packages/dopl-client` is the SPA's client | It cannot run in a renderer (`node:async_hooks`, `transport.ts:2`). Use it in **main**; the SPA inherits `src/shared/api/api-client.ts` instead. |
| Phase 4 "Delete RSC pages" | The three `/auth/desktop-*` surfaces are **pages**, not API routes. Deleting them breaks desktop sign-in. |
