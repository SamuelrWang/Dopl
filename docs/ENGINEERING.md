# Engineering Guidelines

This document is the source of truth for how code in this repo is organized, named, written, and shipped. It applies to both the ongoing refactor and all future development. When this doc and existing code disagree, this doc wins — and the code is a refactor candidate.

Stack: Next.js 16 (App Router) · React 19 · TypeScript (strict) · Supabase · Stripe · Anthropic SDK.

---

## 0. Philosophy

1. **Feature-first, not layer-first.** A `billing/` folder contains everything billing — UI, server logic, types, hooks — not `components/Billing.tsx` separated from `lib/billing.ts` separated from `types/billing.ts`. A new engineer should be able to delete a feature by deleting one folder.
2. **Files end, not grow.** A file has a single clear purpose. When two purposes show up, split immediately — don't wait for 500 lines.
3. **Boring code wins.** Prefer one obvious way to do a thing. No clever patterns, no premature abstractions, no "future-proof" hooks that aren't needed yet.
4. **The type system is the API.** Strict TypeScript, no `any`, no `@ts-ignore`. Types live next to the feature that owns them.
5. **No dead code and no decorative comments.** If it's commented out, delete it (git remembers). If a comment explains what the code does, rename variables instead.

### Known debt

See [docs/REFACTOR-FINDINGS.md](REFACTOR-FINDINGS.md) for the current list of open findings (`F-NNN` ids) — pruned 2026-07-17 to open-only (resolved entries live in that file's git history). At a glance: files still over the 500-line cap (F-041, §2 table below), deliberate scale deferrals (ontology snapshot F-026, chat pagination F-027), and the CAS token design smell (F-038). Lint debt is ZERO — keep `npx eslint` at 0 errors; the invariant test suites (root `npx vitest run` + `packages/mcp-server` `npx vitest run`) are part of definition-of-done for MCP/tool and service changes.

TanStack Query is now the server-state layer (§7) and every feature's client data hooks are on it — the legacy `useApiGet` / per-feature `useFetch` copies are gone. Don't reintroduce `useEffect + fetch + useState` for mount-time GETs; mutations in event handlers use `apiRequest` (plus a `queryClient.setQueryData`/`invalidateQueries` when a cached list must reflect the change).

---

## 1. Project Structure

```
setup-intelligence-engine/
├── docs/                          # This file, ADRs, runbooks
├── packages/                      # Internal workspace libs (not published to npm)
│   ├── chrome-extension/          # Browser extension (webpack build)
│   ├── dopl-client/               # @dopl/client — shared HTTP client + types
│   └── mcp-server/                # In-process MCP engine; booted by /api/mcp via @dopl/mcp-server/factory
├── public/                        # Static assets
├── scripts/                       # One-off ops scripts (tsx-run)
├── supabase/
│   └── migrations/                # SQL migrations (source of truth for schema)
├── src/
│   ├── app/                       # Next.js App Router (routes + route handlers only)
│   │   ├── api/                   # Route handlers — thin, delegate to features/
│   │   └── ...                    # One folder per route
│   ├── features/                  # Feature modules (see §3)
│   │   ├── analytics/             # System + conversion event loggers
│   │   ├── billing/               # Stripe, subscriptions, access gates
│   │   ├── builder/               # Composite-solution builder UI
│   │   ├── canvas/                # The infinite canvas + panels + store
│   │   ├── channels/              # Cross-user agent-collab rooms (service-role writes)
│   │   ├── chat/                  # Chat panel + tool handlers
│   │   ├── clusters/              # Per-user cluster CRUD
│   │   ├── community/             # Publishing / forking / gallery
│   │   ├── entries/               # Entry rows + search + retrieval + saved
│   │   ├── ingestion/             # Pipeline + skeleton + extractors
│   │   ├── marketing/             # Landing page components
│   │   └── onboarding/            # First-run flow
│   ├── shared/                    # Cross-feature primitives only
│   │   ├── ui/                    # shadcn primitives (Button, Dialog, etc.)
│   │   ├── design/                # Higher-level design components (MarkdownMessage, Orb, ...)
│   │   ├── layout/                # Shells + headers + sidebars
│   │   │   └── app-shell/         # NEW-DESIGN chrome: AppShell (workspace rail + sidebar + titlebar) + AppPanel (white panel with the light token scope). Mounted once by src/app/[workspaceSlug]/(app)/layout.tsx AND by [canvasSlug]/layout.tsx; every workspace page renders inside it. The canvas portals to <body> at z-[31], inset to the shell's white-panel rect via the --app-panel-* vars in globals.css (single-source geometry). Only non-workspace routes keep the legacy layout-shell chrome. Dark/light toggle removed — use-theme is a fixed-dark shim. Clusters are workflows: cluster-info + node panel types, canvas_edges connectors, dock=attach sync, dopl_cluster exposes the workflow graph (see docs/WORKFLOW-BUILDER-PLAN.md).
│   │   ├── lib/                   # Pure utilities (ai, github, slug, utils, http-error)
│   │   ├── prompts/               # Claude prompt templates
│   │   ├── hooks/                 # Generic hooks
│   │   ├── api/                   # parse-json, error-handler (shared route helpers)
│   │   ├── auth/                  # Route wrappers (withUserAuth, withMcpAccess, withAdminAuth)
│   │   ├── supabase/              # Supabase client factories (admin/browser/server)
│   │   └── types/                 # Truly shared types (ApiError, Result)
│   ├── config/                    # Environment, flags, constants
│   ├── types/                     # Residual top-level types (api.ts, entry.ts, ...)
│   ├── middleware.ts
│   └── proxy.ts
├── CLAUDE.md                      # Pointer to this doc
├── eslint.config.mjs
├── next.config.ts
├── package.json
└── tsconfig.json
```

**Rule of thumb:** if a new thing is used by more than one feature, it goes in `shared/`. If it's used by exactly one feature, it goes inside that feature. Never create a `lib/` or `components/` tree at the top of `src/`.

---

## 2. File Size & Splitting

**Hard cap: 500 lines. No exceptions for new or edited files.**

| Threshold | Action |
|-----------|--------|
| **≤ 300 lines** | Target. No action needed. |
| **300–500 lines** | Soft cap. Review for split opportunities during the next edit. |
| **> 500 lines** | **Violation.** Any edit to a file over 500 lines must either (a) split the file in the same PR, or (b) the edit must *reduce* the line count. New files may never be created over 500 lines. |

**Exceptions (file may exceed 500 lines with justification at the top of the file):**
- Auto-generated code (Supabase types, OpenAPI clients).
- Dense type-only files where a split would fragment a cohesive domain model.
- Pure data/config tables (cluster-geometry constants, country lists).
- Single-function switch reducers where the switch is one coherent state machine — splitting by action type fragments the state transitions across files and makes the reducer harder to reason about.

**When you see a large file, split by:**
1. **Responsibility** — one file per "reason to change" (reducer vs. persistence vs. selectors).
2. **Layer** — handler vs. validator vs. service vs. data-access.
3. **Sub-feature** — if the feature has natural seams (per-platform extractors, per-tool handlers), give each its own file.

### Known files that exceed 500 lines

These are allowed under the exceptions above OR scheduled for a future split. If you touch one, either shrink it or split it in the same PR.

Remeasured 2026-07-17 (findings-prune audit — tracked as F-041). Generated `src/shared/supabase/types.ts` and `*seed-fixtures*` data tables are exempt (§2 carve-outs).

2026-07-20: the three consolidated MCP tool files (`tools/knowledge.ts`, `tools/workflow.ts`, `tools/ontology.ts`) were split under the cap and removed from this table. Pattern for these `op`-dispatched tools: the original file stays the thin **registrar** (tool schemas + `op` routing) and delegates each op to a sibling module — `<tool>-ops-read.ts` / `<tool>-ops-write.ts` (+ `<tool>-ops-admin.ts` for destructive soft-deletes), with cross-cutting resolvers/renderers/error-mappers in `<tool>-shared.ts` / `<tool>-render.ts`. Tool names, op enums, schemas, and error mapping are unchanged. Keep the registrar thin when adding ops — new op handlers go in the sibling module, not the registrar.

| File | Lines | Reason |
|------|-------|--------|
| `src/features/skills/components/skill-view.tsx` | 759 | First in queue: extract editor/save-chain hook + header controls (grew with concurrency hardening + metadata CAS). |
| `packages/mcp-server/src/server.ts` | 612 | Borderline: registration + gating core; watch it. |
| `packages/dopl-client/src/client.ts` | 592 | Scheduled: continue per-domain method-group extraction. |
| `src/features/workspaces/server/invitations.ts` | 534 | Over cap: grew with the member-add gate (2026-07-20); split scheduled (F-041). |
| `src/features/teams/server/repository.ts` | 508 | Borderline: watch it. |

(2026-07-16: all `src/features/canvas/**` rows removed — the legacy canvas feature was deleted wholesale; see §7/§8 workflow notes.)

---

## 3. Feature Module Anatomy

Every feature in `src/features/<name>/` follows this shape. Not every feature needs every folder — create them only when there's content.

```
src/features/<name>/
├── components/                    # React components for this feature
│   ├── <feature>-<part>.tsx
│   └── index.ts                   # Barrel ONLY for external consumers
├── hooks/                         # Feature-specific hooks (use-*.ts)
├── server/                        # Server-only code (imports server deps)
│   ├── service.ts                 # Main business-logic service
│   ├── repository.ts              # DB reads/writes (Supabase calls)
│   └── dto.ts                     # snake_case ↔ camelCase mappers
├── types.ts                       # Feature-owned types (camelCase domain)
├── schema.ts                      # Zod schemas for validation
├── constants.ts                   # Feature constants
└── README.md                      # Optional: "what is this feature, what's the data flow"
```

### Rules

- **No sideways imports between features.** `features/chat` imports from `features/canvas` → NO. If both need the same thing, it goes in `shared/`.
- **`server/` folders never run in the browser.** Use `import "server-only"` at the top of `server/service.ts` and `server/repository.ts`.
- **Barrel files (`index.ts`) are the public API of a feature.** External consumers import `from "@/features/chat"` — not deep paths. Internal files import each other by relative path.
- **One service per feature.** If a feature has two services (e.g., current `clusters/service.ts` + `community/service.ts`), merge or clarify the boundary (see §8).

---

## 4. Naming Conventions

These are already 99% consistent in this repo. Codifying them so they stay that way.

| What | Convention | Example |
|------|------------|---------|
| Files | `kebab-case` | `chat-panel.tsx`, `use-panel-ingestion.ts` |
| Directories | `kebab-case` | `knowledge/`, `canvas/` |
| React components (exported name) | `PascalCase` | `ChatPanel`, `CanvasStoreProvider` |
| Functions | `camelCase` | `extractWebContent`, `normalizeTag` |
| Hooks (file + fn) | `use-kebab-case.ts` exporting `useCamelCase` | `use-chat.ts` → `useChat()` |
| Constants (module-level) | `SCREAMING_SNAKE_CASE` | `MAX_LINK_DEPTH`, `CHUNK_SIZE` |
| Local consts | `camelCase` | `const now = Date.now()` |
| Types/interfaces | `PascalCase`, **no** `I`-prefix, **no** `Type`/`Interface` suffix | `Entry`, `IngestRequest` |
| Enums / union type names | `PascalCase` | `SourceType`, `PanelKind` |
| Redux-style actions | `SCREAMING_SNAKE_CASE`, `DOMAIN_VERB` | `PANEL_MOVE`, `CLUSTER_CREATE` |
| API route segments | `kebab-case` | `/api/workflows/[id]/restore` |
| Dynamic route params | `camelCase` in brackets | `[chatId]`, `[panelId]` |
| DB tables | `snake_case`, plural | `canvas_panels`, `workflow_steps` |
| DB columns | `snake_case` | `entry_id`, `created_at` |
| Env vars | `SCREAMING_SNAKE_CASE`, `NEXT_PUBLIC_` prefix for client | `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` |
| Booleans | `is*`, `has*`, `should*`, `can*` | `isPending`, `hasAccess` |
| Event handlers | `on*` (prop), `handle*` (internal) | `onClick={handleSubmit}` |
| Async functions | verb-first; no `Async` suffix | `fetchEntries()`, not `fetchEntriesAsync()` |

### Actions (canvas-store)

Action types are `SCREAMING_SNAKE_CASE`. Most are `DOMAIN_VERB` (e.g., `PANEL_MOVE`, `CLUSTER_CREATE`) but some legacy names use `VERB_DOMAIN` (`MOVE_PANEL`, `CREATE_CLUSTER`). New actions should follow `DOMAIN_VERB`. When touching the reducer, normalize nearby legacy names in the same PR if the diff stays reasonable.

### Known naming inconsistency

`packages/chrome-extension/src/panel/components/*.tsx` uses `PascalCase` filenames (`EntryCard.tsx`, `ClusterBadge.tsx`). The main app uses `kebab-case` (`entry-card.tsx`). Outstanding — rename when the extension next gets touched.

---

## 5. Code Organization Within a File

Standard order for any `.ts` / `.tsx` file:

1. `"use client"` / `import "server-only"` directive
2. Type imports (`import type { ... }`)
3. Runtime imports (external packages, then internal `@/` aliases, then relative `./`)
4. Constants (`const MAX_FOO = 10`)
5. Types defined in this file
6. Zod schemas
7. Helper functions (unexported)
8. Main exported function / component
9. Default export if any (avoid default exports except for Next.js page/layout/route files, which require them)

### Import ordering

```ts
// 1. Server-only / use-client directive
import "server-only";

// 2. External (alphabetized)
import { NextResponse } from "next/server";
import { z } from "zod";

// 3. @/ absolute (alphabetized by path)
import { withUserAuth } from "@/shared/auth/with-auth";
import { createServerClient } from "@/shared/supabase/server";
import type { Entry } from "@/features/entries/types";

// 4. Relative
import { mapEntryRow } from "./dto";
import { MAX_CHUNKS } from "./constants";
```

Enforced via ESLint `import/order` (see Appendix A).

### Comments

Default: **no comments**. Only add one when the *why* is non-obvious:
- Hidden constraint ("Supabase RLS requires this to run as service role")
- Workaround for a specific bug ("Stripe returns `null` here instead of omitting — see issue-123")
- Non-obvious invariant

Never write comments that describe what the code does. Rename the variable.

---

## 6. React Patterns

### Component boundaries

A component should:
- Render **one thing** (a card, a form, a panel).
- Have a clear prop contract — if it takes more than ~7 props, consider splitting.
- Avoid mixing data-fetching, business logic, and presentation. Extract to hooks.

### When to extract

Extract a sub-component when:
- The JSX exceeds ~80 lines.
- There's logic that's only used for one sub-part of the UI.
- You find yourself writing `const FooInner = ...` local definitions — promote to a sibling file.

Do **not** extract just for "reusability" if there's one caller. Extract when there are two.

### Client vs. server components

- **Default to server components.** Only add `"use client"` when the component needs: state, effects, event handlers, browser APIs, or hooks that require them.
- **Push `"use client"` as low as possible.** A page can be a server component that renders a small interactive island.
- **Never** put Supabase service-role keys or Anthropic API keys behind `"use client"`.

### Hooks

- One hook per file: `src/features/<name>/hooks/use-<name>.ts`.
- Hook name matches file name (`use-chat.ts` exports `useChat`).
- A hook that mutates server state should return `{ data, isLoading, error, mutate }` or similar consistent shape.
- No "mega-hooks." If your hook returns more than ~8 things, split.

### Props

- Prefer inline type (`function Foo({ a, b }: { a: string; b: number })`) for components with few props.
- Named props type (`type FooProps = { ... }`) when more than ~4 props or when exported.
- No `React.FC<Props>`. Use function declaration.

---

## 7. State Management

This repo has three layers of state. Keep them separate.

| Layer | Tool | What lives here |
|-------|------|-----------------|
| **Server state** | TanStack Query (adopted 2026-07; provider in `src/shared/api/query-provider.tsx`) | Anything that comes from Supabase or an API |
| **Local UI state** | `useState` / `useReducer` | Form values, open/closed, hover, graph selection |

New client data code uses `useApiQuery` (`src/shared/hooks/use-api-query.ts`) over `apiRequest` (`src/shared/api/api-client.ts` — the single typed fetch wrapper: workspace header, error envelope, 204s). The legacy per-feature `useFetch`/`request<T>` copies are migration targets, feature by feature — do not add new call sites to them. Realtime refetch signals go through `useWorkspaceTablesRealtime` (`src/shared/realtime/`). List endpoints paginate with `Paginated<T>` (`src/shared/types/paginated.ts`) + `parsePageParams` (`src/shared/api/pagination.ts`).

### Canvas & Workflows (post-teardown, 2026-07-16)

The legacy free-form panel canvas (`features/canvas/`, its `/api/canvas/**` routes, the `[canvasSlug]` page, and the `canvas_panels`/`canvas_edges`/`canvas_state`/`canvases` tables) is **deleted**. The "Canvas" tab is now the ontology graph view at `/[ws]/canvas` (`features/ontology/graph/`); `/canvas` survives only as the global redirect (Stripe `?billing=` return URLs depend on it — it forwards query params to `/{ws}/canvas`).

- **Shared graph substrate:** `src/shared/graph/` — generic `SceneNode<T>` + geometry types + the `EdgeLayer` SVG renderer (orthogonal edges, arrowheads, HTML label pills; edge styles injected per domain). Ontology passes `ONTOLOGY_EDGE_STYLES`; workflows pass their sequence/branch styles. Domain layouts stay per-feature (ontology: column-tree `layout.ts`; workflows: layered DAG `features/workflows/graph/layout.ts` — longest-path ranks from indegree-0 entries, barycenter ordering).
- **Workflows are first-class step graphs:** `workflow_steps` + `workflow_step_edges` (edge `condition` = agent-readable branch guard; entry steps = indegree-0; no header concept). Server split: repository / graph.ts `composeWorkflow` (topo-ordered) / authoring-{graph,nodes,edges,refs,shared}. `dopl_workflow` keeps its op surface plus a stateless `op='step'` walk read (paced context disclosure — agent fetches one step's skills/knowledge/branches at a time; no run state in v1). `dopl_canvas` is retired.
- Workflow steps are **not** ontology objects — the free-plan object cap does not count them.

### MCP surface hardening (2026-07-18 audit-fix batch)

A swarm audit of the whole MCP surface drove a batch of fixes (tracked as F-042). Load-bearing outcomes future sessions must know:

- **Packs feature fully removed.** The `dopl_packs` tool, `/api/knowledge/packs/**`, `features/knowledge-packs/`, the `knowledge_packs`/`knowledge_pack_files` tables (drop migration `20260718000010`), the `@dopl/client` pack methods/types, and the `proxy.ts` pack-sync auth bypass are all gone. Don't reintroduce a `dopl_packs` reference.
- **Soft-delete parity.** `dopl_workflow` and `dopl_chats` deletes are now soft (mirroring `dopl_kb`): each has a `deleted_at` column (migrations `20260718000001`, `20260718000002`), a `list_trash` read op and a `restore`/`restore_workflow` write op, and **every** read filters `deleted_at IS NULL` — including the external workflow reads in `features/clusters/server/service.ts` and `features/teams/server/{repository,service}.ts`. `getResourceAccessMeta` intentionally still includes soft-deleted rows (access must resolve for a trash restore). Any NEW read of `workflows`/`chats` must add the `deleted_at` guard.
- **Ontology `delete_cluster` cascade-soft-deletes** (reverses the short-lived "detach" behavior). It stamps the cluster + every object it owns (columns + nested cards) with ONE shared `deleted_at`, and `dopl_ontology(op="restore_cluster")` (a WRITE op) revives exactly that set (objects trashed separately keep their own timestamp). Both cascade delete and restore run inside ATOMIC PL/pgSQL RPCs — `cascade_soft_delete_cluster` / `cascade_restore_cluster` (migration `20260718000040`), mirroring KB's `cascade_soft_delete_base` / `cascade_restore_base` — so a mid-cascade failure can't strand objects (the earlier two-write version could permanently orphan a board). Restore route: `POST /api/ontology/clusters/[clusterId]/restore` (`minRole: member`).
- **30-day trash retention.** `/api/cron/purge-trash` (daily, `requireCronSecret`-gated) hard-deletes rows with `deleted_at < now() - 30d` across ALL soft-delete tables (knowledge, skills, workflows, chats, ontology). It supersedes the old `knowledge-trash-purge` cron (removed). FK cascade handles children; `RETENTION_DAYS` (single source: `features/trash/retention.ts`, imported by both the cron and the aggregator) is the only knob.
- **Unified Workspace Trash (`features/trash/`).** A cross-cutting aggregator over every feature's soft-delete: `features/trash/server/service.ts` (`listWorkspaceTrash`/`restoreTrashItem`/`purgeTrashItem`) fans out to each feature's `listTrashed*` / `restore*` / `purge*` service fns (cross-feature import, precedent = `features/teams`), normalizing to a `TrashItem` shape and dispatching restore/purge by `kind` — each dispatch RE-ENTERS the owning feature's auth gates (KB visibility+agent-delete+team-edit, skills visibility+agent-read-only, chat owner-only, workflow/ontology edit-gate), so aggregation never bypasses per-feature authz. `list` uses `Promise.allSettled` (one feature failing never blanks the page). Routes: `GET|POST /api/workspaces/[workspaceSlug]/trash{,/restore,/purge}` (`minRole: member`). Each feature added a `purge*` (hard-delete of an already-trashed row, `deleted_at IS NOT NULL`-gated, workspace-scoped); ontology purge is the atomic `cascade_purge_cluster` RPC (migration `20260718000060`). The UI is a section on the Settings panel (`features/trash/components/workspace-trash-section.tsx`) with Restore + Delete-permanently (confirm).
- **`agent_write_enabled` is now actually enforced (F-10/F-10b).** The flag (per-base / per-skill) makes a resource read-only to AGENTS (`ctx.source === "agent"`, i.e. an MCP-bearer caller); humans are unaffected. It is checked in `assertBaseWritable` / `assertAgentWriteAllowed` (writes) AND the delete paths, BEFORE the team-access matrix, so read-only wins over team `edit`. Previously the flag was advertised but never read on the write/delete paths. Seeded starter KBs and skills ship with the flag OFF (agent-read-only onboarding content) — set it explicitly in seeds, don't rely on column defaults.
- **Optimistic concurrency everywhere.** `dopl_ontology` object writes now take an optional `expected_version` (= object `updated_at`), sent as `X-Updated-At`, checked via `.eq('updated_at', …)` → 412 `ONTOLOGY_STALE_VERSION` (matches the KB/skills CAS contract). Skill body CAS token moved off a JS millisecond timestamp to a DB microsecond trigger (`20260718000020`).
- **Workspace targeting is fail-closed + legible.** A blank/whitespace `workspace=` now errors instead of silently falling through to the session default (server.ts `wrapped`), and the `_dopl_status` footer reports the **effective** per-call workspace (with a note when it differs from the session default) — not just the session default.
- **MCP-2: the default-workspace fallback is REMOVED (fail-closed resolution).** `resolveActiveWorkspace` no longer resolves a "default" workspace when no `X-Workspace-Id` header is sent — it resolves off ACTIVE memberships (see §9 "Workspace resolution"): exactly one auto-targets; 0 or 2+ → 400 `WORKSPACE_REQUIRED`; a blank/non-UUID header → 400 `WORKSPACE_INVALID`. Consequences future sessions must know: (1) the MCP server boots off `client.listWorkspaces()` (directory), NOT the old `getActiveWorkspace` handshake — 1 membership auto-targets, 2+ leaves no default and the `registerTool` wrapper refuses a no-`workspace=` call listing the choices (M-3); `buildInstructions(directory)` bakes the workspace table + targeting rule into the server instructions (M-2); the footer is mandatory-effective with a source label (`per-call arg` | `sole membership` | `header pin`, M-4). (2) The `set_workspace` meta-tool is GONE (a stateless connection can't persist a switch); `current_workspace` now reports what a no-arg call resolves to (or the 2+ choices). (3) The 4 export GET routes opt into `withWorkspaceAuth({ workspaceIdFromQuery: true })` so header-less downloads keep working. (4) `findDefaultWorkspaceForUser` is now signup-bootstrap + billing-grandfather ONLY — forbidden in auth resolution. (5) UI callers of workspace-scoped `withWorkspaceAuth` routes MUST forward the header (`apiRequest({ workspaceId })`); the Settings trash section and the public pricing page were fixed to do so (a latent "shows the default workspace" trash bug is closed as a side effect).
- **The compiled `dist/` can no longer go stale.** `@dopl/mcp-server` and `@dopl/client` ship committed `dist/` that the app loads at runtime (`serverExternalPackages`). Root `build` now runs `build:packages` (rebuilds both `dist/` from src) before `next build`, so a src change can never ship behind a stale `dist/`. **When you edit either package's `src/`, rebuild its `dist/` (or run `npm run build:packages`) before committing.**

### Realtime & new-workspace seeding (2026-07-17)

- **Realtime:** every content surface streams agent/MCP writes live. Publication covers knowledge_*, skills, skill_versions, workflow_*, ontology_*, chats/chat_messages/chat_folders, channels/channel_members/channel_messages. Per-feature subscribers live in `features/<name>/client/realtime.ts` on the shared `useWorkspaceTablesRealtime` refetch-signal pattern (events trigger a filtered service refetch — never payload merging, so RLS + service filters like the chats retention window stay authoritative). `src/shared/realtime/refetch-coordinator.ts` defers refetches while local debounced edits are pending — any new live surface MUST use it or it will clobber in-flight typing.
- **Loading skeletons:** shared primitives in `src/shared/ui/skeleton.tsx` (`Skeleton`/`SkeletonBar`/`SkeletonLine`/`SkeletonText`/`SkeletonRow`/`TwoPaneListSkeleton`). Every page's loading state renders inside its real `.page-float` shell mirroring the loaded layout — server-fetched routes via `loading.tsx`, client-fetched views in their loading branch. Never ship a bare "Loading…" string or a flat panel.
- **Interactive graph substrate (2026-07-17):** `src/shared/graph/` is the shared layer for both graph pages — `routeEdges` (router v2: geometry-picked sides w/ hysteresis, per-corridor lane fan-out, ≥24px stubs, `SceneEdge.points[]` multi-elbow override, labels anchored off corners), `useNodeDrag` (4px threshold, grid snap, pointer capture, edge auto-scroll), `useGraphPositions` (hybrid layout: stored `layout` jsonb wins per node, auto-layout fills the rest; debounced persist via the lifted `src/shared/lib/merge-scheduler.ts`; `resetLayout()` → `{}`). Positions persist to `ontology_clusters.layout` / `workflows.layout` (web-only concern — never exposed through MCP tool schemas). Drag-to-connect ports + edge condition popover are workflow-feature code (`use-connect-drag.ts`, `graph/ports.ts`) — Canvas deliberately has NO connect affordances (ontology edges derive from data). New graph-y visuals go through the `.graph-*` kit classes in globals.css, never inline.
- **Seeding:** `features/workspaces/server/seed-workspace.ts#seedNewWorkspace` runs at BOTH workspace-creation paths (ensureDefaultWorkspace new-insert branch + createWorkspaceForUser), dependency-ordered (KB → skills → ontology → workflow → chat) so cross-refs use real inserted ids, idempotent on the `dopl-guide` KB slug, best-effort per feature (a failure logs and continues — seeding must never block signup). Content builders are pure (`features/<name>/server/seed.ts`) with insert wrappers (`service-seed.ts`). Seeded rows are ordinary deletable user data. `features/configuration/seed-content.ts` is authored but unwired pending the configuration rebuild.

---

## 8. Data Layer

### The repository / service / handler split

Every feature that touches Supabase has three layers:

```
src/features/<name>/
├── server/
│   ├── repository.ts     # Pure data access. One function per query.
│   │                     # Maps DB rows → domain types via dto.ts.
│   │                     # Takes a SupabaseClient parameter (never creates one).
│   ├── service.ts        # Business logic. Calls repository. Throws domain errors.
│   ├── dto.ts            # snake_case row → camelCase domain mappers.
│   └── errors.ts         # Feature-specific error classes.
└── ...
```

And API routes — use the auth wrappers in `src/shared/auth/with-auth.ts` (`withUserAuth` / `withMcpAccess` / `withExternalAuth` / `withAdminAuth`). Do not invent a new `requireUser`.

```ts
// src/app/api/<feature>/<action>/route.ts
import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { <Action>Schema } from "@/features/<name>/schema";
import { <action> } from "@/features/<name>/server/service";

export const POST = withUserAuth(async (req, { userId }) => {
  const input = await parseJson(req, <Action>Schema);
  const result = await <action>(input, userId);
  return NextResponse.json(result);
});
```

The route handler is **thin**. All logic is in `service.ts`. `withUserAuth` injects `userId`, handles both the session-cookie path and the remote-MCP OAuth-token path (`dopl_at_`), and logs 5xx responses to the system-events telemetry table.

### DTO mapping

Rows come from Supabase as `snake_case`. Domain code uses `camelCase`. Do the conversion once, at the repository boundary:

```ts
// src/features/entries/server/dto.ts
import type { Database } from "@/shared/supabase/types";

type EntryRow = Database["public"]["Tables"]["entries"]["Row"];

export function mapEntryRow(row: EntryRow): Entry {
  return {
    id: row.id,
    userId: row.user_id,
    sourceUrl: row.source_url,
    sourcePlatform: row.source_platform,
    createdAt: row.created_at,
    // ...
  };
}
```

No `snake_case` keys should ever leak past `repository.ts`.

### Clusters vs. community boundary

Two features touch cluster-shaped data. Keep the boundary explicit:

- `features/clusters/server/service.ts` — per-user cluster CRUD on the `clusters` table.
- `features/community/server/` (split into `publish.ts` / `query.ts` / `edit.ts` / `fork.ts` + a barrel `service.ts`) — operates on `published_clusters` rows, exclusively public / fork-related workflows.

If `community` starts needing to read cluster internals, either call `clusters/server/service.ts` through its public API or fold community into clusters as a sub-module (`clusters/server/community.ts`). Don't re-implement cluster reads in community.

### Billing & entitlements (Free / Solo / Team — 2026-07-19; workspace model since 2026-07-16)

Billing is **workspace-level**, not per-user. The per-user 24h trial, `DEMO_PAYWALL_BYPASS`, `PaywallGate`, and the trial-reactivation cron are retired; `profiles.subscription_*` columns remain in the DB but are never written.

- **Plan taxonomy (2026-07-19):** `free | solo | team` (migration `20260719000000_workspace_billing_plan_taxonomy_v2.sql` renamed `pro` → `team`; the string `"pro"` must not appear as a plan value anywhere). **Solo** = $5.99/mo FLAT (`STRIPE_SOLO_PRICE_ID`, quantity always 1), single-member workspaces only. **Team** = $7.99/seat/mo (`STRIPE_PRO_SEAT_PRICE_ID` — env name kept for live-config continuity). Plan copy lives in `features/billing/plans.ts`; all three cards are real (no "contact us" tier).
- **Source of truth:** `workspace_billing` (one row per workspace; plan `free|solo|team`, status `free|active|past_due|canceled`, Stripe ids, `seat_count`). RLS: member SELECT, service-role-only writes (no client write policies). All writes come from the Stripe webhook (`features/billing/server/webhook-handler.ts`, idempotent via `webhook_events`); the webhook derives the plan from the subscription item's price id (solo price → `solo`, seat price → `team`, else `metadata.plan`, else `team` for the legacy grandfather).
- **Team is per-seat:** subscription quantity = active member count, auto-synced by `features/billing/server/seats.ts#syncSeatQuantity` from the membership mutation sites (invitation accept, join-request approve, member remove). Seat-sync acts ONLY on `plan='team'` — a solo (flat) subscription's quantity is never touched. A daily `/api/cron/reconcile-seats` (`CRON_SECRET`-gated, wired in `vercel.json`) trues up any drift between the Stripe seat quantity and live `plan='team'` membership as a backstop to the per-mutation sync. Legacy per-user subs (the $20 price) grandfather to the owner's default workspace via the webhook fallback, as `team`.
- **Solo is single-member:** `assertCanAddMember` (entitlements module) throws `HttpError(402, "SOLO_MEMBER_LIMIT", …, { upgrade_url })` for a live solo workspace, and is called from **all four member-add paths** — `createInvitation`, `acceptInvitationByToken` (stale-invite hole), `requestJoin`, `resolveJoinRequest` approve. Any new member-add path MUST call it. UI catches the 402 and opens `UpgradeModal variant="add-member"`, which for a live solo sub swaps the subscription in place via `POST /api/billing/upgrade-to-team` (price swap + quantity, optimistic local upsert without stamping the event watermark) instead of a second checkout. Backstop: solo entitlements only apply while `memberCount === 1` — a solo workspace that somehow gains a member degrades to free multi-member rules (no exploit value).
- **Checkout:** `POST /api/billing/checkout` takes `{ plan?: "solo" | "team" }` (default team); solo requires exactly one active member (409 `SOLO_REQUIRES_SINGLE_MEMBER`).
- **The gate surface:** `features/billing/server/entitlements.ts` — `getWorkspaceEntitlements`, `assertCanCreateObject`, `assertCanAddMember`, `EntitlementError("over_free_cap")`, `entitlementDeniedBody`. Free rules: solo-member = uncapped; 2+ members = `FREE_MULTI_MEMBER_OBJECT_CAP` (100 ontology objects, creates frozen over cap — reads/edits/deletes never gated); chats visible window `FREE_CHATS_WINDOW_DAYS` (90; hide never delete, via the `chats_retention_cutoff` DB function + service-layer filter in `chats/server/service-reads.ts`). `past_due` keeps paid entitlements; `canceled` reverts to free rules. Ontology's `service.ts` importing the entitlements module is the **sanctioned** cross-feature exception to §3 (it is the designated gate).
- **Plan-gate error envelope:** flat `{ error: <code>, message, upgrade_url }` (codes: `over_free_cap`, `chat_outside_retention`), distinct from the canonical nested envelope; `upgrade_url` always points at `/pricing` (there is no `/settings/billing` route). `@dopl/client` parses it (`upgradeUrl` on `DoplApiError`), the web `apiRequest` (`shared/api/api-client.ts`) surfaces the code when a sibling `message` is present, and the MCP server's `entitlementDenied` guard (`tools/respond.ts` + `runWithEntitlementGuard`) surfaces the message + upgrade link verbatim to agents. Rebuild `packages/dopl-client/dist` after touching its src — the MCP server consumes the built package.
- **Webhook hardening:** `workspace_billing.last_stripe_event_created` is an event-ordering watermark — handlers skip any Stripe event whose `event.created` is <= the stored value (out-of-order `updated` can never resurrect a canceled sub). `invoice.payment_succeeded` only recovers a workspace whose stored subscription id matches the invoice's. `incomplete`/`incomplete_expired`/`unpaid` map to `canceled` (not entitled); `past_due` grace is only for Stripe's literal `past_due`. Checkout blocks whenever a non-canceled subscription exists (409 → portal) and passes an idempotency key. `webhook_events` claiming is atomic (update-where-unprocessed).
- **Retention specifics:** the chats append endpoint returns `messages: []` when the chat is outside a free workspace's window (append allowed, transcript not echoed). Team-scoped chat reads are enforced in RLS too (`20260716150000_chats_team_aware_rls.sql`), mirroring `canSeeChat`. Known accepted gap: an OWNER can still read their own >90-day chats via direct PostgREST — the window is a product gate, not a security boundary (F-035).
- **Client read:** `useWorkspaceEntitlements` (features/billing/components) is the single client-side billing read (TanStack-cached `GET /api/billing/status`); do not add parallel fetch hooks.
- **Instrumentation:** `withWorkspaceAuth` logs every MCP-authenticated op to `mcp_tool_calls` (insert-only, service role; admin SELECT). This feeds future usage analytics — keep the write fire-and-forget.

### Channels (cross-user agent collaboration — 2026-07-25)

**THE MODEL (v3.0 vocabulary, 2026-07-30 — state it this way everywhere).**

> A CHANNEL (or DM) holds many THREADS.
> A THREAD is ONE exchange between two members about one thing. It may be a single message or a long piece of work. It is SHARED: both members see the same thread, its title, and its status.
> A SESSION is ONE member's agent run working a thread, on THAT member's machine. Each side has its own session. A session pauses and resumes; a thread does not. You never see the other member's session, only the messages it sends.

Consequence for copy: inside a member's own window there is exactly ONE session (theirs), so it never needs a qualifier. Never write "agent session" or "channel session" in UI copy.

**N-PARTY SEMANTICS — what is actually true in a channel with more than two members (2026-07-31).** The feature was designed for N and has only ever been exercised as 1:1 DMs, so most of what "everyone knows" about it is a DM invariant. This is the single statement of record: act on it instead of re-deriving it, and if you find it wrong, fix it HERE rather than in a comment somewhere.

- **The DATA MODEL is already correct at N. Do not manufacture schema work for it.** Every channels RLS policy is a set-membership `EXISTS` — `is_channel_member` (`20260725120000_channels.sql:92-105`) feeding `channel_members_member_select` (`:180`) and `channel_messages_member_select` (`:205`) — and **nothing anywhere counts rows**. Consent has **no server-side fan-out**: `createConsentRequest` always writes `operator_user_id: ctx.userId` (`consent-service.ts:107`), i.e. each recipient's own machine raises its own row, which is exactly why the unique key is `(operator, channel, kind, message_seq)` (`20260726140000`) and why it needs no change at N. **The ENTIRE two-party constraint is TWO SCALAR FIELDS:** `metadata.to_user_id` (a jsonb scalar, so multi-address needs NO migration) and `channel_tasks.target_user_id` (a participants join table WOULD need one). Nothing else in the schema is pair-shaped.
- **Addressing is REQUIRED in a group channel: an unaddressed ask triggers NOBODY.** `classify` (`dopl-desktop-app/main/targeting.js`) fires its implicit trigger only on a known-exact `memberCount === 2` **plus** explicit membership (`:68`, `:152`); at three or more the message classifies `fyi` (silent notify) or `ignore`. **This is fail-closed BY DESIGN and it stays.** Never add a broadcast trigger: it converts the loop brake below into a storm, and it mass-prompts operators who were never asked for anything. Multi-address is the answer, and it is not built. The web states the rule in exactly two places, both keyed on `GROUP_CHANNEL_MIN_MEMBERS` (`features/channels/constants.ts`): the composer's send-time hint (`message-composer.tsx`) and the invite dialog's note, shown one member before the count crosses (`invite-dialog.tsx`). Anything else that implies an unaddressed channel message reaches an agent is wrong — "broadcast" is not a shape this product has. **The MCP lane states it in exactly ONE place too: `packages/mcp-server/src/tools/channel-addressing.ts`,** which the `post` note, the `members` closing line and the `dopl_channel` description all read. It was stated three times in three files first, keyed on `is_direct`, and was therefore wrong in all three — a two-member channel opened as a CHANNEL was told its unaddressed messages reached nobody. Its `GROUP_CHANNEL_MIN_MEMBERS` is a deliberate duplicate of the web constant (no shared source tree) and is pinned to it by `channel-addressing-rule.test.ts`. **Two things that copy may NOT say.** (1) That an unaddressed message wakes nobody *as a general rule* — that is only true at three or more. (2) That a THREADED post woke nobody: `feedLiveSession` / `maybeSurfaceRequesterReply` (`listener-messages.js:36-38`) route a first-class (uuid) thread tag into the counterparty's session before `classify` ever reads the addressing, and the old note's remedy — re-post with `to=` — manufactured the duplicate request that re-triggers consent.
- **The LOOP BRAKE is member-count-independent.** An UNADDRESSED **agent-authored** message can never trigger, at any N (`targeting.js:146`). It does not weaken as members are added, so N-party work does not need to re-establish it.
- **A THREAD is one requester + one target. Reads are channel-visible; writes are pair-only.** `listChannelTasks` is unfiltered and gated only by channel visibility (`service-reads.ts:314`), so a third member CAN read a pair's thread — that is today's deliberate design, not an oversight. Writes are refused **403 `TASK_FORBIDDEN`** unless the poster is the thread's `created_by` or `target_user_id` (`isThreadParticipant` / `service-writes-metadata.ts:108`, `:238-244`) — **for a UUID id ONLY.** A legacy `task-{channelId}-{seq}` id skips that gate entirely and is stored verbatim (F-083 bullet 3; audit Q10). Whether reads should stay channel-transparent is an OPEN PRODUCT CALL (audit P1), not a bug to fix on sight.
- **A SESSION binds ONE counterparty, and only a DM can resolve one.** `session-engine.js` stores `counterpartyId` (`:303`) and `feedInbound` accepts turns only from it (`counterpartyFor`, `:420`); `channel-context.js:38` resolves a counterparty **only** when the server's own `isDirect` flag is set. So a group thread has NO counterparty at all: "Open session" paints the no-peer note and seeds no history. Widening this binding from one counterparty to a thread's participant set is planned and NOT built. **A bound counterparty is NOT evidence of a DM**, though — `session-dispatch` binds a requester session to the task's `taskTarget` in any channel — so the session also carries `direct`, plumbed from the same server `isDirect` flag through every launch shape (`trigger.js`, `session-dispatch.js`, `session-park.js`'s three specs) and persisted on the durable record. It exists for ONE statement: in a DM the server addresses an unaddressed post (`resolveDirectPeer`), so the outbound approval card names the recipient (`directChannel` on the post surface → `postDestinationText` / `outboundLabel`); anywhere else it names the channel. Strict `=== true` at every hop — a launch shape that does not carry it understates the destination, never invents one.
- **The session history fence is TWO-PARTY BY DESIGN, and must not be widened before the legacy gate closes.** `pairRows` (`session-history.js:202-212`) drops every row not authored by one of the two parties, in BOTH the rendered window and the agent seed. The fence itself is FIX F4 and is load-bearing: `metadata.taskId` is caller-settable, so relaxing it while a legacy id still skips the participation check re-opens the exact injection F4 exists for. **Sequence: close the legacy-id gate FIRST, then widen.** Separately, the drop is SILENT (a bare `continue` — no count, no notice), which is a real defect and is not the same thing as the fence.

**Not decided, so not built:** multi-address on `metadata.to_user_id`, a thread participants join table, and widening the session's counterparty binding. All three depend on owner calls (audit P1–P3 in `CHANNELS-AUDIT-QUEUE.md`). A wave that needs no migration and no product decision should touch none of them.

**`task` == `thread` at the storage boundary.** The product called a thread a "task" until v3.0, which was wrong (a thread may be a single message). The DOMAIN name is now `thread` everywhere a human or an agent reads: the web types (`ChannelThread` / `ThreadStatus` / `ThreadMode` / `ThreadOutcome`), the components (`thread-panel.tsx`, `useChannelThreads`), the visible copy (Thread active / complete / failed, Close thread, Reopen thread, Open session), and the MCP ops (`create_thread` / `close_thread` / `set_thread_mode` / `list_threads` / `get_thread`). The STORAGE name stays `task` and is deliberately NOT renamed: the `channel_tasks` table and its columns, the `metadata.taskId` / `taskMode` / `taskCreatedBy` / `taskTitle` / `taskTarget` wire keys, the `task_*` message kinds, the `TASK_NOT_FOUND` / `CHANNEL_TASK_NOT_IN_CHANNEL` error codes, and the `/api/channels/[channelId]/tasks/**` route paths. Reason: invisible to humans AND agents, a rename means a migration plus touching every read and write path, and `createTask` still carries an open atomicity bug (F-070). One boundary comment marks the mapping in each of `channels/types.ts`, `channels/client/api.ts`, `channels/hooks/use-channel-threads.ts`, `channels/server/service-tasks.ts`, `packages/dopl-client/src/channel*.ts`, and the `dopl_channel` op handlers. A future round may migrate storage. Server-lane identifiers (`service-tasks.ts`, `mapTaskRow`, `TaskCreateSchema`, `listChannelTasks` in `service-reads.ts`) sit on the storage side and keep the `task` spelling on purpose.

Channels are shared workspace rooms where multiple members' agents (and humans) post to each other. Writes are **exclusively service-role** — the channels tables go a step beyond the older content tables by also *revoking* the base `authenticated`/`anon` DML grants. Three tables (`channels`, `channel_members`, `channel_messages`); each message carries a monotonic per-channel `seq` (`GENERATED ALWAYS AS IDENTITY`) so readers ask for "everything after seq N". Feature module `src/features/channels/**` — chats-style server split (`service.ts` + `service-reads`/`service-writes`/`service-writes-metadata`/`service-tasks`/`service-shared` + `repository`/`dto`/`errors`/`http-mapping`), members-style two-pane UI.

- **RLS write model — stricter than every older table.** `20260725130000_channels_rls_hardening.sql` **REVOKEs INSERT/UPDATE/DELETE on all three tables from `authenticated`+`anon`** and **drops the write policies**; every write is service-role-only through the feature service. Deliberately stricter than the older tables (chats, ontology, knowledge, skills, workflows), which keep their `authenticated`/`anon` DML grants and lean on default-deny RLS alone (bring-to-parity → F-051). Member `SELECT` policies remain for reads (they also feed the realtime publication, §7).
- **Serialized append RPC.** All inserts go through `channel_message_insert` (service-role `EXECUTE` only), which takes a per-channel `pg_advisory_xact_lock` **before** the insert (before `nextval`), so `seq` commits in strict monotonic order under concurrent posters — no gaps or reorderings.
- **Routes** `src/app/api/channels/**` — thin handlers (`/`, `/[channelId]`, `/[channelId]/members`, `/[channelId]/messages`) PLUS a long-poll `/[channelId]/await`. **The wait is TWO LAYERS since WAKE-V1 (2026-07-30) — do not collapse them.** (1) **INNER (unchanged):** the route blocks up to ~50s (`MAX_AWAIT_TIMEOUT_MS`) for a message with `seq >` the caller's cursor, then returns the new messages (or empty on timeout), self-bounded under its own `export const maxDuration = 60` so the function never races the platform limit. (2) **OUTER:** the MCP op `dopl_channel(op="await")` ASSEMBLES a long hold out of those inner polls, re-issued with the SAME cursor (nothing advances until messages actually land, so a re-issue can neither skip nor double-count) until messages arrive or the assembled hold is spent. **Every clock in that chain lives in ONE file — `packages/mcp-server/src/tools/channel-await-budget.ts` — read it before retuning any of them.** The DEFAULT hold is **215s** (`AWAIT_HOLD_DEFAULT_MS`), not the cap: it has to clear every deadline around it so the graceful re-arm RESULT wins the race. An EXPLICIT `timeout_ms` may reach **230s** (`AWAIT_HOLD_CAP_MS`, lowered from 240s by FIX M3 — at 240 the cap plus `AWAIT_HOLD_MARGIN_MS` was exactly the route ceiling, i.e. no margin, and the margin was only ever asserted against the default). **Why a long hold exists at all:** a Claude Code client auto-BACKGROUNDS any MCP call still pending after ~2 minutes and delivers its eventual result as a task notification, and a task notification WAKES an idle session — so a hold that crosses the two-minute mark is the wake primitive that brings the requester's own session back to life with the peer's reply, with no human re-prompt. The hold is env-tunable for incidents: `DOPL_AWAIT_HOLD_MS` (integer ms, clamped to [50 000, 230 000]; anything unparseable → **215 000**, the default), read once at module load, so a hold can be shortened by an env flip instead of rebuilding the committed `dist/`. `resolveAwaitHoldMs` resolves the DEFAULT; `resolveAwaitHoldCeilingMs` resolves the ceiling for an EXPLICIT `timeout_ms` and returns the lever's value when the lever is set, so a caller-supplied maximum cannot route around an incident lever.
  - **`maxDuration` inventory — the only two routes that raise the platform default.** `/api/channels/[channelId]/await` = **60** (covers the 50s inner poll). `/api/mcp` = **300** (covers the 215s outer hold — 230s if a caller asks for the cap — PLUS the boot handshake the route runs before any tool executes). **300 is REQUIRED there and does NOT degrade gracefully:** if the deployment plan clamps it below the hold, the platform kills the function mid-hold and every await comes back as an opaque transport error instead of the timed-out RESULT — and all the re-arm teaching lives in that result text, so the agent gets nothing to act on and cannot tell it from a network blip. Verify the plan supports 300s on deploy; if it cannot, shorten `DOPL_AWAIT_HOLD_MS` to fit under the real ceiling FIRST.
  - **THE 60s CLIENT ABORT, and why `/api/mcp` STREAMS (Q9 / FIX M1, 2026-07-31).** Claude Code wraps every non-GET fetch to a `type: "http"` MCP server in an AbortController that fires after `max(server.timeout ?? 60_000, 60_000)` ms, and that timer bounds **time-to-response-HEADERS**. The route used to build its transport with `enableJsonResponse: true`, which makes the SDK withhold the entire response — headers included — until the tool handler returns, so for us the 60s bound covered the WHOLE call: every long op died at exactly 60.0s (`op="await"`, but also `op="list"` and `dopl_kb` reads — never an await-specific fault). **The flag is gone; the transport is on its default SSE path**, which returns its `Response` synchronously after dispatching the message, so headers flush at t≈0 and the 60s bound covers only the handshake. This is the fix for every client we cannot configure — terminal Claude Code, claude.ai connectors, Claude Desktop, third-party clients. It narrows nothing: the transport already 406s any POST whose `Accept` omits `text/event-stream`, in BOTH modes, so a client that works today already advertises SSE. Session handling is unchanged (stateless, no `mcp-session-id` either way). **Two consequences to keep:** (1) the route must stay on the Node runtime with nothing buffering in front of it — no middleware, no CDN cache — or headers stop flushing and the abort returns; (2) an await holds an OPEN stream that sends no bytes for ~215s, so `src/shared/api/sse-keep-alive.ts` wraps the response and emits an SSE COMMENT every 15s (comments are ignored by every conforming parser, so the decoded frames are byte-identical). The desktop still writes a per-server `timeout` on the two entries it owns, as belt-and-braces — see the next bullet for exactly which, and for the one it deliberately does not write.
  - **THE PER-SERVER `timeout` KEY — where the desktop sets it, and where it refuses to (2026-07-31).** **Version-qualified fact, re-verified against what actually ships:** the desktop bundles `@anthropic-ai/claude-agent-sdk` **0.3.220**, which carries **Claude Code 2.1.220**, and that binary **DOES honour a per-server `timeout`** (declared on `McpHttpServerConfig` / `McpSSEServerConfig` / `McpStdioServerConfig` / `McpClaudeAIProxyServerConfig` as "per-server tool-call timeout in milliseconds; overrides `MCP_TOOL_TIMEOUT` for this server; values below 1000ms are ignored"). Do not restate this as a general Claude Code fact — it is a per-version one, and the honouring changed across versions. **TWO NUANCES, both load-bearing:** (1) the HTTP request abort is computed as `min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647)`, so the key can only ever RAISE the abort above the 60s floor, never lower it; (2) setting it also LOWERS the hard tool-call ceiling from its `1e8`ms (~27.8h) default to that same value. **WHERE WE SET IT — the entries inside our own process, and only those:** the in-app spawn config `userData/mcp-spawn.json` (`main/mcp-config.js` `spawnConfigBody`, passed on every headless spawn via `--mcp-config`) and the SDK session's in-memory `mcpServers` object (`main/sdk-loader.js` `buildMcpServers`). **ONE definition:** `MCP_CLIENT_TIMEOUT_MS` lives in `main/mcp-config.js` and `sdk-loader` imports it — both files used to restate `280_000` and drifted. **The value is DERIVED, not tuned:** `AWAIT_HOLD_CAP_MS` (230s — the longest hold a caller can actually get, via an explicit `timeout_ms`; the 215s DEFAULT is the wrong bound to size against) + `AWAIT_HOLD_MARGIN_MS` (60s) ⇒ **290s**, bounded above by `MCP_ROUTE_MAX_DURATION_MS` (300s). `dopl-desktop-app/test/mcp-client-timeout.test.mjs` pins that RELATION against `channel-await-budget.ts`'s own constants, so moving the cap fails a test instead of silently under-sizing the client. **WHERE WE REFUSE TO SET IT — the operator's `~/.claude.json`.** `main/mcp-cli-entry.js` used to rewrite that file in place after each `claude mcp add`, because the CLI has no `--timeout` flag and the remove+add on every mint destroyed a hand-patched value. **It is deleted (2026-07-31); do not bring it back.** Four reasons: (1) it mutated a file the operator owns and that holds their `oauthAccount` credential block — a disproportionate blast radius for a tuning knob; (2) the reason it existed is gone, since `/api/mcp` streams (commit `c2f6a7e`) and a long `op="await"` hold is no longer 60s of silence to any client; (3) `timeout` also lowers the hard tool-call ceiling (nuance 2 above), which we would have been imposing on the operator's own terminal `claude` sessions without asking; (4) the in-app spawn path already sets it via `--mcp-config`, which IS honoured in 2.1.220 and is entirely inside our process — that is where the fix belongs, and it stays. The `claude mcp add/remove/get` child processes now live in `main/mcp-cli-add.js` (a §2 split of `mcp-config.js`, which sits at the 500-line cap) and they write no config file of their own.
  - **The two timeout caps are deliberately different, not drift.** The MCP tool's `timeout_ms` maxes at **230000** (the TOTAL assembled hold; `AWAIT_HOLD_CAP_MS`, which the schema's `.max()` and the tool description both read — they were three independent literals until FIX M3) while the route's `AwaitQuerySchema` maxes at **50000** (ONE inner poll). Raising the route cap lengthens nothing — it just pushes a single function against its own 60s ceiling — and lowering the tool cap would drop the hold under the two-minute backgrounding mark, silently destroying the wake while every test still passed.
  - **What ONE inner tick costs — the Q8 egress diet (2026-07-31).** The hold loop lives in `channels/server/service-await.ts` (`awaitNewMessages`); the route is a thin adapter. It used to run 3 queries every 1.5s tick — a `select *` message read plus `revalidateAwaitAccess`'s two FULL-row lookups — for the entire hold, and the teaching tells every agent with an open exchange to keep an await armed continuously, so a listening user held ~1.33 queries/sec indefinitely (~2 MB/h of response bodies per armed await, ~99% of it the two access rows nothing reads). Now: **tick 0** is a direct row read (access was just proven by `resolveReadableChannelId`, and the desktop's `timeoutMs=1` wake path is exactly one tick, so probing first would only add a round trip); **every later tick** is an existence probe (`hasMessagesAfter` — `seq > since LIMIT 1`, one column) and full rows are fetched only once it hits; **the access recheck** runs on the first held tick and then every `AWAIT_REVALIDATE_EVERY_TICKS` (10, ~15s bounded staleness) using column-narrowed lookups (`findChannelAccess` / `hasMembership` — never `findChannelById` / `findMembership`, which pull rows the decision does not read). **THE SECURITY PROPERTY MOVED FROM THE CADENCE TO THE RETURN PATH and must stay there.** The invariant, stated exactly (corrected 2026-07-31 by FIX M2 — the older text here said the hold "revalidates unconditionally", which the code does not literally do and never has): **NO FETCH OF MESSAGE ROWS MAY PRECEDE A PROOF OF ACCESS WITHIN THE SAME TICK.** On an existence hit the hold proves access before reading rows, via `verifyAccess`, which skips the query in exactly one case — the periodic recheck already proved access EARLIER IN THIS TICK, so the proof is younger than the probe that found the message and a second identical query could not learn anything. Both paths satisfy the invariant. Never widen that skip to "proven recently": a proof from an EARLIER tick is precisely the one a revocation can have landed after. Response shape, cursor semantics, ordering and limit are byte-identical to before; `service-await.test.ts` pins the security path, the cadence and the contract. One `[await-hold] … polls= revalidations= outcome=` line per hold makes it measurable in prod (`DOPL_AWAIT_DIAG=0` silences it). It is emitted from a `finally` and the counters ride on an object the loop mutates (`AwaitHoldCounters`), so a hold ended by a mid-hold 404 logs too (FIX L6 — it used to log only the holds that finished cleanly, i.e. the wrong half of the population).
