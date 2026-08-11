# Launch Readiness Roadmap

**Date:** 2026-08-07 · **Produced by:** four parallel Opus audit agents (performance, database/security, UI feedback, retirement mapping), all read-only, against master `0a3b007` (perf items 3.x re-verified against `25c4ab9`). The retirement half lives in [RETIREMENT-UNWIRING-PLAN.md](RETIREMENT-UNWIRING-PLAN.md).

**Scope note:** canvas, workflows, and configuration pages are excluded from UX/perf findings. ✅ **The retirement is DONE as of 2026-08-07** (phases 1–7, in the working tree — see [RETIREMENT-UNWIRING-PLAN.md](RETIREMENT-UNWIRING-PLAN.md) §STATUS): the three pages are unrouted and their four MCP tools no longer register, so no finding below can be reached through them. Their API routes stay open on purpose (D3) and were security-checked anyway — all authenticated (`withWorkspaceAuth` + `minRole: "member"`). ⚠ **THE MIGRATION LINE HERE WAS STALE AND IS CORRECTED (2026-08-08).** It said "three migrations are written but NOT applied, one of them deploy-blocking (`20260807120000`, the `cascade_hard_delete_cluster` RPC)". **All six of the `20260807*` set went up on 2026-08-07** — see F-156, which verified each one landed in a schema audit, not just that the push exited 0. What is unapplied now is the LATER work: `20260807160000` (stale-activity RPC, F-171), `20260808120000` (drop notify scope, F-170) and `20260808150000` (replay hardening, F-169), plus the recovered baseline `20260415000000` and the two F-167 renames that need `supabase migration repair --status applied` **before** the next push or they re-apply. **ORDER MATTERS across that set and the remote history is the only thing that can confirm it** — not verifiable from the working tree, which is F-167's standing warning. Do the repair first, then push.

---

## 1. Scorecard — Samuel's checklist, verdict per item

### App slowness

| Item | Verdict | One-line state |
|---|---|---|
| Uncompressed JSONs | **GAP** | No compression config anywhere (relying on unverified Vercel edge defaults); MCP SSE sets `no-transform` which actively blocks compression; several unbounded whole-table JSON payloads |
| Row-at-a-time DB writes | **GAP** | Chat-folder sharing does 2N serial round-trips (200 chats ≈ 400 calls ≈ gateway timeout); new-workspace seed is ~45 serial writes awaited before the post-signup redirect |
| Single dependency bottleneck | **GAP** | `GET /api/workspaces/resolve` blocks every page (11 call sites); boot is 5 sequential round-trips before any page's own data |
| Un-optimistic rendering | ✅ **CLOSED 2026-08-08** | Was: zero `useMutation`/`onMutate`/rollback anywhere, ~86 hand-rolled await-then-refetch sites. The layer exists and **all four named families are converted** — channels (incl. lifecycle), chats, members, ontology. What remains is the layer's own debt (F-159, F-178, F-181), not a site backlog |
| Non-statically-hosted site | **MIXED** | Pages are statically *generated* but not statically *served* — `src/proxy.ts` runs a JWT verify on every marketing/legal page request. Desktop bundle is genuinely static (verified). |

### Database / security

| Item | Verdict | One-line state |
|---|---|---|
| Rate limiting + server-side secrets | **MIXED** | Secrets: clean. Rate limiting: only exists at the MCP transport; `dopl_at_*` bearers hit ~128 REST routes directly with no limit |
| RLS on every table | **PASS** | All 51 tables RLS-enabled, zero `qual = true` policies, empirically tested live with `SET LOCAL ROLE anon` → 0 rows everywhere |
| Input validation | **PASS** | No SQL-injection path; zod on all body-reading mutation routes that matter; role enums omit `"owner"`; MCP uses `z.strictObject` (unknown key → refused) |
| Auth on protected routes | **PASS** | 128 routes: 79 workspace-auth, 36 user-auth, 5 self-auth, 8 intentionally public (OAuth/RFC/version). Cron fail-closed. Note: `src/proxy.ts` IS the middleware (Next 16 renamed it) |
| Error messages don't leak | ✅ **CLOSED 2026-08-08** | Swept onto `toHttpErrorResponse`. **Measured, not estimated: 39 files / 44 error tails** — the "29 routes" figure below was an undercount by a third. One named residual (`reconcile-seats`, F-180) and two deliberate exclusions |
| Admin/debug endpoints | **PASS** | None reachable in production; `/admin` double-gated |
| Per-user data access (workspaces/sharing) | **PASS** | Empirically tested cross-tenant with a real user's JWT: zero foreign rows on every table. No IDOR in 21 traced call sites. MCP token cannot cross membership boundary (two layers) |
| CORS | **PASS** | No CORS config at all = same-origin fully enforced; no wildcard, no credentials leak. (Only a functional limit for browser MCP clients — not a security issue) |
| Indexes | **PASS** | Zero unindexed-FK lints, zero `auth_rls_initplan` lints from the live advisor; RLS predicates all backed by composite indexes |

