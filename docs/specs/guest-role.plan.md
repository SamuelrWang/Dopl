# GUEST ROLE — Implementation Plan

**Repo:** Dopl · branch `master` · **Closes:** REFACTOR-FINDINGS **F-319** (bound-claim claimer is a workspace `admin`; full workspace-scoped reach + hard-delete are server-reachable).
**Gate function:** precondition for taking the guest web route `/c/[workspaceId]` out of the dark. Until a guest is a real capability tier, that route mounts an `admin`.

## 0. Corrections to the original brief (verified against the tree)
1. Live finding is **F-319** only (F-317 = WEB_ONLY_ROOTS missing `link`; F-318 = skeleton; **F-320 already resolved+deleted**; F-321/F-322 = windowless/launch-depth, unrelated).
2. **F-295 is the `WorkspaceKind` duplicate, not `Role`.** The role-type drift is real but separate: `packages/dopl-client/src/types.ts › WorkspaceRole` and `packages/mcp-server/src/tools/members-render.ts › ROLE_ORDER`. No drift gate exists for `Role` — file a NEW finding, don't fold into F-295.
3. `insertContainerMember` writes `role:"admin"` (`repository-containers.ts`, ~line 238); unbound `insertLinkContainer` (~line 203) also hardcodes claimer `admin`.
4. **Two role ranks exist:** TS `ROLE_RANK` in `src/features/workspaces/types.ts` AND a SQL `CASE` in `public.is_workspace_member(...)` (migration `20260504030000`). The SQL one governs RLS and must change too.
5. **`workspace_members.role` has a DB CHECK** `('owner','admin','member','viewer')` (`20260502130000`). `role='guest'` fails this CHECK today even on the service client — migration is mandatory.

## 1. Role model — add `guest` below `viewer`
### 1.1 TS type + rank (`src/features/workspaces/types.ts`)
- `Role`: add `"guest"`.
- `ROLE_RANK` → `guest:0, viewer:1, member:2, admin:3, owner:4` (insert a new floor; `meetsMinRole` is pure `>=`, so all existing gates keep relative semantics). `Record<Role,number>` typing forces the `guest` key — the compile-time blast-radius net.
- `InvitedRole` (`admin|member|viewer`) — **unchanged.** Guest is a link-granted role, never an invitation role.

### 1.2 Rank-0 blast radius
- `withWorkspaceAuth` default `minRole` is `"viewer"` → **every workspace-scoped route with no explicit floor now rejects guest by default.** Blast radius is INVERTED: re-admit guest only to the few channel routes it needs (§2).
- Doc fixes (same change): `authz.ts › requireWorkspaceRole` docblock ("viewer = any active member" is now false — excludes guests); `withWorkspaceAuth Options.minRole` docblock.
- SDK/MCP duplicates (new finding + fix): `packages/dopl-client/src/types.ts › WorkspaceRole` add `guest`; `packages/mcp-server/src/tools/members-render.ts › ROLE_ORDER` (REVERSED order, lower=higher priv) add `guest:4`, update `dist/` copy too; `meta-tools.ts` list_workspaces description text.
- No `Role` drift gate exists — add `scripts/check-role-drift.ts` (or extend knowledge-drift) so Role/WorkspaceRole/ROLE_ORDER can't diverge. File F-3NN if deferred.

### 1.3 DB layer (new migration — never edit applied files)
1. Widen `workspace_members.role` CHECK to include `'guest'` (resolve constraint name from `information_schema` at write time, record the command).
2. `is_workspace_member` SQL `CASE`: today a `guest` hits `ELSE -1` → already fail-closed for `>= viewer` RLS (free defense-in-depth). Make explicit: re-`CREATE OR REPLACE` with `WHEN 'guest' THEN 0` and re-base ranks to match TS, OR keep scheme + `WHEN 'guest' THEN -1`. Pick one, state it. Verify with policy inventory (`grep -rn is_workspace_member supabase/migrations`) — SECURITY DEFINER, many policies depend on it (changing numbers safe if relative order preserved).
3. Verification read (§12): after `apply_migration` via Supabase MCP, read back `check_constraints` + `pg_get_functiondef`; record commands in trailing `DO $$ RAISE NOTICE` block.

**CRITICAL open verification (before lowering channel routes):** confirm whether a guest's channel READS run under RLS (user client) or service-role. If any guest-reachable channel read runs under RLS and its policy calls `is_workspace_member(...,'viewer')`, the guest is DB-denied and that policy needs a `channel_members`-based arm (channel RLS keys on `channel_members`, own enum `('owner','member')`). Resolve at M1 checkpoint — highest-risk unknown.

