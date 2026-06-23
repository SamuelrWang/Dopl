# Data-Loading Audit — toward Slack/Notion-grade performance

Audited 2026-06-20. Scope: every data-loading surface — server first-paint loads,
client fetching/caching, Supabase Realtime, DB query patterns, rendering/caching/bundle.

Goal: load only what's needed, when it's needed; keep payloads lean; cache the rest;
apply deltas instead of refetching; ship less JS. This is the Slack/Notion/Linear
playbook. The architecture is fundamentally sound (PostgREST so no serverless
connection-exhaustion; force-dynamic correctly scoped; auth boundary clean). The gaps
are all **eager + unbounded loads, an absent caching layer, and refetch-on-event** —
fixable without re-architecting.

Line numbers are as-of-audit; reconfirm at implementation time.

## Guiding principles (the target)

1. **Load only what's visible, when it's visible** — paginate + virtualize lists; lazy-hydrate detail and offscreen panels.
2. **Lean payloads** — list views fetch summaries (no bodies, no message arrays); detail fetches the full object.
3. **Cache aggressively, invalidate precisely** — request-level (`React.cache`), client (query library), HTTP headers.
4. **Apply deltas, don't refetch** — realtime patches state in place (canvas already does this; KB/skills don't).
5. **Ship less JS** — code-split heavy editors and rare panels.
6. **Index the hot filters** — composite indexes for the filters actually used.

---

## TIER 0 — Load-bearing now (the hottest path, worst offenders)

### DL-001 — Conversations: unbounded list + full `messages` JSON in the list payload — **HIGH**
`GET /api/conversations` (`src/app/api/conversations/route.ts:77-84`) and the canvas loader
(`src/features/canvas/server/load-server-state.ts:249-314`) load **all** conversations for the
workspace with the entire `messages` JSON array per row — on the canvas first paint. A power
user with hundreds of conversations × long histories = multi-MB payload, every canvas load.
Flagged independently by 3 of 5 audits.
- Drop `messages` from the list projection — load messages only when a conversation opens.
- Paginate (cursor on `updated_at`); load the most-recent N.
- **Tag:** over-fetch + unbounded + first-paint-blocker.

### DL-002 — Expired-conversation cleanup runs inline in the request path — **MED**
`src/app/api/conversations/route.ts:29-75` deletes expired conversations + signs/removes
attachments **before** returning the list. At volume this serializes storage I/O on the hot
read. Move to the existing cron surface (`vercel.json` already runs cleanup crons).

### DL-003 — Canvas first paint loads panels + edges + conversations eagerly, all unbounded — **HIGH**
`src/features/canvas/server/load-server-state.ts:73-237` loads the entire canvas (every panel,
every edge, all conversations) synchronously on the primary screen. Even at modest sizes it's
all eager and blocking.
- Render the canvas shell + viewport-visible panels first; **lazy-hydrate each panel's data when it mounts/enters view** (each panel already has its own fetch hook).
- Combine with DL-001 pagination.
- **Tag:** eager + unbounded + first-paint-blocker.

---

## TIER 1 — Scales with data size (power-user cliffs)

### DL-010 — Knowledge tree: unbounded folders + entries per KB — **HIGH**
`src/features/knowledge/server/repository.ts:717` (`getBaseTree`) loads **all** folders + entries
for a base (bodies already excluded — good), but no pagination/virtualization. 5k entries = slow
render + fat client tree.
- Lazy-load folder children on expand; virtualize the tree list.

### DL-011 — Knowledge index admin view: full access matrix + all bases — **MED-HIGH**
`src/features/knowledge/server/service.ts` (`listBases` → `listEffectiveAccess`) + `listTeams`
scan the workspace_resource_access matrix and all bases when teams-mode bases exist. Scales with
teams × resources. Needs the composite index in DL-051 and/or a narrower query.

### DL-012 — Trash list unbounded — **MED**
`src/features/knowledge/server/repository.ts:687-733` (`listDeletedForWorkspace`) — three
unbounded queries, no limit. Add `.limit()` + cursor.

### DL-013 — Skills / bases / members / teams lists unbounded — **LOW-MED**
Same no-pagination pattern, smaller typical counts. `skills/server/repository.ts` (summary
projection — good), `knowledge` bases list, members/teams API. Add limits before any single
workspace gets large.

---

## TIER 2 — Caching layer (currently absent)

### DL-020 — No request-level memoization (`React.cache`) — **HIGH (cheap win)**
Zero `React.cache()` / `unstable_cache()` in the codebase. The same data (workspace lookup,
membership, access checks) is re-queried multiple times within a single render. Wrapping the hot
server reads in `React.cache()` dedupes them per request — low effort, broad latency win.

### DL-021 — No client query library; weak/partial client cache — **HIGH (foundational)**
Hand-rolled `fetch + useEffect` everywhere (already logged as "Item 5" debt in
`src/features/knowledge/client/hooks.ts:14`). Only knowledge has a `memoryCache` Map
(`hooks.ts:67`) — no TTL, no cross-user invalidation, never expires. Skills, members, teams,
invitations, access all **refetch from scratch on every nav** (no cache). Adopt SWR or
react-query once → uniform caching, request dedupe, stale-while-revalidate, focus-revalidate.

