/**
 * `channel_sessions` data access — the read that degrades honestly, and the
 * write that replaces a machine's whole set.
 *
 * ⚠ `listSessionStates` degrades ONLY `PGRST205` (relation missing from the
 * schema cache) to `[]`, because a missing relation is the one error whose
 * honest answer is "nothing is being reported" — the WRITER does not exist
 * either. Permission denied, a moved column, a dropped connection all mean the
 * answer is UNKNOWN, and `[]` for those fabricates state.
 *
 * Supabase mocked with the repository's chainable-builder stub, so the whole
 * `.from().select().eq()…` chain runs and only the awaited result is controlled.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  listChannelSessionStates,
  listSessionStates,
  replaceSessionStates,
} from "./repository-sessions";
import type { SessionStateRow, SessionStateUpsert } from "./collab-dto";

const USER = "11111111-e29b-41d4-a716-446655440000";
const WS = "22222222-e29b-41d4-a716-446655440000";
const CHAN = "33333333-e29b-41d4-a716-446655440000";

type Call = { op: string; args: unknown[] };

function row(over: Partial<SessionStateRow> = {}): SessionStateRow {
  return {
    id: "s-1",
    channel_id: CHAN,
    workspace_id: WS,
    user_id: USER,
    session_key: `${CHAN}:t-1`,
    task_id: null,
    name: "flint",
    state: "working",
    channel_name: "General",
    thread_title: null,
    created_at: "2026-08-05T00:00:00Z",
    updated_at: "2026-08-05T00:00:00Z",
    ...over,
  };
}

/** Chainable, thenable Supabase-builder stub (repository-messages.test idiom). */
function makeAdmin(result: { data: unknown; error: unknown }) {
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
    then: (resolve: (r: unknown) => void) => resolve(result),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

/** The exact envelope PostgREST returns for an unknown relation. */
const MISSING_RELATION = {
  code: "PGRST205",
  details: null,
  hint: "Perhaps you meant the table 'public.channel_members'",
  message:
    "Could not find the table 'public.channel_sessions' in the schema cache",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSessionStates — the happy path is unchanged", () => {
  it("returns the rows, scoped to the caller's own user + workspace", async () => {
    const calls = makeAdmin({ data: [row()], error: null });
    const out = await listSessionStates(USER, WS);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("flint");
    const eqs = Object.fromEntries(
      calls.filter((c) => c.op === "eq").map((c) => [c.args[0], c.args[1]])
    );
    expect(eqs).toEqual({ user_id: USER, workspace_id: WS });
    expect(calls.find((c) => c.op === "from")?.args[0]).toBe("channel_sessions");
  });

  it("narrows to one channel when asked", async () => {
    const calls = makeAdmin({ data: [], error: null });
    await listSessionStates(USER, WS, CHAN);
    const eqs = Object.fromEntries(
      calls.filter((c) => c.op === "eq").map((c) => [c.args[0], c.args[1]])
    );
    expect(eqs.channel_id).toBe(CHAN);
  });
});

describe("the table is not there yet (the UNAPPLIED migration)", () => {
  it("PGRST205 degrades to the honest empty answer, not a 500", async () => {
    makeAdmin({ data: null, error: MISSING_RELATION });
    await expect(listSessionStates(USER, WS)).resolves.toEqual([]);
  });

  it("…on the channel-narrowed read too", async () => {
    makeAdmin({ data: null, error: MISSING_RELATION });
    await expect(listSessionStates(USER, WS, CHAN)).resolves.toEqual([]);
  });

  // ⚠ THE PEER READ GETS THE SAME DEGRADE, and since 2026-08-20 it gets it from
  // the SAME helper (`sessionRowsWhere`) rather than a second copy of the branch.
  // Asserted because the sharing is the point: a future un-sharing would leave the
  // Agents tab's peer cards 500ing against an unapplied migration while the own
  // feed answered honestly, and nothing else would notice.
  it("…and on the CHANNEL-scoped peer read, from the same shared branch", async () => {
    makeAdmin({ data: null, error: MISSING_RELATION });
    await expect(listChannelSessionStates(WS, CHAN)).resolves.toEqual([]);
  });
});

