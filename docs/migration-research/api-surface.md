# API Surface — Desktop Migration Research

Research pass for [DESKTOP-MIGRATION-PLAN.md](../DESKTOP-MIGRATION-PLAN.md) Phase 2/4.
Read-only inventory as of 2026-08-02. No code changed.

**Totals:** 123 `route.ts` files under `src/app/api/**`, 184 exported HTTP method
handlers, plus 1 non-API route (`src/app/auth/callback/route.ts:9`). **21 method
handlers across 18 files are `sessionOnly`** — unreachable by any Bearer token.

---

## 0. Auth wrappers — how a request is classified

| Wrapper | File | Accepts |
|---|---|---|
| `withUserAuth` | `src/shared/auth/with-auth.ts:89` | `Authorization: Bearer <dopl_at_…>` **OR** Supabase cookie session |
| `withWorkspaceAuth` | `src/shared/auth/with-workspace-auth.ts:124` | composes `withUserAuth`, adds workspace resolution + `minRole` |
| `withMcpAccess` | `src/shared/auth/with-auth.ts:222` | composes `withUserAuth`, adds `mcp_events` logging. **Currently used by zero routes** |
| `authenticateMcpRequest` | `src/shared/auth/with-mcp-transport-auth.ts:28` | OAuth bearer only, for the `/api/mcp` JSON-RPC transport |
| `CRON_SECRET` bearer | inline in each cron route | shared secret, not a user |
| Stripe signature | `src/app/api/billing/webhook/route.ts:6` | unauthenticated + signature verified |
| none | `src/app/api/oauth/**`, `oauth-*-metadata`, `workspaces/invitations/[token]` GET | public by design |

The three branches inside `withUserAuth`:

1. `Authorization` header present → `validateAccessToken` (`src/shared/auth/mcp-oauth.ts:354`).
   Sets **`agentTokenId`** in the handler context (`with-auth.ts:172`).
2. No header → `getSessionUser` reads Supabase cookies via `getClaims()`
   (`with-auth.ts:381`). `agentTokenId` stays **undefined**.
3. Neither → 401.

---

## 1. Route inventory by feature

Legend: `WA` = `withWorkspaceAuth`, `UA` = `withUserAuth`, `SO` = `sessionOnly`,
`WSE` = `writeScopeExempt`, `mR` = `minRole`.

### Knowledge (23 files) — all `withWorkspaceAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `knowledge/bases/route.ts:33` | GET, POST | WA / mR member | list + create knowledge bases |
| `knowledge/bases/[baseId]/route.ts:54` | GET, PATCH, DELETE | WA / mR member | one base: read, update, soft-delete |
| `knowledge/bases/[baseId]/tree/route.ts:46` | GET | WA | folders+entries tree, optional `?entryLimit=` |
| `knowledge/bases/[baseId]/entries/route.ts:84` | GET, POST | WA / mR member | entries in a base (`?folderId=`, `?includeBody=`) |
| `knowledge/bases/[baseId]/folders/route.ts:49` | GET, POST | WA / mR member | folders in a base |
| `knowledge/bases/[baseId]/files/route.ts:91` | GET, PUT | WA / mR member | path-based file CRUD (`kb_read_file`/`kb_write_file`) |
| `knowledge/bases/[baseId]/folders-by-path/route.ts:74` | GET, POST, DELETE | WA / mR member | path-based folder ops |
| `knowledge/bases/[baseId]/move-by-path/route.ts:38` | POST | WA / mR member | path-based move + rename |
| `knowledge/bases/[baseId]/restore/route.ts:22` | POST | WA / mR member | restore soft-deleted base |
| `knowledge/bases/[baseId]/export/route.ts:26` | GET | WA + `workspaceIdFromQuery` | zip download of a base |
| `knowledge/entries/route.ts:38` | GET | WA | batch entry fetch by `?ids=` |
| `knowledge/entries/[entryId]/route.ts:58` | GET, PATCH, DELETE | WA / mR member | one entry |
| `knowledge/entries/[entryId]/move/route.ts:25` | POST | WA / mR member | move entry |
| `knowledge/entries/[entryId]/restore/route.ts:22` | POST | WA / mR member | restore entry |
| `knowledge/entries/[entryId]/export/route.ts:26` | GET | WA + query ws | entry download |
| `knowledge/folders/[folderId]/route.ts:45` | PATCH, DELETE | WA / mR member | one folder |
| `knowledge/folders/[folderId]/move/route.ts:25` | POST | WA / mR member | move folder |
| `knowledge/folders/[folderId]/restore/route.ts:22` | POST | WA / mR member | restore folder |
| `knowledge/folders/[folderId]/export/route.ts:26` | GET | WA + query ws | folder download |
| `knowledge/search/route.ts:34` | GET | WA | full-text search across entries |
| `knowledge/trash/route.ts:20` | GET | WA | workspace knowledge trash |

