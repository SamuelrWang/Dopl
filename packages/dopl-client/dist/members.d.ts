/**
 * Members / teams / access READ methods for `DoplClient`.
 *
 * Strictly read-only by design: membership, team, and access changes
 * are human decisions made in the Dopl web UI. These methods let an
 * agent answer "who's in this workspace, who's on which team, and who
 * can access what" — never change it.
 *
 * The membership routes are addressed by workspace slug, so every call
 * first resolves the active workspace (one extra loopback request).
 * The result is deliberately NOT cached: the active workspace can
 * change per call (X-Workspace-Id / workspaceContext), and a stale
 * segment would silently read the wrong workspace.
 */
import type { DoplTransport } from "./transport.js";
import type { AccessMatrix, EffectiveAccessRow, MyAccess, MyMembership, WorkspaceMember, WorkspaceTeam } from "./member-types.js";
export declare function getMyMembership(t: DoplTransport): Promise<MyMembership>;
export declare function listMembers(t: DoplTransport): Promise<WorkspaceMember[]>;
export declare function listTeams(t: DoplTransport): Promise<WorkspaceTeam[]>;
export declare function getAccessMatrix(t: DoplTransport): Promise<AccessMatrix>;
export declare function getMyAccess(t: DoplTransport): Promise<MyAccess>;
/**
 * A member's server-resolved effective access. Admins may ask about
 * anyone; regular members only about themselves (the server 404s other
 * targets so member existence isn't an oracle).
 */
export declare function getMemberAccess(t: DoplTransport, targetUserId: string): Promise<EffectiveAccessRow[]>;
