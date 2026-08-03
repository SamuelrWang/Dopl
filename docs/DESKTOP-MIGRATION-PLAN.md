# Desktop-Only Migration — Master Plan

**Goal:** Dopl becomes a desktop-only product. The website is retired; the sole
client is a bundled, local-first Electron app (Slack/Notion architecture). The
server shrinks to a pure API over Postgres.

**Status:** In progress on branch `desktop-migration`. Backup taken 2026-08-02
(see [Backup protocol](#backup-protocol)). Git snapshot: tag
`pre-desktop-migration-2026-08-02`.

**Research docs (read before building anything):** `docs/migration-research/`
— `desktop-main.md`, `web-pages.md`, `api-surface.md`, `auth-flows.md`,
`packages-and-build.md`. Key corrections they made to this plan:

- **Auth decision (Phase 2 prerequisite): Supabase-JWT-as-Bearer.** The SPA's
  API calls carry `Authorization: Bearer <supabase access JWT>`;
  `withUserAuth` (src/shared/auth/with-auth.ts) learns to discriminate bearer
  KIND — `dopl_at_*` prefix → existing MCP/agent branch, otherwise verify as
  a Supabase JWT via local `getClaims(jwt)` and treat the caller as a
  SESSION (no `agentTokenId`). This keeps all ~21 `sessionOnly` handlers,
  agent-write gates, and `source` tagging correct. Reusing MCP tokens for the
  UI is disqualified: the UI would be treated as an agent (403 on sessionOnly
  routes incl. device-token minting, `agent_write_enabled` gates, writes
  stamped `source: "agent"`).
- **`version-skew.js` is NOT a version gate** — it's an advisory notification
  only. A real server-side minimum-version gate is new work, required before
  Phase 4 (a stale bundled client means a stale UI forever).
- **The `/auth/desktop-*` handoff surfaces are Next PAGES** and must survive
  website retirement — Phase 4's deletion list must exclude them (or they get
  rebuilt as minimal static pages).
- **Desktop main-process auth rots without the web page.** Main's cookie jar
  is refreshed by the remote page's Supabase client today; bundled SPA kills
  that refresher. Main must switch to the token store + its own single-flight
  refresh (`main/auth.js` already has the refresh client; it needs a
  proactive timer and the blob↔jar direction inverted). `main/api.js` needs
  401-repair.
- **`packages/dopl-client` is main-process material only** (node:async_hooks,
  agent-bearer auth model) — the SPA renderer keeps `src/shared/api/api-client.ts`
  as its HTTP client, with fetch as the future IPC seam. ~50/123 API routes
  covered by dopl-client; gaps listed in api-surface.md.
- **6 API gaps to build** for page ports: onboarding gate, default-workspace
  provisioning, overview head-counts, knowledge ownerNames, KB-slug
  resolution (client-side), plus the bearer branch above.

---

## Why (diagnosis, 2026-08-02)

The current desktop app is a thin Electron shell that `loadURL`s the remote
Next.js site. Page switches hang for up to ~a minute on skeletons. Profiled
causes, ranked:

1. **Realtime saturates the DB.** 82.7% of all Postgres exec-time is Supabase
   Realtime WAL polling, driven by ~96 live `postgres_changes` subscriptions
   (the shared hook `use-workspace-tables-realtime.ts` opens one channel **per
   component instance**). Stall proof: individual queries spiking to 12s–58s.
   Instance is small (`shared_buffers=28MB`, `max_connections=60`).
2. **Every app route is `force-dynamic`** (40 routes) → full server render per
   navigation, plus a network `auth.getUser()` per page in RSC (API routes
   already use local `getClaims()`; the RSC path was left behind).
3. **Client fan-out** — each page mount fires several parallel `/api` calls
   through the same saturated DB.
4. **Missing indexes** — 25 unindexed FKs; 36 duplicate permissive RLS
   policies; 35 unused indexes (advisor, 2026-08-02).

The rewrite deletes problem classes 2–3 entirely and replaces 1 with a single
sync stream. Phase 0 relieves 1 and 4 for current users while we build.

## Target architecture

```
┌─ Electron app ────────────────────────────────────┐
│ Renderer: Vite + React SPA (client router)        │
│   - UI reads local cache first, never blocks on   │
│     the network for navigation                    │
│   - TanStack Query stays as the in-memory layer   │
│ Main process: owns all data & credentials         │
│   - SQLite cache (mirror of server state)         │
│   - Sync engine (delta pull + one live stream)    │
│   - Auth tokens (never exposed to renderer)       │
│   - Renderer talks to main over typed IPC         │
└──────────────────┬────────────────────────────────┘
                   │ HTTPS: API writes + delta sync
┌─ Server ─────────┴────────────────────────────────┐
│ Pure API (Next API routes now; extractable to a   │
│ standalone service later — client can't tell)     │
│ Auth (Supabase) · Stripe · remote MCP · crons     │
│ Postgres = source of truth (RLS intact)           │
└───────────────────────────────────────────────────┘
```

Principles:

- **Server stays source of truth.** Local SQLite is a fast mirror, never
  authoritative. All writes go through the API and its existing authz.
- **Renderer never touches the network or tokens.** Main process owns both
  (crash-resilient cache, single sync engine across windows, no tokens in the
  web layer).
- **Each phase ships.** No big-bang cutover; the remote site remains the
  fallback until Phase 3 proves out.
- **UI iteration speed changes.** Bundled UI means changes ship via desktop
  release + auto-update (electron-updater pipeline already exists), not Vercel
  deploy. Keep the server-side minimum-version gate (`version-skew.js`) so old
  clients can be forced forward.

---

## Phase 0 — Stabilize current app (days, not weeks)

Relief for current users; all changes survive into the end state.

- [ ] **DB backup** (done 2026-08-02) — re-run per protocol below.
- [ ] **Compute upgrade** (Samuel, Supabase dashboard): nano/micro → small+.
      Single fastest relief for the realtime CPU squeeze.
- [ ] **FK index migration**: add the 25 missing FK indexes (advisor list,
      2026-08-02). Additive, safe. One migration file.
- [ ] **Realtime dedup**: refactor `use-workspace-tables-realtime.ts` to a
      ref-counted shared channel per `(workspace, table-set)` instead of one
      per component instance. CAUTION: the per-instance design dodges a real
      Supabase v2 crash (`.on()` after `.subscribe()` throws). The shared
      module must own the channel lifecycle and fan events out to listeners.
- [ ] Defer: RLS policy dedup and unused-index drops (verify one-by-one,
      separate pass — access-regression risk). Defer: RSC `getUser()` →
      `getClaims()` (RSC layer is deleted in Phase 2 anyway).

**Exit:** page loads no longer stall behind the DB; realtime CPU share drops
visibly in `pg_stat_statements`.
**Rollback:** indexes are droppable; realtime refactor is a single-module
revert.

## Phase 1 — Local-first feel in the current app (~week)

- [ ] Persist TanStack Query cache to disk (IndexedDB via
      `@tanstack/query-persist-client` + idb). Cold start renders last-known
      data instantly; background refetch patches.
- [ ] Raise `staleTime` per resource class (workspace list/membership: minutes;
      content lists: 30–60s) so navigation is cache-first.
- [ ] Keep skeletons only for genuinely-first visits.

**Exit:** app restart → content visible immediately (stale-while-revalidate).
**Rollback:** remove the persister; behavior returns to today's.

## Phase 2 — The real rewrite: bundled Vite SPA (~3–5 weeks)

The core of the migration. New `apps/desktop-ui` (Vite + React + client
router), shipped inside Electron; `loadURL(remote)` retired.

- [ ] **Scaffold**: Vite SPA + Electron integration; typed IPC bridge; routes
      mirroring today's ~12 app pages (canvas, ontology, knowledge, skills,
      workflows, chats, channels, members, overview, settings, configuration).
      Marketing/login/pricing pages are NOT ported — they die with the website.
