/** `replaceSessionStates`, the `channel_sessions` write. Supabase is a chainable-builder stub answering a
 *  queue, so the whole chain runs; the column-list pin is `repository-sessions-columns.test.ts`. */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { replaceSessionStates } from "./repository-sessions";
import type { SessionStateUpsert } from "./collab-dto";

const USER = "11111111-e29b-41d4-a716-446655440000";
const WS = "22222222-e29b-41d4-a716-446655440000";
const CHAN = "33333333-e29b-41d4-a716-446655440000";

/** The envelope PostgREST returns for an unknown relation; this suite requires the write to rethrow it. */
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

/** The admin client bypasses RLS, so the context's `user_id` + `workspace_id` on every statement is the
 *  fence. A row cannot outlive its report, and only changed rows are written: `updated_at` is the read's
 *  ORDER BY and the MCP "last moved" stamp. */

type Step = { op: string; args: unknown[] };

/** Chainable stub answering a queue (select, upsert, delete…). Once one answer is left it repeats, unless
 *  `repeatTail` is off (then a drained queue answers `{ data: null, error: null }`). The colour taken-set
 *  read is off the queue: identified by `.not` (no other statement here uses it), it answers `[]`. */
function makeSequencedAdmin(
  results: Array<{ data: unknown; error: unknown }>,
  { repeatTail = true } = {}
) {
  const steps: Step[] = [];
  const queue = [...results];
  const builder: Record<string, unknown> = {};
  /** Is the chain being built the colour read? Set by `.not`, cleared by `.from`. */
  let colorRead = false;
  const rec = (op: string, args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => {
      colorRead = false;
      return rec("from", [t]);
    },
    select: (c: string) => rec("select", [c]),
    upsert: (rows: unknown, opts: unknown) => rec("upsert", [rows, opts]),
    delete: () => rec("delete", []),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    neq: (c: string, v: unknown) => rec("neq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    not: (c: string, o: string, v: unknown) => {
      colorRead = true;
      return rec("not", [c, o, v]);
    },
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: unknown) => void) => {
      if (colorRead) {
        colorRead = false;
        resolve({ data: [], error: null });
        return;
      }
      resolve(repeatTail && queue.length === 1 ? queue[0] : (queue.shift() ?? { data: null, error: null }));
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return steps;
}

function reported(over: Partial<SessionStateUpsert> = {}): SessionStateUpsert {
  return {
    // Health and telemetry default to `null`, as an older desktop reports them; `over` spreads on top.
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    session_key: `${CHAN}:t-1`,
    channel_id: CHAN,
    task_id: null,
    name: "flint",
    state: "working",
    channel_name: "General",
    thread_title: null,
    detail: null, tool_label: null, model: null,
    context_used: null, context_window: null, tokens_spent: null,
    started_at: null, last_activity_at: null, identity_name: null, display_name: null,
    // Every current desktop requests a colour; a `null` default would make every stored row read as changed.
    color: "agent-01",
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
    // By column: the taken-set read's `channel_id` is an `in` too.
    const del = steps.find((s) => s.op === "in" && s.args[0] === "session_key");
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
    // By the keys the read saw, never a blanket delete.
    expect(
      steps.find((s) => s.op === "in" && s.args[0] === "session_key")?.args
    ).toEqual(["session_key", [`${CHAN}:t-1`]]);
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
    // Distinct colours, so `state` is the only difference.
    const still = reported({ session_key: `${CHAN}:a`, name: "onyx", color: "agent-02" });
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
      // Never moves mid-session, and must still count.
      { identity_name: "Code Auditor" },
    ];
    for (const over of fields) {
      const steps = makeSequencedAdmin([{ data: [storedOf(base)], error: null }]);
      await replaceSessionStates(USER, WS, [reported(over)]);
      expect(steps.some((s) => s.op === "upsert")).toBe(true);
    }
  });
});

