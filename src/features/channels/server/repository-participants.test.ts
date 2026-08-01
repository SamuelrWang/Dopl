/**
 * Unit tests for the `channel_task_participants` repository + its DTO mapper.
 *
 * The contract under test is the IDEMPOTENT insert: joining a thread twice is a
 * no-op that returns the row already there, not a 409. That path is a
 * unique-violation catch followed by a re-find, and the re-find must key on the
 * SAME discriminated identity column the unique index does — `agent_id` for an
 * agent, `user_id` for a user. Keying on the wrong one would return null and
 * turn an idempotent join into a hard error.
 *
 * The mapper tests pin the other half: the DB CHECK makes exactly one identity
 * column non-null per `kind`, and the mapper must carry that shape through
 * rather than collapsing the two columns into one field.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  deleteParticipant,
  insertParticipant,
  listParticipantsByTask,
  listParticipantsByTasks,
} from "./repository-participants";
import {
  mapParticipantRow,
  type ThreadParticipantRow,
} from "./agents-dto";

const TASK = "660e8400-e29b-41d4-a716-446655440111";
const USER = "user-1";
const AGENT = "agent-1";

type Call = { op: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

function userRow(): ThreadParticipantRow {
  return {
    id: "p-user",
    task_id: TASK,
    workspace_id: "ws-1",
    kind: "user",
    user_id: USER,
    agent_id: null,
    added_by: "user-2",
    created_at: "2026-07-31T00:00:00Z",
  };
}

function agentParticipantRow(): ThreadParticipantRow {
  return {
    id: "p-agent",
    task_id: TASK,
    workspace_id: "ws-1",
    kind: "agent",
    user_id: null,
    agent_id: AGENT,
    added_by: USER,
    created_at: "2026-07-31T00:01:00Z",
  };
}

function makeAdmin(results: Result[]) {
  const calls: Call[] = [];
  const queue = [...results];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  const take = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return Promise.resolve(queue.shift() ?? { data: null, error: null });
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    insert: (v: unknown) => rec("insert", [v]),
    update: (v: unknown) => rec("update", [v]),
    delete: () => rec("delete", []),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    single: () => take("single", []),
    maybeSingle: () => take("maybeSingle", []),
    then: (resolve: (r: Result) => void) =>
      resolve(queue.shift() ?? { data: null, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

function eqFilters(calls: Call[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of calls) {
    if (c.op === "eq") out[String(c.args[0])] = c.args[1];
  }
  return out;
}

const CONFLICT = { code: "23505", message: "duplicate key value" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("insertParticipant — idempotent join", () => {
  it("inserts and returns the new row on the happy path", async () => {
    const calls = makeAdmin([{ data: agentParticipantRow(), error: null }]);

    const row = await insertParticipant({
      task_id: TASK,
      workspace_id: "ws-1",
      kind: "agent",
      user_id: null,
      agent_id: AGENT,
      added_by: USER,
    });

    expect(calls.find((c) => c.op === "from")?.args).toEqual([
      "channel_task_participants",
    ]);
    expect(row.id).toBe("p-agent");
    // One statement only — no re-find when nothing collided.
    expect(calls.filter((c) => c.op === "select")).toHaveLength(1);
  });

  it("on 23505 re-finds the existing AGENT row, keyed on agent_id", async () => {
    const calls = makeAdmin([
      { data: null, error: CONFLICT },
      { data: agentParticipantRow(), error: null },
    ]);

    const row = await insertParticipant({
      task_id: TASK,
      workspace_id: "ws-1",
      kind: "agent",
      user_id: null,
      agent_id: AGENT,
      added_by: USER,
    });

    expect(eqFilters(calls)).toEqual({
      task_id: TASK,
      kind: "agent",
      agent_id: AGENT,
    });
    expect(row.id).toBe("p-agent");
  });

  it("on 23505 re-finds the existing USER row, keyed on user_id", async () => {
    // The discriminated column is the whole point: keying an agent re-find on
    // user_id (or vice versa) would miss and turn a join into a hard error.
    const calls = makeAdmin([
      { data: null, error: CONFLICT },
      { data: userRow(), error: null },
    ]);

    const row = await insertParticipant({
      task_id: TASK,
      workspace_id: "ws-1",
      kind: "user",
      user_id: USER,
      agent_id: null,
      added_by: "user-2",
    });

    expect(eqFilters(calls)).toEqual({
      task_id: TASK,
      kind: "user",
      user_id: USER,
    });
    expect(row.kind).toBe("user");
  });

  it("rethrows any NON-unique error without a second statement", async () => {
    const boom = { code: "23514", message: "identity shape check violated" };
    const calls = makeAdmin([{ data: null, error: boom }]);

    await expect(
      insertParticipant({
        task_id: TASK,
        workspace_id: "ws-1",
        kind: "user",
        user_id: null,
        agent_id: null,
        added_by: null,
      })
    ).rejects.toBe(boom);

    expect(calls.filter((c) => c.op === "maybeSingle")).toHaveLength(0);
  });

  it("rethrows the original conflict when the re-find misses (raced delete)", async () => {
    makeAdmin([
      { data: null, error: CONFLICT },
      { data: null, error: null },
    ]);

    await expect(
      insertParticipant({
        task_id: TASK,
        workspace_id: "ws-1",
        kind: "agent",
        user_id: null,
        agent_id: AGENT,
        added_by: USER,
      })
    ).rejects.toBe(CONFLICT);
  });
});

describe("listParticipantsByTask", () => {
  it("scopes to the thread, orders by join time, and caps the rows", async () => {
    const calls = makeAdmin([
      { data: [userRow(), agentParticipantRow()], error: null },
    ]);

    const rows = await listParticipantsByTask(TASK);

    expect(eqFilters(calls)).toEqual({ task_id: TASK });
    expect(calls.find((c) => c.op === "order")?.args).toEqual([
      "created_at",
      { ascending: true },
    ]);
    expect(calls.find((c) => c.op === "limit")).toBeDefined();
    expect(rows).toHaveLength(2);
  });

  it("returns [] rather than null for a thread with no participant set", async () => {
    makeAdmin([{ data: null, error: null }]);

    await expect(listParticipantsByTask(TASK)).resolves.toEqual([]);
  });
});

describe("deleteParticipant", () => {
  it("removes one identity, keyed on its own discriminated column", async () => {
    const calls = makeAdmin([{ data: null, error: null }]);

    await deleteParticipant(TASK, "agent", AGENT);

    expect(calls.some((c) => c.op === "delete")).toBe(true);
    expect(eqFilters(calls)).toEqual({
      task_id: TASK,
      kind: "agent",
      agent_id: AGENT,
    });
  });

  it("is a no-op (not an error) for an identity that is not in the set", async () => {
    makeAdmin([{ data: null, error: null }]);

    await expect(deleteParticipant(TASK, "user", USER)).resolves.toBeUndefined();
  });
});

describe("mapParticipantRow — the CHECK-shaped identity", () => {
  it("maps task_id to the domain threadId (storage keeps the `task` spelling)", () => {
    expect(mapParticipantRow(userRow()).threadId).toBe(TASK);
  });

  it("a user row carries userId and a NULL agentId", () => {
    expect(mapParticipantRow(userRow())).toEqual({
      id: "p-user",
      threadId: TASK,
      workspaceId: "ws-1",
      kind: "user",
      userId: USER,
      agentId: null,
      addedBy: "user-2",
      createdAt: "2026-07-31T00:00:00Z",
    });
  });

  it("an agent row carries agentId and a NULL userId", () => {
    expect(mapParticipantRow(agentParticipantRow())).toEqual({
      id: "p-agent",
      threadId: TASK,
      workspaceId: "ws-1",
      kind: "agent",
      userId: null,
      agentId: AGENT,
      addedBy: USER,
      createdAt: "2026-07-31T00:01:00Z",
    });
  });

  it("keeps the two identity columns separate rather than collapsing them", () => {
    // A single `identityId` field would make every caller re-derive which kind
    // it is holding — the exact ambiguity the DB CHECK exists to remove.
    const mapped = mapParticipantRow(agentParticipantRow());
    expect(Object.keys(mapped)).toContain("userId");
    expect(Object.keys(mapped)).toContain("agentId");
  });
});

/**
 * The BATCH read behind the thread list. It exists so a channel with N threads
 * costs one query instead of N — the web polls that list, so an N+1 there is an
 * N+1 on a hot path.
 */
