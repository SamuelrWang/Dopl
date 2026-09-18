# 04 — Workspace-only modules, and the reverse map

**Scope of this document.** Everything a WORKSPACE (`kind='standard'`) has that the HOME SPACE does
not, and everything the home space has that a workspace does not. Per module: what it does, which
hosts mount it, whether home has an equivalent or a deliberate absence, whether its UI is on the old
recipes, and what "parity" should mean for it.

**Measured against** worktree `/Users/samuelwang/Downloads/sie-parity`, branch `docs/workspace-parity`,
at `03506fcd`, on **2026-09-17**. Every count and every line number in this file carries that date
(CLAUDE.md § *Standing rules for writing docs* rule 1).

**Citation convention.** CLAUDE.md rule 2 forbids a bare line number. Every reference here is
`path › symbol`, with a line number in parentheses **as a measurement**, not as the anchor. Re-derive
with the symbol; the number is a convenience that will be wrong within the week.

**Precedence.** Nothing in this document is a decision. Where code and a ruling disagree, the code
wins and the disagreement is recorded (CLAUDE.md § *Precedence*). Items that need Samuel are in §E
and nowhere else — no row in §A quietly decides one.

---

## 0. The frame — read this before any row below

Three facts shape every parity answer in this document. A refactor that misses any one of them will
produce work that looks like parity and is not.

### 0.1 There are THREE container kinds, not two

`packages/contracts/src/workspaces.ts › WorkspaceKind` (L74) — `"standard" | "link" | "personal"`.

| Kind | What it is | Who sees it |
| --- | --- | --- |
| `standard` | A real user-facing workspace. | The account rail, the switcher, every listing. |
| `link` | A hidden **home-channel container**: ONE channel, one or more members, admitted one at a time by a single-use link. | Never in the rail; reached as a ROW on /home, or by explicit URL. |
| `personal` | **The one container every user has.** Holds the personal shelf. | Never in the rail; it IS what /home resolves to header-lessly. |

The one listing predicate is `src/features/workspaces/types.ts › isStandardWorkspace` (L89) —
`(workspace.kind ?? "standard") === "standard"`, positive form on purpose, and absent `kind` reads as
standard. `scripts/check-role-drift.ts › checkWorkspaceKind` is the gate that stops a coordinated
flip to `!== "link"`.

⚠ **"HOME SPACE" IS NOT ONE CONTAINER.** /home is an ACCOUNT surface drawn over
*the caller's `personal` container* (the shelf: knowledge, agent templates, ontology, the credit
wallet) **plus every `link` container they are a member of* (the channel rows). Any sentence of the
form "move X to home" must first say which of the two it means.

### 0.2 The two surfaces have different navigation vocabularies, and the sidebar has ONE mount

**Workspace** — eight nav rows plus a Settings foot button, built in exactly one place,
`src/shared/layout/app-shell/app-sidebar-core.tsx › NAV` (L53–70), rendered unconditionally by
`.map` (L123). **It does not branch on `kind`.**

Overview · Channels · Agents · Knowledge · Skills · Ontology · Chats · Members — then Settings, which
is the foot button and not a `NAV` row (`app-sidebar-core.tsx › activeSectionFromPath`, L82–88,
deliberately highlights nothing for `/settings`).

**Home** — five faces, local state, no routes:
`src/features/home/tabs.ts › HOME_TABS` (L51–57) — Overview · Channel · Knowledge · Agents ·
Ontology. Default is stated separately on purpose:
`apps/desktop-ui/src/pages/home/home-tabs.ts › HOME_DEFAULT_TAB` (L42).

🔒 **/home RENDERS NO SIDEBAR AT ALL.** Three independent proofs, and the refactor must keep all
three true or it has changed the product:
1. `/home` is registered OUTSIDE `AppShellLayout` — `apps/desktop-ui/src/routes.tsx` (L136–146).
2. `apps/desktop-ui/src/pages/home/index.tsx` is one panel wide — `AccountRail` + a single
   `<main className="page-float">` (L200–208).
3. The sidebar says so itself, and hangs a conditional on it —
   `app-sidebar-core.tsx` (L140–148): *"this sidebar has exactly one mount — the WORKSPACE shell …
   and /home renders no sidebar at all … If it ever mounts on a home space, the copy and
   `onOpenSettings("billing")` target must both become kind-aware."*

⚠ **A `link` CONTAINER IS NOT FENCED FROM THE WORKSPACE SHELL.** Only `personal` is —
`apps/desktop-ui/src/components/app-shell/app-shell.tsx` (L84–87) redirects `kind === "personal"` to
`HOME_PATH`; the comment at L82–83 states that link containers are deliberately admitted because
guests legitimately render in the shell. A **non-guest** member of a link container who types
`/{link-segment}/members` therefore gets the full eight-row nav, the Members console, Skills, Chats
and a Settings page with an owner delete. This is the single largest unintentional surface in the
parity question and it is §E-1.

⚠ **ADDING OR REMOVING A PAGE IS A FOUR-FILE CHANGE**, stated at `app-sidebar-core.tsx` (L24–27) and
`apps/desktop-ui/src/routes.tsx` (L66–76): the `NavSection` union, the `NAV` row,
the `WORKSPACE_PAGES` row, and the hand copy in
`dopl-desktop-app/main/deep-link-target.js › WORKSPACE_PAGES` (L81–93). Its drift test reads
`routes.tsx` and fails on disagreement.

### 0.3 The two surfaces have different AUTH SHAPES, which is why parity is not "mount the component twice"

| | Workspace endpoints | Home endpoints |
| --- | --- | --- |
| Wrapper | `withWorkspaceAuth` — needs `X-Workspace-Id` | `withUserAuth` — **no** workspace header |
| Fence | the caller's membership in ONE container, `resolveActiveWorkspace` | the caller's OWN membership ROWS, assembled service-side |
| Example | `GET /api/workspaces/[slug]/overview` | `GET /api/home/overview` |

`src/app/api/home/overview/route.ts` states it: *"NOT WORKSPACE-SCOPED, so `withUserAuth` and no
`X-Workspace-Id` … The fence is the caller's own membership rows"*, built from
`src/features/home/server/repository-containers.ts › listLinkContainers`. Every read below it is
service-role and bypasses RLS, so that list *is* the fence.

🔒 **THE CONSEQUENCE.** "Extend module X to home" has two possible meanings and they cost differently:
* **(a) Personal-shelf parity** — point the existing `withWorkspaceAuth` module at the caller's
  `personal` container. Costs a surface and nothing else, because a personal container IS a workspace
  row. This is what Knowledge and Agent templates already did.
* **(b) Account-wide parity** — a new `withUserAuth` endpoint that fans out over every container the
  caller belongs to, plus its own narrowing. This is what /home Overview is, and it is a whole
  feature, not a mount.

Every `extend-to-home` classification in §A names which of the two it means.

### 0.4 The personal SHELF is now a TENANCY, not a flag

`home_scoped BOOLEAN` on `knowledge_bases` and `agent_templates` was the shelf until v2 wave B slice
B15. It is superseded by `workspace_id = the caller's personal container`
(`supabase/migrations/20260920120000_workspace_kind_personal.sql`, repaired for child rows by
`20260924120000_personal_container_child_rows.sql`). The read sites say so:
`src/features/agent-templates/server/repository.ts` (L81) — *"the column is dropped and the question
is 'is this row in my personal container'"*.

⚠ **THE COLUMN IS STILL ON THE TABLES.** `docs/specs/mcp-v2-wave-b.md` (L243) names
`20260923120000_drop_home_scoped.sql`, and **that file is not in `supabase/migrations/`** — measured
2026-09-17, `ls supabase/migrations | grep home_scoped` returns only the two ADD migrations. The drop
is held. Nothing reads the column; nothing should start.

**This is the whole recipe for extending a module to the home shelf** and it needs no migration:
a module scoped on plain `workspace_id` already works in a `personal` container the moment a surface
asks it. Skills and Chats are exactly in that position (§B-1, §B-2).

### 0.5 Migration state is a measurement, not a claim

CLAUDE.md rule 4. Several migrations in this tree carry
*"⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory)"* —
`20260915120000_drop_agent_template_teams.sql` (L4) and
`20260916120000_drop_team_resource_access.sql` (L4) both do. **This document does not claim what is
applied in production.** The command is:

```
npx supabase migration list --linked        # applied vs local, by NAME
```

Anything in §C that depends on a drop having landed is marked as depending on that measurement.

### 0.6 Three rulings already made that a parity wave must honour BEFORE it adds anything

These are not §E questions. They are decisions taken, recorded, and — for two of them — not yet
executed in code. A wave that adds surfaces on top of them inherits the drift.

🔑 **(i) "SHARED" MEANS MORE THAN ONE MEMBER, WHATEVER THE CONTAINER KIND — RULED, NOT MOVED.**
`docs/REFACTOR-FINDINGS.md › F-513` (L7503–7511, 2026-09-02): *"'shared' is ANY channel with more
than one member, whatever kind of container it sits in — standard workspace channels included."*
**Three copies of the predicate still ask `kind === 'link' && memberCount !== 1`.** This is the
single highest-value parity ruling that already exists and is not honoured: every audience ceiling,
every publish acknowledgement and every "is this private" sentence in §A currently answers the
workspace case by accident of the kind check rather than by the rule. **Honour F-513 first** — it is
cheaper before three new surfaces depend on the old spelling, and it converts a family of
kind-branches into one member-count question.

🔑 **(ii) /home CANNOT TELL A MEMBER FROM A GUEST INSIDE A CONTAINER — OPEN, FILED, NOT BUILT.**
`docs/REFACTOR-FINDINGS.md › F-343` (L4492–4510, 2026-08-27): `HomeChannel` carries no caller role;
two affordances guess, and `containerTarget.role` is **hardcoded `"owner"`**. Every §E-2 option below
is unbuildable until this is fixed, because "what may this person do to the roster" has no input.
**This is the parity blocker.**

🔑 **(iii) THE LITERAL PARITY BOUNDARY, AS OF TODAY.** `docs/specs/home-ontology.md › Q5` (L160,
2026-09-09): a home ontology shared into a `kind='standard'` workspace channel is **out of scope** —
refuse with a 400 naming home channels only, and *"the workspace `OntologyPage` stays exactly as it
is."* Ontology is the module furthest along on both surfaces, and even there the two spaces are
deliberately not joined. Any parity proposal that crosses that line is a new decision, not a
completion of an old one.

⚠ **AND ONE MISREADING TO KILL: ONTOLOGY WAS NOT DEMOTED.** It was brought INTO home as a fifth face
(`docs/specs/home-ontology.md` L34). What died is the **canvas view** of it — `GraphView`,
`src/features/ontology/graph/` — with the canvas retirement (`docs/RETIREMENT-UNWIRING-PLAN.md` L17,
L53). Ontology's position at sixth in the nav is an ORDER statement (channels-first), not a
capability statement.