### UI feedback

| Item | Verdict | One-line state |
|---|---|---|
| Every button → immediate result | **MOSTLY CLOSED 2026-08-08** | Session start, and every write in channels / chats / members / ontology, now move on click (§2.1). ⚠ **Still GAP:** the two **dead** controls (`+ New skill` hardcoded `disabled`, "Knowledge ▾"/"Filter" with no `onClick`) — those are missing features, not missing feedback, and no mutation layer fixes them |
| No spinners, skeletons everywhere | **GAP** | Only 4 true spinners exist — the bigger problem is `PageLoading` (one line of grey text) on **every** desktop page; cold-launch of Channels renders 7 sequential states, 4 of them bare text. A well-built `TwoPaneListSkeleton` exists and is used by *nothing* |

**Security headline: no P0 launch-blockers.** The two highest-stakes properties (anonymous access, cross-workspace isolation) were tested against the live database, not just source, and both hold. Perf and UI are where launch work is.

---

## 2. Launch blockers (P0) — merged and ranked

1. ✅ **DONE 2026-08-07 (F-159, uncommitted in the working tree). Optimistic message send + session start** — the flagship interaction and Samuel's explicit complaint. All three §3.4 files were built as prescribed (`shared/api/query-keys.ts`, `shared/hooks/use-api-mutation.ts`, `shared/ui/pending.ts`), the send/open-thread path is optimistic with `clientMsgId` idempotency + `SendButton mode="pause"`, `refetchMessages` is gone from the send path, and the four hand-rolled channel overrides were SUBSUMED into the new layer rather than left as a fifth idiom. `channels-view-core.tsx` 588 → 436 in the same change (**447 on 2026-08-08** — it took F-174 and F-178 wiring the same night; measure, don't quote).

✅ **AND THE REMAINING-SITES WORK IS DONE TOO (2026-08-08).** This item said "the ~80 remaining write sites (chats, ontology, members, channels' own lifecycle writes) are now one config each" — all four are converted:
   - **chats** — 5/5 writes, the `useState` copy of query data deleted (it was a second source of truth that made the conversion cosmetic until it went), reads re-keyed by path, double-submit closed on folder-create-on-Enter and pin/unpin.
   - **members** — 13 writes, and **F-045 closed with them**: `useInvalidateBillingStatus` finally has callers (remove-member, approve-join), so the seat count stops going stale after a membership change.
   - **channels lifecycle** — 5 writes; the coordinator gate is REQUIRED on each, and the override maps that were incidentally providing that protection are gone (closes CHANNELS-AUDIT C-27 for channels).
   - **ontology** — creates optimistic via the reducer + `CREATE_RESOLVE`, **deliberately not `useApiMutation`**: the board renders from `graphReducer`, not a query cache, so there is nothing for `optimistic` to patch. Same three beats, different substrate.

   Four rules came out of it and are in ENGINEERING §7 (5–8): merge-never-replace when the response is narrower than the cache; a feature's READS must be on `useApiQuery` before its writes adopt the layer; `CREATE_RESOLVE` for server-minted-id-plus-instant-render; `pendingRow` on a CONTROL is what closes toggle races. Original diagnosis:
   - `src/features/channels/components/channels-view-core.tsx:229-248` — `await postMessage()` (response contains the created message, **discarded**) → `await refetchMessages()` (re-downloads the full 200-message page) → `void refetchChannels()`. User's text sits in the composer through all of it.
   - Session start (`:282-292`) same shape — `runThreadMutation` types the response away as `Promise<unknown>` at `:258`; between click and the SessionCard appearing, the only pixel change is a dimmed send button.
   - Everything needed already exists: `clientMsgId` is a first-class wire field with a unique index + server-side idempotency (`src/features/channels/server/repository-messages.ts:121-128`, schema `:204,:238`) and **no client ever sets it**; `SendButton` supports a `mode="pause"` morph (`src/shared/ui/send-button.tsx:26,65`) never passed by the composer; the desktop session window already implements the exact optimistic pattern (`dopl-desktop-app/renderer/session/session.js:389-401`).
   - Fix: generate `clientMsgId`, `setQueryData` a pending row/SessionCard, clear composer synchronously, reconcile from the POST response, roll back on error, drop the refetch. Effort M.

