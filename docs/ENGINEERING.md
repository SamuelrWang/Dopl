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

---

## 1. Target Project Structure

```
setup-intelligence-engine/
├── docs/                          # This file, ADRs, runbooks
├── packages/
│   ├── chrome-extension/          # Browser extension (webpack build)
│   └── mcp-server/                # MCP server
├── public/                        # Static assets
├── scripts/                       # One-off ops scripts (tsx-run)
├── supabase/
│   └── migrations/                # SQL migrations (source of truth for schema)
├── src/
│   ├── app/                       # Next.js App Router (routes + route handlers only)
│   │   ├── (marketing)/           # Route groups for layout segmentation
│   │   ├── (app)/                 # Authenticated app shell
│   │   ├── api/                   # Route handlers — thin, delegate to features/
│   │   └── layout.tsx
│   ├── features/                  # ← NEW: feature modules (see §3)
│   │   ├── canvas/
│   │   ├── chat/
│   │   ├── ingestion/
│   │   ├── clusters/
│   │   ├── billing/
│   │   ├── community/
│   │   ├── knowledge-packs/
│   │   └── onboarding/
│   ├── shared/                    # ← NEW: cross-feature primitives only
│   │   ├── ui/                    # Design system (Button, Dialog, etc.)
│   │   ├── lib/                   # Pure utilities (formatDate, cn, etc.)
│   │   ├── hooks/                 # Generic hooks (useDebounce, useMediaQuery)
│   │   ├── types/                 # Truly shared types (ApiError, Result)
│   │   ├── api/                   # parse-json, error-handler (shared route helpers)
│   │   ├── auth/                  # Route wrappers (withUserAuth, withMcpAccess, withAdminAuth)
│   │   └── supabase/              # Supabase client factories (browser/server/admin)
│   ├── config/                    # Environment, flags, constants
│   ├── middleware.ts
│   └── proxy.ts
├── eslint.config.mjs
├── next.config.ts
├── package.json
└── tsconfig.json
```

### Migration notes (current → target)

