/**
 * Members / teams / access method group (READ-ONLY) — link 8 of the chain
 * documented in `client-base.ts`. Pure delegation to `members.ts`; no HTTP
 * here.
 *
 * Membership, team, and access changes are human decisions made in the web
 * UI — this client deliberately exposes no write path.
 */

import { ChatMethods } from "./client-chats.js";
import * as members from "./members.js";
import type {
  AccessMatrix,
  EffectiveAccessRow,
  MyAccess,
  MyMembership,
  WorkspaceMember,
  WorkspaceTeam,
} from "./member-types.js";

export class MemberMethods extends ChatMethods {
  getMyMembership(): Promise<MyMembership> {
    return members.getMyMembership(this.transport);
  }

  listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    return members.listMembers(this.transport);
  }

  listWorkspaceTeams(): Promise<WorkspaceTeam[]> {
    return members.listTeams(this.transport);
  }

  getAccessMatrix(): Promise<AccessMatrix> {
    return members.getAccessMatrix(this.transport);
  }

  getMyAccess(): Promise<MyAccess> {
    return members.getMyAccess(this.transport);
  }

  getMemberAccess(targetUserId: string): Promise<EffectiveAccessRow[]> {
    return members.getMemberAccess(this.transport, targetUserId);
  }
}
