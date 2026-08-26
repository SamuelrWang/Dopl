# HOME KNOWLEDGE PANELS — Implementation Plan

**Repo:** Dopl · branch `master` · HEAD `9fcdd344` (v1.20.0 armed) · verified against the tree 2026-08-26.
**Precedent build:** `docs/specs/guest-role.plan.md` (M0–M5 shape, adversarial-pin culture).
**Depends on / touches:** F-323 (agent-authored container KB — this build resolves its shape), F-327 (one-channel-per-container unenforced — design made robust to it), F-328 (untouched).

Samuel's rulings (2026-08-26, decided): three KB scopes on /home (A shared-into-channel / B private-in-channel / C private-across-channels in the HOME workspace = default standard workspace); (KB, channel) grants with three states (absent / agent_only / visible); guests CAN read `visible` grants via a channel-scoped lane; guest-write is a per-grant setting default OFF; the audience ceiling (agent in a shared channel reaches only channel-granted KBs, enforced at the tool boundary, never by prompt); egress already solved by outbound consent — only add the loud warning on `auto_both`+`full`+non-owner; skills/templates follow later (generalizable table, build knowledge only).

## 0. Corrections to the brief (verified)
1. **Scope C needs no new endpoint.** `POST /api/boot` (no segment) already returns `workspace` = `ensureDefaultWorkspace` → `findDefaultWorkspaceForUser` (oldest-OWNED standard). `pages/home/index.tsx` already mounts that query (`bootQueryKey(null)`) — home workspace is `identity.data.workspace?.id`. ⚠ `workspace` is null when not onboarded; handle it.
2. **`visibility: 'public'|'private'` already exists on `knowledge_bases`** (private = creator-only, in RLS AND `service-shared.ts › canSeeBase`). Scopes B and C are that column in two workspaces — only scope A (grant) is new. ⚠ `20260504030000`'s "once public, public forever" header is stale for KBs (two-way via `kbScope`); one-way survives for skills only.
3. **Knowledge UI is already Next-free and host-injected** — `knowledge-v2/landing-preview-core.tsx › KnowledgeV2PreviewCore` takes `workspaceId` + `routing` + `urlSync?`. `apps/desktop-ui/src/pages/knowledge/index.tsx` is the pattern. The trap is urlSync (§5.3), not component inventory.
4. **`defaultLevelForRole("guest") === null`** → `assertBaseVisible`/`assertBaseWritable` (via `requireEffectiveAccess`) refuse guests outright. The channel lane needs its OWN gates. Most important structural consequence of the guest-read ruling.
5. **`X-Dopl-Session-Id` / `X-Workspace-Id` / `X-Dopl-Runtime` are documented NON-authorization signals** — cannot be the audience fence. §4 is built around that.

Measurements (2026-08-26): `sessionOnly: true` count = 25 (INVARIANTS §3 says 21 @ 2026-08-11 — re-measure when editing).

## 1. Schema — one generalizable grant table
**New file** `supabase/migrations/20260827120000_channel_resource_grants.sql` (NEW file, never edit applied). Template: `team_resource_access` (`20260611020000_teams.sql`).

```sql
CREATE TABLE IF NOT EXISTS channel_resource_grants (
  channel_id    UUID NOT NULL REFERENCES channels(id)   ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('knowledge_base')),
  resource_id   UUID NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('agent_only','visible')),
  guest_write   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, resource_type, resource_id)
);
```

