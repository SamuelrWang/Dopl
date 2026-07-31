/**
 * Unit tests for `listMessages` — the transcript read's QUERY SHAPE. Supabase
 * is mocked with a chainable builder that records every call, so these assert
 * the filters and ordering that actually reach PostgREST.
 *
 * The contract under test is the thread scope (`metadata->>taskId`): a read
 * that isolates ONE exchange instead of paging the whole channel and filtering
 * client-side. It is a FILTER — it composes with the existing cursor / limit /
 * author-exclusion behaviour and never replaces it — and the invariant that
 * matters most is that it survives BOTH cursor modes, since the cursored and
 * cursorless reads were separate query builders until this landed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { listMessages } from "./repository-messages";
import type { ChannelMessageRow } from "./dto";

const CHANNEL = "chan-1";
const THREAD_UUID = "660e8400-e29b-41d4-a716-446655440111";
/** A pre-`channel_tasks` thread id — still a real `metadata.taskId` value. */
const LEGACY_THREAD_ID = `task-${CHANNEL}-42`;

type Call = { op: string; args: unknown[] };

function messageRow(seq: number, taskId?: string): ChannelMessageRow {
  return {
    id: `msg-${seq}`,
    seq,
    channel_id: CHANNEL,
    workspace_id: "ws-1",
    author_user_id: "user-1",
    author_kind: "user",
    kind: "message",
    body: `m${seq}`,
    metadata: taskId ? { taskId } : {},
    client_msg_id: null,
    created_at: "2026-07-31T00:00:00Z",
  };
}

/**
 * Chainable, thenable Supabase-builder stub. Every method records its call and
 * returns the builder; awaiting it resolves to `rows` (which the test sets),
 * so the whole `.from().select().eq()....limit()` chain runs without a DB.
 */
function makeAdmin(rows: ChannelMessageRow[]) {
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
    neq: (c: string, v: unknown) => rec("neq", [c, v]),
    gt: (c: string, v: unknown) => rec("gt", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: ChannelMessageRow[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

/** Every `eq` filter the query applied, as `column -> value`. */
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

describe("listMessages — thread scope", () => {
  it("filters on metadata->>taskId when a thread id is passed", async () => {
    const calls = makeAdmin([messageRow(3, THREAD_UUID)]);

    const rows = await listMessages(CHANNEL, { limit: 50, threadId: THREAD_UUID });

    // The jsonb accessor is the load-bearing detail: `metadata->>taskId`
    // compares the key as TEXT, which is how the value is stored.
    expect(eqFilters(calls)).toEqual({
      channel_id: CHANNEL,
      "metadata->>taskId": THREAD_UUID,
    });
    expect(rows.map((r) => r.seq)).toEqual([3]);
  });

  it("accepts a LEGACY task-<channelId>-<seq> id verbatim (no uuid coercion)", async () => {
    // Legacy ids are exactly the exchanges that are hardest to reconstruct by
    // hand, so the filter must pass them through untouched rather than 400.
    const calls = makeAdmin([messageRow(7, LEGACY_THREAD_ID)]);

    await listMessages(CHANNEL, { limit: 50, threadId: LEGACY_THREAD_ID });

    expect(eqFilters(calls)["metadata->>taskId"]).toBe(LEGACY_THREAD_ID);
  });

  it("returns [] for a thread id no message carries (a filter, not a lookup)", async () => {
    makeAdmin([]);

    await expect(
      listMessages(CHANNEL, { limit: 50, threadId: "task-nothing-matches-0" })
    ).resolves.toEqual([]);
  });

  it("applies NO metadata filter when the thread id is absent", async () => {
    const calls = makeAdmin([messageRow(1), messageRow(2)]);

    const rows = await listMessages(CHANNEL, { limit: 50 });

    // The unfiltered read is byte-for-byte the query that always ran: one
    // `eq` on the channel, and nothing touching metadata.
    expect(eqFilters(calls)).toEqual({ channel_id: CHANNEL });
    expect(calls.some((c) => String(c.args[0]).includes("metadata"))).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it("survives BOTH cursor modes (the two reads share one filter chain)", async () => {
    // Cursorless: newest `limit`, fetched descending and flipped to ascending.
    const cursorless = makeAdmin([messageRow(9, THREAD_UUID), messageRow(8, THREAD_UUID)]);
    const flipped = await listMessages(CHANNEL, { limit: 2, threadId: THREAD_UUID });
    expect(eqFilters(cursorless)["metadata->>taskId"]).toBe(THREAD_UUID);
    expect(cursorless.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: false,
    });
    expect(flipped.map((r) => r.seq)).toEqual([8, 9]);

    // Cursored: `seq > since`, already ascending, returned as-is.
    const cursored = makeAdmin([messageRow(8, THREAD_UUID), messageRow(9, THREAD_UUID)]);
    const ordered = await listMessages(CHANNEL, {
      since: 7,
      limit: 2,
      threadId: THREAD_UUID,
    });
    expect(eqFilters(cursored)["metadata->>taskId"]).toBe(THREAD_UUID);
    expect(cursored.find((c) => c.op === "gt")?.args).toEqual(["seq", 7]);
    expect(cursored.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: true,
    });
    expect(ordered.map((r) => r.seq)).toEqual([8, 9]);
  });

  it("composes with the await hold's author exclusion", async () => {
    // Both optional filters are applied to the same builder; neither drops the
    // other. (The await path passes no thread id today — this is the guard
    // that the shared chain didn't make the two mutually exclusive.)
    const calls = makeAdmin([]);

    await listMessages(CHANNEL, {
      since: 1,
      limit: 10,
      excludeAuthor: "user-9",
      threadId: THREAD_UUID,
    });

    expect(calls.find((c) => c.op === "neq")?.args).toEqual([
      "author_user_id",
      "user-9",
    ]);
    expect(eqFilters(calls)["metadata->>taskId"]).toBe(THREAD_UUID);
  });
});
