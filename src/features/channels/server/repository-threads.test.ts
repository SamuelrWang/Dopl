/**
 * THE THREAD LIST'S QUERY SHAPE — the read model Phase 1 of the channels-v2
 * wiring plan turns on: threads never close, so the list is ordered by LAST
 * ACTIVITY and bounded, and it says when the bound bit.
 *
 * ⚠ THE SUPABASE STUB HERE **EXECUTES** `eq` / `order` / `limit` over the
 * fixture rows rather than merely recording them, unlike
 * `repository-messages.test.ts`'s recorder. That is deliberate and it is what
 * makes the ordering assertion BEHAVIOURAL: the fixtures are handed over in
 * creation order, so a read that forgets to sort, or sorts by `created_at`,
 * comes back in the wrong order and these tests go red. A recorder would only
 * pin the column NAME, which is a claim about source text, not about which
 * thread a reader sees first (INVARIANTS §14).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { listTasksByChannel } from "./repository-tasks";
import type { ChannelTaskActivityRow } from "./dto";
import { CHANNEL_THREAD_LIST_LIMIT } from "../constants";

const CHANNEL = "chan-1";

type Call = { op: string; args: unknown[] };
type OrderKey = { column: string; ascending: boolean };

function taskRow(
  overrides: Partial<ChannelTaskActivityRow> = {}
): ChannelTaskActivityRow {
  return {
    id: "task-1",
    channel_id: CHANNEL,
    workspace_id: "ws-1",
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    created_by: "user-1",
    target_user_id: "user-2",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    last_activity_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Chainable, thenable Supabase-builder stub that APPLIES what it is told.
 * `order` is stacked and resolved together, the way PostgREST composes
 * `ORDER BY a, b`; the sort is stable, so a second key only breaks ties.
 */