2. **Collapse the boot chain (5 round-trips → 1).**
   - Launch → actionable screen: onboarding-state → ensure-default → resolve → me → page data, all strictly serial. `app-shell.tsx:101-107` blocks `<Outlet/>` on resolve.
   - Three-part fix: (a) one-liner — `resolveMembershipOrThrow` awaits `findWorkspaceById` then `findMembership` sequentially though both key on `workspaceId` (`src/features/workspaces/server/service.ts:99-107`); `Promise.all` pays off on all 82 `withWorkspaceAuth` routes. (b) small — `findWorkspaceForMemberByPublicId` loads the membership then discards `role`/`userId` (`service.ts:368-377`); returning them deletes the `/api/workspaces/me` hop for 8 callers. (c) medium — single `POST /api/boot` returning `{isOnboarded, segment, workspace, role, userId, myAccess}`.

3. **Ontology payload diet + get it off the agent session-start path.**
   - `/api/ontology` does four parallel whole-table pulls, no limit/cursor (`src/features/ontology/server/service.ts:51-56`), shipping all JSONB (`attributes`/`methods`/`template`, ceiling 100 attrs × 4000 chars, + per-cluster `layout`).
   - `dopl_map` — mandated before every agent's first reply — pulls the full graph to render **names only** (`packages/mcp-server/src/tools/map.ts:118,151-157`), over an SSE stream that sets `no-transform` (`src/shared/api/sse-keep-alive.ts:108`), which affirmatively blocks compression.
   - Fix: summary projection endpoint for map-shaped reads, drop JSONB from list reads, delete `no-transform`. Effort M.

4. **Trim the proxy matcher** (`src/proxy.ts:491-494`).
   - Runs a serverless function + `supabase.auth.getClaims()` (WebCrypto JWKS verify, possible cookie rotation → `Set-Cookie` → CDN-uncacheable) on every request to `/`, `/pricing`, `/privacy`, `/terms`, `/login`. `/pricing`, `/privacy`, `/terms` are pure waste (they fall to the `PUBLIC_ROUTES` early return anyway).
   - Bonus bug: the static-file exclusion misses `.ico` in subdirectories — `src/app/layout.tsx:64` emits `/favicons/favicon.ico`, so **every signed-out landing visit 307s the favicon to `/login`**. Also leaves `robots.txt`/`sitemap.xml` unserveable.
   - Fix: add `pricing|privacy|terms` + `favicons/|.*\.(?:ico|webmanifest|txt|xml|woff2?)$` to the negative lookahead; then add `headers()` cache rules (inert until this lands). Effort S.

5. **Two unbounded write loops + cold desktop start.**
   - `src/features/chats/server/service-folders.ts:128-133` — per-chat grant delete+insert on a folder-sharing save: 2N serial round-trips, unbounded N. Collapse to one `.in()` delete + one array upsert. Effort S.
   - `apps/desktop-ui/src/lib/query-client.ts:16` — bare `QueryClient`, no persister. The web app has IndexedDB persistence (`src/shared/api/query-provider.tsx:38`); the desktop's promised SQLite cache is unbuilt. Mount the already-shared `createIdbPersister()` (~5 lines). The local-first flagship currently starts colder than the web app it replaces. Effort S.

6. **Dead controls visible at launch.**
   - "New skill" `+` is **hardcoded `disabled`** (`src/features/skills/components/skills-browser-core.tsx:144-152`) — a user cannot create a skill in the product at all. Ship authoring or remove the affordance.
   - "Knowledge ▾" and "Filter" buttons have no `onClick` (`src/features/knowledge/components/knowledge-v2/list/list-panel.tsx:68-71,73-75`).

---

## 3. App slowness — detail

### 3.1 Uncompressed / oversized JSON