- **MCP tool `dopl_channel`** (`packages/mcp-server/src/tools/channel*.ts`) — ops `list` / `open` (create; `open{direct:true, member}` opens a DM, see v1.5) / `invite` / `post` / `read` / `await` / `list_threads` / `get_thread` (both READ) / `create_thread` / `close_thread` / `set_thread_mode` (the three thread-write ops). The five thread ops were named `*_task` until the v3.0 vocabulary round (2026-07-30), which was a **HARD CUTOVER with no aliases** — the old names are gone and a connector must be reloaded. `post` likewise takes `thread=<id>` (it folds into the storage key `metadata.taskId`), not `task=`. `read`+`await` are the listener loop (learn the latest seq, then re-issue `await` from the last seq processed). `@dopl/client` has the matching methods (`listChannelThreads` / `getChannelThread` / `createChannelThread` / `closeChannelThread` / `setChannelThreadMode`) and the parity test is wired. `read`/`await`/`list_threads`/`get_thread` pass the ref straight to the route (no `listChannels` on the poll loop); `invite`/`post` still pre-resolve the channel via `listChannels` (F-055). **The committed `dist/` of both packages is what the app loads at runtime** — after any change here run `npm run build:packages` or the old surface ships.
- **Desktop listener.** `dopl-desktop-app` (Electron 43) runs a channel listener that spawns a local Claude Code session on channel activity via a `dopl://` deep link (§18, F-054).

