# Structural / Code-Quality Audit — Plain-English Report

_Audit performed 2026-06-01 against current `master` (47037b5) of `setup-intelligence-engine`._

## TL;DR

The codebase is **structurally above-average** for a one-person project — there's a real architecture contract (`docs/ENGINEERING.md`), a feature-first layout that's mostly followed, almost no `console.log` debris, almost no `@ts-ignore`, and a running findings log that tracks debt instead of pretending it doesn't exist. The recent multi-phase refactor (P0-P6) clearly happened.

But quality has slipped since the last audit, and the slippage is concentrated in three places:

1. **The 500-line rule is being broken without the file getting added to the allowlist.** At least 11 files are over 500 lines with no justification banner and no spot in the docs allowlist — the worst is `integrations/server/providers.ts` at 1,012 lines, and three allowlisted files (`knowledge-tree.tsx`, `knowledge/server/service.ts`, `knowledge/server/repository.ts`) have each grown 100+ lines past where they were when allowlisted, which the doc explicitly forbids.
2. **Three React-hooks-of-rules violations are sitting in the code right now**, all introduced by the recent "M-8 access" work — `skill-panel.tsx` and `knowledge-tree.tsx` call hooks after early returns. In dev React will crash; in production it leads to subtle hook-state corruption. These are real bugs, not style issues.
3. **API route handlers are doing inline business logic at industrial scale.** The "thin handler, fat service" rule is being broken by 32 routes, with three (`api/ingest/prepare/route.ts` at 529 lines, `api/clusters/[slug]/brain/memories/route.ts` at 440 lines, `api/chat/route.ts` at 435 lines) doing more than 5x what the doc allows.

Past that, the next layer of debt is the "missing repository" pattern — 4 features have a `repository.ts`, but 6 other server-touching features call Supabase directly from inside `service.ts`, which is exactly the layer leak the doc prohibits.

Top 3 concerns in plain English:

- **React bugs being shipped to prod.** The three "rules-of-hooks" violations will eventually surface as "the page sometimes freezes after navigating to a skill panel" or "selecting a folder sometimes blanks the tree." They look small but are unstable.
- **Critical files keep growing instead of being split.** `knowledge/server/service.ts` was allowlisted at 967 lines; it's now 1,064. The rule says "any edit must either split or shrink" — that's not being enforced. The file is the central business logic for the whole knowledge feature and is one bad change away from being impossible to navigate.
- **Architecture has informal exceptions that aren't documented.** "Sometimes service.ts has all the DB calls and there is no repository.ts" and "sometimes types and snake_case fields live in components" — both happen in this codebase and both contradict the doc. New work has no clear example to follow.

---

## 🔴 Critical (real risk of bugs or unmaintainability)

### React hooks called conditionally — three violations sitting in main today

- **What's wrong**: React hooks are being called AFTER early-return statements, which means the hook order changes between renders. React's guarantee that hook state stays correct breaks. In dev this throws "Rendered fewer hooks than expected"; in prod the hook results get assigned to the wrong slots and you get silent state corruption.
- **Where**:
  - `src/features/canvas/panels/skill/skill-panel.tsx:92` — `useMyAccessContext()` is called after `if (loading && !resolved) return <Skeleton/>` at line 70 and `if (!resolved) return <Error/>` at line 74.
  - `src/features/knowledge/components/knowledge-tree.tsx:716` — `useInlineEdit()` after `if (depth > 0) return null` at line 715.
  - `src/features/knowledge/components/knowledge-tree.tsx:718` — `useState()` same problem.
- **Why it matters**: All three landed during the "M-8 access feature" work (the comments at the violation sites cite "Audit A-005"). They will trigger React errors the first time a user navigates to a loading skill panel or sees a non-root folder row, and the failure mode is "the UI mysteriously breaks and a page refresh fixes it." Once shipped, these are the kind of bug that gets blamed on Supabase or the network for weeks before someone finds the actual cause.
- **Fix shape**: Move every `useXxx()` call ABOVE the first `if (...) return ...`. Same PR for all three.

### `npm run lint` is broken because `.claude/worktrees/` isn't excluded