describe("the peer read is CHANNEL-fenced, never user-fenced", () => {
  // ⚠ The fence is the one thing the shared helper deliberately does NOT own:
  // this read is authorized by the caller having proved channel visibility, and
  // narrowing it by `user_id` would silently empty every peer card.
  it("filters on workspace + channel and NOT on user_id", async () => {
    const calls = makeAdmin({ data: [], error: null });
    await listChannelSessionStates(WS, CHAN);
    const eqs = Object.fromEntries(
      calls.filter((c) => c.op === "eq").map((c) => [c.args[0], c.args[1]])
    );
    expect(eqs.workspace_id).toBe(WS);
    expect(eqs.channel_id).toBe(CHAN);
    expect(eqs.user_id).toBeUndefined();
  });
});

describe("every OTHER failure still surfaces (an empty list is a claim)", () => {
  // ⚠ Each means the answer is UNKNOWN, not EMPTY. Swallowing reports "no live
  // sessions" about a database that never answered.
  const realErrors: Array<[string, unknown]> = [
    ["permission denied (RLS / grant)", { code: "42501", message: "permission denied for table channel_sessions" }],
    ["a column that moved", { code: "42703", message: "column channel_sessions.state does not exist" }],
    ["a dead connection", { code: "08006", message: "connection failure" }],
    ["a PostgREST error with no code at all", { message: "upstream timeout" }],
    ["a near-miss code", { code: "PGRST204", message: "column not found" }],
    ["a plain Error", new Error("boom")],
  ];

  for (const [label, error] of realErrors) {
    it(`${label} throws`, async () => {
      makeAdmin({ data: null, error });
      await expect(listSessionStates(USER, WS)).rejects.toBeTruthy();
    });
  }

  it("the match is on the CODE, never on the message prose", async () => {
    // ⚠ Match on the CODE, not the message — text matching swallows real faults
    // whose message happens to name the table.
    makeAdmin({
      data: null,
      error: {
        code: "42501",
        message:
          "Could not find the table 'public.channel_sessions' in the schema cache",
      },
    });
    await expect(listSessionStates(USER, WS)).rejects.toBeTruthy();
  });
});

/**
 * `replaceSessionStates` — three properties:
 *   1. ⚠ SCOPE IS THE CONTEXT'S. The table REVOKEs writes from `authenticated`,
 *      so this runs on the RLS-bypassing admin client and IS the entire fence.
 *      Every statement carries `user_id` and `workspace_id`, neither from a
 *      payload.
 *   2. It REPLACES — a row cannot outlive its pill; anything the report omits
 *      is deleted.
 *   3. ⚠ It writes ONLY what changed. `updated_at` is the read's ORDER BY and
 *      the "when did this session last move" the MCP result reports; touching
 *      every row per push makes five sessions all claim to have moved.
 */

type Step = { op: string; args: unknown[] };

/** Chainable stub answering a QUEUE — the write path issues select, upsert,
 *  delete, each with its own answer. */
function makeSequencedAdmin(results: Array<{ data: unknown; error: unknown }>) {
  const steps: Step[] = [];
  const queue = [...results];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    upsert: (rows: unknown, opts: unknown) => rec("upsert", [rows, opts]),
    delete: () => rec("delete", []),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: unknown) => void) =>
      resolve(queue.length > 1 ? queue.shift() : queue[0]),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return steps;
}

function reported(over: Partial<SessionStateUpsert> = {}): SessionStateUpsert {
  return {
    session_key: `${CHAN}:t-1`,
    channel_id: CHAN,
    task_id: null,
    name: "flint",
    state: "working",
    channel_name: "General",
    thread_title: null,
    ...over,
  };
}

/** Stored shape of a reported row — same columns, which is the point. */
const storedOf = (r: SessionStateUpsert) => ({ ...r });

describe("replaceSessionStates — the scope", () => {
  it("stamps the CALLER's user + workspace on every row it writes", async () => {
    const steps = makeSequencedAdmin([{ data: [], error: null }]);
    await replaceSessionStates(USER, WS, [reported()]);
    const upsert = steps.find((s) => s.op === "upsert");
    expect(upsert).toBeTruthy();
    const rows = upsert?.args[0] as Array<Record<string, unknown>>;
    expect(rows[0].user_id).toBe(USER);
    expect(rows[0].workspace_id).toBe(WS);
    // ⚠ Conflict target is the migration's unique index, not the ephemeral id.
    expect(upsert?.args[1]).toEqual({ onConflict: "user_id,session_key" });
  });

  it("reads and deletes under the same two-column fence", async () => {
    const steps = makeSequencedAdmin([
      { data: [storedOf(reported({ session_key: `${CHAN}:gone` }))], error: null },
      { data: null, error: null },
    ]);
    await replaceSessionStates(USER, WS, []);
    for (const op of ["select", "delete"]) {
      const at = steps.findIndex((s) => s.op === op);
      const fenced = steps
        .slice(at)
        .filter((s) => s.op === "eq")
        .map((s) => s.args[0]);
      expect(fenced.slice(0, 2)).toEqual(["user_id", "workspace_id"]);
    }
    expect(steps.every((s) => s.op !== "from" || s.args[0] === "channel_sessions")).toBe(true);
  });
});

