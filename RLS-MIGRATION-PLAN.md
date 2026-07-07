# RLS Migration Plan — enforce authorization once, at the data boundary

Written 2026-07-06. Owner: Samuel. Status: proposed, not started.

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