---

## A. Module inventory

**28 rows.** `WS host` = where it mounts for a standard workspace. The web tree (`src/app/**`) has
**no workspace app pages at all** — the website is being retired; it retains marketing, auth,
token-landing pages, the guest channel, billing, admin and playground. So "WS host" means the desktop
SPA unless stated.

**Classification key**
`WS-KEEP` workspace-only, correct as is · `WS-RESTYLE` workspace-only, UI owes the kit ·
`→HOME(a)` extend to home via the personal shelf · `→HOME(b)` extend to home via an account-wide
endpoint · `OBSOLETE?` overlaps something home replaced, see §C · `RULING` §E owns it.

| # | Module | Purpose | Workspace host | Home equivalent | Class | Risk if the uplift touches it | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Members console (v2)** | Two-pane access-control console: roster ∥ teams, member detail with About / Access / Activity / Settings tabs. | `apps/desktop-ui/src/routes.tsx` row `members` (L106) → `apps/desktop-ui/src/pages/members/index.tsx › MembersPage` (L32) → `src/features/members/components/members-v2/members-v2-view.tsx › MembersV2View` (L58). **No web page.** | **Deliberate absence + a members-LITE that already exists.** `apps/desktop-ui/src/pages/home/person-members.tsx › PersonMembers` (L54) renders the roster with the *same* row component as the channels page (`channels/components/member-roster.tsx › MemberRoster`) and one act beneath it. Ruling: `src/features/workspaces/server/authz.ts › assertMemberAddable` (L73) — every workspace-level add on a non-standard container is `403 LINK_CONTAINER_CLOSED`. | **RULING** (§E-2) | HIGH, **and BLOCKED on F-343** (§0.6-ii): /home carries no caller role, so no home members affordance can be gated yet. Separately: 37 files / 4,941 lines with **four** unit tests and **no** server or RLS-redteam suite — the least-covered module in the parity set and the one an uplift is most likely to touch. | UI is a HYBRID: kit page frame (`page-float`) and kit atoms, but **old-recipe dialogs** — `invite-dialog.tsx` (L10) and `create-team-dialog.tsx` (L8) deep-import `ModalShell` instead of `FormDialog`. Both are `Todo` in `docs/DESIGN-SYSTEM.md` § Conformance (L419–420). |
| 2 | **Teams + grants** | Named groups inside a workspace; a `scope_type='team'` axis on `resource_grants` over knowledge bases, skills, chats, chat folders. | **No components dir of its own** — the entire teams UI lives inside members-v2 (`teams-list.tsx`, `team-detail-pane.tsx`, `create-team-dialog.tsx`), mounted through `MembersV2View` (L206, L232, L267; tab switch L283). Server: `src/features/teams/server/service.ts`. | **None, and it has no referent.** `src/features/agent-templates/lib/visibility.ts › offersTeamScope` (L160–162) — `=== (kind === "standard")`, Samuel 2026-09-08. A `team` row arriving inside a container is DROPPED, never re-filed (L68–71, L115–118). Guest ceiling is `null`: `src/features/teams/access-levels.ts › ROLE_DEFAULT_LEVEL` (L48). | **WS-KEEP** | MEDIUM. Two tests. Its storage moved under it (`team_resource_access` → `resource_grants`) and the docblocks still name the old table — `teams/server/repository.ts` (L10), `repository-resources.ts` (L66). Stale doc drift, not behaviour. | ⚠ Do NOT read the two 2026-09-15/16 DROP migrations as a retirement: ruling **B4**, quoted in `20260915120000_drop_agent_template_teams.sql` (L8–11), retires the team **AXIS**, keeps the team **CAPABILITY** — `visibility='team'` is untouched. See §C-4. |
| 3 | **Email invitations** | `workspace_invitations` + `workspace_invitation_teams`; invite by email at admin/member/viewer, accept at `/invite/[token]`. | Server `src/features/workspaces/server/invitations.ts › createInvitation`; route `src/app/api/workspaces/[workspaceSlug]/members/route.ts` (POST, L32); web landing `src/app/invite/[token]/page.tsx` (L22); UI `members/components/invite-dialog.tsx › InviteDialog` (L144). | **None, by the same ruling.** `invitations.ts` (L67) calls `assertMemberAddable`. `InvitedRole` deliberately excludes `guest` — `src/features/workspaces/types.ts` (L29–34). | **WS-KEEP** | LOW–MED. The fence is one guard with five call sites; a refactor that inlines it loses the fence. Pinned by `src/features/workspaces/server/link-container-guard.test.ts`. | Old-recipe dialog (row 1's note). |
| 4 | **Standing join link + join requests** | `workspace_join_links` (rotatable) and `workspace_join_requests` (request → admin approves → membership at a granted role). | `src/features/workspaces/server/join-links.ts` — `requestJoin` (L168), `listPendingJoinRequests` (L237), `resolveJoinRequest` (L291). Landing `src/app/join/[token]/page.tsx` (L22). ⛔ **THE REQUESTER HALF IS OFF DISK since R-49 (2026-09-17)** — `listMyJoinNotices`, `acknowledgeJoinNotice`, `join-request-notices-core.tsx` and its shell mount; the ADMIN half above stands. | **None — and home's admission model is the OPPOSITE shape.** Fenced at `join-links.ts` L59, L94, L191, L301. | **WS-KEEP** | MEDIUM. `resolveJoinRequest` writes a membership AND syncs seats (L353, L360) — it is a billing-touching path (§D-3). | The requester-notice loop is mounted only in the desktop shell, never on /home. A member of a link container who is also in a workspace sees it; it is workspace data on an account-level chrome. |
| 5 | **Link claim (home's admission model)** | One OPEN single-use link per container, minted at `guest` or `member`, claim inserts the claimer as a workspace member AND a channel member. | — (no workspace equivalent) | **THIS IS THE HOME ORIGINAL.** `apps/desktop-ui/src/pages/home/add-person-dialog.tsx` (roles L32–35, default `guest` L76) → `src/features/home/server/service-writes.ts › mintContainerLink` (L185) / `claimLink` (L315) → `service-claim-bound.ts › claimBoundLink` (L63). Web landing `src/app/link/[token]/page.tsx` (L21). DB ceiling `supabase/migrations/20260825150000_channel_link_granted_role.sql` (L14–22). | **REVERSE — see §B-7** | MEDIUM. `mintContainerLink` enforces grant-above-self via `meetsMinRole(minterRole, grantedRole)` (L178–183) and fails closed on an absent default (L200–201). | ⚠ **"Add person" never goes away** — the two-member cap was DELETED by Samuel's 2026-08-26 ruling; the trigger went with `20260830120000_link_container_multi_member.sql`. `person-members.tsx` (L41–46) forbids reinstating a `peer`-shaped gate. |
| 6 | **Chats + chat folders** | Agent-exported conversation records (header, summarized transcript, deliverables, learnings) filed into per-user folders whose scope is authoritative over their contents. | `apps/desktop-ui/src/routes.tsx` row `chats` (L105) → `apps/desktop-ui/src/pages/chats/index.tsx` (L85) → `src/features/chats/components/chats-view.tsx › ChatsView`. API `src/app/api/chats/**` (5 routes, all `withWorkspaceAuth`). MCP `packages/mcp-server/src/tools/chats.ts` (9 ops, L91). | **NO UI — but the DATA PATH IS ALREADY OPEN, which is the hazard.** `src/features/chats/components/list-pane.tsx` (L315–319) states the absence. Scoping is plain `workspace_id` with **no** kind awareness anywhere in the feature. A `dopl_chats(op="export")` with no `workspace=` resolves the caller's `personal` container (`workspaces/server/service.ts › resolveActiveWorkspace` L140–144) and lands a chat **nothing in the product lists**. | **→HOME(a)** | MEDIUM. 10 test files including an RLS redteam suite — well covered. The risk is not breakage, it is that the surface is the ONLY missing piece and adding it changes what an operator sees on day one. | Chats is the **cheapest** extend-to-home in the set: no migration, no new endpoint, no audience ceiling. It is also the only one of knowledge/skills/templates/chats with **no** container-publish acknowledgement gate (`shared-publish.ts › assertSharedPublishAcknowledged` has three callers and chats is not one). |
| 7 | **Skills (+ versions, events)** | `SKILL.md` procedures with an inline editor, autosave + 412 CAS, a version/event history rail with diff and restore. | `routes.tsx` rows `skills`, `skills/:skillSlug` (L101–102) → `apps/desktop-ui/src/pages/skills/index.tsx` (L54) → `src/features/skills/components/skills-browser-core.tsx`. API `src/app/api/skills/**` (8 routes). MCP `packages/mcp-server/src/tools/skills.ts` (8 ops, L37–47). | **NO UI, no face.** Same `workspace_id` scoping as chats. ⚠ But the MCP tool **is** link-container aware: `set_visibility` to public inside a shared link container needs a one-time confirm token — `packages/mcp-server/src/tools/skills-ops-write.ts` (L141–172), server gate `skills/server/service-writes.ts` (L60, L169). | **→HOME(a)** | MEDIUM. RLS redteam suite exists. `service-reads.ts` (L45–48) has `DEMO_DISABLE_AUTO_SEED = true` — a home shelf would start empty and that is probably right, but it is a decision nobody has made. | `create-skill-dialog.tsx` (L11) is on `ModalShell` — `Todo` in DESIGN-SYSTEM § Conformance (L428). It is the only INPUT FORM this feature has. |
| 8 | **Knowledge** | Bases, folders, entries, chunks, grants, revisions, export. | `routes.tsx` rows `knowledge`, `knowledge/:kbSlug` (L99–100). | **PRESENT, and it is the reference implementation of an extend-to-home.** `apps/desktop-ui/src/pages/home/knowledge-panels.tsx` (L28–42) — two sections, no scope pill (Samuel 2026-08-27, superseding `docs/specs/home-knowledge-panels.plan.md` §5.2): *shared in this channel* (container bases carrying a channel grant) + the personal shelf. | **WS-KEEP** (both sides built) | HIGH by blast radius — 86 files, 16,947 lines, two RLS redteam suites, and the audience ceiling. | ⚠ The ceiling is real and must survive: `knowledge/server/service-audience.ts` (L112–127) — standard → unrestricted; solo link container → unrestricted; link container WITH a peer → only bases carrying a channel grant, narrowed to the session's channel. A null member count **fails closed** (L93). |
| 9 | **Ontology** | Typed object graph, clusters, anchors, shares, revisions. | `routes.tsx` rows `ontology`, `ontology/:clusterSlug` (L103–104). | **PRESENT.** `apps/desktop-ui/src/pages/home/ontology-panels.tsx` (L27–45) mounts the **same** `ontology/components/ontology-view.tsx › OntologyView`; rows are PERSONAL — clusters in the caller's `personal` container, never the channel's (L39–44). Lent into channels by reference: `ontology-share.tsx`, `supabase/migrations/20261001120000_ontology_home_shares.sql`. | **WS-KEEP** (both sides built) | MEDIUM. `GET /api/ontology` sits at `minRole: "guest"` (route L50) by Samuel's 2026-09-09 home-ontology ruling; raising it closes F-685 the wrong way. | This is the **second** reference implementation and the better one for a *shared* module: one view component, two hosts, tenancy chosen by the host. |
| 10 | **Agent templates** | Persistent agent identities: name, instructions, model, custom fields, attached KBs, a visibility scope. | `routes.tsx` row `agents` (L98). No detail route by design — a template is edited in a modal, so `deep-link-target.js` carries `agents: false`. | **PRESENT, with a different label set.** `src/features/agent-templates/lib/visibility.ts`: standard workspace → Private / Team / Public (L37–53); link container → exactly ONE section, `workspace` labelled **"Shared in this channel"** (L76–82); home shelf → `SECTION_PRIVATE_EVERYWHERE` labelled **"Personal"** (L99–103). | **WS-KEEP** (both sides built) | MEDIUM. `private` was REMOVED from the container array 2026-08-27 (L58–66) because it would create write-only rows. Re-adding it is a regression that no test would obviously catch. | Third reference implementation, and the one that shows the **label** axis is separate from the **storage** axis: "Personal" is UI copy; `visibility:'private'` is unchanged in storage (L90–93). |
| 11 | **Channels** | The lead product. 302 files, 64,944 lines. | `routes.tsx` rows `channels`, `channels/:channelId` (L80, L90). | **PRESENT, pinned to one channel.** `apps/desktop-ui/src/pages/home/relationship-record.tsx` mounts the whole channels surface for the selected row with `memberManagement: false` (L141). | **WS-KEEP** (both sides built) | VERY HIGH by mass. Out of scope for a members/chats/skills uplift; in scope for anything that touches `capabilities`. | The `memberManagement` capability is the seam that makes one surface serve both (L105–108). |
| 12 | **Revisions** | Shared append-only history primitive; one row per write carrying the post-write snapshot, diffs computed at read. | Not a page — a service. Families: `knowledge_base, knowledge_folder, knowledge_entry, ontology_cluster, ontology_object` (`src/features/revisions/types.ts` L16–22). Routes under `api/knowledge/**` and `api/ontology/**`. | **REACHES /home** via the ontology changelog — `apps/desktop-ui/src/pages/home/ontology-panels.tsx` (L8) imports `ClusterChangelog`. | **WS-KEEP** | LOW. 7 tests, family-agnostic by design (`revisions/server/service.ts` L17–24). | ⚠ **Chats and skills are NOT in the revisions model.** Skills keep their own `skill_versions` / `skill_events`. Extending revisions to them is a separate project and must not be smuggled into a parity wave. |
| 13 | **Billing — credits / wallets** | Which wallet a tool call burns and whose. | `src/features/billing/server/credits-service.ts › containerTarget` — standard → `wallet:"seat"`, payer = caller (L211–212); `personal` → `wallet:"personal"`, payer = caller (L214–221); **`link` and every unknown kind** → `wallet:"personal"`, payer = the container **OWNER** (L223–241); no active owner → `wallet:null`, unmetered (L225–232). | **HOME IS THE PERSONAL ARM OF THE SAME MODULE.** There is no second billing system. Entry `resolveBillingTarget` (L174–186); channel picks the container since rule B. | **WS-KEEP** (unified) | **VERY HIGH.** 30 test files. This is the most load-bearing shared module in the set and the one where a "simplification" does real damage. | ⚠ The `link` arm is a FALLTHROUGH, not a branch — it catches every kind not named. That is deliberate (a fourth kind inherits the safe answer) and must not be rewritten as an explicit `=== "link"`. |
| 14 | **Billing — plans / Stripe / checkout** | Two plan groups; Stripe checkout, portal, webhook, seat reconciliation. | `src/features/billing/plans.ts › plansForKind` (L205–217) — `personal` → `PERSONAL_PLANS` (Free 500 / Pro $8.99 5,000), everything else → `WORKSPACE_PLANS` (Starter 100/member / Team $8.99/seat 5,000). Routes `src/app/api/billing/{checkout,webhook,upgrade-to-team,portal,cancel,status,invoices,payment-method}`. | **Home reaches the SAME modal pane.** `openHomeSettings("billing")` → `apps/desktop-ui/src/components/settings-modal/billing-pane.tsx` (L57) → `plans-billing-core.tsx` (L212) renders Free/Pro off `plansForKind(ent.containerKind)`; the meter label becomes "Personal credits" (L238). | **WS-KEEP** (unified) | HIGH. `checkout/route.ts` (L144–147) 400s `PLAN_NOT_FOR_CONTAINER` on both mismatches; `upgrade-to-team/route.ts` (L54–63) 409s `NOT_A_WORKSPACE`. Both gates are the only thing stopping a link container from buying a seat plan. | ⚠ **OPEN: F-678** — `/billing/[segment]` renders Starter/Team for a `kind='link'` container whose Team checkout then 400s. Hand-typed URL only. It is the billing twin of §E-1. |
| 15 | **Billing — credit DISPLAY** | Where "credits used / left" is drawn. | Workspace: `apps/desktop-ui/src/pages/overview/period-stats.tsx › PeriodStats` (L35) off `useWorkspaceEntitlements(workspaceId)` (`overview/index.tsx` L94). Also `billing-usage-pane.tsx` (L37) and `plans-billing-core.tsx` (L317, L337). | Home: `apps/desktop-ui/src/pages/home/overview-panels.tsx` (L345, L369–377) → `overview-sections.tsx › CreditCapacityBar` (L152–170), denominator `billing/credits.ts › PERSONAL_MONTHLY_CREDITS`. Container is the caller's `personal` one (`home-panes.tsx` L108–121). | **WS-KEEP** (both sides built) | MEDIUM. Both read the SAME hook and the same `/api/billing/status` cache entry — a refactor that splits them buys a second read for nothing. | ⚠ `apps/desktop-ui/src/pages/settings/index.tsx` carries **no** billing surface at all; it is all in the modal. Do not "add billing to settings" — it is already there, one layer up. |
| 16 | **Workspace settings** | Rename + description, icon, MCP connect, connected apps, owner delete. | Page `apps/desktop-ui/src/pages/settings/index.tsx` (route `routes.tsx` L112) AND modal pane — both compose the SAME `src/shared/layout/settings-modal/sections/workspace-section-core.tsx › WorkspaceSectionBody` (L43–76); the page differs only in chrome and in what it hangs off `extras` (L22–24). | **Home reaches the same modal** via `home-settings-control.tsx › HomeSettingsControl` (L56), which binds to `identity.workspace` — the boot **default STANDARD workspace**, not the personal container — and renders nothing when none is provisioned (L93). | **RULING** (§E-3) | MEDIUM. **Nothing in the settings tree tests `kind`** except `plansForKind`. An owner of a link container at `/{link-segment}/settings` gets rename + delete for a relationship container. | The composition is already correct for parity. What is missing is kind-awareness, not a second surface. |
| 17 | **Account settings** | Account pane + Plans & Billing pane, in one modal. | `src/shared/layout/settings-modal/settings-modal-core.tsx › SettingsSection` (L18) — `"account" \| "workspace" \| "billing"`; nav groups L25–37. | **IDENTICAL — home opens the same modal** (`home-settings-control.tsx` L117–127). The /home entry is a black pill reading "Profile" (Samuel 2026-09-15). | **WS-KEEP** (unified) | LOW. | ⚠ **A `members` pane STOOD HERE AND IS DELETED** (Samuel 2026-08-30, ASK-1) — `settings-modal-core.tsx` (L60–63): *"It owns no pane of its own since 2026-08-30. The members pane was the one exception and it is deleted"*. **Do not re-add a members pane to settings as the home-parity answer.** See §C-1. |
| 18 | **MCP connect** | The connect block (endpoint + CLI one-liner) and the connected-apps list. | `RemoteConnect` in every workspace-settings surface — `workspace-section-core.tsx` (L69). `ConnectedAppsSection` only on the desktop `/settings` PAGE, via `extras` (`pages/settings/index.tsx` L80); the modal passes none (`workspace-section-core.tsx` L31–33). | **Partial** — /home's modal reaches `RemoteConnect`, never `ConnectedAppsSection`. | **→HOME(a)** (small) | LOW. 4 files, 300 lines, **zero tests**. | ⚠ `mcp-connect/skill-template.ts` must stay aligned with `packages/mcp-server/src/server.ts › buildInstructions` (stated L1–12). |
| 19 | **Onboarding** | Three steps — survey → MCP connect → workspace name — plus the provisioning checklist. ⛔ **The welcome popup and the connect banner are DELETED (R-49, 2026-09-17)**, with their shell mounts. | Desktop only: `apps/desktop-ui/src/pages/onboarding/index.tsx` (L54), route `routes.tsx` (L130–134). API `src/app/api/onboarding/**`. | **None, and none is wanted** — `redirectPath` answers `/{segment}/overview`. | **WS-KEEP** | MEDIUM. It is the first-run path; a parity wave that changes the shell can break it silently. | ⛔ The `WS-RESTYLE` this row carried was on `welcome-popup.tsx`'s hardcoded hex; the file is gone, so the row is discharged. |
| 20 | **Get started (web)** | The web install/handoff screen, and the website-retirement landing. | Web only: `src/app/(auth)/get-started/page.tsx` (L37). No SPA importer. | n/a | **WS-KEEP** (web, dying with the site) | LOW. 3 files, 286 lines, **zero tests**. | Bespoke CSS (`get-started.css`, `install-animation.css`, `gs-*` classes). **Do not restyle it** — it retires with the website. |
| 21 | **Tour** | ⛔ **DELETED 2026-09-17 (R-49)** — `src/features/tour/**` and its shell mount are off disk; the row records what was measured, not what exists. Was a five-step tour keyed to `NavSection`. | was `app-shell.tsx`, `tour/tour-steps.ts` | **None — it never mounted on /home.** | ✅ **RULED (§E-4): deleted** | LOW. 4 files, 331 lines, **zero tests**. | ⚠ Its step list is keyed to `NavSection`, so it is coupled to §0.2's four-file rule. A tour of home would need a second vocabulary. |
| 22 | **Analytics** | Conversion events, system events, MCP events, per-tool-call rows, launch metrics. | **Write paths are in the hot auth wrappers** — `shared/auth/with-auth.ts` (L388, L427), `shared/auth/with-workspace-auth.ts` (L9). Read surface is `/admin/*` only. | Account-wide by nature; no home surface. | **WS-KEEP** | **HIGH by coupling, LOW by mass.** It is 617 lines with ONE test, and it is instrumented inside `withAuth` / `withWorkspaceAuth`. Anything that touches a wrapper touches analytics. | `launch-metrics.ts` prices per row from `workspace_billing.stripe_price_id`, never from `prices.ts` (L7–15) — do not "simplify" that. |
| 23 | **Admin** | `/admin/analytics` and `/admin/health`. | Web only. Gate is a single env var — `shared/auth/with-auth.ts › isAdmin` (L446–450), `userId === process.env.ADMIN_USER_ID`; unset ⇒ every admin route 404s. | n/a | **WS-KEEP** | LOW. | **OLDEST UI in the tree** — raw Tailwind, no kit, hand-written status/severity maps (`admin/health/page.tsx` L14–25). Out of scope for parity; note it so a sweep does not read it as a miss. |
| 24 | **Playground** | Public anonymous demo: a static app mirror that becomes live once a throwaway guest workspace is provisioned. | Web: `src/app/playground/page.tsx` (L17–29); session route is **deliberately unauthenticated** (`api/playground/session/route.ts` L9–13) with a per-IP limiter; reaper cron. | n/a | **OBSOLETE?** (§C-5) | MEDIUM. 18 files, 4,467 lines, **zero tests**, and it provisions real `auth.users` rows. | It is a marketing asset on a website that is being retired. Its panes are the ONLY consumers of `playground/components/panes/{members,skills,chats}-pane*`. |
| 25 | **Workspace Overview** | Greeting, stat cards, credit period stats, metric histogram, Needs-you, recent activity + member load. | `apps/desktop-ui/src/pages/overview/index.tsx` (L126–146). Three reads, one gate (L27–34). | **Home has a DIFFERENT Overview, and the difference is RULED, not accidental** — see §B-8. | **RULING** (§E-5) | MEDIUM. The two Overviews are the clearest duplicated-intent pair in the product. | ⚠ Two home cuts a wave must not "restore": **WAITING ON YOU and RECENT THREADS were CUT from /home Overview with all their plumbing** (INVARIANTS L333, 2026-09-05), and **the channel-scoped overview panel was DELETED as "a duplication bug, not a preference"** (INVARIANTS L324, 2026-09-01). ⚠ **OPEN: F-652** — the workspace page's "Needs you" reads an ACCOUNT-wide endpoint and throws most of it away. |
| 26 | **Auth** | Login/signup, Google One Tap, password policy + meter, reset. | Web `src/app/(auth)/**`; desktop reuses `LoginFormCore` in `pages/boot/signed-out-screen.tsx`. | n/a — account-level already. | **WS-KEEP** | LOW. | ⚠ `auth/components/password-requirements.tsx` (L3–9) hardcodes hex. **`WS-RESTYLE` on that file alone.** |
| 27 | **Marketing / pricing** | Public pricing page; the landing hero demo. | `src/features/marketing/components/pricing-content.tsx` (L174) filters memberships through `isStandardWorkspace`. | n/a | **WS-KEEP** (web, dying with the site) | LOW–MED. ⚠ **The landing hero demo renders /home's tab strip**, which is why `HOME_TABS` moved to `src/features/home/tabs.ts` on 2026-09-17 — the Next tree cannot import `apps/`. A parity wave that moves home vocabulary must keep that import legal. | See §D-6. |
| 28 | **Workspaces core** | Kind predicate, role ranks, resolution, authz, lifecycle, seeding, overview repo, shared-publish ack. | `src/features/workspaces/**`, 27 files. `resolveActiveWorkspace` (L126–146): header present → validate + membership; header ABSENT → `ensurePersonalContainer(userId)` then re-check, fail-closed. Personal containers are deliberately **not** seeded (L173–182). | It IS the shared substrate of both surfaces. | **WS-KEEP** (unified) | **VERY HIGH.** 15 tests including `workspace-kind.test.ts`, `link-container-guard.test.ts`, `resolve-active-workspace.test.ts`. Every row above depends on it. | §F-1. |

---

## B. Reverse map — what the other side lacks, and what to do about it

### B-1. Home lacks **Chats** → RECOMMEND: extend, `→HOME(a)`, smallest job in the set

Nothing about chats is workspace-shaped. Tables carry plain `workspace_id`
(`supabase/migrations/20260707170000_chats.sql` L12–24); the repository filters on it and nothing
else (`chats/server/repository.ts` L63–89); there is **no** `kind` / `isStandardWorkspace` reference
anywhere in `src/features/chats/**`.

The data path into the home space is **already live and already producing orphans**:
`dopl_chats(op="export")` with no `workspace=` resolves the caller's `personal` container, and
`ChatsView` has one mount — the workspace route — so that chat is listed nowhere. The rail filters to
`isStandardWorkspace` (`app-shell.tsx` L319–320; `pages/home/index.tsx` L352).

**Recommendation.** A sixth /home face, or a section on an existing one, reading the personal
container. No migration, no new endpoint, no audience ceiling. It closes a live orphan class rather
than adding a feature. ⚠ Chats is the only one of knowledge / skills / templates / chats with **no**
container-publish acknowledgement gate; if a home chats face can share into a channel, it inherits
that question (§E-6).

### B-2. Home lacks **Skills** → RECOMMEND: extend, `→HOME(a)`, second-smallest

Same shape as chats. `skills/server/repository.ts` (L56–60) is plain `workspace_id`. The MCP tool is
*already* link-container aware — `skills-ops-write.ts` (L141–172) requires a one-time confirm token
before a skill goes public inside a shared link container — so the hard half of the audience question
is built and only the surface is missing.

⚠ Two sub-decisions ride along, and the first one is **already answered**: (a) `DEMO_DISABLE_AUTO_SEED
= true` (`service-reads.ts` L45–48) means a home shelf opens empty — and that is the ruled outcome,
not an accident: **seed content was DROPPED for the personal container, *"a personal container is a
shelf, not a workspace"*** (`docs/ENGINEERING.md` L480, L2413, 2026-09-10); seeding runs at ONE
creation path. (b) `create-skill-dialog.tsx` is the feature's only INPUT FORM and is on the old
`ModalShell` — extending it to home doubles a non-conforming dialog unless it is conformed first.

### B-3. Home lacks a **Members console** → RECOMMEND: do **not** extend. Close the gap the other way.

Home's members-lite is not a stub; it is the ruled shape. The roster uses the *same row component* as
the channels page by explicit instruction (`person-members.tsx` L12–20, Samuel 2026-08-25:
*"I don't know why you're making it different"*), and the one act beneath it is a link mint because
**the link claim is the only door** (L33–35). Three things in members-v2 have **no referent** in a
link container: teams (`offersTeamScope` L160–162), email invitations (`assertMemberAddable`), and
join requests (`join-links.ts` L191). What is genuinely absent is narrower:

| members-v2 capability | Home has? | Recommendation |
| --- | --- | --- |
| Roster with presence | ✔ (`MemberRoster`) | none |
| Add a person | ✔ (link mint) | none |
| Remove / leave | ✔ server-side — `membership-admin.ts` (L18–21) is deliberately NOT kind-gated | **UI gap**: no home surface calls it. A member cannot be removed from a link container from /home. §E-2. |
| Change a member's ROLE after claim | ✖ | The role is set once, by the link. §E-2. |
| Member About / profile | ✔ `person-info-tab.tsx` | none |
| Activity feed | ✖ (`workspace_activity_events` is workspace-only) | **Do not extend.** See §C-3. |
| Access matrix / teams | ✖ | Correct — no referent. |

### B-4. Home lacks a **Settings page** → not a gap. §A-16/17; the modal already serves both.

### B-5. Home lacks the **tour** and the **onboarding welcome popup** → 🔴 **SO DOES THE WORKSPACE, SINCE R-49 (2026-09-17): both are DELETED.** §E-4.

### B-6. Home lacks **`ConnectedAppsSection`** → small, real. `→HOME(a)`, one prop.

The modal passes no `extras` (`settings-modal.tsx` L81–95), so the OAuth-grant list and its
Disconnect are reachable only from the workspace `/settings` PAGE. An operator who works entirely in
the home space cannot see or revoke their connected apps. That is a security-relevant absence, not a
cosmetic one.

### B-7. **Workspaces lack the link-claim model** → correct, leave it. (§A-5.)

One OPEN link per container (`channel_links_one_open_per_workspace`), single-use, grant-above-self
bounded. A workspace has email invitations and a rotatable standing join link instead. Two admission
models for two population shapes; neither is the other's gap.

### B-8. **Workspaces lack most of home's Overview** → the real reverse gap, and it is analytics

`src/features/home/overview-types.ts › HomeOverview` (L249–276) carries what the workspace Overview
does not:

| Home Overview has | Workspace Overview has | Overlap |
| --- | --- | --- |
| Credits **by channel** (`HomeChannelUsage` L177) | — | — |
| Credits **by person** (`HomePersonUsage` L165) | member load by MESSAGE share | different denominator |
| Credits **by tool/op** (`HomeToolUsage` L191) | — | — |
| Live **agent board** (`HomeAgentRow` L209) | `agentsRunning` — a COUNT | count vs board |
| **Token spend**, 31-day, own agents (`GET /api/home/token-spend`) | — | — |
| A **range switcher** (24h / 7d / 30d / month) | a fixed 31-point series | — |
| A `scanned` denominator + `truncated` honesty | `truncated` on neither | — |
| **CUT by ruling** (see below) | Recent activity feed | — |
| **CUT by ruling** (see below) | Needs-you | ⚠ F-652: it reads the ACCOUNT-wide endpoint |

⚠ **THE LAST TWO ROWS ARE NOT GAPS ON THE HOME SIDE. THEY ARE DELETIONS.**
`docs/INVARIANTS.md` (L333, 2026-09-05): **WAITING ON YOU and RECENT THREADS are CUT from /home
Overview — both cards went with *all* their plumbing.** And `INVARIANTS.md` (L324, 2026-09-01): the
cross-channel face is the face, and **the channel-scoped overview panel is DELETED — "a duplication
bug, not a preference."** A parity wave that adds an activity feed or a Needs-you card back to /home
is reversing two rulings, not achieving parity. The direction of travel here is **workspace ← home**,
never the reverse.

**Recommendation.** This is the one place where the home space is genuinely ahead in *function*, not
just in styling, and where porting is worth real money. But it is `→HOME(b)` **in reverse**: the home
endpoints are `withUserAuth` and fan out over the caller's containers; a workspace twin must be
`withWorkspaceAuth` and fenced to one. `GET /api/workspaces/[slug]/overview-series` and
`GET /api/home/overview-series` are already two implementations of one idea. §E-5.

⚠ **AND THE METERS MUST NOT MIX.** `docs/specs/credit-model-v2.md` (L89–103, 2026-09-12): both
surfaces answer *"what came out of MY personal wallet"*, and **a `seat` row is on no /home figure.**
Porting the rails means porting the SHAPE of the breakdown, not the wallet it reads.

### B-9. **Workspaces lack a personal shelf** → by construction. The personal container is one per USER.

---

## C. Obsolete candidates — where a workspace feature overlaps something home replaced

Each row asks the question Samuel asked: *does the reasoning that removed it from home also apply to
a multi-member container?*

### C-1. The settings **Members pane** — ALREADY REMOVED, and the removal is the precedent

* **Home replacement:** none needed; the pane is gone from both surfaces.
* **The ruling:** `src/shared/layout/settings-modal/settings-modal-core.tsx` (L60–63), Samuel
  2026-08-30, ledger ASK-1 — *"It owns no pane of its own since 2026-08-30. The members pane was the
  one exception and it is deleted."* The component no longer takes `workspaceSegment` /
  `workspaceId` / `currentUserId` / `role`; nothing in settings reads a workspace fact.
* **Does the reasoning apply to a multi-member container?** Yes, and it is the reason §E-2 should not
  be answered by putting members back into settings. A settings modal that knows a roster is a second
  members surface. The console is the one surface; home's is the roster on the channel's info tab.
* **Verdict: already obsolete, stay obsolete.** Listed so a parity wave does not "restore" it.

### C-2. `dopl_home(op="create_channel")` — retired, successor named, SHAPE still owed

* **Home replacement:** `dopl_workspaces(op="create_home_channel", name=)`.
* **The ruling:** F-621, `docs/REFACTOR-FINDINGS.md` — *"Resolution, TAKEN 2026-09-02 at the batch-3
  integration (Desktop Agent default, **Samuel may reverse**)"*. Status: **RESOLVED, and the SHAPE
  still wants Samuel's word.**
* **Applies to a multi-member container?** The winning argument was that minting a room and INVITING
  into one are different acts, and the invite half has been `sessionOnly` since the tool shipped. That
  argument is *stronger* in a multi-member container, not weaker.
* **Verdict: obsolete, correctly. §E-7 carries the outstanding shape question.**

### C-3. `workspace_activity_events` — a workspace-only ledger with no home twin

* **Home replacement:** none. /home's Overview measures **credits and messages**, not member verbs.
* **Why it may be obsolete rather than missing:** the activity feed's whole value is *admin oversight
  of other people's actions* — `members/activity-visibility.ts › ADMIN_ONLY_VERBS` (L32–35) makes
  `member.removed` / `member.invited` admin-only whatever the resource, and `filterActivity` (L72–86)
  narrows the rest by the caller's own access, failing closed on half-formed rows (L81–84). The table
  has SELECT **revoked** from `authenticated` with RLS on and no permissive policy
  (`20260819130000_workspace_activity_events.sql`).
* **Applies to a multi-member container?** **No, and that is the point.** In a link container nobody
  can be invited, no role can be granted after claim, and there is no team to add to — three of the
  verbs have no producer. What remains (`member.removed`, resource writes) is already legible from the
  channel itself.
* **Verdict: NOT obsolete for workspaces; correctly absent from home. Do not extend it.** But see
  §E-8: it is one of two workspace-only features whose *cost* (a whole table, a filter, a revoked
  grant) is carried for one tab nobody has measured.

### C-4. Teams — the AXIS is retired, the CAPABILITY is not. NOT an obsolete candidate.

Two migrations look like a retirement and are not:
`20260915120000_drop_agent_template_teams.sql` and `20260916120000_drop_team_resource_access.sql`,
both marked *"WRITTEN, NOT APPLIED"* (§0.5). Ruling **B4** is quoted inside the first (L8–11):
*"Ruling B4 retires the team AXIS, not the team CAPABILITY: `agent_templates.visibility = 'team'` is
untouched, `TemplateVisibility` keeps three values."* Team grants become ordinary
`resource_grants(scope_type='team')` rows. The second file states the cost the change removes:
`assert_team_grant_workspace()` had been written FIVE times and its GC FOUR more.

**Verdict: re-platformed, not retired.** Anything that reads these two migrations as licence to
delete `src/features/teams/**` is wrong. What IS stale is doc drift naming the old table —
`teams/server/repository.ts` (L10), `repository-resources.ts` (L66).

⚠ **RECORDED DISAGREEMENT — DO NOT SILENTLY PICK A SIDE** (CLAUDE.md § *Precedence*). The B4 ruling
as written in `docs/specs/mcp-v2-architecture.md` (L326, L352) says *"Drop `access_mode`,
**`visibility='team'`**, `team_resource_access`, `agent_template_teams`, the trigger, five predicate
arms."* The migration that executes B4 says the opposite in its own header —
`20260915120000_drop_agent_template_teams.sql` (L8–11): *"**TEAM VISIBILITY ON A TEMPLATE SURVIVES
THIS FILE.** Ruling B4 retires the team AXIS, not the team CAPABILITY … `TemplateVisibility` keeps
three values."* The code side is corroborated: `src/features/agent-templates/lib/visibility.ts` still
carries the `team` section for standard workspaces (L37–53) and
`packages/mcp-server/src/tools/agent-team-axis.test.ts` is named in the migration as *"keeps
passing"*. **Precedence says the migration and the code win and the spec line is the stale one** —
but this document does not edit either. It is a `F-NNN` for whoever opens the parity wave, and it
matters because a reader who takes the spec at its word will delete a live capability.

### C-5. Playground — the strongest genuine obsolete candidate in the set

* **What replaced it:** nothing in home; the **website** did. Its page is a marketing surface
  (`src/app/playground/page.tsx` mounts `SiteNav` and `marketing.css`), and the standing direction is
  that the website is being retired in favour of the bundled desktop app.
* **Cost it carries:** 18 files, 4,467 lines, **zero tests**, a deliberately unauthenticated
  provisioning route that creates real `auth.users` rows and short-lived `mcp_tokens`, a reaper cron,
  and two `public-routes.ts` entries. It is the only consumer of
  `playground/components/panes/{members,skills,chats}-pane*`, which are a **second, static copy** of
  three of the surfaces this document is trying to bring to parity.
* **Applies to a multi-member container?** Not applicable — it is anonymous by design.
* **Verdict: OBSOLETE? — §E-9.** Recommend retiring it with the website rather than carrying three
  frozen mirror panes through a parity refactor that changes what they mirror.

### C-6. `/billing/[segment]` for a link container — obsolete SURFACE, live bug

F-678, OPEN. The page resolves any kind, renders Starter/Team for a `kind='link'` container, and its
Upgrade answers a 400 naming a workspace. The finding's own fix options are `notFound()` or a
one-liner pointing at `/billing?plan=pro`. Cosmetic today because nothing links there; it becomes
reachable the moment §E-1 is answered the wrong way.

### C-7. `scope_type='container'` — schema with no writer. HALF-BUILT, not obsolete.

`docs/REFACTOR-FINDINGS.md › F-467` (L7339, OPEN): the `container` scope on `resource_grants` is
*"schema with **no writer**, and that is the whole point of B4's other half."* The grant model that
replaced per-table junctions has three scopes and only two of them have a producer.

**Why it is in this section.** A parity wave that wants to lend a resource to a whole container —
which is what "share this skill with everyone in this home channel" means — will reach for this scope,
find the column, and have to write the first producer. That is a feature, not a wiring job, and it
should be costed as one. **Verdict: not obsolete; unfinished, and it is the natural home of any
container-level sharing §E-6 might grow.**

### C-8. `workspace_credit_usage` + `consume_workspace_credits` — scheduled, marked, not dropped

`docs/specs/credit-model-v2.md` (L257–258, 2026-09-07): they **stay** for that wave, marked
*retired-from-writes* by `COMMENT ON TABLE`; the DROP is its own later migration. Same posture as
`default_workspace_of`, which INVARIANTS (L2033) calls *"born deprecated, and that is its job"* — one
SQL spelling of the derived default so a later batch deletes the concept by touching one function.

**Verdict: leave both alone.** They are deliberate hold-points. Deleting a marked-retired object early
is how a wave acquires a migration it did not plan.

---

## D. Dependency map — what the parity refactor may not break

Measured by import graph, 2026-09-17.

### D-1. Cross-feature imports (source: `grep -rho "@/features/[a-z-]*"` per feature)

```
members     → billing, teams, workspaces
teams       → members, workspaces
chats       → billing, members, teams, workspaces
skills      → members, teams, workspaces
billing     → onboarding, tour, workspaces
revisions   → knowledge, ontology
analytics   → (nothing)
onboarding  → analytics, workspaces
workspaces  → agent-templates, analytics, billing, channels, chats,
              knowledge, members, onboarding, ontology, skills, teams
```

🔑 **`workspaces` imports everything and everything imports `workspaces`.** It is the hub, and §F-1
treats it as untouchable.

### D-2. Members / chats / skills are **independent of the channel + agent world**

`grep -rl "@/features/channels"` per feature: `members` **0**, `skills` **0**, `chats` **0**;
`home` 7, `agent-templates` 3, `knowledge` 2, `ontology` 1.

**This is the best news in the document.** The three modules most likely to be uplifted do not touch
channels at all. The uplift's blast radius into the agent world is therefore mediated by exactly two
things: `workspaces` (D-1) and `billing` (D-3).

### D-3. Billing ← agent launch — and the gate is NOT where you would look for it

* There is **no credit gate at agent launch.** `src/features/channels/components/agents-controls.ts › canLaunchAgents` (L238–240) tests only for the desktop bridge, and `src/app/api/channels/launch-directives/route.ts` has no entitlement check.
* The ONE hard block is per **MCP tool call**: `packages/mcp-server/src/registrar.ts` (L148) —
  `if (outcome?.allowed === false) return creditsExhausted(outcome);`. The charger fails **OPEN** on
  any throw (L111–119).
* The charge endpoint is `POST /api/mcp/credits/consume`, at `minRole: "guest"` deliberately — the
  route's own docblock: at the `viewer` default it 403'd every guest call, and because the runner
  fails open, *"a 403 was not a refusal, it was a FREE TOOL CALL plus a log line."*
* The kind → wallet hop is inside that route (L38–70) and `credits-service.ts › resolveBillingTarget`.
* Seat reconciliation is reached from `join-links.ts › resolveJoinRequest` (L360) — **membership
  writes move money.**

⚠ **Any parity change that adds a membership path, or changes which container a call is attributed
to, is a billing change.** Rule B (the calling channel's container wins) lives in
`billing/server/channel-attribution.ts` with a forgeable-header fence at L72–80.

### D-4. Skills / chats / knowledge / templates ← MCP

`packages/mcp-server/src/workspace-arg.ts › WORKSPACE_ARG_OPS` (L65–79) is the authority on where
`workspace=` is honoured:

* **Resource tools (id resolves its own tenancy)** — `dopl_kb` (`list_bases`, `create_base`,
  `search`), `dopl_skill` (`list`, `create`), `dopl_chats` (`list`, `folders`, `export`,
  `create_folder`), `dopl_agent` (`list`, `create`).
* **Container tools (`null` = the arg is ignored, the id resolves its own container)** —
  `dopl_channel`, `dopl_ontology`, `dopl_members`, `dopl_map`, `dopl_search`.

`dopl_members` is **read-only** — no write ops, no admin twin (`tools/members.ts` L2–9); ops are
`whoami, list, get, teams, get_team, access_matrix, my_access` (L96), and `access_matrix` covers
knowledge bases and skills only (L67).

⚠ **`workspaceArgTargets()` (L88) RENDERS the sentence agents read from this table.** A row added or
removed changes agent-facing copy. `server.test.ts` pins every key against the live op enum in both
directions.

### D-5. Account-wide MCP reads ← the container lock

`packages/mcp-server/src/tools/account-scope.ts` is *the one seam* the account-wide channel reads pass
through, delegating to `workspace-directory.ts › narrowToLock`. Its own docblock: there is ONE reader
of `lockedWorkspaceId()`, and a second reader *"has rebuilt the enumeration oracle B3 denies."*
`channelCount` is re-derived rather than passed through, because the server's number would tell a
locked agent how many rooms its operator has.

**A parity wave that adds an account-wide read owes this narrowing.** It is a tripwire, not a fence —
the real refusal is the container-locked credential.

### D-6. Home vocabulary ← the marketing landing page

`src/features/home/tabs.ts` (L4–12): the face set and labels moved to the root tree on 2026-09-17
**because the landing hero demo draws that strip** (`features/marketing/components/banner-demo/`) and
the Next tree cannot import `apps/` at all. `apps/desktop-ui/src/pages/home/home-tabs.ts` re-exports
both names so every SPA import path is unchanged.

**Consequence:** adding a sixth /home face (chats, skills) changes the marketing hero. Either the demo
gets a curated subset, or the landing page grows a tab nobody planned.

### D-7. Knowledge / ontology ← the audience ceiling ← `workspaces.kind`

`knowledge/server/repository-audience.ts` (L32–41) reads the **raw `kind` column**, not
`isStandardWorkspace`, on purpose, and re-reads member count from the database rather than trusting a
header (L11–25). `service-audience.ts` (L93) fails **closed** on a null count.
⚠ `WorkspaceWithRole.memberCount` on the wire is optional and `?? 0` means **NOT SOLO**
(`workspaces/types.ts` L120–126) — the stale-cache instinct is inverted here deliberately.

### D-8. Everything ← the four-file page rule (§0.2) and the drift gates

`scripts/check-role-drift.ts` (role set, the `GET /api/workspaces` row shape, and the three copies of
`isStandardWorkspace`), `check-knowledge-type-drift.ts`, `check-css-token-drift.ts`,
`check-rls-pair-gate.ts`, `check-tenancy-move-gate.ts` (refuses a migration that re-stamps a parent
without its children — bought by F-664), `check-doc-refs.mjs`, plus
`dopl-desktop-app/test/deep-link-target.test.mjs`.

---

## E. Items needing Samuel's ruling

Numbered, with options and a recommendation. **None of these is decided anywhere in this document.**

### E-1. A non-guest member of a `link` container gets the FULL workspace shell at a typed URL

**What is true.** `app-shell.tsx` (L84–87) fences only `kind === "personal"`; L82–83 admits `link`
deliberately so guests can render. Guests are then redirected to their one channel (L127–150). A
**member** or **owner** of a link container is redirected nowhere and sees Overview, Channels, Agents,
Knowledge, Skills, Ontology, Chats, Members, Settings — including an owner delete for a relationship
container (§E-3) and, at `/billing/{segment}`, F-678's Starter/Team cards.

**Options.**
a. **Fence `link` like `personal`** — redirect any `link` segment to `/home`. Simplest; costs the
   guest lane a second look (the guest redirect at L127–150 would become unreachable and should go).
b. **Kind-aware `NAV`** — branch the nav list on `kind` so a link container shows only the sections
   that have a referent. Makes the sidebar kind-aware, which L140–148 explicitly says is the trigger
   for making the upsell card kind-aware too.
c. **Leave it.** It is URL-only and nothing links there.

**Recommendation: (a).** It is one effect, it deletes a redirect rather than adding a branch, and it
makes the sentence in §0.2 ("/home renders no sidebar") true of the whole home space rather than of
one route. It also closes F-678 by construction.

### E-2. What, exactly, should a home container's member management be able to do?

🔒 **BLOCKED ON F-343 (§0.6-ii) — answer that first or none of these options can be gated.**
`HomeChannel` carries no caller role; `containerTarget.role` is hardcoded `"owner"`. Every option
below is a question about what *this* person may do, and /home currently cannot say who they are.

**What is true.** `assertMemberAddable` closes ADDING. `membership-admin.ts` (L18–21) leaves REMOVAL
and DEPARTURE open server-side, **and no /home surface calls them** — and departure-is-removal is a
ruled concept carrying the `LINK_MINT_FORBIDDEN` floor's weight (a guest may NOT mint),
`docs/INVARIANTS.md` (L263, L268, 2026-08-26): *"every size is an ordinary state."* Role after claim
is fixed by the link's `granted_role`.

**Options.**
a. **Roster + add only** (today). A person admitted at `guest` is a guest forever; a person cannot be
   removed from /home.
b. **Add remove/leave to the roster.** The server already allows it; this is a UI-only change on
   `person-members.tsx`.
c. **(b) plus a role change** guest ⇄ member after claim. Needs a new write, and it re-opens the
   grant-above-self question `mintContainerLink` (L178–183) answers for links.
d. **Full members-v2 on home.** Contradicts C-1 and C-3 and imports teams/invites/join-requests that
   have no referent.

**Recommendation: (b).** Departure is already a ruled concept ("departure = removal"), the server half
exists, and a container you cannot leave from its own surface is the sharper defect. Hold (c) until
somebody asks for it.

### E-3. Should `/{segment}/settings` exist for a `link` container, and should it offer DELETE?

**What is true.** Nothing in the settings tree tests `kind` except `plansForKind`
(`billing/plans.ts` L213). `WorkspaceSectionBody` gives rename, description, MCP connect and — for
`role === "owner"` — a danger-zone delete (`workspace-section-core.tsx` L71–73). On a link container
that is "delete this relationship, and everyone in it".

**Options.** (a) Answer E-1 with option (a) and this becomes unreachable. (b) Make
`WorkspaceSectionBody` kind-aware: rename allowed, delete refused with the channel-deletion path
named instead. (c) Leave it.

**Recommendation: E-1(a) first, then (b) as belt-and-braces** — the settings body is shared with the
modal, and the modal is reachable from /home.

### E-4. Does the home space get a tour and a welcome popup?

**What is true.** Both mount only in the workspace shell (`app-shell.tsx` L252–255, L269–281). The
tour's five steps are keyed to `NavSection` (`tour-steps.ts` L11) — ontology, knowledge, skills,
chats — **four of which are sections /home does not have, and two of which (skills, chats) are the
subject of §E-6.** /home is the desktop's landing surface, so a first-run user meets home first and
the tour second.

**Options.** (a) Leave it. (b) A second step list keyed to `HOME_TABS`. (c) Retire the tour.

**Recommendation: (a) until §E-6 is answered**, then revisit — a tour that names Skills and Chats is
either wrong for home or becomes right for free.

→ 🔴 **NEITHER — DELETED (Samuel's ruling R-49, 2026-09-17; wave 7).** The tour, the welcome popup,
the join-request notices and the connect-agent banner are off disk, on the workspace as well as
absent from /home. This row is closed; see INVARIANTS §15.

### E-5. Two Overviews, two overview-series endpoints. One product or two?

**What is true.** `GET /api/workspaces/[slug]/overview` + `/overview-series` (container-scoped) and
`GET /api/home/overview` + `/overview-series` + `/token-spend` (account-scoped) are parallel
implementations of one idea with different payload shapes
(`workspaces/types.ts › WorkspaceOverview` L187 vs `home/overview-types.ts › HomeOverview` L249).
Home has credit breakdowns by channel / person / tool, a live agent board, token spend and a range
switcher; the workspace has a recent-activity feed and Needs-you — and Needs-you already reads the
ACCOUNT endpoint and discards most of it (**F-652, OPEN**).

**Options.**
a. **Leave them separate.** Two audiences, two questions.
b. **Port home's analytics rails to the workspace Overview**, fenced to one container.
c. **Unify the payload** behind one service with a `scope: container | account` parameter and two
   thin fences.

**Recommendation: (b) for the rails, not (c) for the payload.** The fences are genuinely different
(one is `withWorkspaceAuth`, one assembles a membership list service-side) and collapsing them is how
a container leak gets built. But "credits by channel / person / tool" is the thing a workspace admin
most obviously wants and does not have. Resolve F-652 in the same wave.

### E-6. Do Skills and Chats come to the home space? (The headline question of this document.)

**What is true.** Both are plain `workspace_id`-scoped, both work in a `personal` container today via
MCP, neither has a surface, and chats is already producing rows nothing lists (§B-1). Cost is a
surface each; no migration.

**Options.**
a. **Both.** Two new /home faces (or sections), reading the personal container. Closes the chats
   orphan class.
b. **Chats only.** It has the live defect; skills is merely absent.
c. **Neither** — and then answer what `dopl_chats(op="export")` with no `workspace=` should do
   instead (refuse? require `workspace=`?), because the orphan is real either way.
d. **Both, plus channel sharing**, which drags in `assertSharedPublishAcknowledged` for chats, which
   has never had it.

**Recommendation: (a) without (d).** Personal shelf only, no channel sharing in the first wave. It is
two mounts against modules that are already tested, already MCP-reachable and already independent of
the channel world (§D-2). ⚠ It changes the marketing hero (§D-6) and it touches the tour (§E-4).

→ 🔴 **RULED NO (Samuel, 2026-09-17) — (c), reversing the recommendation above.** Neither face lands.
⚠ Neither consequence arrived either: the hero's tab strip is unchanged at five faces, and the tour is
gone for an unrelated reason (R-49). **Confirmed and pinned in wave 7** by
`src/features/home/tabs.test.ts` — the face set plus an import scan over both /home source trees,
mutation-verified. ⚠ **THE (c) HALF IS STILL OWED**: `dopl_chats(op="export")` with no container still
files chats nothing lists, and what it should do instead has no answer. Ruling "no" did not close it.

### E-7. `dopl_workspaces(op="create_home_channel")` — the SHAPE is still owed

F-621 is **RESOLVED** on a Desktop-Agent default and its own entry says *"THE SHAPE IS WHAT NEEDS
SAMUEL, NOT WHETHER"*: the op on the orientation tool, versus a dedicated write tool, versus leaving
it app-only. The reversal is one enum member and one `WRITE_OPS` row.

**Recommendation: confirm the default.** The 450-char budget was kept (446 of 450 measured), and
`op` defaults to `list` as a fence — an op-less tool has nothing to gate, so a default that WROTE
would be a write no scope gate ever sees.

### E-8. Is the member ACTIVITY tab worth its cost?

`workspace_activity_events` carries a table, a revoked grant, a server-side filter with an
admin-only verb set, and a fail-closed path — for one tab in a console with four unit tests. In a link
container three of its verbs have no producer (§C-3). **Options:** keep as is · keep and pair the
presence rule (E-10) · retire the tab and keep the ledger for `/admin`.
**Recommendation: keep.** It is the only server-side-filtered audit surface in the product, and C-3's
reasoning says it is correctly absent from home rather than missing there. Flagged only because its
cost/coverage ratio is the worst in §A.

### E-9. Does the playground retire with the website?

18 files, 4,467 lines, zero tests, an unauthenticated provisioning route creating real `auth.users`,
a reaper cron, and three static mirror panes of surfaces this refactor is about to change.
**Options:** (a) retire with the site · (b) keep, freeze the panes · (c) keep and re-point the panes
at real components.
**Recommendation: (a).** (c) is the one to avoid — it makes a public anonymous surface depend on the
modules under refactor.

### E-10. The one members rule with no server half

`docs/MEMBERS-AUTHORIZATION.md` § *Not yet enforced server-side*: `showPresence` hides `lastSeenAt`
in the header, the facts group and the roster rows, but the column still ships in the roster payload
(`workspaces/server/dto.ts` emits it). Checked jointly with the guest column 2026-08-30; the exposed
population is `viewer` and up, not "anyone with the link". The doc calls it *"the only row in this doc
where the pairing is missing"* and *"a members-console defect and **not** a guest-lane disclosure"*.
**Options:** scrub the column per caller in the members DTO · drop the client rule · leave it.
**Recommendation: scrub it in the same wave that touches the members DTO**, and not before — it is the
kind of fix that is free while you are already in the file and expensive as its own change.

→ ✅ **DONE 2026-09-17 (wave 7, R-12(a)).** `workspaces/server/dto.ts › scrubHiddenPresence`, applied
by `› service.ts › listWorkspaceMembers`; the client rule is kept as the last line and both halves are
pinned by `members/presence-pairing.test.tsx`. This row is closed.

### E-11. Execute F-513 before anything else in this document

**What is true.** The ruling exists (§0.6-i): *"shared" is ANY channel with more than one member,
whatever kind of container it sits in — standard workspace channels included.* Three copies of the
predicate still spell it `kind === 'link' && memberCount !== 1`.

**Why it is a ruling item and not a task.** Honouring it CHANGES BEHAVIOUR on standard workspaces:
a two-member private channel in a standard workspace becomes "shared", which turns on the
container-publish acknowledgement (`assertSharedPublishAcknowledged`, today exempt for standard
containers by `shared-publish.ts` L29–35, L117) and tightens the knowledge audience ceiling
(`service-audience.ts` L112). That is the ruling's intent as written, but it is a user-visible change
on the workspace side and nobody has scheduled it.

**Options.** (a) Execute it as its own wave, before the surfaces. (b) Execute it as part of the first
surface wave. (c) Narrow the ruling to link containers, i.e. amend it.
**Recommendation: (a).** Three predicate copies, one meaning, and every §A row that reasons about
"shared" is currently reasoning about the wrong thing. Doing it first makes the surface waves smaller;
doing it after means three new surfaces are built on the spelling being replaced.

### E-12. Does the parity boundary at §0.6-iii hold?

**What is true.** `home-ontology.md › Q5` (L160) refuses a home ontology shared into a standard
workspace channel with a 400, and freezes the workspace `OntologyPage`. Ontology is the module
furthest along on both surfaces, so this is the most informed statement anybody has made about
whether the two spaces should join at all.

**Options.** (a) The boundary is general — personal-shelf resources never reach a standard workspace
channel, and §E-6 inherits it. (b) The boundary was ontology-specific and each module answers for
itself. (c) The boundary should fall.
**Recommendation: (a), stated once.** If it is general it belongs in INVARIANTS §4A as a rule rather
than in one spec's Q5, and §E-6's "without (d)" recommendation becomes a consequence rather than a
separate judgement call.

---

## F. "Do not touch" — must stay green, wave by wave

Tests and modules a parity wave must not break. Grouped by what a wave is likely to be.

### F-1. Always — the substrate, in every wave

| Keep green | Why |
| --- | --- |
| `src/features/workspaces/server/workspace-kind.test.ts` | the kind set |
| `src/features/workspaces/server/link-container-guard.test.ts` | asserts by SOURCE TEXT which paths are and are NOT gated — including that removal/departure and the bound claim stay ungated |
| `src/features/workspaces/server/resolve-active-workspace.test.ts` | header-absent → personal container, fail-closed |
| `src/features/workspaces/server/membership-admin.test.ts` | role change / removal policy |
| `src/features/workspaces/home-channel-derivation.test.ts`, `b10-no-derived-default.test.ts` | home-channel derivation |
| `src/features/workspaces/server/shared-publish.test.ts` | the container-publish ack |
| `npx tsx scripts/check-role-drift.ts` | the role set, the `/api/workspaces` row shape, **and the three copies of `isStandardWorkspace` in POSITIVE form** |
| `npx tsx scripts/check-rls-pair-gate.ts` | every `canSee*` has a named SELECT-policy twin, both directions |
| `npx tsx scripts/check-tenancy-move-gate.ts` | any migration re-stamping a parent's `workspace_id` re-stamps its children (F-664) |
| `node scripts/check-doc-refs.mjs` | this document's own anchors |
| `dopl-desktop-app/test/deep-link-target.test.mjs` | the four-file page rule (§0.2) |
| the `rls-redteam` CI job — **seven named files**, not a glob | the only gate that starts a database |

The seven redteam files (`grep -n 'rls-redteam' .github/workflows/ci.yml`, measured 2026-09-17):
`knowledge/server/rls-redteam.test.ts`, `knowledge/server/rls-redteam-personal-container.test.ts`,
`skills/server/rls-redteam.test.ts`, `chats/server/rls-redteam.test.ts`,
`agent-templates/server/rls-redteam.test.ts`, `ontology/server/rls-redteam.test.ts`,
`shared/supabase/rls-redteam-resource-grants.test.ts`.
⚠ **A suite not listed there has a live half that never executes.**

### F-2. A members / teams / admission wave

`members/activity-visibility.test.ts` · `members/components/members-v2/visibility.test.ts` ·
`members/hooks/write-configs.test.ts` · `members/lib/optimistic-cache.test.ts` ·
`teams/server/repository-resources.test.ts` · `teams/server/repository-tables.test.ts`
(⚠ L225 asserts no `team_resource_access` reference survives) ·
`apps/desktop-ui/src/pages/members/index.test.tsx` ·
`workspaces/components/{accept-invite-card,join-link-card}.test.tsx` ·
`src/app/link/[token]/claim-card.test.tsx` ·
`home/server/{service-claim-bound,service-writes-granted-role,guest-claim-f319-closure}.test.ts` ·
`apps/desktop-ui/src/pages/home/{person-info-tab-peers,home-links,panel-buttons}.test.tsx` ·
guest floor set: `src/app/api/channels/guest-route-floor.test.ts`,
`src/app/api/mcp/credits/consume/route-guest-floor.test.ts`,
`src/app/c/[workspaceId]/guest-channel.test.tsx`,
`apps/desktop-ui/src/components/app-shell/app-shell-guest.test.tsx`,
`channels/server/guest-public-channel-fence.test.ts`, `channels/client/guest-realtime-rls.test.ts`,
`ontology/server/guest-lane.test.ts` ·
`shared/supabase/rls-redteam-resource-grants.test.ts`.

⚠ **Coverage gap, stated so a wave does not mistake green for safe:** there is **no** `rls-redteam`
suite for `workspace_members`, `workspace_invitations`, `workspace_join_requests`, `teams`,
`team_members` or `workspace_activity_events`, and **no route test** under
`src/app/api/workspaces/[workspaceSlug]/members/**`.

### F-3. A chats / skills → home wave

Chats (10): `chats/server/{repository,retention,rls-redteam,service-folders,service-reads,service-reads-resolve,service-writes}.test.ts`,
`chats/lib/optimistic-cache.test.ts`, `chats/hooks/use-chat-writes.test.tsx`,
`chats/components/detail-pane.test.tsx`, `apps/desktop-ui/src/pages/chats/index.test.tsx`.
⚠ **No `src/app/api/chats/**` route tests exist.**

Skills (9): `skills/schema.test.ts`, `skills/server/{service,service-reads,service-reads-resolve,service-seed,rls-redteam}.test.ts`,
`skills/components/{create-skill-dialog,skills-browser-core}.test.*`,
`apps/desktop-ui/src/pages/skills/index.test.tsx`,
`packages/mcp-server/src/tools/acknowledge-shared-skill.test.ts`.

MCP (both): `packages/mcp-server/src/workspace-arg.test.ts` ·
`src/tools/{delete-block,parity,tool-scope-claims,tool-scope-footers,authored-body-untrusted,partial-read}.test.ts` ·
`src/tool-budget.test.ts`.

Home surface: `src/features/home/server/*.test.ts` (10) ·
`apps/desktop-ui/src/pages/home/*.test.*` (the face, wells, rows, search, skeleton and knowledge/
ontology/agent panel suites).

### F-4. Anything that touches credits, membership writes or the auth wrappers

All 30 `src/features/billing/**` tests, and specifically
`credits-service.test.ts` · `credits-link-reroute.test.ts` (the link → owner's personal wallet arm) ·
`personal-wallet.test.ts` · `credits-channel-attribution.test.ts` (rule B's forgeable-header fence) ·
`credits-unmetered.test.ts` (the fail-open posture) · `seats.test.ts` ·
`webhook-plan.test.ts` (`planFitsKind`) ·
`src/app/api/billing/{checkout,upgrade-to-team,status,…}/route.test.ts` ·
`src/app/api/mcp/credits/consume/route.test.ts` + `route-guest-floor.test.ts` ·
`packages/mcp-server/src/credits*.test.ts` ·
`apps/desktop-ui/src/pages/home/overview-credit-bar.test.tsx` + `overview-unmetered-caption.test.tsx`.

### F-5. Modules to leave alone entirely in a parity wave

`src/app/admin/**` (oldest UI, out of scope) · `src/features/get-started/**` and
`src/features/marketing/**` (retiring with the website — **except** the banner-demo import edge,
§D-6) · `src/features/analytics/**` (write paths are inside the auth wrappers) ·
`src/features/channels/**` (302 files; touch only `capabilities`, and only if §E-2 says so).

### F-5a. Absences that are PINNED BY TESTS — deleting the test deletes the ruling

Several rulings in this document are enforced as *"this control does not exist"* assertions. A wave
that adds a surface will be tempted to delete them.

* **No launch control on either Agents face** — `docs/INVARIANTS.md` (L732, L742),
  `docs/specs/home-agents-tab.plan.md` (L35, L56): the launch lane is already wired
  (relationship-record → StandaloneChannelSurface → agents-tab/composer → template-picker →
  `launchAgentOnThread`), and a second launch surface fights `resolve`'s singularity. **Pinned as an
  ABSENCE test.**
* **No `#<id>` tie-break on agent cards** — `docs/specs/agent-id-visibility.md` (L245–248,
  2026-09-15): `agentNameDiscriminators` and the `discriminator` prop existed for part of one day and
  are deleted; *the ruling removed the case rather than the display.* The raw agent id is never
  user-visible (L145, L37–49) and the 2026-08-27 `Agent #<id>` carve-out is **withdrawn**.
* **`HIDDEN_TOOLS` is empty and `RETIRED_DOPL_TOOLS` still names four deleted tools** —
  `docs/RETIREMENT-UNWIRING-PLAN.md` (L15). The empty list is the hide-before-delete seam; the retired
  names keep `UNIVERSAL_HARD_DENY` at 8, because **a name taken off a deny list becomes
  *unclassified* and falls through to `gate`.** Do not "clean up" either.
* **The arming switch for personal reach is DELETED, not disarmed** — `docs/INVARIANTS.md` (L239,
  L241): `unarmed_room` survives in the union with no producer. Same pattern as inbound consent
  (L792, L800, L814) and the session window (L1704, L1845): **delete, don't disarm** — the three
  desktop consent modules went entirely, and the inbox pane and its nav row with them.

### F-6. Definition of green

Five suites, TWO lints, TWO typechecks, TWELVE non-suite gates — CLAUDE.md § *Definition of green* and
INVARIANTS §14. `npm run test:all` chains **four suites and nothing else**; it is not the definition.
The two most-forgotten here: `npm run typecheck -w @dopl/desktop-ui` (the SPA is outside the root
tsconfig) and the committed-`dist` check (`npm run build:packages`, then
`git status --porcelain -- 'packages/*/dist/*'` — the trailing `/*` IS the gate).

---

## G. Reading list for the parity wave

In order. Paths relative to the repo root.

**Tier 0 — law, in precedence order (`code > INVARIANTS > ENGINEERING`)**

| Path | Why |
| --- | --- |
| `CLAUDE.md` | Precedence, the doc-writing rules this file obeys, the definition of green. |
| `docs/INVARIANTS.md` | **THE standing read.** §4A (L214–357) is the entire kind model; §5A (L630–786) is templates + the /home Agents face; §10 MCP; §11 sessions; §12 migrations; §14 gates. |
| `docs/ENGINEERING.md` | Archaeology. **Grep, never read wholesale** (6,721 lines). The *why* behind the reversals: the 2026-08-24 inversion (L3360), minimal copy (L2007), credit v2 (L6442), the shelf ruling (L4402), two-sections (L4436). |
| `docs/REFACTOR-FINDINGS.md` | The append-only `F-NNN` counter and every open parity blocker: **F-343, F-513**, F-467, F-471, F-621, F-652, F-678, F-327, F-061, F-710. ⚠ Allocate a new id from the highest claimed on ANY live branch, never master's. |

**Tier 1 — the home-space specs, i.e. the parity baseline**

| Path | Why |
| --- | --- |
| `docs/specs/home-ontology.md` | The most complete permission matrix in the repo (I1–I7, nine enforcement sites, R1–R12). **The template for any workspace-side parity matrix**, and the source of the §0.6-iii boundary. |
| `docs/specs/home-knowledge-panels.plan.md` | The grant model, the guest read/write lane, the audience ceiling, and the six 2026-08-26 rulings. |
| `docs/specs/home-agents-tab.plan.md` | Q1 visibility-not-grants · Q2 copy-not-FK · Q3 guests-see-nothing · Q4 no-concave · Q5 authorship marker · Q6 the two-Agents naming collision. |
| `docs/specs/guest-role.plan.md` | The role model: `guest` below `viewer`, the inverted blast radius, per-route floors, link-carried `granted_role`. |
| `docs/specs/credit-model-v2.md` | Every billing parity answer: the personal/seat split (L17–24), the attribution table (L73–78), rule B (L115–134), the atomic ledger (L163–193), v2.1 prices (L419–430). |
| `docs/specs/agent-id-visibility.md` | Agent identity, naming and addressing across three trees that cannot import each other. |
| `docs/specs/guest-web-channel.md` | The `/c/{containerId}` lane — what the home space exposes to somebody with no desktop. |

**Tier 2 — what was removed, and why the absence is load-bearing**

| Path | Why |
| --- | --- |
| `docs/RETIREMENT-UNWIRING-PLAN.md` | Canvas / Workflows / Configuration hide→delete; the soft-delete kill (trash = permanent, confirm on every destructive act, MCP deletes blocked at one choke point); the `HIDDEN_TOOLS` seam. **Tells you which absences are intentional.** |
| `docs/CHANNELS-ROLLBACK-PLAN.md` | Named agents → sessions, *"rip out, not deprecate"*: why `@handle` agent tagging, summoning, breakout rooms and the engagement window do not exist. |
| `docs/MEMBERS-AUTHORIZATION.md` | The workspace members matrix **with the Guest column** — the exact surface home has no equivalent of, and the home of §E-10. |
| `docs/specs/mcp-v2-architecture.md` | §4's B1–B11 ruling table and §5's "rulings owed" — the scheduled-retirement register. ⚠ Its B4 line disagrees with the migration; see §C-4. |
| `docs/specs/mcp-v2-wave-b.md` | Slice-by-slice execution: B13 `dopl_workspaces`, B15 the shelf → tenancy move, B16 the old channel ops. |

**Tier 3 — before writing any code**

| Path | Why |
| --- | --- |
| `docs/DESIGN-SYSTEM.md` | Mandatory for ANY UI work. Its § Conformance table (dated 2026-09-08, re-derive) is the authority for every "old recipes" verdict in §A. |
| `docs/TRACKED-DEBT.md` | S-4 globally-unique slugs is a live hazard for any new container addressing. |
| `docs/CLEANUP.md` | The rejected-candidates list — stops a wave re-deleting something already ruled kept. ⚠ Its Tier-1 table is a stale snapshot. |
| `docs/specs/workspace-parity/` | This document's siblings. **The directory was empty when this was written.** |

---

## Confidence and gaps

**High confidence** (read directly, this worktree, 2026-09-17):
the three container kinds and `isStandardWorkspace`; the eight-row `NAV` and the five `HOME_TABS`;
that /home mounts no sidebar and that only `personal` is fenced from the shell; the
`withUserAuth` vs `withWorkspaceAuth` split; the `LINK_CONTAINER_CLOSED` guard and its five call
sites; the wallet routing in `containerTarget`; that the web tree has **no** workspace app pages;
that chats and skills are plain `workspace_id`-scoped with no home surface; the DESIGN-SYSTEM
conformance table's `Todo` rows; the seven-file redteam list; the cross-feature import graph.

**Medium confidence:**
* The design-recipe verdicts. `docs/DESIGN-SYSTEM.md` § Conformance is dated **2026-09-08** and says
  to re-derive rather than trust it (`grep -rln 'FormDialog' src apps`). I re-derived the FormDialog
  set but not the full 39-row classification.
* Test *counts*. I listed files, not cases; a file's presence is not coverage. The members figure
  (37 files / 4,941 lines / 4 tests) is a file count, and it is the number that most invites a wrong
  conclusion about how safe an edit is.
* §C-5 (playground) rests on the standing website-retirement direction, which I did not find stated
  as a ruling **in this tree**. Treat it as a question, not a finding.

**Gaps — what I did not establish:**
1. **What is APPLIED in production.** §0.5. Two team migrations say "WRITTEN, NOT APPLIED"; the
   `drop_home_scoped` migration named in the wave-B spec is absent from `supabase/migrations/`
   entirely. Someone must run `npx supabase migration list --linked` before any §C conclusion is
   acted on.
2. **Runtime behaviour.** No servers, no screenshots (read-only brief, and Samuel's standing
   no-self-screenshot rule). Every claim about what a surface *renders* is read from source. The
   §E-1 claim in particular — that a non-guest member of a link container sees the full shell — is
   derived from the absence of a branch, not observed.
3. **`src/features/get-started`, `tour`, `mcp-connect`, `playground` have zero tests between them.**
   I could not bound the risk of touching them by any means other than reading them.
4. **The four sibling parity documents (01–03, 05+) did not exist** in
   `docs/specs/workspace-parity/` when this was written (the directory was empty). Where this
   document and a sibling disagree about a module, the sibling was written against the same commit
   and the disagreement is itself the finding (CLAUDE.md § *Precedence*).
5. **I did not verify that every `F-NNN` cited here is still OPEN.** F-652, F-678, F-710 read as OPEN
   in `docs/REFACTOR-FINDINGS.md` on 2026-09-17; F-621 reads RESOLVED-with-an-open-shape. **F-343,
   F-513, F-467 and F-471 are cited from the ruling sweep and I did not re-read their entries
   end to end** — F-513 in particular carries the heaviest recommendation in this document (§E-11)
   and its status line should be confirmed before that wave is scheduled. Allocate any NEW id from
   the highest claimed on ANY live branch, never from master's.
6. **The §C-4 disagreement is recorded, not filed.** `docs/specs/mcp-v2-architecture.md` (L326, L352)
   and `20260915120000_drop_agent_template_teams.sql` (L8–11) disagree about whether B4 drops
   `visibility='team'`. CLAUDE.md says that is a finding, in the same change as whoever acts on it —
   this document is read-only and did not allocate an id for it.
7. **I did not audit the two remaining "old recipe" hex offenders end to end.**
   `onboarding/components/welcome-popup.tsx` (⛔ deleted 2026-09-17, R-49) and `auth/components/password-requirements.tsx`
   (L3–9) were found by the settings sweep; a full `grep` for hardcoded hex across `src/features`
   and `apps/desktop-ui` was not run, so the `WS-RESTYLE` list in §A may be short.
