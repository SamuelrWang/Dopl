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

### F-050: Channels soft-delete not wired into the unified Trash aggregator / purge cron
- Location: `src/features/channels/**` (channels carry `deleted_at`, the service layer hides trashed rows); NOT registered in `src/features/trash/server/service.ts` (aggregator) nor `src/app/api/cron/purge-trash/route.ts` (its `TABLE_ORDER` has no channel table)
- Found during: Channels feature build (2026-07-25)
- Severity: smell
- Description: channels have a `deleted_at` soft-delete, but — unlike knowledge/skills/workflows/chats/ontology — they aren't a `TrashKind` in the unified Workspace Trash aggregator, so a deleted channel is NOT restorable from the Settings Trash UI, and the daily `/api/cron/purge-trash` sweep never hard-deletes aged channel rows (30-day retention skips them entirely).
- Proposed resolution: defer — add `listTrashed*`/`restore*`/`purge*` channel service fns + a `TrashItem` kind (each re-entering the channels auth gate) per ENGINEERING §7 "Unified Workspace Trash", and add `channels`/`channel_messages` to the purge cron `TABLE_ORDER`.
- Status: open

### F-051: Older content tables keep `authenticated`+`anon` DML grants (channels-parity revoke pending)
- Location: `chats` / `chat_messages` / `chat_folders` (and the other pre-channels content tables) — base grants intact, default-deny RLS only; contrast `channels`/`channel_members`/`channel_messages` (grants REVOKED in `20260725130000_channels_rls_hardening.sql`)
- Found during: Channels feature build (2026-07-25)
- Severity: smell (defense-in-depth)
- Description: the channels tables revoke `INSERT/UPDATE/DELETE` from `authenticated`+`anon` and drop all write policies (service-role-only writes). The older content tables still carry the base `authenticated`/`anon` DML grants and rely on default-deny RLS policies alone. Not a live leak (RLS still scopes rows), but the grant surface is broader than needed; bringing at least chats to channels-level revoke parity would harden defense-in-depth.
- Proposed resolution: defer — after confirming no client-direct writes remain (writes already flow through the service), a migration that REVOKEs `authenticated`/`anon` DML on the chats tables + drops their client write policies. Sequence table-by-table; chats first.
- Status: open

### F-052: `supabase/types.ts` not regenerated for the channel tables (repository/dto casts stand in)
- Location: `src/shared/supabase/types.ts` (no `channels`/`channel_members`/`channel_messages` rows, no `channel_message_insert` RPC); casts in `src/features/channels/server/{repository,dto}.ts`
- Found during: Channels feature build (2026-07-25)
- Severity: smell
- Description: the generated `Database` types weren't regenerated after `20260725120000_channels.sql`, so the three tables + the `channel_message_insert` RPC are absent from `types.ts`. The channels repository/dto compile via localized casts at the Supabase boundary (the same pattern the chats feature uses for its newer columns; `supabaseAdmin()` is untyped). Mirrors the residual-cast note in F-042.
- Proposed resolution: defer — regenerate `src/shared/supabase/types.ts` (`mcp__supabase__generate_typescript_types`) and drop the casts the next time types are regenerated for another change.
- Status: open

### F-053: Channel web thread has no backward pagination past the latest page
- Location: `src/features/channels/**` (message read caps at `MAX_MESSAGE_LIMIT = 200`, `constants.ts`; web thread `channel-thread.tsx` / `use-channel-messages.ts`)
- Found during: Channels feature build (2026-07-25)
- Severity: smell (scale)
- Description: the thread reads only the most recent messages (`limit <= 200`) with no load-older / backward page, so once a channel exceeds ~200 messages the older history is unreachable from the web UI. The `seq` cursor already drives incremental FORWARD reads (`read`/`await` with `since=`); backward paging needs a `before=<seq>` read path + a "load older" control. Same shape as the deferred chat pagination (F-027).
- Proposed resolution: defer — add a `GET …/messages?before=<seq>&limit=` descending page + load-older UI when channel history reaches real size.
- Status: open

