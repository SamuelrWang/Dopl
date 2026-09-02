# RLS Migration Plan — enforce authorization once, at the data boundary

Written 2026-07-06. Owner: Samuel. Status: **Phase 1 + the first slice of Phases 2–3 LANDED
2026-09-02** (Wave B B7, `v2/b-rls-real-1`), for THREE tables only and behind a flag that is OFF.
Everything else is still proposed.

> ⚠ **The table inventory below is a 2026-07-06 capture and has drifted.** The
> `workflows` group (4 tables) and `clusters` no longer exist — those features
> were retired 2026-08-07 and DELETED 2026-08-11
> (`supabase/migrations/20260811120000_drop_workflows_and_clusters.sql`). Re-count
> before planning against it; the argument the doc makes is unaffected.

## What has landed (2026-09-02, and only this)

- **Phase 1, for `knowledge_bases` / `knowledge_folders` / `knowledge_entries`.** Helper functions
  (`dopl_credential_is_shared`, `dopl_can_see_visibility`, `dopl_teams_mode_visible`, and
  `dopl_knowledge_base_readable` — the rule, written once) plus the three SELECT policies repaired to
  EQUAL the TS predicate, which they did not: they admitted a shared credential to a private row and
  said nothing about `access_mode='teams'` (F-520). `supabase/migrations/20260919120000_rls_helpers_and_caller_scope.sql`.
  ⚠ **NEVER APPLIED** — Docker is down here, so `supabase start` cannot run; replay is owed with the
  rest of Wave B's migrations.
- **Phase 2's client, without Phase 2's `AccessContext`.** `shared/supabase/caller-client.ts ›
  readClient` is the one seam; the caller scope rides an `AsyncLocalStorage` store set in
  `shared/auth/with-auth.ts`, so no repository signature moved. Threading an explicit context through
  406 read sites is still the plan's end state — this is the step that makes ONE feature's reads
  caller-scoped without a whole-tree edit first.
- **Phase 3, option 1 — taken, not prototyped-and-parked.** `caller-jwt.ts` mints a 60-second
  HS256 Supabase JWT for EVERY lane (session and `dopl_at_`), carrying `sub` and the credential axes,
  so both lanes meet one policy. New deploy input: `SUPABASE_JWT_SECRET` (F-522).