function makeAdmin(rows: ChannelTaskActivityRow[]) {
  const calls: Call[] = [];
  const orders: OrderKey[] = [];
  let ceiling = Number.POSITIVE_INFINITY;
  let result = [...rows];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  const value = (row: ChannelTaskActivityRow, column: string) =>
    String((row as unknown as Record<string, unknown>)[column] ?? "");
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => {
      result = result.filter((r) => value(r, c) === String(v));
      return rec("eq", [c, v]);
    },
    order: (c: string, o: { ascending: boolean }) => {
      orders.push({ column: c, ascending: o.ascending });
      return rec("order", [c, o]);
    },
    limit: (n: number) => {
      ceiling = n;
      return rec("limit", [n]);
    },
    then: (
      resolve: (r: { data: ChannelTaskActivityRow[]; error: null }) => void
    ) => {
      // ⚠ SORT, THEN SLICE — the order is what the ceiling clips against. A
      // stub that sliced first would return a plausible page of the wrong rows
      // and hide exactly the bug this read exists to prevent.
      const sorted = [...result].sort((a, b) => {
        for (const { column, ascending } of orders) {
          const cmp = value(a, column).localeCompare(value(b, column));
          if (cmp !== 0) return ascending ? cmp : -cmp;
        }
        return 0;
      });
      resolve({ data: sorted.slice(0, ceiling), error: null });
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTasksByChannel — ordered by ACTIVITY, not by creation", () => {
  /**
   * THE PHASE-1 ASSERTION. `stale` was opened this morning and nobody has said
   * anything in it; `live` was opened seven weeks ago and someone posted an
   * hour ago. Creation order puts `stale` first, which is exactly the bug —
   * threads never close, so the list nothing ever leaves would bury every live
   * exchange under whatever was started most recently.
   *
   * ⚠ Handed to the stub in CREATION order, so "no sort at all" fails here too.
   */
  const live = taskRow({
    id: "live",
    title: "Old thread, fresh traffic",
    created_at: "2026-07-01T00:00:00Z",
    last_activity_at: "2026-08-18T11:00:00Z",
  });
  const stale = taskRow({
    id: "stale",
    title: "New thread, no traffic",
    created_at: "2026-08-18T10:00:00Z",
    // No tagged message → the view falls back to the thread's own creation.
    last_activity_at: "2026-08-18T10:00:00Z",
  });

  it("sorts a thread with old created_at and fresh traffic ABOVE a new, silent one", async () => {
    makeAdmin([stale, live]);

    const { rows } = await listTasksByChannel(CHANNEL);

    expect(rows.map((r) => r.id)).toEqual(["live", "stale"]);
  });

  it("reads the derived clock off the ACTIVITY VIEW, never `channel_tasks.updated_at`", async () => {
    // `updated_at` moves only on close / set_mode / reopen (C-1), so a read
    // that ordered by it would call `set_thread_mode` "activity" and hourly
    // traffic silence.
    const calls = makeAdmin([stale, live]);

    await listTasksByChannel(CHANNEL);

    expect(calls.find((c) => c.op === "from")?.args).toEqual([
      "channel_tasks_activity",
    ]);
    const ordered = calls.filter((c) => c.op === "order").map((c) => c.args[0]);
    expect(ordered[0]).toBe("last_activity_at");
    expect(ordered).not.toContain("updated_at");
  });

  it("breaks ties on created_at so a bounded page is deterministic", async () => {
    // Two threads opened in the same second with no traffic have the same
    // activity stamp; without the tie-break the LIMIT would drop one at random.
    const same = "2026-08-18T10:00:00Z";
    const older = taskRow({
      id: "older",
      created_at: "2026-08-17T10:00:00Z",
      last_activity_at: same,
    });
    const newer = taskRow({
      id: "newer",
      created_at: "2026-08-18T09:00:00Z",
      last_activity_at: same,
    });
    makeAdmin([older, newer]);

    const { rows } = await listTasksByChannel(CHANNEL);

    expect(rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("scopes to the one channel", async () => {
    const calls = makeAdmin([taskRow()]);

    await listTasksByChannel(CHANNEL);

    expect(calls.find((c) => c.op === "eq")?.args).toEqual([
      "channel_id",
      CHANNEL,
    ]);
  });
});

describe("listTasksByChannel — bounded, and it says when it clipped", () => {
  it("carries a limit, defaulting to CHANNEL_THREAD_LIST_LIMIT", async () => {
    const calls = makeAdmin([taskRow()]);

    await listTasksByChannel(CHANNEL);

    expect(calls.find((c) => c.op === "limit")?.args).toEqual([
      CHANNEL_THREAD_LIST_LIMIT,
    ]);
  });

  it("honours a caller's smaller limit", async () => {
    const calls = makeAdmin([taskRow({ id: "a" }), taskRow({ id: "b" })]);

    const { rows } = await listTasksByChannel(CHANNEL, 1);

    expect(calls.find((c) => c.op === "limit")?.args).toEqual([1]);
    expect(rows).toHaveLength(1);
  });

  it("reports truncated AT the ceiling — at is indistinguishable from over", async () => {
    makeAdmin([taskRow({ id: "a" }), taskRow({ id: "b" })]);

    const { rows, truncated } = await listTasksByChannel(CHANNEL, 2);

    expect(rows).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it("reports truncated:false for a channel under the ceiling", async () => {
    makeAdmin([taskRow({ id: "a" })]);

    const { truncated } = await listTasksByChannel(CHANNEL, 2);

    expect(truncated).toBe(false);
  });

  it("selects COLUMNS, never `*` — and the derived one is among them", async () => {
    const calls = makeAdmin([taskRow()]);

    await listTasksByChannel(CHANNEL);

    const cols = String(calls.find((c) => c.op === "select")?.args[0]);
    expect(cols).not.toBe("*");
    expect(cols.split(",")).toContain("last_activity_at");
    // ⚠ The view carries the idempotency key; no reader of this list needs it.
    expect(cols.split(",")).not.toContain("client_msg_id");
  });
});
