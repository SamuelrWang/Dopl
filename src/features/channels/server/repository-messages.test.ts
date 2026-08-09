/**
 * Unit tests for the transcript reads' QUERY SHAPE. Supabase is mocked with a
 * chainable builder that records every call, so these assert the filters and
 * ordering that actually reach PostgREST.
 *
 * The original contract under test is the thread scope (`metadata->>taskId`): a
 * read that isolates ONE exchange instead of paging the whole channel and
 * filtering client-side. It is a FILTER — it composes with the existing cursor /
 * limit / author-exclusion behaviour and never replaces it — and the invariant
 * that matters most is that it survives BOTH cursor modes, since the cursored
 * and cursorless reads were separate query builders until this landed.
 *
 * Two suites were added 2026-08-08 for the same reason the first exists: both
 * bugs they pin are PREDICATES that read correctly as JavaScript and are wrong
 * as SQL (`NULL <> x` is NULL, not true), so the only place to catch them is the
 * filter string itself. C-17 / F-171 is the NULL-unsafe author exclusion that
 * hid every system-authored message from every agent's await; C-6 / F-172 is
 * the anchor a re-raisable close proposal is keyed on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  hasMessagesAfter,
  latestThreadActivitySeq,
  listMessages,
} from "./repository-messages";
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
    or: (f: string) => rec("or", [f]),
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

    expect(calls.find((c) => c.op === "or")?.args).toEqual([
      "author_user_id.is.null,author_user_id.neq.user-9",
    ]);
    expect(eqFilters(calls)["metadata->>taskId"]).toBe(THREAD_UUID);
  });
});

/**
 * C-17 / F-171 — THE AUTHOR EXCLUSION MUST BE NULL-SAFE, IN BOTH QUERIES.
 *
 * `.neq("author_user_id", x)` is `author_user_id <> x`, and SQL `NULL <> x` is
 * NULL, not true — so the plain form silently dropped every SYSTEM-authored row
 * from any await that named an author, which the MCP lane ALWAYS does. The
 * stale-thread sweep's close proposal therefore rendered on the web card and was
 * invisible to every agent holding an await: the one surface the tool teaches
 * agents to keep armed.
 *
 * These assert the SQL SHAPE rather than a behaviour, because there is no
 * database here — the whole bug was a predicate that reads correctly in
 * JavaScript and is wrong in Postgres, and the only place to catch that is the
 * string that reaches PostgREST.
 */
describe("author exclusion — NULL-safe, and identical in the read and the probe", () => {
  const SELF = "aaaaaaaa-e29b-41d4-a716-446655440000";
  const NULL_SAFE = `author_user_id.is.null,author_user_id.neq.${SELF}`;

  it("listMessages emits `is null OR <>`, never a bare neq", async () => {
    const calls = makeAdmin([]);

    await listMessages(CHANNEL, { limit: 10, excludeAuthor: SELF });

    expect(calls.find((c) => c.op === "or")?.args).toEqual([NULL_SAFE]);
    // The bare form is the bug. Its absence is the assertion.
    expect(calls.some((c) => c.op === "neq")).toBe(false);
  });

  it("hasMessagesAfter emits the SAME predicate", async () => {
    // A probe that misses a row the read would return turns the hold into a
    // fetch-empty-continue spin; a probe that HITS on a row the read then drops
    // does the same thing the other way round. They have to agree exactly.
    const calls = makeAdmin([]);

    await hasMessagesAfter(CHANNEL, 5, SELF);

    expect(calls.find((c) => c.op === "or")?.args).toEqual([NULL_SAFE]);
    expect(calls.some((c) => c.op === "neq")).toBe(false);
  });

  it("applies nothing at all when no author is excluded (the desktop lane)", async () => {
    // The desktop listener deliberately sends no `excludeAuthor` — it needs its
    // own account's rows for thread targeting and requester-window routing — so
    // the unfiltered query must stay byte-identical.
    const read = makeAdmin([]);
    await listMessages(CHANNEL, { limit: 10 });
    expect(read.some((c) => c.op === "or" || c.op === "neq")).toBe(false);

    const probe = makeAdmin([]);
    await hasMessagesAfter(CHANNEL, 5);
    expect(probe.some((c) => c.op === "or" || c.op === "neq")).toBe(false);
  });
});

/**
 * C-6 / F-172 — the RE-PROPOSAL WINDOW. `latestThreadActivitySeq` is the number
 * `proposeTaskClose` keys its idempotency on, and the one filter that makes the
 * whole scheme work is the exclusion of proposals from the anchor: without it a
 * proposal moves its own anchor, so every retry writes a new prompt.
 */
describe("latestThreadActivitySeq — the anchor a re-proposal is keyed on", () => {
  it("scopes to the thread and EXCLUDES close proposals, newest first", async () => {
    const calls = makeAdmin([messageRow(17, THREAD_UUID)]);

    const seq = await latestThreadActivitySeq(CHANNEL, THREAD_UUID);

    expect(seq).toBe(17);
    expect(eqFilters(calls)).toEqual({
      channel_id: CHANNEL,
      "metadata->>taskId": THREAD_UUID,
    });
    // NULL-safe for the same reason the author filter is: `closeProposed` is
    // ABSENT on an ordinary message, so `->>` yields NULL and a bare `neq`
    // would drop every real message in the thread — inverting the anchor.
    expect(calls.find((c) => c.op === "or")?.args).toEqual([
      "metadata->>closeProposed.is.null,metadata->>closeProposed.neq.true",
    ]);
    expect(calls.find((c) => c.op === "order")?.args).toEqual([
      "seq",
      { ascending: false },
    ]);
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([1]);
  });

  it("is 0, not null, for a thread with no non-proposal message", async () => {
    // A thread opened and never spoken in. The key has to be a total function
    // or the first proposal's `client_msg_id` reads `...-undefined`.
    makeAdmin([]);
    await expect(latestThreadActivitySeq(CHANNEL, THREAD_UUID)).resolves.toBe(0);
  });
});
