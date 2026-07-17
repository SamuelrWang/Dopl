# Refactor Findings Log

A running log of bugs, conflicts, friction, and suspicious patterns discovered during the structural refactor. Entries are added the moment something is noticed — not batched. Each entry has a stable ID that commits can reference.

See [docs/ENGINEERING.md](ENGINEERING.md) for the target architecture.

**Pruned 2026-07-17:** a three-agent audit verified every entry against the live tree; resolved/obsolete findings were removed so this file holds only OPEN debt. Removed IDs (details in git history of this file): F-001–F-015, F-018, F-019, F-021, F-022, F-024, F-025, F-028–F-032, F-034, F-039. IDs are never reused. The second of two entries that both carried "F-038" was renumbered to F-040.

## Status legend

- **open** — not yet addressed
- **deferred** — will be fixed post-refactor; captured for future work
- Resolved entries are deleted from this file (git remembers); reference their ID + this file's history.

## Severity

- **bug** — incorrect behavior, runtime risk, or security concern
- **conflict** — two places in the codebase that disagree or duplicate each other
- **smell** — pattern that will cause pain later (not currently broken)
- **question** — needs user decision before action can be taken

## Entry template

```
### F-NNN: <short title>
- Location: path/to/file.ts:L123 (or multiple paths)
- Found during: <phase / pass>
- Severity: bug | conflict | smell | question
- Description: <what's wrong>
- Proposed resolution: fix-now | defer | needs-user-decision
- Status: open | deferred
```

## Current gate

Build + `tsc --noEmit` green on every commit; `npx eslint` at 0 errors (baseline: 1 intentional warning, `proxy.ts`); root vitest + `packages/mcp-server` vitest green.

---

## Open findings