### F-054: Desktop app — deep-link `state` echo pending for full CSRF protection (auto-updater SHIPPED)
- Location: `dopl-desktop-app/**` (Electron 43; `dopl://` deep-link handler + channel listener / Claude-session spawner; `main/updater.js`)
- Found during: Channels feature build (2026-07-25)
- Severity: smell
- Description: two follow-ups on the modernized desktop app. (1) ~~No auto-updater is wired — each release still requires a manual DMG re-download.~~ (2) The `dopl://` deep-link auth flow ships a pending-flag + TTL gate against replay, but full CSRF protection also needs the WEB side to echo the `state` parameter back in the `dopl://` fragment so the desktop handler can verify it round-trips — not yet implemented web-side.
- Resolution (partial, 2026-07-26): **(1) SHIPPED** — `main/updater.js` wires electron-updater against GitHub Releases (`SamuelrWang/Dopl`), zip + dmg + `latest-mac.yml` feed, checks at startup + every 4h, installs on quit / explicit "Restart to install" tray item (never force-restarts a live session). Release via `npm run release` (`electron-builder --mac --publish always`); the release tag must be `v<version>`. Documented in ENGINEERING §18 "Desktop app v1.1". **(2) still OPEN** — the web side does not yet echo `state` in the deep-link fragment.
- Proposed resolution: defer — remaining work is (2): add the web-side `state` echo in the deep-link fragment and verify it round-trips in the desktop handler.
- Status: open (auto-updater half shipped 2026-07-26; web-side deep-link `state` echo remainder open)

### F-055: `dopl_channel` invite/post pre-resolve via `listChannels`; `getChannel` client method unused
- Location: `packages/mcp-server/src/tools/channel-shared.ts` (`resolveChannelOr` → `client.listChannels({ includeArchived: true })`, used by `channel-ops-write.ts` invite/post); `packages/dopl-client/src/{channel,client}.ts` (`getChannel`, no callers)
- Found during: Channels feature build (2026-07-25)
- Severity: smell
- Description: `read`/`await` are hot pass-throughs — they hand the channel ref straight to the route (which resolves slug-or-id + enforces visibility), so the poll loop takes no extra round-trip. `invite`/`post` still pre-resolve the target channel by scanning `listChannels()` (`resolveChannelOr`), an O(n) list per write, instead of addressing it by id. `@dopl/client` also carries an unused `getChannel(channelId)` method, reserved for a future `dopl_channel(op="get")`.
- Proposed resolution: defer — give the write ops an id-addressed resolve (or land the `get` op backed by `getChannel`) so they don't scan `listChannels`.
- Status: open

### F-056: Consent dialog can dangle after a notification-Allow (Electron can't dismiss `showMessageBox`)
- Location: `dopl-desktop-app/main/channel-listener.js` (`requestConsent` — dual consent surfaces)
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: smell (UX wart)
- Description: consent is offered on two surfaces at once — the alert notification's **Allow** button and the in-app `showMessageBox` dialog. When the user answers via the notification, `finish()` resolves the promise and closes the notification, but Electron has **no API to programmatically dismiss an open `showMessageBox`**, so the dialog stays on screen until the user also clicks it. It is harmless — the decision already settled (`settled` guard), so the later dialog click is an idempotent no-op — but a stale dialog lingering after the request was already approved is a confusing wart.
- Proposed resolution: defer — if it grates, replace the native `showMessageBox` with a custom `BrowserWindow` (closable via IPC, like the code-prompt window) so the winning surface can dismiss the other.
- Resolution: RESOLVED in desktop v1.4 (2026-07-27, consent redesign Round B) — the blocking `showMessageBox` consent surface was REMOVED entirely. Consent is now a durable async `channel_consent_requests` row surfaced by a native notification (Allow/Send) + the web Pending Requests list + a tray "Pending: N" count, driven by `main/consent-watcher.js` (see ENGINEERING §18 "Desktop app v1.4"). With no `showMessageBox` there is no second surface left to dangle — a notification-Allow settles the server row and the web list reflects it, so the dual-surface dismiss race this entry describes no longer exists.
- Status: resolved (desktop v1.4; retained one cycle then prune)