- **Not done, deliberately:** no TS predicate deleted (ruling B5 — they go one at a time, each behind
  a green redteam test); no write policies; no lint rule (Phase 0's `no-restricted-imports`, F-521);
  the agent audience ceiling is NOT expressible as a policy and stays in TS (F-524).

## Why


Authorization today is app code someone must remember to write per service.
Every repository reads through `supabaseAdmin()` (service role), which
**bypasses Postgres RLS entirely** — so the `CREATE POLICY` rules that already
exist in our migrations protect nothing on those paths. One forgotten check in
one new endpoint is a data leak. The goal is the inverse property: **a row the
caller isn't allowed to see never leaves the database, even from code that
forgot to check.** UI never filters for security; it only renders what the
server returns.

## Current state (verified against the repo)

- `src/shared/supabase/admin.ts` — `supabaseAdmin()` (service role) and
  `createServerSupabaseClient()` (anon key + session cookies, RLS-capable).
- ~35 `supabaseAdmin()` call sites across features; heaviest: workspaces (7),
  analytics (5), workflows (4), knowledge (4), teams (3), shared (3),
  skills (2).
- RLS is already **enabled** on most content tables (`knowledge_entries`,
  `knowledge_folders`, `knowledge_entry_chunks`, `skills`, `skill_files`,
  `workflows`, `teams`, `team_members`, `team_resource_access`, …) — but not
  audited, and moot for reads because the service role skips it. Notably
  `knowledge_bases` does not appear in the ENABLE ROW LEVEL SECURITY list;
  audit and close that first.
- Access model already lives in the schema: `team_members`,
  `team_resource_access`, `workspace_resource_access`.
- Route-level authn is centralized in `src/shared/auth/with-auth.ts`
  (`withUserAuth`, `withMcpAccess`, …); it resolves both session cookies and
  remote-MCP OAuth tokens (`dopl_at_`).
- Client capability gating is centralized in `MyAccessProvider`
  (`src/features/members/hooks/use-my-access.tsx`) — UX only, stays that way.

## Target architecture (three layers, each with one job)

1. **RLS (database)** — the security boundary. Policies encode workspace
   membership, visibility, and team access once per table. Reads run on a
   caller-scoped client, so filtering is automatic and unforgettable.
2. **`AccessContext` (repository boundary)** — the app-semantics choke point.
   One shared context (`userId`, `workspaceId`, `role`, `teamIds`), required
   by every repository function. Generalizes the existing `buildSkillContext`
   pattern instead of per-feature ad-hoc contexts.
3. **`MyAccessProvider` (client)** — affordances only (which buttons render).
   Never data filtering.

Service role remains for genuine system paths only: ingestion pipeline,
Stripe webhooks, cron, admin tooling.

## Phases

### Phase 0 — stop the bleeding (no behavior change)
- ESLint `no-restricted-imports`: importing `supabaseAdmin` is an error
  outside an explicit whitelist (`shared/supabase`, ingestion, billing
  webhooks, scripts). ENGINEERING.md Appendix A already plans rules of this
  shape.
- Audit which tables have RLS enabled vs. not (`knowledge_bases` gap), and
  inventory existing policies for correctness. Deliverable: a checklist table
  in this doc.

### Phase 1 — policy foundation
- One `security definer` helper function per predicate, so policies stay
  one-liners and the team-membership join is written once:
  `is_workspace_member(ws_id)`, `member_role(ws_id)`,
  `has_resource_access(resource_id, kind)` (reads `team_resource_access` +
  `workspace_resource_access`).
- Write/repair SELECT policies for the employee/agent read path first:
  `knowledge_bases`, `knowledge_folders`, `knowledge_entries`,
  `knowledge_entry_chunks`, `skills`, `skill_files`.
- Index every column the policies filter on (workspace_id, team ids).
- Test against local Supabase (`supabase start`), per ENGINEERING.md §13:
  happy path + a redteam case per table proving a non-member gets zero rows.

### Phase 2 — caller-scoped reads
- Introduce `AccessContext` in `src/shared/auth/` and have `withUserAuth`
  build it alongside `userId`.
- Repository functions take a client parameter (per §8 they already should —
  today they call `supabaseAdmin()` inline; fix as we touch each one).
- Migrate read paths feature by feature to the session-scoped client:
  knowledge → skills → workflows → teams/workspaces. Writes stay on the
  admin client until Phase 4.
- Expect surfacing bugs where the service role was masking a missing join —
  treat each as a found leak, not a regression.

### Phase 3 — the MCP token path (the hard part)
Remote-MCP calls authenticate with our own `dopl_at_` OAuth tokens, not a
Supabase session, so there is no JWT for `auth.uid()`. Options, in order of
preference:
1. Mint a short-lived Supabase JWT (signed with the project JWT secret,
   `sub = userId`, custom claim for workspace) when `with-auth` validates a
   `dopl_at_` token; build the scoped client from it. No schema changes;
   policies keyed on `auth.uid()` work unchanged for both paths.
2. Fallback: keep MCP reads on explicit service-layer filters (status quo)
   and accept the dual regime — document loudly if so.
Decision gate: prototype option 1 on one endpoint before committing.

### Phase 4 — writes + cleanup
- INSERT/UPDATE/DELETE policies (role-aware: admin vs member vs viewer).
- Move writes off the admin client feature by feature.
- Shrink the Phase 0 whitelist as call sites disappear; end state is
  single-digit `supabaseAdmin` imports, all system paths.
- Delete per-service permission re-checks that RLS now makes redundant
  (keep ones that produce better 403 error messages at the boundary).

## Feature hooks (what this buys the new pages)

- **Ontology / Configuration pickers**: the mock gate
  (`accessibleKnowledge()` / `accessibleSkills()` in
  `src/features/ontology/seed.ts`) is replaced by one list endpoint whose
  rows arrive already RLS-filtered. Zero per-component enforcement code.
- Any future surface listing KBs/skills/workflows inherits enforcement for
  free — the property this plan exists to create.

## Risks / gotchas

- **Policy performance**: membership subqueries run per row — measure with
  realistic data; the helper functions + indexes are the mitigation.
- **Service-role habits**: new code reaching for `supabaseAdmin` out of
  convenience — that's what the lint rule is for.
- **Realtime + storage**: presence channels and any storage buckets have
  their own policy surface; audit separately in Phase 4.
- **Local/CI**: every policy change needs the local-Supabase test loop;
  never hand-apply to prod (migrations only, per repo convention).

## Non-goals

- No UI changes. No new permission *model* (roles/teams stay as-is — this
  moves enforcement, it doesn't redesign semantics).
