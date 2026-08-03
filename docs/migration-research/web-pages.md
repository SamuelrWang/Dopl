# Web pages → SPA port spec

Research output for Phase 2 of [docs/DESKTOP-MIGRATION-PLAN.md](../DESKTOP-MIGRATION-PLAN.md):
every page under `src/app/[workspaceSlug]/(app)/`, what its server component
fetches today, whether an `/api/**` equivalent exists, what the client tree
already fetches, and what makes each page hard.

**Read §1 before any page section.** The cross-cutting items there (auth
transport, the Supabase cookie client, `router.refresh()`) are the actual
migration work; most pages are thin once those land.

Status legend for API coverage: **COVERED** (an `/api/**` route returns the same
data) · **DERIVABLE** (no 1:1 route, but composable from existing ones) ·
**GAP** (new endpoint required).

---

## 1. Cross-cutting foundations

### 1.1 Transport — one seam, plus ~15 bypasses

`apiRequest` is the whole client HTTP layer: `src/shared/api/api-client.ts:45`.

- URL is the raw relative path — `api-client.ts:54`. No base URL, no origin.
- Auth is **cookies only** — `credentials: "same-origin"` at `api-client.ts:68`.
  There is no bearer option and no desktop/token mode on the client.
- Headers it can set: `x-workspace-id` (`:50`), `content-type` (`:51`),
  `x-updated-at` (`:52`).

The SPA needs an absolute base URL + `Authorization: Bearer <supabase access
token>` here. **Server-side caveat:** `src/shared/auth/with-auth.ts:116` treats
*any* `Authorization` header as a remote-MCP OAuth token, and `:236` flags such
callers as `isMcpCaller` for analytics. A naive bearer swap misclassifies every
SPA request and breaks `sessionOnly` routes (`with-auth.ts:124-126`) — which
include workspace DELETE (`src/app/api/workspaces/[workspaceSlug]/route.ts:100`)
and account delete. The user-JWT path must be a distinct branch.

**Raw `fetch` sites that bypass `apiRequest`** and each need the same treatment:
`src/shared/layout/settings-modal/sections/plans-billing.tsx:80`,
`sections/delete-account.tsx:20`,
`src/shared/layout/settings-modal/workspace-icon-uploader.tsx:33,55`,
`src/features/workspaces/components/join-request-notices.tsx:42`,
`src/features/onboarding/hooks/use-mcp-connection-poll.ts:23`,
`src/features/members/components/members-view.tsx:142`,
`src/features/members/components/invite-dialog.tsx:214`,
`src/features/members/components/pending-invitations.tsx:36`,
`src/features/workspaces/components/workspace-settings-form.tsx:39`,
`src/features/workspaces/components/workspace-danger-zone.tsx:29,38`,
`src/features/mcp-connect/components/connected-apps-section.tsx:37`,
`src/features/billing/components/embedded-checkout.tsx:52`,
`src/features/knowledge/client/api.ts:294` (export blob download, builds
`new URL(path, window.location.origin)`).

### 1.2 Auth + realtime both ride the Supabase **cookie** client

`src/shared/supabase/browser.ts:13` uses `createBrowserClient` from
`@supabase/ssr`, which persists the session in **cookies**. In a bundled
renderer there are no cookies. Two consumers break together:

- `src/shared/auth/use-auth-user.ts:22` — `getUser()` + `onAuthStateChange`.
- `src/shared/realtime/shared-channel-registry.ts:122` — every realtime channel.

One fix (swap to `@supabase/supabase-js` `createClient` with an explicit storage
adapter fed from the main process) covers both. Env vars are also Next-shaped:
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(`src/shared/supabase/browser.ts:14-15`) and
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
(`src/features/billing/components/embedded-checkout.tsx:15`) → `import.meta.env`.

### 1.3 Realtime is already shared (Phase 0 landed)

`src/shared/realtime/use-workspace-tables-realtime.ts:50` now delegates to
`subscribeSharedWorkspaceTables` (`src/shared/realtime/shared-channel-registry.ts:183`)
— one ref-counted channel per `(topicPrefix, workspaceId, tables)` instead of one
per component instance. Reconnect backoff `[500,1000,2000,4000,8000,15000]`
(`shared-channel-registry.ts:37`), per-table filter `workspace_id=eq.<id>`
(`:137`), and catch-up refetch on every fresh SUBSCRIBED (`:145`, documented
`:23-25`) — a late listener attaching to a live channel is fired immediately.

> **Note for build agents:** any older notes describing a per-instance
> `useId()` topic in this hook are stale. Verify against the file.

The six feature wrappers, all in `src/features/*/client/realtime.ts`:

| Hook | Tables | Topic | Mounted at |
|---|---|---|---|
| `useOntologyRealtime` `ontology/client/realtime.ts:13` | `ontology_clusters`, `ontology_objects`, `ontology_memberships`, `ontology_relationships` (`:5-10`) | `ontology-realtime` | `src/features/ontology/hooks/use-ontology.ts:154` |
| `useWorkflowsRealtime` `workflows/client/realtime.ts:14` | `workflows`, `workflow_steps`, `workflow_step_edges`, `workflow_knowledge_bases`, `workflow_skills` (`:5-11`) | `workflows-realtime` | `src/features/workflows/hooks/use-workflows.ts:178` |
| `useKnowledgeRealtime` `knowledge/client/realtime.ts:12` | `knowledge_bases`, `knowledge_folders`, `knowledge_entries` (`:5-9`) | `knowledge-realtime` | `.../knowledge-v2/use-knowledge-v2-controller.ts:287` |
| `useSkillsRealtime` `skills/client/realtime.ts:11` | `skills`, `skill_versions` (`:8`) | `skills-realtime` | `src/features/skills/components/skill-view.tsx:464` |
| `useChatsRealtime` `chats/client/realtime.ts:8` | `chats`, `chat_messages`, `chat_folders` (`:5`) | `chats-realtime` | `src/features/chats/components/chats-view.tsx:88` |
| `useChannelsRealtime` / `useConsentRealtime` / `useChannelAgentsRealtime` / `usePresenceRealtime` `channels/client/realtime.ts:38,57,83,101` | `channels`+`channel_members`+`channel_messages`; `channel_consent_requests`; `channel_agents`; `agent_presence` (`channels/constants.ts:6-27`) | four separate topics | see §11 |

A second realtime surface exists: Supabase **Presence** (`channel.track()`) via
`src/shared/realtime/use-presence.ts:45,66`, used only by knowledge
(`.../knowledge-v2/detail/doc-pane.tsx:138`) and skills (`skill-view.tsx:173`).
Channels does **not** use Supabase Presence — its "presence" is the
`agent_presence` table read over HTTP.

### 1.4 Next-router coupling (the full list)

