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

| File | Lines | Reason |
|------|-------|--------|
| `src/features/skills/components/skill-view.tsx` | 759 | First in queue: extract editor/save-chain hook + header controls (grew with concurrency hardening + metadata CAS). |
| `packages/mcp-server/src/server.ts` | 612 | Borderline: registration + gating core; watch it. |
| `packages/mcp-server/src/tools/knowledge.ts` | 597 | Borderline: single-tool module; split ops-vs-render if it grows. |
| `packages/dopl-client/src/client.ts` | 592 | Scheduled: continue per-domain method-group extraction. |
| `packages/mcp-server/src/tools/workflow.ts` | 588 | Borderline: single-tool module. |
| `packages/mcp-server/src/tools/ontology.ts` | 586 | Borderline: single-tool module (render half already in ontology-render.ts). |
| `src/features/workspaces/server/invitations.ts` | 517 | Borderline: watch it. |
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
- **Optimistic concurrency everywhere.** `dopl_ontology` object writes now take an optional `expected_version` (= object `updated_at`), sent as `X-Updated-At`, checked via `.eq('updated_at', …)` → 412 `ONTOLOGY_STALE_VERSION` (matches the KB/skills CAS contract). Skill body CAS token moved off a JS millisecond timestamp to a DB microsecond trigger (`20260718000020`).
- **Workspace targeting is fail-closed + legible.** A blank/whitespace `workspace=` now errors instead of silently falling through to the session default (server.ts `wrapped`), and the `_dopl_status` footer reports the **effective** per-call workspace (with a note when it differs from the session default) — not just the session default.
- **The compiled `dist/` can no longer go stale.** `@dopl/mcp-server` and `@dopl/client` ship committed `dist/` that the app loads at runtime (`serverExternalPackages`). Root `build` now runs `build:packages` (rebuilds both `dist/` from src) before `next build`, so a src change can never ship behind a stale `dist/`. **When you edit either package's `src/`, rebuild its `dist/` (or run `npm run build:packages`) before committing.**

### Realtime & new-workspace seeding (2026-07-17)

- **Realtime:** every content surface streams agent/MCP writes live. Publication covers knowledge_*, skills, skill_versions, workflow_*, ontology_*, chats/chat_messages/chat_folders. Per-feature subscribers live in `features/<name>/client/realtime.ts` on the shared `useWorkspaceTablesRealtime` refetch-signal pattern (events trigger a filtered service refetch — never payload merging, so RLS + service filters like the chats retention window stay authoritative). `src/shared/realtime/refetch-coordinator.ts` defers refetches while local debounced edits are pending — any new live surface MUST use it or it will clobber in-flight typing.
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

### Billing & entitlements (workspace per-seat model — 2026-07-16)

Billing is **workspace-level**, not per-user. The per-user 24h trial, `DEMO_PAYWALL_BYPASS`, `PaywallGate`, and the trial-reactivation cron are retired; `profiles.subscription_*` columns remain in the DB but are never written.

