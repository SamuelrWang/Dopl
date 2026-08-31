# Members — the authorization matrix

**Measured 2026-08-30**, against a tree with exactly ONE members console.

What the members console shows, to whom, and which server rule enforces it.

**Client-side visibility decides RENDERING and nothing else.** Every row below
names the server rule that actually binds. Hiding a control is not
authorization; the pairing is the contract.

- Client: `src/features/members/components/members-v2/visibility.ts`
  (`visibilityFor`, `workspaceVisibility`), covered by `visibility.test.ts`.
- Shared policy: `src/features/workspaces/member-policy.ts` — `memberManageDenial`,
  `canGrantRole`, `canShowMemberControls`. The console imports these rather than
  restating them, so it cannot drift from server enforcement.

⚠ **THIS DOC WAS LAST TOUCHED SIX DAYS BEFORE THE GUEST ROLE EXISTED, AND HAD NO
DATE ON IT.** Both are fixed here: the stamp above, and the Guest column below.
A matrix with no measurement date reads as current forever, which is how a
column for a role that did not exist when it was written stays missing.

⚠ **THERE IS NO SECOND CONSOLE ANY MORE (2026-08-30).** The v1 members tab (five
components under `src/features/members/components/`: members-tab, member-row,
members-skeleton, pending-invitations, join-requests-banner) and the settings
modal's members section (under `src/shared/layout/settings-modal/sections/`) were
DELETED — named here in prose because the files are gone and a citation to a
deleted path is exactly what `scripts/check-doc-refs.mjs` refuses. So
`members-v2` is the console this doc describes and the only one. Rows below that
say "the console" mean that one.

## Workspace capabilities (no target)

| Surface | Owner | Admin | Member | Viewer | **Guest** | Server rule |
| --- | --- | --- | --- | --- | --- | --- |
| **Reaching the console at all** | ✔ | ✔ | ✔ | ✔ | **✖** | every members route resolves through `workspaces/server/segment.ts › resolveApiWorkspace` at its default `minRole: "viewer"`, so a guest gets the **404 a non-member gets** |
| Add member | ✔ | ✔ | ✖ | ✖ | **✖** | `workspaces/server/invitations.ts › createInvitation` opens `requireWorkspaceRole(…, "admin")` |
| Row remove / open actions | ✔ | ✔ | ✖ | ✖ | **✖** | `membership-admin.ts › removeMember` — same gate |
| Teams tab visible | ✔ | ✔ | ✔ | ✔ | **✖** | team READS take `"viewer"` (`teams/server/service.ts`) |
| Create / rename / delete team, add or remove team members | ✔ | ✔ | ✖ | ✖ | **✖** | every team WRITE in `teams/server/service.ts` takes `"admin"` |

⚠ **THE GUEST COLUMN IS ✖ BY ABSENCE, NOT BY HIDING, AND THAT MAKES IT THE ONLY
COLUMN HERE THAT NEEDS NO CLIENT HALF.** Four routes carry the roster and its
tabs — `members/route.ts`, `› [userId]/route.ts`, `› [userId]/access/route.ts`,
`› [userId]/activity/route.ts` — and every one of them takes the resolver's
INVERTED DEFAULT (`viewer`), so a guest is refused before any per-target rule is
consulted. **The floor was corrected on 2026-08-26 and it was a real hole**: the
roster route sat on membership EXISTENCE alone and handed a guest every member's
email, display name, avatar and team list, which is exactly what INVARIANTS §4A
claimed it could not. The SPA never routes a guest to the page either
(`apps/desktop-ui/src/components/app-shell/app-shell.tsx` redirects a guest to
their one channel), but that is convenience — **the 404 is the fence.**

## Per-target

| Surface | Owner/Admin → other | Anyone → SELF | Member/Viewer → other | **Guest → anyone** |
| --- | --- | --- | --- | --- |
| About (bio, facts) | visible | visible + **editable** | visible | **✖ (404)** |
| Profile edit (display name, bio) | ✖ | ✔ | ✖ | **✖ (404)** |
| Presence / last-active precision | visible | visible | **hidden** (detail header, facts group AND roster rows) | **✖ (404)** |
| Access tab | visible | visible | **hidden, and not fetched** | **✖ (404)** |
| — "No access" group | visible | **never** | n/a | **✖ (404)** |
| Activity tab | visible, full feed | visible, full feed | visible, **filtered** | **✖ (404)** |
| Settings tab | visible | visible | **hidden** | **✖ (404)** |
| — Role picker | `canShowMemberControls` ∧ `canGrantRole` | ✖ (self) | ✖ | **✖ (404)** |
| — Danger zone (remove) | `canShowMemberControls` | ✖ (self) | ✖ | **✖ (404)** |

⚠ **A GUEST HAS NO "→ SELF" LANE HERE EITHER.** The self-editable About row is
the one cell in this table a lower role would plausibly keep, and it does not
apply: the route is refused before `targetUserId === callerId` is looked at, so
a guest edits their profile from `/home`, not from a workspace console they
cannot reach.

`canShowMemberControls` is stricter than the server rule by design: never on
self, never on an owner row, and an admin may not touch another admin.

## The three rules that carry real weight

### 1. Self never receives the "no access" ENUMERATION

