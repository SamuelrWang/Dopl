# Desktop main process — migration map

**Scope:** `dopl-desktop-app/main/` (89 modules) + `dopl-desktop-app/renderer/` (preloads and
local pages). Research doc for Phase 2 of [DESKTOP-MIGRATION-PLAN.md](../DESKTOP-MIGRATION-PLAN.md)
(thin remote-loading shell → bundled local-first Vite SPA).

**One-line verdict:** the main process is already the target architecture — it owns credentials,
network, realtime and agent execution, and it never depends on React. It depends on the remote
web page for exactly **three** things: (1) a live Supabase **cookie jar** that the page keeps
refreshed, (2) `loadURL` navigation targets (`/canvas`, `/{slug}-{publicId}/channels`,
`/auth/desktop-complete`), and (3) the `window.dopl` preload bridge that a handful of web
components feature-detect. (1) is the migration's hard problem.

---

## 1. Module inventory by subsystem

### 1.1 Config / plumbing (5)

| Module | Job |
|---|---|
| `config.js` | Single source for `APP_URL`/`APP_ORIGIN`/`HOME_URL` (`/canvas`), `PROTOCOL` (`dopl`), `API_BASE`, `MCP_URL`, Supabase URL/anon key/ref, and the LISTENER/REALTIME/UPDATER tuning tables. `config.js:4-35` is the entire remote-origin coupling surface. |
| `api.js` | The shared authenticated fetch: `Cookie` header from `auth.getAuthCookie()`, `X-Workspace-Id`, `X-Dopl-App-Version`, AbortController timeout — `api.js:13-38`. Plus `resetPool()`, which swaps Node/undici's global dispatcher after sleep/wake (`api.js:58-80`) because Electron main's fetch stack is separate from Chromium's. |
| `app-version.js` | Builds the `X-Dopl-App-Version` header stamped on every desktop request. |
| `diag.js` | Append-only plaintext log to `userData/listener.log`, truncated ~1 MB (`diag.js:16`). Console output is invisible for a GUI-launched app, so this is the only observability channel. |
| `settings.js` | electron-store settings: window mode toggle, turn cap, idle TTL, cost cap. |

### 1.2 Auth (6) — see §3 for the entanglement analysis

| Module | Job |
|---|---|
| `auth-store.js` | Lowest layer: `safeStorage`-encrypted session blob in electron-store (`authSession`), JWT decoders, throttled failure logging. **Refuses plaintext fallback** when the keychain is unavailable (`auth-store.js:44-55`). |
| `auth-cookies.js` | Everything touching `session.defaultSession.cookies` for the `sb-<ref>-auth-token*` family: read/reassemble the chunked `@supabase/ssr` cookie (`auth-cookies.js:83`), build the `Cookie` header (`:125`), write the jar back from the blob (`:165`), clear it (`:141`). Host-only predicate `isOurAuthCookie` (`:60`) pins reads to `APP_ORIGIN`'s exact host. |
| `auth-state.js` | Policy: `isSignedIn()` = blob **or** fresh cached cookie identity (`auth-state.js:39-64`, `:182`); `rebuildBlobFromCookieSession` adopts a fresher jar into the blob (`:100`) with an identity cross-check; `signOut()` (`:265`) tears down blob + jar + MCP device token (local **and** server revoke) + Claude OAuth token. |
| `auth.js` | Deep-link CSRF gate (`beginPendingAuth`/`consumePendingAuth`, `auth.js:49-69`), `captureFromFragment` (`:75`), Realtime credential choice `chooseAccessToken` (`:159`), Supabase refresh single-flight (`:239`), `getAuthCookie()` (`:304`). Re-exports auth-state so no call site changed. |
| `auth-actions.js` | `isAppOrigin` (exact-origin gate, `auth-actions.js:38`), `maybeBeginAuth` (appends the `state` nonce, `:51`), tray `beginSignIn` → `shell.openExternal(${APP_ORIGIN}/auth/desktop-start)` (`:18`, `:65`), `signOut` (`:78`). |
| `session-auth.js` / `session-auth-detect.js` | A **separate** credential axis: whether the machine has a usable *Claude Code* sign-in (`session-auth.js:37`, `:65`, `:82-93`), plus the in-window sign-in banner IPC (`:307-320`). Not Dopl auth. |

### 1.3 Window / shell (7)

| Module | Job |
|---|---|
| `index.js` | App entry. Window creation with the zero-privilege preload (`index.js:51-65`), load-guard wiring (`:74`), close-hides-window (`:102`), `wireNavigation` (`:152`), deep link `dopl://` handler (`:187`), single-instance lock, whenReady bootstrap of tray/updater/session engine/listener/mcp-config, powerMonitor wake (`:408-425`). |
| `load-guard.js` | Owns **every** remote load for the main window: pure reducer `decideLoad` (`load-guard.js:56`), 11 s hang watchdog (`:30`), backoff retries, local loading/offline screens, `closeAllConnections()` + `resetMainPool()` on a hung load, `onWake()` (`:240`). Entirely about `loadURL(remote)`. |
| `app-menu.js` | Menu bar. Back/Forward drive `webContents.navigationHistory` (`app-menu.js:55-64`) — i.e. **browser history over the remote site**. "Home" calls `loadApp()` → `HOME_URL`. |
| `tray.js` | Menu-bar tray: listener status, pending-consent count, sessions submenu, channel-folders submenu, update-ready item, peer-skew line, sign in / sign out. `tray.js:196` builds the menu; index.js injects every accessor (`index.js:284-335`). |
| `updater.js` | electron-updater ↔ GitHub Releases (`SamuelrWang/Dopl`), silent download, tray progress, never auto-restarts (a restart kills a live spawned session). `updater.js:69` init, `:239` promptRestart, `:265` requestRestart. |
| `update-policy.js` | Pure resolver for `DOPL_UPDATE_CHECK_MS`, clamped to [60 s, 24 h]. |
| `version-skew.js` | Reads a peer's `metadata.appVersion` off their messages and warns once per (peer, version) when they are below `BEHAVIOR_FLOOR = '1.7.15'` (`version-skew.js:43`, `:115`). **Diagnostic only — it gates nothing** (`version-skew.js:14-17`). |

