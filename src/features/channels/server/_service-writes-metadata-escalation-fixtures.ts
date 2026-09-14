/**
 * Shared fixtures for the two escalation suites — `service-writes-metadata-escalation.test.ts`
 * (the BUTTON door) and `service-writes-metadata-escalation-typed.test.ts` (the TYPED door),
 * split 2026-09-14 on the 500-line cap.
 *
 * ⚠ **THE `vi.mock` CALLS STAY IN EACH TEST FILE** — they are hoisted per module graph and a
 * shared module cannot declare them. This file only fills the mocks in, through
 * {@link installEscalationMocks}, so the two halves cannot drift into two different worlds.
 */
import { vi } from "vitest";

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { ESCALATION_METADATA_KEY } from "../escalation";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ProfileRef,
} from "./dto";
import type { ChannelContext } from "./service-shared";

export const WS = "ws-1";
export const USER = "11111111-e29b-41d4-a716-446655440000";
export const PEER = "22222222-e29b-41d4-a716-446655440000";
export const THIRD = "33333333-e29b-41d4-a716-446655440000";
export const ESC_ID = "44444444-e29b-41d4-a716-446655440000";

export const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};
export const peerCtx: ChannelContext = { ...ctx, userId: PEER };
export const thirdCtx: ChannelContext = { ...ctx, userId: THIRD };
export const agentCtx: ChannelContext = { ...ctx, source: "agent" };

export const ESCALATION = {
  issue: "Ship now or wait?",
  context: "It is reversible.",
  options: [
    { label: "Ship now", consequence: "Live in ten minutes." },
    { label: "Wait", consequence: "Blocked until tomorrow." },
  ],
  recommendation: { index: 0, why: "Reversible." },
};

export function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Website",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-31T00:00:00Z",
    updated_at: "2026-08-31T00:00:00Z",
    ...overrides,
  };
}

export function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-08-31T00:00:00Z",
  };
}

export function profile(id: string, name: string, email: string): ProfileRef {
  return { id, display_name: name, email, avatar_url: null };
}

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
    created_at: "2026-08-31T00:00:00Z",
  };
}

/**
 * THE STORED ESCALATION an answer names.
 *
 * `clientMsgId` carries the per-instance stamp `main/session-outbound-tag.js ›
 * nextOwnPostId` mints — ONE of the two doors the derived `agentId` comes from.
 * ⚠ The other is `metadata.session_id`, and a row may carry either or both; see
 * the BOTH-doors describe below for why reading only this one made every agent
 * that chose its own idempotency key anonymous.
 */
export function storedEscalation(
  over: Partial<ChannelMessageRow> = {},
  meta: Record<string, unknown> = {}
): ChannelMessageRow {
  return {
    id: ESC_ID,
    seq: 9,
    channel_id: "chan-1",
    workspace_id: WS,
    author_user_id: USER,
    author_kind: "agent",
    kind: "message",
    body: "**Escalation:** Ship now or wait?",
    metadata: { [ESCALATION_METADATA_KEY]: ESCALATION, ...meta },
    client_msg_id: "agent-k3wpf7c5-4",
    created_at: "2026-08-31T00:00:00Z",
    ...over,
  };
}

export function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

export function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}
/** The `beforeEach` body both suites run — one world, filled in from one place. */
export function installEscalationMocks(): void {
  // ⚠ THE AUTHOR'S OWN PROJECTION, EMPTY (2026-09-02, F-589). RR2 reads it to
  // check the `client_msg_id` agent stamp — a CALLER-SUPPLIED claim — against
  // the agents this author actually runs, so a file that leaves it unstubbed
  // reaches the real admin client and times out rather than failing.
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  // ⚠ THE ROOM'S PROJECTION, EMPTY (2026-09-02, B4). RR3 reads it for every
  // UNADDRESSED HUMAN message, so a file that leaves it unstubbed reaches the
  // real admin client and times out rather than failing. Empty = no live agent,
  // which is this file's subject: it measures the METADATA fold, not the wake.
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    [USER, PEER, THIRD].includes(userId) ? memberRow(userId) : null
  );
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER, "owner"),
    memberRow(PEER),
    memberRow(THIRD),
  ]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([
    profile(USER, "Sam Wang", "sam@example.com"),
    profile(PEER, "Diana Taylor", "diana@example.com"),
    profile(THIRD, "Daniel Anderson", "dan@example.com"),
  ]);
  vi.mocked(repoMessages.findMessageById).mockResolvedValue(
    storedEscalation()
  );
  // ⚠ THE TYPED DOOR'S TWO READS, EMPTY BY DEFAULT (2026-09-05, task 13b). Fold
  // 11b runs on every HUMAN post that is not itself a card, so an unstubbed file
  // measures a typed door that found nothing — which is the right default here:
  // every case above is about the BUTTON, and no card should be open under it.
  vi.mocked(repoMessages.listRecentEscalations).mockResolvedValue([]);
  vi.mocked(repoMessages.listAnsweredEscalationIds).mockResolvedValue(
    new Set<string>()
  );
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
    rows: [],
    truncated: false,
  });
}