### F-057: Web composer has no addressing UI — 3+ member channels can't be triggered from the web (P0 product gap)
- Location: `src/features/channels/components/message-composer.tsx` (posts plain body only); addressing is MCP-only (`packages/mcp-server/src/tools/channel-ops-write.ts` `opPost` `to`/`summary`)
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: smell (P0 product gap — a whole path is unreachable from the primary UI)
- Description: message addressing (`to_user_id`/`summary`) ships only through the `dopl_channel(op="post")` MCP tool. The web composer posts an unaddressed message, and the desktop listener only IMPLICITLY triggers in **exactly-2-member** channels (F-054/§18 targeting) — so in a channel with 3+ members a human posting from the web has **no way to address a specific member's agent**, and the message classifies as FYI (no trigger) for everyone. Channels are therefore only human-triggerable from the web in 1:1 rooms.
- Proposed resolution: fix next build round — add an addressee/summary control to `message-composer.tsx` that sets `toUserId`/`summary` on the POST (the server + DTO + listener already honor them end-to-end; only the compose UI is missing). Tracked as a P0 for the next Channels round.
- Resolution: SHIPPED in Channels v1.2 (2026-07-26, in-branch) — `components/address-picker.tsx` (member popover with a presence dot) + `message-composer.tsx` now set `toUserId` and `summary` (auto-derived from the first line when left blank) on the POST. It also renders the two states a requester needs before sending: an offline/never-connected warning for the selected target (from `agentOnline` / `lastSeenAt`, §8 presence) and an "no agent will pick this up unless you address it" hint on unaddressed posts in 3+ member channels.
- Status: resolved (in-branch; retained for one cycle per the F-042/F-043 precedent)

