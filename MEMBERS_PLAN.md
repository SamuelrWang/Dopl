# Members Feature Plan

## Goal

Replace the static mock-data members page with a fully functional member management system. Users can view all workspace members in a flat list, invite new members via email, change roles, and remove members — all backed by the existing `workspace_members` and `workspace_invitations` tables. The overview page gets a compact members widget; the redundant settings members section is removed.

## Scope

**IN:** Flat member list with search and role filter, three assignable roles (admin, member, viewer) plus implicit owner, invite via email, change roles, remove members, pending invitations list with revoke, overview widget (avatar stack + count + "View all" link).

**OUT:** Teams (no table, no UI, no concept), per-resource access matrix (no None/Read/Edit grid), per-KB/per-skill scoping.

**REMOVING:** `src/features/members/data.ts`, `src/features/members/components/teams-pane.tsx`, `src/features/members/components/access-matrix.tsx`. The `WorkspaceMembersSection` at `src/features/workspaces/components/workspace-members-section.tsx` is removed from the overview page (replaced by the new widget) and from the settings page.

## DB Schema

The `workspace_members` and `workspace_invitations` tables exist (`supabase/migrations/20260430190046_canvases_to_workspaces.sql:75-108`). Two changes are needed:

### Migration: rename `editor` → `member`

The current CHECK constraint on `workspace_members.role` is `('owner','admin','editor','viewer')` (line 79). The `workspace_invitations.invited_role` constraint is `('admin','editor','viewer')` (line 96). Both need `editor` → `member`.

```sql
-- Rename editor → member in workspace_members + workspace_invitations.
-- Existing 'editor' rows are migrated in-place before the constraint swap.

UPDATE workspace_members SET role = 'member' WHERE role = 'editor';

ALTER TABLE workspace_members
  DROP CONSTRAINT workspace_members_role_check,
  ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner','admin','member','viewer'));

UPDATE workspace_invitations SET invited_role = 'member' WHERE invited_role = 'editor';

ALTER TABLE workspace_invitations
  DROP CONSTRAINT workspace_invitations_invited_role_check,
  ADD CONSTRAINT workspace_invitations_invited_role_check
    CHECK (invited_role IN ('admin','member','viewer'));
```

No new tables. No new columns or indexes needed — existing indexes cover every query path.

## Types (`src/features/members/types.ts`)

```ts
export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type AssignableRole = "admin" | "member" | "viewer";
export type MemberStatus = "pending" | "active" | "revoked";

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  invitedBy: string | null;
  invitedAt: string | null;
  /** Hydrated from auth.users — null if lookup fails. */
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  invitedRole: AssignableRole;
  invitedBy: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function meetsMinRole(actual: MemberRole, min: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}
```

This also means updating `src/features/workspaces/types.ts` (line 1) to change `"editor"` → `"member"` in the `Role` type, `InvitedRole` type, and `ROLE_RANK` record. Every import site that references the workspaces `Role` type with `"editor"` must be updated: `workspace-members-section.tsx` (line 20, `ROLE_LABELS`; line 26, `ASSIGNABLE_ROLES`), `src/features/workspaces/schema.ts` (line 26, `InvitationCreateSchema`), and `src/features/workspaces/server/invitations.ts` (lines 374-388, admin guard checks for `"editor"`).

## Zod Schemas (`src/features/members/schema.ts`)

```ts
import { z } from "zod";

export const InviteMemberSchema = z.object({
  email: z.string().email("Valid email required"),
  role: z.enum(["admin", "member", "viewer"]),
});
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;
```

The `RemoveMember` case needs no schema — the userId comes from the URL path param.

## Server Layer

The existing server logic lives in `src/features/workspaces/server/invitations.ts` and `src/features/workspaces/server/service.ts`. This is **already functional** — the settings members section uses it today. Rather than duplicating it into `src/features/members/server/`, the plan is:

1. **Keep** the business logic in `src/features/workspaces/server/invitations.ts` (it owns the workspace_members and workspace_invitations tables).
2. **Update** it to use `"member"` instead of `"editor"` once the migration lands.
3. **Extend** the GET members route to hydrate `displayName` and `avatarUrl` from `auth.users.raw_user_meta_data` (currently it only hydrates `email` — see `src/app/api/workspaces/[workspaceSlug]/members/route.ts:42-49`).
4. **No new repository/service/dto/errors files** in `src/features/members/` — that would violate the "no sideways feature imports" rule in reverse (members reaching into workspaces DB tables). The workspaces feature already owns these tables.

### Hydrating display name + avatar

In the existing GET members route (`src/app/api/workspaces/[workspaceSlug]/members/route.ts:40-53`), the loop calls `db.auth.admin.getUserById(m.userId)`. Extend the hydration to include:

```ts
const userData = data?.user;
emails.set(m.userId, userData?.email ?? null);
displayNames.set(m.userId, userData?.user_metadata?.display_name ?? userData?.user_metadata?.full_name ?? null);
avatarUrls.set(m.userId, userData?.user_metadata?.avatar_url ?? null);
```

This pulls from Supabase auth's `raw_user_meta_data`, which is populated by OAuth providers (Google, GitHub) or manual profile updates.

## API Routes

All routes **already exist** and are functional. Modifications needed:

| Route | Method | File | Status |
|---|---|---|---|
| `/api/workspaces/[slug]/members` | GET | `src/app/api/workspaces/[workspaceSlug]/members/route.ts` | **Modify** — add displayName + avatarUrl to response |
| `/api/workspaces/[slug]/members/[userId]` | PATCH | `src/app/api/workspaces/[workspaceSlug]/members/[userId]/route.ts` | **Modify** — update `RoleUpdateSchema` enum: `"editor"` → `"member"` (line 13) |
| `/api/workspaces/[slug]/members/[userId]` | DELETE | same file | **No change** |
| `/api/workspaces/[slug]/invitations` | GET | `src/app/api/workspaces/[workspaceSlug]/invitations/route.ts` | **No change** |
| `/api/workspaces/[slug]/invitations` | POST | same file | **No change** (uses `InvitationCreateSchema` from workspaces, which will be updated) |
| `/api/workspaces/[slug]/invitations/[id]` | DELETE | `src/app/api/workspaces/[workspaceSlug]/invitations/[id]/route.ts` | **No change** |
| `/api/workspaces/invitations/[token]/accept` | POST | `src/app/api/workspaces/invitations/[token]/accept/route.ts` | **No change** |

No new routes needed.

## Components

### Members Page (`src/features/members/components/members-view.tsx`)

**Remove:** Teams tab, `TabButton` for teams, `TEAMS` import, team count badge.
**Keep:** `PageTopBar` with "Members" title, "Add member" button in trailing slot.
**Add:** Wire "Add member" to open an `InviteDialog`.

The component becomes a single-tab shell that renders `MembersTable` directly (no tab switcher). The tab bar chrome can stay as a visual container or be replaced by a simpler header — implementation choice.

### Members Table (`src/features/members/components/members-table.tsx`)

**Remove:** Team filter dropdown, team grouping logic (`buildGroups`, `TeamPanel`), `TEAMS` import, `AccessMatrix` import and inline expand, `ChevronRight` expand toggle, team badges column.
**Keep:** Search input, role filter dropdown (update options: remove "Manager", keep Owner/Admin/Member/Viewer).
**Modify:**
- Flatten to a single list (no group panels). Sort by role rank then name.
- Replace mock `MEMBERS` import with data from `useMembers` hook.
- Replace gradient `Avatar` with real profile pics (`avatarUrl` from auth metadata), falling back to initial-based gradient.
- Grid columns: avatar+name+email | role pill (editable for admin+) | joined date | actions (remove button).
- Role change calls PATCH API and refreshes.
- "More" menu → remove member (with confirmation dialog).

