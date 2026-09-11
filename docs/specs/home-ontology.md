# Ontology in the home space — SPEC

**Authored 2026-09-09** against `ui/agents-tab-polish`. Sizes and counts are measurements of that date — re-derive, never quote. Anchors are `path › symbol`.

## Status — **BUILT 2026-09-09** (all five slices, reviewed the same day)

⚠ **THE SPEC BELOW IS THE PROPOSAL AS WRITTEN AND IS NOT EDITED TO MATCH THE CODE** — where the two disagree, the code wins (CLAUDE.md's precedence) and the disagreement is listed here rather than silently smoothed away. Current state lives in `docs/INVARIANTS.md` §4A / §5A / §12; open debt lives in `docs/REFACTOR-FINDINGS.md` (F-681–F-684).

⚠ **BOTH MIGRATIONS ARE WRITTEN AND UNAPPLIED.** `ontology_home_shares` then `ontology_readable`, after `agent_template_knowledge_scopes` — apply BY NAME (INVARIANTS §12). Nothing below has ever executed against Postgres on this machine; CI's `rls-redteam` job is the replay.

### Deviations landed

1. **§4 site 1 — a `personal` container resolves LAZILY, not eagerly.** `service-audience.ts › computeAudience` admits `kind ∈ {link, personal}` to the resolved arm, so the /home Ontology face (which stands in the personal container) is fenced by the same ceiling. The spec's arm list named only `link`. ⚠ It also means a `standard` workspace — every board in the product today — still costs exactly ONE extra probe and touches no channel, member or share table.
2. **§5 — THE ONTOLOGY PANE IS A WHOLE TOKEN, NOT A PER-CHANNEL ONE, AND A CHANNEL CLICK ON IT CHANGES NOTHING** (S4's ruling, kept). `home-tabs.ts › ONTOLOGY_PANE` carries no row, exactly as `OVERVIEW_PANE` does not: the face lists the operator's PERSONAL ontologies, so re-keying it on the selection would close an open board on every click of the list beside it. Pinned in `pages/home/ontology-panels.test.tsx` and in INVARIANTS §4A.
3. **§3.2 — the TS twin is STRICTLY NARROWER than the SQL predicate, and `levelForCluster` carries a `created_by` OWNER ARM to restore one row of it.** `service-shared.ts › inOwnContainer` compares against the ONE container `withWorkspaceAuth` proved, while `is_current_workspace_member` is a membership READ; the audience's read SCOPE is deliberately wider than that one container, so the caller's own personal shelf (reached from a room) needed the owner arm. **The full truth table is stated ONCE, in `service-shared.ts`'s header**, and both halves are pinned (`service-shared.test.ts › the SQL twin's arm 1`, `service-audience.test.ts › the owner arm`).
4. **§5 — the share dialog renders one `FormSection` PER HOME CHANNEL, not one per existing share plus an "Add channel" row.** The channel list comes off the server (`HOME_CHANNELS_PATH`) either way; what changed is that adding a lend is setting a level on a row that is already on screen, which deletes a control.
5. **§6 S1/S2 — `service.ts` split at the 500-line cap into `service-reads.ts` (the two graph reads) and `service-gates.ts` (the gates), and `repository.ts` shed `repository-anchor.ts`.** Every name is re-exported from `service.ts`, so no route, MCP tool or client moved.
6. **§4 site 9 — the desktop framing block is BUILT AND UNWIRED.** `prompt-framing-ontology.js › ontologyReachLines` reads `ctx.ontologies` and nothing writes it (**F-681**). It is a compensating control, never a gate, so the fence is unaffected. ✅ **WIRED 2026-09-09**: `GET /api/ontology/reach` → `main/ontology-reach.js › fetchOntologyReach`, called from the ONE spawn funnel `main/session-launch.js › launch`.
7. **Q8 IS ENFORCED ON WRITES AS WELL AS READS, which the spec did not say.** `service.ts › sanitizeEdges` validates edge targets through `service-gates.ts › admittedObjectIds` (the cluster walk) rather than through `repository.ts › filterObjectIds` (the read SCOPE) — the scope holds the LENDER's whole container, so scope-only validation let a lent editor point an edge at a row they cannot see. `› currentRelationships` filters the far end for the same reason. Added at review; pinned and mutation-verified in `service-gates.test.ts › Q8 on a WRITE`.
8. **The cluster payload carries `agentsMayEdit` and `sharedChannelCount`** (`service-reads.ts › mapClusterRow`), the second only for clusters the caller OWNS and via ONE batched read (`repository-shares.ts › countSharesForClusters`). Both are OPTIONAL on `types.ts › OntologyCluster` because a cached snapshot predates them, and the two fallbacks are different answers on purpose (`true` vs `null` — unknown is not empty).
9. **Q6 attribution landed on `ontology_clusters` TOO**, not only on objects, so a rename through a share is attributed the same way an object edit is.

### What the spec asked for and did NOT land

- **§4 site 6 / R9 — the ANCHOR is still single-container.** `service.ts › getAnchor` reads `ctx.workspaceId` alone, then re-gates the row as a READ. Whose anchor a peer resolves inside a shared container is still undecided; the gate means it can only ever be a row they may see.
- **R7 — `useOntologyRealtime` still subscribes per WORKSPACE.** `20261001130000`'s header records the consequence: a peer mounted on the owner's container now receives frames for a SHARED cluster's rows (the intended reach) and the client-side narrowing is not built.
- **R11 — a peer creating inside a lent ontology still bills the CONTAINER's owner.** Stated, not fixed, and consistent with `credits-service.ts › resolveBillingTarget`.
- ✅ **SUPERSEDED 2026-09-09 — Samuel ruled both halves YES and F-685 / F-681 are RESOLVED.** Six ontology floors are `minRole: "guest"` (two reads, the new `ontology/reach` read, three object writes), `GUEST_ALLOWED` is 27, and the desktop framing block has its producer. Current state is INVARIANTS §4A / §5A; the two bullets below are left as WRITTEN so the argument they lost is still readable.
- 🔒 **`guests_level` IS UNREACHABLE END TO END (F-685), AND IT IS HALF OF SAMUEL'S RULING.** Every ontology route runs at `withWorkspaceAuth`'s `viewer` default or above, and `guest` is the floor role BENEATH `viewer` (INVARIANTS §4A) — while a home channel's peer is admitted at the role the link grants, which DEFAULTS to `guest`. So the column is stored, the SQL reads it, the audience picks it and the dialog writes it, and no guest request can ever exercise it. It fails CLOSED (a guest gets less, never more). **The fix is a ruling, not an edit**: flooring the read routes to `minRole: "guest"` fails `api/channels/guest-route-floor.test.ts › GUEST_ALLOWED`, which is a security census scoped to `api/channels/**` — see §4 site 7, which names the same trap.


## §0 The ruling, verbatim (Samuel, 2026-09-09)

> "bring in the ontology feature/page, as a new tab, to the right of the Agents tab. … These are ontologies that will be associated with the user's home space. A user can have multiple ontologies. The ontology will default to be a personal item, that can be accessed by their desktop agent. But, we need special settings for ontologies … settings for agents that they spin up operating in specific channels. Firstly, a setting that will enable them to share an ontology with a channel. Which means, that members/guests of that channel, are able to see that ontology. Moreover, there needs to be permissions settings, meaning, for an ontology shared into a channel, for that channel, are members access/view or edit, and are guests access/view or edit. and so, they could share that same ontology with another channel, but the ppl in that channel might have different permissions. Then for each channel as well, there should be another setting, which will be, if their own agents in that channel are allowed to have access to said ontology. … And do those agents have read/access or also write permissions. even if the ontology is shared, they still have those settings as permissions for their agent. … For channels with only the user, private ontologies are automatically viewable and editable by their agents. but there should be a setting, where they can toggle it so that their agents can only view, and not edit."

## §1 Vocabulary

⚠ **ADDENDUM 2026-09-11 (Samuel's wording ruling), AND IT IS THE READER'S HALF OF THIS SECTION:** **cluster = ontology, column = object (an object TYPE), card = item — and the code keeps the old identifiers.** `clusterId`, `CLUSTER_ADD`, `ontology_clusters`, the `create_column` MCP op and every DB column are unchanged; only strings a person or an agent reads were respelled. INVARIANTS §4A carries the rule and names its gate (`src/features/ontology/vocabulary.test.ts`).

- **ONTOLOGY** = one `ontology_clusters` row. 📌 **ASSUMPTION A1**: Samuel's "multiple ontologies" maps onto the existing CLUSTER, not a new container — a cluster is already the addressable board (`src/features/ontology/components/ontology-view.tsx › OntologyView`, one cluster per page).
- **HOME SPACE** = the owner's `kind='personal'` container (INVARIANTS §4A); a **home ontology** is a cluster whose `workspace_id` is that container. 📌 **ASSUMPTION A2**: therefore `supabase/migrations/20260920120000_workspace_kind_personal.sql` and `20260923120000_drop_home_scoped.sql` are PRECONDITIONS of this wave. Applied is a MEASUREMENT joined on the migration NAME, never the filename (INVARIANTS §12).
- **HOME CHANNEL** = the one channel in a `kind='link'` container. **SOLO** = one active member; **SHARED** = two or more. **OWNER** = the cluster's `created_by`; **MEMBER** / **GUEST** = a person in the channel at `member`+ / at `guest` (`src/features/workspaces/types.ts › Role`).
- **AGENT CLASSES** — the owner's / a member's / a guest's agent: a session acting in that channel, named by its operator.
- **LEVEL** = `none < view < edit`, a LADDER. ⚠ This is NOT `resource_grants`'s channel vocabulary (`agent_only | visible`), which is two AUDIENCES and not rungs — see §3.
- **SHARE** = one row per `(ontology, channel)`. A REFERENCE, never a copy: one object, and an edit reaches everyone it is lent to (ruling B11, INVARIANTS §5A).

## §2 The permission matrix

| Viewer class | Solo channel, unshared | Shared into channel C |
|---|---|---|
| Owner | **edit** | **edit** — a share never narrows the owner |
| Member of C | n/a | `members_level` |
| Guest of C | n/a | `guests_level` |
| Owner's agent in C | **edit** if `agents_may_edit`, else **view** | `owner_agents_level` |
| Member M's agent in C | n/a | `min(members_level, M's level)` |
| Guest G's agent in C | n/a | `min(guests_level, G's level)` |
| Anyone not in C | none | none |

- **I1 — AN AGENT NEVER EXCEEDS ITS HUMAN.** Every agent cell is a `min` against its operator's cell. 📌 **ASSUMPTION A3**: other people's agents get no per-agent control this wave (Q1).
- **I2 — `edit` ⇒ `view`**: one ladder compared by rank, never two booleans.
- **I3 — UNSHARED MEANS OWNER ONLY**, plus the owner's agents at whatever the `agents_may_edit` toggle says.
- **I4 — `none` IS A STORED VALUE** and is the same answer as an absent row for that audience. It exists so a share row is a COMPLETE statement about three audiences; unsharing is a row DELETE, not a level.
- **I5 — PER `(ontology, channel)`.** The same ontology in two channels carries two independent rows, which is Samuel's "different permissions" clause stated as a key.
- **I6 — THE FENCE IS SERVER-SIDE.** An agent holds its operator's credential and has Bash, so a hidden control is not a fence. Enforcement lives at the ontology service, and the `dopl_ontology` path — which composes that same service through the HTTP routes — inherits it (§4).
- **I7 — IT BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW**, the rule `src/features/knowledge/server/service-audience.ts › resolveAgentAudience` states for knowledge and INVARIANTS §11 pins.

## §3 Data model

**CHOICE: a dedicated `ontology_channel_shares` plus one boolean on the cluster — NOT `resource_grants`.** Reuse is the default answer in this repo, so here are the four reasons it loses:

1. **`resource_grants` IS ONE SENTENCE WITH ONE `level` COLUMN** (`supabase/migrations/20260914120000_resource_grants.sql` header: *"Three tables, three triggers, one sentence"*). A share here is THREE independent levels: encoding it needs three rows per share — which the PK `(scope_type, scope_id, resource_type, resource_id)` cannot hold without a fifth key column — or three more type-conditional columns beside `guest_write`. Both widen a table five other resource types depend on.
2. **THE VOCABULARIES ARE INCOMPATIBLE.** `resource_grants_level_check` and `src/shared/tenancy/resource-grant-reach.ts › grantedResourceIds` are both written around the claim that a CHANNEL level is an AUDIENCE and not a rung. Ontology levels are rungs; storing them there falsifies the one invariant that table is loudest about.
3. **THE COST OF NOT REUSING IS SMALLEST HERE.** `resource_grants` needs `enforce_resource_grant()` plus two GC triggers precisely because `scope_id` / `resource_id` are polymorphic and can carry no foreign key. A single-purpose table takes real FKs, so the trigger chain, the GC and the mirror all collapse into `ON DELETE CASCADE`.
4. **WHAT IS REUSED IS THE SHAPE, NOT THE TABLE**: the row is filed under the RESOURCE's container, the read predicate carries no `workspace_id` term, the SQL predicate has a TypeScript twin, and the admit set is precomputed the way `› grantedResourceIds` does it — one share read, then one membership read per scope kind, never a query per row.

**3.1 Tables.**

```
ALTER TABLE ontology_clusters ADD COLUMN agents_may_edit BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE ontology_channel_shares (
  ontology_id        UUID NOT NULL REFERENCES ontology_clusters(id) ON DELETE CASCADE,
  channel_id         UUID NOT NULL REFERENCES channels(id)          ON DELETE CASCADE,
  workspace_id       UUID NOT NULL REFERENCES workspaces(id)        ON DELETE CASCADE, -- the ONTOLOGY's
  members_level      TEXT NOT NULL DEFAULT 'view',
  guests_level       TEXT NOT NULL DEFAULT 'none',
  owner_agents_level TEXT NOT NULL DEFAULT 'view',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ontology_id, channel_id),
  CONSTRAINT ontology_share_levels_check CHECK (
    members_level IN ('none','view','edit') AND guests_level IN ('none','view','edit')
    AND owner_agents_level IN ('none','view','edit')));
CREATE INDEX ontology_channel_shares_channel_idx ON ontology_channel_shares (channel_id);
```

⚠ `workspace_id` is the ONTOLOGY's container, never the channel's — rule 3 of the `20260914120000` header, restated here so the cross-container lend works and so the cascade covers a deleted personal container. ⚠ `agents_may_edit` defaults `true` because Samuel's solo default is "viewable and editable"; the toggle only ever narrows.

**3.2 The predicate and its twin — one sentence written twice, in the `dopl_grant_admits` shape.** `dopl_ontology_readable(p_cluster_id uuid)` = the owner arm, OR a share row on a channel the caller is a member of at a level above `none` for their ROLE class; `dopl_ontology_writable(…)` = the same at `edit`. Both `SECURITY DEFINER` with `SET search_path = public, pg_temp`, matching `public.dopl_grant_admits`. The TypeScript twin is `src/features/ontology/server/service-shared.ts › canSeeOntology` (new file). ⚠ **A SHARED CREDENTIAL IS NEVER WIDENED BY A SHARE** — the arm carries `NOT public.dopl_credential_is_shared()`, exactly as `dopl_knowledge_base_readable` does, because a credential standing for nobody in particular has no membership to read the share through.

**3.3 RLS twins**, per `scripts/check-rls-pair-gate.ts › COVERED` conventions — FIVE new rows. A newly exported `canSee*` fails the build until it is declared there, and the declared SELECT set must EQUAL the live one per table:

| table | `predicates` | SELECT policy → `via` |
|---|---|---|
| `ontology_clusters` | `["canSeeOntology"]` | `ontology_clusters_member_select` → `dopl_ontology_readable` |
| `ontology_objects` | `[]` | `ontology_objects_member_select` → `dopl_ontology_readable` |
| `ontology_memberships` | `[]` | `ontology_memberships_member_select` → `dopl_ontology_readable` |
| `ontology_relationships` | `[]` | `ontology_relationships_member_select` → `dopl_ontology_readable` |
| `ontology_channel_shares` | `[]` | `ontology_channel_shares_member_select` → `is_current_workspace_member` |

⚠ The four existing policies (`supabase/migrations/20260706120000_ontology.sql`) fence on `is_workspace_member(workspace_id, auth.uid(), 'viewer')` and are REPLACED WHOLE rather than wrapped, so policy topology does not move and the gate's check 3 stays satisfiable. ⚠ The three child tables are workspace-keyed and not cluster-keyed (R3 / R5), so their policy reaches the cluster through `ontology_memberships` — hence the parent's function and no predicate of their own.

**3.4 Migrations, in order.** (1) `20261001120000_ontology_home_shares.sql` — the column, the table, its RLS, `updated_at`. (2) `20261001130000_ontology_readable.sql` — the two functions, then `CREATE OR REPLACE` of the four ontology SELECT policies; idempotent, no DDL, no policy moves.

## §4 Enforcement sites — NINE

1. `src/features/ontology/server/service-audience.ts › resolveOntologyAudience` (new) — the ceiling for one request, mirroring `src/features/knowledge/server/service-audience.ts › resolveAgentAudience` arm for arm: a human ⇒ unrestricted, a non-`link` workspace ⇒ unrestricted, a SOLO container ⇒ the `agents_may_edit` answer, else the share rows. ⚠ The order is the query budget, and an unreadable member count fails CLOSED.
2. `src/features/ontology/server/service.ts › getSnapshot` — four workspace-wide reads today; becomes audience-filtered at the cluster and then walked out to objects.
3. `src/features/ontology/server/service.ts › getSummary` — the same, and it is what backs `dopl_map`.
4. `src/features/ontology/server/service.ts › createCluster` / `› updateCluster` / `› deleteCluster` — the cluster write gate.
5. `src/features/ontology/server/service.ts › createObject` / `› updateObject` / `› deleteObject` — the object write gate, resolved through EVERY cluster the object belongs to (Q9).
6. `src/features/ontology/server/service.ts › claimAnchor` / `› getAnchor` — workspace-scoped identity today (R9).
7. The six route files under `src/app/api/ontology/` — floors unchanged (`member` on writes, `sessionOnly` on both DELETEs) plus the new share route (S3). ⚠ Do not floor one to `minRole: "guest"`: `src/app/api/channels/guest-route-floor.test.ts › GUEST_ALLOWED` reads route SOURCE and goes red on any route outside its set doing so. ✅ **REVERSED 2026-09-09 BY SAMUEL'S RULING (F-685).** Six floors ARE `guest` now and each is a deliberate `GUEST_ALLOWED` entry; the census's contract ("nothing anywhere is at `guest` unless it is listed") is what made that an addition rather than a breach. The share lane, cluster create/rename/delete and the `agentsMayEdit` toggle did NOT move — INVARIANTS §5A carries the list.
8. The MCP path — `packages/mcp-server/src/tools/ontology-ops-read.ts` and `› ontology-ops-write.ts` compose those routes through `packages/dopl-client/src/client-ontology.ts`, so they INHERIT the fence and add none. What changes is prose: `packages/mcp-server/src/tools/ontology.ts › ONTOLOGY_DESCRIPTION` opens *"The workspace object graph"*. ⚠ `› ONTOLOGY_PROSE_BUDGET` is a RATCHET (1,508 measured chars), so a rewrite must be same-length-or-shorter or it fails at import.
9. `dopl-desktop-app/main/prompt-framing.js › channelScopeFraming` gains which ontologies this session reaches and at what level, beside `dopl-desktop-app/main/prompt-framing-text.js › PERSONAL_KNOWLEDGE_CONFIDENTIALITY`. ⚠ **THIS IS A COMPENSATING CONTROL, NOT A GATE** — INVARIANTS §4A says exactly that about the personal-reach lane, and reading it as a gate is how this becomes a leak.

## §5 UI

**The tab.** `apps/desktop-ui/src/pages/home/home-tabs.ts › HomeTab` gains `"ontology"`; `› HOME_TABS` gains `{ key: "ontology", label: "Ontology" }` in FIFTH position, right of Agents; `› HOME_DEFAULT_TAB` does NOT move (leftmost and default are two decisions). A new `ONTOLOGY_PANE = "ontology:"` token must satisfy both halves of that file's disjointness rule: row ids are `rel:`/`link:`-prefixed, and it is not a prefix of `KNOWLEDGE_PANE` / `AGENTS_PANE` / `OVERVIEW_PANE` nor they of it. ⚠ **`apps/desktop-ui/src/pages/home/index.tsx` SITS AGAINST THE 500-LINE CAP** (`eslint.config.mjs › max-lines`, an ERROR over `apps/*/src/**`) — it measured 497 and then 470 within one hour on 2026-09-09, because the other builder is editing it live, so **measure it, never quote this**. Either way there is no room for a fifth branch: `› renderPane` and `› paneToken` must be extracted first (S4). ⚠ That builder has ALREADY touched `home-tabs.ts` and added `apps/desktop-ui/src/pages/home/home-header.tsx` in the working tree, so S4 rebases onto their result rather than onto what this spec read.

**Reused as-is.** `src/features/ontology/components/ontology-view.tsx › OntologyView` already takes `workspaceId`, `workspaceSegment`, `canEdit` and an injectable `replaceUrl`: the Home pane passes the selected row's `src/features/home/types.ts › HomeChannel`'s `workspaceId`, `canEdit` from the resolved level, and a NO-OP `replaceUrl` (there is no URL on /home). Below it, `kanban-board.tsx`, `kanban-card.tsx`, `object-panel.tsx`, `attributes-editor.tsx`, `relationships-editor.tsx`, `actions-editor.tsx` and `template-editor.tsx` need no change at all.

**Container-scoped, and must be re-pointed.** `src/features/ontology/hooks/use-ontology.ts › ontologySnapshotKey` is `["ontology-snapshot", workspaceId]` — the workspace element already separates the two entries, so no channel axis is needed (unlike Knowledge's, INVARIANTS §9). `src/features/ontology/client/realtime.ts › useOntologyRealtime` subscribes per workspace (R7). `src/features/ontology/hooks/use-workspace-resources.tsx › OntologyResourcesProvider` resolves knowledge and skill refs against the workspace and must be handed the OWNER's container (R12).

**Two sections, no scope pill**, converging on the sibling faces (`apps/desktop-ui/src/pages/home/knowledge-panels.tsx › HomeKnowledgePanels` and `› agent-panels.tsx`): **SHARED IN THIS CHANNEL** = ontologies with a share row above `none` for the caller's class; **PERSONAL** = the caller's own personal-container ontologies, always. Each section owns its own create button. Label + control only — no explainer paragraphs.

**The share popup**, on the FormDialog kit: `src/shared/ui/form-dialog.tsx › FormDialog`, one `› FormSection` per channel the ontology is shared into, three `› PillChoice` rows inside each (**Members**, **Guests**, **My agents**) at `None | View | Edit`, plus an "Add channel" row. ⚠ **`canManage` COMES OFF THE SERVER**, the same predicate the write applies — the rule `src/features/knowledge/components/kb-channel-grants-section.tsx › KbChannelGrantsSection` states — so the dialog cannot render an editor for somebody the write will refuse; everyone else gets the read-only summary. ⚠ **The channel list comes off the server too**, already fenced to the caller's visible channels, never assembled from a client-side list and filtered in the renderer.

**The solo toggle.** One `src/shared/ui/switch.tsx › Switch` on the ontology itself — "My agents can edit this ontology", default ON, writing `agents_may_edit`. It is ALSO the seed for `owner_agents_level` at first share (Q2).

## §6 Slices — FIVE, disjoint by file

⚠ **ANOTHER BUILDER OWNS `apps/desktop-ui/src/pages/home/` AND `apps/desktop-ui/src/components/app-shell/` AS OF 2026-09-09.** S4 is the only slice that touches them and must land after that work, never beside it.

- **S1 SCHEMA + TWINS** — the two migrations (§3.4), `src/features/ontology/server/service-shared.ts › canSeeOntology`, and the five rows in `scripts/check-rls-pair-gate.ts › COVERED`. *Tests:* a new `src/features/ontology/server/rls-redteam.test.ts` (owner; member at each level; guest at each level; agent-capped; shared credential), a schema pin shaped like `src/features/knowledge/schema-sql.test.ts`, and `npx tsx scripts/check-rls-pair-gate.ts` green.
- **S2 SERVER AUDIENCE + SERVICE GATES** — `src/features/ontology/server/service-audience.ts` and `› repository-shares.ts` (both new), the gates inside `› service.ts`, and cluster-scoped readers in `› repository.ts` and `› repository-projections.ts`. *Tests:* a `service-audience.test.ts` (four branches plus the fail-closed member count) and extensions to `src/features/ontology/server/service.test.ts`, one per matrix row.
- **S3 SHARE WRITE LANE** — a new `src/app/api/ontology/clusters/[clusterId]/shares/route.ts` (`minRole: "member"`, `sessionOnly` — an agent token must not widen its own operator's audience, the `channel-grants` argument), the shape in `src/features/ontology/schema.ts`, and `src/features/ontology/server/service-shares.ts` (new) holding the fences IN ORDER: the resource is the caller's own → the channel is one the caller reaches → 404-never-403 on both, so the write is never a room oracle. *Tests:* route floor, fence order, and a row added to `src/shared/auth/write-gate-coverage.test.ts`'s pinned `sessionOnly` set.
- **S4 HOME TAB** — `apps/desktop-ui/src/pages/home/home-tabs.ts`, a new `apps/desktop-ui/src/pages/home/home-panes.tsx` (the extracted `renderPane` / `paneToken`, which is what keeps `index.tsx` under the cap), and a new `apps/desktop-ui/src/pages/home/ontology-panels.tsx`. *Tests:* an `ontology-panels.test.tsx` (two sections; resolved-vs-empty sentences, each against its own read) plus the tab-row and default-tab assertions in `apps/desktop-ui/src/pages/home/index.test.tsx`.
- **S5 SHARE UI + MCP + PROMPT** — a new `apps/desktop-ui/src/pages/home/ontology-share.tsx`, the client lane in `src/features/ontology/client/api.ts` plus a `use-ontology-shares.ts` hook, the description edit in `packages/mcp-server/src/tools/ontology.ts`, and the framing line in `dopl-desktop-app/main/prompt-framing-text.js`. *Tests:* the dialog (levels round-trip; read-only when `canManage` is false), `packages/mcp-server/src/tools/parity.test.ts` plus the prose-budget import, and a desktop framing test.

**Seams.** S4 imports S5's share button, so stub it first. S2 depends on S1's migration NAMES, never on their being applied. S3 depends on S2's repository. Migration order is S1's two files and nothing else in this wave adds one.

## §7 Open questions — each with a recommended default

- **Q1 OTHER PEOPLE'S AGENTS.** *Recommend:* inherit that person's channel level, capped (I1); no per-member agent control this wave — a second control per member is a matrix nobody asked for.
- **Q2 SOLO → SHARED.** *Recommend:* `owner_agents_level` is seeded from `agents_may_edit` when the FIRST share row for that `(ontology, channel)` is written, and a channel later gaining a peer NEVER rewrites an existing row. Live sessions tighten at the next tool call, never retroactively (I7).
- **Q3 UNSHARE / GUEST LINK REVOKED / MEMBER REMOVED.** *Recommend:* access ends immediately — the row is gone, or the membership read fails — and edits already made STAY, attributed to their author. No retroactive scrub; the same answer INVARIANTS §4A gives for departure-is-removal.
- **Q4 DELETING A SHARED ONTOLOGY / DELETING A CHANNEL.** *Recommend:* both cascade the share rows by FK. The ontology delete sits behind a confirm naming the channel COUNT and stays app-only (`sessionOnly` on the cluster DELETE route; `dopl_ontology` has no delete op and must not gain one).
- **Q5 A HOME ONTOLOGY SHARED INTO A `kind='standard'` WORKSPACE CHANNEL.** *Recommend:* OUT OF SCOPE this wave — refuse with a 400 naming home channels only. `apps/desktop-ui/src/pages/ontology/index.tsx › OntologyPage` stays exactly as it is.
- **Q6 ATTRIBUTION OF AGENT EDITS.** *Recommend:* `last_edited_by` plus `last_edited_source ∈ ('user','agent')` on the object — the literal the knowledge guest-write lane already stamps. Naming WHICH agent is deferred: a template id on an ontology row is a second identity model.
- **Q7 THE MCP SURFACE.** *Recommend:* no new op. `dopl_ontology` keeps its `workspace=` addressing (INVARIANTS §10 lists it among the five tools taking that on EVERY op) and the fence stays in the service. An `op="share"` is the natural v2 and is not built here.
- **Q8 DOES A SHARED-IN READER SEE OBJECTS OUTSIDE THE CLUSTER?** *Recommend:* no — the cluster's membership walk is the boundary, and an object reachable only from another cluster is not in this one.
- **Q9 AN OBJECT IN TWO CLUSTERS, ONE OF THEM SHARED.** *Recommend:* a WRITE requires `edit` on EVERY cluster the object belongs to; a READ requires it on ANY. Otherwise `members_level='edit'` in one channel silently edits an ontology that channel cannot see. ⚠ The sharpest consequence of R5, and it needs Samuel's word.

## §8 Risks — where the tree assumes ontology is WORKSPACE-scoped (every one live 2026-09-09)

- **R1** `src/features/ontology/server/service.ts › getSnapshot` — four reads, all keyed on `workspaceId` alone. There is no cluster-scoped read path anywhere in the feature.
- **R2** `src/features/ontology/server/service.ts › getSummary` — the same shape, and it is what `dopl_map` serves, so a leak here lands on the routing surface every agent calls first.
- **R3** `src/features/ontology/server/repository.ts › listObjects` / `› listMemberships` / `› listRelationships` take `workspaceId` and nothing else.
- **R4** `src/features/ontology/server/repository-projections.ts › listClusterSummaries` / `› listObjectSummaries` — same shape, the narrowed twin.
- **R5** 🔒 **AN OBJECT CAN SIT IN SEVERAL CLUSTERS.** `supabase/migrations/20260706120000_ontology.sql` says so in its header and `ontology_memberships` is built for it, so "the objects of one ontology" is a GRAPH WALK, not a column. This is the largest single cost of per-ontology sharing and the source of Q9.
- **R6** That same migration's four RLS policies fence on `is_workspace_member(workspace_id, auth.uid(), 'viewer')` — workspace-wide, no per-cluster arm — and none of the four tables is in `scripts/check-rls-pair-gate.ts › COVERED` today.
- **R7** `src/features/ontology/client/realtime.ts › useOntologyRealtime` subscribes per WORKSPACE (via `src/shared/realtime/use-workspace-tables-realtime.ts`), so a peer mounted on the owner's container would receive change signals for every object in it, shared or not.
- **R8** `src/features/ontology/components/ontology-view.tsx › OntologyView` takes ONE `canEdit` boolean for the whole board; per-cluster levels make that per-cluster.
- **R9** `src/features/ontology/server/service.ts › claimAnchor` / `› getAnchor` and `src/features/ontology/server/repository.ts › findAnchorObject` are workspace-scoped IDENTITY — in a shared container, whose anchor a peer resolves is undecided.
- **R10** `packages/mcp-server/src/tools/ontology.ts › ONTOLOGY_DESCRIPTION` opens *"The workspace object graph"* and advertises `op="map"` as workspace-wide; both are prose that would become false, and they sit under the `› ONTOLOGY_PROSE_BUDGET` ratchet.
- **R11** `src/features/ontology/server/service.ts › createObject` calls `src/features/billing/server/entitlements.ts › assertCanCreateObject` on the WORKSPACE, so a peer creating an object bills the container's owner. Consistent with `src/features/billing/server/credits-service.ts › resolveBillingTarget`, which already reroutes container burn to the owner — stated, not fixed.
- **R12** `src/features/ontology/hooks/use-workspace-resources.tsx › useWorkspaceResources` and `src/features/ontology/components/knowledge-pick-menu.tsx` resolve knowledge and skill refs against the workspace, and an attribute of `kind:"knowledge"` ships raw entry ids (INVARIANTS §10 records exactly this) — so a shared ontology can NAME entries in the owner's personal container that the reader cannot open. The refusal must stay the knowledge lane's own 404, never a new one written here.