- **What's wrong**: Running `npm run lint` reports **2,130 errors**, but 2,046 of those come from linting transpiled `.js` files inside `.claude/worktrees/adoring-meninsky-df2898/packages/cli/dist/`, which is a Claude Code worktree that shouldn't be linted at all. The real lint state is 84 errors and 74 warnings.
- **Where**: `eslint.config.mjs` ignores `packages/*/dist/**` but not `**/worktrees/**/packages/*/dist/**`.
- **Why it matters**: Every time you (or CI) runs lint, it spits out 2,130 errors. Nobody can tell signal from noise. Real regressions are invisible because the count is already 2,130. The doc's "refactor gate" of "lint must not regress from 59 errors" cannot be enforced when 96% of errors are bogus.
- **Fix shape**: Add `**/.claude/**` to the `globalIgnores` list in `eslint.config.mjs`. One line.

### Recently allowlisted files have grown past their allowlist line counts

- **What's wrong**: ENGINEERING.md §2 says "any edit to a file over 500 lines must either split or reduce line count." Three allowlisted files have grown anyway:
  - `src/features/knowledge/server/service.ts` — allowlisted at 960, now **1,064** (+104)
  - `src/features/knowledge/components/knowledge-tree.tsx` — allowlisted at 640, now **846** (+206)
  - `src/features/knowledge/server/repository.ts` — allowlisted at 695, now **761** (+66)
- **Where**: see paths above.
- **Why it matters**: The allowlist exists so growth has a backstop — "this file is too big, but we know, and any further growth means split-or-shrink." That rule is being ignored. `knowledge/server/service.ts` is now over 1,000 lines, which means anyone editing it has to load the entire knowledge feature into their head before changing anything. It's also the file the doc's tracked-debt `#19` says is the highest-priority split.
- **Fix shape**: Knock out the splits listed in `docs/TRACKED-DEBT.md#19` — `service.ts` → 5 files (bases/folders/entries/path-ops/trash), `knowledge-tree.tsx` → extract drag-drop hook + `TreeNode`. Each split is ~30 minutes.

### 11 files over 500 lines with no allowlist entry or justification banner