## 2. Enforcement — **Option A (per-route floor), NOT Option B (capability layer)**
Rationale: codebase already treats workspace `minRole` on channel routes as a low tripwire with the CHANNEL-MEMBERSHIP fence as the real gate (verified: `launch-directives/route.ts` comment; `service-shared.ts › loadVisibleChannel`, `service-writes.ts › postMessage`, `service-tasks-fanout.ts › createTaskFanOut` all reject non-members). Option A composes with all of it + the fail-closed default. Option B is a new authz axis, fail-OPEN on a missed check; Option A's only failure mode is guest over-blocked (fail-closed).

### 2A. Routes that MUST reject guest — no code change (closed by viewer+ default)
Knowledge, Skills, Ontology, Chats, Agent-templates (all `/api/**`, GET `viewer`/writes `member`); Overview + overview-series (`viewer`); Members (`viewer`/`admin`); Billing (`admin`+sessionOnly); channel mgmt PATCH/DELETE + members + tasks mutate (`member`); agent launch/sessions/consent (`viewer`/sessionOnly). **Exception:** `PATCH /api/workspaces/[slug]` (rename) runs `withUserAuth` + gates admin inside `renameWorkspace › requireWorkspaceRole('admin')` — guest still rejected but via SERVICE gate, not the wrapper. Note so nobody assumes uniformity.

### 2B. Routes to RE-ADMIT to guest — lower to `minRole:"guest"`, gated by channel fence
Derive from what `channel-surface-standalone.tsx` (with `capabilities={{memberManagement:false,selfManagement:false}}`) actually calls. Verified candidate set: `GET /api/channels`; `GET /api/channels/[id]`; `GET`+`POST /api/channels/[id]/messages`; `GET /api/channels/[id]/await` + `GET /api/channels/await`; `GET`+`POST /api/channels/[id]/tasks` (see Q1); `GET /api/channels/[id]/tasks/[taskId]`; `GET /api/channels/[id]/members`; verify+maybe `POST /api/channels/presence` + `/api/channels/[id]/mentions` (see Q2). Each keeps its service-layer membership fence as the true gate.
**Pin with a test:** assert-by-reading-source (like `link-container-guard.test.ts`) that each guest-reachable route is at `minRole ≤ guest` AND no route outside the list is at `guest`. Converts "missed a route?" from silent UX break to red test.