| Finding | Sev | Effort |
|---|---|---|
| Ontology whole-graph pulls, no bounds, full JSONB (`ontology/server/service.ts:51-56`, `dto.ts:16`) — 11 call sites fetch the full graph | P0 | L |
| `dopl_map` full-graph fetch for names-only render (`packages/mcp-server/src/tools/map.ts:117-123,151-157`) | P0 | M |
| `no-transform` on MCP SSE blocks compression on exactly that path (`src/shared/api/sse-keep-alive.ts:108`) | P0 | S |
| `listVisibleChats` `select("*")` no limit, ships `overview`+`deliverables`+`learnings` ~67KB/row ceiling (`chats/server/repository.ts:42-62`); MCP fetches full archive, filters in JS (`packages/mcp-server/src/tools/chats.ts:360-368`) | P1 | M |
| Trash: 5 individually-unbounded loaders, JS sort, no cursor (`trash/server/service.ts:178-215`) | P1 | M |
| Teams access matrix pulls every grant row in workspace (team filter never applies — `teams/server/service.ts:306-326`, `repository.ts:229`); non-admins re-query 3 tables twice (`:373-376`) | P1 | M |
| Folder export loads every entry body in the whole base to zip one folder (`knowledge/server/export.ts:83,126,148`) | P1 | S |
| One object's edges answered by scanning all workspace relationships in JS (`ontology/server/service.ts:359-362`), on 4 hot paths | P1 | S |
| Members list unbounded with duplicated embedded team join (`workspaces/server/repository.ts:204-208`, `teams/server/repository.ts:182-184`) | P1 | M |

Compression posture: nothing in-repo configures it; Vercel edge defaults are real but unowned — verify live with `curl -H 'Accept-Encoding: br' -I`. Electron transports get gzip only by undici's default.

Prior DATA-LOADING-AUDIT status: every projection fix landed; every **pagination** half is still open. `getBaseTree`'s `entryLimit` mechanism exists but no caller passes it (dead paging — `knowledge/client/api.ts:104-109`).

**Already good — don't redo:** Channels egress diet (messages capped 200, narrow projections `channels/server/repository.ts:81-95`); `overview-counts` uses `head: true` aggregates; no embedding vectors in any read path.

### 3.2 Row-at-a-time writes

| Finding | Sev | Effort |
|---|---|---|
| Chat-folder sharing 2N serial loop (`chats/server/service-folders.ts:128-133`) | P0 | S |
| Workspace seed: ~45 serial writes before post-signup redirect (`ontology/server/service-seed.ts:78-121` = 34 incl. insert-then-update same row; `knowledge/server/service-seed.ts:41-84`; `skills/server/service-seed.ts:21-47`; awaited via `app/auth/callback/route.ts:81` → `seed-workspace.ts:85/107/118`). 1–3s on first impression of the product | P1 | M |
| `createTeam` awaits `setTeamGrant` per grant, each 3–6 round-trips (`teams/server/service.ts:69-79`) | P1 | M |
| KB share dialog: per-team upsert/delete loops (`knowledge/server/service-base-writes.ts:266-274,333-335`) | P1 | S |
| `reconcile-seats` cron: unbounded `Promise.allSettled` fan-out, 2 DB + 2 Stripe calls each — will trip Stripe rate limits silently (`api/cron/reconcile-seats/route.ts:58-60`) | P1 | S |
| `ensureFolderPath` 3 round-trips per path segment on every MCP path-addressed KB write (`knowledge/server/path.ts:210-259`) | P2 | M |
| `stale-threads` per-row insert; correct form is `.upsert(…, { onConflict: "channel_id,client_msg_id", ignoreDuplicates: true })` (`api/cron/stale-threads/route.ts:97-128`) | P2 | S |
| Invite-accept per-team insert (`workspaces/server/invitations.ts:384-386`); invariant per-KB upsert (`teams/server/invariant.ts:107-116`) | P2 | S |

Models to copy: `chat_create_with_messages` / `chat_append_messages` / `cascade_soft_delete_cluster` RPCs — single-call batch shapes already in the codebase.

### 3.3 Dependency bottleneck

Boot chain (detailed in §2.2). Additional findings:

| Finding | Sev | Effort |
|---|---|---|
| `use-workspace-access.ts:55` gate makes six pages await `me` before their own data; `pages/chats/index.tsx:54-61` shows the parallel pattern to copy | P1 | S |
| `my-access` route runs `findMembership` a third redundant time (`api/workspaces/[workspaceSlug]/my-access/route.ts:40,52`; thread `opts.role` into `teams/server/access.ts:115`) | P1 | S |
| Token refresh is lazy on first API call instead of at launch (`dopl-desktop-app/main/ui-bridge.js:215`) — adds a hop to every cold start after ~48min | P1 | S |
| Knowledge page chain depth 5 from launch (`pages/knowledge/index.tsx:111,124`) | P1 | M |
| N+1s: join-links up to 100 parallel `getUserById` (`workspaces/server/join-links.ts:248-277` → one `.in()` on profiles); `listFolderAncestors` one query per hop (`knowledge/server/repository-folders.ts:86-100`); per-segment path resolve (`knowledge/server/path.ts:92-107`); 2N serial reads per KB narrowing save (`teams/server/invariant.ts:160-204`) | P1 | M |
| `staleTime: 0, refetchOnMount: "always"` on boot + ontology (`pages/boot/index.tsx:62-63`, `use-ontology.ts:79-80`) — the ontology one sits on the unbounded graph | P1 | S |