- **What's wrong**: §2 of ENGINEERING.md lists every file allowed to exceed 500 lines. These 11 files are over 500 lines and are NOT in the allowlist and do NOT carry a justification banner at the top of the file:
  - `src/features/integrations/server/providers.ts` — **1,012 lines** (HAS justification banner but isn't in the docs table — should be added)
  - `src/shared/layout/sidebar.tsx` — **940 lines**
  - `src/features/canvas/panels/knowledge-base/knowledge-base-panel.tsx` — **913**
  - `src/features/canvas/panels/skill/skill-panel.tsx` — **892**
  - `src/features/integrations/server/service.test.ts` — **841**
  - `src/features/canvas/types.ts` — **818** (qualifies as "dense type-only" but no banner)
  - `src/features/skills/components/skill-view.tsx` — **755**
  - `src/features/canvas/clusters/cluster-geometry.ts` — **670** (qualifies as "pure data table" but no banner)
  - `src/features/clusters/server/attachments.ts` — **658**
  - `src/features/skills/server/service.ts` — **614**
  - `src/app/design/page.tsx` — **567**
  - `src/app/api/ingest/prepare/route.ts` — **529** _(also fails the 80-line route handler rule — see below)_
  - `src/features/workspaces/server/invitations.ts` — **526**
  - `src/features/skills/server/repository.ts` — **511**
- **Why it matters**: The 500-line cap is the only objective check on complexity in the whole architecture contract. Once a single file slips past with no justification and no consequence, the convention collapses. Several of these are central feature files: `sidebar.tsx` holds every nav section the app has; `attachments.ts` is the cluster→KB junction code path; `invitations.ts` is the workspace-invite security surface.
- **Fix shape**: Two passes. (1) Files that genuinely qualify under §2 exceptions (`providers.ts`, `canvas/types.ts`, `cluster-geometry.ts`): add them to the allowlist table in ENGINEERING.md. (2) Files that don't qualify (the rest): schedule splits. `sidebar.tsx` → one file per nav section. `attachments.ts` → split by domain (KB attachment / skill attachment / brain memory). `invitations.ts` → split create/accept/list. `skill-view.tsx` → extract the file-tabs sub-component.

### Two-thirds of features that touch Supabase skip the repository layer

- **What's wrong**: The doc's repository/service split says: `repository.ts` owns DB access (one function per query, maps snake_case → camelCase), `service.ts` owns business logic. Only 4 features have a `repository.ts` (knowledge, skills, workspaces, integrations). The other 6 features that touch Supabase put `.from(...)` and `.rpc(...)` calls directly inside their `service.ts`:
  - `src/features/clusters/server/service.ts`
  - `src/features/workspaces/server/service.ts` _(has a repository.ts but service.ts still calls .from directly)_
  - `src/features/community/server/{publish,query,edit,fork}.ts`
  - `src/features/skills/server/service.ts`
  - `src/features/knowledge/server/service.ts`
- **Why it matters**: The doc says "No `snake_case` keys should ever leak past `repository.ts`." When the service does DB calls directly, snake_case fields leak into business logic, then into the API response shape, then into the UI types — which is exactly why we see `source_url`, `created_at`, `panel_id` types in TSX components today (see "snake_case in UI" finding below). Also, when a service does its own queries, two services querying the same table both have to maintain the mapping logic.
- **Fix shape**: For each feature: create `repository.ts`, move every `.from(...)` and `.rpc(...)` call into one function per query, return DTOs not rows. Start with the smallest feature (`clusters`) to validate the pattern; defer `knowledge` until after the §19 split.

---

## 🟠 High

### 32 API route handlers are over 80 lines — the three worst do business logic that should live in services

- **What's wrong**: §9 of ENGINEERING.md says every route handler is ≤ 80 lines and delegates to `service.ts`. 32 routes break the rule. The worst three are doing inline DB calls, branching on entry status, building agent prompts, etc.:
  - `src/app/api/ingest/prepare/route.ts` — **529 lines**
  - `src/app/api/clusters/[slug]/brain/memories/route.ts` — **440 lines**
  - `src/app/api/chat/route.ts` — **435 lines**
- **Why it matters**: Route handlers are the easiest place for a junior dev (or an AI agent) to ship "just one more if statement." Five years from now this file becomes the one nobody dares touch. `ingest/prepare/route.ts` already imports from 9 different feature packages, manages a 5-stage rollback path inline, and calls `supabaseAdmin()` directly — it's effectively a hidden service.
- **Fix shape**: Move each route's business logic into the relevant feature's `service.ts` and have the route do nothing but parse-validate-call-respond. Cap them at 80 lines per the doc.

### Components define and use snake_case fields directly from the DB

- **What's wrong**: TSX component files define `interface` types with `source_url`, `created_at`, `panel_id` — the snake_case names from the database. The doc says these conversions happen "once, at the repository boundary." They are not.
- **Where**:
  - `src/features/entries/components/entry-grid.tsx:10` — `source_url: string;`
  - `src/features/entries/components/entry-grid.tsx:17` — `created_at: string;`
  - `src/features/entries/components/entry-preview-panel.tsx:32, 42`
  - `src/features/entries/components/entry-detail.tsx:12, 22, 43, 44, 114`
  - `src/features/chat/components/chat-shell.tsx:31, 38, 111, 120`
  - `src/features/chat/components/private-rendered-message.tsx:20`
  - `src/features/ingestion/components/chat-message.tsx:32`
- **Why it matters**: When the DB column renames (which has happened twice this year per the migrations), every component touching the field has to change too. The whole point of the repository pattern is that one place breaks, not nine. Also, mixing naming conventions inside React components looks sloppy and trips up new readers.
- **Fix shape**: Bring those fields through `dto.ts` mappers in the relevant feature's `repository.ts`. Update the component types to camelCase. Move the `ChatMessage` type out of `features/ingestion/components/` and into either `shared/types/` (it's used by 16 files across canvas/chat/ingestion) or pick one feature to own it.

### Cross-feature deep imports — features reaching into each other's internals

- **What's wrong**: The doc bans this: "No sideways imports between features. External consumers import `from "@/features/chat"` — not deep paths." But many features reach across the boundary, often into another feature's `server/repository.ts` or `client/api.ts`:
  - `features/chat/server/tools/knowledge.ts` → imports from `@/features/knowledge/server/repository`
  - `features/chat/server/tools/skills.ts` → imports from `@/features/skills/server/repository`
  - `features/canvas/canvas-panel.tsx` → imports `ChatPanelBody` from `@/features/chat/components/chat-panel`
  - `features/canvas/fixed-chat-panel.tsx` → same
  - `features/canvas/clusters/cluster-header-tab.tsx` → imports `PublishDialog` from `@/features/community/components/publish-dialog`
  - `features/canvas/panels/skill/skill-panel.tsx` → 6 deep imports from `@/features/skills/{client/realtime, client/api, types}` and `@/features/members/{hooks, access-defaults}`
  - 16 files import `ChatMessage` from `@/features/ingestion/components/chat-message`
