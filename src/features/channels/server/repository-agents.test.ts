/**
 * Unit tests for the `channel_agents` repository — the QUERY SHAPE that
 * actually reaches PostgREST. Supabase is mocked with a chainable builder that
 * records every call and hands back a queued result per terminal call.
 *
 * Two contracts carry the weight here:
 *  1. The case-folded lookup. The unique index is on `(channel_id, lower(name))`
 *     but `@Quartz` arrives from a human's composer, so the needle is folded and
 *     compared with `eq` — never `ilike`, which would let `%`/`_` in a mention
 *     resolve to a different agent.
 *  2. The rename's unique-violation path. `updateAgentName` is the one write in
 *     this file that swallows 23505 into `null` (so the service maps a clean
 *     409); every other error, and every other function, still throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  findAgentById,
  findAgentByName,
  insertAgent,
  listAgentsByChannel,
  updateAgentName,
  updateAgentStatus,
} from "./repository-agents";
import { mapAgentRow, type ChannelAgentRow } from "./agents-dto";

const CHANNEL = "chan-1";
const AGENT = "agent-1";

type Call = { op: string; args: unknown[] };
type Result = { data: unknown; error: unknown };

function agentRow(name: string, status = "summoned"): ChannelAgentRow {
  return {
    id: AGENT,
    channel_id: CHANNEL,
    workspace_id: "ws-1",
    owner_user_id: "user-1",
    name,
    status,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
  };
}

/**
 * Chainable, thenable Supabase-builder stub. Non-terminal methods record and
 * return the builder; `single` / `maybeSingle` / awaiting the builder shift the
 * next queued result, so a function that runs two statements gets two answers.
 */
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findAgentByName — case-folded lookup", () => {
  it("lowercases the needle and compares with eq (never ilike)", async () => {
    const calls = makeAdmin([{ data: agentRow("quartz"), error: null }]);

    const row = await findAgentByName(CHANNEL, "Quartz");

    expect(eqFilters(calls)).toEqual({ channel_id: CHANNEL, name: "quartz" });
    // `ilike` would treat `%`/`_` in a caller-supplied mention as wildcards.
    expect(calls.some((c) => c.op === "ilike")).toBe(false);
    expect(row?.name).toBe("quartz");
  });

  it("folds a SHOUTED mention to the same row", async () => {
    const calls = makeAdmin([{ data: agentRow("basalt"), error: null }]);

    await findAgentByName(CHANNEL, "BASALT");

    expect(eqFilters(calls).name).toBe("basalt");
  });

  it("returns null for a handle nobody holds", async () => {
    makeAdmin([{ data: null, error: null }]);

    await expect(findAgentByName(CHANNEL, "nobody")).resolves.toBeNull();
  });
});

describe("findAgentById", () => {
  it("looks up by primary key only", async () => {
    const calls = makeAdmin([{ data: agentRow("onyx"), error: null }]);

    await findAgentById(AGENT);

    expect(eqFilters(calls)).toEqual({ id: AGENT });
  });
});

describe("insertAgent", () => {
  it("inserts and returns the row", async () => {
    const calls = makeAdmin([{ data: agentRow("vega"), error: null }]);

    const row = await insertAgent({
      channel_id: CHANNEL,
      workspace_id: "ws-1",
      owner_user_id: "user-1",
      name: "vega",
    });

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["channel_agents"]);
    expect(row.name).toBe("vega");
  });

  it("THROWS the raw unique violation (unlike rename, which returns null)", async () => {
    // The summon path re-picks a handle on collision, so it wants the raw error
    // shape every other channels write uses (`pgErrorCode(err) === '23505'`).
    const conflict = { code: "23505", message: "duplicate key" };
    makeAdmin([{ data: null, error: conflict }]);

    await expect(
      insertAgent({
        channel_id: CHANNEL,
        workspace_id: "ws-1",
        owner_user_id: "user-1",
        name: "vega",
      })
    ).rejects.toBe(conflict);
  });
});

describe("listAgentsByChannel", () => {
  it("lists the whole roster oldest-first, with an explicit row cap", async () => {
    const calls = makeAdmin([
      { data: [agentRow("quartz"), agentRow("onyx")], error: null },
    ]);

    const rows = await listAgentsByChannel(CHANNEL);

    expect(eqFilters(calls)).toEqual({ channel_id: CHANNEL });
    expect(calls.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: true,
    });
    // PostgREST truncates an un-limited select silently; the bound is stated.
    expect(calls.find((c) => c.op === "limit")).toBeDefined();
    expect(rows).toHaveLength(2);
  });

  it("returns [] rather than null when a channel has no agents", async () => {
    makeAdmin([{ data: null, error: null }]);

    await expect(listAgentsByChannel(CHANNEL)).resolves.toEqual([]);
  });
});

describe("updateAgentStatus", () => {
  it("patches status + updated_at and NOTHING that re-fires the workspace guard", async () => {
    const calls = makeAdmin([{ data: agentRow("flint", "parked"), error: null }]);

    await updateAgentStatus(AGENT, "parked");

    const patch = calls.find((c) => c.op === "update")?.args[0] as Record<
      string,
      unknown
    >;
    expect(patch.status).toBe("parked");
    expect(typeof patch.updated_at).toBe("string");
    // The guard trigger fires on UPDATE OF workspace_id, channel_id.
    expect(patch).not.toHaveProperty("workspace_id");
    expect(patch).not.toHaveProperty("channel_id");
    expect(eqFilters(calls)).toEqual({ id: AGENT });
  });
});

describe("updateAgentName — the unique-violation path", () => {
  it("returns the renamed row on success", async () => {
    const calls = makeAdmin([{ data: agentRow("cobalt"), error: null }]);

    const row = await updateAgentName(AGENT, "cobalt");

    const patch = calls.find((c) => c.op === "update")?.args[0] as Record<
      string,
      unknown
    >;
    expect(patch.name).toBe("cobalt");
    expect(row?.name).toBe("cobalt");
  });

  it("returns NULL on 23505 so the service can map a clean 409", async () => {
    makeAdmin([
      { data: null, error: { code: "23505", message: "duplicate key value" } },
    ]);

    await expect(updateAgentName(AGENT, "quartz")).resolves.toBeNull();
  });

  it("still THROWS every other error (a null must mean 'taken', nothing else)", async () => {
    const boom = { code: "23514", message: "check constraint violated" };
    makeAdmin([{ data: null, error: boom }]);

    await expect(updateAgentName(AGENT, "Quartz!")).rejects.toBe(boom);
  });
});

describe("mapAgentRow", () => {
  it("maps snake_case to the camelCase domain type", () => {
    expect(mapAgentRow(agentRow("juniper", "active"))).toEqual({
      id: AGENT,
      channelId: CHANNEL,
      workspaceId: "ws-1",
      ownerUserId: "user-1",
      name: "juniper",
      status: "active",
      createdAt: "2026-07-31T00:00:00Z",
      updatedAt: "2026-07-31T00:00:00Z",
    });
  });
});
