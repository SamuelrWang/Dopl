/**
 * `channel_sessions` DATA ACCESS (`repository-sessions.ts`) — the read that
 * degrades honestly, and the write that replaces a machine's whole set.
 *
 * RENAMED WITH ITS SUBJECT (F-147). Every case in this file was always about
 * session states; it lived under `repository-collab.test.ts` because the
 * functions did. They moved to their own module when the write half pushed that
 * file over the §2 cap, and the test file followed rather than leaving a name
 * that points at the wrong thing.
 *
 * F-145 — `listSessionStates` OVER A TABLE THAT DOES NOT EXIST YET.
 *
 * THE DEFECT. F-144 shipped read-session-state as a contract with a flagged
 * delivery gap and said, in four places — the repository's docblock,
 * `session-state-service`, `src/app/api/channels/sessions/route.ts`, and the
 * finding itself — that the op "returns [] live until the desktop push lands".
 * It did not. The `channel_sessions` migration is UNAPPLIED, so PostgREST
 * answered `PGRST205` ("could not find the table in the schema cache"), the raw
 * error was rethrown, `mapChannelError` has no arm for a non-domain error, and
 * the shared tail turned it into a 500 INTERNAL_ERROR. The op was broken in
 * exactly the state its own documentation described as normal.
 *
 * WHAT IS PINNED HERE is the narrowness as much as the degrade. A missing
 * relation is the one error whose honest answer is "nothing is being reported",
 * because the WRITER does not exist either. Every other failure — permission
 * denied, a column that moved, a dropped connection — means the answer is
 * UNKNOWN, and returning `[]` for those would be the same class of lie the
 * whole read-session-state design refused (F-144's "honesty over completeness":
 * the op reports what it has and never fabricates state).
 *
 * Supabase is mocked with the repository's usual chainable-builder stub, so the
 * whole `.from().select().eq()…` chain runs and the test controls only what the
 * awaited query resolves to.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { listSessionStates, replaceSessionStates } from "./repository-sessions";
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
});

describe("every OTHER failure still surfaces (an empty list is a claim)", () => {
  // Each of these means the answer is UNKNOWN, not EMPTY. Swallowing them would
  // report "no live sessions" about a database that never answered the
  // question — the exact fabrication F-144 refused to ship.
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
    // A message that merely mentions the table is not evidence of anything —
    // matching on it would swallow real faults whose text happens to name it.
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
 * F-147 — `replaceSessionStates`, THE WRITE HALF.
 *
 * Three properties, each of which is the difference between the feature and a
 * defect the read would then render as fact:
 *
 *   1. THE SCOPE IS THE CONTEXT'S. The table REVOKEs writes from `authenticated`
 *      so this runs on the RLS-bypassing admin client, which makes this function
 *      the entire fence. Every statement it issues carries `user_id` and
 *      `workspace_id`, and neither can come from a payload.
 *   2. IT REPLACES, so a row cannot outlive its pill (F-142's retention rule,
 *      inherited by the server row). Anything the report omits is deleted.
 *   3. IT WRITES ONLY WHAT CHANGED. `updated_at` is the read's ORDER BY and the
 *      "when did this session last move" the MCP result reports; touching every
 *      row on every push would make five sessions all claim to have changed when
 *      one did — plausible, and wrong, which is the failure mode the migration's
 *      own `updated_at` note describes.
 */

type Step = { op: string; args: unknown[] };

/** Chainable stub that answers a QUEUE of results — the write path issues a
 *  select, then an upsert, then a delete, and each has its own answer. */
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

/** The stored shape of a reported row — same columns, which is the point. */
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
    // The conflict target is the migration's unique index, not the ephemeral id.
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
    // By the keys the read actually saw, never a blanket delete: a row this
    // statement never looked at is not a row it gets to remove.
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
  // The read degrades PGRST205 to []; a WRITE that swallowed it would report a
  // store that did not happen. Until the migration lands this throws, the route
  // answers 500, and the desktop says so once — the true state of the world.
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