describe("listParticipantsByTasks — grouped batch read", () => {
  const OTHER_TASK = "660e8400-e29b-41d4-a716-446655440222";

  it("groups rows by thread id, preserving join order", async () => {
    const calls = makeAdmin([
      {
        data: [
          userRow(),
          agentParticipantRow(),
          { ...userRow(), id: "p-other", task_id: OTHER_TASK },
        ],
        error: null,
      },
    ]);

    const grouped = await listParticipantsByTasks([TASK, OTHER_TASK]);

    expect(calls.find((c) => c.op === "in")?.args).toEqual([
      "task_id",
      [TASK, OTHER_TASK],
    ]);
    expect(grouped.get(TASK)?.map((r) => r.id)).toEqual(["p-user", "p-agent"]);
    expect(grouped.get(OTHER_TASK)?.map((r) => r.id)).toEqual(["p-other"]);
  });

  it("omits a thread with no participants (the caller renders [])", async () => {
    makeAdmin([{ data: [userRow()], error: null }]);

    const grouped = await listParticipantsByTasks([TASK, OTHER_TASK]);

    expect(grouped.has(OTHER_TASK)).toBe(false);
  });

  it("short-circuits an empty id list — no round trip that can only return nothing", async () => {
    makeAdmin([]);

    await expect(listParticipantsByTasks([])).resolves.toEqual(new Map());
    expect(supabaseAdmin).not.toHaveBeenCalled();
  });
});