- **Why it matters**: Each of these is a hidden coupling. When `knowledge/server/repository.ts` adds a parameter, you have to find every caller — which now includes a *different* feature. The barrel (`index.ts`) exists exactly to prevent this. Right now, every feature is part of every other feature's public API by accident.
- **Fix shape**: Add `index.ts` barrels to each feature listing the public exports. Update cross-feature imports to use the barrel. For the obviously shared thing (`ChatMessage`), move to `shared/types/`. For `chat → knowledge/skills repository` calls, expose the read functions via `knowledge/server/service.ts` / `skills/server/service.ts` instead.

### "Client" code lives under a `server/` folder name

- **What's wrong**: `src/features/entries/server/saved/local-store.ts` starts with `"use client"` and uses `useSyncExternalStore`. The path says "server"; the code is client-only.
- **Where**: `src/features/entries/server/saved/local-store.ts:1` ("use client") and the file is imported by `src/app/browse/saved/page.tsx` and `src/features/entries/components/entry-card.tsx`.
- **Why it matters**: The doc's whole server/client boundary system depends on the folder name being meaningful. `import "server-only"` at the top of `server/*` files is the safety net. Anything inside `server/` should fail to compile if a client component imports it. This file silently breaks the convention. A future reader assumes "if it's in server/, it's server-only" and gets confused or makes the wrong fix.
- **Fix shape**: Move the file to `src/features/entries/client/local-store.ts` or `src/features/entries/saved/local-store.ts` (no `server/` in the path). Rename in one PR with all callers updated.

### `Database` generic isn't wired through `supabaseAdmin()` — 240 call sites lose type safety

- **What's wrong**: Already tracked as `S-17` in `docs/TRACKED-DEBT.md`. `supabaseAdmin()` returns `SupabaseClient` without the `Database` generic, so every `db.from("entries")` returns `unknown`-shaped rows. Manual `as` casts are sprinkled at call sites.
- **Where**: `src/shared/supabase/admin.ts:18`. 240 callers across `src/`.
- **Why it matters**: The whole point of generating `supabase/types.ts` (2,257 lines of generated types) is to catch column renames at compile time. With the generic missing, you only catch column renames at runtime, in production, when the page breaks.
- **Fix shape**: Already specified in TRACKED-DEBT.md (~3 hours).

### `mcp.json` write isn't atomic — Ctrl-C corrupts shared MCP config

- **What's wrong**: Already tracked as `A-031` in `docs/M5-M6-M10-AUDIT-FINDINGS.md`. The CLI's `dopl mcp config --write` overwrites `~/.claude/mcp.json` non-atomically. SIGINT during the write corrupts ALL of the user's MCP server configs, not just Dopl's.
- **Where**: `packages/cli/src/commands/mcp.ts:300-302`.
- **Why it matters**: This is one user mistake away from breaking every Claude Code MCP integration on their machine. `mcp.json` typically holds Slack, Gmail, GitHub, Linear configs too.
- **Fix shape**: `writeFile(path + ".tmp", ...)` → `rename(path + ".tmp", path)`. One commit.

### API key leaks via process args (`ps aux`)

- **What's wrong**: Already tracked as `A-025`. The CLI launches the MCP server with `--api-key sk-dopl-xxx` as a positional argument, visible in `ps aux` to any other user on the machine for the lifetime of the MCP process (which persists across Claude Code sessions).
- **Where**: `packages/cli/src/commands/mcp.ts:216, 224`.
- **Why it matters**: Shared servers, containers, anyone with audit-log access can see the key. The MCP server already supports `DOPL_API_KEY` env var; switching the launch shape is one line.
- **Fix shape**: Pass via `env`, not `args`. Already specified.

---

## 🟡 Medium

### `useEffect + fetch + useState` is the dominant data-fetching pattern — 43 files

- **What's wrong**: 43 components use the manual fetch-in-effect pattern that the doc §7 explicitly calls out as future TanStack Query migration. No caching, no revalidation, no shared subscription. Every component does its own duplicate fetch on mount.
- **Why it matters**: This is the doc's open debt, not a new issue, but the count is high enough that the migration won't be a one-PR job. Worth setting up TanStack Query before the count hits 60.

