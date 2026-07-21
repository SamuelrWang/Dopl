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
- Proposed resolution: apply the migration once the teams model is confirmed stable in prod, then regen `src/shared/supabase/types.ts`.
- Resolution: APPLIED 2026-07-20 (part of the F-045 batch) — the drop migration ran on the live DB, the orphan `bump_canvas_state_version()` trigger function was dropped alongside it, and `src/shared/supabase/types.ts` was regenerated (the table is gone from the generated types).
- Status: resolved (retained one cycle then prune)

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
  - `packages/dopl-client/src/client.ts` — 592 (continue per-domain method-group extraction)
  - `src/features/workspaces/server/invitations.ts` — 534 (grew past cap with the member-add gate; split scheduled — extract the accept/join sub-flows)
  - `src/features/teams/server/repository.ts` — 508
- 2026-07-20 (Bucket 3): the three MCP tool modules formerly on this list — `packages/mcp-server/src/tools/knowledge.ts` (597), `workflow.ts` (588), `ontology.ts` (586) — were SPLIT into `<tool>-ops-{read,write,admin}` / `<tool>-shared` / `<tool>-render` modules behind thin registrars (all now < 500 lines); `dist/` rebuilt. Removed from the list; pattern recorded in ENGINEERING §2.
- Proposed resolution: §2 applies — any edit to these files must shrink or split them in the same PR. `skill-view.tsx` is first in the queue.
- Status: open (tracked)

### F-042: MCP surface swarm-audit fix batch (2026-07-18)
- Found during: 14-agent consumer-side audit of the whole MCP surface (report + fixes in one session)
- Severity: mixed (fixes shipped in-branch; open follow-ups below)
- Shipped in this batch (see ENGINEERING "MCP surface hardening"): packs feature removed; `dist/` staleness fixed via `build:packages` (root cause of the shipped-but-not-live strict-CAS); `workspace=""` fail-closed + effective-workspace footer; `add_node` atomicity; workflow/chat soft-delete + restore + trash; ontology `expected_version` CAS; **ontology `delete_cluster` cascade-soft-delete + `restore_cluster`, via ATOMIC RPCs** (`cascade_soft_delete_cluster`/`cascade_restore_cluster`, migration `20260718000040`); `agent_write_enabled` now ENFORCED on both writes (F-10b) and deletes (F-10) for agent callers; null-byte stripping; atomic chat export; re-export preserve-by-default; 30-day trash-retention cron (`/api/cron/purge-trash`, supersedes `knowledge-trash-purge`); tokenized cross-surface search; validation/error-envelope + empty-state polish; slug accent transliteration; KB search-by-id, empty-body, title-as-path, insertion-order position.
- Reviewed by 4 adversarial review agents (access-control, retention, isolation-regression, cluster-cascade). Isolation confirmed NO regression against code + live DB. The cluster-cascade review caught a HIGH non-atomic data-loss path → fixed with the atomic RPC above.
- **Migrations 20260718000001/2/10/20/40 have been APPLIED to the remote DB, and `src/shared/supabase/types.ts` regenerated** (packs tables gone; `deleted_at` + the RPCs present). The chats/workflow code still carries a few localized casts (`supabaseAdmin()` is untyped) — de-casting is optional cleanup.
- **Open follow-ups (NOT done this batch):**
  1. **`proxy.ts` may not be wired as Next middleware** (isolation review): Next only auto-loads `middleware.ts`, and none exists; `.next/middleware-manifest.json` is empty. If unwired at runtime the session-layer gate never runs — NOT an isolation leak (every route self-enforces via `withUserAuth`/`withWorkspaceAuth`), but worth a dedicated auth-wiring check. Pre-existing; untouched by this batch.
  2. ~~Ontology has no web trash/restore UI~~ — **RESOLVED** by the unified Workspace Trash (`features/trash/`, a Settings-panel section covering all 7 soft-delete types incl. ontology clusters, with Restore + Delete-permanently). `proxy.ts` middleware wiring (item 1) is also **confirmed active** — the `next build` manifest lists `ƒ Proxy (Middleware)`.
  3. **A2 partial:** the read-only-to-agents (`AGENT_WRITE_DISABLED`) message is now surfaced cleanly on the primary write ops (`write_file`, `update_base`, skill `write`/`update`) and all deletes; the rarer KB write ops (`set_visibility`, `create_folder`, `move_*`, `restore_*`) still surface the raw code. Low.
  4. **F-22 unknown-param rejection deferred:** the MCP SDK zod-parses and strips unknown args before the handler runs, so framework-level strict rejection isn't reachable via `server.tool`. Root cause fixed instead (the seeded `file-knowledge-well` skill no longer tells agents to pass a nonexistent `excerpt`; `archive-a-session` `clientSessionId`→`client_session_id`). Revisit if the SDK exposes strict schemas.
  5. **F-24 cluster name casing (JUDGMENT):** the UPPER_SNAKE `normalizeClusterName` is intentional/load-bearing for the canvas tab, so it was KEPT and documented (agents match by slug/id). Workflows were decoupled to preserve casing (`normalizeWorkflowName`). Revisit if you want clusters to preserve casing too (canvas display via CSS).
  6. **Minor/pre-existing:** by-id lookups (`assertSameWorkspace`) reveal cross-workspace existence via the mismatch error vs a generic 404 (info oracle, no data crosses); ontology cascade over-collects an object shared across multiple clusters (theoretical, depends on multi-membership data); `hardDeleteOlderThan` (per-workspace) in `repository-trash.ts` is pre-existing dead code left in place.
  7. Behavior change to confirm: **seeded starter skills are now read-only to agents** (a consequence of enforcing `agent_write_enabled`; the seed sets it explicitly, mirroring the seeded KB). Humans still edit them in the web UI. Flip the seed's `agentWriteEnabled` if agents should be able to edit starter skills.