### 3.4 Un-optimistic data layer

✅ **THE HEADLINE IS RETIRED (2026-08-08).** This section opened "Zero `useMutation` in the repo (the identifier appears only in two comments and `CONVENTIONS.md:50` prescribing it)." The layer is built and **all four named families are on it** — channels incl. lifecycle, chats, members, ontology (the last via the reducer + `CREATE_RESOLVE`, deliberately, because the board renders from `graphReducer` and there is no cache entry to patch). What survives is the layer's own debt, not a site backlog: the duplicated cold-cache filter (F-178) and the absent PREDICATE invalidation (F-181). Highlights beyond §2.1:

- ~~12 of 16 channel writes un-optimistic; 4 ARE optimistic via hand-rolled override records~~ — **done, and the four override records are DELETED rather than joined by a fifth idiom.** ⚠ Consequence worth carrying: those maps were what protected the ungated writes from the realtime doorbell, so the coordinator gate is now load-bearing on every channel write (CHANNELS-AUDIT C-27).
- ~~All 5 chat writes patch after the await, including pin/unpin, a pure toggle~~ — done; the pure toggle now moves on click.
- Realtime events trigger wholesale refetch amplification: any channel event fires **four full reads** (`channels-view-core.tsx:181-190`); "doorbell, never content" policy is defensible for RLS but DL-030 was rejected, not fixed. (DL-031 — the 82.7%-of-DB realtime problem — IS fixed: ref-counted shared channel registry + one desktop socket + publication trimmed to 22 tables.)
- `["chat-detail", workspaceId]` invalidation nukes every cached transcript in the workspace (`chats-view.tsx:102`); skill rename re-downloads the whole list (`pages/skills/index.tsx:48`).
- ~~`ChatsView` copies query data into `useState` and never re-syncs — two sources of truth~~ — **deleted as part of the chats conversion, and it had to be**: patching the cache changes nothing on a surface rendering from a `useState` copy of it. Generalised into ENGINEERING §7 rule 6 — a feature's READS must be on `useApiQuery` before its writes adopt the layer, or the conversion is cosmetic and silently so.
- 7 web files use raw `fetch("/api/…")` that **cannot work in the packaged SPA** (`file://` + `connect-src 'none'`): `join-link-card.tsx:41`, `accept-invite-card.tsx:53`, `embedded-checkout.tsx:52`, `workspace-icon-uploader.tsx:33,55`, `delete-account.tsx:20`, `plans-billing.tsx:54`.
- `refetchOnWindowFocus` inherits `true` — every desktop focus after 30s idle refetches every mounted query.

**Smallest infra change enabling optimistic-by-default (from the UI audit):** three new files, no feature rewrites —
1. `src/shared/api/query-keys.ts` — per-resource key factories matching the `[path, workspaceId, query]` tuple `use-api-query-core.ts:54` already uses.
2. `src/shared/hooks/use-api-mutation.ts` — thin `useMutation` wrapper over `apiRequest` (transport-injected like `use-api-query-core`) with `optimistic: (draft) => (cache) => nextCache` wired to `onMutate` + snapshot + `onError` rollback, auto-invalidate on settle, `pending` flag, and `settleWith(coordinator)` for the existing `createRefetchCoordinator`.
3. `src/shared/ui/pending.ts` — `data-pending` class recipe + `PendingRow` shell so optimistic rows look deliberately provisional.

Reusable primitives already in-repo: `createRefetchCoordinator` (`src/shared/realtime/refetch-coordinator.ts:24`), `createMergeScheduler`, `persist-gate`, `keyed-serializer`, three working optimistic reference implementations (`use-content-descriptions.ts:70-101`, channels override maps, `use-channel-permission-preset.ts:140`). **The most complete optimistic engine lives in `src/features/workflows` (`use-workflows.ts:229-232`) and ontology's `graphReducer` — harvest before workflows is retired.**

### 3.5 Static hosting

Covered in §2.4. Additional: OG card `public/img/site_thumbnail.png` is 1.30MB (should be ~80–150KB); `public/favicons/dopl-mark-source.png` (297KB source asset) ships referenced by nothing; dead `/opengraph-image` branch in `proxy.ts:250-260`. Desktop bundle verified genuinely static with fail-closed CSP. Bundle-split pre-planning: the moment `pages/knowledge/detail.tsx` imports the doc editor, ~200KB gz of Tiptap/marked/turndown lands in the single chunk — plan `React.lazy` boundaries before that port.