No app-tree component uses `next/image` or server actions. `next/link` and
`next/navigation` sites, each needing an SPA-router replacement:

`next/link` — `src/shared/layout/app-shell/app-rail.tsx:3`,
`src/shared/layout/app-shell/app-sidebar.tsx:3`,
`src/features/workspaces/components/overview-stats.tsx:1`,
`src/features/members/components/members-widget.tsx:3`,
`src/features/channels/components/channels-onboarding.tsx:3`.

`next/navigation` (client) — `src/shared/layout/layout-shell.tsx:3`
(`usePathname`), `app-shell/app-sidebar.tsx:4` (`usePathname`),
`app-shell/workspace-switcher.tsx:4`, `src/shared/auth/use-auth-user.ts:4`,
`src/features/tour/components/tour-provider.tsx:12`,
`src/shared/layout/settings-modal/sections/delete-account.tsx:4`,
`src/features/workspaces/components/{workspace-settings-form,workspace-danger-zone,join-request-notices,create-workspace-dialog,join-link-card,accept-invite-card}.tsx:4`,
`src/features/knowledge/components/{base-settings-form,create-base-dialog,kb-sharing-section}.tsx:4`,
`.../knowledge-v2/knowledge-v2.tsx:4`,
`.../knowledge-v2/detail/detail-panel.tsx:4`,
`src/features/skills/components/skills-browser.tsx:4`,
`src/features/skills/components/skill-view.tsx:5`.

**`router.refresh()` has no SPA equivalent.** Every call site exists purely to
re-pull RSC props and must become a targeted `queryClient.invalidateQueries`:
`use-auth-user.ts:43`, `join-request-notices.tsx:54`,
`workspace-settings-form.tsx:58`, `workspace-danger-zone.tsx:46`,
`knowledge-v2.tsx:100`, `detail-panel.tsx:121`, `base-settings-form.tsx:88,110`,
`create-base-dialog.tsx:90`, `kb-sharing-section.tsx:117`,
`skills-browser.tsx:200`, `skill-view.tsx:486,502,744`.

### 1.5 Canonical-slug / redirect logic to reimplement client-side

`resolvePageWorkspace(segment, userId, tail)` —
`src/features/workspaces/server/segment.ts:86-98` — is called by **every** page.
It: resolves `{slug}-{publicId}` by publicId, falls back to legacy slug-only
lookup with a `legacy_slug_redirect` telemetry event (`segment.ts:57-73`),
`notFound()`s when unreachable, and **301s to the canonical URL** when the
inbound segment is stale, preserving the page's `tail` (`:93-96`).

The API twin `resolveApiWorkspace` (`segment.ts:106-112`) deliberately does
**not** 301 — it silently accepts legacy slugs. So the SPA gets resolution for
free from any `/api/workspaces/{segment}` call; what it must reimplement is the
**canonical-URL rewrite** (compare `workspaceSegment(ws)` against the routed
segment, `history.replaceState` if different).

The same two-level pattern exists for knowledge bases:
`resolveKbSegment` / `resolvePageKb` — `src/features/knowledge/server/segment.ts:30,72`.

---

## 2. Shared layout — `[workspaceSlug]/(app)/layout.tsx`

**The SPA shell must replicate all of this.** File:
`src/app/[workspaceSlug]/(app)/layout.tsx` (`dynamic = "force-dynamic"` at `:29`).

### 2.1 What the layout fetches

| Call | Line | Purpose |
|---|---|---|
| `getUser()` | `:38` | redirect `/login` when absent (`:39`) |
| `resolveWorkspaceSegmentForUser(slug, userId)` | `:41` | `notFound()` on miss (`:42`) |
| `workspaceSegment(ws)` | `:44` | canonical segment |
| `resolveMembershipOrThrow(ws.id, userId)` | `:48` | seeds the settings-modal role gate on first paint |

It hands **five props** to `AppShell` (`:51-56`): `workspaceSegment`,
`workspaceId`, `workspacePublicId`, `workspaceName`, `role`.

**API coverage: COVERED.** `GET /api/workspaces/[workspaceSlug]`
(`src/app/api/workspaces/[workspaceSlug]/route.ts:23`) returns
`{ workspace, role }` (`:39`) — `workspace` is the full `Workspace`
(`src/features/workspaces/types.ts:38-49`: `id, ownerId, name, slug, publicId,
description, iconUrl, createdAt, updatedAt`). All five props derive from it.
Cost: the shell gains a loading gate it does not have today.

### 2.2 Provider nesting to preserve

`AppShell` → `TourProvider` (`:58`) → `MyAccessProvider` (`:59`) → `children`
+ `JoinRequestNotices` (`:61`) + `ConnectAgentBanner` (`:62`) + `WelcomePopup`
(`:63`).

### 2.3 What the shell itself fetches client-side

| Component | Endpoint | Site |
|---|---|---|
| `AppShell` → `useRailWorkspaces` | `GET /api/workspaces` | `src/shared/layout/app-shell/app-shell.tsx:148` |
| `WorkspaceSwitcher` | `GET /api/workspaces` (`enabled: open`) | `app-shell/workspace-switcher.tsx:47` |
| `AppSidebar` → `useConsentInbox` | `GET /api/channels/consent` | `src/features/channels/hooks/use-consent-inbox.ts:37`, mounted `app-sidebar.tsx:80` — **realtime-only from the sidebar, no poll** |
| `MyAccessProvider` | `GET /api/workspaces/{segment}/my-access` | `src/features/members/hooks/use-my-access.tsx:47` |
| `JoinRequestNotices` | `GET /api/me/join-requests`; `POST /api/me/join-requests/{id}/ack` | `join-request-notices.tsx:31`, `:42` |
| `ConnectAgentBanner` | `GET /api/onboarding/mcp-status` (`enabled: !skip`) | `connect-agent-banner.tsx:52` |
| → `useMcpConnectionPoll` | same path on a **3500 ms `setInterval`** | `src/features/onboarding/hooks/use-mcp-connection-poll.ts:38` |
| `SettingsModal` panes | `/api/workspaces/{segment}`, `/api/user/profile`, `/api/user/delete`, `/api/billing/{status,portal,upgrade-to-team}`, `/api/workspaces/{segment}/icon`, plus the members hooks | `settings-modal/sections/*.tsx` |
| `WelcomePopup`, `TourProvider`, `AppRail`, `AppPanel` | **no network** | — |

`AppShell` also reads `?billing=` from `window.location.search` and strips it
with `history.replaceState` (`app-shell.tsx:60-82`) — framework-agnostic, but
must be reconciled with the SPA router. `PlansBilling` polls
`ent.refresh()` on a 1 s × 20 interval when `billingReturn !== null`
(`plans-billing.tsx:57-70`).

