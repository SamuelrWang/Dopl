/**
 * WORKSPACE AND TEMPLATE CLOSED SETS — the role scale, the container kind, the
 * membership lifecycle and the template visibility axis.
 *
 * ⚠ **THE ROLE SET IS THE ONE WITH THE LONGEST DRIFT HISTORY IN THIS REPO.** It
 * was written in `src/features/workspaces/types.ts › Role`, in
 * `packages/dopl-client/src/types.ts › WorkspaceRole`, in that package's
 * committed `dist/`, and it DECIDES something in three role-keyed maps and in
 * one SQL rank function. `scripts/check-role-drift.ts` grew to 422 lines holding
 * those apart. The two TypeScript declarations are now ONE.
 *
 * ⚠ **WHAT THE COMPILER STILL CANNOT REACH, AND WHAT THE GATE THEREFORE KEEPS:**
 * `packages/mcp-server/src/tools/members-render.ts › ROLE_ORDER` / `DEFAULT_LEVEL`
 * and `src/features/teams/access-levels.ts › ROLE_DEFAULT_LEVEL` are
 * `Record<Role, …>` in SOURCE — compiler-forced — but their committed `dist/`
 * copies are not, and `public.is_workspace_member`'s `CASE` is a scale SQL states
 * on its own. Those sites are still compared by `check-role-drift.ts`.
 *
 * ⚠ **THE NUMBERS NEVER CROSS A BOUNDARY, ONLY THE NAMES.** `ROLE_RANK`
 * (server, higher = more privilege), `ROLE_ORDER` (MCP, REVERSED — it drives
 * roster sort order) and the SQL scheme (`guest` at -1) are DELIBERATELY three
 * different scales. Nothing in this package may ever declare a rank.
 *
 * ⚠ **`isStandardWorkspace` DOES NOT LIVE HERE AND MUST NOT.** It is a runtime
 * predicate, and this package is TYPE-ONLY (see `index.ts`); both copies of it —
 * and the POSITIVE-form assertion over them (INVARIANTS §4A, F-295) — stay under
 * `check-role-drift.ts › checkWorkspaceKind`.
 */

/**
 * THE WORKSPACE ROLE SET. ⚠ Named `WorkspaceRole` here and re-exported as
 * `Role` by `src/features/workspaces/types.ts` — a bare `Role` in a package that
 * also carries channel roles and ping recipients would be the ambiguous name,
 * and no consumer import changes because both trees keep their own spelling.
 *
 * ⚠ `guest` is a LINK-granted role, never an invitation role — a workspace admin
 * cannot invite somebody in as a guest, and the Add-person picker on a home
 * channel mints a link at guest. `InvitedRole` (server-side, it has no SDK twin)
 * excludes it and stays there.
 */
export type WorkspaceRole = "owner" | "admin" | "member" | "viewer" | "guest";

/** Workspace membership lifecycle. */
export type MembershipStatus = "pending" | "active" | "revoked";

/**
 * "standard" = a real user-facing workspace. "link" = a hidden home-channel
 * container holding ONE or TWO members and exactly one channel — never shown in
 * the rail/switcher, never a default-resolution candidate, and **bills to the
 * CONTAINER OWNER's plan whoever makes the call** (Samuel, 2026-08-26 —
 * `billing/server/credits-service.ts › resolveBillingTarget`; it billed each
 * side's own plan until then).
 */
export type WorkspaceKind = "standard" | "link";

/**
 * Three-way sharing scope.
 *   private   → the creator (and workspace admins) only
 *   team      → members of any team linked through `agent_template_teams`
 *   workspace → every active workspace member
 */
export type TemplateVisibility = "private" | "team" | "workspace";