- "One grant per (kb,channel)" = the PK. `not shared` = ABSENCE of a row (never a `'none'` value).
- `resource_type` = the generalization seam; ship with ONE value (skills widen the CHECK later).
- **`guest_write` on the GRANT, not the KB** — a KB granted into N channels is N audience questions. KB keeps `agent_write_enabled` (per-KB, correctly). Surface in the per-channel grant row UI.
- Indexes: `channel_resource_grants_resource_idx ON (workspace_id, resource_type, resource_id)` (named: "which channels is this KB shared into" + workspace FK cascade). NO channel_idx — the PK's leading column covers it; say so in the header.
- **Validity trigger `enforce_channel_resource_grant()`** (BEFORE INSERT OR UPDATE), teams-trigger shape plus: 🔒 **same-workspace only** — `knowledge_bases.workspace_id == channels.workspace_id == NEW.workspace_id`. (A home-workspace KB granted into a container would be a cross-tenant read path for the guest — exactly what the ruling forbids. Consequence: scope-C KBs cannot be granted; sharing = move/copy → Q1.) Distinct RAISE message per branch.
- **RLS: defense-in-depth only** — knowledge reads run on the SERVICE-ROLE client (`repository.ts` uses `supabaseAdmin()`; the service filter is the fence). SELECT: `is_workspace_member(...,'viewer')` OR the `(M AND B')` channel-members arm from `20260826120000`'s shape (so guests see grants for their channel). Write: `is_workspace_member(...,'member')`; the SERVICE is the real gate (owner-or-admin, mirroring `kb-sharing-section.tsx › canManage`). **NOT a realtime change** — no publication, no replica identity.
- `updated_at` via the existing `touch_knowledge_updated_at()` trigger fn.
- In-migration `DO $$` verification block; prose rollback in header (note the ordering trap: dropping while `visible` grants live silently blanks the guest lane).
- Apply via Supabase MCP + catalog read-back + behavioural probes in rolled-back transactions (cross-workspace grant RAISEs; duplicate 23505). **Replay (`supabase db reset`) OWED — no Docker; record, don't gloss.** Join on NAME not version (F-304).

## 2. The dual-workspace read
Nothing new fetched for scope C — `identity.data.workspace?.id` prop. Three reads, existing hooks, keyed by workspace (`bases:${workspaceId}`):
- A: container base list filtered to grant ids (`visible`; `agent_only` badged)
- B: container base list, `visibility==='private' && createdBy===me`, no grant row
- C: `useKnowledgeBaseList(homeWorkspaceId)`, private+mine

**Grant map = a SIBLING key on the existing list response**, gated on a query param: `GET /api/knowledge/bases?channelId=<uuid>` → `{…, channelGrants: Record<baseId, {level, guestWrite}>}`.
- §9: a view of one resource is a query PARAMETER (precedent: `overview-series?channelId=`), and its two rules apply verbatim: 🔒 fence the id via `isChannelVisibleTo` BEFORE any service-role read (404, no oracle); skip the fence read entirely when no channelId (absent param ⇒ absent key, never `{}`).
- Bounded fan: one `IN (baseIds)` query (shape of `listBaseStats`), never per-row.
- `KnowledgeBase` type untouched → `check-knowledge-type-drift` stays green.
- 🔒 §8 STALE-CACHE: `channelGrants` is a new field on a cached payload → `?? EMPTY_GRANTS` inline at every read + fixture with the key DELETED (copy `person-info-tab.test.tsx › "a cache entry written before the info card existed"`).

**F-327**: grants keyed on `channel_id`, so nothing assumes one-channel-per-container; the /home panel reads the `HomeChannel`-resolved channel's grants; §4.3 handles the ceiling side.

## 3. The guest read lane (option a — channel-scoped routes)
Option b refused: 18 route floors + `requireEffectiveAccess` guest-bypasses. Option a leaves every floor + pin test untouched; the grant row is the only door.

### 3.1 Routes — `src/app/api/channels/[channelId]/knowledge/**` (4 (route,method) pairs, 3 files)
| Route | Method | Floor | Service |
|---|---|---|---|
| `…/knowledge/bases` | GET | guest | granted `visible` KBs for this channel |
| `…/knowledge/bases/[baseId]/tree` | GET | guest | folders+entries of one granted base |
| `…/knowledge/entries/[entryId]` | GET | guest | one entry body |
| `…/knowledge/entries/[entryId]` | PUT | guest | write, gated on `guest_write` (§3.4) |
Omitted BY DECISION: search (embeddings fence + id probing), export (streams trees), create/move/delete/star/settings (member-shaped). Create-entry → Q3.