---

## 4. Security — detail (fix list)

| Finding | Sev | Effort |
|---|---|---|
| OAuth `dopl_at_*` bearers bypass rate limiting on ~128 REST routes (limiter only at MCP transport, `with-mcp-transport-auth.ts:66-71`; `with-auth.ts:158` accepts bearers directly). Move check into `withUserAuth`'s OAuth branch, same subject key | P1 | S |
| `/api/oauth/register` unauthenticated, inserts a row per call, no reaper (cleanup cron misses `oauth_clients` — `api/cron/oauth-cleanup/route.ts:45-71`); `client_name` rendered verbatim on consent screen (`app/oauth/authorize/page.tsx:79`) → "Dopl Official Desktop" spoofable. Per-IP limit on `/api/oauth/*` + reaper + "unverified" badge | P1 | M |
| KB/skill bodies reach agents with no untrusted-content framing (`packages/mcp-server/src/tools/knowledge-ops-read.ts:186-194`, `skills-ops-read.ts:136-140`) while channels are thoroughly framed. In a shared workspace, member B's content lands unframed in member A's Bash-capable agent. Emit the existing `UNTRUSTED_BODY_HEADER`, at minimum when `createdBy !== caller.userId` | P1 | S |
| ✅ **DONE 2026-08-08.** ~~29 routes return raw exception text bypassing the existing sanitizer~~ — **the count was wrong: 39 files and 44 error tails** were converted onto `toHttpErrorResponse`, measured off the diff, not estimated. ⚠ **Two exclusions are DELIBERATE, audited rather than missed** (billing + the oauth-cleanup cron: their tails are load-bearing operational output, not client-facing leakage). **One real residual, filed as F-180:** `api/cron/reconcile-seats/route.ts` returns raw Stripe exception text in `failures[]` on its **200** path — invisible to a sanitizer sweep because the route never throws, and it must not be made to (per-workspace isolation is the design). Cron-secret gated; the durable copy in `system_events.metadata` is the more interesting half | ✅ | — |
| `import "server-only"` missing from `src/shared/supabase/admin.ts` — the one module where a future client import is catastrophic; 131 other files have it | P2 | S |
| ✅ **DONE 2026-08-10 — `CRON_SECRET` IS SET AND LIVE.** ~~unset in Vercel → all four cron jobs answer 503 → trash never purges, seats never reconcile~~. **Verified by measurement, not by asking:** all three surviving crons now answer **401** unauthenticated where they answered **503** (`www.usedopl.com/api/cron/{oauth-cleanup,reconcile-seats,stale-threads}`). ⚠ Two corrections to the struck row: it said **four** jobs — there are **three** (`purge-trash` was deleted with the trash teardown on 2026-08-07, so "trash never purges" named a cron that no longer exists), and the apex **307-redirects to `www`**, so a `curl` without `-L` returns 307 and proves neither state. **What this row was really protecting is now the live item: setting the secret ARMED the stale-threads sweep for its first-ever execution.** First candidates are not possible before ~**2026-08-14** (14-day idle threshold, measured from a freshly purged channel set) — that is the window to read `api/cron/stale-threads/route.ts`'s docblock in, not after. ⚠ **Stale copies of the old claim survive in `src/**` and are code-side, not docs:** `api/cron/stale-threads/route.ts:84` and `route.test.ts:7,217` | ✅ | — |
| `_admin` MCP tools listed for viewers (scope-gated only; ⚠ the `server.ts:432-442` reference is DEAD — that file went 1045 → 227 on 2026-08-08 and the registration path is now `registrar.ts`. Re-locate before acting); not an escalation (backing routes 403) but overstates capability. Skip registering when `options.role` is viewer | P2 | S |
| Invitation metadata (workspace name + inviter email) returned even after revocation/expiry (`api/workspaces/invitations/[token]/route.ts:13`) | P2 | S |
| Tidiness: `REVOKE EXECUTE FROM anon` on 2 SECURITY DEFINER RPCs; pin `search_path` on 2 functions; 36 `multiple_permissive_policies` pairs to merge into `OR`'d singles; 41 unused indexes to re-check post-launch; rate-limit `/api/oauth/token` (cost only — tokens are 256-bit single-use); correct stale "rate limiting" docstring at `with-auth.ts:255`; delete dead `withMcpAccess` (`with-auth.ts:263`) | P2 | S |

---

## 5. UI feedback — detail