- Status: open (follow-ups tracked)

### F-043: MCP-2 — remove the default-workspace fallback (fail-closed resolution)
- Location: `features/workspaces/server/service.ts` (`resolveActiveWorkspace` + `WorkspaceResolutionError`), `shared/auth/with-workspace-auth.ts` (`workspaceIdFromQuery`), `app/api/mcp/route.ts` (header hygiene), `packages/mcp-server/src/{factory,server}.ts` (directory boot, `buildInstructions`, wrapper enforcement, footer, `set_workspace` removal)
- Found during: MCP-2 workspace-resolution rework (frozen contract, 3 investigation reports)
- Severity: bug (silent mis-scoping) + conflict (two resolution notions)
- Description / SHIPPED in-branch: killed the oldest-owned / auto-create fallback in `resolveActiveWorkspace`. Header-less resolution now uses ACTIVE memberships (exactly one auto-targets; 0/2+ → 400 `WORKSPACE_REQUIRED`; blank/non-UUID header → 400 `WORKSPACE_INVALID`; flat `{error,message,workspaces?}` envelope). MCP boots off `listWorkspaces()` (no `getActiveWorkspace` handshake), 2+ memberships leave no default and the wrapper refuses a no-`workspace=` call (M-3), instructions bake the directory (M-2), footer is mandatory-effective with a source label (M-4), `set_workspace` removed and `current_workspace` repurposed (M-5). Export GETs opt into `workspaceIdFromQuery`. `findDefaultWorkspaceForUser` demoted to signup-bootstrap + billing-grandfather only.
- **B2 latent bug FIXED as a side effect:** `features/trash/components/workspace-trash-section.tsx` sent no `X-Workspace-Id` to its `withWorkspaceAuth` trash routes, so it showed the *default* workspace's trash while viewing another workspace's settings (and would 400 under fail-closed). The settings page now passes `workspace.id` and the component forwards it on all 3 requests. The public pricing page (`marketing/pricing-content.tsx`) was likewise scoped to a sole workspace / handed off to the in-app billing pane for multi-workspace users so `/api/billing/status` never fires header-less.
- Tests: `resolve-active-workspace.test.ts`, `with-workspace-auth.test.ts` (root), `packages/mcp-server/src/server.test.ts` (createServer 0/1/2+, footer, blank arg, `buildInstructions`). Parity suite unchanged (no new tool ops; `set_workspace` was a meta-tool, uncaptured).
- Proposed resolution: fix-now — DONE. No open follow-ups; prune this entry on the next findings audit (git remembers).
- Status: resolved (in-branch; retained for one cycle per the shipped-batch precedent of F-042)

