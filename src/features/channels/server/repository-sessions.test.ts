/**
 * `channel_sessions` data access — THE READ HALF: the degrade that is honest,
 * and the two fences.
 *
 * ⚠ **THE WRITE HALF IS `repository-sessions-replace.test.ts`** (split 2026-09-01
 * at the 500-line cap, §1). It has its own builder stub — a QUEUE rather than a
 * single answer, because the replace issues select/upsert/delete — which is why
 * the split cost nothing but the imports.
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
} from "./repository-sessions";
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
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    template_name: null,
    // ── HEALTH (2026-09-01, 20260909120000) ─────────────────────────────
    // ⚠ `null` IS THE FIXTURE DEFAULT, and that is the honest one: a desktop
    // older than these columns reports none, so the row a test builds by default
    // is the row most live rows still are.
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    display_name: null,
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