> Note for the plan: DESKTOP-MIGRATION-PLAN.md §Principles calls `version-skew.js` "the server-side
> minimum-version gate ... so old clients can be forced forward". It is not that today. It is a
> one-line advisory notification with no enforcement anywhere. A real minimum-version gate is
> **new work**, server-side.

### 1.4 Channel agent machinery (16)

| Module | Job |
|---|---|
| `channel-listener.js` | The per-channel long-poll loop, channel-set reconciliation, and the public `start/stop/restart/wake/status` surface. `channel-listener.js:61` (channelLoop), `:178` (reconcile), `:346-386` (status/watched list/handlers). |
| `listener-io.js` | The listener's I/O layer: its **own** copy of `apiFetch` (`listener-io.js:203-226`), cursor/seed persistence, workspace+channel listing, operator identity resolution (`:350`), display-name/avatar cache (`:398`). |
| `listener-messages.js` | Routes one inbound message: pre-classify session-window routes → `targeting.classify` → verdict outcomes (`listener-messages.js:26`). |
| `listener-heal.js` | Bounded self-heal policies: miss-triggered re-enumeration, per-workspace retry ladder, workspace-set reapplication when realtime `want=0` (`listener-heal.js:90`). |
| `channel-agents.js` | Greets/summons `channel_agents` rows this operator owns; routes @-addressed / thread / engaged messages into the right agent session (`channel-agents.js:260`). |
| `channel-roster.js` | Cached read + PATCH of a channel's agent roster and the ownership/liveness/handle predicates every routing lane consults (`channel-roster.js:152`, `:184`). |
| `channel-threads.js` | Cached single-flight read of a thread's participant set (`channel-threads.js:160`). |
| `channel-engagement.js` | Decides who an *untagged* message is for — the idle "address to act" default plus a 60-min ENGAGED widening (`channel-engagement.js:56`, `:213`). |
| `channel-deliver.js` | Hands one message to one agent of mine: wake if idle, self-echo filter, room binding (`channel-deliver.js:99`, `:108`). |
| `channel-post.js` | The only writer of `channel_messages` from the listener side; idempotent via deterministic `clientMsgId` (`channel-post.js:59`, `:127`). |
| `channel-context.js` | Reconstructs the (workspaceId, counterparty, channelName) context a session window needs when there is no local record; 60 s cache (`channel-context.js:75`). |
| `channel-dirs.js` | **Local-only** per-channel working directory + native folder picker (`channel-dirs.js:153`). Never sent to the server. |
| `channel-dir-ipc.js` | The sender-bound IPC surface exposed to the remote page — see §2. |
| `channel-prefs.js` | Local single-use expiring permission-preset "arm", consumed by the one consent-approved launch that follows (`channel-prefs.js:214`). |
| `legacy-threads.js` | Durable local registry of pre-`create_thread` thread ids so a peer's reply can be matched without server task metadata (`legacy-threads.js:161`, `:191`). |
| `avatar-cache.js` | SSRF-guarded fetch of a member avatar into a capped `data:` URI so the session window's `img-src 'self' data:` CSP can render it (`avatar-cache.js:103`). |

### 1.5 Realtime + presence (4)

| Module | Job |
|---|---|
| `realtime.js` | Supabase Realtime WS transport: per-workspace `postgres_changes` INSERT on `channel_messages`, channel `dopl-desktop:${wsId}` (`realtime.js:298`); JWT via `applyAuth`/`setAuth` (`:199`); circuit breaker; wake coalescing; `refreshAuth()` (`:382`). |
| `realtime-core.js` | Pure electron-free cores: breaker, wake coalescer, `wakeChannelId` (`realtime-core.js:95`), subscribe-error normalization, join gate (`:170-179`). |
| `realtime-agents.js` | A **second, independent** channel `dopl-desktop-agents:${wsId}` for `channel_agents` INSERT+UPDATE — the roster doorbell, deliberately outside the message breaker (`realtime-agents.js:60`). |
| `presence.js` | 30 s "listening" heartbeat POST per watched workspace (`presence.js:55`). |

### 1.6 Targeting / trigger / notify (7)

