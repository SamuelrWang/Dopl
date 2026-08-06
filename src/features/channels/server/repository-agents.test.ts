/**
 * `listAgentsByChannel` — the QUERY SHAPE of the one read the channels rollback kept.
 *
 * `repository-agents.ts` used to hold six writes (`insertAgent`, `updateAgentName`,
 * `updateAgentStatus`, `markAgentsEngaged`, `clearAgentEngagement`,
 * `clearEngagementByEngager`) and this read. The writes went with summoning, renaming, parking
 * and engagement (rollback §1, F-141) — and `repository-agents.test.ts` was deleted WHOLESALE
 * with them, taking the read's coverage along with the writes'. This is that half, rebuilt
 * (F-146). The service-level half is `service-agents.test.ts`.
 *
 * Supabase is mocked with the chainable builder the sibling repository suites use, so these
 * assert the filters, ordering and bound that actually reach PostgREST. Three properties, each
 * of which is load-bearing and none of which is visible from the service layer:
 *
 *   - THE ROW CAP IS EXPLICIT. PostgREST truncates an un-limited select SILENTLY at its own
 *     `max-rows` setting. A read that states its own bound fails visibly instead of quietly
 *     returning a short list, which for an attribution roster means an old message losing its
 *     handle for no reason anyone can see.
 *   - THE ORDER IS OLDEST FIRST. Attribution reads the list as a channel's history.
 *   - THE SCOPE IS THE CHANNEL, AND ONLY THE CHANNEL. This module talks to the RLS-BYPASSING
 *     service-role client, so `channel_id` is the entire fence at this layer — visibility is
 *     the service's job and the `eq` here is what keeps one channel's roster out of another's.
 *
 * Note what is deliberately NOT asserted: a `status` filter. There must not be one — dismissed
 * rows are included on purpose (see `service-agents.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { listAgentsByChannel } from "./repository-agents";
import type { ChannelAgentRow } from "./agents-dto";

const CHANNEL = "chan-1";
const OTHER_CHANNEL = "chan-2";

type Call = { op: string; args: unknown[] };

function agentRow(over: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: "agent-1",
    channel_id: CHANNEL,
    workspace_id: "ws-1",
    owner_user_id: "user-1",
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...over,
  };
}

/**
 * Chainable, thenable Supabase-builder stub: every method records its call and returns the
 * builder, and awaiting it resolves to `{ data, error }`, so the real
 * `.from().select().eq().order().limit()` chain runs with no DB.
 */
function makeAdmin(
  rows: ChannelAgentRow[],
  error: { message: string } | null = null
) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (
      resolve: (r: {
        data: ChannelAgentRow[] | null;
        error: { message: string } | null;
      }) => void
    ) => resolve({ data: error ? null : rows, error }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

const only = (calls: Call[], op: string) => calls.filter((c) => c.op === op);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAgentsByChannel — the query it actually issues", () => {
  it("reads channel_agents scoped to ONE channel, oldest first, under an explicit cap", async () => {
    const calls = makeAdmin([agentRow()]);

    await listAgentsByChannel(CHANNEL);

    expect(only(calls, "from").map((c) => c.args[0])).toEqual(["channel_agents"]);
    // The channel is the WHOLE fence at this layer — this module uses the RLS-bypassing
    // service-role client, so a missing or wrong `eq` would cross channels silently.
    expect(only(calls, "eq").map((c) => c.args)).toEqual([["channel_id", CHANNEL]]);
    expect(only(calls, "order")[0].args).toEqual([
      "created_at",
      { ascending: true },
    ]);
    // Stated, not inherited: PostgREST silently truncates an un-limited select at its own
    // `max-rows`, so the bound has to be visible here.
    const limits = only(calls, "limit");
    expect(limits).toHaveLength(1);
    expect(limits[0].args[0]).toBe(500);
  });

  it("applies NO status filter — dismissed rows are the ones attribution needs most", async () => {
    const calls = makeAdmin([
      agentRow({ id: "a-1", status: "dismissed" }),
      agentRow({ id: "a-2", status: "active" }),
    ]);

    const rows = await listAgentsByChannel(CHANNEL);

    expect(only(calls, "eq").map((c) => c.args[0])).not.toContain("status");
    expect(rows.map((r) => r.status)).toEqual(["dismissed", "active"]);
  });

  it("scopes to the channel it was given, not to a remembered one", async () => {
    const calls = makeAdmin([]);
    await listAgentsByChannel(OTHER_CHANNEL);
    expect(only(calls, "eq")[0].args).toEqual(["channel_id", OTHER_CHANNEL]);
  });

  it("a channel with no rows is an empty array, never null", async () => {
    // PostgREST answers `data: null` on some empty results, and the caller maps over this.
    makeAdmin([]);
    await expect(listAgentsByChannel(CHANNEL)).resolves.toEqual([]);

    vi.clearAllMocks();
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      from: chain,
      select: chain,
      eq: chain,
      order: chain,
      limit: chain,
      then: (resolve: (r: { data: null; error: null }) => void) =>
        resolve({ data: null, error: null }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    await expect(listAgentsByChannel(CHANNEL)).resolves.toEqual([]);
  });

  it("THROWS on a database error rather than answering an empty roster", async () => {
    // The failure mode this refuses: a swallowed error reads as "this channel never had any
    // agents", which silently unattributes every historical message instead of erroring.
    makeAdmin([], { message: "connection reset" });
    await expect(listAgentsByChannel(CHANNEL)).rejects.toMatchObject({
      message: "connection reset",
    });
  });
});

describe("repository-agents has no writes left", () => {
  it("exports exactly one function, and it is the read", async () => {
    const mod = await import("./repository-agents");
    expect(Object.keys(mod).sort()).toEqual(["listAgentsByChannel"]);
  });
});