### Skills (10 files) — all `withWorkspaceAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `skills/route.ts:33` | GET, POST | WA / mR member | list + create skills |
| `skills/[skillSlug]/route.ts:54` | GET, PATCH, DELETE | WA / mR member | one skill |
| `skills/[skillSlug]/body/route.ts:59` | GET, PUT | WA / mR member | read/write the SKILL.md body |
| `skills/[skillSlug]/duplicate/route.ts:11` | POST | WA / mR member | fork a skill |
| `skills/[skillSlug]/export/route.ts:16` | GET | WA + query ws | zip download |
| `skills/[skillSlug]/history/route.ts:12` | GET | WA | version metadata list |
| `skills/versions/[versionId]/route.ts:11` | GET | WA | one version snapshot + body |
| `skills/versions/[versionId]/restore/route.ts:11` | POST | WA / mR member | roll body back to a version |
| `skills/restore/[skillId]/route.ts:31` | POST | WA / mR member | restore soft-deleted skill |
| `skills/trash/route.ts:26` | GET | WA | skills trash |

### Workflows (10 files) — all `withWorkspaceAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `workflows/route.ts:67` | GET, POST | WA / mR member | list + create workflows |
| `workflows/[id]/route.ts:98` | GET, PATCH, DELETE | WA / mR member | one workflow |
| `workflows/[id]/graph/route.ts:75` | POST | WA / mR member | bulk graph write |
| `workflows/[id]/nodes/route.ts:66` | POST | WA / mR member | create node |
| `workflows/[id]/nodes/[nodeId]/route.ts:81` | PATCH, DELETE | WA / mR member | one node |
| `workflows/[id]/edges/route.ts:71` | POST, DELETE | WA / mR member | edges |
| `workflows/[id]/skills/route.ts:72` | POST, DELETE | WA / mR member | attach/detach skills |
| `workflows/[id]/knowledge-bases/route.ts:74` | POST, DELETE | WA / mR member | attach/detach KBs |
| `workflows/[id]/restore/route.ts:46` | POST | WA / mR member | restore workflow |
| `workflows/trash/route.ts:40` | GET | WA | workflows trash |

### Ontology + clusters (9 files) — all `withWorkspaceAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `ontology/route.ts:15` | GET | WA | whole ontology graph |
| `ontology/anchor/route.ts:15` | GET | WA | caller's anchored workspace object |
| `ontology/objects/route.ts:30` | POST | WA / mR member | create object |
| `ontology/objects/[objectId]/route.ts:46` | PATCH, DELETE | WA / mR member | one object |
| `ontology/objects/[objectId]/anchor/route.ts:18` | POST | WA / mR member | anchor object to caller |
| `ontology/clusters/route.ts:18` | POST | WA / mR member | create ontology cluster |
| `ontology/clusters/[clusterId]/route.ts:38` | PATCH, DELETE | WA / mR member | one cluster |
| `ontology/clusters/[clusterId]/restore/route.ts:25` | POST | WA / mR member | restore cluster |
| `clusters/route.ts:60` | GET, POST | WA / mR member | canvas clusters list + create |
| `clusters/[slug]/route.ts:106` | GET, PATCH, DELETE | WA / mR member | one canvas cluster |

