/**
 * `replaceSessionStates` — THE WRITE HALF of `channel_sessions` data access.
 *
 * ⚠ **SPLIT OUT OF `repository-sessions.test.ts` ON 2026-09-01, AT THE 500-LINE
 * CAP** (§1), when the health seven joined every fixture in both halves. The
 * seam is the one the file already had a blank line and a second set of helpers
 * at: that file drives the READ (the honest `PGRST205` degrade, the two fences),
 * this one drives the REPLACE (scope, row lifetime, the diff, and the F-241
 * thread-deleted degrade). Different builder stub, different failure mode,
 * different thing to read when it goes red.
 *
 * ⚠ THE COLUMN-LIST PIN IS A THIRD FILE AGAIN — `repository-sessions-columns.test.ts`
 * reads `repository-sessions-columns.ts`'s SOURCE TEXT. Nothing here duplicates
 * it: this suite drives BEHAVIOUR through a mocked client.
 *
 * Supabase mocked with the repository's chainable-builder stub, so the whole
 * `.from().select().eq()…` chain runs and only the awaited result is controlled.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { replaceSessionStates } from "./repository-sessions";
import type { SessionStateUpsert } from "./collab-dto";

const USER = "11111111-e29b-41d4-a716-446655440000";
const WS = "22222222-e29b-41d4-a716-446655440000";
const CHAN = "33333333-e29b-41d4-a716-446655440000";

/** The exact envelope PostgREST returns for an unknown relation. ⚠ A DELIBERATE
 *  copy of the read half's — the two suites assert OPPOSITE things about it
 *  (`repository-sessions.test.ts` degrades it to `[]`, this one requires the
 *  write to RETHROW), and a shared fixture would let one suite's edit quietly
 *  change what the other is testing. */
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
    // ⚠ The HEALTH seven default to `null` — what a desktop older than
    // `20260909120000` reports, which is what most live rows still are.
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
    // ⚠ EVERY TELEMETRY COLUMN, EXPLICITLY `null` — what a machine reporting
    // nothing produces (2026-08-22). `over` spreads on top, so a case can say
    // "only tokens_spent moved".
    detail: null, tool_label: null, model: null,
    context_used: null, context_window: null, tokens_spent: null,
    started_at: null, last_activity_at: null, template_name: null, display_name: null,
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
      // ⚠ Never moves mid-session, and must still COUNT — see the column pin.
      { template_name: "Code Auditor" },
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

/**
 * F-241 — ONE DEAD `task_id` MUST NOT POISON THE WHOLE REPLACE.
 *
 * A thread can be deleted while a PEER's machine is still running an agent on
 * it: that agent is not reachable from any server (it stops on its own
 * idle/abandon timer), so its next push re-inserts a `task_id` whose
 * `channel_tasks` row is gone. The upsert is ONE statement over the changed
 * set, so a single `23503` used to fail `reportSessionStates` entirely — that
 * operator's every OTHER session stopped being reported and their peer cards
 * went stale workspace-wide, for a thread somebody deleted on purpose.
 *
 * The degrade re-reads which reported thread ids still exist, NULLs only the
 * dead ones and retries once. It is not a swallow: the row's other half — a
 * live agent, in this channel, in this state — is still true, and a null
 * `task_id` is exactly what the column's own `ON DELETE SET NULL` leaves.
 */
describe("replaceSessionStates — a thread deleted under a live peer agent (F-241)", () => {
  const DEAD = "44444444-e29b-41d4-a716-446655440000";
  const LIVE = "55555555-e29b-41d4-a716-446655440000";
  const FK = { code: "23503", message: "insert or update on table \"channel_sessions\" violates foreign key constraint" };

  /** Answers each awaited step from a queue, in order (no repeat of the tail). */
  function makeScriptedAdmin(results: Array<{ data: unknown; error: unknown }>) {
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
        resolve(queue.length > 0 ? queue.shift() : { data: null, error: null }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
    return steps;
  }

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

    // ⚠ The existence check asks `channel_tasks`, and only for the ids reported.
    const probe = steps.find((s) => s.op === "in");
    expect(probe?.args).toEqual(["id", [DEAD, LIVE]]);

    const upserts = steps.filter((s) => s.op === "upsert");
    expect(upserts).toHaveLength(2);
    const retried = upserts[1].args[0] as Array<Record<string, unknown>>;
    expect(retried[0].task_id).toBeNull();
    expect(retried[1].task_id).toBe(LIVE);
    // ⚠ NOTHING ELSE IS TOUCHED: the live row keeps its thread, both rows are
    // still written, and the session keys are unchanged.
    expect(retried.map((r) => r.session_key)).toEqual([deadRow.session_key, liveRow.session_key]);
  });

  it("a 23503 that names NO dead thread RETHROWS — it never guesses the constraint", async () => {
    // `channel_sessions` has four foreign keys. A violation on `channel_id`
    // means the CHANNEL is gone, which nulling a thread id cannot fix and must
    // not be made to look fixed.
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
