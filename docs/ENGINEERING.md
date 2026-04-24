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

See [docs/REFACTOR-FINDINGS.md](REFACTOR-FINDINGS.md) for the current list of open findings (`F-NNN` ids). At a glance: pre-existing lint errors (F-006), chrome-extension PascalCase filenames (F-007), a few files still over the 500-line cap (§2), the canvas store still syncs server data it should push out to a query library (§7). None block shipping; all are tracked.

---

## 1. Project Structure

```
setup-intelligence-engine/
├── docs/                          # This file, ADRs, runbooks
├── packages/
│   ├── chrome-extension/          # Browser extension (webpack build)
│   ├── cli/                       # `dopl` CLI (shell companion; consumes @dopl/client)
│   ├── dopl-client/               # @dopl/client — shared HTTP client + types
│   └── mcp-server/                # MCP server (consumes @dopl/client)
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
│   │   ├── knowledge-packs/       # Pack sync
│   │   ├── marketing/             # Landing page components
│   │   └── onboarding/            # First-run flow
│   ├── shared/                    # Cross-feature primitives only
│   │   ├── ui/                    # shadcn primitives (Button, Dialog, etc.)
│   │   ├── design/                # Higher-level design components (MarkdownMessage, Orb, ...)
│   │   ├── layout/                # Shells + headers + sidebars
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

| File | Lines | Reason |
|------|-------|--------|
| `src/features/canvas/canvas-store/reducer.ts` | ~800 | Exception: cohesive state-machine reducer |
| `src/features/canvas/canvas.tsx` | ~720 | Scheduled: imperative pointer/wheel handlers await extraction into `use-viewport` + `use-interactions` hooks |
| `src/features/canvas/use-panel-ingestion.ts` | ~820 | Scheduled: split into glue hook + pure `ingestion-client` |
| `src/features/clusters/server/service.ts` | ~520 | Scheduled: cluster-brain canvas-panel spawn logic would split cleanly |

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
| **Server state** | TanStack Query (future — not yet adopted) | Anything that comes from Supabase or an API |
| **Canvas client state** | `canvas-store` (context + reducer) | Viewport, panel positions, in-flight chat streams |
| **Local UI state** | `useState` / `useReducer` | Form values, open/closed, hover |

**Known debt — do not add to it:** the canvas store currently syncs server entities (entries, clusters, panels) via `useCanvasDbSync` and the realtime hooks. That's duplication the future query-library adoption is meant to eliminate. Until then, don't add more server data to the canvas store — if you need to read an entity, add a new hook that reads directly, don't shove it through the reducer.

### Canvas store file layout

`src/features/canvas/canvas-store.tsx` is a barrel over four sub-modules under `src/features/canvas/canvas-store/`:
- `reducer.ts` — pure, no async, no Supabase. Input state + action → output state.
- `context.tsx` — React contexts + hooks (`useCanvas`, `usePanelsContext`, `useCanvasStateRef`, `useCapabilities`).
- `layout.ts` — pure geometry helpers (`computeNewPanelPosition`, `findNonOverlappingPosition`, `nextPanelIdString`).
- `provider.tsx` — `CanvasProvider` + sync bridges (DB / conversations / realtime / auto-focus / shared-panel-move).

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

### Clusters vs. community boundary

Two features touch cluster-shaped data. Keep the boundary explicit:

- `features/clusters/server/service.ts` — per-user cluster CRUD on the `clusters` table.
- `features/community/server/` (split into `publish.ts` / `query.ts` / `edit.ts` / `fork.ts` + a barrel `service.ts`) — operates on `published_clusters` rows, exclusively public / fork-related workflows.

If `community` starts needing to read cluster internals, either call `clusters/server/service.ts` through its public API or fold community into clusters as a sub-module (`clusters/server/community.ts`). Don't re-implement cluster reads in community.

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

All auth wrappers live in `src/shared/auth/with-auth.ts`:

- `withExternalAuth(handler)` — API-key OR session; 401 if neither.
- `withUserAuth(handler)` — same, plus injects `userId` into the handler context.
- `withSubscriptionAuth(handler)` — also resolves the user's subscription tier.
- `withMcpAccess(action, handler)` — gates MCP calls by trial/paid status, logs analytics. Alias `withMcpCredits` exists pending cleanup.
- `withAdminAuth(handler)` — requires `ADMIN_USER_ID` env var match.

They handle: Bearer `sk-dopl-*` API-key validation, Supabase session cookies, rate limiting, and automatic 5xx system-event logging.

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