#### v1.1 additions (2026-07-26)

- **Message addressing.** `dopl_channel(op="post")` takes `to` (email or user-id, resolved to a workspace member exactly like `invite`) + `summary` (one-line intent shown in the receiver's notification). `postMessage` folds them into `channel_messages.metadata` (the fold itself lives in `channels/server/service-writes-metadata.ts` since v2.6) as `{to_user_id, summary}` (jsonb — no schema change). The addressee MUST be an active member of THAT channel or the post is rejected **400 `CHANNEL_ADDRESSEE_NOT_MEMBER`** (`http-mapping.ts`) — otherwise it would target a listener that never sees it. **Anti-spoof:** the service STRIPS the reserved keys `to_user_id`/`summary` from any caller-supplied `metadata` and re-adds them only from the validated top-level fields; a raw metadata copy would otherwise bypass both the addressee-membership check and the schema's summary length cap (consent-prompt spoofing at non-members). **`authorKind` is CALLER-ASSERTABLE, not derived from the credential (corrected 2026-07-30 — the older text here claimed it was derived, and it never has been).** `service-writes.ts` computes `input.authorKind ?? (ctx.source === "agent" ? "agent" : "user")`, so an explicit body value WINS and `ctx.source` is only the fallback. This is load-bearing, not an oversight: the desktop's peer-post path posts results with `authorKind:"agent"` over the operator's **cookie session**, and the web transcript, the desktop `classify()` loop brake, and the "agent for <name>" MCP render all key off that label. What is NOT assertable: `author_user_id` is always `ctx.userId` (identity cannot be spoofed, only the kind label), and `system` is rejected by the route schema (`PostableAuthorKindSchema` = `user | agent`), so a caller can never post an anonymized system-styled row. Treat `authorKind` as a caller-supplied *display/routing* claim scoped to that one user, and never as an authentication fact.
- **Per-member `notify_scope`.** `channel_members.notify_scope` (`all | addressed | none`, default `all`; migration `20260725140000`, LIVE) is a per-`(channel, user)` preference for how loudly a channel notifies THAT member's desktop listener: `all` = consent-prompt messages addressed to them + silent FYI for other members' foreign messages; `addressed` = only addressed messages prompt; `none` = silent — EXCEPT an explicitly-addressed consent prompt, which `none` deliberately does NOT silence (that gate lives in the desktop listener, not the DB; an addressed request must never be dropped). **Self-service only:** `PATCH /api/channels/[channelId]/members` updates only the CALLER's own row (`updateMyNotifyScope`, always targets `ctx.userId`) — any channel member may call it regardless of workspace role; a web bell popover drives it. **Privacy:** `listChannelMembers` (`service-reads.ts`) nulls `notifyScope` on every non-self roster row (a member's scope is theirs alone); the caller's own value rides on `Channel.myNotifyScope`. It is a plain per-row preference — no RLS/grant change, and the `channel_members_workspace_guard` trigger only fires on `workspace_id`/`channel_id` UPDATE, so a scope write never trips it.
- **MCP device-token endpoint.** `POST /api/auth/mcp-device-token` mints a long-lived (90-day, `DEVICE_TOKEN_TTL_S`) `dopl_at_` access token under the reserved first-party client `dopl_client_device_cli` with `dopl.read`+`dopl.write` scopes, for a signed-in user's CLI / desktop listener. It is **`sessionOnly`** (§9) — ALL OAuth bearer tokens are refused (403 `SESSION_REQUIRED`), so a background agent can never bootstrap itself a fresh 90-day credential; only an interactive cookie session can. **Revoke-and-replace per `(user, label)`:** `issueDeviceToken` (`shared/auth/mcp-oauth.ts`) revokes prior same-label mints so a looping client can't accumulate unbounded 90-day credentials. Returned ONCE (`Cache-Control: no-store`; only the hash is stored) and listable/revocable from the settings "Connected apps" grants by label. CSRF assessed not-exploitable (`SameSite=Lax` cookie + no CORS on the route). **Revoke (F-085): `DELETE /api/auth/mcp-device-token`**, body `{ label?, tokenId? }` (at least one required — an empty body is a 400, never a revoke-everything; the selector travels in the body so a hostname label never lands in a URL or access log). Also `sessionOnly`, for the mirror reason: a bearer that could revoke device tokens could kill the credential its sibling agents depend on and delete the row whose `last_used_at` records it. `revokeDeviceTokens` (`shared/auth/mcp-oauth.ts`) scopes every revoke to `(user_id, client_id = dopl_client_device_cli, revoked_at IS NULL)` — an OAuth agent grant is revoked from Connected apps (`revokeGrant`), never here — and is idempotent (unknown/already-revoked ⇒ `{ ok: true, revoked: 0 }`). "Revoked" is a soft `revoked_at` stamp and `validateAccessToken` checks it BEFORE expiry, so the token is dead on its next call.
- **Desktop app → 1.1.0.** `dopl-desktop-app` gained targeting/consent, FYI notifications, an in-app "Sign in to Claude" flow, Dopl-MCP auto-config, and an electron-updater auto-updater (resolves the auto-updater half of F-054). See §18 "Desktop app v1.1".
- **Tests (v1.1).** 50 vitest channel/device-token tests: `channels/schema.test.ts`, `channels/server/{service-writes,dto,service-reads}.test.ts`, and `src/shared/auth/mcp-oauth-device-token.test.ts` (part of the root `npx vitest run` suite). Desktop targeting is pinned by `dopl-desktop-app/test/classify.test.mjs` (node `--test`, 1536-case truth table) — see §18.

#### v1.2 additions — human-in-the-loop consent (2026-07-26)

v1.2 turns consent from a desktop-local dialog into a **server-side row**, so the gate is decoupled from the executor and survives the machine that raised it. Four new tables + a hardening migration, all APPLIED LIVE to prod (`mrefkedvdehahjejreae`). Server split grew a collab lane: `channels/server/{consent-service,trust-service,presence-service,repository-collab,collab-dto}.ts` behind the same `service.ts` barrel; client lane `hooks/{use-consent-inbox,use-trust-rules}.ts` + `components/{consent-card,address-picker}.tsx`.