### F-044: Billing plan taxonomy v2 (Free / Solo / Team) — deploy checklist (2026-07-19)
- Location: `features/billing/**`, `app/api/billing/{checkout,upgrade-to-team}`, `features/workspaces/server/{invitations,join-links}.ts` (member-add gate), `features/members/**` (402 → UpgradeModal), `marketing/{pricing-content.tsx,marketing.css}`, `analytics/server/launch-metrics.ts`, `supabase/migrations/20260719000000_workspace_billing_plan_taxonomy_v2.sql`
- Found during: plan-taxonomy rework (4-agent build + 2-reviewer pass, this session)
- Severity: deploy-blocker checklist (code is complete in-branch; external state pending)
- Description / SHIPPED in-branch: plan enum `free|solo|team` (was `free|pro`); Solo $5.99 flat single-member with `assertCanAddMember` on all four member-add paths + entitlements degrade backstop; Team $7.99/seat (renamed from Pro, same live price); plan-aware seat-sync; webhook price→plan derivation; in-place `upgrade-to-team` price swap; pricing page rebuilt with comparison strip; MRR metric now solo+team aware.
- Deploy checklist status (2026-07-19, run with user approval):
  1. DONE — live Stripe "Dopl Solo" created: product `prod_Uv3JEot3Jb3cgV`, price `price_1TvDCuPyqrLgRVbyBTPG5ab8` ($5.99/mo licensed) via `scripts/create-solo-price.mts` (idempotent, kept in repo); `STRIPE_SOLO_PRICE_ID` set in `.env.local`.
  2. DONE — taxonomy migration applied to live Supabase; verified: CHECK is `('free','solo','team')`, zero `pro` rows, the one live paid row is `team/active`.
  3. OPEN — Vercel env (no CLI on this machine, add via dashboard): `STRIPE_PRO_SEAT_PRICE_ID` (missing since 2026-07-16) AND `STRIPE_SOLO_PRICE_ID=price_1TvDCuPyqrLgRVbyBTPG5ab8`.
  4. DONE — live smoke `scripts/smoke-billing.mts`: 29/29 pass post-migration (incl. team lifecycle + stale-replay watermark).
- Post-build adversarial review (2 lenses) applied same-session: canceled-via-`updated` now NULLS sub pointers like `deleted` (billed-but-free-entitled + checkout-lockout chain closed); `checkout.session.completed` is watermark-guarded (`applyStripeEvent`); `payment_failed` requires a positive sub-id match; checkout idempotency key includes quantity; `upgrade-to-team` restamps `metadata.plan`; add-member modal got a loading guard + live-sub (degraded-solo) routing; checkout 409 surfaces `portalUrl`; invite dialog reports partial multi-email success. Watermark stays `<=` deliberately (same-second `deleted`/`updated` resurrection risk beats the self-healing missed-update cost).
- Status: open (deploy checklist only; code paths test-green: 342 root + 37 mcp-server + repo tsc/eslint)

### F-045: Audit-fix batch (2026-07-20) — highs + meds shipped
- Location: app-wide; key surfaces: `src/shared/auth/{with-auth,with-workspace-auth,write-gate-coverage.test}.ts`, `features/billing/**`, `app/api/{billing,cron/reconcile-seats}/**`, `features/teams/server/*` (`getAccessMatrix`), `features/members/**`, `packages/mcp-server/src/tools/*`, `packages/dopl-client`, `src/shared/api/*`, plus applied migrations (see below)
- Found during: large consumer-side audit of billing / RBAC / MCP / RLS (report + fixes, one session; artifact 1e3a7d35)
- Severity: mixed (app-code shipped in-branch + migrations applied to prod; open follow-ups → F-046–F-049)
- Shipped app-code (working tree, uncommitted; tsc + 444 root/mcp tests green):
  - **H-1** billing checkout/portal/upgrade-to-team confirmed `minRole:"admin"` (now also `sessionOnly`, see H-3 / ENGINEERING §9 "OAuth write-scope & session-only gating").
  - **H-2** skills `versions/[id]/restore` + `[slug]/duplicate` gained `minRole:"member"` (were defaulting to viewer).
  - **H-3** NEW auth-wrapper options `writeScopeExempt` + `sessionOnly` on `withUserAuth`/`withWorkspaceAuth`. OAuth-bearer write-method (non-GET) calls lacking `dopl.write` scope → 403 `WRITE_SCOPE_REQUIRED` (+`WWW-Authenticate: insufficient_scope`); session/cookie callers never gated; `/api/mcp` (op-level `WRITE_OPS` still applies) + `user/mcp-status` are `writeScopeExempt`. `sessionOnly:true` rejects ALL OAuth tokens (403 `SESSION_REQUIRED`) on 15 destructive/permission routes. Tripwire `write-gate-coverage.test.ts` pins both sets. Documented in ENGINEERING §9 (key doc addition).
  - **M-8** `assertCanAddMember` SOLO_MEMBER_LIMIT now emits the FLAT `{error,message,upgrade_url}` envelope (matches `entitlementDeniedBody`; was nested).
  - **M-3 (partial)** in-process checkout guard + pre-mint billing re-read in `checkout/route.ts` (full cross-instance fix deferred → F-047).
  - **M-4** new `src/app/api/cron/reconcile-seats/route.ts` (`CRON_SECRET`-gated, daily in `vercel.json`) trues up Team seat quantity (ENGINEERING §8).
  - Plan taxonomy `PlanId`/`BillingStatus` single-sourced from `features/billing/plans.ts` (was 3 duplicate unions).
  - Teams `getAccessMatrix` now includes team-gated skills (Access tab + effective-access drawer were omitting them).
  - FE: app-shell seeds role from server (no viewer-flash); billing `?billing=` rAF/StrictMode strand fixed; generic `UpgradeModal` branches to in-place upgrade-to-team for degraded-Solo; billing-status query `staleTime` lowered + `useInvalidateBillingStatus` exposed.
  - MCP tools: 5 `dopl_kb` write ops + `dopl_workflow` write/admin ops map backend errors to clean guidance; zod caps added to workflow/ontology/knowledge tool inputs; orphaned `dist/tools/packs.js` removed + `dist` rebuilt.
  - `src/shared/api`: 4 `to*ErrorResponse` helpers deduped; workflow graph/nodes/edges routes use `parseJson` (clean 400, not 500).
  - Dead code removed: prod deps `react-markdown`/`@octokit/rest`/`@base-ui/react` + `markdown-message.tsx`; skills `url.ts`/`segment.ts`/`hooks.ts` + `visibility-pill.tsx`; `.env.example` fixed (added `STRIPE_SOLO_PRICE_ID`, dropped knowledge-pack secrets).