describe("replaceSessionStates — the row lifetime", () => {
  it("deletes exactly the keys the report no longer lists", async () => {
    const keep = reported({ session_key: `${CHAN}:keep` });
    const steps = makeSequencedAdmin([
      {
        data: [storedOf(keep), storedOf(reported({ session_key: `${CHAN}:gone` }))],
        error: null,
      },
      { data: null, error: null },
    ]);
    const out = await replaceSessionStates(USER, WS, [keep]);
    const del = steps.find((s) => s.op === "in");
    expect(del?.args).toEqual(["session_key", [`${CHAN}:gone`]]);
    expect(out.removed).toBe(1);
  });

  it("an EMPTY report clears the workspace — the last pill leaving is the delete", async () => {
    const steps = makeSequencedAdmin([
      { data: [storedOf(reported())], error: null },
      { data: null, error: null },
    ]);
    const out = await replaceSessionStates(USER, WS, []);
    expect(steps.some((s) => s.op === "delete")).toBe(true);
    expect(steps.some((s) => s.op === "upsert")).toBe(false);
    // ⚠ By the keys the read actually saw, never a blanket delete.
    expect(steps.find((s) => s.op === "in")?.args).toEqual([
      "session_key",
      [`${CHAN}:t-1`],
    ]);
    expect(out).toEqual({ stored: 0, changed: 0, removed: 1 });
  });

  it("writes nothing at all when the store already agrees", async () => {
    const same = reported();
    const steps = makeSequencedAdmin([{ data: [storedOf(same)], error: null }]);
    const out = await replaceSessionStates(USER, WS, [same]);
    expect(steps.some((s) => s.op === "upsert")).toBe(false);
    expect(steps.some((s) => s.op === "delete")).toBe(false);
    expect(out).toEqual({ stored: 1, changed: 0, removed: 0 });
  });

  it("writes ONLY the row that moved, so `updated_at` stays per-session", async () => {
    const still = reported({ session_key: `${CHAN}:a`, name: "onyx" });
    const moved = reported({ session_key: `${CHAN}:b` });
    const steps = makeSequencedAdmin([
      { data: [storedOf(still), storedOf({ ...moved, state: "idle" })], error: null },
    ]);
    const out = await replaceSessionStates(USER, WS, [still, moved]);
    const rows = steps.find((s) => s.op === "upsert")?.args[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.session_key)).toEqual([`${CHAN}:b`]);
    expect(out.changed).toBe(1);
  });

  it("every column the desktop reports counts as a change", async () => {
    const base = reported();
    const fields: Array<Partial<SessionStateUpsert>> = [
      { state: "idle" },
      { name: "onyx" },
      { channel_name: "Renamed" },
      { thread_title: "New title" },
      { task_id: "44444444-e29b-41d4-a716-446655440000" },
      { channel_id: "55555555-e29b-41d4-a716-446655440000" },
    ];
    for (const over of fields) {
      const steps = makeSequencedAdmin([{ data: [storedOf(base)], error: null }]);
      await replaceSessionStates(USER, WS, [reported(over)]);
      expect(steps.some((s) => s.op === "upsert")).toBe(true);
    }
  });
});

describe("replaceSessionStates — failures are LOUD", () => {
  // ⚠ The read degrades PGRST205 to []; a WRITE that swallowed it would report a
  // store that did not happen. This throws instead.
  for (const [label, at] of [["the read", 0], ["the upsert", 1]] as const) {
    it(`${label} rethrows a missing relation rather than degrading`, async () => {
      const results = [
        { data: [], error: null },
        { data: null, error: null },
      ];
      results[at] = { data: null, error: MISSING_RELATION } as never;
      makeSequencedAdmin(results);
      await expect(replaceSessionStates(USER, WS, [reported()])).rejects.toBeTruthy();
    });
  }

  it("a failing delete throws — a half-applied replace is not a success", async () => {
    makeSequencedAdmin([
      { data: [storedOf(reported({ session_key: `${CHAN}:gone` }))], error: null },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ]);
    await expect(replaceSessionStates(USER, WS, [])).rejects.toBeTruthy();
  });
});
