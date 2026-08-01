/**
 * THE FAKE TABLES behind the two-agent handshake suites
 * (`service-tasks-handshake.test.ts`, `service-tasks-handshake-room.test.ts`).
 *
 * Not stubs. `channel_tasks`, `channel_messages` and `channel_task_participants`
 * are backed by in-memory arrays that enforce the same unique indexes production
 * does: a duplicate `client_msg_id` raises 23505, and a duplicate participant
 * identity converges on the row already there. That is what lets two
 * `createTask` calls actually RACE under `Promise.all` — both pass the
 * pre-insert lookup, one wins the insert, the other takes the 23505 path — as
 * opposed to a test that sequences them and then asserts about a race it never
 * ran.
 *
 * Shared rather than copied because the harness is the expensive part and two
 * copies of a fake index is two things to drift. Each suite still declares its
 * own `vi.mock(...)` calls (they are hoisted per test file) and then calls
 * {@link resetFakes} — this module only says what the mocked repositories DO.
 */

import { vi } from "vitest";

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import * as reads from "./service-reads";
import { createTask } from "./service-tasks";
import type { ChannelContext } from "./service-shared";
import type { ChannelAgentRow, ThreadParticipantRow } from "./agents-dto";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";

export const WS = "ws-1";
export const CHAN = "11111111-e29b-41d4-a716-446655440000";
export const HUMAN = "aaaaaaaa-e29b-41d4-a716-446655440000";
export const OWNER_A = "bbbbbbbb-e29b-41d4-a716-446655440000";
export const OWNER_B = "cccccccc-e29b-41d4-a716-446655440000";
export const STRANGER = "ffffffff-e29b-41d4-a716-446655440000";
export const QUARTZ = "dddddddd-e29b-41d4-a716-446655440000";
export const ONYX = "eeeeeeee-e29b-41d4-a716-446655440000";

/** The instruction's seq, and the key THE LAW tells both agents to derive. */
export const TRIGGER_SEQ = 7;
export const HANDSHAKE_KEY = `thread-open-${CHAN}-${TRIGGER_SEQ}`;

export function ctxFor(userId: string): ChannelContext {
  return { workspaceId: WS, userId, source: "agent", role: "member" };
}

export const ctxA = ctxFor(OWNER_A);
export const ctxB = ctxFor(OWNER_B);