| Module | Job |
|---|---|
| `targeting.js` | The message classifier — `classify` returns trigger / fyi / task-reply / agent-escalation / ignore (`targeting.js:60`). Deliberately dependency-free (evaluated as a sliced `new Function` scope by its tests); the legacy-thread store is **injected** from `index.js:381`. |
| `targeting-window.js` | The notification→window handoff `openChannelForEntry` → `handlers.openChannel(segment)` (`targeting-window.js:27`) + tool-profile resolution. |
| `trigger.js` | The non-blocking consent → spawn → reply pipeline: create the consent row, register with the watcher, fire the native notification, and on approval launch a session window or headless spawn (`trigger.js:105`, `:242`, `:363`). |
| `trigger-outcomes.js` | Terminal "no reply produced" echoes — denied / expired / cancelled / interrupted, each posting `task_failed` with a distinguishing flag (`trigger-outcomes.js:36`). |
| `queued-notice.js` | One-per-thread "queued behind an active session" milestone post (`queued-notice.js:59`). |
| `task-notify.js` | Passive (no consent, no spawn) OS notifications: requester task-reply, agent-escalates-to-human, message addressed to a dismissed agent (`task-notify.js:44`, `:88`, `:199`). |
| `consent-cadence.js` | Pure poll-cadence math (active/idle intervals, per-minute cap) for the consent watcher. |

### 1.7 Consent (3)

`consent.js` — stateless consent-row HTTP primitives against `/api/channels/consent` plus the
native notification builders (`consent.js:39`, `:182`). `consent-watcher.js` — polls each pending
row off the long-poll loop and dispatches decisions to trigger.js; self-gates on
`auth.isSignedIn()` (`consent-watcher.js:27`). `session-consent.js` — the *pre-consent window*:
renders request text + Accept/Deny with **no SDK query and no tools running yet**
(`session-consent.js:13`).

### 1.8 Session engine (33)

The largest subsystem and, per the plan, the one that must survive untouched. Split for the
500-line cap; the shape is **pure reducer + imperative shell**.