- **Source of truth:** `workspace_billing` (one row per workspace; plan `free|pro`, status `free|active|past_due|canceled`, Stripe ids, `seat_count`). RLS: member SELECT, service-role-only writes (no client write policies). All writes come from the Stripe webhook (`features/billing/server/webhook-handler.ts`, idempotent via `webhook_events`).
- **Pro is per-seat:** `STRIPE_PRO_SEAT_PRICE_ID` ($7.99/seat/mo), subscription quantity = active member count, auto-synced by `features/billing/server/seats.ts#syncSeatQuantity` from the membership mutation sites (invitation accept, join-request approve, member remove). Legacy per-user subs (the $20 price) grandfather to the owner's default workspace via the webhook fallback.
- **The gate surface:** `features/billing/server/entitlements.ts` — `getWorkspaceEntitlements`, `assertCanCreateObject`, `EntitlementError("over_free_cap")`, `entitlementDeniedBody`. Free rules: solo = uncapped; 2+ members = `FREE_MULTI_MEMBER_OBJECT_CAP` (1,000 ontology objects, creates frozen over cap — reads/edits/deletes never gated); chats visible window `FREE_CHATS_WINDOW_DAYS` (90; hide never delete, via the `chats_retention_cutoff` DB function + service-layer filter in `chats/server/service-reads.ts`). `past_due` keeps Pro entitlements; `canceled` reverts to free rules. Ontology's `service.ts` importing the entitlements module is the **sanctioned** cross-feature exception to §3 (it is the designated gate).
- **Plan-gate error envelope:** flat `{ error: <code>, message, upgrade_url }` (codes: `over_free_cap`, `chat_outside_retention`), distinct from the canonical nested envelope; `upgrade_url` always points at `/pricing` (there is no `/settings/billing` route). `@dopl/client` parses it (`upgradeUrl` on `DoplApiError`), the web `apiRequest` (`shared/api/api-client.ts`) surfaces the code when a sibling `message` is present, and the MCP server's `entitlementDenied` guard (`tools/respond.ts` + `runWithEntitlementGuard`) surfaces the message + upgrade link verbatim to agents. Rebuild `packages/dopl-client/dist` after touching its src — the MCP server consumes the built package.
- **Webhook hardening:** `workspace_billing.last_stripe_event_created` is an event-ordering watermark — handlers skip any Stripe event whose `event.created` is <= the stored value (out-of-order `updated` can never resurrect a canceled sub). `invoice.payment_succeeded` only recovers a workspace whose stored subscription id matches the invoice's. `incomplete`/`incomplete_expired`/`unpaid` map to `canceled` (not entitled); `past_due` grace is only for Stripe's literal `past_due`. Checkout blocks whenever a non-canceled subscription exists (409 → portal) and passes an idempotency key. `webhook_events` claiming is atomic (update-where-unprocessed).
- **Retention specifics:** the chats append endpoint returns `messages: []` when the chat is outside a free workspace's window (append allowed, transcript not echoed). Team-scoped chat reads are enforced in RLS too (`20260716150000_chats_team_aware_rls.sql`), mirroring `canSeeChat`. Known accepted gap: an OWNER can still read their own >90-day chats via direct PostgREST — the window is a product gate, not a security boundary (F-035).
- **Client read:** `useWorkspaceEntitlements` (features/billing/components) is the single client-side billing read (TanStack-cached `GET /api/billing/status`); do not add parallel fetch hooks.
- **Instrumentation:** `withWorkspaceAuth` logs every MCP-authenticated op to `mcp_tool_calls` (insert-only, service role; admin SELECT). This feeds future usage analytics — keep the write fire-and-forget.

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
- `withWorkspaceAuth(handler, { minRole })` (`with-workspace-auth.ts`) — composes `withUserAuth`; resolves the active workspace, verifies membership + `meetsMinRole`. The default for workspace-scoped content routes.
- `isAdmin(userId)` (`with-auth.ts`) — site-admin check vs `ADMIN_USER_ID` env.
- `requireCronSecret(request)` (`require-cron-secret.ts`) — bearer gate for `/api/cron/*`, fail-closed 503 when unset.

Service-layer gates: `requireWorkspaceRole(workspaceId, userId, minRole)` in `src/features/workspaces/server/authz.ts` (the one membership-fetch + role-check helper — don't re-roll it), and the pure member-management hierarchy in `src/features/workspaces/member-policy.ts` (`memberManageDenial` / `canGrantRole` / `canShowMemberControls`, shared with the members UI).

They handle: Bearer OAuth access tokens (`dopl_at_`, validated via `mcp-oauth.ts`), Supabase session cookies, OAuth-subject rate limiting, and automatic 5xx system-event logging.

### Shared API helpers

Available in `src/shared/`:

- `src/shared/lib/http-error.ts` — `HttpError` class with `status`, `code`, `message`, `details` + convenience constructors (`HttpError.badRequest`, `.unauthorized`, `.notFound`, ...).
- `src/shared/api/parse-json.ts` — `parseJson(req, schema)` parses JSON body and zod-validates. Throws `HttpError(400, INVALID_JSON | VALIDATION_FAILED)` on failure.
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
standard macOS menu. It is **inert for the Vercel/Next build** (`node_modules/` and
`dist/` are gitignored; nothing imports it).

### Layout
- `main/index.js` — app entry (window, menu, navigation/link handling).
- `renderer/preload.js` — minimal context-isolated bridge (`window.dopl`).
- `renderer/offline.html` — shown on `did-fail-load`.
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