- Shipped migrations (APPLIED to prod this session; `src/shared/supabase/types.ts` regenerated):
  - **H-4** trigger `bump_ontology_object_on_relationship_change` on `ontology_relationships` bumps the source object's `updated_at`, so the relationship-write `expected_version` CAS actually works (+ paired `service.ts` re-read).
  - **H-5** trigger `enforce_last_active_owner` on `workspace_members` blocks dropping a workspace to 0 active owners (`FOR UPDATE` on the `workspaces` row closes the TOCTOU).
  - **M-1** `community-thumbnails` storage policies rescoped to the owner path (were open to all authenticated).
  - **M-12** 8 covering FK indexes.
  - Applied the previously-unapplied **F-020** `drop_workspace_resource_access` migration; dropped orphan `bump_canvas_state_version()`.
- Minor open follow-up: wire `useInvalidateBillingStatus` into the members-feature mutations so member add/remove refreshes the seat-count/entitlements cache.
- Carve-out follow-up status (2026-07-20 Bucket 3): F-046 (M-9) and F-047 (M-3 full) are now RESOLVED + applied to prod, and F-049's `auth_rls_initplan` half is RESOLVED. F-048 (M-5) and F-049's `multiple_permissive_policies` remainder stay open.
- Proposed resolution: fix-now — DONE for the above. Deferred work carved out to F-046 (M-9), F-047 (M-3 full), F-048 (M-5), F-049 (RLS-perf backlog); `invitations.ts` over-cap split tracked in F-041.
- Status: resolved (in-branch + prod migrations; retained one cycle then prune)