### 3.2 Fences, in order (the ordering IS the contract)
1. `withWorkspaceAuth(handler, {minRole:"guest"})` — tripwire.
2. `loadVisibleChannel` → 🔒 require `membership !== null`. ⚠ **Refuse the public-arm entry outright** — a workspace `viewer` non-member on a `visibility='public'` channel (F-327 says one can exist) would otherwise read granted KBs. One line; the difference between fence and hole.
3. The grant row. `level='visible'` for reads. **`agent_only` is 404 on this lane, always** (different audience, not a lower level; existence must not leak).
4. Base state: `deleted_at IS NULL`, `workspace_id === channel.workspace_id` (trigger guarantees; assert anyway).

### 3.3 Service split — must NOT reuse workspace gates
New `knowledge/server/repository-channel-grants.ts` + `service-channel-grants.ts` with own `ChannelKnowledgeContext {workspaceId, channelId, userId, source}` and own gates (`assertGrantVisible`, `assertGrantWritable`). Imports NOTHING from `service-shared.ts`'s gate half (`canSeeBase` refuses private-to-guest — wrong here; `assertBaseVisible` refuses guests via `requireEffectiveAccess`). Compose at the ROUTE (channels service for the fence, knowledge grant service for payload) — no cross-feature import. Reuse the DTO + tree/entry readers (`repository-folders.ts`, `repository-entries.ts`, `dto.ts`). Errors via `toKnowledgeErrorResponse`.

### 3.4 Guest writes
PUT accepts `{body?, title?, expectedVersion?}` only. Gate: membership AND `visible` AND `guest_write===true` AND base alive. `agent_write_enabled` NOT consulted (human caller). Stamp `last_edited_by`, `last_edited_source='user'`. ⚠ Service-role client → entry RLS never fires; the service is the fence — say so in the header.

### 3.5 Pins
- `guest-route-floor.test.ts`: `GUEST_ALLOWED` 15 → **19**, size assertion updated, per-entry fence comments. Do NOT touch set C.
- **New `grant-lane.test.ts`** driving the REAL service, ten assertions: non-member 404 ×4 routes; viewer-non-member on public channel 404 (the regression-prone one); `agent_only` 404 + omitted from list; ungranted 404; `visible`+`guest_write=false` → GET 200/PUT 403; `guest_write=true` → PUT 200 + `last_edited_by`=guest; entry-of-other-base 404 (chase id up to granted base); cross-workspace entry 404; soft-deleted base's grant 404; ABSENCE pin — the lane's service names neither `assertBaseVisible` nor `requireEffectiveAccess` (link-container-guard technique).
- Mutation-verify, state the count.
- INVARIANTS §4A: set 15→19; "a guest reaches knowledge ONLY through a (kb,channel) grant at visible; workspace knowledge routes still viewer+."

## 4. Agent-side audience ceiling
### 4.1 Non-fences
Headers are documented non-authorization signals (§0.5). Threat model (from `members/route.ts` docblock): spawned agents hold a 90-day device token; `full` profile has Bash → can issue any HTTP the operator could. So: one FENCE, several TRIPWIRES — never dress the latter as the former.

### 4.2 Layer A — container-side grant fence (unforgeable, ships now)
New `knowledge/server/service-audience.ts › resolveAgentAudience(ctx)`, called from `service-bases.ts` foundational lookups (`listBases`/`getBaseById`/`getBaseBySlug`/`getBaseByPublicId`):
```
ctx.source !== "agent"           → unrestricted (humans unaffected)
workspace.kind !== 'link'        → unrestricted (standard workspaces unchanged)
active members ≤ 1               → unrestricted (SOLO: full container reach — today's behavior)
else                             → granted: reachable iff a grant row (agent_only OR visible) on one of the container's channelIds; everything else 404
```
All inputs = DB facts on the service client. Only ever CLOSES. Resolves F-323's read direction (update, don't close). ⚠ Scope-B KBs become invisible to your own agent in a shared channel unless granted `agent_only` — strict reading of the ruling; STATE IT IN THE UI COPY (→ Q2). Tests + mutation counts (`service-audience.test.ts`).