### 2.4 TourProvider

`src/features/tour/components/tour-provider.tsx`. **Zero network.** State is
localStorage under `dopl:tour-step:{workspaceSegment}`
(`src/features/tour/constants.ts:11,17-19`), persisted at `tour-provider.tsx:61-72`,
resumed on mount (`:101-116`), cleared on workspace switch (`:120-130`). Its only
workspace dependency is the `workspaceSegment` string (`:52`). Router coupling:
`router.push(sectionPath(...))` at `:78`. Started by a window event
`dopl:start-tour` (`constants.ts:22`) dispatched from
`src/features/onboarding/components/welcome-popup.tsx:56`.

### 2.5 Root-layout concerns (`src/app/layout.tsx`)

`QueryProvider` (`:116`, defaults at `src/shared/api/query-provider.tsx:19-31`:
`staleTime 30_000`, `gcTime 5min`, no retry on 4xx) · `LayoutShell` (`:117`,
only dresses non-workspace routes — workspace routes pass through bare,
`layout-shell.tsx:68-70`) · `ToastHost` outside the query provider (`:119`) ·
six `next/font/google` families defining `--font-*` (`:2,8-46`) → need
`@font-face`/fontsource · pre-hydration body-class script (`:111-115`) → must
move into the SPA `index.html` · `metadata` export (`:58-90`) is Next-only.

### 2.6 Also to port

`src/app/[workspaceSlug]/(app)/error.tsx` — the authed error boundary. Five
`loading.tsx` skeletons exist (channels, chats, members, knowledge,
knowledge/[kbSlug]) and become suspense/pending states.

---

## 3. `/[workspaceSlug]` — workspace root redirect

**Server fetches** (`src/app/[workspaceSlug]/(app)/page.tsx`): `getUser()` `:24`
· `isOnboarded(user.id)` `:28` → redirect `/onboarding` · `resolvePageWorkspace`
`:30` → `redirect('/{segment}/canvas')` `:31`. Renders nothing.

**API coverage: GAP.** `isOnboarded`
(`src/features/onboarding/server/service.ts:92`) has **no** API route — it is
called only from server components and `auth/callback` (verified: 4 call sites,
none HTTP). The SPA boot gate needs one.

**Related boot route — `/canvas` (top level).** `src/app/canvas/page.tsx` is the
default-workspace entry used by Stripe returns and every legacy
`redirect("/canvas")`. It calls `isOnboarded` (`:30`) and
`ensureDefaultWorkspace(user.id)` (`:32`), then forwards the query string
(`:34-42`). **`ensureDefaultWorkspace`
(`src/features/workspaces/server/service.ts:177`) has no API route either** —
`GET /api/workspaces` lists but never provisions. Second GAP.

**Client hooks:** none.

**Complexity:** pure routing. In the SPA this becomes the launch sequence:
onboarding gate → resolve/ensure default workspace → navigate to canvas, with
`?billing=` forwarding preserved.

**PORT DIFFICULTY: easy** — no UI, but it needs the two new boot endpoints.

---

## 4. `/overview`

**Server fetches** (`src/app/[workspaceSlug]/(app)/overview/page.tsx`):

- `resolvePageWorkspace(slug, userId, "overview")` `:60`.
- `loadCounts(workspace.id)` `:29-54,64` — **four direct `supabaseAdmin()` head
  counts** (`workflows`, `knowledge_bases` soft-filtered, `skills`
  soft-filtered, `workspace_members`). Failures degrade to 0.
- `isMcpConnected(user.id)` `:65`.

**Props:** the page is mostly server-rendered markup. It passes `segment` +
the four counts to `OverviewStats` (`:110`) and `segment` to `MembersWidget`
(`:141`); `connected` drives an inline badge (`:89-104`).

**API coverage:**
- Counts → **GAP.** No route returns them. Four list endpoints
  (`/api/workflows`, `/api/knowledge/bases`, `/api/skills`,
  `/api/workspaces/{slug}/members`) could be counted client-side, but that is
  four full payloads for four integers — build `GET /api/workspaces/{slug}/stats`.
- `isMcpConnected` → **COVERED** by `GET /api/onboarding/mcp-status`
  (`src/app/api/onboarding/mcp-status/route.ts:13`, returns `{ connected }`,
  same underlying `isMcpConnected`).

**Client hooks already present:** `MembersWidget`
(`src/features/members/components/members-widget.tsx:19`) fetches
`GET /api/workspaces/{slug}/members` via `useMembers`. `OverviewStats` is a
**server component** with zero fetches (`overview-stats.tsx:10-22`) and uses
`next/link` (`:1,57`) — it must become a client component.
`ConnectClients` / `AgentSkillCard` (`src/features/mcp-connect/**`) do no
network at all; they build strings from `window.location.origin`.

**Complexity:** the page body is JSX in the server component — it must be
lifted into a client component wholesale.

**PORT DIFFICULTY: medium** — trivial UI, but needs a new stats endpoint and the
server-component body rewritten as a client component.

---

## 5. `/canvas` — ontology graph

**Server fetches** (`src/app/[workspaceSlug]/(app)/canvas/page.tsx`):
`resolvePageWorkspace(..., "canvas")` `:24` · `requireWorkspaceRole(ws.id,
userId, "viewer")` `:25` (`src/features/workspaces/server/authz.ts:14`).
**No data fetching.** Props to `GraphView` (`:28-32`): `workspaceId`,
`canManageBilling` (`meetsMinRole(role,"admin")`), `canEdit`
(`meetsMinRole(role,"member")`).

**API coverage: COVERED** — the role comes from `GET /api/workspaces/{segment}`
(`{ workspace, role }`); `meetsMinRole` is a pure client-safe helper.

**Client hooks (all already client-side):**

| Endpoint | Site |
|---|---|
| `GET /api/ontology` (snapshot, key `["ontology-snapshot", wsId]`) | `src/features/ontology/hooks/use-ontology.ts:27,75-81`; fetcher `src/features/ontology/client/api.ts:51` |
| `POST /api/ontology/clusters`, `PATCH|DELETE /api/ontology/clusters/{id}` | `ontology/client/api.ts:55,67,80` |
| `POST /api/ontology/objects`, `PATCH|DELETE /api/ontology/objects/{id}` | `ontology/client/api.ts:84,100,113` |
| `GET /api/knowledge/bases`, `GET /api/skills` | `src/features/ontology/hooks/use-workspace-resources.tsx:74,78` |
| `GET /api/knowledge/entries?ids=…` (batch, cap 100) | `use-workspace-resources.tsx:110` |
| `GET /api/knowledge/bases/{id}/entries` (lazy) | `src/features/ontology/components/knowledge-pick-menu.tsx:115` |
| `GET /api/billing/status`, `POST /api/billing/upgrade-to-team`, `POST /api/billing/checkout` | `src/features/billing/components/use-workspace-entitlements.ts:71`; `upgrade-modal.tsx:71`; `embedded-checkout.tsx:52` |