describe("replaceSessionStates — failures are LOUD", () => {
  // The read degrades PGRST205 to []; a write that did would report a store that never happened.
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

/** A peer's running agent can re-push a `task_id` whose thread was deleted; one `23503` must not fail the
 *  whole replace. The degrade nulls only the dead ids (what `ON DELETE SET NULL` leaves) and retries once (F-241). */
describe("replaceSessionStates — a thread deleted under a live peer agent", () => {
  const DEAD = "44444444-e29b-41d4-a716-446655440000";
  const LIVE = "55555555-e29b-41d4-a716-446655440000";
  const FK = { code: "23503", message: "insert or update on table \"channel_sessions\" violates foreign key constraint" };

  /** Each awaited step takes the next answer; the tail is not repeated. */
  const makeScriptedAdmin = (results: Array<{ data: unknown; error: unknown }>) =>
    makeSequencedAdmin(results, { repeatTail: false });

  it("REPLACE SUCCEEDS when one row's task_id is dead, and only that row is nulled", async () => {
    const deadRow = reported({ session_key: `${CHAN}:${DEAD}:a1b2c3d4`, task_id: DEAD });
    const liveRow = reported({ session_key: `${CHAN}:${LIVE}:z9y8x7w6`, task_id: LIVE, name: "z9y8x7w6" });
    const steps = makeScriptedAdmin([
      { data: [], error: null }, // the reconcile read: nothing stored yet
      { data: null, error: FK }, // the upsert: the deleted thread violates the FK
      { data: [{ id: LIVE }], error: null }, // which thread ids still exist
      { data: null, error: null }, // the retry
    ]);
    const out = await replaceSessionStates(USER, WS, [deadRow, liveRow]);
    expect(out).toEqual({ stored: 2, changed: 2, removed: 0 });

    // The existence check asks `channel_tasks`, only for the ids reported.
    const probe = steps.find((s) => s.op === "in" && s.args[0] === "id");
    expect(probe?.args).toEqual(["id", [DEAD, LIVE]]);

    const upserts = steps.filter((s) => s.op === "upsert");
    expect(upserts).toHaveLength(2);
    const retried = upserts[1].args[0] as Array<Record<string, unknown>>;
    expect(retried[0].task_id).toBeNull();
    expect(retried[1].task_id).toBe(LIVE);
    // Nothing else changes: the live row keeps its thread and both keys stay.
    expect(retried.map((r) => r.session_key)).toEqual([deadRow.session_key, liveRow.session_key]);
  });

  it("a 23503 that names NO dead thread RETHROWS — it never guesses the constraint", async () => {
    // A violation on another FK (e.g. a deleted channel) cannot be fixed by nulling a thread id.
    makeScriptedAdmin([
      { data: [], error: null },
      { data: null, error: FK },
      { data: [{ id: LIVE }], error: null }, // every reported thread still exists
    ]);
    await expect(
      replaceSessionStates(USER, WS, [reported({ session_key: `${CHAN}:${LIVE}:a1b2c3d4`, task_id: LIVE })])
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("a report carrying NO thread ids rethrows without probing at all", async () => {
    const steps = makeScriptedAdmin([
      { data: [], error: null },
      { data: null, error: FK },
    ]);
    await expect(replaceSessionStates(USER, WS, [reported()])).rejects.toMatchObject({ code: "23503" });
    expect(steps.some((s) => s.op === "from" && s.args[0] === "channel_tasks")).toBe(false);
  });

  it("EVERY OTHER write error still surfaces — the degrade is one code wide", async () => {
    for (const error of [
      { code: "42501", message: "permission denied for table channel_sessions" },
      { code: "23505", message: "duplicate key value violates unique constraint" },
      { code: "PGRST205", message: "Could not find the table 'public.channel_sessions'" },
      { message: "upstream timeout" },
    ]) {
      makeScriptedAdmin([{ data: [], error: null }, { data: null, error }]);
      await expect(
        replaceSessionStates(USER, WS, [reported({ task_id: DEAD })])
      ).rejects.toBeTruthy();
    }
  });

  it("the RETRY is the last word — a second failure throws rather than looping", async () => {
    makeScriptedAdmin([
      { data: [], error: null },
      { data: null, error: FK },
      { data: [], error: null }, // the thread really is gone
      { data: null, error: { code: "23503", message: "still violating" } },
    ]);
    await expect(
      replaceSessionStates(USER, WS, [reported({ task_id: DEAD })])
    ).rejects.toMatchObject({ message: "still violating" });
  });
});