### 4.3 F-327-proof
Ceiling takes the SET of container channels. `X-Dopl-Session-Id` parsed as `<channelId>:<tail>` may NARROW to one channel IFF that id is in the set; anything else ignored. 🔒 A forgeable input used only to narrow inside an already-fenced set is safe — write that sentence in the module header.

### 4.4 Layer B — cross-workspace half. **Ship B3 now; file B1 (→ Q4); B2 if room.**
- **B1 (the real fence, own milestone):** revive `apiKeyWorkspaceId` (INVARIANTS §4 "dead scaffolding; preserved") — mint a container-locked child credential at spawn into a non-solo container, revoke at end. Rides the credential; covers Bash. Cost: token column, mint/revoke, `--mcp-config` lane, re-verify `resolveBillingTarget`. File as F-329.
- **B3 (this wave, ~30 lines, server-side):** `packages/mcp-server/src/factory.ts › bootServer` — when the pin resolves to a `kind='link'` container with >1 active member, pass `lockedTo` into `createWorkspaceDirectory`: `getWorkspaceList()` → `[container]`, `resolveWorkspaceRef` → null for others. Needs `memberCount` on `WorkspaceSummary`/`WorkspaceListItem` (hand-mirrored `packages/dopl-client/src/types.ts` + `workspaces/server/dto.ts` — neither drift gate covers it; change both sides at once). 🔒 §8: `memberCount` new cached field → `?? 0` inline, **0 fails CLOSED** (unknown = not solo = narrowed), key-deleted fixture. Limit stated plainly: Bash can open a second MCP connection or hit REST — B3 is a strong tripwire, B1 is the fence.
- **B2 (optional belt, desktop):** `session-profiles.js › grantDecision` step 1.5 (after hard-deny, BEFORE `preApproved` — covers `dopl_search`): `audience==='container-only'` and dopl tool `input.workspace` ≠ container → deny. Pure module; `audience` computed in `session-io.js › grantArgs` from the roster. Pin with `session-audience-ceiling.test.mjs` driving real `grantDecision` + a `gateReason` entry.

### 4.5 Context-carryover invariant (pin in §11)
🔒 THE CEILING BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW. A solo channel gaining a peer tightens at the next tool call; it cannot un-read. Consequences: recommend the bound claim (`claimBoundLink`) parks/ends the container's live sessions on roster change (→ Q5); invariant lives in §11 (session property), not only §4A.

## 5. UI
### 5.1 Pane (`pages/home/index.tsx`)
New file `pages/home/knowledge-panels.tsx`. Two index.tsx edits: (1) `renderPane` knowledge branch → `<HomeKnowledgePanels channel={row?.channel} homeWorkspaceId={identity.data.workspace?.id ?? null} currentUserId={…}/>`; (2) 🔒 `paneToken` must become `` `knowledge:${selected?.id ?? EMPTY_PANE}` `` — today it's keyed by tab, so switching channels wouldn't crossfade and would swap data under a frozen token (150ms wrong-channel flash). Render purely from `shown` (read the row inside `renderPane`). Layout untouched ("ONE LAYOUT FOR ALL THREE TABS").

### 5.2 Inside the pane
Shared section = **SectionBox pattern verbatim** (`src/shared/ui/section-box.tsx`, header `bg-card-surface-subtle` + `text-label uppercase`, body `bg-bg-inset`; cards `.bento` on `bg-bg-elevated`). No new kit class. KB card = `knowledge-v2/home/base-card.tsx` REUSED (don't fork). Scope pill = `SelectMenu` (not SegmentedControl — mock says dropdown; header owns the page's one SegmentedControl). `pendingRow` on the pill (§8 rule 8). Three DIFFERENT empty-state sentences. `agent_only` cards carry a visible "agent only" caption pill (reuse `RolePill` shape if it fits) — else the operator can't tell what the peer sees.

