/**
 * Members / teams / access READ methods for `DoplClient`.
 *
 * Strictly read-only by design: membership, team, and access changes are human
 * decisions made in the web UI.
 *
 * Membership routes are addressed by workspace slug, so every call first
 * resolves the active workspace (one extra loopback request). ⚠ Deliberately
 * NOT cached — the active workspace can change per call (X-Workspace-Id /
 * workspaceContext) and a stale segment silently reads the wrong workspace.
 */
import type { DoplTransport } from "./transport.js";
import type { AccessMatrix, EffectiveAccessRow, MyAccess, MyMembership, WorkspaceMember, WorkspaceTeam } from "./member-types.js";
export declare function getMyMembership(t: DoplTransport): Promise<MyMembership>;
export declare function listMembers(t: DoplTransport): Promise<WorkspaceMember[]>;
export declare function listTeams(t: DoplTransport): Promise<WorkspaceTeam[]>;
export declare function getAccessMatrix(t: DoplTransport): Promise<AccessMatrix>;
export declare function getMyAccess(t: DoplTransport): Promise<MyAccess>;
/**
 * Server-resolved effective access. Admins may ask about anyone; members only
 * about themselves — the server 404s other targets so member existence is not
 * an oracle.
 */
export declare function getMemberAccess(t: DoplTransport, targetUserId: string): Promise<EffectiveAccessRow[]>;