### F-046: M-9 — `is_workspace_member` is an authenticated membership oracle
- Location: `is_workspace_member(...)` SQL function (`EXECUTE` granted to `authenticated`); ~60 RLS policies call it
- Found during: audit-fix session (2026-07-20, RLS review)
- Severity: bug (info-disclosure — a signed-in user can probe membership of workspaces they aren't in)
- Description: the helper is executable by any authenticated role, so it can be called to test arbitrary workspace membership. The correct fix is an RLS-wide rewrite to a 2-arg, `auth.uid()`-pinned predicate across every calling policy, then `REVOKE EXECUTE` on the oracle — too broad for this batch.
- Proposed resolution: defer — dedicated migration that rewrites all calling policies to the pinned predicate then revokes the function. Not a row-crossing leak today (policies still scope rows); close it before wider multi-tenant exposure. Coordinate with F-049 (same policy surface).
- Resolution: APPLIED TO PROD 2026-07-20 (Bucket 3). Migration `20260720211005_rls_pin_workspace_member_and_initplan` — created SECURITY DEFINER `is_current_workspace_member(uuid,text)` pinning `(SELECT auth.uid())`; rewrote all 62 policies calling the 3-arg `is_workspace_member` to the 2-arg wrapper; `REVOKE EXECUTE` on `is_workspace_member(uuid,uuid,text)` from `authenticated` (oracle closed). Follow-up migration `20260720214500` revoked the inert `anon` grant on the wrapper. Verified: oracle-closure gate returns 0 rows; `is_workspace_member` acl = `{postgres,service_role}`. Done in the same migration as the F-049 `auth_rls_initplan` fix (shared policy surface).
- Status: resolved (prod migration; retained one cycle then prune)

### F-047: M-3 (full) — cross-instance duplicate-subscription race
- Location: `src/app/api/billing/checkout/route.ts` (in-process guard + pre-mint re-read shipped in F-045)
- Found during: audit-fix session (2026-07-20, billing review)
- Severity: bug (duplicate Stripe subscription / double-charge under concurrency)
- Description: the shipped in-process guard + pre-mint billing re-read close the same-instance race, but two serverless instances can each still mint a checkout session for one workspace before either writes back. A durable fix needs an atomic claim (a `checkout-claim` column on `workspace_billing`) — i.e. a schema change.
- Proposed resolution: defer — add the claim column + atomic claim-before-mint. Until then the webhook event-ordering watermark and the "checkout blocks when a non-canceled sub exists" guard limit the blast radius.
- Resolution: APPLIED TO PROD 2026-07-20 (Bucket 3). Migration `20260720210814_workspace_billing_checkout_claim` — added `workspace_billing.checkout_claim_at` + the `claim_workspace_checkout(uuid)` RPC (atomic `INSERT .. ON CONFLICT DO UPDATE` cross-instance compare-and-set, service_role-only). Wired into the checkout route (claim before session create; release in `finally` / on webhook); the in-process `Set` was removed. Verified: `claim_workspace_checkout` returns `true` then `false` on a second concurrent call.
- Status: resolved (in-branch + prod migration; retained one cycle then prune)

### F-048: M-5 — invite-accept doesn't bind the accepting identity to the invited email
- Location: `src/features/workspaces/server/invitations.ts` (`acceptInvitationByToken`)
- Found during: audit-fix session (2026-07-20)
- Severity: question (product decision)
- Description: accepting an invitation only requires possession of the token — the accepting user's email is never compared to the invited email, so a forwarded invite link is redeemable by whoever holds it.
- Proposed resolution: needs-user-decision — HELD by owner. If bound: compare the authenticated user's email to the invitation's `email` at accept time and reject a mismatch (breaks the "invite one address, accept from another" flow, hence a product call).
- Status: open (question)

### F-049: RLS performance advisor backlog
- Location: Supabase advisor lints — `multiple_permissive_policies` (36 remaining; the `auth_rls_initplan` half is resolved, see below)
- Found during: audit-fix session (2026-07-20, advisor sweep)
- Severity: smell (scale / perf)
- Description: two advisor families. `auth_rls_initplan` = policies calling `auth.*()` per-row instead of wrapping in a scalar subselect (`(select auth.uid())`); `multiple_permissive_policies` = several permissive policies on one role/action that all evaluate. Both degrade query planning at scale; neither is a correctness bug.
- `auth_rls_initplan` — RESOLVED 2026-07-20 (Bucket 3), APPLIED TO PROD. The same migration as F-046, `20260720211005_rls_pin_workspace_member_and_initplan`, wrapped every `auth.uid()`/`auth.jwt()` call in `(SELECT ...)` across all 73 public policies; the advisor dropped 70 → 0.
- `multiple_permissive_policies` (36 lints) — STILL OPEN, deferred on purpose (correctness > perf). Consolidating permissive policies risks a row-scoping regression, so it is held for a dedicated, test-gated pass.
- Proposed resolution: defer — the safe recipe is documented in the header of migration `20260720211005`: split each `*_admin_write` / `*_editor_write` `FOR ALL` policy into explicit `FOR INSERT` / `FOR UPDATE` / `FOR DELETE`, leaving the member `FOR SELECT` as the sole SELECT policy (optionally fold `chats_owner_select` into `chats_member_select`); ship behind a no-regression isolation test.
- Status: open (deferred — `auth_rls_initplan` half resolved 2026-07-20; `multiple_permissive_policies` remainder open)