Realtime: `useOntologyRealtime` via `use-ontology.ts:154`, with a clobber guard
that defers remote snapshots while writes are in flight (`:131-146`).

**Complexity — this is the heavy one:**

- **Node positions** persist **server-side only**, in the `cluster.layout` JSONB
  column. Engine: `src/shared/graph/use-graph-positions.ts:50-148` — hybrid
  auto-layout + stored overrides, 800 ms debounce under a single `"layout"` key
  (`:9-12,98-106`), adopt-only-when-idle guard (`:80-89`), orphan pruning
  (`:86`), unmount flush (`:92-96`), `resetLayout` serialized behind in-flight
  writes because the server treats `{}` as replace (`:120-130`). Written via
  `PATCH /api/ontology/clusters/{id}` from
  `src/features/ontology/graph/graph-body.tsx:76-85`; validated against the
  shared `src/shared/graph/layout-schema.ts:29-33` (`MAX_LAYOUT_NODES = 2000`).
  **No localStorage anywhere in the graph tree.**
- **No viewport/zoom/pan persistence** — the "viewport" is a native scroll
  container (`graph-body.tsx:148-153`).
- Drag: `src/shared/graph/use-node-drag.ts:227-241` (window pointer/key
  listeners). Measured heights: `src/shared/graph/use-measured-heights.ts`.
  Edge routing: `src/shared/graph/route-edges.ts` + `edge-layer.tsx`.
- The graph body is **keyed by `cluster.id`** (`graph-view.tsx:283`) so a
  realtime cluster reorder can't retarget a pending drag write — preserve this.
- **No URL sync.** `selectCluster` (`graph-view.tsx:90-97`) only sets state;
  `/canvas` has no cluster slug and cluster selection is not deep-linkable today.
- **Zero `next/*` imports in the entire graph tree** — the shared graph engine
  under `src/shared/graph/` is framework-agnostic and ports as-is.

**PORT DIFFICULTY: hard** — largest client surface, layout-persistence
choreography (debounce + idle-gate + serializer + unmount flush) that is easy to
break, and billing/entitlement modals riding along.

---

## 6. `/canvas2` — alias

`src/app/[workspaceSlug]/(app)/canvas2/page.tsx:26` — permanent redirect to
`/{slug}/canvas`, forwarding the query string (`:19-25`) so Stripe `?billing=`
params survive.

**API coverage:** n/a. **Client hooks:** none.

**PORT DIFFICULTY: easy** — one client-router redirect rule.

---

## 7. `/ontology` and `/ontology/[clusterSlug]`

**Server fetches:** identical to canvas — `resolvePageWorkspace(..., "ontology"
| "ontology/{clusterSlug}")` (`ontology/page.tsx:24`,
`ontology/[clusterSlug]/page.tsx:23-27`) + `requireWorkspaceRole(...,"viewer")`
(`:25` / `:28`). No data fetching. Props to `OntologyView`: `workspaceId`,
`workspaceSegment`, `canEdit`, `canManageBilling`, plus `initialClusterSlug` on
the deep-link route (`[clusterSlug]/page.tsx:34`).

**API coverage: COVERED** — same as §5 (role from `/api/workspaces/{segment}`).

**Client hooks:** the same set as §5 (both views share `useOntology` and
`OntologyResourcesProvider`), minus the layout write.

**Complexity:**

- `initialClusterSlug` is consumed **only as a fallback selector**
  (`ontology-view.tsx:52`, `graph.clusters.find(c => c.slug === initialClusterSlug)`);
  no effect pins `clusterId`, so it stays `null` until a tab click.
- **URL sync:** `window.history.replaceState(null, "",
  '/{workspaceSegment}/ontology/{slug}')` at `ontology-view.tsx:62` inside
  `selectCluster` (`:57-64`). No `pushState`, **no popstate handling** — the
  back button does not restore cluster selection today.
- A cluster rename does *not* refresh the address bar (contrast workflows, §8).
- Kanban lanes, not a positioned graph — no drag/layout persistence here.
- No `next/navigation` in the tree.

**PORT DIFFICULTY: medium** — shares the heavy ontology store with canvas but has
no layout persistence; the URL work is one `replaceState` → `navigate(replace)`.

---

## 8. `/workflows` and `/workflows/[workflowSlug]`

**Server fetches:** `resolvePageWorkspace(..., "workflows" |
"workflows/{workflowSlug}")` (`workflows/page.tsx:25`,
`[workflowSlug]/page.tsx:24-28`) + `requireWorkspaceRole(...,"viewer")`
(`:26`/`:29`). No data fetching. Props to `WorkflowsView`: `workspaceId`,
`workspaceSegment`, `canEdit`, plus `initialWorkflowSlug` (`[workflowSlug]/page.tsx:35`).

**API coverage: COVERED.**

**Client hooks:**

| Endpoint | Site |
|---|---|
| `GET /api/workflows` (key `["workflows", wsId]`) | `src/features/workflows/hooks/use-workflows.ts:26,103`; fetcher `workflows/client/api.ts:56` |
| `GET /api/workflows/{id}` (key `["workflow", wsId, id]`, `enabled` on selection) | `use-workflows.ts:108`; `client/api.ts:64` |
| `POST /api/workflows`, `PATCH|DELETE /api/workflows/{id}` | `client/api.ts:74,86,98` |
| `POST /api/workflows/{id}/nodes`, `PATCH|DELETE .../nodes/{nodeId}` | `client/api.ts:102,114,127` |
| `POST /api/workflows/{id}/edges`, `DELETE .../edges` (body `{from,to}`) | `client/api.ts:138,152` |
| `GET /api/knowledge/bases`, `GET /api/skills` | `src/features/workflows/hooks/use-workflow-resources.tsx:56,60` |
| `GET /api/knowledge/bases/{id}/entries` (lazy) | `src/features/workflows/components/read-pick-menu.tsx:115` |

Realtime: `useWorkflowsRealtime` at `use-workflows.ts:178`, with a pending-write
deferral guard (`:151-155`) and settle-after-save (`:175-177`).

**Complexity:**

- Same `useGraphPositions` engine as canvas
  (`src/features/workflows/components/workflow-graph.tsx:95-100`); layout comes
  from the **detail** query and persists via `PATCH /api/workflows/{id}` with
  `{layout}` (`workflow-graph.tsx:90-93`, `use-workflows.ts:258-271`).
  Server-side only, no localStorage.