*Core lifecycle:* `session-engine.js` (imperative shell, owns the one live `query()` per session,
imports no electron), `session-reducer.js` (`sessionReducer(state,event) → {state,effects}`, the
single decision point, `session-reducer.js:8`), `session-state.js` (pure state shape + mode
tables), `session-effects.js` (pure effect-descriptor builders), `session-io.js` (SDK-message →
reducer-event mapping, `canUseTool` bridge, durable projection), `session-query.js`
(`buildSdkOptions` + `startQuery`/`consume` — the ONE assembly point for every spawn shape,
`session-query.js:16`), `session-dispatch.js` (listener's pre-classify routing into the engine),
`session-store.js` (durable electron-store records + SDK resume-id map), `session-pool.js`
(concurrency guard), `session-spawner.js` (headless `claude -p` spawner, nonce-fenced prompt,
`session-spawner.js:295`).

*Windowing:* `session-window.js` (the injected BrowserWindow factory — **`loadFile` only**,
`session-window.js:43`), `session-shell.js` (electron plumbing kept out of the engine),
`session-replay.js` (bounded transcript ring re-sent to a reloaded window), `session-reopen.js`
(tray listing + reopen by id or (channelId, taskId)), `session-park.js` (idle-park/resume; a
resume reuses the same `buildSdkOptions` path), `session-ipc.js` (all `session:*` handlers).

*Permissions/gates:* `session-profiles.js` (the canonical Axis A toolMode / Axis B messageMode
tables), `session-gate.js` (inbound-message gate — every counterparty reply is held until the
operator accepts), `session-gate-reason.js`, `session-grant-keys.js` (SHA-256 scoped
`allowForTask` key, `session-grant-keys.js:24`), `session-outbound.js` +
`session-outbound-tag.js` (outbound approval card; force-tags the session's own post with its
thread id via `canUseTool`'s `updatedInput`), `tool-profiles.js` (the four-layer *headless*
containment table: `--tools`, scoped `--settings`, `--disallowedTools`, `--strict-mcp-config`).

*Content:* `session-seed.js` (turn text assembly, counterparty fencing, history seed),
`prompt-framing.js` (pure counterparty-framing text builder), `session-greeting.js`,
`session-history.js` + `session-history-copy.js` (paints read-only history in a recreated shell),
`session-model.js` (frozen model enum + context meter), `session-team.js` (room-bound multi-party
mode), `session-peer-post.js` (operator's own `@peer` post, straight to HTTP, no SDK),
`session-close-task.js` (PATCH-closes the channel task on end).

*Claude / MCP credentials:* `sdk-loader.js` (the only module touching the ESM-only Claude Agent
SDK — dynamic `import()`, asar-unpack path rewrite `sdk-loader.js:44-48`, in-memory `mcpServers`
builder `:142-164`, scrubbed spawn env), `claude-resolve.js` (resolves the absolute `claude`
binary because GUI launches inherit launchd's minimal PATH), `claude-auth.js` (drives
`claude setup-token` under a pty, `claude-auth.js:108`), `claude-token.js` (safeStorage-encrypted
`claudeOAuthToken`), `mcp-config.js` (mints/caches the Dopl MCP device token, writes
`userData/mcp-spawn.json` mode 600, ensures a `claude mcp add dopl` entry), `mcp-cli-add.js`
(the three `claude mcp add/remove/get` child-process calls), `attended-handoff.js` +
`attended-prompt.js` ("Open in Claude Code" — hands the request to the operator's own Claude
Code app/terminal/clipboard instead of spawning).

---

## 2. IPC surface

Three preloads, three disjoint surfaces. **No `ipcMain` handler anywhere trusts an id from the
payload** — every one re-derives its subject from `event.sender`.

### 2.1 `renderer/preload.js` → the **main window** (remote content today)

Exposed as `window.dopl`. This is the ONLY bridge the web app sees, and the only one the SPA
migration must re-home.

| Channel | Handler | Behavior |
|---|---|---|
| `channels:getFolderLabel` | `channel-dir-ipc.js:124` | → abbreviated `~/…` label or `null`. Never the absolute path. |
| `channels:chooseFolder` | `channel-dir-ipc.js:131` | Opens the native folder picker; → new label. |
| `channels:clearFolder` | `channel-dir-ipc.js:143` | Resets to sandbox default; → `null`. |
| `channels:getPermissionPreset` | `channel-dir-ipc.js:170` | → `{tools, messages}` or `null`. |
| `channels:setPermissionPreset` | `channel-dir-ipc.js:178` | → `{ok}` only when both values are known enum members. |
| `sessions:reopen` | `channel-dir-ipc.js:192` | Reveals/fronts an existing live session window for (channelId, taskId). Starts no query. → `{ok}`. |

Every one is wrapped in `mainOnly(...)`, which enforces `isMainWindowSender`
(`channel-dir-ipc.js:86-99`): sender must be the main window's `webContents` **and** the top frame
(an iframe of usedopl.com content shares the webContents and is refused). Fails closed when the
window is null/destroyed or `senderFrame` throws.

Also exposed, non-IPC: `isDesktop: true`, `platform`, `versions` — the marker
`src/shared/lib/desktop.ts:53` feature-detects.

**Web consumers of this bridge** (each is Phase-2 migration work):
`src/shared/lib/desktop.ts:65,77`, `src/features/auth/hooks/use-login.ts:131` (branches OAuth to
the system-browser flow), `src/features/channels/hooks/use-channel-folder.ts`,
`src/features/channels/hooks/use-channel-permission-preset.ts:86`,
`src/features/channels/components/channel-pane.tsx:338`, `create-channel-dialog.tsx:39`,
plus `consent-card` / `session-card` / `permission-preset-row`.

### 2.2 `renderer/session/session-preload.js` → session windows (**local `file://` only**)

Exposed as `window.doplSession`. Handlers in `session-ipc.js` unless noted.

| Channel | Line | Behavior |
|---|---|---|
| `session:send` | `session-ipc.js:41` | Steer the live query (text + `now`/`normal` priority). |
| `session:send-peer` | `:50` | Operator's own `@peer` post; no SDK involvement. |
| `session:permission` | `:73` | Outbound/tool approval card decision (`allow-once`/`allow-task`/`deny`). |
| `session:inbound-decision` | `:101` | Inbound gate (`accept`/`accept-task`/`decline`), fail-closed. |
| `session:interrupt` | `:113` | |
| `session:end` | `:114` | |
| `session:close-task` | `:115` | outcome + summary. |
| `session:set-tool-mode` | `:125` | Axis A (`manual`/`accept_edits`/`auto`/`bypass`). |
| `session:set-message-mode` | `:137` | Axis B (`ask`/`auto_inbound`/`auto_outbound`/`auto_both`). |
| `session:set-model` | `:146` | Frozen enum → `--model` argv. |
| `session:consent-decision` | `:149` | Pre-consent Accept/Deny. |
| `session:attended-handoff` | `:168` | Open the operator's own Claude Code on this request. |
| `session:folder-get` / `-choose` / `-clear` | `:183`/`:184`/`:188` | Label-only folder ops. |
| `session:auth-signin` | `session-auth.js:309` | Start the Claude Code sign-in from the banner. |
| `session:auth-state` | `session-auth.js:316` | Current auth hold, or null. |

**main → renderer:** a single `session:event` channel, fanned out in the preload to three sinks
(transcript, auth banner, request strip). Senders: `session-shell.js:35`, `session-consent.js:172`
and `:301`, `session-ipc.js:341`.

Every enum is coerced **fail-closed twice** — once in the sandboxed preload, once again in main
against the canonical table (`session-profiles`, `session-model`). Pinned by
`test/session-permission-axes` and `test/session-model.test.mjs`.

### 2.3 `renderer/code-prompt-preload.js` → the Claude sign-in paste window (local page)

One channel, one direction: `code-prompt:submit` (`ipcMain.on`, `claude-auth.js:94`).

---

## 3. AUTH ENTANGLEMENT (critical)

### 3.1 How it works today

```
system browser                          Electron main                      Electron renderer
──────────────                          ─────────────                      ─────────────────
/auth/desktop-start
  └ supabase.signInWithOAuth(google)
     redirectTo /auth/callback?desktop=1
/auth/callback  (isDesktop → )
  └ /auth/desktop-handoff
     └ location = dopl://auth#access_token=…&refresh_token=…
                                        app.on('open-url')  index.js:247
                                        openDeepLink()      index.js:187
                                          ├ auth.captureFromFragment()  auth.js:75
                                          │   └ CSRF gate consumePendingAuth() auth.js:62
                                          │   └ persist() → safeStorage blob   auth-store.js:34
                                          └ loadGuard.load(APP_ORIGIN + '/auth/desktop-complete#'+frag)
                                                                             └ supabase.setSession()
                                                                                → WRITES sb-<ref>-auth-token*
                                                                                  cookies into the SHARED
                                                                                  Electron cookie jar
                                        (+3 s) listener.restart(); mcpConfig.ensureMcpConfig()   index.js:220-223
```

Two credential stores result, and **they drift**:

- **The blob** (`authSession`, safeStorage-encrypted, `auth-store.js:13`). Written only by
  `captureFromFragment` and `refresh()`. Its JWT dies ~1 h after sign-in and stays dead unless
  something refreshes it (`auth.js:143-148` says so explicitly).
- **The cookie jar** (`sb-<ref>-auth-token[.0-9]`, host-only for `APP_ORIGIN`). Written by the
  **remote page's** Supabase browser client, which auto-refreshes it. This is the fresh one.

`auth-state.js` reconciles them: `rebuildBlobFromCookieSession` (`auth-state.js:100`) adopts a
fresher jar into the blob, with an identity cross-check that refuses adoption when the two name
different users (`:114-118`).

### 3.2 Who depends on cookies vs. tokens

**Cookie-authed HTTP (via `auth.getAuthCookie()` → `Cookie:` header).** Everything:

| Consumer | Transport | Endpoints |
|---|---|---|
| `channel-listener.js` / `listener-io.js` | own `apiFetch` (`listener-io.js:203-226`) | `/api/channels/{id}/await`, `/api/workspaces`, `/api/channels`, `/api/workspaces/me`, `/api/workspaces/{seg}/members` (`listener-io.js:244,268,294,359,404`) |
| `channel-post.js` | listener apiFetch | `POST /api/channels/{id}/messages` (`:59`, `:127`) |
| `channel-roster.js` | listener apiFetch | `GET`/`PATCH /api/channels/{id}/agents[/{agentId}]` (`:155`, `:184`) |
| `channel-threads.js` | listener apiFetch | `GET /api/channels/{id}/tasks/{threadId}` (`:163`) |
| `trigger.js` | listener apiFetch | `GET /api/channels/{id}/messages?since=…` (`:219`) |
| `presence.js` | `api.js` | `POST /api/channels/presence` (`:55`) |
| `consent.js` | `api.js` | `POST /api/channels/consent`, `PATCH /api/channels/consent/{id}` (`:110,138,158`) |
| `session-history.js` | `api.js` | `GET /api/channels/{id}/messages?limit=…` (`:354`) |
| `session-peer-post.js` | `api.js` | `POST /api/channels/{id}/messages` (`:100`) |
| `session-close-task.js` | `api.js` | `PATCH /api/channels/{id}/tasks/{taskId}` (`:19`) |
| `mcp-config.js` | `api.js` | `POST`/`DELETE /api/auth/mcp-device-token` (`:327`, `:393`) |

**Why not a bearer** (`auth.js:3-13`): `withUserAuth` treats **any** `Authorization` header as an
OAuth *MCP* token and validates it against the MCP token store. A raw Supabase JWT fails that
check and returns `401 Invalid or expired credentials` — **it never falls through to the cookie
branch** (`src/shared/auth/with-auth.ts:180-185`). Cookies are the only path a session caller has.

**Raw-JWT consumers (not cookies).** Exactly one: **Realtime**. `realtime.js` calls
`auth.getAccessTokenInfo()` → `client.setAuth(token)` (`realtime.js:199-230`).
`chooseAccessToken` (`auth.js:159`) picks the *freshest* of `{stored blob, cookie}` — the cookie
is normally the winner precisely because the web page refreshes it. It fails closed with no
credential (`realtime-core.js:170-179`): an anon join raises `42501` on the published tables and
takes down the whole project's `postgres_changes` pipeline for every client.

**Bearer-token consumers (a different credential entirely).** The spawned agent's MCP calls use
the **Dopl MCP device token** (`dopl_at_*`, 90-day, `dopl.read`+`dopl.write`), injected as
`Authorization: Bearer` on the in-memory `mcpServers` entry (`sdk-loader.js:76-80,142-164`). This
token is **minted with cookie auth**, and the route is `sessionOnly: true`
(`src/app/api/auth/mcp-device-token/route.ts:48`), which means an OAuth bearer gets a hard
`403 SESSION_REQUIRED` (`with-auth.ts:128-137`). There is no bearer path to minting it.

### 3.3 What breaks when the UI becomes a bundled SPA

**The transport survives; the refresher dies.** Nothing in main reads the *page*. It reads the
Electron **cookie jar**, which is process state, not page state, and `writeSessionCookies()`
(`auth-cookies.js:165`) can populate it with no page loaded at all. So:

| # | Break | Severity | Where |
|---|---|---|---|
| B1 | **Nothing refreshes the jar.** The remote page's Supabase client is the only auto-refresher today. With no page, the jar goes stale ~1 h after sign-in. | **Blocking** | `auth.js:143-151` |
| B2 | **`getAuthCookie()` only repairs an *empty* jar, not a *stale* one** — `if (cookie) return cookie;` (`auth.js:305`). A stale-but-present cookie is forwarded verbatim and 401s. | **Blocking** | `auth.js:304-314` |
| B3 | **`api.js` has no 401 repair at all.** Only the listener retries on 401 (`channel-listener.js:102-115`, `listener-io.js:319-339`). presence just skips a cycle (`presence.js:71`); consent, mcp-config, session-history, session-peer-post, session-close-task simply fail. | **High** | `api.js:13-38` |
| B4 | **`rebuildBlobFromCookieSession` inverts.** Today the jar is fresher than the blob and the blob is repaired *from* it (`auth-state.js:100`). Post-migration the blob (refreshed by `auth.refresh()`) is the only fresh source, and the direction must flip: blob → jar, not jar → blob. Leaving `isSignedIn()` depending on a "fresh cached cookie identity" (`auth-state.js:45`) means signed-in-ness now hangs off a jar main itself wrote. | **High** | `auth-state.js:39-64,100-136` |
| B5 | **`/auth/desktop-complete` disappears.** `openDeepLink` navigates the main window to it (`index.js:209`) and that page's `setSession()` is what plants the cookies. Delete the web app and the jar is never seeded — even though `captureFromFragment` already stored the tokens. | **Blocking** | `index.js:187-224`, `src/app/auth/desktop-complete/page.tsx:32` |
| B6 | **MCP device-token minting.** `sessionOnly` + cookie-only. If cookies stop working, every spawned agent loses its Dopl MCP access; if minting silently fails, sessions run with no `mcp__dopl__*` tools and the failure is a log line. | **Blocking** | `mcp-config.js:389-394`, `route.ts:48` |
| B7 | **Server-side refresh-token rotation race.** When main forwards an expired access-token cookie, `@supabase/ssr`'s `getSessionUser` may itself refresh using the cookie's refresh token and try to `Set-Cookie` on the response — which main discards. Supabase **rotates on use**, so main's stored refresh token is now dead and `refresh()` 400s → `clearSession()` drops the blob (`auth.js:263-273`). A latent silent sign-out. | **High** | `auth.js:247-294` |
| B8 | Sign-out's UI half (`load(HOME_URL)` → server resolves to `/login`, `auth-actions.js:81`) has no meaning in an SPA; the SPA must handle signed-out routing client-side. | Medium | `auth-actions.js:78-83` |

### 3.4 What the desktop OAuth handoff already gives you

Substantially more than the plan assumes. **Already implemented and working:**

- `dopl://` registered in `Info.plist` via `package.json` `build.mac.extendInfo.CFBundleURLTypes`
  and `app.setAsDefaultProtocolClient(PROTOCOL)` (`index.js:244`); macOS `open-url` (`:247`) and
  Win/Linux `second-instance` argv (`:257-262`) paths both handled, plus a pre-window
  `pendingDeepLink` buffer (`:231`, `:235`).
- A **login-CSRF gate**: `beginPendingAuth()` mints a nonce, `maybeBeginAuth()` appends it as
  `?state=` to any app-origin `/auth/` URL opened externally (`auth-actions.js:51-61`), and
  `consumePendingAuth()` rejects any `dopl://` fragment without a matching pending record inside
  a 10-min TTL (`auth.js:62-69`, `:82-87`). Both the tray sign-in and the page's `window.open`
  route through the same function.
- **Encrypted token storage** in main via `safeStorage`, refusing plaintext fallback
  (`auth-store.js:44-55`) — exactly the plan's "keychain via safeStorage".
- **A working Supabase refresh client** in main: single-flight `refresh()` against
  `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token` (`auth.js:239-294`). It is fully
  functional; it is simply **almost never called**, because `getAuthCookie()` only reaches it
  when the jar is empty.
- **Identity derivation without a network call** — `getUserId()` from the blob JWT
  (`auth.js:111`), `getUserIdFromCookies()` (`:120`).
- **Full multi-credential sign-out**, including server-side device-token revoke
  (`auth-state.js:265-307`).

**Missing pieces (Phase-2 work):** (a) a *proactive* refresh timer in main keyed on `expires_at`,
(b) inverting the blob↔jar direction (or dropping the jar and going Bearer end-to-end), (c) a
non-cookie path to `/api/auth/mcp-device-token`, (d) replacing `/auth/desktop-complete` — the
handoff can terminate at `captureFromFragment` and never navigate a window, and (e) the web side
still does **not** echo the `state` nonce back in the `dopl://` fragment (`auth.js:44-48` calls
this out as follow-up debt; `desktop-handoff/page.tsx:13-19` builds the link from only
`access_token` + `refresh_token`).

**The cleanest target** given (c): make the API accept a Supabase JWT as a first-class bearer in
`withUserAuth` (a third branch before the MCP-token branch), then main attaches
`Authorization: Bearer <supabase access_token>` and the cookie jar can be deleted outright. The
plan's risk register line ("Routes already accept Bearer (`with-auth.ts`)") is **inaccurate as
written** — they accept *Dopl OAuth MCP* bearers, not Supabase JWTs, and `sessionOnly` routes
reject bearers by design.

---

## 4. What main does that the web app CANNOT

Everything in this section dies if it is not carried across. None of it has a browser equivalent.

**Process execution.** Spawning the `claude` CLI: headless `claude -p`
(`session-spawner.js:295`), `claude setup-token` under a pty (`claude-auth.js:108`),
`claude --version` probing (`claude-resolve.js:71`), `claude mcp add/remove/get`
(`mcp-cli-add.js:36,54,60`), `osascript` to open Terminal (`claude-auth.js:220`). **The entire
agent execution model is this.**

**Loading the Claude Agent SDK.** ESM-only dynamic `import()` with an asar→asar.unpacked path
rewrite for a ~256 MB signed Mach-O (`sdk-loader.js:44-48`), plus a scrubbed spawn env.

**Local filesystem.** Per-channel working directories that become the agent's cwd
(`channel-dirs.js:17-21,119-141`); reading `~/.claude/.credentials.json` and `~/.claude.json`
(`session-auth.js:65-80`); writing `userData/mcp-spawn.json` at mode 600 (`mcp-config.js:172`);
the diag log (`diag.js:13`).

**OS keychain.** `safeStorage` for the Supabase blob (`auth-store.js:37`), the MCP device token
(`mcp-config.js:188`), and the Claude OAuth token (`claude-token.js:24`).

**Native notifications** — the entire consent UX. Consent request (`consent.js:182`), FYI and
inbound triggers (`trigger.js:188-207`), task-reply / escalation / dismissed-agent
(`task-notify.js:44,88,199`), inbound gate (`session-gate.js:102`), park-resume
(`session-park.js:414`), version skew (`version-skew.js:147`), update ready (`updater.js:170`).
Round B explicitly *replaced* an app-modal dialog with these (`index.js:441-445`).

**Native folder picker** — `dialog.showOpenDialog` (`channel-dirs.js:153`), the only way an
operator points an agent at a real repo.

**Menu-bar tray** — listener status, pending count, live-session list, channel folders, update
control, sign in/out (`tray.js`). The app's primary UI when no window is open.

**Background residency.** Login item with `openAsHidden` (`index.js:275`), window close hides
rather than exits (`index.js:102`), `window-all-closed` is a deliberate no-op (`index.js:454`).
Long-poll loops, the Realtime WS and the presence heartbeat all run with **zero windows open**. A
browser tab cannot do this.

**Sleep/wake recovery.** `powerMonitor` resume + unlock-screen, debounced, driving
`listener.wake()` + `api.resetPool()` + `loadGuard.onWake()` (`index.js:408-425`), plus the
undici dispatcher swap (`api.js:58-80`) that Chromium's `closeAllConnections()` cannot fix.

**Deep-link protocol handler** — `dopl://` (`index.js:244`), and outbound `claude://code/new` /
`claude-cli://open` with app-bundle existence probes (`attended-handoff.js:204-208,308`).

**Auto-update** — electron-updater against GitHub Releases, with a restart prompt that names any
live session so an update never kills a mid-turn agent (`updater.js:239-278`).

**Durable local state with no server mirror** — listener cursors and seed flags
(`listener-io.js`), per-channel folders (`channel-dirs.js`), permission-preset arms
(`channel-prefs.js`), the legacy-thread registry (`legacy-threads.js`), session records
(`session-store.js`), window bounds (`index.js:92-97`).

**Privileged sender-bound IPC** — handing native affordances to a web page under a two-factor
sender check (`channel-dir-ipc.js:86-99`).

---

## 5. Coupling points to the remote web UI

Each row is discrete migration work.

| # | Coupling | Site | Migration action |
|---|---|---|---|
| C1 | `HOME_URL = ${APP_URL}/canvas`; every `loadApp()` | `config.js:10`, `index.js:147` | Replace with `loadFile` on the SPA bundle. |
| C2 | Deep-link target `${APP_ORIGIN}/auth/desktop-complete#<frag>` | `index.js:209-212` | Delete the navigation; `captureFromFragment` already has the tokens. Then main must seed the jar itself (or go bearer). |
| C3 | Notification-click nav `${APP_ORIGIN}/${slug}-{publicId}/channels` | `index.js:144`; segment built at `listener-io.js:239,398`, `channel-context.js:88` | Becomes an IPC message to the SPA router. Keep the `{slug}-{publicId}` segment as an internal route key. |
| C4 | Tray "Pending: N" → `navigateToChannels(latestPendingSegment)` | `index.js:306-311` | Same as C3. |
| C5 | Sign-in opens `${APP_ORIGIN}/auth/desktop-start` externally | `auth-actions.js:18,65` | **Keep.** Supabase PKCE requires the system browser. This page must survive Phase 4. |
| C6 | Sign-out reloads `HOME_URL` expecting a server-side redirect to `/login` | `auth-actions.js:81` | SPA handles signed-out routing client-side. |
| C7 | `load-guard.js` in its entirety — remote-load watchdog, offline screen, backoff, wake kick | `load-guard.js` | Plan Phase 4 removes it. Keep `resetMainPool` + an API-reachability probe; delete the `loadURL` state machine. |
| C8 | `wireNavigation` — `will-navigate` / `setWindowOpenHandler` gated on `isAppOrigin` | `index.js:152-175`, `auth-actions.js:38` | Becomes "deny everything except `file://`", i.e. `session-window.js:53-56`'s existing policy. |
| C9 | Menu Back/Forward over `webContents.navigationHistory` | `app-menu.js:55-64` | Broken by an SPA client router — must be re-plumbed to router history over IPC, or removed. |
| C10 | Cookie jar shared with the remote page (§3) | `auth-cookies.js` | The main item. See B1–B8. |
| C11 | `window.dopl` bridge consumed by 8+ web files | `renderer/preload.js`; consumers listed in §2.1 | Ported into the SPA's own preload. The `mainOnly` sender binding must be re-pointed at the SPA window. |
| C12 | `renderer/offline.html` hard-codes `https://www.usedopl.com/` | `renderer/offline.html:45` | Replace with a retry against the local bundle. |
| C13 | `app.userAgentFallback` scrubbing so the web app sees a clean Chrome UA | `index.js:266-271` | Irrelevant once the UI is local; harmless. |
| C14 | Version skew read off server-stamped `metadata.appVersion` | `version-skew.js:115`, `app-version.js` | Survives (it rides the API, not the page). But it is **advisory only** — the "force old clients forward" gate the plan wants does not exist yet. |
| C15 | Post-sign-in 3 s sleep before `listener.restart()` + `ensureMcpConfig()`, timed to let the completion page set cookies | `index.js:220-223` | Becomes deterministic once main owns the tokens — replace the sleep with a direct call after `captureFromFragment`. |
| C16 | `avatar-cache.js` exists solely because the session window's CSP forbids remote `img-src` | `avatar-cache.js:1-4` | Keep; the SPA window will want the same CSP. |

---

## 6. Risks — what could silently break

Ordered by how quietly it fails.

**R1 — Cookie staleness with no repair path (silent).** B1+B2+B3. Symptom: the listener keeps
working (it has 401 repair), while consent posting, presence, session history, task close and
device-token minting all fail one by one. Presence 401 is *logged and skipped*
(`presence.js:71-72`); consent failures surface as "the operator never got a prompt". **Mitigation:
add a proactive refresh timer in main and 401 repair to `api.js` before cutover.**

**R2 — Refresh-token rotation race (silent sign-out).** B7. A forwarded expired cookie can make
the server rotate the refresh token; main's copy 400s; `clearSession()` drops the blob
(`auth.js:269-272`). Reproduces only after ~1 h idle. **Mitigation: never forward an expired
access token — check `expires_at` before building the header.**

**R3 — Device token minted but never usable.** `ensureMcpConfig` is best-effort and swallows its
errors at both call sites (`index.js:222`, `index.js:401`). A cookie-auth regression means every
spawned session runs with no `mcp__dopl__*` tools and the only evidence is a diag line. **Mitigation:
surface a tray state for "MCP not configured".**

**R4 — Realtime falls back to anon and breaks the whole project.** If `getAccessTokenInfo()`
returns nothing, `realtime.js` fails closed today (`realtime-core.js:170-179`) — but the comment
at `auth.js:150-155` documents what happens when a token is *absent* rather than *refused*:
realtime-js falls back to the URL apikey, joins as `anon`, and raises `42501` on
`is_current_workspace_member`, crashing `postgres_changes` **for every client of the project**. Any
refactor of the credential path must preserve the fail-closed join gate.

**R5 — The two-copy enum tables drift.** `session-preload.js:34-51` hand-copies
`session-profiles`' and `session-model`'s tables because a sandboxed preload cannot `require`
main. Pinned only by `test/session-permission-axes` and `test/session-model.test.mjs`. A new SPA
preload that re-copies them without re-pinning silently loses the fail-closed property — and
`asModel` feeds `--model <argv>` on a child process.

**R6 — `mainOnly` sender binding silently disarms.** `channel-dir-ipc.register({getMainWindow})`
is bound to *the* main window (`index.js:345`). If the SPA introduces multiple windows or a
different window identity, every handler starts returning its refusal value — which is
deliberately the same shape as a bad-id response (`channel-dir-ipc.js:113-117`), so the folder
picker and permission presets just quietly stop working with no error in the UI.

**R7 — `targeting.js`'s injected store.** It is deliberately dependency-free and gets its store
injected at `index.js:381`. A bootstrap reorder that drops the injection degrades to an in-memory
registry — cost is "one spurious consent prompt per restarted exchange" (`index.js:378-379`), which
looks like a UX bug, not a wiring bug.

**R8 — Blob↔jar direction inversion (B4) creates a self-confirming loop.** If main writes the jar
and `isSignedIn()` then reads a "fresh cookie identity" from that same jar, the app reports
signed-in on a credential it minted from a dead blob. `signedInFrom` (`auth-state.js:39`) must be
re-derived from `expires_at`, not from jar presence.

**R9 — Version skew becomes real.** Bundled UI means UI changes ship through electron-updater, not
Vercel. Today the updater installs on quit and a background listener never quits — the exact
incident `version-skew.js:3-7` documents. Post-migration a stale build means a stale **UI**, not
just stale agent logic. The forced-upgrade gate the plan assumes exists does not.

**R10 — `app-menu.js` Back/Forward.** Silently no-ops or navigates the SPA shell out of its
route once `navigationHistory` no longer tracks page loads (`app-menu.js:55-64`).

**R11 — Two `apiFetch` implementations.** `api.js:13` and `listener-io.js:203` are independent
copies with different 401 behavior. Any auth-transport change must land in **both**, and only one
is covered by the listener's E2E tests.

**R12 — `offline.html` escape hatch.** `location.replace('https://www.usedopl.com/')`
(`renderer/offline.html:45`) would navigate the shell to a dead site post-Phase 4.

---

## 7. Survives unchanged (do not touch)

Per plan §"Channels — protected functionality", and confirmed by this audit — these modules have
**no** dependency on the renderer, the remote page, or React:

`channel-listener.js`, `listener-io.js`, `listener-messages.js`, `listener-heal.js`,
`channel-agents.js`, `channel-deliver.js`, `channel-engagement.js`, `channel-post.js`,
`channel-roster.js`, `channel-threads.js`, `channel-context.js`, `legacy-threads.js`,
`realtime.js`, `realtime-core.js`, `realtime-agents.js`, `presence.js`, `targeting.js`,
`trigger.js`, `trigger-outcomes.js`, `queued-notice.js`, `task-notify.js`, `consent*.js`,
the whole `session-*` engine, `sdk-loader.js`, `claude-*.js`, `tool-profiles.js`,
`prompt-framing.js`, `mcp-*.js`, `attended-*.js`, `tray.js`, `updater.js`, `update-policy.js`,
`settings.js`, `diag.js`, `app-version.js`.

Their **only** exposure to the migration is transitive, through `auth.getAuthCookie()` (§3) and
the two nav callbacks (`openChannel`, C3/C4). Fix auth transport and re-point two callbacks, and
all of the above keeps running byte-for-byte.