### F-016: Legacy slug-only workspace URL fallback awaiting deletion
- Location: `src/features/workspaces/server/segment.ts:36` (`resolveWorkspaceSegmentForUser` legacy branch, falls back via `findWorkspaceForMember`; `legacy_slug_redirect` event emitted at :62-64)
- Found during: workspace publicId rollout (PR #1)
- Severity: smell
- Description: After workspaces moved to `{slug}-{publicId}` URLs, the resolver still falls back to slug-only lookup so pre-migration bookmarks (`/dopl-team-workspace/members`) keep working. Each fallback hit logs a `legacy_slug_redirect` system event.
- Proposed resolution: defer — delete the legacy branch once the `legacy_slug_redirect` event drops to zero hits over 14 consecutive days. (`findWorkspaceBySlug`/`findMemberWorkspaceBySlug` in repository.ts have other callers; only the segment.ts branch dies.)
- Status: open

### F-017: PublicId rollout skipped for clusters
- Location: `src/features/clusters/`
- Found during: PR #4 scope review (publicId rollout)
- Severity: smell
- Description: workspaces, knowledge bases, and skills carry `public_id` as the URL routing handle; clusters don't. 2026-07-17 re-check: clusters DO now have a user-facing route (`/[workspaceSlug]/(app)/ontology/[clusterSlug]`), but it is auth-gated and workspace-scoped (the workspace segment already carries a publicId), so cluster-level publicId still isn't required. The originally-cited `community/server/published-slug.ts` was deleted with the community feature.
- Proposed resolution: defer — revisit only if cluster URLs ever need to be enumeration-resistant or rename-stable on their own. The workspaces/KB/skills recipe applies.
- Status: open

### F-020: Legacy `workspace_resource_access` table drop — authored, pending apply
- Location: `supabase/migrations/20260717120000_drop_workspace_resource_access.sql` (authored 2026-07-17, NOT yet applied); table originally from `20260502140000_member_resource_access.sql`
- Found during: Teams feature build (2026-06-11)
- Severity: smell
- Description: per-member resource overrides were replaced by team-based grants; nothing reads or writes `workspace_resource_access` anymore, but the table + orphaned `cleanup_resource_access_on_*` trigger functions still exist in the live DB (they also trip the SECURITY DEFINER advisor). The drop migration is written (triggers → functions → policies → indexes → table, all IF EXISTS).
- Proposed resolution: apply the migration once the teams model is confirmed stable in prod, then regen `src/shared/supabase/types.ts` (the generated types still contain the table until then).
- Status: open (pending apply)

### F-023: Effective-access rules encoded twice (pure display fn vs server enforcement)
- Location: `src/features/teams/effective-access.ts:34` (`computeEffectiveAccess`, server-invoked display) and `src/features/teams/server/access.ts:33,108` (`effectiveResourceAccess`/`listEffectiveAccess`, enforcement)
- Found during: RBAC consolidation (2026-07-10)
- Severity: conflict (latent drift risk)
- Description: same rule ladder (admin→edit; workspace-mode→role ceiling; creator→ceiling; else max team grant capped) in two shapes. A forced merge was evaluated and rejected: the server fns early-return specifically to skip team-grant queries, so a shared core would either change query patterns or shrink to a trivial helper. Both file headers cross-reference each other; a rule change must touch both.
- Proposed resolution: defer — revisit if the rules ever change (that's when drift becomes real). Never import `effective-access.ts` from client code.
- Status: open (documented)

### F-026: Ontology loads the whole workspace graph per visit — deliberate, revisit at scale
- Location: `src/features/ontology/server/service.ts:50-56` (`getSnapshot`), `use-ontology.ts`
- Found during: ontology cleanup pass (2026-07-10)
- Severity: smell (scale)
- Description: the snapshot pulls every cluster/object/membership/relationship. Per-cluster lazy loading was evaluated and deferred: the whole-graph client model is load-bearing (instant tab switches, cross-cluster ref editors, optimistic reducer assumes a complete graph). Mitigations shipped instead: snapshot served through the query cache with a dirty-guard, resources provider cached.
- Proposed resolution: defer — revisit when a workspace graph is large enough that the snapshot payload is felt (light cluster index + per-cluster pages + id→name directory).
- Status: open

### F-027: Chat transcripts + chat list are unbounded — deferred until transcripts have real size
- Location: `src/features/chats/server/repository.ts:148` (`listMessages`, no limit), `:43` (`listVisibleChats`, no limit)
- Found during: chats cleanup pass (2026-07-10)
- Severity: smell (scale)
- Description: opening a chat ships the entire transcript including `verbatim`. Measured at decision time: 3 chats / 14 messages — pagination now would be speculative, and windowing needs a UI load-more + full-fetch copy path + an MCP contract decision.
- Proposed resolution: defer — trigger is transcripts reaching real size. Shape then: `GET /api/chats/[chatId]/messages?cursor=&limit=` via `parsePageParams`/`Paginated<T>`, detail returns first page + messageCount, copy/MCP fetch full explicitly.
- Status: open

### F-033: `hiddenCount` retention counter is a deliberate approximation
- Location: `src/features/chats/server/repository.ts:76` (`countHiddenChats`)
- Found during: chats retention window build (2026-07-16)
- Severity: smell
- Description: the hidden-chats count applies the `owner_id = user OR visibility = public` predicate but not the in-memory `canSeeChat` refinements (team-grant membership, API-key private-hiding), so team-scoped-but-ungranted or API-key-scoped callers can see a slightly inflated "N older chats hidden" strip. Chosen to keep it one cheap head-count query.
- Proposed resolution: if it ever matters, push the grant predicate into the count query (join on team grants).
- Status: open

### F-035: Free-plan chats retention window is app-layer only (owner RLS reads bypass it)
- Location: `supabase/migrations/20260707170000_chats.sql:82` (`chats_owner_select`); window enforced in `chats/server/{service-reads,retention}.ts`
- Found during: billing adversarial security review (2026-07-16)
- Severity: smell (accepted for v1)
- Description: the 90-day free window is enforced in the service layer (list/detail/MCP), but a chat OWNER can still read their own >90-day rows via direct PostgREST/realtime with their JWT. Deliberately accepted: the window is a monetization gate, not a confidentiality boundary (no-data-hostage; export must stay possible). Cross-user leakage IS enforced in RLS.
- Proposed resolution: only revisit if the retention gate ever becomes contractual — needs a security-definer read path + removing direct-table SELECT for owners.
- Status: open (accepted)

### F-036: Workflows rebuilt on first-class step tables — remaining follow-up
- Location: `features/workflows/**`, `src/shared/graph/`; record of the 2026-07-16 pivot (step graphs moved to `workflow_steps`/`workflow_step_edges`, `features/canvas` deleted, drawing layer extracted to `src/shared/graph/`)
- Found during: workflows pivot
- Severity: smell
- Description: sole open follow-up — `read-pick-menu`/`pick-menu`/`workflow-bits` were copied from ontology components into workflows per the §3 no-sideways-imports rule. Promotion trigger: a THIRD consumer appears (currently 2: ontology original + workflows copy).
- Proposed resolution: promote to `src/shared/ui` when the third consumer lands; until then the copies are intentional.
- Status: open

### F-037: listWorkflows step-count N+1
- Location: `src/features/workflows/server/service.ts:180-194`
- Found during: post-rebuild verification sweep (2026-07-17)
- Severity: smell (scale)
- Description: `listWorkflows` fetches one `workflow_id` row per step workspace-wide (single `.in(...)` query, tallied client-side) to compute `step_count`. Fine at current scale; becomes a payload problem as step volumes grow.
- Proposed resolution: defer — replace with a grouped-count RPC when step volumes warrant it. (Sub-items (a)/(c)/(d) of the original sweep are fixed and pruned.)
- Status: open

### F-038: Concurrent-edit protection — remaining design smell
- Location: `skills`/`knowledge` CAS surfaces (`service-body.ts`, `service-entries.ts`, repositories)
- Found during: 2026-07-17 conflict-system audit
- Severity: smell
- Description: the 2026-07-17 hardening shipped (single-flight save chains, no-stomp 412 rebuffer, editor reseed decoupling, EntryView full-entry gating, unmount-412 toast, strict MCP versions, metadata CAS with the threaded metadata clock, presence pagehide untrack — all verified on disk). What remains is the design smell only: version tokens are `TIMESTAMPTZ` equality strings (`updated_at`/`body_updated_at`), fragile to same-tick writes and serialization drift; a monotonic version counter (or content hash) would be sturdier.
- Proposed resolution: defer — swap the token to a monotonic counter next time the skills/knowledge schema is touched; contract stays the same (opaque token + 412).
- Status: open

### F-040: New-workspace seeding follow-ups (renumbered from duplicate "F-038", 2026-07-17)
- Location: `features/workspaces/server/seed-workspace.ts` + per-feature seeds; `src/features/configuration/seed-content.ts`
- Found during: seeding build (2026-07-17)
- Severity: smell
- Description: new workspaces seed a cross-referenced "how to use Dopl" corpus via an idempotent best-effort orchestrator (idempotency key: `dopl-guide` KB slug). Remaining follow-ups: (1) `configuration/seed-content.ts` is authored but UNWIRED (zero importers) — wire it when the configuration page moves off mock data; (6) a partial-seed retry can re-run non-idempotent later surfaces (best-effort contract, low risk). Follow-ups (2)–(5) are fixed and pruned.
- Proposed resolution: (1) rides the configuration-service build; (6) accept unless partial seeds show up in practice.
- Status: open (follow-ups only)

### F-041: Over-cap files (500-line rule §2) — current tracked list
- Location: measured 2026-07-17 (`wc -l`, excluding generated types, seed fixtures, tests)
- Found during: findings-prune audit (2026-07-17)
- Severity: smell
- Description: files over the ENGINEERING §2 hard cap. Consolidates the lists formerly tracked in F-012/F-030:
  - `src/features/skills/components/skill-view.tsx` — 759 (grew with the concurrency hardening + metadata CAS; split scheduled: extract editor/save-chain hook + header controls)
  - `packages/mcp-server/src/server.ts` — 612 (registration + gating core; borderline)
  - `packages/mcp-server/src/tools/knowledge.ts` — 597 (single-tool module; split ops-vs-render if it grows)
  - `packages/dopl-client/src/client.ts` — 592 (continue per-domain method-group extraction)
  - `packages/mcp-server/src/tools/workflow.ts` — 588 (single-tool module)
  - `packages/mcp-server/src/tools/ontology.ts` — 586 (single-tool module; render half already split)
  - `src/features/workspaces/server/invitations.ts` — 517
  - `src/features/teams/server/repository.ts` — 508
- Proposed resolution: §2 applies — any edit to these files must shrink or split them in the same PR. `skill-view.tsx` is first in the queue.
- Status: open (tracked)
