/** The staged workspace reads the knowledge face makes besides knowledge: teams, access, a channel's roster. */
import type { ChannelMember } from "@/features/channels/types";
import type { TeamView } from "@/features/teams/types";
import { CHANNEL_ROSTERS } from "../data";
import { knowledgeDb } from "../fake-store";

export function teams(): { teams: TeamView[] } {
  return { teams: knowledgeDb().teams.map((t) => ({ ...t })) };
}

/** The operator owns or administers everything staged, so every resource resolves to `edit`. */
export function myAccess(): { defaultLevel: "edit"; overrides: [] } {
  return { defaultLevel: "edit", overrides: [] };
}

/** Only `workspaceRole` and the name fields are read by the face; the rest is filled neutrally. */
export function channelMembers(channelId: string): { members: ChannelMember[] } {
  return {
    members: (CHANNEL_ROSTERS[channelId] ?? []).map(
      (m) =>
        ({
          channelId,
          userId: m.userId,
          role: m.workspaceRole === "owner" ? "owner" : "member",
          workspaceRole: m.workspaceRole,
          lastReadAt: null,
          notifyScope: null,
          agentToolProfile: null,
          myFavoritedAt: null,
          agentOnline: false,
          lastSeenAt: null,
          addedBy: null,
          joinedAt: "2026-09-01T00:00:00.000Z",
          displayName: m.displayName,
          email: null,
          avatarUrl: null,
        }) as unknown as ChannelMember
    ),
  };
}