### Chats (7 files) — all `withWorkspaceAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `chats/route.ts:36` | GET, POST | WA / mR member | list chats (+`hiddenCount`) / export a chat |
| `chats/[chatId]/route.ts:57` | GET, PATCH, DELETE | WA / mR member | one chat |
| `chats/[chatId]/messages/route.ts:25` | POST | WA / mR member | append messages |
| `chats/[chatId]/restore/route.ts:19` | POST | WA / mR member | restore chat |
| `chats/folders/route.ts:36` | GET, POST | WA / mR member | chat folders |
| `chats/folders/[folderId]/route.ts:40` | PATCH, DELETE | WA / mR member | one chat folder |
| `chats/trash/route.ts:19` | GET | WA | chats trash |

### Channels (11 files) — all `withWorkspaceAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `channels/route.ts:38` | GET, POST | WA / mR member | list + create channels |
| `channels/[channelId]/route.ts:47` | GET, PATCH, DELETE | WA / mR member | one channel |
| `channels/[channelId]/messages/route.ts:64` | GET, POST | WA / mR member | message list + post |
| `channels/[channelId]/await/route.ts:100` | GET | WA | **long-poll**, holds up to 215s (wake primitive) |
| `channels/[channelId]/members/route.ts:72` | GET, POST, DELETE, PATCH | WA / mR member | channel membership |
| `channels/[channelId]/agents/route.ts:45` | GET, POST | WA / mR member | agent roster |
| `channels/[channelId]/agents/[agentId]/route.ts:53` | PATCH | WA / mR member | one agent row |
| `channels/[channelId]/tasks/route.ts:48` | GET, POST | WA / mR member | channel tasks |
| `channels/[channelId]/tasks/[taskId]/route.ts:79` | GET, PATCH | WA / mR member | one task |
| `channels/[channelId]/tasks/[taskId]/participants/route.ts:62` | POST, DELETE | WA / mR member | join/leave a task |
| `channels/presence/route.ts:28` | POST | WA | presence heartbeat |
| `channels/consent/route.ts:58` | GET, POST | WA | consent inbox / raise a request |
| `channels/consent/[id]/route.ts:46,65` | GET; **PATCH SO** | WA; **WA+SO** | read one request; **decide it (session only)** |
| `channels/trust/route.ts:50,65,66` | GET; **POST SO**, **DELETE SO** | WA; **WA+SO** | standing-consent rules |

### Workspaces / teams / members (20 files) — mostly `withUserAuth`

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `workspaces/route.ts:17,30` | GET, POST | UA | list caller's workspaces; create one |
| `workspaces/me/route.ts:21` | GET | UA | currently-active workspace (MCP handshake) |
| `workspaces/[workspaceSlug]/route.ts:23,53,79` | GET, PATCH, **DELETE SO** | UA; **UA+SO** | fetch/rename workspace; **destroy it** |
| `workspaces/[workspaceSlug]/icon/route.ts:33,63` | POST, DELETE | UA | workspace icon upload/remove |
| `workspaces/[workspaceSlug]/members/route.ts:19` | GET | UA | list members |
| `workspaces/[workspaceSlug]/members/[userId]/route.ts:25,56` | **PATCH SO**, **DELETE SO** | UA+SO | change role; remove member |
| `workspaces/[workspaceSlug]/members/[userId]/access/route.ts:24` | GET | UA | one member's effective access rows |
| `workspaces/[workspaceSlug]/my-access/route.ts:25` | GET | UA | caller's effective access map (sidebar badges) |
| `workspaces/[workspaceSlug]/access-matrix/route.ts:21,41` | GET; **PUT SO** | UA; **UA+SO** | teams×resource access matrix; **write it** |
| `workspaces/[workspaceSlug]/teams/route.ts:15,31` | GET, POST | UA | list + create teams |
| `workspaces/[workspaceSlug]/teams/[teamId]/route.ts:15,31,48` | GET, PATCH, DELETE | UA | one team |
| `workspaces/[workspaceSlug]/teams/[teamId]/members/route.ts:15` | **POST SO** | UA+SO | add team member |
| `workspaces/[workspaceSlug]/teams/[teamId]/members/[userId]/route.ts:13` | **DELETE SO** | UA+SO | remove team member |
| `workspaces/[workspaceSlug]/teams/[teamId]/access/route.ts:19,40` | GET; **PUT SO** | UA; **UA+SO** | team's resource grants |
| `workspaces/[workspaceSlug]/invitations/route.ts:21,50` | GET; **POST SO** | UA; **UA+SO** | list invites; **send invite** |
| `workspaces/[workspaceSlug]/invitations/[id]/route.ts:16` | **DELETE SO** | UA+SO | revoke invite |
| `workspaces/[workspaceSlug]/join-link/route.ts:16,32` | GET; **POST SO** | UA; **UA+SO** | read / **rotate** shareable join link |
| `workspaces/[workspaceSlug]/join-requests/route.ts:13` | GET | UA | pending join requests |
| `workspaces/[workspaceSlug]/join-requests/[requestId]/route.ts:26` | **PATCH SO** | UA+SO | approve/decline join request |
| `workspaces/[workspaceSlug]/trash/route.ts:24` | GET | WA / mR member | workspace-wide trash |
| `workspaces/[workspaceSlug]/trash/restore/route.ts:27` | POST | WA / mR member | restore one trashed item |
| `workspaces/[workspaceSlug]/trash/purge/route.ts:27` | POST | WA / mR member | hard-delete one trashed item |
| `workspaces/invitations/[token]/route.ts:13` | GET | **none (public)** | public invite preview (`/invite/[token]` page) |
| `workspaces/invitations/[token]/accept/route.ts:16` | POST | UA | accept an invitation |
| `join/[token]/route.ts:16` | POST | UA | request to join via join link |
| `me/join-requests/route.ts:15` | GET | UA | caller's unacked join-request outcomes |
| `me/join-requests/[requestId]/ack/route.ts:16` | POST | UA | ack an outcome notice |