- **Schema.** `20260726100000_channel_consent_requests` — one row per decision the operator owes; `kind` (`inbound` | `outbound`) discriminates, `status` ∈ `pending | allowed | denied | expired | auto_allowed`, `decided_by` ∈ `web | desktop | trust` is the audit trail, `operator_user_id` = who must decide, `requester_user_id` = who asked (inbound only, `ON DELETE SET NULL`), `workspace_id` denormalized for the Realtime `workspace_id=eq.<id>` filter + the RLS fence. `20260726110000_agent_trust_rules` — per-teammate standing consent, `UNIQUE (operator_user_id, trusted_user_id, workspace_id)`. `20260726120000_channel_agent_tool_profile` — `channel_members.agent_tool_profile` ∈ `full | dopl_only | read_only` (CHECK). `20260726130000_agent_presence` — desktop heartbeat, one row per `(user, workspace)`. **All four follow the channels v1 write model**: `REVOKE INSERT/UPDATE/DELETE` from `authenticated`+`anon`, no write policy, service-role writes only; RLS carries the READ model — consent + trust are **operator-only SELECT**, presence is workspace-member SELECT. `channel_consent_requests` and `agent_presence` are added to the realtime publication (the consent inbox and the online dots are live, not polled).
- **Consent hardening migration `20260726140000_channels_consent_hardening`.** (1) Partial unique index `channel_consent_requests_trigger_key (operator_user_id, channel_id, kind, message_seq) WHERE message_seq IS NOT NULL` — the service de-dupes on read, but read-then-write races the desktop's own crash-recovery replays; without the DB key a denied inbound trigger could be re-raised (and auto-allowed by a trust rule added since), and a retried outbound review could post the same agent reply twice. `operator_user_id` is IN the key because every recipient of one message raises their OWN request against the same `(channel, seq)`. (2) `agent_presence_status_check` pins `status` to `listening | busy | paused | offline` (the heartbeat schema validates the same set — this is the defense-in-depth half, since `status` is a caller-controlled string a later UI will render).
- **The model: approve-in AND approve-out.** `inbound` = a teammate's agent addressed the operator; the operator must Allow/Deny **before** their machine spawns. `outbound` = the operator's own agent drafted a reply; a human must Send **before it leaves the machine**. Because the decision is a row rather than an in-process promise, the same request is answerable on **either** the web card or the desktop's native dialog — **first answer wins**.
- **Trust is evaluated SERVER-SIDE ONLY.** `createConsentRequest` looks up the rule and returns the row already born `auto_allowed` (`decided_by='trust'`, no `expires_at`); the desktop keeps NO local trust cache (a stale cache let a just-revoked rule still auto-allow, and worse, made the desktop PATCH a still-pending row as `decided_by='web'` — a fabricated human decision). Trust is re-checked against live workspace membership, never the rule alone. `auto_allowed` rows are recorded precisely so the audit filter (`status=decided|all`) can answer "your agent ran N times without asking you".
- **Routes** (`src/app/api/channels/**`, all thin, all `withWorkspaceAuth`): `GET/POST /consent` (inbox, default filter `pending`; create), `GET/PATCH /consent/[id]` (desktop status poll; decision), `GET/POST/DELETE /trust`, `POST /presence`. `agentToolProfile` rides the existing self-only members PATCH (`updateMyMemberSettings`, same route as `notifyScope`). Operator-only is enforced in the service (`requireOperatorRow` collapses missing / foreign-operator / cross-workspace into ONE 404 so ids can't be probed); the operator is ALWAYS `ctx.userId`, never read from the body.
- **SECURITY — `PATCH /consent/[id]`, `POST /trust`, `DELETE /trust` are `sessionOnly` (§9).** This is the load-bearing rule of v1.2, and the reason is concrete: the desktop passes a 90-day `dopl.read`+`dopl.write` device token to **every** spawned agent via `--mcp-config`, that agent's entire job is to process an **untrusted teammate's message** (a prompt-injection target), and it has Bash. Without `sessionOnly` it could read the token off disk and PATCH `{decision:"allow"}` on its OWN outbound review — approving its reply out of the machine with no human in the loop, i.e. defeating the exact gate approve-out exists to be. `POST /trust` is worse than any single Allow (standing consent retires the gate permanently); `DELETE /trust` is gated for the mirror reason (an agent must not silently drop a rule the human relies on). **`GET` stays open on both** — polling and reading decide nothing, and the desktop's cookie-authenticated GETs must keep working. Pinned by `src/shared/auth/write-gate-coverage.test.ts`.
- **Decisions are compare-and-swap.** The dual-surface design is *explicitly* multi-writer, so the pre-read is authorization-only and the write is a CAS on `status = 'pending'`. A losing writer gets **409 `ConsentAlreadyDecidedError`**, re-read so the error names the status that actually won — a human's Deny must never be clobbered by a late Allow arriving from the other surface. The desktop treats its own 409 as a settled decision, not a failure (no retry).
- **De-dupe + expiry.** The service de-dupe key matches the DB index — `(operator, channel, kind, message_seq)` at **ANY** status, deliberately: a denied trigger must never be re-raisable. A 23505 on insert converges by re-reading the winner. `expireStalePending(userId)` runs **before** every de-dupe read / list / get / decide, so an elapsed row is read as `expired` and never handed back as a live `pending` prompt (`CONSENT_TTL_MS` = 30 min in v1.2, raised to **24h** in v1.4 — see below; presence online window `PRESENCE_ONLINE_WINDOW_MS` = 90s). Expiry is lazy with no cron and emits no realtime event → F-064.
- **Tests (v1.2).** Root suite at **465 green**; new/extended: `channels/server/consent-service.test.ts`, plus schema/dto/service-reads/service-writes coverage for the new surfaces, and the `sessionOnly` set pinned in `write-gate-coverage.test.ts`. Desktop containment is pinned by `dopl-desktop-app/test/tool-profiles.test.mjs` (§18).

#### v1.4 additions — durable async consent (2026-07-27)

v1.4 makes the consent gate **durable and async** instead of a blocking in-process wait: the desktop creates the consent row and returns, and a human may answer it minutes-to-hours later from the web Pending Requests list or a notification. The desktop half is §18 "Desktop app v1.4"; the server/web pieces:

- **`CONSENT_TTL_MS` raised 30 min → 24h** (`features/channels/constants.ts`). The v1.2 gate assumed a decision within minutes (a spawn blocked on it); v1.4 lets a request **park**. The server's lazy pending-expiry (`expireStalePending`) must therefore not sweep a legitimately-parked request out from under the desktop watcher, so the ceiling was raised to 24h. Expiry is still lazy-only, no cron (F-064 unchanged — now a 24h window, not 30 min).
- **Decision echo — the requester sees the outcome live.** Each decision emits an ordinary lifecycle `channel_message` so the OTHER member's thread updates without reading the consent row (which is operator-only SELECT, §8): accepted → `task_started {taskId}`; declined → `task_failed {taskId, declined:true}`, body "Request declined"; a cancelled outbound draft → `task_failed {dropped:true}`; an interrupted spawn → `task_failed {interrupted:true}`. **These are NOT errors.** The web renders declined/dropped/interrupted **CALM** (not the red error style): `group-thread.ts#computeStatus` and the render path (`session-card` / `activity-event-row`) branch on **STRICT `metadata.<flag> === true`** checks, so a *bare* `task_failed` (no flag) stays the genuine-error path. Do not loosen these to truthy checks — a truthy coercion would paint real failures calm.
- **Web pending requests, at the bottom of the thread.** The operator's own `pending` consent rows (the same `GET /consent` inbox) render as `consent-card.tsx` cards INSIDE the channel scroller, after the last message and before the composer (`channel-thread.tsx`), so a new request reads as the newest row in the chain and scrolls with the history. The v1.4 fixed `pending-requests-panel.tsx` band above the transcript is **deleted** (v2.4 UI polish); the workspace-wide sidebar badge is unchanged and stays the cross-page signal. Leaving a request undecided still parks it (the row stays `pending`, answerable until the 24h TTL). This surface is the backstop for a missed or failed notification action (F-067).

#### v1.5 additions — first-class tasks, direct channels, engagement mode (2026-07-27)

v1.5 promotes a thread ("task" in the v1.5-era vocabulary) from a message-derived heuristic to a **first-class row**, adds 1:1 **direct channels** on the same stack, and introduces a per-thread **engagement mode** so a live thread's replies can land as passive notifications on the requester's machine instead of raising a fresh consent prompt every turn. Built + reviewed + fixed same day; uncommitted at time of writing. Two migrations, both **APPLIED LIVE to prod** (`mrefkedvdehahjejreae`): `20260727140000_channels_direct` then `20260727150000_channel_tasks`. Server split gains `server/repository-tasks.ts`; new `hooks/use-channel-threads.ts` (`use-channel-tasks.ts` before v3.0), `lib/channel-display.ts`, `components/direct-message-dialog.tsx`. The desktop half is §18 "Desktop app v1.5".

- **First-class threads (`channel_tasks` — storage name).** A thread is one titled, mode-tagged exchange inside a channel; its transcript still rides on `channel_messages` (`metadata.taskId = channel_tasks.id`), but the row is the authoritative store. Columns: `status ∈ open | closed`, `outcome ∈ completed | failed` (CHECK `closed ⇔ outcome IS NOT NULL`), `mode ∈ interactive | autonomous` (default `interactive`), `created_by`, `target_user_id` (the addressed responder, `ON DELETE SET NULL`), `title` (1–200 chars), and denormalized `channel_id`/`workspace_id` (for the Realtime workspace filter + the RLS fence + the reused v1 `channel_child_workspace_guard`, which fires only on `workspace_id`/`channel_id` UPDATE so a status/mode bump never re-trips it). Follows the channels v1 write model exactly — `REVOKE INSERT/UPDATE/DELETE` from `authenticated`+`anon`, service-role writes only, RLS carries the read model (workspace fence + public-channel-OR-member, mirroring `channel_messages`); added to the realtime publication. **Why a table, not pure message-kinds:** an interactive thread is multi-turn and long-lived — `status` stays `open` until an explicit `close_thread` and cannot be derived from lifecycle markers alone (a mid-flight thread with agent replies would wrongly read "done" under the old message-only heuristic).
- **Coexistence with old `task-{channel}-{seq}` ids.** `metadata.taskId` stays an opaque string in `group-thread.ts`; old desktop spawner ids (`task-<channelUUID>-<seq>`) and new first-class UUID ids group identically. **Only NEW first-class threads have a `channel_tasks` row.** The web overlays authoritative status/title/mode ONLY for taskIds present in the threads map (`useChannelThreads` → `Map<taskId, overlay>` into `groupThread`); every other group falls back to the existing lifecycle-derived status — zero behavior change for old terminal-mode sessions (an old `task-…` id is not a UUID, so it never resolves to a row).
- **Thread routes** (`src/app/api/channels/[channelId]/tasks/**` — the `/tasks` path is a storage name and is deliberately unchanged; thin `withWorkspaceAuth`, `minRole:"member"` on writes; the GETs default to `viewer`): `GET /tasks` (list, `list_threads`) + `POST /tasks` (`create_thread`, 201), and `GET /tasks/[taskId]` (`get_thread`, added v1.8) + `PATCH /tasks/[taskId]` (a discriminated union: `{op:"close", outcome}` OR `{op:"set_mode", mode}` OR `{op:"reopen"}`). **NOT `sessionOnly`** — deliberately agent-reachable: thread ops are agent actions invoked via the MCP device token and MUST reach the API (contrast the human-decision `PATCH /consent/[id]`, which stays `sessionOnly`). Authorization is service-enforced: `getChannelTask`/`listChannelTasks` = same read-visibility gate as the transcript (a task not in this channel → 404, id unprobeable); `createTask` = channel member + `toUserId` an active channel member (reuses `CHANNEL_ADDRESSEE_NOT_MEMBER`); `setTaskMode` = **creator only** (mode governs the creator's own machine); `closeTask` = creator **or** target. `requireTaskId` added to `shared/api/channel-route.ts` alongside `requireChannelId`/`requireConsentId`.
- **Three `dopl_channel` write ops** (added v1.5 as `create_task`/`close_task`/`set_task_mode`; renamed in the v3.0 hard cutover). `create_thread` (`channel`,`title`,`body`,`to`, optional `mode`), `close_thread` (`channel`,`thread`,`outcome`), `set_thread_mode` (`channel`,`thread`,`mode`) — added to the op enum, `WRITE_OPS.dopl_channel` in `server.ts`, and the tool description (the parity test requires the new op + `direct` param substrings). `READ_OPS` is unchanged (the three are writes); **no new tool**, so the parity expected-tool-names list is untouched and `KNOWN_*_DRIFT` stays empty. `open` also gains a `direct` branch (below).
- **Reserved-metadata stamping expands to the task keys.** The v1.1 anti-spoof fold (server strips reserved keys from caller `metadata`, re-adds from validated fields) now also governs **`taskMode` / `taskCreatedBy` / `taskTitle` / `taskTarget`**: when a posted message's `metadata.taskId` resolves to a `channel_tasks` row IN that channel, `postMessage` strips any caller copy of those four keys and re-stamps them fresh from the task row (`service-writes-metadata.ts` since v2.6). `taskId` itself stays **caller-settable** (a responder agent legitimately sets it to reply within a task); spoofing `taskId` alone cannot fabricate a mode because the server only stamps when the id resolves to a real task in that channel, and it stamps fresh at post time so the value reflects the latest `set_thread_mode`. **`taskTarget` (the task's `target_user_id`) is load-bearing for the desktop:** it binds the task-reply suppression to the real responder so a third member posting into someone's task still triggers a normal consent prompt (§18 v1.5). A null target (unaddressed task) stamps nothing, so the desktop predicate can't match and falls through to the trigger rules. **WAKE-V1 adds `runtime` to the reserved set (2026-07-30):** caller `metadata.runtime` is stripped like any reserved key and re-stamped as `'desktop-session'` ONLY when the request carried the exact header `X-Dopl-Runtime: desktop-session` (`src/shared/auth/runtime-header.ts` → `resolvePostMetadata`, the single stamping point; the `/api/mcp` route forwards the caller's value onto the loopback). Absent/blank/near-miss → no `runtime` key at all, which reads as "external". **It is a ROUTING HINT, never an authorization signal** — any holder of a device token can set that header, so the stamp attests nothing about WHO called. Nothing may grant access on it; the one consumer (the desktop requester-window gate, §18 v1.9) is safe because it fails CLOSED and because the conjuncts that carry identity sit beside it. Both desktop spawn paths send it: `sdk-loader.buildMcpServers` (SDK sessions) and `mcp-config.spawnConfigBody` → `mcp-spawn.json` (headless CLI spawns).
- **Direct (1:1) channels.** `channels.is_direct BOOLEAN` + `channels.direct_key TEXT` (the two member user-ids sorted and joined `a:b`), with a **partial unique index** `UNIQUE(workspace_id, direct_key) WHERE is_direct` and a `channels_direct_shape` CHECK (a direct channel is `visibility='private'` + carries a `direct_key`; a normal channel carries none). No RLS change — a DM is private, already covered by `channels_member_select`; DMs reuse the ENTIRE message/consent/task stack unchanged. **Dedup + revive:** `createDirectChannel` looks up `(workspace_id, direct_key)` before insert (idempotent "open existing"); because the partial unique index counts a soft-deleted row, a repeat open of a previously-deleted DM must **find the hidden row and revive it** (`findDirectChannelIncludingDeleted` → `reviveChannel`) rather than insert a second that would violate the index. **Delete of a DM is hide-until-reopened** — `deleted_at` hides it from active reads but the history survives a delete/reopen cycle. A self-DM is rejected (`DirectSelfTargetError`). The rendered peer is resolved LIVE from the roster into `Channel.directPeer` (`{userId, displayName, avatarUrl}`) — never stored as truth; `name`/`slug` are stored NOT NULL but the UI ignores `name` for DMs (`channelDisplayName` in `lib/channel-display.ts`). Web adds a "Direct messages" sidebar section, peer-name/avatar rows, `direct-message-dialog.tsx`, and a `+` menu (New channel / New direct message).
- **DM membership + visibility are IMMUTABLE.** Inviting into, removing from, or changing the visibility of a direct channel throws `DirectChannelImmutableError` → **400**. The UI hides the invite affordance + the visibility toggle for DMs and labels delete "Delete conversation". The rule protects the two invariants a 1:1 room rests on: its `direct_key` identity (the dedup fence) and the live peer resolution — letting membership drift would break both.
- **Engagement mode — interactive suppression THIS round, autonomous continuation NEXT.** A thread's `mode` (`channel_tasks.mode`) governs how the **requester's** desktop treats an inbound reply to a thread it opened. `interactive` (default) → suppress consent/spawn for that reply and show a passive notification instead (§18 v1.5 `task-reply` verdict); the human stays in the loop by reading, not by re-approving each turn. `autonomous` is accepted and stored but behaves as today — **auto-continuation is deliberately NOT built this round** (F-070). It is the next round's work: thread-scoped standing consent + per-thread `--resume` + turn caps. Research fact behind that design (empirical, claude 2.1.220): a `--resume` from a second process **continues the session in place** — no fork unless `--fork-session` is passed; `--session-id` can preset ids; cross-cwd resume fails; two concurrent same-id resumes soft-fork (the existing one-active-spawn-per-channel guard already prevents that).
- **Thread cards + presence + timestamps (web).** `groupThread(messages, taskOverlays?)` — ANY row (human OR agent) whose `metadata.taskId` is a non-empty string joins that thread's group (the human request now groups into the same card), with the open-`task_started` fallback window kept only for no-taskId agent replies; the overlay from `useChannelThreads` supplies authoritative status/title/mode, else the group falls back to the derived `computeStatus`/`computeSummary` (a no-map call is byte-for-byte the old behavior). The thread card shows the thread title, nests every message of the exchange **attributed** (author + avatar + absolute time), and moves the status chip to the card END (`Thread active | Thread complete | Thread failed` since v3.0). The presence strip now lists ALL members in a stable `joinedAt→userId` order with "N online" copy; the online **ring lives ONLY in the strip** — removed from every transcript surface (bubbles + task cards use a plain `Avatar`, not `AvatarWithPresence`). All five channel timestamp sites switch to absolute `formatChannelTimestamp` (`shared/lib/format-time.ts`: same calendar day → `"2:34 PM"`, else `"Jul 26, 2:34 PM"`, null → `"—"`).
- **v1.9 (Session Window — SDK-driven collaboration sessions).** The desktop no longer answers cross-user collaboration with a headless `claude -p` spawn: it drives a Claude Agent SDK session in a native Electron window the operator watches. Main-process `session-engine.js` owns one `query()` per session with a push-based AsyncIterable prompt; the channel listener feeds the counterparty's replies in as user turns (no MCP-await blocking); the agent posts its own replies/milestones via `dopl_channel` (op-scoped and GATED, see the correction below). A responder window opens on approve-in; a requester window auto-opens when my own `create_thread` addressed to a peer lands (`targeting.requesterTaskOpen`). **Gating corrected + tightened (WAKE-V1, 2026-07-30): `author === me` AND `metadata.runtime === 'desktop-session'`** (plus the first-class task id, `taskCreatedBy === me`, and a target that is a peer). The runtime conjunct exists because an EXTERNAL Claude Code session now awaits its own reply (§8, the long MCP hold): auto-opening a desktop window for a thread that session created put two agents on one thread and let the window consume the reply the waiting session was armed for. Unstamped never opens; the reply reaches the external agent through its await, with this machine's passive path (classify `task-reply` → the silent banner) as the local fallback. **The stamp is a routing hint, not authz** (§8, `runtime-header.ts`) — it is safe here only because the predicate fails CLOSED and the identity conjuncts beside it are the real bound. A refusal that turns ONLY on the stamp emits a `diag()` line naming what it saw (`session-dispatch.js`), because that is otherwise indistinguishable from the expected external case and is the sole symptom of a server/desktop version skew. Renderer is `loadFile`-only, contextIsolation + sandbox, CSP `default-src 'none'`, every untrusted string via `textContent`; session IPC binds the session from `webContents` (never a renderer-supplied id). Permissions surface as in-window buttons via the SDK `canUseTool` callback (Allow once / Allow for this task / Deny) — this REPLACES the old approve-out modal for window runs; terminal mode is retired. Settings toggle "Run sessions in a window" (default ON); OFF falls back to today's headless + approve-out path byte-for-byte. Version 1.6.0; the SDK ships a ~256 MB platform binary (`asarUnpack` + `pathToClaudeCodeExecutable` asar→asar.unpacked rewrite). SECURITY MODEL (load-bearing — the session processes untrusted counterparty content with real tools): (1) the shadow rule — a tool in SDK `allowedTools` is auto-approved and never reaches the button, so ONLY safe-by-construction tools are pre-approved (local reads). **CORRECTION (2026-07-30) — this bullet used to end "and `dopl_channel` ONLY when `op=post` into the session's OWN channel", which has been FALSE since v2.5 D2. `dopl_channel` is in NEITHER `allowedTools` NOR `disallowedTools` on ANY profile (FIX H1), so EVERY channel op reaches `canUseTool`, own-channel `post` included; `isOwnChannelPost` now only picks which op-scoped grant KEY a post belongs to, it does not auto-allow. Do not re-derive the old rule from this paragraph: pre-approving own-channel `post` is exactly the cross-user exfiltration path H1/D2 closed (a read_only session could Read a local file, then post its contents to a peer with no operator click). Since v2.9 the only thing that can send a post without a click is the operator's own Axis-B Messages posture (`ask | auto_inbound | auto_outbound | auto_both`), resolved in our gate — never in SDK `permissionMode`, never via `allowedTools`.** (2) `settingSources:[]` + `permissionMode:'default'` + a scrubbed `options.env` (strip `^(CLAUDE_CODE_|ANTHROPIC_).*(PERMISSION|BYPASS|ACCEPT_EDITS|DONT_ASK|SKIP_PERMISSIONS|AUTO_APPROVE|DANGEROUS)`) so no ambient config can flip the gate; (3) session `full` HARD-DENIES (`disallowedTools`) the delegation/persistence/exfil/escalation subset — Task, Agent, TaskCreate, SendMessage, RemoteTrigger, Cron*, ScheduleWakeup, Monitor, *Worktree, Skill, ToolSearch, the six `dopl_*_admin` — because a one-click task-grant on a watched window can outlive it and subagents do NOT inherit the parent's `canUseTool` bound; only Bash/Write/Edit/NotebookEdit/WebFetch stay live-gated; (4) permission decisions fail CLOSED in the main process (only explicit allow-once/allow-task allow; unknown → deny); (5) `feedInbound` only accepts turns from the session's stored counterparty. Loop safety = turn cap 24 + idle TTL 15m + cost cap + the visible window + Stop (F-076). See F-078 for residual notes.
- **v1.7 (counterparty identity + task threading convergence + milestones).** Motivating incident: a spawned responder asked the REQUESTING agent to grant a machine-local tool permission — it treated the counterparty agent as its own operator. (1) Desktop spawn prompts now carry counterparty framing OUTSIDE the nonce fence (`main/prompt-framing.js`, pure/testable): the author is another member's AI agent, not your operator; machine-local blockers (permissions, folders, sign-in) are reported to YOUR OWN operator and stated as "my side is blocked", never as an ask for the counterparty. `sanitizeName` guards every interpolated identity string (fence-token strip, newline collapse, 80-char cap — display names are counterparty-controlled). (2) MCP `read`/`await` label agent authors "agent for <name>"; `CHANNEL_DESCRIPTION` documents the thread protocol (create_thread once, thread every post with `thread=<id>`, post `task_progress` milestones as accomplishments land, requester `close_thread` with a `summary` when the GOAL completes). (3) `post` threads `thread=<id>` SERVER-VALIDATED (unresolved UUID → 400 CHANNEL_TASK_NOT_IN_CHANNEL; legacy `task-<uuid>-<seq>` ids bypass); the desktop reply + lifecycle INHERIT an inbound first-class task id (UUID-gated, persisted across restarts) so both sides land in one card. (4) `channel_tasks.outcome_summary` (migration 20260728020000) set via `close_thread summary`, echoed in the terminal event body; blank stores null. Web renders `task_progress` entries as a check-marked milestone list inside the card (`splitSessionEntries`, render-layer only), the latest milestone under each thread-panel row, and the outcome summary by the status chip.
- **v1.6 (message/thread differentiation + receipts, client-only).** ZERO server/schema/MCP/desktop changes. Composer gained a Message | Task mode selector: Message = optional one-liner + body (summary rides the existing `metadata.summary`, now web-settable at parity with MCP); the thread branch used the `createChannelThread` client fn (`createChannelTask` before v3.0). DM sends now AUTO-ADDRESS the peer (`to_user_id` = directPeer) — this flips DM triggering from implicit-2-member to explicit-addressed on the desktop (accepted delta: explicit always prompts, `notify_scope='none'` no longer mutes a DM ask) and lets DM exchanges group via the pair-join heuristics. Messages with a summary render summary-prominent (body collapsed behind a chevron). Per-channel thread panel (header popover, `thread-panel.tsx`, `ThreadPanel`) lists threads from `useChannelThreads`; clicking scrolls to the `id="session:{taskId}"` card anchor (the DOM id keeps the storage key) with a transient highlight. RECEIPTS: `lib/message-receipt.ts` `deriveMessageReceipt` — a pure client-side status line on MY outgoing addressed messages (Sent / Accepted-working / Replied / Declined / Failed / Interrupted / Reply-not-sent) derived ONLY from existing thread events; the no-taskId pair-reply binds to the NEAREST preceding ask (one reply never marks stacked earlier asks "Replied"); deliberately NO "Received"/"Read" status — the desktop does not ack and fabricating one would lie (a low-frequency ack is future work, F-073). F-072 rule held: no new per-read writes, no realtime publication changes.
- **Legacy exchange grouping (post-v1.5 fix round).** Two bounded heuristics in `groupThread` make a no-`create_thread` exchange read as ONE card: (1) **seq-N backfill** — a started session whose taskId matches `task-<thisChannelId>-<N>` pulls the standalone seq-N message in as its opening entry when that message's `to_user_id` equals the responder (sessions with no `task_started`, e.g. lone decision echoes, are never touched); (2) **pair-join** — while a session is open (started, non-terminal), an addressed no-taskId `message` whose `{author, to_user_id}` ⊆ `{requester, responder}` joins the card; a third-party message terminates the window, and a **responder-authored** pair-joined reply also spends the window (so a dropped `task_finished` can't let the next exchange's opener be absorbed). Both are gated strictly on `metadata.to_user_id` — transcripts without addressing metadata group byte-for-byte as before. `computeStatus`'s delivered-reply→Done rule requires `authorKind === "agent"` so a joined human follow-up can't mark a thread done. DMs: the composer hides the address picker when `channel.isDirect` (implicit 2-member targeting still triggers the peer's desktop); thread-card messages are individually collapsible (chevron per entry, header always visible, state keyed by stable message id).

#### v1.8 additions — MCP thread-read + create_thread idempotency (2026-07-28)

Five robustness gaps in the `dopl_channel` MCP tool, so an agent can reliably drive cross-user task collaboration. No web/desktop changes; MCP + client + one service change + one migration. Migration `channel_tasks_client_msg_id` **APPLIED LIVE to prod** (`mrefkedvdehahjejreae`).

- **Thread READ ops.** `list_threads` (`channel`) and `get_thread` (`channel`,`thread`) — the first way to enumerate/inspect threads over MCP (previously agents could create/close by id but not discover them). `list_threads` reuses the existing `GET /tasks` + `listChannelTasks` (server lane, storage name); `get_thread` adds `GET /tasks/[taskId]` + `getChannelTask(ctx, channelId, taskId)` (404 for a thread not in the channel — id unprobeable). `@dopl/client` gains `listChannelThreads`/`getChannelThread`; handlers `opListThreads`/`opGetThread` render readably (thread list / detail block) through the `_dopl_status` footer. Both are **READS** — added to `READ_OPS.dopl_channel` in `parity.test.ts` (NOT `WRITE_OPS`, NOT `sessionOnly`); `KNOWN_*_DRIFT` stays `{}`.
- **`create_thread` idempotency.** `create_thread` accepts `client_msg_id` (like `post`). Server-side dedup mirrors `channel_messages`: nullable `channel_tasks.client_msg_id` + partial unique index `(channel_id, client_msg_id) WHERE client_msg_id IS NOT NULL`; `createTask` (`service-tasks.ts` since v2.6) returns the existing task on a `client_msg_id` hit (and on a 23505 insert race) **without re-posting the initial request** — so a retried create can't double-create the row OR double-spawn the responder window. Wired through `TaskCreateSchema`, `POST /tasks`, `repository-tasks.findTaskByClientId`, `@dopl/client.createChannelThread`, and `opCreateThread`.
- **`post task=` error mapping.** `opPost` (`channel-ops-write.ts`) now catches `isBadRequest` **independent of `to`**: an unresolvable `task=<uuid>` with no `to` previously rethrew the raw `CHANNEL_TASK_NOT_IN_CHANNEL` 400; it now maps to "That task is not in this channel — check the task id, or post without `task`."
- **PEER-AUTHORED TEXT IN `dopl_channel` RESULTS — the one rule, and the module that owns it (Q1, completed on the WRITE side 2026-07-31).** A tool result has TWO ZONES. Message **bodies** are the zone `UNTRUSTED_BODY_HEADER` explicitly disclaims. **Everything else — headings, bullet heads, author labels, the legend, every confirmation and every error line — is read by the model as NARRATION BY THE SERVER**, and any peer-authored string spliced there is read as ours. The rule: **every peer-authored string that reaches a result goes through `neutralizeInline` / `inlineOr` in `packages/mcp-server/src/tools/channel-shared.ts`. ONE definition — do not add a second neutralizer, and do not decide per site whether a value is "really" attacker-reachable.** That per-site judgement is exactly what left `opCloseThread` rendering a raw `**${thread.title}**` through a whole audit: closing is permitted to the thread's TARGET, so the ordinary case renders a title the *peer* typed. Peer-authored = channel `name`/`topic`, thread `title`/`outcomeSummary`, `profiles.display_name`, **and `metadata.taskId`** (stored VERBATIM for any non-UUID value — `resolvePostMetadata` gates only inside `if (isUuid(...))` and the route's `metadata` is an unbounded `z.record`). `ResolvedMember.label` is neutralized AT THE SOURCE in `memberLabel`, so write ops splice it directly and must NOT re-wrap it. Three scoped headers live in `channel-render.ts` (`_BODY_`, `_LISTING_`, `_THREAD_`) and are shared by both sides; a header is emitted **FIRST**, above the content it frames. Backed at the data layer by charset rules in `src/features/channels/schema.ts` (name + topic) and `src/app/api/user/profile/route.ts` (display_name). Pinned by `channel-narration.test.ts` (read), `channel-narration-write.test.ts` (write), `channel-untrusted.test.ts`.
- **§2 split (2026-07-31).** `channel-ops-write.ts` was at 488 lines; the three thread ops moved to **`channel-ops-threads.ts`** (`create_thread` / `close_thread` / `set_thread_mode`), along the `─── Threads ───` divider the file already carried. `channel-ops-write.ts` keeps open / invite / post. The parity split-scan auto-discovers `channel-*.ts`, so no test edit was needed.
- **THE NEUTRALIZER MOVED — it is `packages/mcp-server/src/tools/narration.ts` now, not `channel-shared.ts` (2026-07-31, cross-tool sweep).** The rule above is not a channel rule; it is the rule for EVERY `dopl_*` tool, because every one of them splices member-typed strings into the same kind of line. `channel-shared.ts` **re-exports** `neutralizeInline` / `inlineOr` / `INLINE_TEXT_MAX`, so channel imports are unchanged and there is still exactly ONE definition — pinned by identity (`expect(channelNeutralize).toBe(neutralizeInline)`) and by a source scan asserting no second `function neutralizeInline` exists in `src/tools/`. See "MCP NARRATION — the whole surface" below.
- **Description clarifications (agent-facing, no behavior change).** `CHANNEL_DESCRIPTION` warns that (1) in a live desktop **session window** EVERY channel op may raise an operator Allow/Deny — **including own-channel `op=post`**. (The v1.8 text said own-channel post ran un-prompted; that was already false when written, since v2.5 D2 gates it. Rewritten in the v3.0 round so the model plans against the real cost: the only thing that sends without a click is the operator's Axis-B Messages posture, which the agent cannot observe, and any grant it earns is per-session and dropped on park.) (2) If the counterparty's replies already arrive as new turns (desktop-run session), do NOT call `await` (await is only for a standalone listener loop). (3) **WAKE-V1 result-text rules, all load-bearing:** the untrusted-content caveat is emitted as a HEADER above the rendered bodies in BOTH `read` and `await` (a caveat placed under the content is read after the injected line it warns about); every "re-arm" instruction carries a stop condition so an abandoned exchange cannot loop forever, and that condition is the THREAD's STATE, never a timeout counter — cross-machine exchanges are meant to run unattended for hours and a peer agent doing real work is legitimately silent for 20+ minutes, so "~3 empty holds" is only a CHECKPOINT (look at `get_thread` status + recent `task_progress` milestones before re-arming), and the actual exits are: thread closed/failed, or no peer activity at all for ~30+ minutes. Third exit: a hold that returns far under what it asked for is reported as CUT SHORT with an explicit "do NOT re-arm, report this" — a clamped hold can never stay pending long enough to wake anyone, so re-arming it is a spin.
- **Tests.** `service-reads.test.ts` (list/get + get 404), `service-tasks.test.ts` (`createTask` idempotency: dedup returns same thread with no re-insert/re-post, first-send inserts+posts once, unique-race convergence), `channel-ops.test.ts` (list_threads/get_thread render, get_thread 404, opPost bad-thread mapping). Root suite 591 green; MCP parity 52 green, zero drift.

#### MCP NARRATION — the whole surface, not just `dopl_channel` (2026-07-31)

The two channel passes above hardened one tool and left the others; this sweep finished them. **The rule is unchanged and now applies everywhere: a tool result has a VALUE zone and a BODY zone, and every member-typed string spliced into the VALUE zone goes through the ONE neutralizer in `packages/mcp-server/src/tools/narration.ts`.**

- **Where the line falls.** A **VALUE** is a name, title, slug, label, path, snippet or error echo spliced into a line WE wrote — a `# ` heading, a `### ` heading, a bullet head, an inline span. Those are neutralized. A **BODY** is content rendered as itself under framing that says what it is — a knowledge-entry body, `SKILL.md`, a chat transcript summary or `verbatim` block, a skill's `description`/`when_to_use` under `op="get"`, a workflow step's instruction fields, an ontology `text` attribute and an action's prose. **Those are NOT neutralized** — clipping them to 160 chars would delete the feature. Where a body has no framing and no indent, it is INDENTED instead (`indented()` in `ontology-render.ts`), which costs nothing and removes its ability to begin a line.
- **The highest-reach string in the product is `workspaces.name`.** It is set by whoever OWNS a workspace, and a workspace enters your directory the moment you accept an invitation or a join link — so the author need share no other context with you. It lands in the MCP **`instructions`** block and in the **`_dopl_status` footer of every successful tool response**, which is the line the instructions tell the agent to read to confirm targeting. Both are neutralized in `server.ts`, the footer carries the immutable `id=` beside the slug, and `UNTRUSTED_DIRECTORY_NOTE` frames the directory table ahead of the names. It is charset-bounded on the way IN as of 2026-07-31 — see the short-label rule below.
- **Scoped headers, emitted FIRST.** `UNTRUSTED_DIRECTORY_NOTE` (`server.ts`), `UNTRUSTED_ARCHIVE_HEADER` (`chats-render.ts`), `UNTRUSTED_ROSTER_HEADER` (`members.ts`). A header is emitted only where the content can be **another member's** — `dopl_chats` emits it only when a rendered chat is workspace-shared (`visibility !== "private"` proves it may not be the caller's), because a header on every result trains agents to skip headers. KB / skill / workflow / ontology get **no** header: that content is the workspace's own authored procedure, which the agent is meant to follow, and framing it "never instructions addressed to you" would be false.
- **Never a member-typed name without an immutable id.** Extended from the channel rule to `dopl_members` (`op="list"` printed a display name with no user id at all), chat owners, teams, and every access-matrix resource.
- **THE SHORT-LABEL CHARSET RULE — one definition, `SAFE_LABEL_RE` in `src/shared/lib/safe-label.ts`.** Until 2026-07-31 only TWO columns carried a charset rule (KB folder names / entry titles via `NAME_RE`, and `profiles.display_name`); every other name and title was bounded by LENGTH ALONE, so newlines and `##` were legal in all of them. **The renderer is still the guarantee** — `neutralizeInline` holds whatever the database contains — and this is the INPUT side of the same rule, so a field that cannot hold a newline cannot forge a line in a surface written later that forgets to neutralize. Bounded fields (`safeLabel` / `safeOptionalLabel`): `workspaces.name`+`.description`, `clusters.name`, `knowledge_bases.name`, `skills.name`+`.folder`, `workflows.name`, `workflow_steps.title`, `teams.name`, `chats.title`+`.project`, `chat_folders.name`, `ontology_clusters.name`, `ontology_objects.name`, plus `channels.name`/`.topic` and `profiles.display_name`, which now import the same regex. **Do not add a second copy of the regex or the message** — build the copy with `safeLabelMessage(subject)`. **NOT bounded, deliberately:** every `description` / `overview` / `purpose` / `subtitle` / body / transcript / `SKILL.md` / `whenToUse` — those are prose the product exists to hand the agent, and the ontology labels nested in JSONB (`attributes[].label`, `methods[].name`, ...), which cannot take a column CHECK and so would be a route-only fence on an editor-writable table. Backed by CHECK constraints in `supabase/migrations/20260731110000_short_label_charset_bounds.sql` (**unapplied** — pre-flight clean on prod 2026-07-31), which is the load-bearing half for the eight tables carrying an editor-scoped write policy. Pinned by `src/shared/lib/safe-label.test.ts`, which asserts BOTH directions: every class rejected, and `Müller's Team` / `研究ノート` / `Café — Zürich` accepted.
- **`descSuffix` no longer hand-rolls a flatten-and-clip.** Its `\s*\n+\s*` pass missed U+0085 (NEL, absent from JavaScript's `\s`) and touched no markdown; it defers to the shared neutralizer, so the bound is `INLINE_TEXT_MAX` (160, `...` tail).
- **Pinned by** `narration.test.ts` (one-definition identity + source scan, workspace name, footer, directory tools), `tool-narration.test.ts` (chats, members), `tool-narration-graph.test.ts` (kb, cluster, skill, workflow, ontology, map, search), sharing `narration-fixtures.ts`. Every assertion is mutation-verified: **28 reverts, 28 test failures, 0 vacuous.**

#### v2.6 additions — server-side DM addressing, so a reply is never undeliverable (2026-07-29)

A live prod DM exchange proved the addressing contract was only half-enforced: the peer's agent posted an ADDRESSED message, the operator's session agent replied over MCP `post` with metadata `{summary}` only, and the reply was silently never delivered — the peer's `classify()` saw an agent-authored UNADDRESSED message and returned `ignore` (the v1.3.1 loop brake, working as designed), and with no `taskId` the v2.5 inbound gate had no `feedInboundForTask` route either. The web composer auto-addressed a DM peer since v1.6; the MCP path did not, and "the model must remember a parameter" is not a delivery guarantee. Fix is **server-side, metadata-only** (no schema/migration change, jsonb as always).

- **`postMessage` metadata folds moved to `server/service-writes-metadata.ts`** (`resolvePostMetadata`) — one place now owns the v1.1 reserved-key anti-spoof strip, addressing, and the v1.5 task-key stamping. `service-writes.ts` was over the §2 cap, so the same pass also split the task lifecycle out to `server/service-tasks.ts` (`createTask` / `closeTask` / `setTaskMode` / `reopenTask`, re-exported from the `service.ts` barrel unchanged); `service-writes.ts` is back under 500 lines. No route, schema, DTO, or client change.
- **DM auto-address.** A post into an `is_direct` channel with no caller `to` is stamped `metadata.to_user_id` = the OTHER member of that DM, resolved LIVE off `channel_members` (the same table the explicit `to` path validates against, so the addressee-is-an-active-member rule holds by construction and `CHANNEL_ADDRESSEE_NOT_MEMBER` is untouched). The stamp flows through the SAME validated path as `to` — reserved keys are still stripped from caller metadata first and re-added only from validated values, so a spoofed `metadata.to_user_id` still cannot survive. **Fail-quiet, never fail-closed:** a roster that is not exactly two rows (torn-down DM, unexpected third row) resolves to nothing and the post proceeds unaddressed rather than 400ing. An explicit `to` ALWAYS wins. **Never** auto-addressed in a non-direct channel — with 3+ members the recipient is ambiguous and a wrong guess prompts the wrong operator.
- **Task-id inheritance for session replies.** An untagged plain `message` in a DM addressed to the peer inherits `metadata.taskId` from the channel's SINGLE open first-class task whose participants are exactly `{author, peer}` (either direction), and that inheritance runs through the normal stamping path so `taskMode` / `taskCreatedBy` / `taskTitle` / `taskTarget` are stamped from the task row — the fields the desktop's routing + suppression predicates read. Conservative by construction: 0 or 2+ candidate open tasks stamps NOTHING; a caller-supplied `taskId` (first-class OR legacy `task-<uuid>-<seq>`) suppresses inheritance entirely; a non-`message` kind never inherits (a stray `task_failed` must not land on an unrelated task's card).
- **Loop safety re-verified in code.** Addressed agent replies now classify `trigger` (or `task-reply`) instead of `fyi`, so the loop brake is no longer what stops a two-agent DM. Every hop is still bounded by a human-or-standing-decision gate: a fresh trigger raises a `channel_consent_requests` row (Allow/Deny, or an `auto_allowed` trust rule the operator created), and a reply bound for an existing session passes `session-gate.js` where it is HELD until the operator Accepts unless they armed auto-approve / "Accept for this task" — plus the v1.9 turn cap 24, 15m idle TTL, cost cap, and one-window-per-(channel,task). Nothing changed on the desktop: unaddressed stays ignorable; the point is that legitimate replies are now addressed.
- **MCP description.** `CHANNEL_DESCRIPTION`'s `post` bullet states plainly that a direct-channel post is addressed to the other member automatically and that `to` is still how you address one member of a 3+ member channel. Parity test green (op substrings + param-usage assertions unaffected); `dist/` rebuilt (`npm run build:packages`).
- **Tests.** New `server/service-writes-metadata.test.ts` (15 cases through `postMessage`: peer stamped, explicit `to` wins, non-direct untouched, unresolvable/ambiguous peer no-stamp, caller `to_user_id` still stripped then replaced by the validated peer, inheritance single-candidate both directions + reserved-key stamping fires, 2+ candidates / closed / third-party tasks no-stamp, explicit + legacy taskId suppress, non-direct + lifecycle-kind never inherit). Root suite **669 green**; MCP parity 52 green, zero drift. Residual debt: **F-079** (two extra reads per DM post; `notify_scope='none'` no longer mutes an addressed DM ask, same delta v1.6 took on the web; inheritance is DM-only).

#### v3.0 additions — THREAD / SESSION vocabulary (2026-07-30)

A naming round, not a behavior round: the product called one exchange a "task", which was wrong (a thread may be a single message) and left "session" doing double duty. THE MODEL at the top of this section is now the definition of record; state it that way in the MCP tool description, in the docs, and in the desktop's first-turn prompt framing. No schema change, no migration, no route change.

- **MCP HARD CUTOVER, no aliases.** `create_task` → `create_thread`, `close_task` → `close_thread`, `set_task_mode` → `set_thread_mode`, `list_tasks` → `list_threads`, `get_task` → `get_thread`; `post`'s `task=` param → `thread=`. The old names return the standard unknown-op error, so **a connector must be reloaded**. Enum + `WRITE_OPS.dopl_channel` (`server.ts`) + `READ_OPS.dopl_channel` (`parity.test.ts`) + handlers + `@dopl/client` methods moved together; parity 52 green with `KNOWN_*_DRIFT` still `{}`. **Both `dist/` rebuilt** (`npm run build:packages`) — the app loads `dist` at runtime, so a stale `dist` ships the old surface.
- **`CHANNEL_DESCRIPTION` rewritten.** Leads with THE MODEL verbatim, then the protocol (open or find a thread; thread every post with `thread=<id>`; post progress as it lands; close when the GOAL is done). It also now states the real cost model, correcting a standing inaccuracy: **every** channel op may gate, own-channel `post` included, and the operator's v2.9 Axis-B Messages posture is the only thing that can send without a click (the agent cannot observe it, and any grant is per-session and dropped on park).
- **Web domain types + copy.** `ChannelTask` → `ChannelThread`, `TaskStatus` → `ThreadStatus`, `TaskMode` → `ThreadMode`, `TaskOutcome` → `ThreadOutcome`; `useChannelTasks` → `useChannelThreads` (`hooks/use-channel-threads.ts`, returns `threads`); `task-panel.tsx` → `thread-panel.tsx` (`TaskPanel` → `ThreadPanel`); client fns → `listChannelThreads` / `createChannelThread` / `closeChannelThread` / `reopenChannelThread` / `setChannelThreadMode`. Visible copy: `Task active|complete|failed` → `Thread active|complete|failed`, `Close task` → `Close thread`, `Reopen task` → `Reopen thread`, `Open window` → `Open session`, the panel heading → `Threads`, and the two session notes now say thread ("This thread has no session on this machine.", "The session was ended on the desktop. The thread stays open."). Route paths and request/response field names are UNCHANGED (storage names) and mapped at the client boundary.
- **Name clash resolved (F-081).** The channel detail pane is `ChannelPane` (`components/channel-pane.tsx`), so `ChannelThread` now names only the TYPE (one exchange). The transcript component followed one level down: `MessageThread` → **`ChannelTranscript`** (`components/channel-transcript.tsx` + test), imported by `channel-pane.tsx` — it renders the WHOLE channel transcript (every message, session card, and activity row), not one thread. In `lib/group-thread.ts` the pure domain type `TaskOverlay` → `ThreadOverlay`; `SessionGroup.taskId` deliberately KEEPS the `task` spelling (it is the `metadata.taskId` wire value verbatim) and carries a BOUNDARY comment saying so.
- **Not renamed on purpose.** Everything on the storage side: `channel_tasks`, `metadata.task*` keys, `task_*` message kinds, `TASK_*` error codes, `/tasks` routes, and the server lane's own identifiers. See the boundary note at the top of this section.

#### v3.1 additions — server-side audit fixes: thread atomicity, thread-scoped writes, slug allocation (2026-07-30)

Four server bugs from the six-agent audit. **No schema change and no migration** — every fix is in the service/repository lane, so nothing on the wire moved and the installed desktop (1.7.11) keeps working unchanged.

- **`create_thread` is now atomic-by-convergence (was: the idempotency key could swallow the request forever).** The thread row and its initiating message are two writes with no transaction around them. If the insert landed and the post then threw, the retry hit the `client_msg_id` short-circuit, returned the stored thread and NEVER posted — leaving a thread that exists in the panel with no message for the responder's desktop to route, so no session ever spawned (there is a live example in prod). Fix: the initiating message now carries a DERIVED idempotency key, `task-open-<threadId>`, and the post is re-driven on EVERY path that returns that thread (fresh insert, `client_msg_id` short-circuit, lost-23505-race). `postMessage`'s own idempotency (`findMessageByClientId` → the unique index) collapses the repeats, so the request lands exactly once and a failed post is repaired by the next retry. **Deliberately NOT moved into a PL/pgSQL RPC:** `postMessage` owns the addressee check, the DM auto-address, the reserved-key strip and the task-key stamping, and forking that into SQL would give the metadata contract two homes. The short-circuit only re-posts when the caller IS the thread's `created_by`, so a colliding key from another member still dedups but cannot write into their thread. Residual: with NO `client_msg_id` there is still no dedup at all (unchanged), so a retry there creates a second thread rather than repairing the first. **WAKE-V1 additive response field:** `POST /api/channels/[channelId]/tasks` now returns `{ task, openingSeq }` — the seq of that opening message — and `@dopl/client.createChannelThread` returns `{ thread, openingSeq }` (null when the route omits it, i.e. an older deployment or the short-circuit that returns ANOTHER member's thread). The `create_thread` MCP result quotes it as `since=<seq>` directly; before, it told the agent to call `read limit=1`, which cost a round-trip AND raced the peer — a reply landing in between becomes "the newest message", so the await armed one past the request and never returned the reply it was waiting for.
- **Channel membership is not THREAD membership (was: any member could write into any thread).** `metadata.taskId` is caller-settable by design (a responder replies within a thread), and the server validated only that the id resolved in THIS channel. In a 3+ member channel every member can read every thread id, so any of them could stamp another pair's id — and the server then stamped `taskMode`/`taskCreatedBy`/`taskTitle`/`taskTarget` from the real row, satisfying the desktop's routing predicate and landing the message inside someone else's thread card AND session window. A caller-supplied first-class id must now belong to the poster (`created_by` or `target_user_id`) or the post is **refused 403 `TASK_FORBIDDEN`**. Refused, not silently un-threaded: a message the author believes landed in a thread and the recipient never sees is exactly the invisible-delivery failure this feature exists to prevent. Closing/reopening were already gated this way. INHERITED ids need no check (inheritance only resolves a thread whose participants are `{author, peer}` by construction).
- **The calm-terminal flags are reserved keys now.** `declined` / `dropped` / `interrupted` / `capped` / `ended` ride on a `task_failed` and decide whether the other side's card reads as a calm operator-chosen ending or a red failure (and drive the message receipt). They were never stripped, so a member could POST `{kind:"task_failed", metadata:{taskId:"<their thread>", declined:true}}` and fabricate that thread's outcome. The strict `=== true` read in `lib/group-thread.ts` defends against type coercion, not against a literal `true`. They are now stripped from caller metadata like any reserved key and re-stamped ONLY for a thread participant — first-class threads via the gate above, and a LEGACY `task-{channelId}-{seq}` id (no `channel_tasks` row, but the shape the installed desktop posts most of its lifecycle events with) via its opening request's `{author, to_user_id}` pair, the same pair `groupThread` joins on. Fails closed: unknown id shape, missing opener, or an unaddressed opener → not a participant → the flag is dropped and the message still posts. Only a literal `true` is re-stamped, so `capped:"true"` no longer reaches storage at all.
- **Slug allocation now agrees with the index (was: a soft-deleted channel was invisible to allocation but still owned its slug).** `channels_workspace_slug_key` is a plain (NOT partial) unique index on `(workspace_id, lower(slug))`, but `existingSlugs` filtered `deleted_at is null` — so "create #Design, delete it, create #Design again" allocated `design` twice and 409'd naming a channel the user can no longer see; on the DM path the 23505 fell into a catch whose live-rows-only lookup returned null and rethrew raw, i.e. a generic 500 on "open direct message". `existingSlugs` now includes soft-deleted rows (case-folded to match `lower(slug)`). **The index is deliberately left non-partial:** a soft-deleted DM is REVIVED by pair (`findDirectChannelAnyStatus` → `reviveChannel`), which would break if another channel could take its slug while it was hidden. The DM catch also converges on the soft-deleted pair (reviving it) and maps an unresolvable 23505 to a clean 409 instead of a raw 500.
- **`repository.ts` split (§2).** It was 534 lines (a pre-existing violation, not in the §2 table). The transcript lane moved to `server/repository-messages.ts` (`listMessages`, `findMessageByClientId`, `findMessageBySeq`, `insertMessage`, `lastMessages`), joining the existing `repository-tasks.ts` / `repository-collab.ts` siblings; `repository.ts` keeps channels + members + profiles and is 409 lines. Services and tests import `repository-messages` directly (no barrel re-export). The dead `findDirectChannel` (live-rows-only) was deleted — every caller that converges on a DM must see the hidden row.
- **Tests (+15, root suite 695 green).** `service-tasks.test.ts` — the B1 regression drives insert-ok → post-throws → retry and asserts the request exists exactly once (plus a third send that inserts nothing), and a colliding foreign key posts nothing. `service-writes.test.ts` — a non-participant is refused 403 and nothing is inserted; the target may post. `service-writes-metadata.test.ts` — calm flags stamped for a legacy-pair participant and for a first-class participant, stripped for a third party, stripped when the opener is unresolvable, stripped when truthy-but-not-true, stripped with no thread id. `service-direct.test.ts` (NEW, split out of `service-tasks.test.ts`) — soft-deleted slug is taken, a genuine race is a 409, the DM 23505 revives the pair. `service-tasks-lifecycle.test.ts` (NEW, split out of `service-writes.test.ts` for the §2 cap) — the close echo + reopen silence.

---

## 9. API Routes

### Shape

Every route handler is ≤ 80 lines. If longer, you're doing business logic inline — extract to `service.ts`.

```ts
// src/app/api/<feature>/<action>/route.ts
import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { <Action>Schema } from "@/features/<name>/schema";
import { <action> } from "@/features/<name>/server/service";

export const POST = withUserAuth(async (req, { userId }) => {
  const input = await parseJson(req, <Action>Schema);
  const result = await <action>(input, userId);
  return NextResponse.json(result);
});
```

### Auth wrappers (reuse — do not reinvent)

Auth wrappers live in `src/shared/auth/`:

- `withExternalAuth(handler)` (`with-auth.ts`) — remote-MCP OAuth token OR session; 401 if neither.
- `withUserAuth(handler)` (`with-auth.ts`) — same, plus injects `{ userId, agentTokenId?, apiKeyWorkspaceId?, params }`.
- `withMcpAccess(action, handler)` (`with-auth.ts`) — composes `withUserAuth`; paywall-gates MCP (bearer) callers, logs analytics.
- `withWorkspaceAuth(handler, { minRole, workspaceIdFromQuery, writeScopeExempt, sessionOnly })` (`with-workspace-auth.ts`) — composes `withUserAuth`; resolves the active workspace **fail-closed** (MCP-2, see §Workspace resolution below), verifies membership + `meetsMinRole`. The default for workspace-scoped content routes. `workspaceIdFromQuery: true` lets `?workspaceId=` participate in resolution for header-less `<a download>` export routes. Both wrappers also take `writeScopeExempt` / `sessionOnly` — the OAuth caller-type gates (see "OAuth write-scope & session-only gating" below).
- `isAdmin(userId)` (`with-auth.ts`) — site-admin check vs `ADMIN_USER_ID` env.
- `requireCronSecret(request)` (`require-cron-secret.ts`) — bearer gate for `/api/cron/*`, fail-closed 503 when unset.

Service-layer gates: `requireWorkspaceRole(workspaceId, userId, minRole)` in `src/features/workspaces/server/authz.ts` (the one membership-fetch + role-check helper — don't re-roll it), and the pure member-management hierarchy in `src/features/workspaces/member-policy.ts` (`memberManageDenial` / `canGrantRole` / `canShowMemberControls`, shared with the members UI).

They handle: Bearer OAuth access tokens (`dopl_at_`, validated via `mcp-oauth.ts`), Supabase session cookies, OAuth-subject rate limiting, and automatic 5xx system-event logging.

### OAuth write-scope & session-only gating (2026-07-20)

`withUserAuth` / `withWorkspaceAuth` take two options that gate by **caller type** (OAuth bearer `dopl_at_` vs. session/cookie), orthogonal to `minRole`. Cookie/session callers authenticate AS the human and are never gated by either — these options only ever constrain OAuth tokens.

- **`writeScopeExempt` (default: gate ON).** An OAuth bearer calling a write method (any non-`GET`) without the `dopl.write` scope → 403 `WRITE_SCOPE_REQUIRED` with `WWW-Authenticate: insufficient_scope`. Set `writeScopeExempt: true` to opt a route out: `/api/mcp` (op-level `WRITE_OPS` gating already covers it) and the `user/mcp-status` ping are the only exemptions.
- **`sessionOnly: true`.** Rejects ALL OAuth tokens (403 `SESSION_REQUIRED`) regardless of scope — for destructive, credential-minting, or permission-mutating routes an agent must never reach. Applied to 18 route files: user delete; workspace delete; member role-change + remove; invitation create + revoke; join-request approve; billing checkout / portal / upgrade-to-team; access-matrix PUT; teams members add + remove; teams access PUT; join-link POST; oauth-grant revoke; **`auth/mcp-device-token` POST + DELETE** (Channels v1.1 — an agent must not mint itself a 90-day credential; F-085 — nor revoke one); **`channels/consent/[id]` PATCH + `channels/trust` POST/DELETE** (Channels v1.2 — a spawned agent must not self-approve its own consent gate or self-grant standing trust; see §8 "v1.2 additions"). Note the granularity is per-METHOD: the `GET`s on the channels consent/trust routes are deliberately ungated.
- **Regression tripwire:** `src/shared/auth/write-gate-coverage.test.ts` pins both sets — adding a destructive route without `sessionOnly`, or narrowing the exempt set, fails the suite. Update the test in the same PR when the surface legitimately changes.

### Workspace resolution (MCP-2 — fail-closed, no default fallback)

`resolveActiveWorkspace(userId, headerWorkspaceId)` (`features/workspaces/server/service.ts`) is THE resolver behind `withWorkspaceAuth` and `GET /api/workspaces/me`. It is fail-closed — there is **no** silent default-workspace fallback (the old oldest-owned / auto-create path is gone):

1. **API-key workspace lock** (in `withWorkspaceAuth`, before the resolver) — a workspace-scoped key wins; a contradicting requested target → 403 `API_KEY_WORKSPACE_MISMATCH`. Dead scaffolding today (session/OAuth callers never set `apiKeyWorkspaceId`); preserved, not advertised.
2. **`X-Workspace-Id` header** — UUID only. Present-but-blank or non-UUID (e.g. a slug) → 400 `WORKSPACE_INVALID` (never coerced to "no header", never a 500). With `withWorkspaceAuth({ workspaceIdFromQuery: true })` a `?workspaceId=` param slots in at the same priority; the header wins when both are present. Used by the 4 export GET routes so a header-less `<a download>` isn't 400'd before the param is read.
3. **No header → active memberships** (`listWorkspacesWithRoleForUser`, ONE query): exactly one → auto-target it; **0 or 2+ → 400 `WORKSPACE_REQUIRED`**. Never `findDefaultWorkspaceForUser` here — that is oldest-OWNED (billing-webhook grandfather + signup-bootstrap only) and diverges from membership.

Error envelope is the **flat billing-style** `{ error, message, workspaces? }` (via `WorkspaceResolutionError`, mirroring `entitlementDeniedBody`), so `@dopl/client` / the web `apiRequest` surface it verbatim; `WORKSPACE_REQUIRED` lists `{name, slug, role}` per membership (empty ⇒ the message points at `POST /api/workspaces`). Any UI that reads a workspace-scoped route must send the header (`apiRequest({ workspaceId })`) or the fetch fails closed for multi-workspace users — don't rely on a default.

### Shared API helpers

Available in `src/shared/`:

- `src/shared/lib/http-error.ts` — `HttpError` class with `status`, `code`, `message`, `details` + convenience constructors (`HttpError.badRequest`, `.unauthorized`, `.notFound`, ...).
- `src/shared/api/parse-json.ts` — `parseJson(req, schema)` parses JSON body and zod-validates. Throws `HttpError(400, INVALID_JSON | VALIDATION_FAILED)` on failure. `validationResponseBody(err)` returns the same envelope with the FIRST zod issue's own message promoted into `error.message` — use it in routes behind a form, so the user reads the schema's sentence instead of "Request body failed validation".
- `src/shared/api/error-handler.ts` — `withErrorHandler(source, handler)` catches thrown `HttpError`, converts to typed JSON, logs unexpected throws. Composes inside `withUserAuth`.

**Adopt these for new routes.** When modifying an existing route with inline 4xx/5xx patterns, prefer migrating it to `HttpError` + `parseJson` in the same PR if the diff stays reasonable.

### Error response shape

```ts
type ErrorResponse = {
  error: {
    code: string;        // MACHINE_READABLE_CODE
    message: string;     // human-readable
    details?: unknown;   // optional structured data (zod issues, etc.)
  };
};
```

Never return raw error strings. Never leak stack traces.

### 9.1 Middleware auth — verify locally, never call the network per request

`src/proxy.ts` runs on nearly every request. It MUST NOT call
`supabase.auth.getUser()`: that is a network round-trip to GoTrue costing five
Postgres queries, on every page nav, RSC prefetch and API call. On 2026-07-31
that shape amplified a burst into a self-inflicted outage — auth went from ~70
to ~1,500 requests/min, GoTrue was starved until it could no longer resolve DNS
for Google's token endpoint (breaking OAuth sign-in entirely), and every
server-rendered page returned a platform 500. For eight users.

Use `supabase.auth.getClaims()`, which verifies the JWT signature locally
against the project's JWKS (this project issues ES256 with a `kid`; the JWK is
fetched once and cached ~10 min). Two traps, both pinned by `src/proxy.test.ts`
and `src/proxy-claims.test.ts` — do not "simplify" either away:

1. **`getClaims()` can throw a plain `Error`** (`"JWT has expired"`,
   `"Missing exp claim"`) which is NOT an `AuthError` and so is not converted.
   Unwrapped in middleware that is a 500 on every page. Wrap it; treat a throw
   as "no session" (fail closed) — the same branch a failed `getUser()` took.
2. **Cookie refresh still depends on it being called with no argument**, because
   that path runs `getSession()` first, which is what refreshes a near-expiry
   token and rotates the cookies onto the response. Pass a token explicitly and
   sessions silently die about an hour after sign-in.

If the project ever reverts to a symmetric (HS256, no `kid`) signing key, local
verification is impossible and `getClaims()` degrades to a network call — the
old cost returns silently. A test pins that degradation so it is at least
visible.

Same rule applies to any other per-request hot path. `src/shared/auth/with-auth.ts`
still does a network `getUser()` per API request and is the largest remaining
consumer (F-094).

---

## 10. Server vs. Client Boundaries

- `import "server-only"` at the top of any file that must not ship to the client. Build breaks if a client file imports it.
- `import "client-only"` for files that must only run in the browser (rare — only for browser-API-dependent utilities).
- Shared code (types, pure utilities) has no directive.
- **Never** import `server/` files from components unless inside a Server Component or Server Action.

---

## 11. Types

- **Feature-owned types** live in `src/features/<name>/types.ts`. They describe the domain (`Entry`, `Cluster`, `Panel`).
- **Shared types** live in `src/shared/types/`. Examples: `ApiError`, `Result<T, E>`, `Paginated<T>`.
- **DB types** are auto-generated by Supabase CLI into `src/shared/supabase/types.ts`. Do not hand-edit.
- **Zod schemas** and types are co-located. Derive TS types from zod with `z.infer`:
  ```ts
  export const IngestRequestSchema = z.object({ url: z.string().url() });
  export type IngestRequest = z.infer<typeof IngestRequestSchema>;
  ```

No `interface` vs `type` religion — use `type` by default. Use `interface` when declaration merging is genuinely needed.

Never `any`. Never `@ts-ignore`. If you truly need an escape hatch: `unknown` + runtime guard, or `@ts-expect-error` with a comment explaining.

---

## 12. Error Handling

- **Throw, don't return error tuples** (no Go-style). Use typed error classes.
- **Feature errors**: each feature has `server/errors.ts` with `class FeatureXError extends Error`. Sub-classes for specific cases (`EntryNotFoundError`, `RateLimitError`).
- **At the boundary** (route handler, server action): catch, log, convert to user-facing response.
- **Never swallow errors silently.** `catch (e) { /* ignore */ }` is a refactor candidate.
- **Retries** belong in the service layer, not sprinkled in handlers.

---

## 13. Testing

Current coverage: zero. Target:

| Layer | Tool | Coverage goal |
|-------|------|---------------|
| Pure business logic (ingestion parsers, cluster math, DTO mappers) | vitest unit tests | High — test every branch |
| Services that hit Supabase | vitest + `supabase start` local | Happy path + auth/RLS edge cases |
| React components | vitest + `@testing-library/react` | Sparingly — only for components with non-trivial logic |
| E2E | Playwright (deferred) | 3–5 golden-path flows (signup → ingest → chat) |

### Rules

- Tests live next to code: `pipeline.ts` → `pipeline.test.ts` in the same folder. No separate `__tests__/` tree.
- No mocking Supabase — run against a local Supabase instance, reset per test.
- No mocking the Anthropic SDK beyond a typed fake at the service boundary.
- A bug fix PR must include a test that would have caught it.

---

## 14. Git & Commit Hygiene

### Commit messages

Format: `<scope>: <verb-in-present> <what>`

```
ingest: extract twitter handler into its own file
billing: fix Stripe webhook signature verification
canvas: split store into reducer + persistence
```

- Imperative mood ("add", not "added").
- Scope = feature name or area. Lowercase.
- Subject ≤ 70 chars. Body (optional) explains *why*.

**Banned**: `fixes`, `thjings`, `wip`, `updates`, `stuff`. Rebase or amend before merging.

### Branching

- One PR = one logical change. If you find yourself writing "also" in the description, split the PR.
- Branch names: `<type>/<scope>-<short-desc>` e.g., `refactor/canvas-store-split`, `feat/community-fork-preview`.

### PR checklist (enforce in template)

- [ ] File size rule respected (§2)
- [ ] Naming follows §4
- [ ] Route handlers ≤ 80 lines; logic in `service.ts`
- [ ] No `any`, no `@ts-ignore`, no `console.log` left behind
- [ ] Tests added for new logic (§13)
- [ ] No commented-out code
- [ ] CHANGELOG / migration note added if schema or public API changed

---

## 15. Performance Defaults

- Server components by default → smaller client bundles.
- Lazy-load heavy islands (canvas, charts) with `next/dynamic` + `{ ssr: false }` when appropriate.
- Memoize expensive selectors in the canvas store; don't memoize trivial renders.
- Debounce writes to Supabase in the persistence layer (500ms for layout, 200ms for text inputs).
- Paginate any list query that can exceed ~50 rows. Never `select *` without a limit.
- Index DB columns used in `where`/`order by`. Add an ADR when adding an index.

---

## 16. Anti-Patterns (don't do this)

1. **Files over 500 lines** (outside the §2 exceptions).
2. **Cross-feature imports.** `features/chat` importing `features/canvas/internals` — move the shared thing to `shared/` or expose via barrel.
3. **Components that fetch their own data AND manage mutations AND render UI.** Split: fetch in a hook, render in a component.
4. **Reducers that call async code.** Reducers are pure. Async belongs in action creators / services / middleware.
5. **`useEffect` chains that sync server state manually.** Use a query library.
6. **Inline Supabase calls in components.** All DB access goes through `repository.ts`.
7. **Config sprawl.** Constants belong in `features/<name>/constants.ts` or `src/config/`. Not at the top of random files.
8. **"Temporary" solutions with no deletion date.** If it's temporary, open an issue and link it from a comment that gives a deletion trigger ("delete when we migrate off X").
9. **Mixed type/value exports from a barrel.** Keep `index.ts` imports explicit; prefer `export type { ... }` for types.
10. **Re-exporting for backwards-compat during a refactor.** Delete the old path, update every caller in the same PR.

---

## 17. Major structural changes — rules of engagement

When doing a large restructure (feature relocation, service split, directory reorg), apply these rules:

1. **One feature module at a time.** Complete the move (files, imports) before starting the next.
2. **No behavior changes during a structural move.** A restructure commit must be verifiable by running the app and seeing nothing differ. Behavior changes go in separate PRs.
3. **No new features during a restructure.** If a feature is urgent, pause the restructure, ship the feature, resume.
4. **Delete as you go.** Do not leave `old-*.ts` or `legacy-*.ts` files behind. Git has the history.
5. **Fix naming drift in the same PR as the move.** If you find `MOVE_PANEL` when normalizing to `DOMAIN_VERB`, fix it now.
6. **Keep PRs small.** ~500 lines changed max. If a file split creates a giant PR, split it into two commits in the same PR (rename-only commit + content commit) so review is easy.
7. **Update this doc** when you find a pattern that isn't covered, or when a rule turns out to be wrong. This doc is a living contract.
8. **Phase-tag for rollback.** For a multi-day restructure, tag `<name>/pN-done` at each phase boundary so `git revert` and `git reset --hard <tag>` are always clean options.

---

## 18. Desktop app — build, signing & notarization

The macOS desktop app lives in `dopl-desktop-app/`. It's a thin Electron wrapper
around the production web app (`https://www.usedopl.com/`) — single `BrowserWindow`,
external links open in the system browser, OAuth popups allowed, offline fallback,
standard macOS menu. As of 2026-07-25 (modernized to Electron 43) it also registers a
`dopl://` deep-link handler and a Channels listener that spawns a local Claude Code
session on channel activity. **v1.1 (2026-07-26, version 1.1.0)** adds message
targeting/consent, notifications, an in-app "Sign in to Claude" flow, Dopl-MCP
auto-config, and an electron-updater auto-updater ("Desktop app v1.1" below; the
remaining F-054 follow-up is the web-side deep-link `state` echo).
**v1.2 (2026-07-26, version 1.2.0)** adds server-decoupled consent
(approve-in + approve-out), per-channel tool-profile containment for spawned
agents, an opt-in visible-Terminal spawn mode, a presence heartbeat, and
task lifecycle events ("Desktop app v1.2" below).
**v1.4 (2026-07-27, version 1.4.0)** replaces the blocking consent dialog with a
durable, async **pending** model — a native notification (Allow/Send) + a web
Pending Requests list + a tray "Pending: N" count, driven by a `consent-watcher.js`
engine — and adds a per-channel working-directory picker ("Desktop app v1.4" below).
**v1.5 (2026-07-27)** adds a **`task-reply`** targeting verdict + a `task-notify.js`
module so an inbound reply to an INTERACTIVE task the operator created surfaces as a
passive notification instead of a fresh consent prompt/spawn ("Desktop app v1.5" below).
It is
**inert for the Vercel/Next build** (`node_modules/` and `dist/` are gitignored;
nothing imports it).

### Layout
- `main/index.js` — app entry (window, menu, navigation/link handling).
- `main/load-guard.js` — owns the main window's load lifecycle (loading screen + hung-load watchdog + auto-retry; see "Desktop app resilience" below).
- `renderer/preload.js` — minimal context-isolated bridge (`window.dopl`).
- `renderer/offline.html` — shown on a fast load failure (`did-fail-load`).
- `renderer/loading.html` — local loading screen shown before the first remote paint and during retries (so the window is never a bare black backgroundColor).
- `build/icon.icns` — app icon (keep; don't regenerate casually).
- `entitlements.mac.plist` — hardened-runtime entitlements (JIT, etc.).
- `scripts/notarize.js` — electron-builder `afterSign` hook (notarizes during build).
- `scripts/finish-notarize.sh` — standalone notarize+staple of an existing DMG.

### Commands
```bash
cd dopl-desktop-app
npm install              # first time / after clone (node_modules not committed)
npm run start            # run from source (dev)
npm run smoke            # headless load check against www.usedopl.com
npm run build            # signed DMG -> dist/Dopl-<ver>-arm64.dmg
npm run notarize         # notarize + staple the built DMG (no rebuild)
npm run release          # build + publish to GitHub Releases (electron-updater feed)
node --test 'dopl-desktop-app/test/**/*.mjs'   # targeting truth table (see below)
```

### Signing identity (set up; not secret)
- Developer ID: `Developer ID Application: Samuel Wang (7352NBAF44)` (in Keychain).
- Team ID: `7352NBAF44` · Apple ID: `samuelnywang717@gmail.com` · appId: `com.dopl.connect`.
- `electron-builder` auto-signs with the keychain cert during `npm run build`.

### Credentials (NOT stored in this repo)
The Apple **app-specific password** is a live secret and must never be committed.
`scripts/finish-notarize.sh` loads creds at runtime in this priority:
1. env vars `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`, else
2. a local creds file (default `~/Desktop/openclaw/workspace/memory/apple-signing-checklist.md`,
   override with `DOPL_SIGNING_CREDS_FILE`).

Provide creds via env when building elsewhere:
```bash
export APPLE_ID="samuelnywang717@gmail.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # appleid.apple.com → App-Specific Passwords
npm run notarize
```

### Notarization notes
- Notarization is **path-independent** (Apple checks the bundle, not its location).
- Every build must be re-notarized (the afterSign hook does it when creds are present).
- `SKIP_NOTARIZE=true npm run build` for fast unsigned-ish dev builds.
- **403 "A required agreement is missing or has expired"** is an *account* error, not
  a code error: accept the pending Developer Program License Agreement at
  developer.apple.com → App Store Connect → Agreements, Tax, and Banking, wait a few
  minutes to propagate, then re-run `npm run notarize`.
- Verify a build: `xcrun stapler validate <dmg>` and, on the `.app` inside the mounted
  DMG, `spctl -a -vvv <app>` → expect `accepted / source=Notarized Developer ID`.
  (`spctl` on the `.dmg` itself reports "no usable signature" — that's expected; the
  DMG carries a stapled ticket, not a code signature.)

### Desktop app v1.1 (Channels listener, 2026-07-26)

Main process is split into single-purpose modules under `main/` (all ≤500 lines per §2, enforced by `dopl-desktop-app/eslint.config.js` `max-lines`): `index.js` (window/menu/deep-link); the listener is split across `channel-listener.js` (the long-poll loop + reconcile + public API), `listener-io.js` (persistence + HTTP + identity/name-cache), `targeting.js` (`classify`/`metaStr`/`resolveToolProfile` + the `handlers` state), and `trigger.js` (consent orchestration + spawn-and-post + outbound review + task events); the spawner is split across `session-spawner.js` (spawn/exec/terminal machinery), `tool-profiles.js` (the containment table), and `claude-resolve.js` (CLI binary resolution); `claude-auth.js` + `claude-token.js` (sign-in), `mcp-config.js` (Dopl-MCP auto-config) + `mcp-cli-add.js` (its `claude mcp add/remove/get` child processes), `consent.js` (decoupled consent gate), `presence.js` (heartbeat), `updater.js`, `tray.js`, `api.js`, `config.js`, `diag.js`. **The `{slug}-{publicId}` workspace URL segment is built in three places — `channel-listener.reconcile`, `channel-context.resolve`, `listener-io.refreshNameCache` — and ALL THREE must guard both halves and yield null.** `refreshNameCache` interpolated blind until 2026-07-31, so a DTO with no `publicId` produced `slug-undefined`, 404'd, and left the display-name + avatar caches empty for that workspace — every peer then rendered as "A teammate" with a lone `namecache miss 404` line to explain it. Pinned by `dopl-desktop-app/test/namecache-segment-guard.test.mjs`. Renderer adds `code-prompt.{html,js}` (the paste-back window). Console is invisible for a GUI-launched app, so every silent decision is one-line appended to `userData/listener.log` via `diag()` — **never log token values**.

- **Targeting (`classify()` in `targeting.js`).** Each foreign message resolves to `trigger` (consent prompt → maybe spawn), `fyi` (silent notify only), or `ignore`. Rules: explicit `metadata.to_user_id === me` → **always trigger** (regardless of member count, membership, or mute, and for USER **and** AGENT authors — an agent explicitly addressed to me is the core use case); addressed to someone else → `fyi` as a member / `ignore` as a public non-member; unaddressed + **agent author** → `fyi`/`ignore`, never a trigger, at any member count (the LOOP BRAKE, `:146`); unaddressed + **user author + exactly 2 members + isMember** → implicit `trigger`; unaddressed + 3+ (or unknown count) → `fyi`. **Fail-closed:** unknown operator identity, my own message, a non-`message` kind, or an author kind that is neither `user` nor `agent` (e.g. `system`) → `ignore`; the implicit 2-member trigger fires ONLY on a known-exact count of 2 (a stale/absent `memberCount` degrades to multi-member FYI, never a mass-prompt). `notify_scope: 'none'` mutes the IMPLICIT trigger but never an addressed one. **Agent authors are NOT rejected wholesale** — this bullet said they were, which is stale and is the fact the MCP lane's copy leaned on; only the UNADDRESSED case brakes.
- **Notifications.** FYI is a silent notification, sent only when the caller's `myNotifyScope === 'all'`. The consent surface is dual: an in-app `showMessageBox` (source of truth) PLUS an alert-style notification with an **Allow** action button. First answer wins; the other is dismissed best-effort. **Gotcha:** the notification's `close`/dismiss deliberately does NOT settle consent — banner auto-dismiss (Focus modes, banner style) is indistinguishable from an explicit deny, so settling there would swallow a later Allow on the still-open dialog. All deny decisions route through the dialog. (Alert style requires `NSUserNotificationAlertStyle: "alert"` in `extendInfo`.)
- **"Sign in to Claude" flow (`claude-auth.js`).** On an auth-shaped spawn failure, Tier 2 drives `claude setup-token` under a pseudo-TTY (`script -q /dev/null claude setup-token`), parses the OAuth URL from its output, opens it in the system browser, and collects the pasted code in a local `BrowserWindow` (written to the child's stdin). **Gotcha worth recording:** the authorize URL is emitted as an **OSC-8 hyperlink escape** (`ESC ] 8 ; … ; <uri> BEL`) whose host is **claude.com** (not anthropic) — parse the OSC-8 target, not the visible text (the animated redraw mangles the visible text but not the target). A printed `sk-ant-*` token is captured and stored (safeStorage) for `CLAUDE_CODE_OAUTH_TOKEN`; a clean exit with no printed token relies on claude's own store. Tier 1 fallback opens Terminal on `claude /login`.
- **Dopl-MCP auto-config (`mcp-config.js`).** On signed-in startup / post-sign-in it mints (or reuses) a device token (§8), writes `userData/mcp-spawn.json` (mode 600), and passes `--mcp-config <path>` on every spawn so a responding agent always has Dopl regardless of the CLI's global config. It also ensures a user-scope `dopl` entry via `claude mcp add --transport http … --header 'Authorization: Bearer …'` (single argv element — no shell, token never on a command line). The global entry is left alone UNLESS a fresh mint just revoked the token it carries — then it is removed + re-added so manual `claude` runs don't 401. Single-flight; best-effort; never throws.
- **Auto-updater (`updater.js`) + release flow.** electron-updater checks GitHub Releases (`SamuelrWang/Dopl`) at startup and every 4h, downloads silently, and installs on normal quit (`autoInstallOnAppQuit`) or an explicit "Restart to install" tray item — it **never force-restarts** (a background listener must not yank an active spawned session). The mac target ships `zip` + `dmg` + the `latest-mac.yml` feed. **Release:** bump `package.json` version, then `npm run release` (`electron-builder --mac --publish always`) — the GitHub **release tag must be `v<version>`** or electron-updater won't match the feed. Dev runs skip the updater (`!app.isPackaged`). **The tray ASKS the updater; it does not only listen (2026-07-31).** `update-downloaded` fires exactly once, so a tray built after it would never learn about the staged build — the exact Q10 failure (a Mac running a build nobody believes it is running). `tray.buildMenu()` therefore calls `refreshUpdateReady()`, which reads `updater.isUpdateReady()` / `updater.updateReadyVersion()` on every rebuild and falls back to the `onReady` echo when no updater is present (harness). Those two exports had zero callers until then. Do not reintroduce a tray-local copy as the sole source: it silently couples the menu to `index.js` calling `tray.create()` before `updater.init()`. Pinned by `dopl-desktop-app/test/tray-update-source.test.mjs`.
- **Test locations.** `dopl-desktop-app/test/classify.test.mjs` (node `--test`) is a 1536-case truth table over the `classify()` targeting verdict (dimensions: `to` × memberCount × isMember × author × authorKind × kind × scope). It reads and evaluates the real `classify`/`metaStr` source verbatim from `targeting.js` (they're private, non-exported) so it can't drift from prod. **Node 24 gotcha:** a bare path arg no longer works — use the glob form `node --test 'dopl-desktop-app/test/**/*.mjs'`. The web/service side of Channels is covered by the vitest suites listed in §8 (v1.1 tests).

### Desktop app v1.2 (decoupled consent + containment, 2026-07-26)

Two new main-process modules: `main/consent.js` (the decoupled consent gate) and `main/presence.js` (heartbeat). Tool-profile containment lives in `tool-profiles.js` + terminal mode in `session-spawner.js`; task events and the outbound-review step live in `trigger.js`.

- **Consent decoupling (`main/consent.js`).** The v1.1 dialog is kept and a **third surface** is added: the desktop POSTs a `channel_consent_requests` row (§8) and polls it, then races **native `showMessageBox` + alert notification + web-row poll** onto ONE single-resolve promise — first answer wins, the rest are dismissed best-effort. Exports `decideInbound` (before spawn) / `decideOutbound` (before the reply leaves the machine) / `cancelStaleOutbound` / `clampBody`. Key behaviors: local decisions PATCH with **`decidedBy:'desktop'`** so the audit trail stops filing native-dialog clicks as web clicks; a **409 is a lost race, not a failure** (the other surface decided — no retry); bodies are clamped to the server's 16 000-char cap up front so an oversized reply can't 400 the create and silently kill the web surface; the poll backs off (5s for the first minute → 10s to five minutes → 20s) because each GET makes the server run its expire sweep; and **graceful degrade** — if the consent endpoints 404 (web not yet deployed) or the create fails, there is no row and it falls back to v1.1 dialog-only, with **no** auto-allow (fail-safe: prompt). Trust is never cached locally (§8, server-side only).
- **Orphan outbound sweep.** An outbound row created just before a crash/quit stays `pending` forever, leaving a live Send button on the web card that nothing can honor (the desktop holding the drafted reply is gone). `cancelStaleOutbound` denies this channel's orphan `outbound` rows once per channel per app run, **except** the seq about to be replayed — outbound creates now de-dupe at ANY status, so denying that one would make the replay's POST return the DENIED row and drop the reply with no dialog. Client-side stopgap; the server is the only party that actually knows the desktop disconnected → F-065.
- **Presence (`main/presence.js`).** `POST /api/channels/presence` every 30s per watched workspace while running + signed in (`status:'listening'`); web derives online from `last_seen_at > now()-90s`. Node/HTTP heartbeat, NOT browser Realtime Presence (the desktop has no browser client). The workspace set is pushed in from the listener's reconcile (`setWorkspaces`) rather than re-fetching; ticks are skipped while one beat is in flight (a duplicate heartbeat has no value); a 404 backs off so it never spins against an undeployed route.
- **Terminal mode (Feature 3, opt-in).** Tray checkbox "Run responses in Terminal" (persisted `runInTerminal`). Launches `claude` interactively in Terminal.app via `osascript` — a **real TTY**, so the CLI's own interactive permission prompts work and the operator WATCHES (the terminal window IS the approve-out review). The agent delivers its own answer by calling `dopl_channel(op="post")` over `--mcp-config` (no stdout capture on our side); a **`read_only`** spawn is instead told to PRINT its reply, because that profile denies the whole Dopl MCP server and pointing it at `dopl_channel` would aim it at a tool that isn't there. Hardening: the untrusted body goes to a **per-spawn nonce-named mode-600 file** read via `DOPL_PROMPT="$(cat …)" && rm -f …` chained with `&&` so `claude` never runs on a body we couldn't read or couldn't delete (the pre-hardening build reused one fixed `terminal-prompt.txt`, so concurrent triggers raced and the body lived on disk indefinitely); a sweep clears residue from earlier runs; tokens never touch argv. Busy state shares the SAME `active` set as headless so `isBusy()` is honest across modes, and since a detached terminal gives no exit signal the slot frees on the headless `MAX_RUNTIME_MS` ceiling. **No `--resume` in terminal mode** — terminal and headless runs don't share per-channel session continuity → F-066.
- **Task lifecycle events.** Each spawn emits `task_started` / `task_finished` / `task_failed` as ordinary `channel_messages` (`kind=task_*`, `author_kind=agent`) grouped by a per-spawn `metadata.taskId`. `task_started` fires only AFTER a confirmed launch (and not when the channel is already busy); terminal mode emits `task_started` on launch and cannot emit a finish (detached). The **headless agent reply** (`postResult` in `trigger.js`, after approve-out) now also carries `metadata: { taskId }` so it groups with its own lifecycle events; incidental posts (the busy "please resend" notice) pass no metadata. `taskId` survives the messages POST unchanged — it stays caller-settable (`postMessage` strips the reserved `to_user_id`/`summary` keys, and, since v1.5, the server-controlled `taskMode`/`taskCreatedBy`/`taskTitle`/`taskTarget` keys — but never `taskId`). **Web render:** the transcript groups one session into a single `SessionCard` (status chip Active/Done/Failed + presence-ringed agent identity + one-line summary; body = reply + `task_progress`) via the pure `groupThread` helper (`src/features/channels/lib/group-thread.ts`, unit-tested) — the flat task_started/finished rows are replaced by the chip, not shown. Grouping is by `taskId`, with an open-`task_started` fallback for a reply that lacks one (terminal-mode replies posted via MCP `dopl_channel` never carry a taskId → status stays Active since a detached terminal emits no finish).

#### Tool-profile containment (v1.2 Feature 6) — verified facts, do not re-derive

`channel_members.agent_tool_profile` (§8) bounds what a spawned agent may do. The empirical facts below were **verified against claude 2.1.220** and are the landmine of this feature:

- **`--allowedTools` is ADDITIVE — it pre-approves, it does NOT bound.** The operator's global `~/.claude/settings.local.json` `permissions.allow` list (e.g. `Bash(python3 *)`, `Bash(bash)`, `mcp__dopl__delete_entry`) **keeps applying to spawned sessions** no matter what is passed. v1.1's `read_only` spawn could therefore still run Bash.
- **Real containment is four layers**, all applied together by `buildRestrictionArgs()`: **(L0) `--tools <builtins>`** — a POSITIVE bound; anything unnamed is never offered to the model. Verified that it bounds BUILT-INS only and does **not** bound MCP tools (which is exactly why `dopl_only` still gets the Dopl server through). **(L1) `--settings <file>`** — a scoped JSON whose `permissions.deny` **outranks every allow** (verified: allow `Bash(python3 *)` + deny `Bash` in the same file ⇒ Bash is not offered, and a denied tool isn't even presented to the model). **(L2) `--disallowedTools`** — the same names at the CLI layer, because in `-p` mode an invalid settings file is SILENTLY ignored. **(L3) `--strict-mcp-config`** — only the Dopl server from `--mcp-config` loads, never the operator's global MCP servers.
- **MCP allow/deny entries are EXACT-MATCH, not string-prefix.** The bare server prefix `mcp__dopl` was the over-grant hole: it matches all six `*_admin` tools (`dopl_kb_admin` alone carries delete_base / delete_folder / delete_file), which made v1.1's `dopl_only` **more dangerous than `full`**. The prefix is now valid ONLY in a deny list.
- **Blacklists are version-fragile — `Task` and `MultiEdit` do not exist in this CLI version.** Unrecognized names in `--tools`/`--allowedTools`/`--disallowedTools` are harmless no-ops (verified), so the lists may name tools that exist only in some versions — but that fragility is precisely why **L0 is load-bearing**: the CLI ships far more built-ins than the obvious write/exec ones (Agent, TaskCreate, Artifact, CronCreate, SendMessage, RemoteTrigger, Skill, ToolSearch, …), each an exfiltration, delegation, or persistence channel.
- **Final sets.** `READ_BUILTINS = Read, Grep, Glob, LS, TodoWrite`. **`read_only`** = `READ_BUILTINS` only — no web (`WebFetch`/`WebSearch` are an outbound channel that bypasses approve-out entirely), no Dopl MCP at all (deny the bare prefix + the six admins by name); it answers from stdout, so it needs no tool to reply. **`dopl_only`** = `READ_BUILTINS` + **11 explicitly named non-admin, non-posting Dopl tools** (`dopl_kb`, `dopl_search`, `dopl_map`, `dopl_members`, `dopl_skill`, `dopl_workflow`, `dopl_ontology`, `dopl_chats`, `dopl_cluster`, `current_workspace`, `list_workspaces`), never the prefix. `dopl_channel` is **excluded and denied** here too — otherwise a prompt-injected `dopl_only` agent could post local data straight to a channel, bypassing approve-out; like `read_only` it answers from stdout and its reply routes through the outbound review. **`full`** = no flags at all (v1.1 behavior; the CLI's own gating applies).
- **Pinned by `dopl-desktop-app/test/tool-profiles.test.mjs`.** `session-spawner.js` `require`s electron at module top and can't be imported in a plain Node test, so the test extracts the block fenced by the `BEGIN/END TOOL-PROFILE TABLE` sentinel comments and evaluates the real source verbatim (same trick as `classify.test.mjs`). **Keep the sentinels and keep the block free of electron/fs/path references** or the test breaks.

### Desktop app v1.4 (durable async consent + directory picker, 2026-07-27)

Two rounds ship as **1.4.0**. Round B replaces the blocking consent dialog with a durable, async pending model; Round C adds a per-channel working directory. New main-process modules: `main/consent-watcher.js` (the decision-watcher engine), `main/channel-post.js` (shared post helpers), `main/channel-dirs.js` (the directory picker). `consent.js` is reduced to stateless primitives and `trigger.js` to the consent/spawn resolvers (all ≤500 per §2).

**Round B — consent is a durable async pending item, not a blocking modal.**
- **The blocking `dialog.showMessageBox` is REMOVED** (both the v1.1 in-app dialog and its use as a v1.2 consent surface). It was a crash source: a **no-parent app-modal dialog on a windowless tray app** makes macOS send `terminate:` to the app on dismiss — patched defensively in **1.3.2** with a `before-quit` guard, then the dialog deleted outright here. Consent surfaces are now (1) a **native notification** with an Allow/Send action (Dismiss **parks**, never denies), (2) the **web Pending Requests list** (§8 v1.4), and (3) a tray **"Pending: N"** count.
- **Async watcher (`consent-watcher.js`).** The channel long-poll loop no longer blocks up to 30 min waiting for a decision. On a trigger the desktop **creates the server consent row, notifies, and RETURNS**; a separate watcher polls the operator's own pending rows and **spawns when one flips to `allowed`/`auto_allowed`**; `denied`/`expired` simply drop. A **per-record in-flight lock** makes each row single-resolve, so it can never spawn twice even if two poll ticks observe the same flip.
- **Terminal decisions are persisted** in electron-store (`channelWatched` + `channelSettled` maps, key = `channelId:seq`), so a **restart never re-spawns or re-prompts a settled request**. This killed a replay bug: the permanently-`allowed` server consent row (which by design never reverts) re-spawned the agent on every relaunch, because the desktop had no memory it had already acted on that seq. The maps grow monotonically with seq, no eviction → F-069.
- **Park semantics.** A never-answered request stays a `pending` server row, listed on the web and answerable up to the 24h TTL (§8, `CONSENT_TTL_MS`). **Dismissing a notification never denies** — deny is an explicit action, parking is the safe default (mirroring the v1.1 rule that banner auto-dismiss must not settle consent).
- **Decision echo.** Accept/decline/cancel/interrupt each emit a lifecycle `channel_message` the requester sees live (§8 v1.4 "Decision echo"); the web renders declined/dropped/interrupted CALM via strict `metadata.<flag> === true` checks — a bare `task_failed` is still a real error.

**Round C — per-channel working directory (directory picker, `channel-dirs.js`).**
- **Desktop-local, never server-side.** A `channelDirs` map in electron-store (`channelId → absolute path`) set via the native `dialog.showOpenDialog({ properties: ['openDirectory'] })`. The path is **never sent to the server and never logged** beyond an 8-char channel-id prefix (the `diag()` discipline, §18 v1.1). A tray **"Channel folders"** submenu sets/clears the folder per channel.
- **Used as the spawn `cwd` for BOTH headless and terminal** modes. When unset — or when the stored path no longer exists — the spawn **falls back to the isolated sandbox** (self-healing a vanished directory, no error). The **tool profile still applies on top regardless of cwd** (§18 v1.2 containment); changing the folder never changes what tools the agent has.
- **KEY PRINCIPLE — cwd is CONTEXT + a default, NOT a hard fence.** Pointing a spawn at `~/project` gives the agent that directory as its working root and default read/write target, but the **real bound is the tool profile plus the two consent gates**, not the folder — a Bash-capable agent can still reach absolute paths outside it. A hard per-directory filesystem fence (a process that physically cannot escape `~/project`) would need an OS sandbox (`sandbox-exec`/seatbelt), a **future option**, not what this ships (F-068). The approve-time notification surfaces the blast radius in plain terms ("Runs in ~/project with <profile> tools").
- **Terminal safety preserved.** Even when the spawn runs in the operator's real directory, the **untrusted prompt body still lands in the sandbox** (the per-spawn nonce-named mode-600 file, §18 v1.2 terminal mode) — the channel dir changes where the agent WORKS, never where the untrusted input is staged.

### Desktop app v1.5 (engagement mode — passive task replies, 2026-07-27)

Feature 4 (requester side): on the machine that CREATED an **interactive** task, an inbound reply belonging to that task must NOT raise consent or spawn — it is passive news that a reply landed, surfaced as a silent notification. Responder side and `autonomous` mode are unchanged; full auto-continuation is a NEXT round (F-070). No new endpoint and no new auth — the desktop reads the server-stamped `metadata.taskMode`/`taskCreatedBy`/`taskTarget`/`taskId` (§8 v1.5) straight off the existing await long-poll.

- **New `task-reply` verdict (`main/targeting.js`).** `classify()` gains a branch, placed BEFORE the `to_user_id === me → 'trigger'` rule so it wins over a plain trigger: return **`'task-reply'`** iff `metaStr(m,'taskId')` is set **and** `taskMode === 'interactive'` **and** `to_user_id === myId` **and** `taskCreatedBy === myId` **and** `taskTarget === m.authorUserId`. The task keys are server-stamped (Q4), so they can't be spoofed; `taskCreatedBy === me` separates the REQUESTER (this branch) from the RESPONDER (`taskCreatedBy !== me` → falls through to today's `'trigger'`), and **`taskTarget === the author` binds the suppression to the responder specifically** — a THIRD member posting into my task (author is not the task's target) still triggers instead of being silently swallowed. Everything else (autonomous mode, an old message with no `taskMode`, a non-`message` kind) falls through UNCHANGED. `metaStr` reads arbitrary keys, so no signature change.
- **Dispatch (`main/channel-listener.js`).** Where it branches on the verdict, `else if (verdict === 'task-reply') taskNotify.notifyTaskReply(entry, m)` — no consent row, no watcher registration, no spawn.
- **`main/task-notify.js` (NEW, small).** Exports `notifyTaskReply(entry, m)` — a passive OS `Notification` ("Reply in \<channel / task title\>") that, on click, opens the channel (reuses `openChannelForEntry` through the injected handlers, same seam as `trigger.sendFyi`). No token use, no API write. **Rationale for a new file:** `session-spawner.js` (443/500) and `trigger.js` (430/500) are the two files nearest the `max-lines` cap, so the passive path lands in its own module rather than pushing either over.
- **Out of scope for v1.5:** any responder-side change, any `create_thread`/auto-continuation spawn, and relaxing the `kind === 'message'` inbound guard — task lifecycle markers (`task_*`) stay `'ignore'` inbound (the requester does not spawn on them). Folder-in-popup (web feature 1c) needs NO desktop change; it reuses the existing `channel-dir-ipc.js` handlers via the web create dialog.

### Desktop app resilience (never-black window + fast wake recovery, 2026-07-27)

Fixes a repeatedly-hit field bug: after a network transition (sleep/wake, wifi change) the connection pools hold **dead keepalive sockets** in BOTH stacks — the renderer's Chromium pool AND the main process's own — so a remote load HANGS on the OS TCP timeout (~minutes) while a fresh `curl` is instant. A hung load fires **neither** `did-finish-load` nor `did-fail-load`, so the old `showOffline()` dead end never triggered and `showMainWindow()`'s unconditional `mainWindow.show()` revealed the window's dark `backgroundColor` = the "solid black window that eventually comes in". New module `main/load-guard.js` (all files still ≤500 per §2); no new dependency, no schema, no API change.

- **Two network stacks, two resets.** The renderer loads over **Chromium's** network stack; `main/api.js` (presence + mcp-config) uses the global `fetch`, which in the Electron **main** process is **Node/undici** — a SEPARATE pool. `session.closeAllConnections()` clears ONLY Chromium's; undici needs its own reset. This is why the "presence: beat error This operation was aborted" storm (undici's per-request AbortController firing on dead sockets) persisted for ~3 min after unlock independently of the renderer's black screen.
- **`api.resetPool()` (main/api.js) — dependency-free undici pool reset.** Node's built-in `fetch` reads its dispatcher from the well-known global symbol `Symbol.for('undici.globalDispatcher.1')` on every call, so swapping that symbol for a fresh dispatcher gives all subsequent fetches a clean pool — exactly what `undici.setGlobalDispatcher(new Agent())` does. **We do NOT `require('undici')`:** it is only a dev-transitive dep (`electron` → `@electron/get`), NOT a production dependency, so it is **not bundled** and `require('undici')` throws in the packaged app (verified: `npm ls undici` shows it only under `electron`/`electron-builder`). Instead `resetPool` rebuilds a fresh dispatcher from the **runtime's own dispatcher class** (`new current.constructor()`, version-matched), falling back to the package in dev and to a safe no-op if neither path resolves (the per-request AbortController still bounds any dead socket). `net.fetch` was rejected as the alternative: it is WHATWG fetch and would **strip the manually-set `Cookie` header** (a forbidden request header), breaking api.js's cookie-based auth (auth.js hands it a `Cookie` string, not a session cookie jar).
- **The guard (`load-guard.js`) owns every remote load.** `index.js` no longer calls `loadURL`/`loadFile`/`showOffline` directly — `loadApp`, `navigateToChannels`, and the deep-link load (§18 v1.1) all route through `loadGuard.load(url)`, and `showMainWindow()` calls `loadGuard.ensureNotBlank()` before `show()`. **Loading screen:** before the first remote paint (and on every retry) the guard shows `renderer/loading.html` (same look as `offline.html`); Chromium **paint-holding** keeps that painted frame on screen during the subsequent `loadURL` fetch, so the swap to real content has no black flash. **Watchdog:** a remote load arms an ~11s timer; if neither finish nor fail fires, the guard `webContents.stop()`s it, drops **both** pools (`session.closeAllConnections()` + `api.resetPool()`), keeps the loading screen up, and retries on a **0s / 2s / 5s / then every 10s** backoff. **`did-fail-load` is no longer a dead end** — it shows `offline.html` AND auto-retries on the same backoff. `render-process-gone`/`unresponsive` reload through the guard (F-071 tracks escalating to a full window recreate if reload-in-place proves insufficient).
- **Wake recovery (`index.js` `onWake`, on the existing `powerMonitor` `resume`+`unlock-screen` debounce).** Adds, after `listener.wake()`: `api.resetPool()` (main-process undici pool) and `loadGuard.onWake()` (renderer `closeAllConnections()` + retry a still-unpainted load). The listener/presence long-poll loops already self-recover on `wake()`; the shared-pool resets are the new part and the reason the recovery is now seconds, not minutes.
- **Traffic-light fix (same round).** Removed `titleBarStyle: 'hiddenInset'` from the `BrowserWindow` options — it floated the macOS traffic-light buttons ON TOP of the remote web content (overlapping the app header) with no draggable region, so the window couldn't be moved. The window now uses the standard native title bar (title `'Dopl'` already set); the loading screen renders below it. Every other `BrowserWindow` option (including `backgroundColor`) is unchanged.
- **Pure core is unit-tested.** `load-guard.js` keeps all Electron use inside `createLoadGuard` (the window is injected; nothing is `require`d at module top), so the reducer `decideLoad(state, event)` and the schedule `nextBackoffMs(attempt)` import directly into `test/load-guard.test.mjs` (node `--test`, 20 cases: backoff schedule, per-event transitions, the "only watchdog drops connections" invariant, and hung-load / repeated-failure walks). The timer + `webContents` shell is the Electron boundary and is manually traceable, not unit-tested. **Manual verification pending (F-071):** a real close-lid/reopen + wifi-flip pass against a packaged build — headless tests can't exercise sleep/wake.

### Desktop app v1.7.14+ (auth split, cookie-fallback sign-in, forced thread tags — 2026-07-31)

Two rounds landed here: **Q4** (the listener went dark while the app looked signed in) and **Q5** (the adversarial review of Q4). Both changed load-bearing rules, so read this before touching `main/auth*`, the listener's self-heal, or the session gate.

- **`auth.js` is now four modules, and it RE-EXPORTS all of them.** The §2 500-line cap forced the split, and the layering is deliberate (no cycles): `auth-store.js` (safeStorage blob + the JWT decoders + the throttled `authFail` diag) ← `auth-cookies.js` (everything that touches the Electron cookie jar) ← `auth-state.js` (`isSignedIn` / `ensureSignedIn` / blob repair / `identityMismatch` / `signOut`) ← `auth.js` (the deep-link CSRF gate, the Realtime credential choice, the Supabase refresh, the Cookie header). **THE RE-EXPORT RULE: every new public symbol added to a sibling MUST be re-exported from `auth.js`.** Call sites all say `auth.x()` and the suites assert that (`test/auth-signed-in.test.mjs`), so a symbol that lives only on the sibling is invisible to production. Sign-in/sign-out ACTIONS live in `main/auth-actions.js` and the menu-bar template in `main/app-menu.js` — both extracted from `index.js` at the cap; `auth-actions` exists so the M4 login-CSRF nonce is armed in exactly ONE place whichever entry point (web page `window.open`, or the tray "Sign in…") starts the flow.
- **THE NEW DEFINITION OF "SIGNED IN" — `blob OR a fresh cookie identity`. Anywhere a doc, comment or plan still says "signed in = the encrypted deep-link blob", it is WRONG.** The old rule was literally `isSignedIn() = !!loadSession()`. That blob's refresh token rots independently of the web cookie session and its ONLY writer is the CSRF-gated deep-link capture, so when it died the listener, presence, the consent watcher and `mcp-config` all went dark AT ONCE while the app's own window rendered perfectly signed in on its cookies — no sign-in prompt (the UI looked fine) and, until Q4, no sign-out control, so field recovery was deleting the app's Cookies store by hand. Now: `isSignedIn()` stays SYNC (presence/watcher ticks call it) and decides over the blob plus a CACHED cookie identity `{userId, at}` with a 10-minute TTL, refreshed by every 5-minute reconcile and every `powerMonitor` wake; a sync miss kicks ONE cooldowned (30s) background probe. `ensureSignedIn()` is the ASYNC gate for the two callers that can await — `reconcileInner` and `ensureMcpConfigInner` — because both run at boot BEFORE any probe has warmed the cache, and a sync read there is what wedged `want=0` across reboots. A live cookie session also REPAIRS the blob (`rebuildBlobFromCookieSession`), entirely client-side: the `@supabase/ssr` cookie carries the whole Session including the refresh token, so no server route was needed.
- **The jar is HOST-locked, not "origin-locked" — and that phrase used to be a lie (Q5 S3).** The nonce-free blob rebuild is justified ONLY by the jar being unwritable by anyone else, and two things broke that: both readers filtered by cookie NAME alone, so a `.usedopl.com` DOMAIN cookie set by ANY sibling subdomain was read as ours; and in-window navigation admitted every `*.usedopl.com` host, so such a page ran inside the app window. Now `auth-cookies.isOurAuthCookie` requires the cookie to be HOST-ONLY for the `APP_ORIGIN` host (a leading dot is stripped, then compared `===`, so `.usedopl.com` fails), both `readCookieSession` and `getSessionCookieHeader` use it, and `auth-actions.isAppOrigin` (which REPLACED the loose `isAppUrl`) locks in-window navigation and the `?state=` nonce arming to the exact origin. Everything else goes to the system browser, as it already did for non-app URLs.
- **Identity is CROSS-CHECKED; a conflicted machine adopts nothing (Q5 S4).** `signedInFrom` compares the blob's `sub` with the cookie identity's `userId`. Disagreement → `source:'conflict'`, `mismatch:true`, still `signedIn:true` (a usable credential exists), the rebuild REFUSES to adopt either side, and `reconcileInner` drops its cached `myUserId` each pass so nothing keeps classifying another account's traffic under a stale identity. Resolution is an explicit sign-out; the state is diag'd loudly on every probe.
- **`signOut()` tears down FOUR credentials (2026-07-31), not two.** The Supabase blob, the cookie jar, the **MCP device token** (Q5 S2), and the **Claude inference token** (below). The device token is a separate 90-day `dopl.read`+`dopl.write` bearer living in electron-store (`mcpDeviceToken` / `…Plain`) AND in `userData/mcp-spawn.json`; `mcp-config.clearDeviceToken()` removes both copies and the memoized in-process one. **F-085 added the server half: `mcp-config.revokeDeviceToken()` calls `DELETE /api/auth/mcp-device-token` with the label this machine MINTED under (persisted alongside the token, so a renamed host still revokes the right row), and `signOut()` calls it FIRST — the route is `sessionOnly`, so it authenticates on the very cookie jar sign-out is about to clear.** It is bounded (`REVOKE_TIMEOUT_MS` 3s, plus an outer `withTimeout` race because `getAuthCookie()` can await a refresh before the fetch's AbortController starts) and best-effort: offline / 5xx / timeout all fall through to the local teardown, and the diag line names the residual in words the operator can act on. Residual: the user-scope `dopl` entry in the CLI's own config is still not touched — `ensureMcpConfig` only adds it when confirmed absent, so an existing entry may be the operator's own, and after a successful revoke its bearer is dead anyway (401, refreshed on next sign-in). Pinned by `dopl-desktop-app/test/device-token-revoke.test.mjs`.
  - **The revoke verdict is FOUR-valued, and `res.ok` is not one of them (2026-07-31).** `revokeDeviceToken()` returns `'revoked' | 'no-match' | 'none' | 'failed'`. It used to return `'revoked'` on any `res.ok` without reading the body, but the route is **idempotent by design** — an unknown label is a quiet `200 {ok:true, revoked:0}` — so a DELETE that matched nothing printed "+ revoked server-side" over a live 90-day bearer. **Why that is the common case, not a corner one:** the mint label is only persisted with the token as of this round, so every already-installed machine has a label-less record until its next 90-day re-mint and falls back to a recomputed `os.hostname()`, which drifts on macOS (Bonjour renames, `Foo` vs `Foo.local`). The count is now parsed; `0` ⇒ `'no-match'`, which gets its own sign-out wording naming the still-valid token and the Connected-apps remedy. A `200` with no readable count is NOT downgraded (the request provably reached the route) but the log says the count was missing. The local teardown runs on every verdict. Pinned by `dopl-desktop-app/test/device-token-revoke-count.test.mjs`. **Server-side follow-up (not yet done):** `POST`'s `BodySchema` falls back to the default label `"Dopl Desktop CLI"` on an invalid `label`, while `DELETE`'s `RevokeSchema` **400s** on the same input — so a label the mint silently rewrote (e.g. >120 chars) can never be revoked by the client that sent it. Reconcile the two schemas.
  - **THE CLAUDE INFERENCE TOKEN — the credential that used to survive sign-out (2026-07-31).** `main/claude-token.js` holds an `sk-ant-*` Claude OAuth token, and BOTH spawn paths inject it as `CLAUDE_CODE_OAUTH_TOKEN` (`claude-resolve.spawnEnv` for headless, `session-auth.withStoredCredential` for the session window). `clearStoredOAuthToken()` existed with **zero callers**, so: sign out → hand the Mac over → the next person signs in → their agent sessions ran on the FIRST operator's Anthropic account, bill and rate limits included. `signOut()` now clears it, unconditionally, after the device-token teardown. **The design call, and why it is not a judgement call:** that store has exactly ONE writer — `claude-auth.js`'s tier-2 flow, where Dopl itself drives `claude setup-token` under a pty from a Dopl dialog and captures the token the child *prints*. A `setup-token` run in the operator's own terminal prints there; an interactive `claude /login` stores in the CLI's own keychain/credentials file, which this app never reads (`session-auth.cliStoreSignedIn` reads MARKERS, never a secret). So the key can only ever hold a credential Dopl minted. **What clearing does NOT do is revoke it at Anthropic**, and the sign-out log line says exactly that rather than implying the token is dead. Pinned by `dopl-desktop-app/test/signout-claude-credential.test.mjs`.
- **A broken keychain no longer downgrades the credential.** `auth-store.persist` used to fall back to writing the session (refresh token included) as PLAINTEXT when `safeStorage.isEncryptionAvailable()` was false. It now REFUSES, logs once (throttled), and deletes any plaintext blob an older build left. Safe precisely because of the new signed-in definition: the cookie jar carries the session for that run.
- **`refresh()` is single-flight, and the cookie writeback SETS BEFORE IT PRUNES (Q5 S6).** Supabase ROTATES the refresh token on use, so N concurrent refreshes mean one winner and N-1 400s — and the 400 handler DROPS the stored blob. Only `getAccessTokenInfo` had a cooldown; `ensureFresh()` (the listener's per-workspace retry path) called `refresh()` directly with no bound at all. Now one shared in-flight promise. Separately, `writeSessionCookies` used to CLEAR the jar and then set the chunks, leaving it EMPTY across an await — every concurrent reader saw "signed out" and kicked its own repair. It now writes every chunk first and removes only the names the new session does not occupy. Together these were an amplification path from one transient 5xx to a real `clearSession()`.
- **`listChannels` / `listWorkspaces`: `null` means "COULD NOT ASK", `[]` means "there are none".** This distinction is load-bearing and must not be collapsed. The old contract returned `[]` for every failure, so `reconcile` could not tell an empty workspace from an unanswered read and the prune step deleted every loop of a workspace whose enumeration failed inside an expired-token window (the 02:18 incident: the app ran all night watching nothing). Rules now: `404` → `[]` (a real, stable answer — the Channels feature is not deployed); `401` / other non-OK / thrown fetch / unparseable body → `null`; a `null` workspace is added to `failedWorkspaces`, its loops SURVIVE the prune (`heal.keepLoopOnPrune`), and ONE follow-up reconcile is scheduled. **`lastGoodWorkspaceIds` is assigned even when the answer is EMPTY (Q5 S8)** — a successful enumeration of nothing is an answer, and the old `if (wsIds.length)` guard left an operator who had left every workspace re-subscribing push to them every 5 minutes forever.
- **Self-heal is bounded on BOTH axes (`main/listener-heal.js`).** A realtime wake that finds no loop re-enumerates at most once per 60s window AND at most `MISS_GIVE_UP_COUNT` (5) times per channel EVER (Q5 S7) — past that the channel is parked and the periodic 5-minute reconcile is the only thing still looking for it, because re-deriving the same set a sixth time cannot produce a different answer. A per-workspace enumeration failure walks a short in-pass ladder (1s, 3s) and then schedules ONE follow-up pass. The in-pass retry now performs the session-refresh dance **only on a 401** (Q5 S6): a refresh cannot fix a 500 or a dead socket, and running it anyway rotated the token on every blip. `healer.stop()` (a listener restart) is the reset for a parked channel.
- **The tray takes the signed-out FACT as a boolean, never a string match.** `channel-listener.setStatus` passes `{signedOut: running && !auth.isSignedIn()}` alongside the status line; `tray.authMenuState(signedOut)` is a pure boolean→descriptor function. It used to run `/signed out/i` over the status STRING, so rewording "Listener: signed out" would have silently deleted the app's only sign-in entry point.
- **WAKE-V1: a session's own replies are THREAD-TAGGED, and main enforces it.** An addressed, agent-authored, thread-LESS reply is indistinguishable from a fresh request on the peer's machine — the requester raised consent and spawned a counter-session against the answer to its own question. Two layers now:
  1. **The prompt names the call**, including for the LEGACY `task-<channel>-<seq>` ids the desktop mints when a request arrives without `create_thread` (`prompt-framing.deliverySection`). **The argument is `thread`, NOT `task`** — the 1.7.11 cutover made `thread` the agent-facing parameter and left `taskId` as the storage key it folds into (§8). The first version of this fix emitted `task "<id>"`, a parameter `dopl_channel` does not have, which made the whole thing inert on the window path (F-081, Q5 S1). Nothing in a built prompt may teach `task=` again; the `kind="task_*"` post kinds are real and stay.
  2. **`main/session-outbound-tag.js` forces it anyway.** A live capture on a FIRST-CLASS thread showed the agent simply omitting the argument despite a correct prompt. `makeCanUseTool` computes a tag for the session's OWN channel post and, on an ALLOW, returns `{behavior:'allow', updatedInput}` (the Agent SDK's `PermissionResult` carries `updatedInput`; pinned `@anthropic-ai/claude-agent-sdk` 0.3.220). **Invariants: it rides a verdict and never makes one** — `grantDecision` runs first and never sees the tag, the deny branch is untouched, and a gated call gains the argument only on the OPERATOR's allow. It never overwrites a thread id the agent supplied (via `thread` or a `metadata.taskId` copy); a DIFFERENT id is left alone and diag'd. `session-io.js` stays electron-free, so the log function is injected from `session-engine` (`makeCanUseTool(s, dispatch, diag)`).
  3. **Consequence for `session-history.taskWindow`:** reply MESSAGES of a legacy exchange are now stamped too, not only its lifecycle events. The code was already kind-agnostic; the comment that claimed otherwise was corrected.
- **The legacy-thread registry is OPENERS-ONLY with a 6h TTL (`targeting.js`, Q5 S5).** It is the only local record of a thread this machine opened WITHOUT `create_thread`, and a hit downgrades an inbound reply to a passive banner with no consent row. It recorded every addressed own message — and since v2.6 the server auto-addresses every post in a DM — while `metadata.taskId` stays caller-settable for legacy ids with no participation check (F-083). So a peer could stamp a NEW request with an old id and never face a gate. Now only a message carrying NO inbound taskId opens a record (the id is the OPENER's seq, so multi-turn still matches), entries expire after `LEGACY_THREAD_TTL_MS`, and the 500-entry cap stays. Every miss fails toward `trigger` — a consent prompt, never a swallowed message.
- **KNOWN GAP, not fixed here: the session window has NO auth-error recovery.** The Agent SDK rides the machine's **Claude Code CLI** keychain credential — a THIRD credential, separate from the Dopl account and the Claude desktop app — and the auth-shaped-error → `claudeAuth.startSignInFlow` recovery exists only on the headless path (`trigger.js`). An SDK auth failure in a session window renders as a dead-end "Please run /login" bubble and settles `task_failed`. Queued as **Q6** in `~/Downloads/CHANNELS-FIX-QUEUE.md`; do not re-diagnose it.

---

## Appendix A — ESLint rules to add

- `import/order` with groups: builtin, external, internal (`@/` alias), parent, sibling, index.
- `no-restricted-imports` forbidding deep feature imports (`@/features/*/server/*` from client components).
- `max-lines` at 500 (warn), 700 (error), with the exceptions from §2.
- `@typescript-eslint/no-explicit-any` error.
- `@typescript-eslint/no-unused-vars` error.
- `no-console` warn (allow `console.warn`, `console.error`).

## Appendix B — `CLAUDE.md` pointer

This doc is the source of truth. `CLAUDE.md` should be short and end with:

```
For all code organization, naming, and architectural decisions,
follow docs/ENGINEERING.md. When it conflicts with existing code,
the doc wins and the code is a refactor candidate.
```

### 2026-07-31 — the three HIGH release blockers (H1 auth hold, H2 permission arm, H3 sender binding)

Three defects that composed into one another. All desktop-side unless marked.

**H1 — an auth hold must be a state the whole engine understands.** `session-auth.js` recorded a held session ONLY as `s.authHold`, a field no other module could see, while stamping `s.state.phase/parked/activity` by hand. Two failures followed, and the second was only reachable because of the first:
- `session-reducer.wakeEffects` saw nothing but `parked` and RESUMED held sessions. A peer follow-up on a channel seeded `auto_both` was enough: inbound → auto-accepted → wake → `session-park.resumeParked` spawned the SDK on a Mac with **no Claude Code credential**, and a later sign-in started a SECOND query beside it — two `claude` children for one request, the orphan still holding the session's pre-approved `dopl_channel` access.
- `holdIfAuthFailure`'s "already held" branch returned "handled" having done nothing, so a session the wake had dragged back to `phase:'running'` stayed there forever: no query, no idle timer (`scheduleIdle` only arms on `launched`), nothing that could park or settle it, and a peer awaiting a reply that never came.

The hold is now the reducer event **`auth_hold`** (and `auth_release`), setting `state.authHeld`. **Rules, all tested:** a hold IS a park (same `parkEffects` — `denyPending` fail-closed, then `abortQuery`, `clearIdle`, persist `parked`) and resets both axes and every standing grant, for idle_timeout's reason; `wakeEffects` refuses to resume while `authHeld`; `inboundAutoAccepted` returns false while `authHeld`, so a peer message is HELD beside the sign-in button instead of being pushed onto a dead iterator; `session-gate.decideInbound` refuses an ACCEPT **before** shifting the head, so the message stays queued and the card stays answerable (a DECLINE still works — dropping needs no agent); both events are idempotent. `resumeAfterSignIn` and `runSignIn` are single-flight, and **`session-query.startQuery` now calls `abortInFlight(s)` BEFORE assembling anything** — that is the real backstop for the two-children bug and holds whatever the caller does.

**H2 — a stored permission posture may only apply to a launch a human is approving in that moment.** `startSession` is the single construction site for EVERY spawn shape, and it folded the channel's stored preset in unconditionally via `channel-context.startingModes`. Storage was per-channel, permanent, no TTL, no delete. So one consent card's `bypass`/`auto_both` silently re-armed the channel forever: days later a peer reply → `recreateParkedShell` → wide-open start → auto-accepted inbound → wake → the agent ran with Bash/WebFetch pre-approved and auto-outbound posting, **no card, no click**. Before that change every recreated shell started manual/ask.

The fix is an **arm**, not a setting (`main/channel-prefs.js`), enforced three ways because each closes a different hole: **(1) single use** — `consumePermissionPreset` returns the pair and deletes it in one call; **(2) expiring** — `ARM_TTL_MS` 30 min, and a record with no `at` (a pre-H2 durable preset) is treated as EXPIRED so an upgrade can only ever narrow; **(3) one consumer** — only `trigger.inboundApproved` consumes it, and only when `meta.humanAllowed` is true. `consent-watcher.isHumanAllow` distinguishes `allowed` (a person clicked) from `auto_allowed` (standing server-side trust) and passes the verdict as a **call argument, never stamped on the persisted record** — an authority verdict must not survive a restart and re-authorize a launch from disk. `channel-context.startingModes` is **deleted**: the posture now travels only as an explicit `spec.startModes`, so there is no ambient read for a future spawn shape to inherit by accident. A parked shell refuses a posture even if one is handed in. Deny/expiry clear the arm (`trigger-outcomes.js`). Nothing in the session path ever writes an arm back.

`test/session-preset-start.test.mjs` previously regex-matched reducer SOURCE TEXT and never drove `recreateParkedShell` or `session-park.startResume` — the two paths that actually re-applied the preset — so it could not have failed while the bug was live. It now drives the real construction site and asserts the resulting axes per shape.

**H3 — `main/channel-dir-ipc.js` was renderer-reachable with no sender binding.** All SIX handlers validated their payload and never their caller, while `renderer/preload.js` exposes them on the window that loads REMOTE `usedopl.com` content. `setPermissionPreset` was the HIGH (chained with H2 it was zero-click local execution), but `chooseFolder` (native dialog on demand), `clearFolder`, `getFolderLabel` (leaks a local path fragment), `getPermissionPreset` and `sessions:reopen` were all equally unbound. Every handler now goes through `mainOnly()`, which checks **two** things: the sender is the main window's `webContents`, **and** it is that window's TOP frame — a cross-origin iframe SHARES its host's `webContents`, so identity alone would let embedded content drive all six. Fails closed on a missing/destroyed/unbuilt window, on a `senderFrame` getter that throws (a detached frame), and when `register()` is given no `getMainWindow` accessor at all. The refusal shape deliberately matches an invalid-payload rejection so a hostile page cannot use the difference to probe. `index.js` passes a lazy accessor (the window is built after `register()` and replaced on reopen). A structural test asserts every `ipcMain.handle` in the file is wrapped, so a new op cannot be added unbound.

**§2 splits this required** (all three parents were at or within one line of the 500-line cap): `main/session-query.js` (SDK option assembly + `startQuery`/`consume`/`abortInFlight`, out of `session-engine.js`); `main/session-effects.js` (the reducer's pure effect builders — `gatePhase`, `endedEmit`, `endLifecycle`, `endEffects`, `modesEmit`, `parkEffects` — out of `session-reducer.js`); `main/trigger-outcomes.js` (the no-reply terminal echoes, out of `trigger.js`). `session-reducer.js` requires the effect builders at module scope ABOVE its sentinel, so inside the block they are free vars and the two sentinel blocks CONCATENATE back into the standalone program the extraction tests always evaluated. **`test/_reducer-block.mjs` is now the one place that slices them** — eight test files share it, so the next split costs one edit instead of eight.