### DL-022 — No HTTP cache headers on 96/104 API routes — **MED**
Only 8 routes set `Cache-Control`. User-scoped endpoints should explicitly send
`private, no-store` (correctness/clarity for browsers + any CDN). A few stable ones
(`my-access`, discovery metadata — already done) can cache briefly.

---

## TIER 3 — Realtime efficiency

### DL-030 — Refetch-on-event: every DB change triggers a FULL list/tree refetch — **HIGH**
`src/features/knowledge/client/realtime.ts:69-72` and `src/features/skills/client/realtime.ts:58-61`
fire `onChange()` → parent refetches the **entire** tree / skill list on any INSERT/UPDATE/DELETE.
Canvas already does the right thing: extracts the changed row from the payload and patches state
in place (`src/features/canvas/use-canvas-realtime.ts:66-95`). **Replicate the canvas
apply-in-place pattern for KB + skills.**

### DL-031 — Duplicate subscriptions: knowledge ×3-4, skills ×2-3 per workspace — **HIGH**
Each component mounts its own realtime hook (knowledge: `knowledge-base-view.tsx:174`,
`knowledge-base-switcher.tsx`, `knowledge-panel.tsx:22`, `knowledge-base-panel.tsx`; skills:
`skill-view.tsx:426`, `skill-panel.tsx`, `skills-panel.tsx`), so the same tables are subscribed
3-4× per workspace. Each change → 3-4 handlers → 3-4 full refetches (compounds DL-030).
Consolidate to **one workspace-level channel per table, shared via context** (the per-component
`instanceId` exists only to dodge a Supabase v2 double-subscribe throw — a shared provider removes
the need).

### DL-032 — Presence broadcasts on every keystroke — **LOW-MED**
`src/shared/realtime/use-presence.ts:42-52` calls `.track()` on each editing-flag flip. Debounce
to ~500ms.

---

## TIER 4 — Client bundle & assets

### DL-040 — Zero code-splitting; heavy editor + all panels eager — **MED**
No `next/dynamic` / `React.lazy` anywhere. Tiptap + `marked` + `turndown` (~200KB gzipped,
`src/features/knowledge/components/doc-editor.tsx`) and all 40+ canvas panel types are eagerly
bundled. `dynamic(() => …, { ssr:false })` the doc editor (loads only when a doc opens) and
lazy-load rare/heavy panels.

### DL-041 — Oversized assets — **LOW**
`public/img/site_thumbnail.png` is 1.2MB unoptimized; favicons oversized; marketing uses `<img>`
not `next/image`. Convert to WebP/AVIF; use `next/image`.

---

## TIER 5 — Database indexes

### DL-050 — Verify/add composite indexes for hot filters — **MED**
Hot filter columns observed: `workspace_id` (~125 queries), `deleted_at` (~32), `user_id`,
`knowledge_base_id`, `slug`, `public_id`, `panel_id`, `cluster_id`, `team_id`,
`resource_type/resource_id`. Verify coverage and add:
- `(workspace_id, deleted_at)` — partial `WHERE deleted_at IS NULL` for the soft-delete lists.
- `(workspace_id, visibility, user_id)` — conversations.
- `(workspace_id, resource_type, resource_id)` — team grants / access matrix (DL-011).
- entry/folder ordering: `(knowledge_base_id, position, created_at)`.

---

## Already good — do NOT redo

- **PostgREST/supabase-js everywhere** → no raw `pg`, no serverless connection-exhaustion.
- **`force-dynamic` correctly scoped** to user routes; marketing/legal/auth are static-eligible.
- **KB tree excludes bodies**; **skills list uses a summary projection** (no JSONB) — lean list payloads where it matters.
- **Canvas realtime applies deltas in place** (the pattern to copy for DL-030).
- **Reconnect backoff** (capped exponential, per-hook, no thundering herd).
- **Optimistic concurrency** (412 on stale write + conflict UI).
- **Server-only SDKs** (`@anthropic-ai`, Supabase service role) never shipped to client; **Stripe lazy-loaded** on billing only.
- **Batched** attachment URL signing and team-grant listing (`.in(...)`), paginated workspace attachment cleanup.

---

## Recommended sequence (impact × effort)

1. **DL-001 / DL-002** — conversations payload + pagination + cleanup-to-cron. Hottest path, biggest single win.
2. **DL-020** — `React.cache()` the hot server reads. Cheap, broad.
3. **DL-003** — canvas lazy panel hydration. Structural win for the main screen.
4. **DL-030 / DL-031** — realtime apply-in-place + dedupe subscriptions. Kills refetch storms; reuses the existing canvas pattern.
5. **DL-021** — adopt SWR/react-query. Foundational; unlocks uniform caching for everything else.
6. **DL-010** — knowledge tree pagination/virtualization.
7. **DL-040 / DL-050 / DL-022 / DL-041** — code-split, indexes, headers, images. Cleanup pass.