### F-058: No unread / notification surface for Channels outside the Channels page
- Location: `src/features/channels/**` + `src/shared/layout/app-shell/**` (no channel unread badge / global indicator; `channel_members.last_read_at` exists but isn't surfaced in chrome)
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: smell
- Description: a member only learns about new channel activity by having the Channels page open (web) or via the desktop listener's OS notifications. There is no unread badge on the workspace sidebar/rail, no global "N new messages" indicator, and no in-app notification center — so a web-only user with the page closed misses everything. `last_read_at` is already tracked per membership; the read side just isn't wired into the app chrome.
- Proposed resolution: defer — derive an unread count from `last_read_at` vs. the channel's latest `seq` and surface a badge in the app-shell sidebar (+ optionally an in-app toast on realtime channel events).
- Status: open

### F-059: Missing-CLI addressed requests are silently dropped after one boot warning
- Location: `dopl-desktop-app/main/channel-listener.js` (`handleTrigger` early-returns on `!spawner.claudeAvailable()`; the one-time `cliWarned` notice fires in `start()`)
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: bug (dropped request — requester gets no signal)
- Description: when the Claude CLI can't be resolved on PATH, the listener shows a single "CLI not found" notification at startup, then every addressed/implicit trigger is dropped in `handleTrigger` with only a `diag()` line — deliberately no error reply into the channel (avoids leaking local machine state / spamming the thread). Consequence: a teammate who addresses this operator's agent gets **no response and no indication** the operator's machine can't answer; the request just vanishes (the cursor has already advanced, so it won't re-prompt).
- Proposed resolution: defer — decide a signal that doesn't leak local state: e.g. post a terse channel-visible "operator unavailable" once per channel per outage, or reflect an availability/presence flag on the member so requesters can see the agent is offline before addressing it.
- Resolution (partial, Channels v1.2 2026-07-26): the **presence half shipped** — `agent_presence` + the desktop heartbeat (§8/§18) drive `agentOnline`/`lastSeenAt` on the roster, and the composer warns before you send ("their agent is offline" / "has never connected"). That covers the never-set-up and app-not-running cases. **Still open:** the specific drop this entry names — the app IS running and heartbeating (so it reads as online) but `spawner.claudeAvailable()` is false, so the trigger is dropped in `handleTrigger` with only a `diag()` line and the requester still gets nothing. Presence cannot express "listening but cannot execute".
- Status: open (presence/offline signalling shipped 2026-07-26; the CLI-missing silent drop remains)

### F-060: No post rate limit or metadata size cap on channel messages
- Location: `src/features/channels/**` (`schema.ts` message schema, `server/service-writes.ts` `postMessage`, `app/api/channels/[channelId]/messages/route.ts`)
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: smell (abuse / scale)
- Description: message posts are gated only by channel membership. There is **no per-user/per-channel post rate limit** (an agent in a loop, or a runaway listener, can append unboundedly — each insert takes the per-channel advisory lock, so a hot poster also serializes the channel) and **no overall cap on `metadata` size** (the `summary` field is length-capped, but the free-form `metadata` jsonb blob is not), so a large structured payload rides straight into the row. Not a live incident at current scale, but the abuse surface is open.
- Proposed resolution: defer — add a token-bucket post limit (per `(user, channel)`) surfaced as 429, and a byte cap on the serialized `metadata` in the message schema.
- Status: open

### F-061: Workspace admins have no visibility into private channels (governance gap — deliberate v1 posture)
- Location: `src/features/channels/server/{service-shared.ts (loadVisibleChannel), service-reads.ts (listChannels)}`; RLS member-SELECT policies in `20260725120000_channels.sql`
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: question (governance decision)
- Description: private-channel reads are gated on channel MEMBERSHIP, not workspace role — so a workspace owner/admin who was never invited to a private channel cannot list it, read it, or moderate it (RLS + service both scope to members). This is the intentional v1 privacy posture (a private channel is private even from admins), but it means there is **no admin/governance override** for compliance, offboarding, or abuse review of private channels in a workspace they own.
- Proposed resolution: needs-user-decision — hold as an open decision. If governance wins over privacy: add an admin read/override path (audited, role-gated) or a workspace policy that makes private channels admin-visible. Documented as an open v1 decision, not a fix.
- Status: open (question)

### F-062: `TRUNCATE` is granted to `authenticated` + `anon` on nearly every public table (repo-wide, RLS-bypassing)
- Location: repo-wide grant surface — verified live on prod (`mrefkedvdehahjejreae`): **35 of 47** `public` base tables grant `TRUNCATE` to BOTH `authenticated` and `anon`. Includes all six channels-family tables (`channels`, `channel_members`, `channel_messages`, `channel_consent_requests`, `agent_trust_rules`, `agent_presence`) whose migrations explicitly `REVOKE INSERT, UPDATE, DELETE … FROM authenticated, anon` but never revoke `TRUNCATE`. The 12 tables without it are the ones whose grants were revoked wholesale (`mcp_tokens`, `oauth_clients`, `oauth_authorization_codes`, `system_events`, `webhook_events`, `rate_limit_events`, `mcp_events`, `conversion_events`, `knowledge_entry_chunks`, `workspace_join_links`, `workspace_join_requests`, `workspace_invitation_teams`).
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: bug (security — RLS-bypassing privilege), latent
- Description: the grant is inherited from Supabase's stock `GRANT ALL` / `ALTER DEFAULT PRIVILEGES` on the `public` schema, and every hardening migration written since has enumerated only `INSERT/UPDATE/DELETE`, so `TRUNCATE` has ridden along untouched — including on the tables we hardened hardest. **`TRUNCATE` is not row-scoped: RLS policies do not apply to it at all**, so the privilege is a whole-table wipe that the default-deny row policies these tables rely on cannot see. **Not reachable today:** PostgREST only issues DML and RPC — it has no `TRUNCATE` verb — so exploiting it needs either a `SECURITY DEFINER`-shaped function that truncates, or a direct Postgres connection as one of those roles. It is a standing over-grant, not a live hole.
- Proposed resolution: defer — one repo-wide migration: `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated, anon` **plus** `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated, anon` so new tables don't re-inherit it. Deliberately NOT patched channels-only in v1.2 — a six-table carve-out would leave the same hole on the other 29 and imply the rest were checked. Sequence with the F-051 grant-parity pass (same surface, same migration slot).
- Resolution: APPLIED TO PROD 2026-07-26. Migration `20260727120000_revoke_truncate_public.sql` — `(a)` `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated, anon` (existing tables) + `(b)` `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM authenticated, anon` (future tables). ONLY TRUNCATE, ONLY from authenticated+anon — no other privilege/role touched. **Creating role = `postgres`** (all 47 public tables are postgres-owned and migrations run as `postgres`), so a single `FOR ROLE postgres` default-privileges revoke covers future migration tables; the parallel `supabase_admin` default-ACL entry is Supabase's platform default (applies only to supabase_admin-created tables, unalterable by non-superuser `postgres`) and was correctly left alone. Verified before/after: TRUNCATE-to-authenticated/anon table count **35 → 0**; SELECT/INSERT/UPDATE/DELETE grants unchanged (spot-checked `chats`/`knowledge_entries`/`workspaces` keep full DML, channels tables keep their F-051 SELECT-only shape); `service_role` retains TRUNCATE on all 47; only `postgres`+`service_role` still hold TRUNCATE. Default-ACL check: `postgres` `r`-defaults no longer list TRUNCATE for anon/authenticated. Advisors (security + performance) introduced NO new WARN/ERROR (security lints all pre-existing; performance still the F-049 `multiple_permissive_policies` backlog, zero ERROR). Related precedent: F-051 (channels-only DML grant-parity revoke); this is the schema-wide TRUNCATE analogue.
- Status: resolved (prod migration; retained one cycle then prune)

### F-063: `onlineMemberCount` costs 2 extra queries on every channel LIST read and is rendered nowhere
- Location: `src/features/channels/server/service-reads.ts` (`listChannels` + `getChannel` → `collab.channelMemberUserIds(ids)` + `collab.presenceForWorkspace(ctx.workspaceId)` feeding `onlineCounts()`); exposed at `server/dto.ts:78,135` and `types.ts:114`; the "nothing renders it" note is already in `components/channels-view.tsx:157`
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: smell (waste / scale)
- Description: every channel-list read fans out two extra queries — a workspace-wide presence scan plus a per-channel member fan-out — purely to compute `onlineMemberCount` per channel. **Nothing in the UI renders it:** the channel header derives its "N listening" from the ROSTER read instead, which is exactly why `channels-view.tsx` deliberately keeps presence-realtime events from refetching the channel list. So the list read pays a per-workspace scan on every fetch for a field with no consumer, and it grows with member count × channel count.
- Proposed resolution: defer — either drop `onlineMemberCount` from the list DTO entirely (keep it on `getChannel` if a future header wants it) or make it lazy behind an explicit `?withPresence=1`. If it is ever rendered in the list, it also needs the realtime refetch path the comment currently avoids.
- Status: open

### F-064: Consent expiry is lazy-only — no cron sweep, and an expiring card emits no realtime event
- Location: `src/features/channels/server/consent-service.ts` (`collab.expireStalePending(ctx.userId)` called at the top of create / list / get / decide); `vercel.json` `crons` has no consent entry; `CONSENT_TTL_MS = 24h` (raised from 30 min in desktop v1.4 so the lazy sweep can't evict a parked request; `features/channels/constants.ts`)
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: smell (UX / correctness-at-the-edge)
- Description: a pending consent request past its `expires_at` only becomes `expired` when the operator's NEXT request runs the lazy sweep. Nothing flips it on a timer, so no row is written at the TTL boundary, so **no WAL change and therefore no realtime event fires** — the web consent card sits there with live Allow/Deny buttons until some other fetch happens to sweep it. Correctness is preserved (the sweep runs before every read AND before the de-dupe read, so an elapsed row is never handed back as live), but the surface lies for as long as the page is idle, and the desktop's poll backoff (up to 20s) widens the window on that side too. Desktop v1.4 raised the TTL to 24h (parked requests), so an idle web Pending Requests card can now show live Allow/Deny for up to ~24h before some read happens to sweep it — widening this window and strengthening the case for the cron sweep.
- Proposed resolution: defer — add a `/api/cron/expire-consent` sweep (`CRON_SECRET`-gated, wired in `vercel.json` like `purge-trash`) that flips elapsed pending rows workspace-wide; the resulting UPDATE rides the existing realtime publication, so the card self-clears with no client change. Keep the lazy sweep as the correctness backstop.
- Status: open

### F-065: Desktop-side orphan-pending-outbound cleanup is a client-side stopgap
- Location: `dopl-desktop-app/main/consent.js` (`cancelStaleOutbound`, once per channel per app run, called from `channel-listener.js` first-watch + recovery paths)
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: smell
- Description: an `outbound` consent row created just before a crash/quit stays `pending` forever, leaving a live **Send** button on the web review card that nothing can honor — the desktop holding the drafted reply is gone, and the server cannot post it. The desktop compensates by listing and DENYing its own orphan outbound rows on next boot (skipping the one seq it is about to replay, since outbound creates de-dupe at ANY status). That only works if the same machine comes back: rows are dead the moment the desktop disconnects, and **only the server knows that** (it has the presence heartbeat). A machine that never returns leaves its cards live indefinitely, and the cleanup can't run for a second operator's stale rows.
- Proposed resolution: defer — sweep server-side instead: expire/deny `pending` outbound rows whose operator has no fresh `agent_presence` heartbeat (a natural rider on the F-064 cron), and keep the desktop sweep only as a fast-path on boot.
- Status: open

### F-066: Terminal-mode spawns pass no `--resume`, so terminal and headless runs don't share channel session continuity
- Location: `dopl-desktop-app/main/session-spawner.js` — headless path builds `['--resume', existing, '-p', prompt, …]` from the stored per-channel session id; `runInTerminalForChannel()` builds its argv with `--mcp-config` + `buildRestrictionArgs()` only
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: smell (behavior inconsistency)
- Description: headless spawns resume the channel's prior Claude session (with a one-shot retry that drops a stale/pruned id), so a channel accumulates continuity across requests. Terminal mode starts a **fresh session every time** and records no session id, so (1) a terminal answer has none of the channel's earlier context, and (2) toggling the tray setting silently forks history — a later headless run resumes a thread that never saw the terminal exchanges, and vice versa. The two modes otherwise share the prompt builder, the restriction args, and the busy set specifically so they can't drift; this is the one axis where they do.
- Proposed resolution: defer — pass `--resume <id>` in terminal mode too and capture the resulting session id (an interactive run doesn't hand it back on stdout, so this likely needs `--session-id` with a desktop-generated UUID, or reading the CLI's session store) so both modes read and write one per-channel thread.
- Status: open

### F-067: A failed consent PATCH from the notification-Allow action is silent
- Location: `dopl-desktop-app/main/consent-watcher.js` / `consent.js` (the native-notification Allow/Send handler PATCHes `channel_consent_requests`); web backstop `src/features/channels/components/pending-requests-panel.tsx`
- Found during: Channels consent redesign (Round B, desktop v1.4, 2026-07-27)
- Severity: smell (silent failure — no operator signal)
- Description: when the operator clicks **Allow/Send** on the native consent notification, the desktop PATCHes the consent row to `allowed`. If that PATCH fails (offline, 5xx, token expired, or a lost CAS race that is NOT the settled-decision 409 case), **nothing tells the operator it didn't take** — the notification has already dismissed and the request silently stays `pending`. The **web Pending Requests list is the backstop** (the row is still there, still answerable), but a notification-only operator gets no signal and may believe they approved a spawn that never started. Mirrors the silent-drop shape of F-059.
- Proposed resolution: defer — surface a failed PATCH (re-notify "couldn't record your decision — open Pending Requests", or re-raise the request) instead of swallowing it. The web list already covers the recovery path, so this is a signalling gap, not a correctness one.
- Status: open

### F-068: Per-channel directory is context + a default, not a hard filesystem fence (sandbox-exec is a future option)
- Location: `dopl-desktop-app/main/channel-dirs.js` (`channelDirs` map → spawn `cwd`); `session-spawner.js` (applies the cwd to headless + terminal spawns)
- Found during: Channels directory picker (Round C, desktop v1.4, 2026-07-27)
- Severity: smell (containment-boundary clarity)
- Description: the per-channel working directory sets the spawn's `cwd` (and thus the agent's default read/write root), but it is **not** an enforced filesystem boundary — a spawned agent with Bash/write tools can still `cd ..` or touch absolute paths outside the chosen folder. Actual containment is the **tool profile** (§18 v1.2) + the **two consent gates**; the directory is context and a default, deliberately. Documented as the KEY PRINCIPLE in ENGINEERING §18 "Desktop app v1.4" so no future session mistakes cwd for a fence. (The terminal-mode untrusted-prompt file stays in the sandbox regardless of cwd, so the directory never widens the untrusted-input surface — only where the agent works.)
- Proposed resolution: defer — a true per-directory fence needs an OS sandbox (`sandbox-exec`/seatbelt profile, or a container) wrapping the spawn so the process physically cannot escape the folder. Optional hardening layered on top of the tool profile, not a v1.4 requirement; revisit if operators point untrusted channels at sensitive real directories.
- Status: open

### F-069: Persisted consent-decision maps grow unbounded (no eviction)
- Location: `dopl-desktop-app/main/consent-watcher.js` (electron-store `channelWatched` + `channelSettled` maps, key = `channelId:seq`)
- Found during: Channels consent redesign (Round B, desktop v1.4, 2026-07-27)
- Severity: smell (scale)
- Description: terminal consent decisions are persisted per `channelId:seq` so a restart never re-spawns or re-prompts a settled request (this fixed the relaunch replay bug — the permanently-`allowed` server row would otherwise re-spawn on every launch). Nothing ever prunes these maps, so they grow monotonically with every message seq the operator has ever decided on, and the whole electron-store JSON is loaded into memory on boot — an old, chatty install accumulates an ever-larger settled map. Not a problem at current volumes; unbounded by design.
- Proposed resolution: defer — evict by age, or drop any `settled`/`watched` entry whose seq is below the oldest still-`pending` (i.e. still-reachable) request for that channel, since those can never be replayed. A naive per-channel high-water-mark is unsafe (it would mask a legitimately-parked lower seq), so evict by the oldest-pending low-water-mark or by age.
- Status: open

### F-070: Channels v1.5 (first-class tasks + DMs + engagement mode) — deferred debt
- Location: `src/features/channels/server/service-writes.ts` (`closeTask`/`setTaskMode`/`createDirectChannel`); `packages/mcp-server/src/tools/channel-ops-write.ts` (`opCloseTask`/`opSetTaskMode`); `src/features/channels/components/{channels-view,channels-list-pane,direct-message-dialog}.tsx`; `dopl-desktop-app/main/{targeting,trigger}.js`; `channel_tasks` table
- Found during: Channels v1.5 build + adversarial review (2026-07-27)
- Severity: smell (bundle — several deferred items; item 3 is an open product question, not a bug)
- Description: five items deliberately deferred out of the v1.5 round (first-class tasks, direct channels, engagement mode). Two HIGH DM-invariant bugs + a suppression-binding gap were caught and FIXED in-round (the soft-deleted-DM revive path and the DM membership/visibility immutability enforcement; the `task-reply` verdict binding to `taskTarget === author`); the items below are what was left for later.
  - **1. Tasks never auto-close (rot `active`).** No lifecycle closes a `channel_tasks` row — `status` stays `open` until an agent (or human) explicitly calls `close_task` / `PATCH …/tasks/[taskId] {op:"close"}`. An agent that finishes but skips the close leaves the task reading `active` forever (the web overlay maps `open → active`); there is no timeout, no close-on-`task_finished`, and no sweep. So a channel accretes perpetually-"active" tasks that no one closed.
  - **2. `set_task_mode` posts no message → mode change is realtime-invisible.** Unlike `create_task`/`close_task` (each posts a `channel_message` that rides realtime → refetch), `setTaskMode` writes only the `channel_tasks` row and posts nothing, so it fires no messages-realtime and does not trigger the tasks refetch. The web mode badge is eventually consistent — it updates only on the NEXT `useChannelTasks` refetch (a send, a `create_task`/`close_task` echo, or a manual reload). Desktop is unaffected (mode is stamped fresh at each post, §8 v1.5), so this is a web-badge staleness only.
  - **3. `closeTask` lets the TARGET declare `outcome=completed`.** Authorization allows creator OR target to close, and the closer sets `outcome ∈ completed|failed` freely, so the responder (target) can mark their own task `completed`. By-design under the workspace-trust posture (channel members are trusted teammates, same posture as F-061), but a product may later want the CREATOR to confirm a completed outcome ("responder proposes, requester accepts") rather than letting the responder self-attest done. This is a product question, not a bug.
  - **4. Autonomous auto-continuation not built.** Engagement mode ships only the INTERACTIVE-suppression half (ENGINEERING §18 v1.5 `task-reply`). `autonomous` mode is accepted and stored but inert — no task-scoped standing consent, no per-task `--resume`, no turn caps — so an `autonomous` task's reply just falls through to the normal consent trigger each turn (no auto-continue). Next-round feature work (see ENGINEERING §8 v1.5 engagement-mode + the claude 2.1.220 resume research facts), not a fix.
  - **5. DM revive semantics undocumented in the UI.** Deleting a direct channel is hide-until-reopened (`deleted_at` hides it; a later "New direct message" to the same peer revives the same row with history intact), but the UI labels the action "Delete conversation" with no hint that history survives and returns on reopen. A user may reasonably expect delete to be destructive.
- Proposed resolution: defer — per item: (1) auto-close on a confirmed `task_finished`/`task_failed` from the target, or a TTL/idle sweep, or keep close explicit but surface a "still open" affordance; (2) post a lightweight system message on `set_task_mode`, or have the tasks query also refetch on the messages-realtime tick; (3) needs-user-decision — hold as an open product question (requester-confirms-completion vs responder-self-attests); (4) next-round feature work (standing consent + per-task resume + turn caps); (5) copy/UX — clarify the delete label or note that a DM reopens with its history.
- Status: open

### F-071: Desktop load-guard — render-process recreate + sleep/wake verification pending
- Location: `dopl-desktop-app/main/load-guard.js`, `dopl-desktop-app/main/api.js` (`resetPool`), `dopl-desktop-app/main/index.js` (`onWake`)
- Found during: Desktop resilience round (never-black window + fast wake recovery, 2026-07-27)
- Severity: smell (verification + edge-case robustness)
- Description: the load guard fixes the post-wake black-window/hung-load bug (watchdog stops a hung load, drops the Chromium pool via `session.closeAllConnections()` and the main-process undici pool via `api.resetPool()`, keeps a local loading screen up, and retries on a 0/2/5/10s backoff). Two residuals: (a) the "never blank" guarantee leans on Chromium **paint-holding** (the local loading/offline frame stays on screen during the subsequent `loadURL` fetch) — verified by design and by the pure reducer's unit tests, but the actual sleep/wake + wifi-change recovery **cannot be tested headlessly** and needs one manual pass (close lid, reopen: window should show the loading screen then content within seconds, never black); (b) `render-process-gone`/`unresponsive` currently **reloads** through the guard rather than recreating the `BrowserWindow` — sufficient for a normal renderer crash (Electron respawns the process on `loadURL`), but a wedged GPU/utility process that survives the reload would need a full window recreate. `resetPool()` swaps the undici global dispatcher for a fresh instance of its **own class** (dependency-free, version-matched) rather than `require('undici')` (only a dev-transitive dep, not bundled) — robust, but a future Node/Electron that renamed the `undici.globalDispatcher.1` global symbol would silently no-op it (the per-request AbortController still bounds any dead socket, so worst case is today's ~minutes recovery, not a hang forever).
- Proposed resolution: defer — (a) Samuel runs the manual sleep/wake + wifi-flip check once against a packaged build and confirms the loading screen appears and content arrives in seconds; (b) escalate `render-process-gone` to a window recreate if a reload-in-place proves insufficient in the field; (c) if the global-dispatcher symbol ever changes, `resetPool` degrades safely to a no-op — revisit only if wake recovery regresses.
- Status: open

### F-072: 2026-07-27 prod CPU incident — read-watermark realtime loop (fixed), reconnect-storm hardening deferred
- Location: `src/features/channels/server/service-reads.ts` (`readMessages`), `src/features/channels/server/repository.ts` (`updateLastRead`), `src/shared/realtime/use-workspace-tables-realtime.ts`, `supabase/migrations/20260728010000_drop_channel_tasks_from_realtime.sql`
- Found during: prod incident forensics (shared-CPU instance pinned at 100% max for the day vs a ~5-15% weekly baseline; realtime service in a connect/teardown storm; statement timeouts across the board)
- Severity: bug (root cause FIXED in this commit; hardening items deferred)
- Description: `readMessages` bumped `channel_members.last_read_at` to `now()` on EVERY read. `channel_members` is realtime-subscribed (CHANNEL_TABLES), so each bump emitted a postgres_changes event that re-fired every subscribed tab's refetch — which called `readMessages` again: a self-sustaining cross-tab refetch loop, rate-limited only by round-trip latency. Evidence: 86,541 updates on a 6-row `channel_members` table, 2.5M realtime per-WAL RLS evaluations (~5.2 CPU-hours), 2.7M subscription reconciliations, 1.45M realtime.subscription insert/delete cycles (reconnect storm amplification once the DB slowed), 4.39M PostgREST requests. Post-restart churn measured at zero for 60s, confirming no OTHER standing loop. FIXED: watermark is now content-derived (newest message shown, not `now()`) and monotonic at both the service layer and the repository layer (`.or(last_read_at.is.null,last_read_at.lt.<at>)`), so a refetch that shows nothing new writes nothing; `channel_tasks` dropped from the realtime publication (zero subscribers, pure decode cost — migration 20260728010000, applied to prod).
- Proposed resolution: deferred hardening — (a) reconnect circuit breaker in `use-workspace-tables-realtime.ts`: after K consecutive CHANNEL_ERROR/TIMED_OUT cycles, stop resubscribing until visibilitychange/online (today's capped 15s backoff × every hook instance × every tab still hammers a degraded DB); (b) periodic churn check: alert if `realtime.subscription` insert rate spikes; (c) consider dropping `agent_presence` heartbeat UPDATEs to a coarser interval if presence fan-out ever shows up hot.
- Status: open (root cause fixed; hardening deferred)