### 5.3 Opening a KB — the urlSync trap
Mount `KnowledgeV2PreviewCore` with the KB's OWN workspaceId plus:
- 🔒 a NO-OP `urlSync` (default is History API → would write `/undefined/knowledge/<seg>` and strand Back). Must be REFERENTIALLY STABLE (`useState(() => …)` initializer) — `routing.ts` header explains the stale-write-back hazard.
- `routing` shim: `goToBase` = local state; `refreshServerData` invalidates `["knowledge", "bases:<wsId>"]`.
- `kbTeams` undefined (containers have no teams; don't fetch).
- `MyAccessProvider`: don't mount against a container; pass `role="owner"` from container membership. VERIFY `canEdit` doesn't fall open without the provider — if it does, that's a finding. Home-workspace mount: `role` = boot's no-segment membership role.

### 5.4 Share/grant controls
New `knowledge/components/kb-channel-grants-section.tsx` — sixth section of `base-settings-form.tsx` (between Sharing and Agent access). Shape mirrors `kb-scope-controls.tsx › TeamGrantEditor`; three-state control (reuse `AccessLevelControl` only if it fits, else local `GrantLevelControl`, tokens/kit only). Guest-write toggle INSIDE the grant row, shown only at `visible` + when the channel has a guest member (`ChannelMember.workspaceRole === "guest"`; absent-field reads null → hidden → fail-safe). Default OFF. `canManage` mirrors `kb-sharing-section.tsx`. On /home scoped to the one channel; on the workspace page the channel list is fenced SERVER-side.
Write route: `PUT /api/knowledge/bases/[baseId]/channel-grants` `{channelId, level: none|agent_only|visible, guestWrite?}`; `none` deletes. 🔒 `sessionOnly: true` (precedent `POST /api/home/links`: "it hands content to a PERSON") — conscious `write-gate-coverage.test.ts` edit. §8 writes: hand-rolled cache patch by prefix + `coldKeys` (follow `useToggleBaseStar`'s comment block — knowledge keys aren't `apiQueryKey`-minted).

### 5.5 The channel Knowledge tab (both sides — answers "what do guests see")
Add `knowledge` to `channels-v2/info-panel.tsx › TABS` + `knowledge?: boolean` on `ChannelSurfaceCapabilities`. One component serves operator (`relationship-record.tsx`) and guest (`guest-channel.tsx`) — reads the CHANNEL LANE (§3), shows `visible` grants only; guest sees exactly what the operator sees in that tab. ⚠ "THE SURFACE MUST NOT ISSUE A REQUEST IT WILL GET 403 ON" — the tab's read is guest-floored so safe; add to `guest-surface-reads.test.tsx`.

## 6. The auto_both+full+non-owner warning
`channels-v2/settings-agent.tsx` carries the MINIMAL COPY ruling — so NOT a standing explainer: a `ConfirmDialog` (destructive) fired at the moment the combination becomes true, naming the peer. Pure predicate in `agents-controls.ts` (or `posture-warning.ts`): `messageMode==="auto_both" && toolProfile==="full" && roster.some(m => m.userId !== currentUserId)`. Unit-test the predicate. If tight, FILE rather than half-build.

## 7. Docs ritual
INVARIANTS: §4A (set 15→19, the lane + 4 fences, the grant-only rule), §9 (sixth sibling key + fence precedent; bounded fan), §10/§11 (audience ceiling + carryover invariant), §12 (migration, replay owed, join on NAME), §3 (re-measure sessionOnly 25→26), §5/§14 (new pins). ENGINEERING: dated stratum (grant = single door; ceiling = container property not header). FINDINGS: F-329 (ceiling's cross-workspace half is a tripwire; B1 is closure — include the device-token measurement); update F-323 (read closed; residual = authoring); F-327 note (design doesn't depend on it); possible canEdit finding. `check-doc-refs`. KB sync.
Definition of green: re-derive from `grep -n 'run:' .github/workflows/ci.yml` — five suites, two lints, two typechecks, check-doc-refs, size-check, knowledge-drift, role-drift.

## 8. Milestones (each green on full §14; Samuel reviews live)
- **M0** Schema + read model (migration applied+probed; grant repo/service read half; `?channelId=` key + fence; DTO). Checkpoint: cross-workspace grant RAISEs live; dup 23505. **Answer Q1 before M0's migration is final.**
- **M1** Grant writes + settings section (PUT route sessionOnly + write-gate edit; guest_write; grants section). Checkpoint: set all three states from UI, read back.
- **M2** Guest read lane (4 routes, 4 fences, service split, floor test 15→19, grant-lane.test, §4A). Checkpoint: THE adversarial pass — enumerate everything a guest reaches; ten assertions + mutation counts. Budget a full review.
- **M3** /home panels (knowledge-panels.tsx, paneToken fix, two lists, scope pill, cards, KB mount, no-op urlSync, §8 tests). Checkpoint: live vs the mock; rapid channel switching, no cross-channel flash.
- **M4** Channel Knowledge tab (operator+guest, one component) + guest-surface-reads pin. Checkpoint: throwaway guest sees exactly the visible grants; workspace knowledge routes still 403.
- **M5** Audience ceiling (A + B3, B2 if room). Checkpoint: solo reaches home KBs → add peer → same call reaches only granted; then demonstrate the residual honestly (curl with device token). **Answer Q4 here.** ⚠ B3 touches packages/ — run size-check + role-drift on this milestone. Release note: B3 is a server behavior a desktop build depends on → web deploy first, then desktop, then floor (§13); SPA-only milestones don't invoke the gate.
- **M6** The warning (or finding).
- **M7** Docs, findings, KB sync.
Sequencing: M2←M0; M3←M0; M4←M2; M5←M0 (parallel with M3/M4 possible).

## RULINGS (Samuel, 2026-08-26) — all decided, build to these
1. Scope-C KBs cannot be granted into channels — ACCEPTED. To share, create the KB in the channel. No move/copy this wave.
2. Scope-B private-in-channel KB is invisible to the operator's own agent there until granted `agent_only` — CONFIRMED. Say it in UI copy.
3. Guest writes = edit existing entries only (no create/folders/delete) — CONFIRMED for MVP.
4. **B1 IS IN SCOPE** — build the container-locked per-session credential (the real fence), not just A+B3. Ship A + B1 + B3 (+ B2 belt if room). Do NOT merely file B1.
5. A bound claim (peer joins a solo channel) PARKS/ENDS the container's live sessions and tells the operator — BUILD IT.
6. "New knowledge base" on /home follows the scope dropdown (container vs home) — CONFIRMED.

## 9. Open questions for Samuel — ALL RESOLVED ABOVE
1. **Scope-C sharing**: same-workspace trigger means a home-workspace KB cannot be GRANTED into a channel — sharing it = move or copy. MVP rec: NEITHER (private section is agent-and-me only; to share, create the KB in the channel). Acceptable, or fund move/copy?
2. **Scope B in a shared channel**: with no grant it's invisible to your OWN agent there (grant `agent_only` to enable). Confirm so UI copy can say it.
3. **Guest writes**: MVP = edit existing entries only (no create/folders/delete). Enough?
4. **Ceiling hardness**: A+B3 now + file B1 (credential lock, the only real fence vs Bash), or fund B1 this wave?
5. **Live session when a peer joins**: park/end container sessions on the bound claim (rec), or notice only?
6. **"New knowledge base" on /home**: create affordance follows the scope dropdown (container vs home)? Confirm.

## Critical files
- `src/features/knowledge/server/service-shared.ts` (the gates the lane must NOT reuse)
- `src/app/api/channels/guest-route-floor.test.ts` (GUEST_ALLOWED 15→19 + pin template)
- `apps/desktop-ui/src/pages/home/index.tsx` (tab, paneToken, identity.data.workspace)
- `src/features/knowledge/components/knowledge-v2/landing-preview-core.tsx` + `routing.ts` (mount + urlSync contract)
- `dopl-desktop-app/main/session-profiles.js` (B2) · `packages/mcp-server/src/factory.ts` + `workspace-directory.ts` (B3)
- `supabase/migrations/20260611020000_teams.sql` (schema template)