### User / onboarding (6 files)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `user/profile/route.ts:167,168` | GET, PATCH | UA | display name / profile |
| `user/delete/route.ts:7,164` | **DELETE SO** | UA+SO | delete the account |
| `user/mcp-status/route.ts:15,44` | POST **WSE**, GET | UA | MCP liveness ping + "is MCP connected" |
| `onboarding/complete/route.ts:15` | POST | UA | finish onboarding, name default workspace |
| `onboarding/survey/route.ts:12` | POST | UA | record survey answers |
| `onboarding/mcp-status/route.ts:13` | GET | UA | polled by the onboarding connect step |

### Billing (5 files)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `billing/status/route.ts:11` | GET | WA | entitlements summary for the UI |
| `billing/checkout/route.ts:40,149` | **POST SO** | WA / mR admin + SO | create Stripe Checkout session |
| `billing/portal/route.ts:11,35` | **POST SO** | WA / mR admin + SO | open Stripe billing portal |
| `billing/upgrade-to-team/route.ts:23,86` | **POST SO** | WA / mR admin + SO | Solo → Team in place |
| `billing/webhook/route.ts:6` | POST | **Stripe signature** | Stripe event ingest |

### OAuth / MCP transport (9 files)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `mcp/route.ts:198,199` | POST, DELETE | `authenticateMcpRequest` | remote MCP streamable-HTTP transport (`maxDuration = 300`) |
| `oauth-authorization-server/route.ts` | GET | public | RFC 8414 AS metadata |
| `oauth-protected-resource/route.ts` | GET | public | RFC 9728 PR metadata |
| `oauth/register/route.ts:32` | POST | public | RFC 7591 dynamic client registration |
| `oauth/authorize/route.ts:17` | POST | consent page | authorization-code issuance |
| `oauth/token/route.ts:70` | POST | public (PKCE) | token + refresh endpoint |
| `oauth/revoke/route.ts:11` | POST | public | RFC 7009 revocation |
| `oauth/grants/route.ts:12` | GET | UA | list connected apps |
| `oauth/grants/[id]/route.ts:12,24` | **DELETE SO** | UA+SO | revoke a connected app |
| `auth/mcp-device-token/route.ts:34,78` | **POST SO**, **DELETE SO** | UA+SO | mint / revoke a 90-day device token |

### Cron (3 files) — `CRON_SECRET` bearer, not user auth

