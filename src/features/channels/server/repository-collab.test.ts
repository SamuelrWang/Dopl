/**
 * F-145 — `listSessionStates` OVER A TABLE THAT DOES NOT EXIST YET.
 *
 * THE DEFECT. F-144 shipped read-session-state as a contract with a flagged
 * delivery gap and said, in four places — this repository's docblock,
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
import { listSessionStates } from "./repository-collab";
import type { SessionStateRow } from "./collab-dto";

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