### Reducer action names are mostly `VERB_DOMAIN` — the doc says new ones should be `DOMAIN_VERB`

- **What's wrong**: The reducer has `MOVE_PANEL`, `RESIZE_PANEL`, `CLOSE_PANEL`, `CREATE_CLUSTER`, `DELETE_CLUSTER`, `ADD_PANEL_TO_CLUSTER` (verb-domain). The doc says new actions should be `PANEL_MOVE`, `CLUSTER_CREATE`, etc.
- **Where**: `src/features/canvas/canvas-store/reducer.ts` — 48 action types, most legacy.
- **Why it matters**: Low-stakes consistency drift. The doc explicitly says "normalize nearby legacy names when touching the reducer" — that isn't happening.
- **Fix shape**: One PR per domain (`PANEL_*` first since it's the biggest group). Update reducer + action creators + tests together.

### Service-level `service.ts` files duplicate "default value" decisions with `repository.ts`

- **What's wrong**: Already tracked as `A-041`. Service-layer `createBase` defaults to `"private"`, repository-layer `insertBase` defaults to whatever the DB column default is (`"public"`). If anyone bypasses the service, they get the wrong default. Pattern likely repeats elsewhere.
- **Fix shape**: One default at one layer; service-only is the safer choice.

### `next.config.ts` is essentially empty + has a typo in its comment

- **What's wrong**: The file is 7 lines and the comment says `/* config options herer */` (typo). Not a bug, but it suggests no one has touched this file since project init. There's no `images.remotePatterns`, no `headers`, no `redirects`, no `experimental.serverActions`. Either confirm that's intentional or document why.
- **Where**: `next.config.ts:4`.
- **Why it matters**: Small. But the fact that nobody fixed a typo in the only line of the only Next.js config file is a tell about how often the build config is reviewed.

### `@types/node` version skew between root and packages

- **What's wrong**: Root `package.json` pins `@types/node: ^20`. Each of the three packages pins `@types/node: ^22.0.0`. They share lockfile-resolved types via the workspace.
- **Where**: `package.json` (root) vs `packages/{dopl-client,mcp-server,cli}/package.json`.
- **Why it matters**: When the main app types a `Buffer` or `process` against node 20 types and a package types the same name against node 22, you can get inconsistent type errors that disappear on `npm install` and reappear after CI restarts the cache. Low likelihood of breakage, real frustration when it hits.
- **Fix shape**: Align to one major version. Either 20 (matches main app's target) or 22 (matches packages' actual runtime needs).

### Lint config doesn't enforce the rules the doc says to enforce

- **What's wrong**: ENGINEERING.md Appendix A says to add `import/order`, `no-restricted-imports` (forbidding deep feature imports), `max-lines` (warn 500, error 700), `no-explicit-any` error, `no-console` warn. None are configured.
- **Where**: `eslint.config.mjs`. Just `nextVitals` and `nextTs`.
- **Why it matters**: The doc rules are advisory until lint enforces them. The cross-feature deep imports finding above is exactly what `no-restricted-imports` would block automatically. `max-lines` at 500 would have caught the allowlisted-files-grew finding before it shipped.
- **Fix shape**: One PR adding the Appendix A rules. Expect 200-300 violations to surface; mark them as `warn` for the first month, then escalate.

### Two slug-generating pipelines (S-7)

- **What's wrong**: Already tracked. `src/shared/lib/slug/slugify.ts`, `src/features/workspaces/slug.ts`, and `slugifyCanvasName` in `src/features/workspaces/server/canvases.ts` are three near-identical kebab pipelines, with two regex shapes used downstream.
- **Why it matters**: Drift between them is inevitable. When one fixes a unicode edge case, the others won't.

### Env vars referenced in code but missing from `.env.example`

- **What's wrong**: Code references env vars that `.env.example` doesn't document:
  - `CRON_SECRET` (cron route auth)
  - `RESEND_API_KEY`, `RESEND_FROM` (email)
  - `KNOWLEDGE_PACK_GITHUB_TOKEN`
  - `INTEGRATIONS_ATTIO_AUTH_CONFIG_ID` (Attio integration recently added per commit log)
- **Where**: `src/features/{...}` vs `.env.example`.
- **Why it matters**: New devs (or new deploy targets) will silently 500 because they don't know to set these. Cron auth missing means anybody can hit `/api/cron/*`.
- **Fix shape**: Add the missing entries to `.env.example` with comments explaining each.

### `.env.example` lists dead Stripe price IDs

- **What's wrong**: `.env.example` has `STRIPE_PRO_ANNUAL_PRICE_ID`, `STRIPE_POWER_PRICE_ID`, `STRIPE_POWER_ANNUAL_PRICE_ID`. Code only reads `STRIPE_PRO_PRICE_ID`.
- **Where**: `.env.example:29-31`.
- **Why it matters**: New users set these and wonder why nothing happens. Or they panic when they don't know what to put.
- **Fix shape**: Delete the unused lines from `.env.example`. If those products are coming, add a TODO comment with a target date.

### `setUserAuth.ts` still has a typed-`any` context parameter (F-003 from refactor log)

- **What's wrong**: The shared auth wrapper still has the `any`-typed context parameter the refactor log flagged months ago.
- **Where**: `src/shared/auth/with-auth.ts:58, 62`.
- **Why it matters**: This is the doc's example function — what new devs read first when wiring an API route. It has `: any` in it.
- **Fix shape**: F-003 specifies the fix: type the context properly. Should be 30 minutes.

### 13 `react-hooks/set-state-in-effect` violations

- **What's wrong**: 13 cases of `setState` called inside `useEffect` without proper guards, per eslint. These typically cause infinite re-render loops or unnecessary work.
- **Where**: 13 locations — run `npx eslint --ignore-pattern '.claude/**'` to enumerate.
- **Why it matters**: Performance + correctness debt; each is a potential bug.

### Built `dist/` files for all three packages are committed to git (91 files)

- **What's wrong**: `packages/{dopl-client,mcp-server,cli}/dist/` are all checked in. 91 files total. `.gitignore` doesn't exclude them.
- **Why it matters**: PRs against these packages diff both source AND compiled output, doubling review surface. Lint config has to special-case them. Git blames get noisy. Storage is small but the cognitive overhead is real.
- **Fix shape**: Add `packages/*/dist/` to `.gitignore`. Use `npm publish` straight from CI to produce the published `dist/`. (Note: probably intentional today because the publish flow uses local CLI rather than CI — confirm before changing.)

---

## 🟢 Low / cleanup

### F-002 — Unused `depth` param in 4 ingestion extractors

Tracked. Cosmetic until the extractor signature gets normalized.

### F-016 — Legacy slug fallback in workspaces awaiting deletion

Tracked. Decommission once `legacy_slug_redirect` system event drops to zero for 14 days.

### `next.config.ts` typo (`herer`)

Already mentioned above. Pure cosmetic but the typo is a tell about review depth.

### ENGINEERING.md references a `chrome-extension` package that no longer exists

- The doc has §1 (project structure) and F-007 listing `packages/chrome-extension/`. The directory isn't in the repo.
- Either restore the package or update the doc to drop the mention (it leaves anyone reading the doc wondering what they're missing).

### Test count vs source files

15 test files vs 592 source files = ~2.5% file-level coverage. The doc says "current coverage: zero" with a roadmap, so this is mildly better than the doc claims. Most coverage is concentrated in `packages/cli/src/lib/` (5 tests) and `packages/dopl-client/src/` (2 tests). The actual web app has 4 unit test files and the only feature with real test coverage is `integrations` (3 files, 800+ lines of tests).

### 2 `TODO` comments — both in canvas hooks, both real

- `src/features/canvas/use-cluster-attachment-sync.ts:139` — retry-on-mount
- `src/features/canvas/use-clusters-realtime.ts:12` — missing local mapping

Low priority, both annotated with what they need.

### 3 `console.log` left in code

- `src/app/api/billing/webhook/route.ts:49, 52` — webhook lifecycle logging
- `src/app/api/cron/trial-reactivation/route.ts:125` — cron status

Tiny. Either upgrade to `console.info` or migrate to `logSystemEvent`.

---

## What's well-built

Real credit due — not everything is on fire:

- **The refactor log is a model of how to track debt.** `docs/REFACTOR-FINDINGS.md` has stable `F-NNN` ids, status tracking, and proposed resolutions. Same for the `A-NNN` audit logs. This is unusually disciplined for a one-person codebase and is the only reason this audit could be focused.
- **The architecture contract exists.** `docs/ENGINEERING.md` is genuinely good — feature-first, opinionated, names every anti-pattern. Most codebases don't have anything close.
- **Almost zero `console.log` debris** (3 total in the whole tree).
- **Zero `@ts-ignore` / `@ts-expect-error`.** That's rare.
- **TypeScript `strict: true`**, no `ignoreBuildErrors`, no `eslint-disable-next-line` strewn around.
- **`packages/community/server/service.ts` is a clean barrel.** Four sub-modules (publish/query/edit/fork) with the barrel reduced to re-exports. This is the right shape for the rest of the oversized service.ts files.
- **The reducer is pure.** `canvas-store/reducer.ts` has zero `await`, zero `fetch`, zero `.then`. The reducer doesn't violate the "reducers are pure" rule.
- **Canvas store layered correctly.** `reducer.ts` (pure) + `context.tsx` (hooks) + `layout.ts` (geometry) + `provider.tsx` (effects) — textbook separation.
- **Naming is genuinely consistent.** Zero PascalCase filenames in `src/`. Kebab-case throughout. The `chrome-extension` PascalCase issue (F-007) is no longer a problem because that package is gone.
- **Auth wrappers are centralized.** No reinvented `requireUser` — every route uses `withUserAuth` / `withMcpAccess` / `withAdminAuth`. That's hard to maintain and you did.
- **Supabase migrations are timestamped and sequential.** 53 migrations, no parallel branches, no skip in the timestamp ordering. Migration discipline is solid.
- **No double Supabase client factories.** One `supabaseAdmin()`, one `createServerSupabaseClient()` (called by `getServerClient()`). Clean.
- **`HttpError` + `parseJson` + `withErrorHandler` exist** even if not adopted everywhere yet. The right pieces are in place; it's an adoption problem, not a design problem.
- **Tests for `integrations` are unusually thorough** (3 files, 1,800+ lines of tests). If that pattern propagates to other features, the doc's roadmap goal of "high coverage on pure business logic" is achievable.

---

## Numbers

- Total `src/` + `packages/*/src/` files (excluding tests, `dist/`, `node_modules/`): **592**
- Files over 500 lines: **24** total
  - Auto-generated (allowed exception): 1 (`supabase/types.ts`)
  - Allowlisted in ENGINEERING.md §2: 10
  - **Non-allowlisted, no justification banner: 11** (the violation set, listed above)
  - **Allowlisted but grew past their allowlist count: 3** (`knowledge/server/service.ts`, `knowledge-tree.tsx`, `knowledge/server/repository.ts`)
- API routes over 80 lines: **32** (worst is 529 lines)
- `any` occurrences in `src/` (excluding tests): **14** real, all in realtime-channel escape hatches + `with-auth.ts` (F-003)
- `any` occurrences in tests: 17 (mostly `db: stub as any` for the integrations test scaffolding)
- `@ts-ignore` / `@ts-expect-error`: **0**
- `console.log` (excluding `.warn` / `.error`): **3**
- TODO / FIXME / HACK / XXX: **2** TODOs, 0 of the rest
- Commented-out code blocks: **0** (all comment-keyword matches were natural-language comments, not commented code)
- Lint errors (correctly filtering out `.claude/worktrees/`): **84** errors, **74** warnings
  - Baseline from `REFACTOR-FINDINGS.md`: 59 errors, 84 warnings
  - **Net regression: +25 errors**, -10 warnings
  - 3 of the new errors are `react-hooks/rules-of-hooks` (critical, see above)
- Test files: **15** vs source files: **592** (≈ 2.5% file-level coverage)
- Supabase migrations: **53** total, latest is `20260511000000_oauth_connections_avatar.sql`
- Open `F-NNN` findings (per `REFACTOR-FINDINGS.md`): **9 open** + 7 fixed-in-XXX
- Open `A-NNN` findings (per audit logs): **A-001 to A-043 = 43 items, 41 still open**

---

## Plain-English priority order for fixing

If you only do five things this month:

1. **The three rules-of-hooks bugs**, today. 30 minutes of work; ships React stability.
2. **Add `.claude/**` to eslint ignores** so the lint command tells the truth again. 2 minutes.
3. **`mcp.json` atomic write (A-031) + API key via env (A-025).** Two one-line changes that protect users from data loss and key exposure. 30 minutes.
4. **Split `knowledge/server/service.ts`** per TRACKED-DEBT.md §19. Largest feature file, growing, central to product.
5. **Add Appendix A lint rules**, even as `warn`. Without them, the architecture contract is honor-system, and the audit numbers show the honor system isn't holding.