| Route | Methods | Purpose |
|---|---|---|
| `cron/purge-trash/route.ts:45` | GET | daily hard-delete sweep past retention |
| `cron/reconcile-seats/route.ts:32` | GET | daily Stripe seat-quantity true-up |
| `cron/oauth-cleanup/route.ts:25` | GET | purge expired/revoked OAuth rows |

---

## 2. TOKEN-READINESS

### 2a. Which routes a Bearer-authed SPA can call today

- **Bearer-capable (the default):** every route wrapped in `withUserAuth` or
  `withWorkspaceAuth` **without** `sessionOnly` accepts `Authorization: Bearer
  dopl_at_…` (`with-auth.ts:113-181`). That is ~160 of the 184 method handlers.
- **Cookie-only in practice:** none of the app routes are cookie-*only* by
  construction. The cookie branch (`with-auth.ts:188`) is the *fallback*, not a
  requirement. The only genuinely cookie-shaped surfaces are outside `/api`:
  `src/app/auth/callback/route.ts` and the RSC pages.
- **`sessionOnly` — hard-blocked for ALL tokens (403 `SESSION_REQUIRED`,
  `with-auth.ts:128-137`).** 21 handlers, 18 files. The canonical list is
  asserted in `src/shared/auth/write-gate-coverage.test.ts:101`:

| File | Blocked method(s) | What the SPA loses |
|---|---|---|
| `auth/mcp-device-token/route.ts:48,107` | POST, DELETE | cannot mint/revoke the desktop CLI device token |
| `billing/checkout/route.ts:149` | POST | cannot start a subscription |
| `billing/portal/route.ts:35` | POST | cannot open the Stripe portal |
| `billing/upgrade-to-team/route.ts:86` | POST | cannot upgrade Solo → Team |
| `channels/consent/[id]/route.ts:65` | PATCH | **cannot approve/deny a consent request** |
| `channels/trust/route.ts:65,66` | POST, DELETE | cannot create/remove standing-consent rules |
| `oauth/grants/[id]/route.ts:24` | DELETE | cannot revoke a connected app |
| `user/delete/route.ts:164` | DELETE | cannot delete the account |
| `workspaces/[workspaceSlug]/route.ts:100` | DELETE | cannot delete a workspace |
| `workspaces/[workspaceSlug]/access-matrix/route.ts:64` | PUT | cannot edit the access matrix |
| `workspaces/[workspaceSlug]/invitations/route.ts:79` | POST | cannot invite anyone |
| `workspaces/[workspaceSlug]/invitations/[id]/route.ts:34` | DELETE | cannot revoke an invite |
| `workspaces/[workspaceSlug]/join-link/route.ts:47` | POST | cannot rotate the join link |
| `workspaces/[workspaceSlug]/join-requests/[requestId]/route.ts:53` | PATCH | cannot approve/decline join requests |
| `workspaces/[workspaceSlug]/members/[userId]/route.ts:49,79` | PATCH, DELETE | cannot change roles or remove members |
| `workspaces/[workspaceSlug]/teams/[teamId]/access/route.ts:74` | PUT | cannot set team grants |
| `workspaces/[workspaceSlug]/teams/[teamId]/members/route.ts:35` | POST | cannot add team members |
| `workspaces/[workspaceSlug]/teams/[teamId]/members/[userId]/route.ts:33` | DELETE | cannot remove team members |

That is the entire members/teams/invites admin surface, the whole billing
mutation surface, account + workspace deletion, the channels human-in-the-loop
consent surface, and device-token minting. **The Members, Settings and
Configuration pages of the SPA are non-functional under pure Bearer auth.**

### 2b. The write-scope gate (`dopl.write`)

`with-auth.ts:139-164`: for Bearer callers only, any non-GET/HEAD/OPTIONS method
requires `tok.scopes` to include `dopl.write`, else 403 `WRITE_SCOPE_REQUIRED`.
Exactly one exemption exists — `user/mcp-status/route.ts:38` (`writeScopeExempt`),
asserted in `write-gate-coverage.test.ts:93`.

Device tokens are minted with both scopes (`auth/mcp-device-token/route.ts:39`:
`scopes: ["dopl.read", "dopl.write"]`), so this gate is not a blocker *provided*
the SPA's token comes from the device-token path or an OAuth grant that was
approved with write. It **is** a blocker if the SPA ever holds a read-only grant.