function channelRow(): ChannelRow {
  return {
    id: CHAN,
    workspace_id: WS,
    created_by: HUMAN,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: CHAN,
    user_id: userId,
    workspace_id: WS,
    role: userId === HUMAN ? "owner" : "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: HUMAN,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: QUARTZ,
    channel_id: CHAN,
    workspace_id: WS,
    owner_user_id: OWNER_A,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** The human's one instruction: "@quartz @onyx work together on X". */
export function instruction(): ChannelMessageRow {
  return {
    id: "msg-7",
    seq: TRIGGER_SEQ,
    channel_id: CHAN,
    workspace_id: WS,
    author_user_id: HUMAN,
    author_kind: "user",
    kind: "message",
    body: "@quartz @onyx work together on X",
    // Server-stamped when the human posted it — a caller cannot write this key.
    metadata: { to_agent_ids: [QUARTZ, ONYX], to_agent_id: QUARTZ },
    client_msg_id: null,
    created_at: "2026-07-31T00:00:00Z",
  };
}

// ─── The fake tables ────────────────────────────────────────────────────────

/**
 * `channel_tasks`, with the partial unique index on (channel_id, client_msg_id).
 * The column is on the table but not on {@link ChannelTaskRow} (nothing in the
 * domain reads it back), so the fake carries it alongside.
 */
type StoredTask = ChannelTaskRow & { client_msg_id: string | null };
export const tasks: StoredTask[] = [];
/** `channel_messages`, with the unique index on (channel_id, client_msg_id). */
export const messages: ChannelMessageRow[] = [];
/** `channel_task_participants`, with its (task_id, kind, identity) unique index. */
export const participants: ThreadParticipantRow[] = [];
/** Membership, so a test can evict someone. */
let members = new Set<string>();

function uniqueViolation(): { code: string } {
  return { code: "23505" };
}

function identityOf(row: { kind: string; user_id: string | null; agent_id: string | null }) {
  return row.kind === "agent" ? row.agent_id : row.user_id;
}

export function installFakes() {
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    members.has(uid) ? memberRow(uid) : null
  );
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.pgErrorCode).mockImplementation(
    (err) => (err as { code?: string } | null)?.code ?? null
  );
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );

  vi.mocked(repoAgents.findAgentById).mockImplementation(async (id) =>
    id === QUARTZ
      ? agentRow()
      : id === ONYX
        ? agentRow({ id: ONYX, name: "onyx", owner_user_id: OWNER_B })
        : null
  );
  vi.mocked(repoAgents.markAgentsEngaged).mockResolvedValue(undefined);

  vi.mocked(repoMessages.findMessageBySeq).mockImplementation(async (_c, seq) =>
    seq === TRIGGER_SEQ ? instruction() : null
  );
  vi.mocked(repoMessages.findMessageByClientId).mockImplementation(
    async (_c, key) => messages.find((m) => m.client_msg_id === key) ?? null
  );
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => {
    if (
      row.client_msg_id &&
      messages.some((m) => m.client_msg_id === row.client_msg_id)
    ) {
      throw uniqueViolation();
    }
    const stored: ChannelMessageRow = {
      id: `msg-${messages.length + 1}`,
      // The instruction already occupies TRIGGER_SEQ.
      seq: TRIGGER_SEQ + messages.length + 1,
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
    messages.push(stored);
    return stored;
  });

  vi.mocked(repoTasks.findTaskByClientId).mockImplementation(
    async (_c, key) => tasks.find((t) => t.client_msg_id === key) ?? null
  );
  vi.mocked(repoTasks.findTaskByChannelAndId).mockImplementation(
    async (_c, id) => tasks.find((t) => t.id === id) ?? null
  );
  vi.mocked(repoTasks.insertTask).mockImplementation(async (row) => {
    if (
      row.client_msg_id &&
      tasks.some((t) => t.client_msg_id === row.client_msg_id)
    ) {
      throw uniqueViolation();
    }
    const stored: StoredTask = {
      id: `${tasks.length + 1}0000000-e29b-41d4-a716-446655440999`,
      channel_id: row.channel_id,
      workspace_id: row.workspace_id,
      title: row.title,
      status: "open",
      outcome: null,
      mode: row.mode,
      created_by: row.created_by,
      target_user_id: row.target_user_id,
      created_at: "2026-07-31T00:00:00Z",
      updated_at: "2026-07-31T00:00:00Z",
      closed_at: null,
      outcome_summary: null,
      client_msg_id: row.client_msg_id ?? null,
    };
    tasks.push(stored);
    return stored;
  });

  vi.mocked(repoParticipants.insertParticipant).mockImplementation(
    async (row) => {
      const existing = participants.find(
        (p) =>
          p.task_id === row.task_id &&
          p.kind === row.kind &&
          identityOf(p) === identityOf(row)
      );
      // Idempotent on the unique index, exactly as the repository is.
      if (existing) return existing;
      const stored: ThreadParticipantRow = {
        id: `p-${participants.length + 1}`,
        task_id: row.task_id,
        workspace_id: row.workspace_id,
        kind: row.kind,
        user_id: row.user_id,
        agent_id: row.agent_id,
        added_by: row.added_by,
        created_at: "2026-07-31T00:00:00Z",
      };
      participants.push(stored);
      return stored;
    }
  );
  vi.mocked(repoParticipants.findParticipant).mockImplementation(
    async (taskId, kind, id) =>
      participants.find(
        (p) => p.task_id === taskId && p.kind === kind && identityOf(p) === id
      ) ?? null
  );
  vi.mocked(repoParticipants.listParticipantsByTask).mockImplementation(
    async (taskId) => participants.filter((p) => p.task_id === taskId)
  );
  vi.mocked(repoParticipants.listParticipantsByTasks).mockResolvedValue(
    new Map()
  );
}

/** What one agent's machine sends when it decides to open the thread. */
export function open(ctx: ChannelContext, clientMsgId?: string) {
  return createTask(ctx, "general", {
    title: "Work together on X",
    body: "The operator asked us to work together on X.",
    toUserId: HUMAN,
    ...(clientMsgId ? { clientMsgId } : {}),
  });
}

/** Every identity in a thread's set, as `kind:id` strings. */
export function setOf(taskId: string): string[] {
  return participants
    .filter((p) => p.task_id === taskId)
    .map((p) => `${p.kind}:${identityOf(p)}`);
}

/** The opening messages that actually landed for a thread. */
export function openingsFor(taskId: string): ChannelMessageRow[] {
  return messages.filter((m) => m.client_msg_id === `task-open-${taskId}`);
}

/** Empty every fake table and re-install the mocks. Call it in `beforeEach`. */
export function resetFakes(): void {
  vi.clearAllMocks();
  tasks.length = 0;
  messages.length = 0;
  participants.length = 0;
  members = new Set([HUMAN, OWNER_A, OWNER_B, STRANGER]);
  // The human's instruction is already in the transcript at TRIGGER_SEQ — it is
  // what woke both agents, and what the handshake key names.
  messages.push(instruction());
  installFakes();
}
