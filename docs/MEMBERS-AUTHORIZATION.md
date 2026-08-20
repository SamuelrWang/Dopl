# Members — the authorization matrix

What the members console shows, to whom, and which server rule enforces it.

**Client-side visibility decides RENDERING and nothing else.** Every row below
names the server rule that actually binds. Hiding a control is not
authorization; the pairing is the contract.

- Client: `src/features/members/components/members-v2/visibility.ts`
  (`visibilityFor`, `workspaceVisibility`), covered by `visibility.test.ts`.
- Shared policy: `src/features/workspaces/member-policy.ts` — `memberManageDenial`,
  `canGrantRole`, `canShowMemberControls`. The console imports these rather than
  restating them, so it cannot drift from server enforcement.

## Workspace capabilities (no target)

| Surface | Owner | Admin | Member | Viewer | Server rule |
| --- | --- | --- | --- | --- | --- |
| Add member | ✔ | ✔ | ✖ | ✖ | `workspaces/server/invitations.ts › createInvitation` opens `requireWorkspaceRole(…, "admin")` |
| Row remove / open actions | ✔ | ✔ | ✖ | ✖ | `membership-admin.ts › removeMember` — same gate |
| Teams tab visible | ✔ | ✔ | ✔ | ✔ | team READS take `"viewer"` (`teams/server/service.ts`) |
| Create / rename / delete team, add or remove team members | ✔ | ✔ | ✖ | ✖ | every team WRITE in `teams/server/service.ts` takes `"admin"` |

## Per-target

| Surface | Owner/Admin → other | Anyone → SELF | Member/Viewer → other |
| --- | --- | --- | --- |
| About (bio, facts) | visible | visible + **editable** | visible |
| Profile edit (display name, bio) | ✖ | ✔ | ✖ |
| Presence / last-active precision | visible | visible | **hidden** (detail header, facts group AND roster rows) |
| Access tab | visible | visible | **hidden, and not fetched** |
| — "No access" group | visible | **never** | n/a |
| Activity tab | visible, full feed | visible, full feed | visible, **filtered** |
| Settings tab | visible | visible | **hidden** |
| — Role picker | `canShowMemberControls` ∧ `canGrantRole` | ✖ (self) | ✖ |
| — Danger zone (remove) | `canShowMemberControls` | ✖ (self) | ✖ |

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
  (`GET /members`), because one payload feeds every row. Making it real means
  scrubbing the column per-caller in the members DTO. **The only row in this doc
  where the pairing is missing.**
- **Peer access-tab suppression is belt-and-braces, not the fence.** The route
  already 404s a peer; the client simply does not ask.