- `src/lib/canvas/`, `src/lib/clusters/`, `src/lib/community/`, `src/lib/ingestion/`, `src/lib/billing/`, `src/lib/knowledge/` → move into `src/features/<name>/`.
- `src/lib/supabase/`, `src/lib/utils.ts`, `src/lib/analytics/` → `src/shared/`.
- `src/components/canvas/*`, `src/components/billing/*`, `src/components/entries/*` → `src/features/<name>/components/`.
- `src/components/ui/` → `src/shared/ui/`.
- `src/hooks/use-speech-recognition.ts` → `src/shared/hooks/` (it's generic).
- `src/types/entry.ts`, `src/types/api.ts`, `src/types/manifest.ts` → co-locate inside the owning feature; keep only cross-cutting types in `src/shared/types/`.

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
- Single-function switch reducers where the switch is one coherent state machine — splitting by action type fragments the state transitions across files and makes the reducer harder to reason about. (Currently: `src/components/canvas/canvas-store/reducer.ts` at ~800 lines.)

Existing files over 500 lines (refactor queue below) are grandfathered *only* until their scheduled split phase. Once touched, they must be split or the edit must shrink them.

**When you see a large file, split by:**
1. **Responsibility** — one file per "reason to change" (reducer vs. persistence vs. selectors).
2. **Layer** — handler vs. validator vs. service vs. data-access.
3. **Sub-feature** — if the feature has natural seams (per-platform extractors, per-tool handlers), give each its own file.

### Current offenders (refactor queue, ordered by ROI)

Updated after P2. Files marked ✅ have been addressed.

| File | Lines | Split target | Status |
|------|-------|--------------|--------|
| `src/components/canvas/canvas-store.tsx` | 1224 | `store/reducer.ts`, `store/persistence.ts`, `store/selectors.ts`, `store/context.tsx`, `store/actions.ts` | P5a |
| `src/features/ingestion/server/pipeline.ts` | 1212 | `pipeline/orchestrator.ts`, `pipeline/extractors/*.ts` (may already exist — see F-001), `pipeline/link-follower.ts`, `pipeline/embed.ts` | P3a |
| `src/app/api/chat/route.ts` | 1141 | `route.ts` (dispatcher only) + `features/chat/server/tools/<tool-name>.ts` per tool | P4 |
| `src/app/page.tsx` | 823 | Still monolithic `Home` component; carve hero/nav/features/CTA sections into `features/marketing/components/*` | P6 |
| `src/components/canvas/panels/chat/chat-panel.tsx` | 897 | Split into `chat-panel.tsx` (shell), `chat-messages.tsx`, `chat-input.tsx`, `chat-attachments.tsx` | P3c |
| `src/components/canvas/canvas.tsx` | 870 | `canvas.tsx` (shell), `canvas/use-viewport.ts`, `canvas/use-interactions.ts` | P5b |
| `src/features/community/server/service.ts` | 861 | Keep boundary with `features/clusters/server/service.ts`; if overlap grows, split by topic (publishing / forking / querying) | P3b |
| `src/features/ingestion/server/skeleton.ts` | 847 | `skeleton/entry.ts`, `skeleton/descriptor.ts`, `skeleton/prompt.ts` | P3a |
| `src/components/canvas/use-panel-ingestion.ts` | 816 | `use-panel-ingestion.ts` (glue) + `ingestion-client.ts` (pure client-side fetch wrapper) | P5b |
| `src/components/canvas/canvas-panel.tsx` | ✅ 308 | Done — drag/resize/expiry extracted | P2.4 done |
| `src/features/clusters/server/service.ts` | 516 | Marginally over; reasonable split is `service.ts` (CRUD) + `service-brain.ts` (cluster-brain canvas panel spawn logic, lines 223–340) | P6 cleanup |

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
| Directories | `kebab-case` | `knowledge-packs/`, `canvas/` |
| React components (exported name) | `PascalCase` | `ChatPanel`, `CanvasStoreProvider` |
| Functions | `camelCase` | `extractWebContent`, `normalizeTag` |
| Hooks (file + fn) | `use-kebab-case.ts` exporting `useCamelCase` | `use-chat.ts` → `useChat()` |
| Constants (module-level) | `SCREAMING_SNAKE_CASE` | `MAX_LINK_DEPTH`, `CHUNK_SIZE` |
| Local consts | `camelCase` | `const now = Date.now()` |
| Types/interfaces | `PascalCase`, **no** `I`-prefix, **no** `Type`/`Interface` suffix | `Entry`, `IngestRequest` |
| Enums / union type names | `PascalCase` | `SourceType`, `PanelKind` |
| Redux-style actions | `SCREAMING_SNAKE_CASE`, `DOMAIN_VERB` | `PANEL_MOVE`, `CLUSTER_CREATE` |
| API route segments | `kebab-case` | `/api/knowledge-packs/[packId]/sync` |
| Dynamic route params | `camelCase` in brackets | `[packId]`, `[panelId]` |
| DB tables | `snake_case`, plural | `canvas_panels`, `knowledge_packs` |
| DB columns | `snake_case` | `entry_id`, `created_at` |
| Env vars | `SCREAMING_SNAKE_CASE`, `NEXT_PUBLIC_` prefix for client | `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` |
| Booleans | `is*`, `has*`, `should*`, `can*` | `isPending`, `hasAccess` |
| Event handlers | `on*` (prop), `handle*` (internal) | `onClick={handleSubmit}` |
| Async functions | verb-first; no `Async` suffix | `fetchEntries()`, not `fetchEntriesAsync()` |

### Actions (canvas-store)

Current format is excellent: `DOMAIN_VERB` (e.g., `PANEL_MOVE`, `CLUSTER_CREATE`). **Audit for drift when splitting the store** — a few legacy names use `VERB_DOMAIN` (`MOVE_PANEL`, `CREATE_CLUSTER`). Normalize to `DOMAIN_VERB` during the refactor.

### Known inconsistency to fix

`packages/chrome-extension/src/panel/components/*.tsx` uses `PascalCase` filenames (`EntryCard.tsx`, `ClusterBadge.tsx`). The main app uses `kebab-case` (`entry-card.tsx`). **Rename chrome-extension files to kebab-case** to match.

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
import { createServerClient } from "@/shared/supabase/server";
import { assertUser } from "@/shared/auth/assert-user";
import type { Entry } from "@/features/entries/types";

// 4. Relative
import { mapEntryRow } from "./dto";
import { MAX_CHUNKS } from "./constants";
```

Enforce via ESLint `import/order` when the refactor lands.

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
| **Server state** | TanStack Query (to be added) | Anything that comes from Supabase or an API |
| **Canvas client state** | `canvas-store` (context + reducer) | Viewport, panel positions, in-flight chat streams |
| **Local UI state** | `useState` / `useReducer` | Form values, open/closed, hover |

**Do not** put server data in the canvas store. The current store has `entries`, `clusters` etc. synced in via `useCanvasDbSync` — this is the duplication that needs to move to TanStack Query or similar. After refactor:
- Canvas store owns **viewport + layout + interaction state only**.
- Server entities (entries, clusters, panels, packs) come from query hooks.
- Real-time updates from Supabase invalidate those queries.

### Canvas store rules (post-split)

After splitting `canvas-store.tsx`:
- `reducer.ts` — pure, no async, no Supabase. Input state + action → output state.
- `persistence.ts` — debounced writes to Supabase. Subscribed via middleware.
- `selectors.ts` — memoized derivations.
- `actions.ts` — action creators (typed).
- `context.tsx` — Provider + `useCanvasStore` hook.

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

And API routes — use the **existing** `withUserAuth` / `withMcpAccess` / `withExternalAuth` / `withAdminAuth` wrappers (currently in `src/lib/auth/with-auth.ts`, migrating to `src/shared/auth/` in P6). Do not invent a new `requireUser`.

```ts
// src/app/api/<feature>/<action>/route.ts
import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { <Action>Schema } from "@/features/<name>/schema";
import { <action> } from "@/features/<name>/server/service";

export const POST = withUserAuth(async (req, { userId }) => {
  const input = await parseJson(req, <Action>Schema);
  const result = await <action>(input, userId);
  return NextResponse.json(result);
});
```

The route handler is **thin**. All logic is in `service.ts`. `withUserAuth` injects `userId`, handles both session-cookie and `sk-dopl-*` API-key paths, rate-limits API keys, and logs 5xx responses to the system-events telemetry table.

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

### Consolidating clusters + community

Current state: `src/lib/clusters/service.ts` (516L) and `src/lib/community/service.ts` (861L) both handle cluster-shaped data.

Target:
- `features/clusters/` — owns the `clusters` table, CRUD, queries, local synthesis.
- `features/community/` — owns **publishing/forking only**. Calls `features/clusters` via its public API. Does not re-implement cluster CRUD.

If that boundary ends up contrived (e.g., community needs to read cluster internals), merge them into `features/clusters/` with `clusters/server/community.ts` as a sub-module.

---

## 9. API Routes

### Shape

Every route handler is ≤ 80 lines. If longer, you're doing business logic inline — extract to `service.ts`.

```ts
// src/app/api/<feature>/<action>/route.ts
import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { <Action>Schema } from "@/features/<name>/schema";
import { <action> } from "@/features/<name>/server/service";

export const POST = withUserAuth(async (req, { userId }) => {
  const input = await parseJson(req, <Action>Schema);
  const result = await <action>(input, userId);
  return NextResponse.json(result);
});
```

### Existing auth wrappers (reuse — do not reinvent)

All auth wrappers already exist at `src/lib/auth/with-auth.ts` (migrating to `src/shared/auth/` in P6):

- `withExternalAuth(handler)` — API-key OR session; 401 if neither.
- `withUserAuth(handler)` — same, plus injects `userId` into the handler context.
- `withSubscriptionAuth(handler)` — also resolves the user's subscription tier.
- `withMcpAccess(action, handler)` — gates MCP calls by trial/paid status, logs analytics. Alias `withMcpCredits` exists pending cleanup.
- `withAdminAuth(handler)` — requires `ADMIN_USER_ID` env var match.

They handle: Bearer `sk-dopl-*` API-key validation, Supabase session cookies, rate limiting, and automatic 5xx system-event logging.

### Shared helpers to build (P1)

Put these new helpers in `src/shared/`:

- `src/shared/api/parse-json.ts` — `parseJson(req, schema)` parses JSON body and zod-validates. Throws `HttpError(400)` on failure.
- `src/shared/api/error-handler.ts` — `withErrorHandler(handler)` wraps a handler, converts thrown `HttpError` into responses, logs unexpected errors.
- `src/shared/lib/http-error.ts` — `HttpError` class with `status`, `code`, `message`, `details`.

After these land, the refactored `api/chat/route.ts` (P4) is a dispatcher that picks a tool handler from `features/chat/server/tools/<tool>.ts` — each tool gets its own file — and the ~8 inline `if (!userId) return 401` blocks collapse into `withUserAuth` + thrown `HttpError`.

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

1. **Files over 700 lines.** See §2.
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

## 17. Refactor Rules of Engagement

The refactor is **not** a rewrite. Apply these rules while converting the repo to this structure:

1. **One feature module at a time.** Complete the move (files, imports, tests) before starting the next.
2. **No behavior changes during a move.** A refactor commit must be verifiable by running the app and seeing nothing differ. Behavior changes go in separate PRs.
3. **No new features during the refactor.** If a feature is urgent, pause the refactor, ship the feature in the old structure, resume.
4. **Delete as you go.** Do not leave `old-*.ts` or `legacy-*.ts` files behind. Git has the history.
5. **Fix naming drift in the same PR as the move.** If you find `MOVE_PANEL` when normalizing to `DOMAIN_VERB`, fix it now.
6. **Keep PRs small.** ~500 lines changed max. If a file split creates a giant PR, split it into two commits in the same PR (rename-only commit + content commit) so review is easy.
7. **Update this doc** when you find a pattern that isn't covered, or when a rule turns out to be wrong. This doc is a living contract.

### Refactor order (suggested)

1. **Scaffolding** — create `src/shared/lib/http-error.ts`, `src/shared/api/parse-json.ts`, `src/shared/api/error-handler.ts`. `src/features/` and `src/shared/` directories materialize as their first files land. Reuse the existing auth wrappers at `src/lib/auth/with-auth.ts`; migrate them in P6.
2. **Ingestion** — biggest win. Split `pipeline.ts`, create `features/ingestion/` with extractors.
3. **Chat route** — split tool handlers, introduce middleware helpers.
4. **Canvas store** — split into reducer/persistence/selectors/actions/context.
5. **Clusters + community** — consolidate per §8.
6. **Landing page** — extract components.
7. **Add test suite baseline** — ingestion parsers, DTO mappers, cluster math.
8. **Migrate remaining lib/ and components/ into feature folders** — final cleanup.

Each step is a separate PR. No step blocks shipping.

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