**What this protects, precisely.** Not resource-name secrecy —
`GET /access-matrix` (`teams/server/service.ts › getAccessMatrix`) takes
`requireWorkspaceRole(…, "viewer")` and returns every knowledge-base and skill
NAME in the workspace to any member. The team pane renders those names to any
viewer, and that is pre-existing, deliberate behaviour.

What is withheld is the **curated list of what was denied to YOU**: a member's
own access view must not come back saying "and here are the six things you were
kept out of". The inventory is public; the negative space attached to your
identity is not.

**Enforced at** `GET /api/workspaces/[slug]/members/[userId]/access` — when
`targetUserId === callerId` the route filters `level === null` rows out before
responding. A peer asking about somebody else gets 404 (member existence must
not be an oracle). The client's `showNoAccessGroup` is the second gate.

⚠ **Follow-up if tightening is wanted**: scoping resource names by reach means
changing `getAccessMatrix`, which the create-team and team panes both depend on.
Out of scope for the members wiring; not attempted.

### 2. Activity is filtered by the CALLER's access, server-side

A row is visible iff it is workspace-level (`resource_type IS NULL` — joined,
role changed: roster facts anyone can read off the members list) **or** the
caller reaches its resource at any level. `read` counts as much as `edit`: the
question is whether they may know it exists. Team events are scoped to the
caller's own team membership. Self and admins are unfiltered.

**`member.removed` and `member.invited` are ADMIN-ONLY**, whatever resource they
carry (`activity-visibility.ts › ADMIN_ONLY_VERBS`). Neither is a roster fact: a
removed member is by definition absent from the roster a peer can read, and an
invited address belongs to nobody until it is accepted. Both rows name their
subject in `metadata`, so leaking them hands a peer identities the members list
does not show.

**The filter FAILS CLOSED.** A row whose `resource_type` and `resource_id`
disagree (one null, one not) is dropped rather than treated as workspace-level.
The DB CHECK makes that unrepresentable today; the pure function is the
boundary, not the constraint.

**Enforced at** `GET /api/workspaces/[slug]/members/[userId]/activity`, which
resolves the CALLER's effective access (`computeEffectiveAccess`) and filters
through `features/members/activity-visibility.ts › filterActivity` before
answering.

⚠ **The filter must never move to the renderer.** Returning the whole feed and
hiding rows client-side puts them in the payload — readable in devtools, in the
IPC frame and in any cache that holds it.

⚠ `workspace_activity_events` has **SELECT revoked from `authenticated`**, not a
permissive RLS policy. The rule above is a computation over teams × grants ×
role ceiling and RLS cannot express it, so a policy would hand any member the
whole feed through PostgREST. Service-role reads only; that route is the one
reader.

### 3. Per-member settings stay private by column privilege

docs/INVARIANTS.md §2. The console renders **no per-member preference at all** —
there is no notification-preference storage in this product, and a switch that
persists nothing is worse than an absent one. If one is ever added it owes §2's
two edits: the DTO scrub AND omission from that migration's `GRANT` list, the
second being the one that binds PostgREST and realtime frames both.

## The table this feature owns

`workspace_activity_events` (migration `20260819130000`). Facts an INVARIANTS
entry would carry, kept here until that file is free to edit:

- **SELECT, INSERT, UPDATE, DELETE are all REVOKED from `authenticated`/`anon`.**
  RLS is enabled with **no permissive policy**, deliberately: the read filter is
  a computation over teams × grants × role ceiling, which RLS cannot express, so
  any policy would hand a member the whole feed through PostgREST. Service-role
  only; `GET /members/[userId]/activity` is the sole reader.
- **Out of `supabase_realtime`.** Nothing subscribes — the console fetches on
  open — and a published table with no subscriber costs WAL decode plus a
  per-subscription RLS evaluation on every write, forever.
- `metadata.label` is denormalized on purpose: a feed is a historical record, so
  a rename must not rewrite last month's line and a delete must not erase it.
- Writes are recorded at five choke points only (role change, removal, invite
  create, invite accept, join approval) plus the three team writes.
  `recordActivity` never throws — an observation must not fail the write it
  observed.

## Not yet enforced server-side

- **Presence withholding is cosmetic.** The console now applies `showPresence`
  to the detail header, the facts group AND the roster rows, so a peer sees no
  last-active anywhere. But `lastSeenAt` still ships in the roster payload
  (`GET /members`), because one payload feeds every row
  (`workspaces/server/dto.ts` emits it; `members/types.ts › WorkspaceMemberView`
  declares it; `members-v2/{member-rows,member-facts,member-header}.tsx` read
  it). Making it real means scrubbing the column per-caller in the members DTO.
  **The only row in this doc where the pairing is missing.**
  - ⚠ **CHECKED JOINTLY WITH THE GUEST COLUMN, 2026-08-30, AND THE ANSWER IS
    THAT THE EXPOSURE IS BOUNDED BY THE ROUTE FLOOR RATHER THAN BY THE DTO.**
    The population that can read an undisclosed `lastSeenAt` off the wire is
    **`viewer` and up**, not "anyone with the link" — the 2026-08-26 floor
    correction removed guests from it. That does not close this row: a `viewer`
    peer is still shown nothing on screen and can still read the timestamp in
    devtools, which is precisely the pairing this doc says is missing. It does
    mean the row is a members-console defect and **not** a guest-lane
    disclosure, so do not fold it into the guest work.
- **Peer access-tab suppression is belt-and-braces, not the fence.** The route
  already 404s a peer; the client simply does not ask.