### Member Bits (`src/features/members/components/member-bits.tsx`)

**Remove:** `"manager"` from `ROLE_OPTIONS` (line 10) and `ROLE_STYLE` (line 43). Update descriptions: Admin → "Full access, manage members + workspace", Member → "Use everything: KBs, skills, canvas", Viewer → "Read-only access".
**Modify:** `Avatar` component to accept `avatarUrl?: string | null` and render an `<img>` when available, falling back to the gradient initial.
**Keep:** `RolePill`, `RoleSelect`, `SelectFilter`, `TabButton` (may still be useful elsewhere).

### Invite Dialog

**New:** `src/features/members/components/invite-dialog.tsx`
Port the pattern from `src/features/workspaces/components/invite-member-dialog.tsx` (already exists — referenced at `workspace-members-section.tsx:281`). Email input + role dropdown + submit. Calls `POST /api/workspaces/[slug]/invitations`. Shows the invite link on success (email send not wired yet).

### Pending Invitations Section

**New:** `src/features/members/components/pending-invitations.tsx`
Renders below the members table when the current user is admin+. Shows email, invited role, sent date, revoke button. Same data pattern as `workspace-members-section.tsx:249-278`.

### Overview Widget

**New:** `src/features/members/components/members-widget.tsx`
- Shows: member count, first 5 avatar circles (overlapping stack), "View all →" link to `/{workspaceSlug}/members`.
- Server component — fetches member count + first 5 members' avatar URLs in the overview page server component and passes as props.
- Replaces `WorkspaceMembersSection` in `src/app/[workspaceSlug]/overview/page.tsx:50-54`.

### Files to DELETE

- `src/features/members/data.ts` — mock data, types, constants (all replaced)
- `src/features/members/components/teams-pane.tsx` — teams concept removed
- `src/features/members/components/access-matrix.tsx` — access matrix removed from v1

### Files to REMOVE from imports (not delete — they belong to workspaces feature)

- `src/features/workspaces/components/workspace-members-section.tsx` — remove from overview page (`src/app/[workspaceSlug]/overview/page.tsx:17,50-54`) and settings page (`src/app/[workspaceSlug]/settings/page.tsx`). The component itself can stay in the workspaces feature for now or be deleted if no other consumer exists.

## Hooks

### `src/features/members/hooks/use-members.ts`

```ts
// Fetches GET /api/workspaces/[slug]/members
// Returns { members, loading, error, refresh }
// Pattern: useEffect + fetch + useState (matching existing codebase — see
// sidebar.tsx:191-222 useWorkspaces for the exact pattern)
```

### `src/features/members/hooks/use-invitations.ts`

```ts
// Fetches GET /api/workspaces/[slug]/invitations
// Returns { invitations, loading, error, refresh }
// Only fetches when user is admin+ (pass canManage flag)
```

Both hooks follow the `useEffect` + `fetch` + `useState` + `tick`-based refresh pattern used in `sidebar.tsx:191-222`.

## Component Tree

```
MembersPage (server, src/app/[workspaceSlug]/members/page.tsx)
└── MembersView (client, members-view.tsx)
    ├── PageTopBar
    │   └── InviteDialog (client, invite-dialog.tsx)
    ├── MembersTable (client, members-table.tsx)
    │   ├── SearchInput
    │   ├── RoleFilter (SelectFilter from member-bits.tsx)
    │   ├── MemberRow[] (inline)
    │   │   ├── Avatar (member-bits.tsx — with avatarUrl support)
    │   │   ├── RoleSelect (member-bits.tsx)
    │   │   └── RemoveButton + ConfirmDialog
    │   └── EmptyState
    └── PendingInvitations (client, pending-invitations.tsx)
```

## Files Created / Modified / Deleted