### 2c. THE AGENT-VS-USER PROBLEM (flagged)

`with-auth.ts:99` and `:170-174` — the presence of an `Authorization` header is
the **only** signal the codebase uses to answer "is this an agent?". Any Bearer
caller gets `agentTokenId` set; every cookie caller gets `undefined`. Downstream:

```
src/features/knowledge/server/service-shared.ts:53   source: auth.agentTokenId ? "agent" : "user"
src/features/skills/server/service-shared.ts:38      (same)
src/features/chats/server/service-shared.ts:47       (same)
src/features/trash/server/service.ts:102             (same)
src/app/api/clusters/route.ts:36, workflows/route.ts:41, …  (same, inline)
```

and `source === "agent"` then trips real gates:

| Gate | File:line | Effect on a Bearer-authed SPA |
|---|---|---|
| KB write gate | `src/features/knowledge/server/service-shared.ts:140` | any KB with `agent_write_enabled=false` becomes **read-only to the SPA** |
| KB delete gate | `service-shared.ts:169` | ditto for deletes; error text literally says "delete it from the Dopl web UI" |
| KB flag self-edit | `service-base-writes.ts:171` | SPA cannot toggle `agentWriteEnabled` at all |
| KB publish path | `service-base-writes.ts:195-199` | agent-only restrictions on base updates |
| Skill write/delete gate | `src/features/skills/server/service-writes.ts:120,301`, `service-trash.ts:106` | same for skills; `agent_write_enabled` defaults **true** for skills (`repository.ts:157`) but **false** for KBs (`repository-bases.ts:143`) — so new KBs are born SPA-hostile |
| Workflow attachments | `src/features/workflows/server/attachments.ts:142,168` | cannot attach a KB/skill flagged agent-read-only |
| Channel message authorship | `src/features/channels/server/service-writes.ts:363` | **every message the SPA posts is stamped `author_kind: "agent"`** |
| Agent engagement | `src/features/channels/server/service-writes-agents.ts:332` | SPA-posted messages never wake the agents they address (`return` on `source === "agent"`) |
| Writeback `source` column | all of the above | audit trail records human edits as agent edits |

**In one line:** the server decides "agent vs. human" purely by "did this request
carry a Bearer token", so a token-authed SPA is indistinguishable from a
background MCP agent — it inherits the agent write-gates, gets its channel
messages mislabeled `author_kind: "agent"`, silently stops waking agents, and is
403'd out of every `sessionOnly` admin route.

### 2d. Second-order finding: the desktop OAuth flow does not produce a Bearer token

The migration plan (line 117) says auth will be "token-based via the existing
desktop OAuth handoff". As built, that flow yields a **Supabase session**, not a
Dopl bearer:

- `src/app/auth/desktop-start/page.tsx:20` — Supabase `signInWithOAuth`.
- `src/app/auth/callback/route.ts:26` — `exchangeCodeForSession` (sets cookies).
- `src/app/auth/desktop-handoff/page.tsx:15-18` — hands back
  `dopl://auth#access_token=…&refresh_token=…`, i.e. Supabase JWTs; the app calls
  `setSession`.

`validateAccessToken` rejects anything not prefixed `dopl_at_`
(`mcp-oauth.ts:357` → `isOAuthAccessToken`, `mcp-oauth.ts:55`, prefix at `:25`).
So a Supabase JWT sent as `Authorization: Bearer …` returns **401 "Invalid or
expired credentials"** — it does not fall through to the cookie branch.

The only Bearer credentials the API accepts today are OAuth-grant tokens and
device tokens from `mcp_tokens` — **and both mark the caller as an agent.**
There is currently **no credential that is simultaneously (a) a Bearer token and
(b) treated as a human session.** That is the gap the SPA needs closed.

Sketch of the options (not a recommendation, just what the code allows):
1. Teach `withUserAuth` to accept a Supabase JWT in the header (verify via the
   same `getClaims()`/JWKS path used at `with-auth.ts:398`) and treat it as a
   session — leaves `agentTokenId` undefined, satisfies `sessionOnly` and every
   agent gate at once. Smallest change; touches one file.
