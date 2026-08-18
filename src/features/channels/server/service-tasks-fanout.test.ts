/**
 * THE REQUEST FAN-OUT — N pills, N `channel_tasks` rows, ONE card.
 *
 * ⚠ THE TEST THIS FILE EXISTS FOR is the row COUNT. `channel_tasks` carries a
 * partial unique index on `(channel_id, client_msg_id)`, so a fan-out that mints
 * ONE key for N addressees does not fail — rows 2..N converge on row 1 through
 * `createTask`'s short-circuit, every call returns a thread, and the request
 * silently reaches exactly one person. There is no error to catch and no log to
 * read: the count is the only witness. Mutation-verify by collapsing
 * `addresseeClientMsgId` to `base` — "three pills insert three rows" must go
 * red.
 *
 * The second half is the GROUP ID: derived, never minted per attempt, because a
 * retried fan-out that re-mints splits one request across two cards.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as reads from "./service-reads";
import {
  addresseeClientMsgId,
  createTaskFanOut,
  fanoutGroupId,
} from "./service-tasks-fanout";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const A = "bbbbbbbb-e29b-41d4-a716-446655440000";
const B = "cccccccc-e29b-41d4-a716-446655440000";
const C = "dddddddd-e29b-41d4-a716-446655440000";
const BASE = "base-key-1";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: userId === USER ? "owner" : "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-08-18T00:00:00Z",
  };
}

/**
 * A stable UUID per addressee. ⚠ Must be a real UUID: `resolvePostMetadata`
 * routes a non-UUID `taskId` down the LEGACY branch, where it is stripped — and
 * a stripped tag takes the group stamp with it.
 */
const TASK_IDS: Record<string, string> = {
  [A]: "11111111-e29b-41d4-a716-446655440000",
  [B]: "22222222-e29b-41d4-a716-446655440000",
  [C]: "33333333-e29b-41d4-a716-446655440000",
};

/** Every insert becomes a row, so the mock IS the table for this test. */
function insertedTask(
  row: Parameters<typeof repoTasks.insertTask>[0]
): ChannelTaskRow {
  return {
    id: TASK_IDS[row.target_user_id ?? ""] ?? "44444444-e29b-41d4-a716-446655440000",
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    title: row.title,
    status: "open",
    outcome: null,
    mode: row.mode,
    created_by: row.created_by,
    target_user_id: row.target_user_id,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
  };
}

const input = (toUserIds: string[]) => ({
  title: "Sweep the docs",
  body: "start here",
  toUserIds,
  clientMsgId: BASE,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    memberRow(uid)
  );
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER),
    memberRow(A),
    memberRow(B),
    memberRow(C),
  ]);
  // ⚠ THE MOCK SIMULATES THE PARTIAL UNIQUE INDEX on
  // `(channel_id, client_msg_id)`. Without it a shared key would still "insert"
  // N rows here and the count assertion would pass on a broken fan-out — the
  // convergence IS the failure mode, so the fake table has to converge too.
  const stored = new Map<string, ChannelTaskRow>();
  vi.mocked(repoTasks.findTaskByClientId).mockImplementation(
    async (_c, key) => stored.get(key) ?? null
  );
  vi.mocked(repoTasks.insertTask).mockImplementation(async (row) => {
    const key = row.client_msg_id;
    if (key && stored.has(key)) return stored.get(key)!;
    const created = insertedTask(row);
    if (key) stored.set(key, created);
    return created;
  });
  // The metadata fold re-reads the row a `taskId` names.
  vi.mocked(repoTasks.findTaskByChannelAndId).mockImplementation(
    async (_c, id) =>
      ({
        ...insertedTask({
          channel_id: "chan-1",
          workspace_id: WS,
          title: "Sweep the docs",
          mode: "interactive",
          created_by: USER,
          target_user_id: A,
          client_msg_id: null,
        }),
        id,
      }) as ChannelTaskRow
  );
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({
    id: `msg-${row.client_msg_id}`,
    seq: 1,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-08-18T00:00:00Z",
  }));
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("createTaskFanOut — N addressees are N rows", () => {
  it("THREE pills insert THREE channel_tasks rows, under three distinct keys", async () => {
    const { threads } = await createTaskFanOut(ctx, "chan-1", input([A, B, C]));

    expect(repoTasks.insertTask).toHaveBeenCalledTimes(3);
    expect(threads).toHaveLength(3);

    const keys = vi
      .mocked(repoTasks.insertTask)
      .mock.calls.map(([row]) => row.client_msg_id);
    // ⚠ THE WHOLE POINT. A shared key here is not an error — it is three calls
    // converging on one row and a request that reached one person.
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([
      addresseeClientMsgId(BASE, A),
      addresseeClientMsgId(BASE, B),
      addresseeClientMsgId(BASE, C),
    ]);
  });

  it("addresses each row to its OWN target, in pill order", async () => {
    await createTaskFanOut(ctx, "chan-1", input([A, B, C]));

    const targets = vi
      .mocked(repoTasks.insertTask)
      .mock.calls.map(([row]) => row.target_user_id);
    expect(targets).toEqual([A, B, C]);
  });

  it("collapses a duplicated addressee rather than reporting it twice", async () => {
    const { threads } = await createTaskFanOut(ctx, "chan-1", input([A, B, A]));

    expect(repoTasks.insertTask).toHaveBeenCalledTimes(2);
    expect(threads).toHaveLength(2);
  });

  it("gives every thread of one send the SAME group id, on the opening message", async () => {
    const { groupId } = await createTaskFanOut(ctx, "chan-1", input([A, B, C]));

    const stamped = vi
      .mocked(repoMessages.insertMessage)
      .mock.calls.map(([row]) => (row.metadata as Record<string, unknown>).fanoutGroup);
    expect(stamped).toEqual([groupId, groupId, groupId]);
    // Derived, not random — the value is reproducible from what the caller sent.
    expect(groupId).toBe(fanoutGroupId(USER, BASE));
  });

  it("a RETRY reproduces the same group id rather than minting a second card", async () => {
    const first = await createTaskFanOut(ctx, "chan-1", input([A, B]));
    const second = await createTaskFanOut(ctx, "chan-1", input([A, B]));

    // ⚠ The failure this guards: a `randomUUID()` per call would leave the
    // threads that landed on attempt 1 in one card and the rest in another.
    expect(second.groupId).toBe(first.groupId);
  });

  it("two members cannot collide on one group id from the same base key", () => {
    expect(fanoutGroupId(USER, BASE)).not.toBe(fanoutGroupId(A, BASE));
  });
});