- [ ] **Auth**: token-based via the existing desktop OAuth handoff
      (`auth/desktop-start` → `desktop-handoff` → `desktop-complete`). Tokens
      stored in main process (keychain via `safeStorage`), attached to API
      calls in main. Renderer never sees them.
- [ ] **Data layer**: every page's RSC fetch converts to a client query
      against the existing `/api/**` surface, routed renderer → IPC → main →
      HTTPS. Add thin API endpoints where a page currently calls services
      directly (most already exist for the REST/MCP surface).
- [ ] **SQLite cache in main** (`better-sqlite3`): generic table of
      `(resource key → JSON, updated_at)` to start — not a relational mirror.
      Query flow: IPC read returns cached row immediately + triggers refresh;
      write-through on API success.
- [ ] **Port order** (one page at a time, each verified against prod API):
      overview → skills → knowledge → chats → workflows → ontology/canvas
      (heaviest, last) → members/settings/configuration.
- [ ] **Dogfood gate**: Samuel runs the bundled app daily for a week before
      any user gets it.

**Exit:** bundled app covers all daily workflows with no remote page loads.
**Rollback:** ship a release that flips back to `loadURL(remote)` — keep the
load-guard path alive until Phase 4.

## Phase 3 — Sync engine (~1–2 weeks)