2. Add a first-class client/session marker to `mcp_tokens` (e.g. a `dopl_ut_`
   prefix or a `kind` column) and gate on that instead of "header present".
   Requires auditing all ~12 `agentTokenId ? "agent" : "user"` sites.
3. Keep cookies inside Electron (session cookie on the API origin). Contradicts
   the plan's "renderer never sees tokens / main process owns credentials"
   principle and needs cross-origin cookie handling.

Note the security intent that must survive any of these: `sessionOnly` exists
specifically so a spawned agent holding a device token on disk cannot
self-approve its own consent request or mint itself a fresh credential
(`write-gate-coverage.test.ts:113-124`). Option 2 must not hand the SPA a
credential a compromised agent can lift.

---

## 3. Website-only routes — Phase 4 deletion candidates

The surface is smaller than expected: **there are no marketing/SEO routes at
all.** No `sitemap.ts`, `robots.ts`, `opengraph-image`, `twitter-image`, or
`manifest.ts` exist anywhere under `src/app`. Nothing to delete there.

Genuine web-only candidates:

| Route | Why | Verdict |
|---|---|---|
| `workspaces/invitations/[token]/route.ts:13` | unauthenticated public preview for the `/invite/[token]` web page | delete **only if** invite acceptance moves fully in-app; otherwise the invite landing page must survive |
| `onboarding/survey/route.ts:12`, `onboarding/complete/route.ts:15`, `onboarding/mcp-status/route.ts:13` | serve the `/onboarding` web flow; the desktop callback explicitly **skips** onboarding (`auth/callback/route.ts:21,56`) | keep the endpoints, re-point them at the SPA's in-app onboarding; the web `/onboarding` pages die |
| `join/[token]/route.ts:16` + `workspaces/[workspaceSlug]/join-link/route.ts` | serve the `/join/[token]` web page | same call as invites |
| `src/app/admin/analytics/page.tsx`, `src/app/admin/health/page.tsx` | admin RSC pages reading services directly; **no `/api/admin/**` routes exist** | if admin stays web-only these survive as the last HTML; if it moves to the SPA it needs a brand-new API surface |
| `billing/checkout`, `billing/portal`, `billing/upgrade-to-team` | drive Stripe hosted pages via redirect | **must survive** — but see §2a, they are `sessionOnly`; the SPA will have to open them in the system browser under a cookie session, or the gate must change |

Everything else under `/api/**` is consumed by the app UI or by MCP agents and
survives Phase 4.

## 4. Must-survive: crons + webhooks

| Route | Trigger | Auth | Note |
|---|---|---|---|
| `cron/purge-trash/route.ts:45` | `vercel.json` daily | `CRON_SECRET` bearer | hard-deletes past `RETENTION_DAYS`; unrecoverable, keep scheduled |
| `cron/reconcile-seats/route.ts:32` | daily | `CRON_SECRET` bearer | Stripe seat true-up; billing correctness depends on it |
| `cron/oauth-cleanup/route.ts:25` | scheduled | `CRON_SECRET` bearer | purges dead OAuth rows; table growth if dropped |
| `billing/webhook/route.ts:6` | Stripe | signature verification | subscription state ingest — **no auth wrapper, do not touch** |
| `mcp/route.ts:198` | remote MCP clients | `authenticateMcpRequest` | `maxDuration = 300` is load-bearing for `dopl_channel(op="await")` (`mcp/route.ts:14-31`) |
| `oauth-authorization-server`, `oauth-protected-resource`, `oauth/{register,authorize,token,revoke}` | MCP client discovery | public | required by the OAuth spec dance |
| `channels/[channelId]/await/route.ts:100` | desktop main process | WA | holds up to 215s; not a cron but equally must-survive |

## 5. Gaps — data fetched by RSC with no API route behind it

Cross-checked every `src/app/[workspaceSlug]/(app)/**/page.tsx` + `layout.tsx`.

**Hard gaps — CLOSED 2026-08-02.** All five now have endpoints; the table
records what was built so a re-audit doesn't re-open them.