- Extra interactions: connect-drag
  (`src/features/workflows/hooks/use-connect-drag.ts:210-213` window listeners),
  edge-condition popover (`workflow-graph.tsx:82,363-381`), edge click layer
  (`edge-interaction-layer.tsx`), new-node placement from live scroll offsets
  (`workflow-graph.tsx:220-256`), scroll-into-view reserving a 440 px panel
  (`:261-288`), scroll reset on deselect (`:267-269`).
- **URL sync is more aggressive than ontology — two sites:**
  `workflows-view.tsx:77-80` replaceStates whenever the active workflow's *slug*
  changes (the server regenerates the slug on rename; the list invalidation at
  `use-workflows.ts:242` lands the new one), and `:91-95` replaceStates on tab
  switch. **"URL follows server-canonical slug" must survive the port.**
- `initialWorkflowSlug` is load-bearing here (unlike ontology): a one-shot effect
  pins `tabId` once the list lands (`workflows-view.tsx:64-70`), and the detail
  query is `enabled` only on a non-null `tabId`.
- Debounce/ordering machinery: merge-scheduler 400 ms (`use-workflows.ts:22,118`),
  per-edge FIFO serializer (`:126-127`), flush-before-structural-mutation
  (`:208-211`), unmount flush (`:131-135`).
- No `next/navigation` in the tree.

**PORT DIFFICULTY: hard** — graph engine plus the richest write-ordering and
URL-canonicalization logic in the app.

---

## 9. `/knowledge` and `/knowledge/[kbSlug]`

**Server fetches — the deepest RSC page.**

`knowledge/page.tsx`: `resolvePageWorkspace(..., "knowledge")` `:35` ·
`resolveMembershipOrThrow` `:40` · `buildKnowledgeContext` `:41` ·
`listBases(ctx)` `:50` · `listBaseOwnerNames(ctx, bases)` `:51` ·
`listTeams(ws.id, userId)` `:58` (admin only, gated `:57`) folded into
`kbTeams: Record<kbId, KbTeamRef[]>` (`:62-67`).

`knowledge/[kbSlug]/page.tsx` adds: `resolvePageKbWithWorkspace(ctx, ws, kbSlug)`
`:67` (**301s on stale KB segment**, `src/features/knowledge/server/segment.ts:79-81`)
· `getBaseTree(ctx, base.id)` `:68` · `getEntry(ctx, selectedEntryId)` `:106`
(only after validating `?entryId=` against the visibility-filtered tree,
`:99-102`). Same duplicated `kbTeams` block at `:76-92`.

**Props** to `KnowledgeV2Preview` (`landing-preview.tsx:31`): `workspaceSegment`,
`workspaceId`, `bases`, `ownerNames`, `currentUserId`, `role`, `kbTeams`, and on
the detail route `initialSelection` + `initialTrees`.

**API coverage:**

| Server call | Status | Route |
|---|---|---|
| `listBases` | COVERED | `GET /api/knowledge/bases` |
| `getBaseTree` | COVERED | `GET /api/knowledge/bases/{baseId}/tree` (supports `?entryLimit`/`?entryCursor`) |
| `getEntry` | COVERED | `GET /api/knowledge/entries/{entryId}` |
| `listTeams` → `kbTeams` | DERIVABLE | `GET /api/workspaces/{slug}/teams` calls the *same* `listTeams` (`src/app/api/workspaces/[workspaceSlug]/teams/route.ts:22`) and returns grants; the 6-line filter/group moves client-side. Note the API floor is `viewer`, not `admin` — the admin gate is a UI decision. |
| **`listBaseOwnerNames`** | **GAP** | Only call sites are the two pages (`knowledge/page.tsx:51`, `[kbSlug]/page.tsx:73`); impl `src/features/knowledge/server/service-bases.ts:70`. Either add `ownerNames` to the `/api/knowledge/bases` response or derive from `GET /api/workspaces/{slug}/members`, which already hydrates display names (`src/app/api/workspaces/[workspaceSlug]/members/route.ts:14-17`). |
| **kbSlug → base resolution** | **GAP (or DERIVABLE)** | `GET /api/knowledge/bases/{baseId}` takes a raw UUID only (`route.ts:14-17` `requireBaseId`); nothing resolves a `{slug}-{publicId}` segment or a legacy slug. The `KnowledgeBase` type carries `slug` + `publicId` (`src/features/knowledge/types.ts:49-50`), so the SPA **can** match locally against the `/api/knowledge/bases` list using `knowledgeBaseSegment` (`src/features/knowledge/url.ts:7`) — which is exactly what the existing popstate handler already does (`use-knowledge-v2-controller.ts:326`). Prefer that over a new endpoint. |

**Client hooks already present** — the two-pane is already substantially
client-driven:

- `GET /api/knowledge/bases` — `src/features/knowledge/client/hooks.ts:117`,
  seeded from the `bases` prop as TanStack `initialData` (`hooks.ts:67-70`,
  controller `:61`).
- `GET /api/knowledge/bases/{id}/tree` — lazily on expand (`controller:181`),
  select (`:200`), popstate (`:329`), auto-select (`:375`); silent refresh at
  `:147`. **Trees live in plain `useState`, not TanStack** (`:84-86`).
- `GET /api/knowledge/entries/{id}` — `hooks.ts:149`, plus direct calls at
  `controller:251` (search hit) and `doc-pane.tsx:229` (412 conflict pull).
- `GET /api/knowledge/search?q&base&limit` — `knowledge-search.tsx:69`, 300 ms debounce.
- `useTeams` (`kb-sharing-section.tsx:48`, `create-base-dialog.tsx:251`),
  `useMyAccessContext` (`use-knowledge-v2-trees.ts:57` for `canEdit`).
- Full CRUD set over `/api/knowledge/{bases,folders,entries}/**` —
  `src/features/knowledge/client/api.ts:98-258`.
- Export is a **blob download**, not a link: `downloadKnowledgeExport`
  (`client/api.ts:279-316`) with `x-workspace-id` and `content-disposition`
  parsing. **No upload flow exists in the web UI**;
  `/api/knowledge/bases/{id}/files` is MCP/CLI-only.
- Realtime `useKnowledgeRealtime` at `controller:287` (refetches bases + every
  loaded tree + the open entry). Supabase **Presence** per entry at
  `doc-pane.tsx:138`. Focus revalidation at `doc-pane.tsx:168`.

**Complexity:**

- **Two-pane + deep link + URL sync via raw History API.** Target URL built at
  `controller:30-41`; `pushState` when the base id changed, `replaceState`
  otherwise (`:300-312`); a real **popstate listener** parses the pathname and
  `?entryId=` and lazily loads the tree (`:317-340`). This is the only page with
  genuine back/forward handling — the SPA router must not fight it.