### Phase 1: Schema + Types
- **CREATE** `supabase/migrations/YYYYMMDD_editor_to_member.sql`
- **MODIFY** `src/features/workspaces/types.ts` — `"editor"` → `"member"`
- **MODIFY** `src/features/workspaces/schema.ts` — `InvitationCreateSchema` enum
- **MODIFY** `src/features/workspaces/server/invitations.ts` — `"editor"` refs
- **CREATE** `src/features/members/types.ts`
- **CREATE** `src/features/members/schema.ts`

### Phase 2: API
- **MODIFY** `src/app/api/workspaces/[workspaceSlug]/members/route.ts` — hydrate displayName + avatarUrl
- **MODIFY** `src/app/api/workspaces/[workspaceSlug]/members/[userId]/route.ts` — update `RoleUpdateSchema`

### Phase 3: Hooks
- **CREATE** `src/features/members/hooks/use-members.ts`
- **CREATE** `src/features/members/hooks/use-invitations.ts`

### Phase 4: Components
- **MODIFY** `src/features/members/components/members-view.tsx` — remove teams tab
- **MODIFY** `src/features/members/components/members-table.tsx` — flatten, use hook, remove teams/matrix
- **MODIFY** `src/features/members/components/member-bits.tsx` — remove manager role, add avatarUrl to Avatar
- **CREATE** `src/features/members/components/invite-dialog.tsx`
- **CREATE** `src/features/members/components/pending-invitations.tsx`
- **CREATE** `src/features/members/components/members-widget.tsx`
- **DELETE** `src/features/members/data.ts`
- **DELETE** `src/features/members/components/teams-pane.tsx`
- **DELETE** `src/features/members/components/access-matrix.tsx`

### Phase 5: Wiring
- **MODIFY** `src/app/[workspaceSlug]/members/page.tsx` — pass workspaceSlug + role props
- **MODIFY** `src/app/[workspaceSlug]/overview/page.tsx` — replace `WorkspaceMembersSection` with `MembersWidget`
- **MODIFY** `src/app/[workspaceSlug]/settings/page.tsx` — remove `WorkspaceMembersSection`

## Execution Checklist

1. Write + run migration: `editor` → `member` constraint swap
2. Update `src/features/workspaces/types.ts`, `schema.ts`, `invitations.ts` for `"member"` role
3. Create `src/features/members/types.ts` and `schema.ts`
4. Modify GET members route to hydrate displayName + avatarUrl
5. Modify PATCH members route to accept `"member"` role
6. Create hooks: `use-members.ts`, `use-invitations.ts`
7. Update `member-bits.tsx`: remove manager, add avatarUrl to Avatar
8. Rewrite `members-table.tsx`: flat list, real data, no teams/matrix
9. Rewrite `members-view.tsx`: remove teams tab
10. Create `invite-dialog.tsx` and `pending-invitations.tsx`
11. Create `members-widget.tsx`
12. Wire `members/page.tsx` to pass workspace context
13. Replace `WorkspaceMembersSection` with widget on overview page
14. Remove `WorkspaceMembersSection` from settings page
15. Delete `data.ts`, `teams-pane.tsx`, `access-matrix.tsx`
16. Run `tsc --noEmit` — fix all type errors
17. Manual test: load members page, search, filter by role, invite (copy link), change role, remove member, check overview widget

## Open Questions

1. **Delete `InviteMemberDialog` from workspaces?** — `src/features/workspaces/components/invite-member-dialog.tsx` will be unused after the settings members section is removed. Safe to delete, but confirm no other consumer.
2. **Email sending** — Currently invite flow generates a token URL that the inviter copies manually. Wiring actual email send (Resend / Postmark) is a separate task. Plan assumes copy-link-only for v1.
3. **Self-role-downgrade** — Should an admin be able to demote themselves to member? Current code allows it (no guard). Flagging for product call; implementation follows whatever the answer is.