- [ ] **Delta pull**: one endpoint (`GET /api/sync?since=<cursor>`) returning
      changed rows across the caller's visible resources, driven by
      `updated_at` cursors (audit tables for hard deletes or use soft-delete
      timestamps — most tables already soft-delete).
- [ ] **One live signal**: replace all per-table `postgres_changes`
      subscriptions with a single per-client channel (broadcast "something
      changed in workspace X" → client pulls the delta). Realtime WAL cost
      collapses to ~one subscription per online client.
- [ ] **Conflict policy**: server wins; local optimistic writes reconcile on
      ack (matches today's optimistic-update patterns).
- [ ] **CHANNELS EXEMPTION**: the dedicated `channel_messages` /
      `channel_agents` realtime subscriptions are NOT consolidated into the
      sync stream. Agent message delivery is latency-critical (push, not
      pull-on-signal), and at 1–2 subscriptions per client they were never
      the cost problem — the per-component web fan-out was. The desktop main
      process listener (`main/realtime.js`, `main/realtime-agents.js`) stays
      exactly as-is.
- [ ] Remove the per-table realtime hooks once all non-channel consumers ride
      the sync stream.

**Exit:** realtime share of DB exec-time <10%; live updates still land.
**Rollback:** per-table hooks remain in the tree until exit criteria met.

## Phase 4 — Retire the website (~1 week)

- [ ] Web app routes → download page (or straight redirect to a landing
      page + download link). Login/signup happens in-app via the OAuth flow.
- [ ] **KEEP every OAuth/auth surface (Samuel, 2026-08-02): the website
      remains the auth broker.** The MCP/Claude-connector OAuth pages
      (`/oauth/authorize` + its page UI, `/.well-known/*` metadata, token
      endpoints), the Supabase auth callback, login page (it backs the
      OAuth flows), and the `/auth/desktop-*` handoff pages ALL survive
      retirement. "Retire the website" means the app CONTENT pages die —
      not the auth broker.
- [ ] **Onboarding moves into the desktop app**: the web `/onboarding`
      flow (workspace naming/setup) needs an SPA equivalent — new users
      go straight to the desktop app now. Also covers the G2 gap (deleting
      the last workspace currently lands on a dead `/`). Port as its own
      slice before retirement.
- [ ] Delete remaining RSC pages, layouts, skeletons, landing chrome;
      server keeps: `/api/**`, everything in the KEEP list above, Stripe
      webhooks, remote MCP, crons.
- [ ] Remove desktop `load-guard` remote-URL machinery (bundled app doesn't
      navigate to remote pages); keep offline detection for API reachability.
- [ ] **DB backup before this phase** (first destructive-adjacent step).

**Exit:** no user-facing HTML served except download/landing; app fully
self-contained.

## Phase 5 — Optional cleanup (unscheduled)

- Extract API from Next to a standalone service (Hono/Fastify) — invisible to
  the client, do whenever it pays for itself.
- RLS policy dedup + unused-index drops (verified individually).
- Relational SQLite mirror + local full-text search, offline writes queue —
  only if product needs them.

---

## Backup protocol

Before Phase 0 DB migration, Phase 3 rollout, and Phase 4 — and monthly
otherwise:

```bash
D=~/dopl-backups/$(date +%F) && mkdir -p $D && cd ~/Downloads/setup-intelligence-engine \
  && supabase db dump --linked -f $D/schema.sql \
  && supabase db dump --linked --data-only -f $D/data.sql \
  && supabase db dump --linked --role-only -f $D/roles.sql \
  && supabase db dump --linked -s auth -f $D/auth-schema.sql \
  && supabase db dump --linked -s auth --data-only -f $D/auth-data.sql \
  && supabase db dump --linked -s storage --data-only -f $D/storage-data.sql \
  && tar czf ~/dopl-backups/dopl-db-backup-$(date +%F).tar.gz -C ~/dopl-backups $(date +%F) \
  && cp ~/dopl-backups/dopl-db-backup-$(date +%F).tar.gz \
       ~/Library/Mobile\ Documents/com~apple~CloudDocs/dopl-backups/
```

Requires Docker running. Restore target: fresh Supabase project → apply
`schema.sql` + `auth-schema.sql`, then data files. Also enable/verify the
Supabase dashboard's automatic daily backups (paid plans) as a second layer.

Code snapshots: tag `pre-<phase>-<date>` before each phase begins
(`pre-desktop-migration-2026-08-02` exists).

## Channels — protected functionality

The channel feature has two independent halves; know which is touched when:

1. **Agent side (desktop main process)** — `main/realtime.js` (one websocket,
   `channel_messages` INSERTs), `main/realtime-agents.js` (roster doorbell),
   `main/channel-listener.js` (reply loops), consent machinery. Talks directly
   to Supabase realtime + the REST API with its own tokens — **already the
   target architecture**. Untouched by every phase; keeps working even while
   the UI is rewritten around it.
2. **UI side (web page)** — `src/features/channels/**` riding the shared
   realtime hook. In scope for the Phase 0 dedup (same events, behavior-
   preserving) and ported to the SPA in Phase 2 (last-ish, most complex page:
   consent inbox, presence, roster pills, message list).

Guardrails: Phase 0 dedup ships only after a manual channels smoke test
(message send/receive, consent request/decide, roster updates, two windows
open — the multi-mount case the per-instance design existed for). Phase 3
explicitly exempts channel messaging from sync-stream consolidation (above).

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Shared realtime channel re-triggers Supabase v2 subscribe crash | 0 | Ref-counted module owns lifecycle; test multi-page mounts |
| Index migration locks a hot table | 0 | `CREATE INDEX CONCURRENTLY`; tiny DB (41MB) makes this near-instant |
| Token auth breaks an API route that assumed cookies | 2 | Routes already accept Bearer (`with-auth.ts`); per-page port + verify |
| Sync misses deletes | 3 | Soft-delete timestamps ride the same cursor; audit hard-delete paths first |
| Users stuck on old shell after cutover | 4 | Build a REAL minimum-version gate (version-skew.js is advisory-only — new server-side work) + auto-update on launch |
| Desktop main auth silently rots post-SPA (cookie refresher gone) | 2 | Token store + proactive refresh in main; 401-repair in main/api.js; see desktop-main.md R-risks |
| Anything catastrophic | any | Dated dumps + iCloud copy + git tags; old remote path kept until Phase 4 |