- Per-workspace last-opened base in localStorage
  (`knowledge-v2/last-base.ts`, used `controller:75-77,380-383`).
- Deep-linked entry body is SSR'd and seeded as `initialData` (`controller:94-100`).
- Six `router.refresh()` sites exist only to re-pull `ownerNames`/`kbTeams`
  (§1.4); four also do real navigation (`detail-panel.tsx:120`,
  `base-settings-form.tsx:84,109`, `create-base-dialog.tsx:89`).
- Autosave + 412 optimistic-concurrency conflict resolution in `doc-pane.tsx`
  (`:198,283,318,352`).

**PORT DIFFICULTY: hard** — the URL/deep-link contract (kbSlug + `?entryId=` +
popstate + canonical 301) is the most intricate routing in the app, and it is the
only page with a true RSC-only data gap (`ownerNames`).

---

## 10. `/skills` (and `/skills/[skillSlug]`)

**Server fetches** (`skills/page.tsx`): `resolvePageWorkspace(..., "skills")`
`:32` · `resolveMembershipOrThrow` `:33` · `buildSkillContext` `:35` ·
`listSkills(ctx)` `:44` (summary columns only — the body is deliberately *not*
SSR'd, comment `:42-43`).

**Props** to `SkillsBrowser` (`:47-53`): `workspaceSlug`, `workspaceId`,
`currentUserId`, `isAdmin`, `skills`.

`/skills/[skillSlug]` is a pure redirect to the index
(`skills/[skillSlug]/page.tsx:17`).

**API coverage: COVERED** — `GET /api/skills` exists
(`src/app/api/skills/route.ts:33`) and the client wrapper `fetchSkills`
(`src/features/skills/client/api.ts:58`) is **already written but has zero call
sites**. Wiring it up is the whole port of the list.

**Client hooks:**

| Endpoint | Site |
|---|---|
| `GET /api/skills/{slug}` (full skill incl. body in `files[]`) | `skills-browser.tsx:315` on every row selection; `skill-view.tsx:372,394` |
| `GET /api/skills/{slug}/body` | `skill-view.tsx:233,326` — **412 conflict recovery only** |
| `PUT /api/skills/{slug}/body` | `skill-view.tsx:208` (debounced autosave), `:284,308` |
| `PATCH /api/skills/{slug}` | `skill-view.tsx:413` |
| `GET /api/skills/{slug}/history`, `GET /api/skills/versions/{id}`, `POST .../restore` | `skill-history-panel.tsx:82,289,315` |
| `POST /api/skills/{slug}/duplicate` | `skill-view.tsx:741` |
| `GET /api/skills/trash`, `POST /api/skills/restore/{id}` | `skills-trash-modal.tsx:46,65` |
| `GET /api/workspaces/{slug}/teams` | `skill-share-control.tsx:70` |
| `my-access` | `skill-view.tsx:116` |

Export is a plain anchor: `/api/skills/{slug}/export?workspaceId=…`
(`skill-view.tsx:721-722`; route accepts `workspaceIdFromQuery`,
`src/app/api/skills/[skillSlug]/export/route.ts:38`).

Realtime `useSkillsRealtime` is mounted **inside `SkillView`, not the browser**
(`skill-view.tsx:464`) and only pulls when the editor is at rest (`:459-463`) —
so the **left list gets no realtime updates today**; a remote create/delete is
invisible until `router.refresh()`.

**Complexity:**

- The `skills` prop is held as plain props with **no cache seeding and no
  refetch** (`skills-browser.tsx:65,74-99`); freshness depends entirely on four
  `router.refresh()` calls (`skills-browser.tsx:200`, `skill-view.tsx:486,502,744`).
  Porting these to `invalidateQueries(["/api/skills"])` actually *improves*
  behavior.
- **No URL sync at all** — selection is component state (`skills-browser.tsx:70`).
- The right pane always shows a skeleton on first paint (`:355-361`) since the
  body was never SSR'd — so the SPA loses nothing here.

**PORT DIFFICULTY: easy** — the endpoint and client wrapper already exist, there
is no URL state, and the only real work is replacing four `router.refresh()`
calls with invalidations.

---

## 11. `/chats`

**Server fetches** (`chats/page.tsx`): `resolvePageWorkspace(..., "chats")` `:27`
· `resolveMembershipOrThrow` `:28` · `buildChatContext` `:30` ·
`listChats(ctx)` + `listFolders(ctx)` in parallel `:36-39`.

**Props** to `ChatsView` (`:42-50`): `workspaceId`, `workspaceSlug`,
`currentUserId`, `role`, `initialChats`, `initialFolders`, `hiddenCount`.

**API coverage: COVERED.** `GET /api/chats` returns `{ chats, hiddenCount }`
(`src/app/api/chats/route.ts:18-19`) and `GET /api/chats/folders` returns
`{ folders }` (`folders/route.ts:18-19`) — the exact same service calls.

**The server props are already redundant.** `chats-view.tsx:72-74` seeds them
into `useState`, and `:91-97` immediately re-fetches the identical payload via
`listChats`/`listFolders` (`src/features/chats/client/api.ts:41,47`),
overwriting all three slots. This fires **on mount**, because
`useWorkspaceTablesRealtime` fires its callback on the first SUBSCRIBED
(`shared-channel-registry.ts:145`). So `initialChats`/`initialFolders`/
`hiddenCount` can simply be deleted in the SPA with zero behavior loss.

**Client hooks:** `GET /api/chats`, `GET /api/chats/folders` (above) ·
`GET /api/chats/{chatId}` via `useChatDetail` (`chats/client/hooks.ts:21-25`,
mounted `detail-pane.tsx:62`) · `PATCH|DELETE /api/chats/{chatId}`,
`POST /api/chats/folders`, `PATCH /api/chats/folders/{id}`
(`client/api.ts:79,89,99,122`) · `useTeams` lazily inside share popovers
(`share-control.tsx:97`) · `GET /api/billing/status` via `UpgradeModal`, which
mounts whenever `hiddenCount > 0` (`list-pane.tsx:252,306`). Realtime
`useChatsRealtime` at `chats-view.tsx:88`. No polling anywhere.

**Complexity:** low. Three-pane list/detail, no URL state, **zero `next/*`
imports in the entire chats tree**.

**PORT DIFFICULTY: easy** — drop the three server props, add two `useApiQuery`
calls, done.

---

## 12. `/channels`

**Server fetches** (`channels/page.tsx`): `resolvePageWorkspace(..., "channels")`
`:22` · `resolveMembershipOrThrow` `:23`. **No data fetching.** Props to
`ChannelsView` (`:26-31`): `workspaceId`, `workspaceSlug`, `currentUserId`,
`role`.

**API coverage: COVERED** — everything comes from `GET /api/workspaces/{segment}`
plus the user id.

**Client hooks (the largest read set in the app):**

| Endpoint | Site |
|---|---|
| `GET /api/channels` (+`?include=archived`) | `hooks/use-channels.ts:15`, mounted `channels-view.tsx:96` |
| `GET /api/channels/{id}/messages?limit=200` | `hooks/use-channel-messages.ts:23,26`, mounted `:122` (`keepPreviousData`) |
| `GET /api/channels/{id}/members` | `hooks/use-channel-members.ts:19`, mounted `:123`; also `invite-dialog.tsx:97` |
| `GET /api/channels/{id}/tasks` (wire `tasks` = domain *thread*) | `hooks/use-channel-threads.ts:31`, mounted `:131` |
| `GET /api/channels/consent` | `hooks/use-consent-inbox.ts:37`, mounted `:136-140` — **`refetchInterval` 30 s** (`constants.ts:61`), `staleTime: 0` |
| `GET /api/channels/trust` | `hooks/use-trust-rules.ts:19`, mounted `:141` — no realtime (table unpublished) |
| `GET /api/channels/{id}/agents` | `hooks/use-channel-agents.ts:74`, mounted `channel-pane.tsx:146` (`enabled: channel.isMember`) |
| `GET /api/workspaces/{slug}/members` | `invite-dialog.tsx:104`, `create-channel-dialog.tsx:78`, `direct-message-dialog.tsx:44` |

Writes: the full set at `src/features/channels/client/api.ts:72-420`
(channels CRUD, messages, members, tasks/threads incl. close/reopen/set_mode,
agents, consent decide, trust add/remove).

**Realtime — four concurrent subscriptions** (§1.3): `useChannelsRealtime`
(`channels-view.tsx:174`, behind a `createRefetchCoordinator`, `:163-173`),
`usePresenceRealtime` (`:192`, bypasses the coordinator, 10 s trailing debounce
→ members only), `useConsentRealtime` (inside `use-consent-inbox.ts:45`, mounted
**twice** — page `:136` and the always-mounted sidebar `app-sidebar.tsx:80`),
`useChannelAgentsRealtime` (inside `use-channel-agents.ts:81`, mounted
`channel-pane.tsx:146`).

**Complexity:**

- **Consent inbox** — query + realtime + 30 s backstop poll; local state machine
  (`channels-view.tsx:87-92` `consentBusyIds`/`decidedConsentIds`), derivations
  `:146-158`, handler `:408-425`, rendered at the end of the transcript
  (`channel-pane.tsx:409-424`). The consent card embeds **desktop-only** rows
  (`consent-card.tsx:161` folder, `:114` permission preset) that talk to the
  Electron bridge `window.dopl.channels`, **not** the network
  (`hooks/use-channel-folder.ts:39-64`,
  `hooks/use-channel-permission-preset.ts:84-137`). In the bundled app these
  become first-class IPC instead of a conditional.
- **Presence** — `agent_presence` table (not Supabase Presence), 90 s online
  window (`constants.ts:112`), 10 s refetch debounce (`:120`), header strip
  `channel-pane.tsx:266-285`.
- **Agent roster/pills** — `use-channel-agents.ts` (1 query + 4 mutations) plus
  `useEngagementClock` (`agent-chips-bar.tsx:69-101`) scheduling its own wake for
  the 60 min engagement TTL (`constants.ts:105`), because expiry produces no row
  change and therefore no realtime event.
- **Message list has no pagination** — fixed `limit: 200`
  (`use-channel-messages.ts:26`), no `since` cursor, stick-to-bottom scroll only
  (`channel-pane.tsx:209-212`). The route supports `since`/`limit`
  (`src/app/api/channels/[channelId]/messages/route.ts:26-27`) if this ever needs
  fixing.
- **Threads** — `use-channel-threads.ts` + `runThreadMutation`
  (`channels-view.tsx:241-301`), navigation via
  `document.getElementById('session:'+id).scrollIntoView`
  (`channel-pane.tsx:226-236`).
- **`/api/channels/{id}/await` needs no SPA counterpart** — no web caller exists;
  it is used only by the desktop listener
  (`dopl-desktop-app/main/channel-listener.js`) and the MCP server. Per the
  migration plan, the desktop agent half is untouched.
- Only Next coupling: `channels-onboarding.tsx:3,133` (`next/link`) and a
  transitive `useRouter` via `useAuthUser` in `create-channel-dialog.tsx:11`.

**PORT DIFFICULTY: hard** — most concurrent live surfaces (4 realtime channels +
a poll), the consent state machine, and the only page whose UI already reaches
into the Electron bridge.

---

## 13. `/members`

**Server fetches** (`members/page.tsx`): `resolvePageWorkspace(..., "members")`
`:18` · `resolveMembershipOrThrow` `:19`. **No data fetching.** Props to
`MembersView` (`:22-27`): `workspaceSlug`, `workspaceId`, `currentUserId`,
`myRole`.

**API coverage: COVERED.**

**Client hooks — everything is already client-side:**

| Hook | Endpoint | Site |
|---|---|---|
| `useMembers` | `GET /api/workspaces/{slug}/members` | `hooks/use-members.ts:11`, `members-view.tsx:68` |
| `useInvitations` (`enabled: canManage`) | `GET .../invitations` | `hooks/use-invitations.ts:15`, `:69-72` |
| `useTeams` | `GET .../teams` | `hooks/use-teams.ts:10`, `:73` |
| `useWorkspaceResources` | `GET .../access-matrix` | `hooks/use-workspace-resources.ts:15`, `:74` |
| `useJoinRequests` (`enabled: canManage`) | `GET .../join-requests`; `POST .../join-requests/{id}` | `hooks/use-join-requests.ts:27,33`, `:75` |
| `member-detail` | `GET .../members/{userId}/access` | `member-detail.tsx:76` |
| `invite-dialog` | `GET|POST .../join-link`; `POST .../invitations` | `invite-dialog.tsx:59,73,214` |

Mutations route through `src/features/members/teams-client.ts:69-173` (teams
CRUD, team members, team access, access-matrix, member role/remove).

**Complexity:** low, but two **hardcoded TanStack query keys** will break
silently if `useApiQuery`'s key shape moves: `invite-dialog.tsx:74`
(`[linkPath, undefined, undefined]`) and
`src/features/trash/components/workspace-trash-section.tsx:101`.
`members-view.tsx` has no Next imports; `members-widget.tsx:3` uses `next/link`.
No realtime on this page.

**PORT DIFFICULTY: easy** — already fully API-driven; only the four props need a
client source.

---

## 14. `/settings`

**Server fetches** (`settings/page.tsx`): `resolvePageWorkspace(..., "settings")`
`:28` · `resolveMembershipOrThrow` `:29`. Passes the **full `workspace` object**
to `WorkspaceSettingsForm` (`:44`), `WorkspaceTrashSection` (`:47`, slug + id)
and `WorkspaceDangerZone` (`:48`, owner-gated), and renders the header from
`workspace.name`/`workspace.slug` (`:38`).

**API coverage: COVERED.** `GET /api/workspaces/[workspaceSlug]` returns exactly
`{ workspace, role }` (`route.ts:39`) and is already consumed client-side by
`settings-modal/sections/workspace-section.tsx:22`.

**Client hooks:** `PATCH /api/workspaces/{segment}` (`workspace-settings-form.tsx:39`)
· `DELETE /api/workspaces/{segment}` + `GET /api/workspaces`
(`workspace-danger-zone.tsx:29,38`) · `GET /api/oauth/grants` +
`DELETE /api/oauth/grants/{id}` (`connected-apps-section.tsx:29,37`) ·
`GET /api/workspaces/{slug}/trash`, `POST .../trash/restore`, `POST .../trash/purge`
(`workspace-trash-section.tsx:84,111,128`). `RemoteConnect`, `ConnectClients`
and `AgentSkillCard` do **no network** — they build strings from
`window.location.origin` (`remote-connect.tsx:21-26`, `connect-clients.tsx:26-32`,
`agent-skill-card.tsx:22-28`), which in a bundled renderer must come from config,
not `location`.

**Complexity:** the page body is server JSX (must become a client component).
The DELETE route is `sessionOnly: true` (`route.ts:100`) — see the bearer-token
caveat in §1.1. `router.refresh()` at `workspace-settings-form.tsx:58` and
`workspace-danger-zone.tsx:46`; `router.push` on slug change (`:56`).

**PORT DIFFICULTY: easy** — one existing endpoint covers the server props; the
`window.location.origin` MCP-URL builders are the only real thought required.

---

## 15. `/configuration`

**Server fetches** (`configuration/page.tsx`): `getUser()` `:23` ·
`resolvePageWorkspace(..., "configuration")` `:24` — result discarded. Renders
`<ConfigurationView />` with **no props** (`:26`).

**API coverage:** n/a — nothing to serve.

**Client hooks:** **none.** `configuration-view.tsx` is entirely mock-driven
(`:5,33` seeded from `MOCK_GUIDE`), with no `useApiQuery`, no `apiRequest`, and
no `next/*` import. The only `/api/` strings in the feature are literal MCP URLs
inside copy text (`mock-data.ts:28,190`, `seed-content.ts:42`).

**Complexity:** none.

**PORT DIFFICULTY: easy** — copy the tree over; it works as-is.

---

## 16. Gap register — endpoints to build

| # | Gap | Consumer | Suggested shape |
|---|---|---|---|
| G1 | Onboarding gate — `isOnboarded` (`src/features/onboarding/server/service.ts:92`) has no route | `/[workspaceSlug]` root (`page.tsx:28`), `/canvas` boot (`canvas/page.tsx:30`) | `GET /api/onboarding/status` → `{ onboarded }`; or fold into an app-boot endpoint |
| G2 | Default-workspace provisioning — `ensureDefaultWorkspace` (`service.ts:177`) has no route | `/canvas` boot (`canvas/page.tsx:32`) | `POST /api/workspaces/default` → `{ workspace }` (idempotent) |
| G3 | Overview head counts (`overview/page.tsx:29-54`, direct `supabaseAdmin`) | `/overview` | `GET /api/workspaces/{slug}/stats` → `{ workflows, knowledgeBases, skills, members }` |
| G4 | `listBaseOwnerNames` (`service-bases.ts:70`) — no route, page-only | `/knowledge`, `/knowledge/[kbSlug]` | add `ownerNames` to `GET /api/knowledge/bases`, or derive from `/api/workspaces/{slug}/members` |
| G5 | KB slug → base resolution (`resolveKbSegment`, `knowledge/server/segment.ts:30`) | `/knowledge/[kbSlug]` deep link | **Prefer client-side**: match `knowledgeBaseSegment(base)` against the `/api/knowledge/bases` list (the popstate handler already does this, `use-knowledge-v2-controller.ts:326`) |
| G6 | Bearer auth for a *user* JWT — `with-auth.ts:116` assumes any `Authorization` header is an MCP OAuth token; `sessionOnly` routes (`:124-126`) would reject the SPA | every page | Distinct verification branch for Supabase user JWTs; must not set `isMcpCaller` (`:236`) |

G6 is not a page gap but blocks every page; treat it as the first task.

Non-gaps worth naming so nobody rebuilds them: `GET /api/skills` exists **and**
`fetchSkills` (`skills/client/api.ts:58`) is written but unused; `kbTeams` is
derivable from `GET /api/workspaces/{slug}/teams`;
`/api/channels/{id}/await` needs no SPA caller.

---

## 17. Difficulty summary and suggested order

| Page | Difficulty | One-line reason |
|---|---|---|
| `/configuration` | easy | Fully static mock UI, zero fetches, zero Next imports |
| `/skills` | easy | Endpoint + client wrapper already exist; no URL state; four `router.refresh()` → invalidations |
| `/chats` | easy | Server props are already redundant with `/api/chats` + `/api/chats/folders` |
| `/members` | easy | Already 100% API-driven; only the four page props need a client source |
| `/settings` | easy | `GET /api/workspaces/{segment}` covers the server props verbatim |
| `/canvas2` | easy | A single redirect rule |
| `/[workspaceSlug]` root | easy | No UI, but needs the two new boot endpoints (G1, G2) |
| `/overview` | medium | Needs a new stats endpoint (G3) and a server-component body rewritten client-side |
| `/ontology`, `/ontology/[clusterSlug]` | medium | Heavy shared store but no layout persistence; one `replaceState` to port |
| `/canvas` | hard | Layout-persistence choreography (debounce + idle-gate + serializer + unmount flush) on the largest client tree |
| `/workflows`, `/workflows/[workflowSlug]` | hard | Graph engine plus the richest write-ordering and slug-canonicalization logic |
| `/knowledge`, `/knowledge/[kbSlug]` | hard | Real popstate/deep-link contract (kbSlug + `?entryId=`) and the only true RSC-only data gap |
| `/channels` | hard | Four live subscriptions + a poll, consent state machine, and Electron-bridge calls in the UI |

Suggested order — foundations first, then the plan's own ordering, which this
research supports: **G6 (bearer auth) → §1.2 Supabase client → §2 shell →
overview → skills → knowledge → chats → workflows → ontology/canvas →
members/settings/configuration**, with **channels last** (the migration plan
already exempts its agent half from Phase 3 consolidation).