### Session start (the named complaint)
Full trace: composer "Request" mode → Send → `setSending(true)` dims the button → **2 serial network hops with zero other pixel change** (POST creates the thread, response discarded; then full messages refetch with `keepPreviousData` deliberately holding the old list) → SessionCard finally appears → auto-scroll → "Working…". Fix = §2.1. Adjacent weak controls: "Open thread" (`session-card.tsx:387-426`), session pill "Open" (`session-pills-bar.tsx:187-194`, no busy state at all), close/complete/failed/reopen thread (`thread-panel.tsx:280-355`). The consent-card Allow (`consent-card.tsx:120-130`) is already genuinely optimistic — the in-feature reference.

### Zero-feedback controls (literally nothing happens on click)
✅ **MEMBERS, CHANNELS AND CHATS ARE DONE (2026-08-08, §2.1).** All 13 members writes, all 5 channel lifecycle writes and all 5 chats writes are on the mutation layer: the cache patch happens in `onMutate`, the double-fireable paths (approve/decline join, folder-create-on-Enter, pin/unpin) are guarded by `pendingRow` on the control rather than by an ad-hoc in-flight flag, and the segmented control gained an **additive `disabled` prop** so it can show provisional state without a second idiom. Ontology creates are optimistic via the reducer (`CREATE_RESOLVE`). **Two residual rows below are NOT covered** — see the strikethroughs.
- ~~Members: **revoke invite**, **approve/decline join request** (double-fireable, no disable), **resource scope toggle** (segmented control doesn't move)~~ — all three done. ⚠ The resource-scope toggle moves now, but its *invalidation* is the open half: a scope flip changes every member's per-member access pane and the layer cannot express that (F-181).
- ~~Channels: archive/unarchive, visibility toggle, leave, join~~ — done.
- ~~Chats: create folder (Enter re-fires → duplicate POSTs), pin/unpin (conflicting PATCHes on rapid clicks)~~ — done.
- Ontology: **new cluster = 3 serial round-trips, zero feedback, then everything appears at once** (`use-ontology.ts:295-328`) — worst latency-to-pixel ratio in the app; reducer cases (`graph-state.ts:114,146`) and rollback module (`create-cluster-rollback.ts`) already exist, only ordering must change. Same for +Column/+Card.
- Misc: sign out desktop (fire-and-forget, no confirm — `account-actions.tsx:31-38`), knowledge downloads (`tree-context-menu.tsx:51-59`, `detail-panel.tsx:195-203`), skills trash restore (`skills-trash-modal.tsx:174-181` — double-restore possible), "Refresh billing status" + desktop upgrade buttons (`plans-billing-core.tsx:134-141,311-330`).

### Post-mutation bugs (visibly wrong states)
1. Create-channel selects an id not yet in the list → wrong channel shown, then jumps (`channels-view-core.tsx:552-556` vs `:127-132`).
2. Skill duplicate jumps to `visible[0]` then to the new skill (`skills-browser-core.tsx:115`).
3. Skill move-to-folder reverts to the old folder name for the whole round trip (`skill-view.tsx:506`).
4. "Manage billing" success message renders in `text-danger` red (`plans-billing-core.tsx:192`).
5. Get-started "Downloading {asset}" is hardcoded JSX bound to nothing — says "Downloading" forever if the download fails (`get-started-screen.tsx:79-84`).
6. Overview stat row renders hard `0`s while loading, then jumps (`pages/overview/index.tsx:67`).

### Stale-value toggles (disabled but showing old value through the await)
✅ **THE MEMBERS, CHANNELS AND CHATS ONES ARE DONE (2026-08-08).** A converted write patches the cache in `onMutate`, so the control shows the NEW value provisionally instead of the old one disabled — which is the whole difference this section was describing. Covered: member role select, team access level, resource scope control, chat pin star, channel visibility pill, share-scope pills, **team rename crumb/list row** (which additionally now RESETS the input on failure — it previously kept the rejected name on screen, the worst version of this bug because the operator cannot tell the write failed).

⚠ **STILL OPEN, and they are the ones outside the four converted families:** agent-write switch thumb (`agent-write-toggle.tsx:83-88`) and reset-invite-link showing the old URL (`invite-dialog.tsx:93-102`). Both are one config each now — the layer they need exists.

### Spinners → skeletons
Only 4 true spinners exist: onboarding finish (`onboarding-flow-core.tsx:164`), OAuth handoff page (`app/auth/desktop-start/page.tsx:52`), **Electron splash** (`dopl-desktop-app/renderer/loading.html:26-42` — first thing every user sees every launch; replace with static shell skeleton), update-required screen. Keep the pulse-dot/thinking-chip patterns (not spinners).

The real problem is text loaders: `PageLoading` (`apps/desktop-ui/src/components/page-states.tsx:17-27`) = one grey `<span>`, used on every desktop page; its justifying comment ("main-process cache makes skeletons the bug") describes infrastructure that doesn't exist yet. Cold Channels launch = 7 sequential states, 4 bare text. And because every page gates on `useWorkspaceAccess()`, the good feature skeletons never appear first.

Fixes: make `PageLoading` render a shape; adopt the **orphaned** `TwoPaneListSkeleton` (`src/shared/ui/skeleton.tsx:108` — built for exactly knowledge/chats/skills/members, used by nothing) on those pages; transcript skeleton for chats detail (`detail-pane.tsx:190`); members console should use its existing `MembersTableSkeleton` (today it renders a **false "No members yet." empty state while loading** — `members-list-pane.tsx:179`); dedupe the two hand-rolled skeleton clones (`channels-skeleton.tsx:11-33`, `doc-pane-chrome.tsx:19-34`) into the kit; `CheckoutSkeleton` (`embedded-checkout.tsx:225-238`) is the quality bar.

### Success confirmation
Nearly every completing action confirms nothing — modal just vanishes (create/rename/delete workspace, accept invite, switch-to-Team, create folder, delete chat, pin, profile save). `toast()` is synchronous module state — fire it in `onMutate`. Missing entirely: chat rename/move-to-folder UI (API supports `folderId`), folder rename/delete, leave-workspace control (doesn't exist anywhere), ontology drag-between-columns.

---

## 6. Execution phases

**Phase A — one-day high-leverage fixes (all S effort):**
`Promise.all` in `resolveMembershipOrThrow` · return role/userId from resolve · proxy matcher trim + favicon fix · drop `no-transform` · mount IDB persister in desktop query client · `server-only` import in admin.ts · ~~verify `CRON_SECRET` in Vercel~~ ✅ **done 2026-08-10, it is set and live (401, not 503)** · move rate-limit check into `withUserAuth` OAuth branch · chat-folder batch write · remove/wire the three dead controls.

**Phase B — mutation layer + flagship interaction: ✅ COMPLETE (2026-08-08).**
~~Land `use-api-mutation` + `query-keys` + pending atoms~~ (the `use-workflows.ts` harvest happened; `src/features/workflows/hooks/use-workflows.ts` is still on disk under the retirement, so the reference survives). ~~Then: optimistic message send + session start (with `clientMsgId` + `SendButton mode="pause"`), members zero-feedback controls, chat pin/create-folder, ontology creates~~ — all done. **Carried forward into Phase F**, because they are the layer's debt rather than the phase's: promote the cold-cache filter into `use-api-mutation.ts` before a third copy (F-178), add predicate invalidation and use it for resource-scope (F-181, F-182), dim the pending chat bubble in `MessageBubble` (F-159), and the two stale-value toggles outside the four families (agent-write switch, reset-invite-link). The three post-mutation bugs are NOT claimed here — they were not part of this wave.

**Phase C — loading states:**
`PageLoading` → shaped skeleton · `TwoPaneListSkeleton` on channels/chats/knowledge/skills/members · members false-empty-state fix · Electron splash → static shell skeleton · onboarding finish spinner → destination skeleton or stepped checklist.

**Phase D — boot collapse + payload diet:**
`POST /api/boot` · un-gate the six pages from `me` · ontology summary projection + JSONB trim · chats `select("*")` trim + limit · teams matrix filter · trash cursors · seed batching via RPC (biggest absolute first-impression win: 1–3s).

**Phase E — security P1s + error sweep:** partially done.
~~KB/skill untrusted framing~~ ✅ (F-168, 2026-08-08 — foreign-authored KB entries and skill bodies now carry surface-scoped headers; the skill header's copy deliberately differs from the channel one). ~~29-route error-tail sweep~~ ✅ (**39 files / 44 tails**, measured; residual F-180). Still open: OAuth register limits/reaper/badge · viewer `_admin` tool hiding · invitation metadata gating · the OAuth-bearer rate-limit move into `withUserAuth` (§4 row 1, still the largest remaining security item).

**Phase F — polish (P2s):**
Stale-value toggles · success toasts · OG image compress · `refetchOnWindowFocus` policy · permissive-policy merges · unused-index review post-launch · N+1 cleanups · `ensureFolderPath` batching.

**Don't redo (verified good):** RLS + isolation (empirically tested) · auth wrapper architecture · MCP input validation (`z.strictObject`) · CORS posture · index coverage · channels egress diet · realtime DB-load fix (shared registry + single desktop socket) · chat message RPCs · root layout static-cleanliness · desktop CSP.
