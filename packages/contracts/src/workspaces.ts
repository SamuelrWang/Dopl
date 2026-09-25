/**
 * Workspace and identity closed sets. Only the NAMES cross a boundary: role ranks are three
 * deliberately different scales (server `ROLE_RANK`, MCP `ROLE_ORDER` reversed for sort, SQL with
 * `guest` at -1) and none may be declared here. `isStandardWorkspace` is a runtime predicate and
 * stays out (type-only package); `scripts/check-role-drift.ts` compares what the compiler cannot reach.
 */

/**
 * Re-exported as `Role` by `src/features/workspaces/types.ts`. `guest` is link-granted only, never an
 * invitation role (server-side `InvitedRole` excludes it).
 */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer" | "guest";

/** Workspace membership lifecycle. */
export type MembershipStatus = "pending" | "active" | "revoked";

/**
 * The `workspaces.kind` column. `standard` = a user-facing workspace; `link` = a hidden home-channel
 * container (bills to the container owner's personal wallet); `home` = the Home space, one per user
 * (`/home`), holding no channels. `!isStandardWorkspace(…)` does not mean home channel — ask
 * `kind === "link"` (F-564).
 */
export type WorkspaceKind = "standard" | "link" | "home";

/**
 * `private` = the creator (and admins); `team` = teams granted through `resource_grants`
 * (scope_type 'team'); `workspace` = every active member.
 */
export type IdentityVisibility = "private" | "team" | "workspace";

/**
 * The container kind an AGENT is told, on every MCP row that names a container — not the column
 * ({@link WorkspaceKind}). Mapped in one place, `packages/mcp-server/src/workspace-directory.ts ›
 * containerKind`. `home_channel` is a wire value (no space). `home` is the Home space, where an
 * unaddressed read lands (the reserved address `home`).
 */
export type ContainerKind = "home" | "home_channel" | "workspace";
