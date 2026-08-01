/**
 * THE ROOM the engagement suites run in — one channel, three members, two
 * agents — shared by the STAMP suite (`service-agents-engagement.test.ts`) and
 * the CLEAR suite (`service-agents-disengage.test.ts`).
 *
 * Shared rather than copied because both halves have to agree on WHO OWNS WHAT:
 * every disengage rule is stated in terms of the owner and the engager, and the
 * stamp suite is what decides who the engager becomes. Two copies of that
 * roster is two things to drift.
 *
 * Each suite still declares its own `vi.mock(...)` calls (they are hoisted per
 * test file) and then calls {@link resetEngagementFakes} — this module only
 * says what the mocked repositories return.
 */

import { vi } from "vitest";

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import type { ChannelAgentRow } from "./agents-dto";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

export const WS = "ws-1";
export const USER = "11111111-e29b-41d4-a716-446655440000";
export const PEER = "22222222-e29b-41d4-a716-446655440000";
export const THIRD = "33333333-e29b-41d4-a716-446655440000";
export const QUARTZ = "44444444-e29b-41d4-a716-446655440000";
export const ONYX = "55555555-e29b-41d4-a716-446655440000";

/** A COOKIE-session caller: `source: "user"` is the authentication fact. */
export const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

/**
 * The same human over an AGENT TOKEN. `source` is derived from the credential
 * (`buildChannelContext`), so no field on the request can turn this back into a
 * user — which is the whole point of keying the loop brake on it.
 */
export const agentCtx: ChannelContext = { ...ctx, source: "agent" };

export function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Room",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

export function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

export function agentRow(
  overrides: Partial<ChannelAgentRow> = {}
): ChannelAgentRow {
  return {
    id: QUARTZ,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: PEER,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** `quartz` (owned by PEER) and `onyx` (owned by THIRD). */
export const AGENTS: Record<string, ChannelAgentRow> = {
  quartz: agentRow(),
  onyx: agentRow({ id: ONYX, name: "onyx", owner_user_id: THIRD }),
};

export function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 12,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-31T00:00:00Z",
  };
}

/** Wire every mocked repository to the room above. Call from `beforeEach`. */
export function resetEngagementFakes(): void {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER || userId === THIRD
      ? memberRow(userId)
      : null
  );
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoAgents.markAgentsEngaged).mockResolvedValue(undefined);
  vi.mocked(repoAgents.findAgentByName).mockImplementation(
    async (_channelId, name) => AGENTS[name.toLowerCase()] ?? null
  );
  vi.mocked(repoAgents.findAgentById).mockImplementation(
    async (id) => Object.values(AGENTS).find((a) => a.id === id) ?? null
  );
  vi.mocked(repoAgents.updateAgentStatus).mockImplementation(
    async (_id, status) => agentRow({ status })
  );
  vi.mocked(repoAgents.clearAgentEngagement).mockResolvedValue(agentRow());
  vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([agentRow()]);
}
