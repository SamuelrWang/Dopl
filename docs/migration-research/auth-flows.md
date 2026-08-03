# Auth flows — as-built, and the target design for the bundled SPA

Research doc for the desktop-only migration ([DESKTOP-MIGRATION-PLAN.md](../DESKTOP-MIGRATION-PLAN.md),
Phase 2 "Auth" bullet, line 118). Read-only survey: nothing here has been implemented.

Everything is cited `path:line`. Web paths are repo-relative; desktop paths are
under `dopl-desktop-app/`.

---

## 0. The one-paragraph version

There are **five** credentials in play today, not two. The web UI rides Supabase
**cookies**; the desktop main process reads those same cookies out of the Electron
jar and forwards them as a `Cookie:` header, so main is a *session* caller
server-side. Remote MCP agents ride **Dopl OAuth access tokens** (`dopl_at_`), and
spawned local agents ride a 90-day **device token** of the same family. The Claude
CLI credential (`sk-ant-*`) is a sixth-party credential the app also holds. The
server's `withUserAuth` discriminates purely on *"is there an `Authorization`
header?"* — which is why the bundled SPA cannot simply start sending a bearer
without breaking the agent/session distinction that ~24 routes depend on.

| Credential | Shape | TTL | Refresh | Who holds it |
|---|---|---|---|---|
| Supabase access JWT | ES256 JWT | ~1 h | rotating refresh token | browser cookies + `auth-store` blob |
| Supabase refresh token | opaque | long, rotates on use | n/a | same |
| MCP OAuth access token | `dopl_at_<64hex>` | 1 h (`mcp-oauth.ts:30`) | `dopl_rt_` rotation, 30 d (`mcp-oauth.ts:31`) | remote MCP clients |
| MCP device token | `dopl_at_<64hex>` | 90 d (`mcp-oauth.ts:35`) | none — re-mint (`mcp-config.js:48`) | desktop `safeStorage` + `mcp-spawn.json` |
| Claude inference token | `sk-ant-*` | opaque | none | desktop `safeStorage` (`claude-token.js`) |

---

## 1. Every auth flow that exists today

### 1.1 Web cookie login (the only "session" credential)

1. `/login` renders `src/features/auth/components/login-form.tsx:10` (email+password,
   magic link, Google/GitHub) via `src/features/auth/hooks/use-login.ts`, using the
   singleton browser client `src/shared/supabase/browser.ts:11`
   (`createBrowserClient` from `@supabase/ssr` → cookie storage adapter).
2. OAuth providers land on `src/app/auth/callback/route.ts:9`.
   `exchangeCodeForSession` (`:26`) writes the `sb-<ref>-auth-token*` cookies through
   the server client, then fires post-auth side effects (signup event,
   `ensureDefaultWorkspace`, onboarding detour) at `:36-61` and redirects (`:69`).
3. Every subsequent request passes `src/proxy.ts:131` (the Next middleware).
   `getClaims()` at `:197` verifies the JWT **locally** against the cached ES256
   JWKS (10-min cache, `:165`); `getSession()` inside it does the rotating cookie
   refresh ~90 s before expiry and the `setAll` callback (`:142-150`) writes the
   rotated cookies onto the response. `redirectPreservingSession` (`:107`) exists so
   a redirect never drops those rotated cookies.
4. API routes authenticate via `getSessionUser` (`src/shared/auth/with-auth.ts:381`),
   which builds a `createServerClient` over `request.cookies` (`:388`) and calls
   `getClaims()` (`:398`), returning `claims.sub`. The `try/catch` at `:401` is
   load-bearing — auth-js `validateExp` throws a *plain* `Error` that `getClaims()`
   re-throws (documented `:370-377`).
5. Client components read the user through `src/shared/auth/use-auth-user.ts:20`.

**Session callers are never scope-gated or session-gated** — that's the explicit
"don't lock out the web app" guarantee (`with-auth.ts:10-14`, pinned by
`with-auth.test.ts:21-23`).

### 1.2 Desktop reads the cookie jar (today's main-process auth)

The desktop shell `loadURL`s the remote site, so the Electron session's cookie jar
*is* the web session. `main/auth-cookies.js` is the whole transport:

- `readCookieSession()` `auth-cookies.js:83` — reassembles the chunked
  `base64-` + base64url(JSON) `@supabase/ssr` cookie into the full `Session`
  (access + refresh token). Handles both the modern object and the legacy array
  shape (`:110-113`). A torn chunk set returns `null`, not a throw (`:98-109`).
- `readCookieAccessToken()` `:118` — the raw JWT, used only by Realtime.
- `getSessionCookieHeader()` `:125` — the `Cookie:` header value for API calls.
- `writeSessionCookies()` `:165` — repairs the jar from the stored blob.
  **Set-then-prune** ordering (`:157-164`), never clear-then-set.
- `clearSessionCookies()` `:141` — the sign-out primitive.
- `isOurAuthCookie()` `:60` — name **and** host-only predicate (see §5).

HTTP consumers:

- `main/api.js:13-38` — `apiFetch`, used by `mcp-config.js`. Attaches
  `auth.getAuthCookie()` at `:15-20` plus `app-version.versionHeaders()`.
- `main/listener-io.js:203-230` — the Channels listener's own copy, same shape.
- `main/auth.js:304` `getAuthCookie()` — returns the header, and if the jar is
  empty, refreshes the stored blob and rewrites the jar (`:308-312`).

Identity + liveness consumers: `auth.js:111 getUserId` (blob), `auth.js:120
getUserIdFromCookies` (jar), `auth-state.js:78 signedInState`, `presence.js:49`,
`consent-watcher.js:369`, `channel-listener.js:108`, `listener-io.js:336`.

Realtime is the only consumer that needs a **raw** JWT: `auth.js:193
getAccessTokenInfo()` picks the freshest of `{stored blob, cookie}` via the pure
`chooseAccessToken` (`auth.js:159`), and `main/realtime.js:226` hands it to
`client.setAuth()`. The long note at `realtime.js:20-33` documents why the old
"blob first" rule wedged push permanently (expired JWT → `CHANNEL_ERROR`, and a
*missing* token makes realtime-js join as `anon`, raising 42501 and crashing the
project's whole `postgres_changes` pipeline for every client).

Endpoints main calls today (all cookie-authenticated):
`/api/workspaces/me`, `/api/channels`, `/api/channels/[id]/messages`,
`/api/channels/[id]/await`, `/api/channels/presence`, `/api/channels/consent`,
`/api/channels/consent/[id]` (**sessionOnly**), `/api/auth/mcp-device-token`
(**sessionOnly**, both verbs).

### 1.3 Desktop OAuth handoff (`desktop-start → dopl:// → desktop-complete`)

1. **Arm the CSRF gate.** `main/auth-actions.js:51 maybeBeginAuth()` — if the URL
   is exactly `APP_ORIGIN` (`isAppOrigin`, `:38`) and its path contains `/auth/`,
   call `auth.beginPendingAuth()` and append the nonce as `?state=`.
   Both entry points (window `setWindowOpenHandler`, tray `beginSignIn` `:65`)
   funnel through it, so the nonce is armed in exactly one place.
2. **System browser.** `shell.openExternal(SIGN_IN_URL)` where
   `SIGN_IN_URL = ${APP_ORIGIN}/auth/desktop-start` (`auth-actions.js:18`).
   It must be the system browser: Supabase PKCE stores the code verifier in that
   browser context (`src/app/auth/desktop-start/page.tsx:6-13`).
3. `desktop-start/page.tsx:20` fires `signInWithOAuth({provider:"google"})` with
   `redirectTo=/auth/callback?desktop=1`.
4. `auth/callback/route.ts:21` reads `desktop=1`, exchanges the code, and sends the
   browser to `/auth/desktop-handoff` (`:31`), **skipping** the onboarding detour
   (`:56`).
5. `desktop-handoff/page.tsx:28` reads the browser session and builds
   `dopl://auth#access_token=…&refresh_token=…` (`:13-19`), then navigates to it
   (`:36`) with a manual fallback link (`:69`).
6. Main's protocol handler → `auth.captureFromFragment()` `main/auth.js:75`.
   It requires `consumePendingAuth(state)` (`:83`, single-use, 10-min TTL,
   `auth.js:62-69`) and then `persist()`s the session blob (`:91`) and
   invalidates the cached cookie identity (`:98`).
7. The app window also loads `/auth/desktop-complete`, which calls
   `supabase.auth.setSession()` (`desktop-complete/page.tsx:32`) so the **cookie
   jar** gets the session too, then `window.location.replace("/canvas")` (`:41`).
   Tokens travel in the hash so they never reach the server (`:14`).

All three pages bypass the middleware session gate via the `"/auth/desktop"`
prefix in `PUBLIC_ROUTES` (`proxy.ts:12`).

> Note the asymmetry that matters for the migration: **step 6 already hands the
> main process the access + refresh token pair.** Step 7 exists *only* to populate
> the cookie jar for the remote web UI.

### 1.4 MCP OAuth (`/oauth/authorize` → tokens → `validateAccessToken`)

Dopl runs its own OAuth 2.1 AS (`src/shared/auth/mcp-oauth.ts:6-20`).

- Discovery/registration: `/.well-known/oauth-*`, `POST /api/oauth/register`
  (`registerClient` `mcp-oauth.ts:80`).
- Consent: `src/app/oauth/authorize/page.tsx:28`. Validates `response_type`,
  `client_id`, exact-match `redirect_uri`, PKCE `S256` (`:42-54`) — an invalid
  client or redirect renders an error and **never** redirects to an unverified URI.
  Requires a signed-in user and bounces through `/login?redirectTo=` preserving the
  full OAuth query (`:63-72`). Write scope is offered when requested or when scope
  is blank (`:76`).
- Approve → `POST /api/oauth/authorize` → `issueAuthCode` (`mcp-oauth.ts:112`),
  5-min TTL (`:32`), only the SHA-256 hash stored.
- `POST /api/oauth/token` (`src/app/api/oauth/token/route.ts:69`):
  - `authorization_code` → `consumeAuthCode` (`mcp-oauth.ts:142`) — atomic
    single-use via conditional `consumed_at IS NULL` update (`:164-170`), PKCE
    verified constant-time (`verifyPkceS256` `:60`) → `issueTokens` (`:184`).
  - `refresh_token` → `rotateRefreshToken` (`:391`). Reuse of an already-rotated
    token revokes the whole `family_id` (`:410-413`) per OAuth 2.1 BCP §4.13.2.
- Resource server: `validateAccessToken` (`mcp-oauth.ts:354`) is the single
  validation entry point. Rejects non-`dopl_at_` strings (`:357`), checks
  `revoked_at` **before** expiry (`:365-366`), and debounces `last_used_at`
  (`:369-380`). Consumed by both the MCP transport boundary
  (`with-mcp-transport-auth.ts:64`) and the loopback `/api/*` guard
  (`with-auth.ts:117`).
- Transport boundary `authenticateMcpRequest` (`with-mcp-transport-auth.ts:56`)
  does the cheap 401 + rate limit (600 rpm/token, `:10`) and forwards the raw
  credential to the loopback `DoplClient`, so the real gating happens exactly once
  per tool call in `withUserAuth`/`withWorkspaceAuth`.
- Settings surface: `listUserGrants` (`:478`), `revokeGrant` (`:491`),
  RFC 7009 `revokeToken` (`:452`).

### 1.5 Device token (the local-agent credential)

- Mint: `POST /api/auth/mcp-device-token` (`src/app/api/auth/mcp-device-token/route.ts:34`),
  `{ sessionOnly: true }` (`:48`) → `issueDeviceToken` (`mcp-oauth.ts:243`).
  90 days, scopes `dopl.read`+`dopl.write`, reserved device `client_id`, no refresh
  token, revoke-and-replace per `(user, label)` (`:254-260`). Returned once,
  `Cache-Control: no-store` (`:45`).
- Desktop side `main/mcp-config.js`: `obtainDeviceToken()` `:381` reuses the cached
  token while >7 days remain (`:48`), else re-mints. Stored `safeStorage`-encrypted
  (`saveDeviceToken` `:183`) **and** written to `userData/mcp-spawn.json` mode 600
  (`writeSpawnConfig` `:163` — chmods on *every* call, and compares the **whole**
  serialized body, not just the bearer, so a local process can't repoint `url`).
  The SDK path reads the encrypted copy in memory (`deviceTokenForSpawn` `:224`),
  never the file.
- Revoke: `DELETE /api/auth/mcp-device-token` (`route.ts:78`, also `sessionOnly`)
  → `revokeDeviceTokens` (`mcp-oauth.ts:306`). Desktop caller
  `revokeDeviceToken()` `mcp-config.js:318` distinguishes four outcomes
  (`revoked` / `no-match` / `none` / `failed`) because a 200 with `revoked:0` used
  to be reported as a successful revoke.

### 1.6 Claude inference credential (adjacent, not Dopl auth)

`main/claude-auth.js:1-20` drives `claude setup-token` under a pty, parses the
OAuth URL, collects the pasted code in a local BrowserWindow. If a token is
printed it is stored `safeStorage`-encrypted by `main/claude-token.js:21`
(`setStoredOAuthToken`) and injected as `CLAUDE_CODE_OAUTH_TOKEN` by both spawn
paths. `main/session-auth.js:16-22` preflights the credential for session windows
(fail-open: an unreadable state counts as "present"), with mid-session recovery.
Cleared — but *not* revocable by us — on sign-out (`claude-token.js:51-60`).

### 1.7 Token storage on desktop

`main/auth-store.js` is the lowest layer:

- `persist()` `:34` — `safeStorage.encryptString` → `electron-store` key
  `authSession`. If `safeStorage.isEncryptionAvailable()` is false it **refuses**
  and deletes both keys (`:41-55`) rather than falling back to plaintext, because
  what it would be writing is a renewable account credential.
- `loadSession()` `:61`, `clearSession()` `:75`, `decodeJwt()` `:81`,
  `jwtExp()` `:92` (returns `null` for a `dopl_at_` device token, which is not a JWT).
- `authFail()` `:25` — throttled (60 s) diag logging; tokens are never passed in.

### 1.8 Session refresh paths (all of them)

| Path | Where | Trigger |
|---|---|---|
| Browser auto-refresh | supabase-js in the renderer | ~90 s before `exp` |
| Middleware refresh | `proxy.ts:197` `getClaims()` → `getSession()` → `setAll` `:142` | any matched request near expiry |
| Main-process refresh | `auth.js:247 refreshInner()` → `POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token` | `getAccessTokenInfo` when both candidates are stale (`:208-213`), `ensureFresh()` `:297`, `getAuthCookie()` repair `:308` |
| Jar repair | `auth.js:310 writeSessionCookies(fresh)` | empty/stale jar |
| Blob repair from jar | `auth-state.js:100 rebuildBlobFromCookieSession` | every `refreshSignedInState()` probe |
| MCP refresh | `POST /api/oauth/token` `grant_type=refresh_token` → `rotateRefreshToken` | agent client, near 1 h expiry |
| Device re-mint | `mcp-config.js:381` | <7 days remaining, or on ensure after sign-in |

Two hard-won properties guard these:

- **Single-flight** `refresh()` (`auth.js:238-245`). Supabase rotates refresh
  tokens on use, so N concurrent listener loops firing N refreshes means one wins
  and the rest get a 400 — whose handler drops the stored blob (`:269-272`). A
  transient failure could convert itself into a real sign-out.
- **Cooldowns**: `REFRESH_COOLDOWN_MS = 30_000` (`auth.js:138`),
  `COOKIE_PROBE_COOLDOWN_MS = 30_000` (`auth-state.js:73`),
  `COOKIE_IDENTITY_TTL_MS = 10 min` (`auth-state.js:70`). "A read must never
  become a write storm" (F-072).

---

## 2. Token lifetimes and expiry, consolidated

| Thing | Lifetime | Constant |
|---|---|---|
| Supabase access JWT | ~1 h (assumed by the desktop's `expires_in \|\| 3600`) | `auth.js:96`, `auth.js:130` |
| Realtime skew | treat as dead 60 s early | `ACCESS_SKEW_SEC` `auth.js:135` |
| Supabase auth cookie `expirationDate` | 400 days (the cookie, not the token) | `auth-cookies.js:169` |
| MCP auth code | 5 min, single-use | `CODE_TTL_S` `mcp-oauth.ts:32` |
| MCP access token | 1 h | `ACCESS_TTL_S` `mcp-oauth.ts:30` |
| MCP refresh token | 30 days, rotating | `REFRESH_TTL_S` `mcp-oauth.ts:31` |
| Device token | 90 days, no refresh | `DEVICE_TOKEN_TTL_S` `mcp-oauth.ts:35` |
| Device re-mint margin | 7 days | `REUSE_MARGIN_MS` `mcp-config.js:48` |
| Deep-link pending-auth nonce | 10 min, single-use | `PENDING_AUTH_TTL_MS` `auth.js:35` |
| Cookie-identity cache | 10 min TTL, 30 s probe cooldown | `auth-state.js:70,73` |
| JWKS cache | 10 min, process-wide | documented `proxy.ts:165` |
| Login-bounce breaker | 30 s, limit 2 | `proxy.ts:89,96` |
| Device-revoke budget | 3 s, best-effort | `REVOKE_TIMEOUT_MS` `mcp-config.js:76` |

---

## 3. THE TARGET DESIGN QUESTION

**Recommendation: option (b) — Supabase session access/refresh tokens held in the
main process and sent as `Authorization: Bearer <supabase JWT>`, with
`withUserAuth` taught to discriminate bearer *kind* by prefix.** Option (c) is the
right Phase-5 hardening if per-device revocation becomes a requirement; option (a)
is disqualified.

### 3.1 Option (a) — reuse MCP OAuth / device access tokens. **Rejected.**

`with-auth.ts:113` routes *any* `Authorization` header into the token branch, and
`:172` sets `agentTokenId: tok.tokenId`. Truthiness of that field is the "is this
an agent?" signal (`with-auth.ts:96-100`). Consequences if the SPA uses one:

1. **~24 sessionOnly routes hard-403.** `with-auth.ts:128-137` returns
   `403 SESSION_REQUIRED` for every OAuth token regardless of scope. The affected
   surface is exactly what Phase 2 must port: workspace members / invitations /
   join-requests / join-link / teams / access-matrix, `DELETE /api/workspaces/[slug]`,
   `/api/user/delete`, all three billing routes, `/api/oauth/grants/[id]`,
   `/api/channels/{trust, consent/[id], [id]/tasks, [id]/agents, tasks/[taskId]/*}`,
   and `/api/auth/mcp-device-token` (both verbs). The desktop would lose the
   ability to mint or revoke its own device token.
2. **Agent write gates fire on ordinary UI edits.** `source: agentTokenId ? "agent" : "user"`
   is threaded into every service context (`features/knowledge/server/service-shared.ts:53`,
   `features/skills/server/service-shared.ts:38`, `features/chats/server/service-shared.ts:47`,
   `features/channels/server/service-shared.ts:68`, `features/trash/server/service.ts:102`,
   and ~12 route files). The gates then refuse: `service-shared.ts:140,169`
   (`agentWriteEnabled` off → `AgentWriteDisabledError`), `skills/server/service-writes.ts:301`,
   `service-trash.ts:106`, `workflows/server/attachments.ts:142,168`.
   `repository-bases.ts:143` defaults `agent_write_enabled` to **false**, so a
   user editing their own KB from the SPA would be refused.
3. **Semantic corruption.** Every UI write would be stamped `source: "agent"` in
   writeback/audit, channel messages would post with `authorKind: "agent"`
   (`channels/server/service-writes.ts:363`), and `service-writes-agents.ts:332`
   early-returns for agents. Every UI call would also be logged to `mcp_events`
   (`with-auth.ts:236` treats any `authorization` header as an MCP caller) and
   `mcp_tool_calls` (`with-workspace-auth.ts:182`).
4. **Write-scope gate** (`with-auth.ts:147-164`) adds a second failure mode for
   read-only grants.
5. **Security inversion.** `consent/[id]/route.ts:47-64` and `trust/route.ts:51-64`
   exist precisely so a `--mcp-config`-spawned, Bash-capable agent cannot approve
   its own consent. Making the UI an agent means either those routes stay closed to
   the UI (broken product) or the flag is relaxed (broken security).

Making option (a) work would mean re-deriving "is this an agent?" from something
other than the token — i.e. doing option (c)'s work anyway, on top of a credential
class that is already handed to spawned agents.

### 3.2 Option (b) — Supabase tokens in main, sent as a bearer. **Recommended.**

**Feasibility check (done):** `getSessionUser` today reads cookies only
(`with-auth.ts:388-395`), but auth-js *does* accept a JWT argument —
`GoTrueClient.getClaims(jwt, options)` at `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:4786`
(auth-js 2.102.1). With a token argument it decodes, enforces `exp` via
`validateExp` unless `allowExpired`, fetches the JWK by `kid` and verifies ES256
via WebCrypto, falling back to a network `getUser(token)` only for HS*/kid-less
tokens. So a Bearer Supabase JWT can be verified with **exactly the same local
verification and the same cost profile** as the cookie path — no GoTrue round-trip.

**What it requires (exact changes):**

1. `src/shared/auth/with-auth.ts:113-186` — split the bearer branch on token kind:

   ```ts
   if (authHeader) {
     const token = authHeader.replace(/^Bearer\s+/i, "").trim();
     if (isOAuthAccessToken(token)) {           // mcp-oauth.ts:55 — the `dopl_at_` prefix
       …existing agent branch, unchanged…
     }
     const user = await getBearerSessionUser(token);   // NEW
     if (user) {
       return runAndLog5xx(
         () => handler(request, { userId: user.id, params: resolvedParams }),
         { endpoint: …, userId: user.id }
       );                                        // no agentTokenId → session caller
     }
     return NextResponse.json({ error: "Invalid or expired credentials" }, { status: 401 });
   }
   ```

   `getBearerSessionUser` mirrors `getSessionUser` (`:381`) but passes the token:
   `createServerClient(url, anon, { cookies: { getAll: () => [], setAll() {} } })`
   then `await supabase.auth.getClaims(token)`. **Keep the `try/catch`** — the
   plain-`Error` re-throw documented at `:370-377` applies with force here, since
   `validateExp` only runs when a jwt argument is passed.

2. `src/shared/auth/with-auth.ts:236` — `withMcpAccess`'s
   `const isMcpCaller = !!request.headers.get("authorization")` must become
   `isOAuthAccessToken(...)`, or every SPA read lands in `mcp_events` as agent traffic.

3. `src/proxy.ts:300-303` — the middleware currently admits an `/api/*` bearer only
   when the header `includes("dopl_at_")`; a Supabase bearer falls through to
   `:306` and gets a middleware 401 before the route wrapper ever runs. Widen to
   "any `Authorization` header on `/api/*` passes through to the route's own
   wrapper" (the wrapper is the authority; the middleware is only a session gate).
   Phase 4 can drop `/api/**` from the matcher entirely.

4. `src/shared/auth/with-auth.test.ts` — add a third caller class: a Supabase
   bearer must (i) get `agentTokenId === undefined`, (ii) pass a `sessionOnly`
   route, (iii) not be write-scope gated, (iv) 401 when expired. This is the
   regression tripwire for the whole design.

5. Desktop `main/auth.js:304` — `getAuthCookie()` → `getAuthHeader()` returning
   `Bearer <access token>` from `ensureFresh()`. Call sites: `api.js:15-20`,
   `listener-io.js:205-210` swap `headers.Cookie` for `headers.Authorization`.

6. Desktop — the handoff loses a step: `captureFromFragment` (`auth.js:75`) already
   persists the pair, so `/auth/desktop-complete` and `writeSessionCookies` are
   deleted rather than replaced. `desktop-start` + `desktop-handoff` survive
   unchanged (they run in the system browser and are the only pages Phase 4 keeps).

7. Desktop — **do not** stamp `X-Dopl-Runtime: desktop-session` on the UI transport.
   It is the "this is a spawned session" routing hint (`src/shared/auth/runtime-header.ts:1-21`)
   that decides requester-window opening; blanket-stamping UI calls would misroute
   windows. It stays on `mcp-spawn.json` (`mcp-config.js:134`) and sdk-loader only.

**What it buys:** the desktop stays a *session* caller, so all ~24 `sessionOnly`
routes, the device-token mint/revoke, the consent PATCH and the trust rules keep
working with zero policy change; writeback `source` stays `"user"`; Realtime's
`setAuth` keeps consuming the same JWT (`realtime.js:226`) with no second
credential; and the refresh machinery already exists and is already single-flight
(`auth.js:238-294`).

**What it costs / risks:**

- The credential in main is the **account-level** Supabase refresh token. That is
  already true today (`auth-store.js:34` persists exactly that), so it is not a
  regression — but it means there is no per-device revocation short of a Supabase
  sign-out. Mitigate by adding `POST {SUPABASE_URL}/auth/v1/logout` to
  `auth-state.signOut()` (see §4).
- `withUserAuth` now has three caller classes discriminated by token prefix. A
  malformed bearer 401s; a foreign-project JWT fails the `kid` lookup and 401s.
  Both fail closed.
- The `sessionOnly` gate's meaning shifts from "holds our cookies" to "holds a
  Supabase user JWT". The security property is preserved **only if** the Supabase
  access token is never placed in a spawned session's env, never written to
  `mcp-spawn.json`, and never exposed over IPC to the renderer (migration plan
  line 119-120 already commits to the last one). Make this an explicit invariant.

### 3.3 Option (c) — a new first-party token type. **Defer to Phase 5.**

Shape: mint a `dopl_ut_`-prefixed session-grade token at desktop sign-in from an
authenticated call, store it `safeStorage`-encrypted, validate it server-side, map
it to a `userId` **without** setting `agentTokenId`, and let it satisfy
`sessionOnly`.

Requires: a new credential class in `mcp-oauth.ts` (or a sibling module) with its
own table/`client_id` and a `kind` column; `validateAccessToken` split into
"agent-grade" vs "session-grade" so `with-auth.ts:117` can branch; mint / refresh /
revoke endpoints (all of which must themselves be `sessionOnly`, creating a
bootstrap dependency on the Supabase session anyway); rewriting the security
rationale on ~24 route files that currently say "cookie callers pass untouched";
and `describeCredential`/`mcp-credential.ts` extension so grants list correctly.

Genuine benefits over (b): per-device revocation from the Connected-apps list;
scope-narrowable (a UI token needs no `dopl.*` MCP scopes); the blast radius of a
leaked UI token is one device, not the account; and "interactive session" becomes
an explicit, auditable credential class rather than an inference from "no bearer".

Verdict: real benefits, but they are hardening, not enablement — and the mint path
still needs a Supabase session to bootstrap. Ship (b) in Phase 2; revisit (c) once
the SPA is dogfooded, tracked alongside the existing F-085 residuals.

---

## 4. What the desktop main process needs after cookies disappear

Consumers of `auth-cookies.js`, and their fate:

| Call site | Today | After |
|---|---|---|
| `api.js:15` | `Cookie:` header | `Authorization: Bearer` |
| `listener-io.js:205` | `Cookie:` header | `Authorization: Bearer` |
| `auth.js:304 getAuthCookie` | jar → repair from blob | `getAuthHeader()` → `ensureFresh()` |
| `auth.js:197` (Realtime candidate) | jar JWT | blob JWT only |
| `auth.js:120 getUserIdFromCookies` | jar `sub` | **delete** — `getUserId()` `:111` is the only identity |
| `auth-state.js:146 readCookieSession` | probe | **delete** |
| `auth-state.js:100 rebuildBlobFromCookieSession` | blob repair from jar | **delete** |
| `auth-state.js:277 clearSessionCookies` | sign-out | replace with Supabase `logout` |
| `listener-io.js:336`, `channel-listener.js:108` | `ensureFresh` + `writeSessionCookies` on auth-shaped failure | `ensureFresh()` alone |
| `auth-cookies.js` (whole file) | — | **delete** |

Non-obvious consequences:

1. **`isSignedIn()` collapses to blob-only** — which is exactly the pre-Q4 state
   the cookie source was added to fix (`auth-state.js:12-19`: a dead blob took the
   listener, presence, the consent watcher and mcp-config dark while the web UI
   stayed signed in). With cookies gone there is no second source to recover from,
   so **blob refresh reliability becomes load-bearing**. Concretely:
   `refreshInner()` drops the stored blob on any 400 (`auth.js:269-272`); that
   should gain a bounded retry/backoff before the drop, since a 400 will no longer
   be survivable by falling back to the jar.
   `signedInFrom()` (`auth-state.js:39`) simplifies to `signedIn = hasBlob`, and
   `cookieStale` / `needsRefresh` / the 30 s probe machinery go away.
2. **The S4 identity cross-check loses its second input.** `blobUserId` vs
   `cookie.userId` (`auth-state.js:49`, `:114-118`) and `identityMismatch()`
   (`:201`) become vacuous — but the *invariant* ("never silently switch accounts")
   must be re-expressed: the deep-link capture must refuse to overwrite a blob whose
   `sub` differs from the incoming token's, and instead require an explicit sign-out.
   `channel-listener`'s `resolveIdentity` cache-drop hook (`auth-state.js:195-203`)
   should then key off that check instead.
3. **`safeStorage` becomes a hard dependency.** Today `persist()` refusing to write
   (`auth-store.js:41-55`) is survivable because "the session simply lives in the
   cookie jar for this run" (`:49-50`). After the migration that sentence is false —
   a machine with a broken keychain has **no** session store at all. Either accept
   an in-memory-only session for that run (sign-in required every launch) and say so
   in the UI, or fail loudly at startup. This needs an explicit decision.
4. **Sign-out gains a step.** `auth-state.signOut()` `:265-307` currently orders:
   revoke device token (server) → clear blob → clear jar → clear local device token
   → clear Claude token. The jar clear disappears; add
   `POST {SUPABASE_URL}/auth/v1/logout` with the access token so the refresh token
   dies server-side. Without it, sign-out leaves a live renewable account credential
   behind — the same residual class F-085 fixed for the device token. **Ordering is
   still the whole point**: the device-token revoke route is `sessionOnly`, so it
   must run while the Supabase session is still valid.
5. **`auth-actions.signOut`'s `load(HOME_URL)`** (`auth-actions.js:81`) has no
   remote page to load; it becomes "route the SPA to its signed-out view".
   `isAppOrigin` (`:38`) still guards `shell.openExternal` targets and still gates
   where the `?state=` nonce may be appended — **keep it**.
6. **`config.js` shrinks**: `SUPABASE_REF` (`config.js:35`) exists only to derive the
   cookie name and can go; `SUPABASE_URL` / `SUPABASE_ANON_KEY` (`:29-33`) become
   *more* important (refresh + logout + Realtime).
7. **The tests** `test/auth-signed-in.test.mjs`, `test/tray-auth.test.mjs`,
   `test/device-token-revoke*.test.mjs`, `test/session-auth-recovery.test.mjs`
   all encode the cookie-aware truth table and will need rewriting alongside.

---

## 5. Security invariants that must not regress

Each of these documents a vulnerability that was actually found and fixed. The
migration must carry the *property* forward even where the *mechanism* dies.

**I1 — The credential source must be one the app exclusively controls.**
`auth-cookies.js:11-34` (FIX S3) records that the jar filter was by cookie **name
only**, so `cookies.get({url: APP_ORIGIN})` returned every cookie *visible* to that
URL — including `.usedopl.com` domain cookies settable by **any sibling
subdomain**. A subdomain could plant `sb-<ref>-auth-token` and have the desktop
adopt that session as the operator's. Fixed by `isOurAuthCookie` (`:60-65`)
requiring a host-only cookie for the exact `APP_HOST`, in **both** readers
(`:85`, `:128`), failing closed on an unreadable domain.
*Post-migration:* the token may enter main only through (a) the CSRF-gated
`dopl://` capture or (b) a refresh against the Supabase token endpoint. Never from
the renderer, never from page content, never from a file another process can write.

**I2 — In-window navigation is locked to the exact app origin.**
`auth-actions.js:26-44` (FIX S3): `isAppUrl` admitted every `*.usedopl.com` host,
so a sibling-subdomain page ran *inside* the app window (writing to the jar) and
`maybeBeginAuth` would append the login-CSRF nonce as `?state=` to a host we don't
control — handing away the one secret the deep-link gate rests on. Now
`isAppOrigin` is an exact-origin compare and everything else goes to the system
browser. *Post-migration:* the bundled SPA loads local assets; any remote
navigation must go external, and the `?state=` nonce may still only be appended to
exact-`APP_ORIGIN` `/auth/` URLs.

**I3 — Login-CSRF gate on the deep link.** `auth.js:37-48`: a `dopl://auth#<tokens>`
link can be fired by any local process or website. `captureFromFragment` persists
nothing unless `consumePendingAuth()` finds a pending record inside the 10-min TTL,
single-use, with `state` matching when present (`auth.js:62-69`, `:82-87`). The
noted follow-up debt — the web side does not yet *echo* the nonce back — remains
open and should be closed rather than dropped when the flow is touched.

**I4 — Never silently pick a winner between disagreeing identities.**
`auth-state.js:30-38` (FIX S4): `source: 'both'` was returned without checking the
two credentials named the same user, and adoption turned on `exp` alone — so a jar
from a different account only had to be *newer* to overwrite the signed-in
operator's blob, after which the listener routed one account's channel traffic
under the other's identity. Now a mismatch is a `conflict`, adoption is refused
loudly (`:114-118`), and the listener drops its cached `myUserId` while it lasts.

**I5 — A read must never become a write storm; a refresh must be single-flight.**
`auth-cookies.js:157-164` (FIX S6): the jar write used to clear-then-set, leaving
the jar **empty** between two awaits — every concurrent listener that read it saw
"signed out", each kicked its own repair, Supabase's rotation 400'd all but one,
and the 400 handler cleared the blob. One transient 5xx could amplify into a real
sign-out. Fixed by set-then-prune. Its twin: `auth.js:228-245` (FIX S6) made
`refresh()` single-flight because `ensureFresh()` bypassed the cooldown entirely.
Also `auth-state.js:120-124` (FIX S9): an unreadable `exp` is not "the cookie is
fresher" — it used to rewrite the blob on *every* probe.

**I6 — A renewable credential is never written in cleartext.** `auth-store.js:41-55`:
the plaintext fallback wrote a Supabase **refresh token** into a JSON file that
lands in Time Machine and any folder sync. It now refuses. Same family:
`mcp-spawn.json` is mode 600 with a chmod on every call (`mcp-config.js:149-162`)
and the fast path compares the **whole** body, because comparing only
`headers.Authorization` let a local process repoint `url` to its own endpoint and
harvest the bearer plus every tool call (C2).

**I7 — Sign-out tears down every credential, server-side first, in order.**
`auth-state.js:212-307` enumerates the five: the device-token **server revoke**
(F-085 — must run *first*, because the route is `sessionOnly` and authenticates on
the very session being cleared; bounded to 3 s, best-effort), then the blob, the
jar, the local device-token copies (FIX S2 — a 90-day `dopl.read`+`dopl.write`
bearer used to survive sign-out on disk), then the Claude `sk-ant-*` token (a
sign-out otherwise left the *next* operator running agents on the *first*
operator's Anthropic account). And the log line must never claim a revoke that did
not happen — four outcomes, not a boolean (`mcp-config.js:289-317`).

**I8 — A bearer must never operate the controls that govern bearers.**
`with-auth.ts:26-35` + `:128-137` (the `sessionOnly` gate);
`consent/[id]/route.ts:47-64` states the concrete threat: the spawned session is
launched with `--mcp-config` pointing at a 90-day read+write device token, its job
is to process an untrusted teammate's message (a prompt-injection target), and it
has Bash — so without the gate it could read that token and PATCH
`{decision:'allow'}` on its own outbound review. `trust/route.ts:51-64` is the
standing-consent version, gated on both POST and DELETE.
*Post-migration:* whatever credential the SPA uses must satisfy `sessionOnly`
**and** be unreachable from a spawned session — never in `spawnEnv`, never in
`mcp-spawn.json`, never over IPC to the renderer.

**I9 — The write-scope gate is fail-closed and statically enforced.**
`with-auth.ts:139-164`: write is permitted only when `scopes` explicitly includes
`dopl.write`, with the RFC-correct `WWW-Authenticate: insufficient_scope`
challenge. `write-gate-coverage.test.ts:1-21` is the tripwire: every `route.ts`
exporting a non-GET handler must funnel through one of the three wrappers or sit on
a reasoned `EXEMPT` allowlist, and `writeScopeExempt` is pinned to exactly the MCP
liveness ping. Any new SPA-facing route must keep satisfying it.

**I10 — Auth is verified locally, and the verification must not become a network
call again.** `proxy.ts:155-187` and `with-auth.ts:354-379` (Q11/Q12): a network
`getUser()` per request (~5 Postgres queries) was the largest source of the
2026-07-31 self-DDoS that starved GoTrue until OAuth code exchange started failing.
`getClaims()` verifies ES256 locally against a 10-min-cached JWKS. Option (b)'s
`getClaims(token)` preserves this exactly — but the `try/catch` must survive,
because `validateExp` throws a plain `Error` that `getClaims()` re-throws, and an
uncaught throw there is a 500 on every API route instead of the 401 an expired
session must produce.

**I11 — Tokens never reach a log.** `auth.js:190-192`, `realtime.js:33`,
`auth-store.js:22` ("Never pass a token here"), `mcp-config.js:24-26`. Only the
*source* and *seconds-left* are ever logged.

**I12 — Realtime must always get a live user JWT.** `realtime.js:20-33`: an
expired JWT yields `CHANNEL_ERROR` on every rejoin (push never recovers), and
passing **no** token makes realtime-js fall back to the URL apikey and join as
`anon`, whose RLS evaluation raises 42501 and crashes the project's entire
`postgres_changes` pipeline **for every client**. `chooseAccessToken`
(`auth.js:159`) picks the furthest-future `exp` and rotates when all candidates are
stale. With cookies gone there is exactly one candidate, so this path must not be
allowed to degrade to "no token".

---

## 6. Open questions for the implementer

1. **`safeStorage` unavailable** — after cookies, there is no fallback session
   store. Accept in-memory-only (re-sign-in each launch) or hard-fail? (§4.3)
2. **Supabase logout on sign-out** — adding `/auth/v1/logout` kills *all* the
   user's sessions unless `scope=local` is used. Which? (§4.4)
3. **Nonce echo (I3 residual)** — the web side still does not echo `?state=` into
   the `dopl://` fragment (`auth.js:44-48`). Close it while touching the flow?
4. **Per-device revocation** — if the answer to "can the operator kill one Mac's
   access from Settings?" is yes, that is the argument for option (c) now rather
   than in Phase 5.
5. **Middleware scope** — widening `proxy.ts:300` is the minimal change; dropping
   `/api/**` from the matcher (`:331-335`) is the Phase-4 end state. Sequence them
   deliberately, since the middleware is currently the only thing 401-ing
   unauthenticated `/api` calls before the wrapper runs.