| Data | Fetched at | Status |
|---|---|---|
| Overview counts (workflows / KBs / skills / members) | `overview/page.tsx` | ✅ `GET /api/workspaces/[workspaceSlug]/overview-counts` — returns the four counts **plus** `isMcpConnected`, so the page header is one round trip. The page's inline `loadCounts` moved to `getWorkspaceOverviewCounts` (`workspaces/server/service.ts`) over `countWorkspaceResources` (repository); the page now imports the service and no longer touches `supabaseAdmin` |
| `isOnboarded(userId)` | `[workspaceSlug]/(app)/page.tsx`, `src/app/canvas/page.tsx`, `auth/callback/route.ts` | ✅ `GET /api/user/onboarding-state` → `{ isOnboarded }`. Still distinct from `onboarding/mcp-status` (MCP connected ≠ onboarded) |
| `listBaseOwnerNames(ctx, bases)` | `knowledge/page.tsx`, `knowledge/[kbSlug]/page.tsx` | ✅ folded into `GET /api/knowledge/bases`, which now returns `{ bases, ownerNames }` — no new endpoint. The lookup takes the base list as input, so a separate route could only ever be a forced second round trip. Additive: existing readers destructure `bases` |
| `resolvePageWorkspace(slug, userId, section)` redirect semantics | every page | ✅ via `GET /api/workspaces/resolve?segment=` (below). The route reports `needsRedirect` + `canonical`; the *section tail* stays client-side — it's the SPA's own route, not server knowledge |
| `resolveWorkspaceSegmentForUser` | `(app)/layout.tsx` | ✅ `GET /api/workspaces/resolve?segment=` → `{ workspace, canonical, needsRedirect }`. 404 on a miss, membership-scoped, so non-member and nonexistent stay indistinguishable |

Also built alongside these (a gap §3 named but this table didn't):
`POST /api/workspaces/ensure-default` → `{ workspace, segment }` — the
provisioning half of the boot sequence (`GET /api/workspaces` lists but never
creates). Idempotent; answers 200, never 201.

**Soft gaps (an endpoint exists but the RSC path uses the service directly, so
shape drift is possible):**

| Data | RSC call site | Nearest endpoint |
|---|---|---|
| `listBases` | `knowledge/page.tsx:50` | `GET /api/knowledge/bases:33` ✅ |
| `getBaseTree` | `knowledge/[kbSlug]/page.tsx:68` | `GET /api/knowledge/bases/[baseId]/tree:46` ✅ |
| `getEntry` | `knowledge/[kbSlug]/page.tsx:106` | `GET /api/knowledge/entries/[entryId]:58` ✅ |
| `listSkills` | `skills/page.tsx:44` | `GET /api/skills:33` ✅ |
| `listChats` + `listFolders` | `chats/page.tsx:36` | `GET /api/chats:36` + `GET /api/chats/folders:36` ✅ |
| `listTeams(workspace.id, user.id)` | `knowledge/page.tsx:58`, `knowledge/[kbSlug]/page.tsx:79` | `GET /api/workspaces/[slug]/teams:15` ✅ |
| `resolveMembershipOrThrow` → role | `(app)/layout.tsx:48` and 6 pages | `GET /api/workspaces/[slug]/my-access:25` (access map, not the raw role) — partial |
| `isMcpConnected` | `overview/page.tsx:64` | `GET /api/user/mcp-status:44` ✅ |

**No data gap:** `channels`, `ontology`, `ontology/[clusterSlug]`, `workflows`,
`workflows/[workflowSlug]`, `canvas`, `canvas2`, `members`, `configuration`,
`settings` — these RSC pages only resolve workspace + membership and hand off to
client components that already fetch through `/api/**`.

---

## Summary for the migration plan

1. The plan's risk-register line "Routes already accept Bearer (`with-auth.ts`)"
   is **half true**: they accept Bearer, but 21 handlers refuse it outright and
   ~12 service-layer sites change behaviour when it is present.
2. The desktop OAuth handoff produces a Supabase session, not a Bearer the API
   accepts (§2d). Resolving this is a **Phase 2 prerequisite**, not a per-page
   port detail.
3. ~~Five hard data gaps need new endpoints before pages can be ported~~ —
   **closed 2026-08-02** (§5): four new routes plus one folded response. No
   page port is blocked on a missing endpoint any more.