## 3. Guest access inside the one channel
- Read+post satisfied by the `channel_members` row (written by `claimBoundLink`, unchanged) + §2B floor. Channel is PRIVATE NON-DIRECT; `loadVisibleChannel` admits member, hides existence from others.
- Must NOT (all already closed): manage channel (`canManageChannel` = owner|workspace-admin; guest's channel role is `member` not `owner`, and not workspace-admin); member mgmt (`memberManagement:false` + `member` floor); launch/run agents (`selfManagement:false` + `viewer` floor → this is what makes "chat to operator's agent, run none of your own" true); delete threads (`assertMayDeleteThread`→canManageChannel false + `member` floor).
- **No capability change needed** — capabilities were the cosmetic half; this plan supplies the SERVER half F-319 flagged. Rewrite the stale `guest-channel.tsx` docblock (lines ~24-29, "NO role PROP … claimer really is a workspace admin") — claimer is now a `guest`; narrowing is no longer merely cosmetic.

## 4. Link-carried role
### 4.1 Schema (new migration)
`ALTER TABLE channel_links ADD COLUMN granted_role TEXT NOT NULL DEFAULT 'guest' CHECK (granted_role IN ('guest','viewer','member'));` — default guest backfills open links; CHECK makes admin/owner-via-link unrepresentable. Add `granted_role` to `CHANNEL_LINK_COLS` (`dto.ts`) + `ChannelLinkRow` AFTER the column is applied (a nonexistent PostgREST column = 42703 500 on every link read; order: migrate→apply→verify→DTO).
### 4.2 Mint
`HomeLinkMintSchema`: add `grantedRole: z.enum(["guest","viewer","member"]).default("guest")`. `mintContainerLink`: pass into `repo.insertLink`; add column to `insertLink`. Grant-above-self guard before insert: `if (!meetsMinRole(minterRole, input.grantedRole)) throw 403 GRANT_ABOVE_SELF` (reuse `findMemberContainer`'s membership; CHECK is the real ceiling). One-open-index + maxUses:1 untouched.
### 4.3 Claim
`insertContainerMember` gains `role: Role` arg (write it instead of hardcoded `admin`; update docblock). `claimBoundLink` passes `role: link.granted_role`. **Legacy unbound path unchanged** (member-grade mutual; honoring granted_role there would silently downgrade in-the-wild links — see Q3).

## 5. Member-cap + §4A scoping
- 2-member cap untouched (guest consumes a seat). Immutability→cap reversal untouched.
- §4A WORDING scoped, not reversed: rewrite line 171 (the "guest is admin, narrowing cosmetic, F-319" note) — granted role is now the link's `granted_role`, server-enforced. Scope "neither side is a guest in their own relationship" to MEMBER-grade links; for a guest link the claimer genuinely IS lower-privileged.
- Code assuming claimer role: `canManageChannel`/`isWorkspaceAdmin` (now correctly false for guest — behavior shifts); `deleteChannel` hard/soft branch + `assertMayDeleteThread` (now closed for guests — closes F-319's measured hole); test fixtures asserting claimer=admin (`service-claim-bound.test.ts` ~206).

## 6. Reverse leak (operator agent writes KB/skills into container)
**Guest role closes the READ direction at two layers, no residual API exposure:** API — every knowledge/skills/ontology/chats route is viewer+ → guest 403; RLS — `is_workspace_member(...,'viewer')` false for guest; channel payloads carry no KB. **No extra work for MVP.** Residual caveat (finding, not blocker): operator's agent CAN still write container-scoped KB (just not guest-readable). If product later wants home-channel agents to never author container KB, that's a separate `sdk-loader.js` pinning change — file F-3NN.

## 7. UI
- `add-person-popover.tsx`: add a role picker (second `SelectMenu` matching the expiry one), **default guest**, options "Guest — chat only" / "Member — full channel" (omit viewer unless wanted — Q4). Thread through `mint.mutate({workspaceId, grantedRole, expiresAt})`; `home-writes.ts` forwards verbatim.
- `member-roster.tsx › MemberRoster`: add a subtle "Guest" pill when `member.role==="guest"` (one-line, so operator sees they invited a guest).
- New pills/menus: semantic tokens + kit classes only (reuse `RolePill`, `SelectMenu`).

## 8. Milestones (each ends green on full §14 gate table; Samuel reviews live)
- **M0** Role model + DB: TS Role/ROLE_RANK, SDK/MCP unions, both migrations applied+verified. Checkpoint: resolve §1.3 RLS question on live project BEFORE proceeding; green typechecks prove blast radius.
- **M1** Enforcement: lower §2B routes to guest + route-floor pin test. Checkpoint: claim a link as throwaway guest account — channel reads/posts OK; knowledge/skills/DELETE-channel/launch-directives all 403.
- **M2** Link-carried role: granted_role schema→mint→claim, grant-above-self guard, default guest. Checkpoint: mint at guest and member; claimer lands at exactly granted role; F-319 delete path closed for guest.
- **M3** UI: popover role picker + roster guest pill.
- **M4** Docs+findings+KB sync: close F-319, scope §4A, ENGINEERING stratum, file drift + residual-KB findings.
- **M5** Gate the web route: with guest enforced, `/c/[workspaceId]` may leave the dark (separate go-live decision).

## 9. Open questions for Samuel
1. May a guest CREATE threads (`POST …/tasks`), or only post in existing ones? (Affects whether that route is in §2B.)
2. Should a guest appear in presence and `@`-mention the operator's agent? (Lower those routes only if yes.)
3. Legacy unbound links: keep hardcoded `admin` claimer (member-grade mutual), or retrofit to granted_role default guest? Rec: keep as-is.
4. Add-person picker ceiling: expose `viewer`, or only `guest`/`member`?
5. Home-agent authoring container KB (§6 residual): accept for MVP (guest can't read it), or forbid entirely?

## Critical files
- `src/features/workspaces/types.ts` (Role, ROLE_RANK, meetsMinRole)
- `src/features/home/server/repository-containers.ts` (insertContainerMember admin→link role)
- `src/features/home/server/service-writes.ts` + `src/features/home/schema.ts` (mint: grantedRole + grant-above-self)
- `src/shared/auth/with-workspace-auth.ts` + `src/app/api/channels/**` (§2B floors)
- `supabase/migrations/20260504030000_visibility_private_resources.sql` (is_workspace_member rank) + `20260502130000_editor_to_member.sql` (the CHECK to widen)
