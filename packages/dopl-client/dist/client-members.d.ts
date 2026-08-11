/**
 * Members / teams / access method group (READ-ONLY) — link 6 of the chain
 * documented in `client-base.ts`. Pure delegation to `members.ts`; no HTTP
 * here.
 *
 * Membership, team, and access changes are human decisions made in the web
 * UI — this client deliberately exposes no write path.
 */
import { ChatMethods } from "./client-chats.js";
import type { AccessMatrix, EffectiveAccessRow, MyAccess, MyMembership, WorkspaceMember, WorkspaceTeam } from "./member-types.js";
export declare class MemberMethods extends ChatMethods {
    getMyMembership(): Promise<MyMembership>;
    listWorkspaceMembers(): Promise<WorkspaceMember[]>;
    listWorkspaceTeams(): Promise<WorkspaceTeam[]>;
    getAccessMatrix(): Promise<AccessMatrix>;
    getMyAccess(): Promise<MyAccess>;
    getMemberAccess(targetUserId: string): Promise<EffectiveAccessRow[]>;
}
