/**
 * The transcript reads' QUERY SHAPE. Supabase mocked with a chainable builder
 * recording every call, so these assert the filters and ordering that actually
 * reach PostgREST.
 *
 * Thread scope (`metadata->>taskId`) is a FILTER — it composes with cursor /
 * limit / author-exclusion and never replaces them. ⚠ It must survive BOTH
 * cursor modes; the cursored and cursorless reads are separate query builders.
 *
 * ⚠ The other two suites pin PREDICATES that read correctly as JavaScript and
 * are wrong as SQL (`NULL <> x` is NULL, not true), so the only place to catch
 * them is the filter STRING.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  hasMessagesAfter,
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

/** Chainable, thenable Supabase-builder stub — every method records its call and
 *  returns the builder, so the whole chain runs without a DB. */
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
    lt: (c: string, v: unknown) => rec("lt", [c, v]),
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

describe("listMessages — the BACKWARD `before` cursor", () => {
  it("filters `seq < before` and takes the NEWEST qualifying page, flipped", async () => {
    // ⚠ THE ORDERING IS THE WHOLE POINT. Rows come back descending from the DB
    // (the `limit` has to bite the end NEAREST the cursor) and are flipped for
    // display. Read ascending instead and every page would be the channel's
    // oldest `limit` rows — the same page forever, which is the bug this test
    // exists to catch.
    const calls = makeAdmin([messageRow(9), messageRow(8), messageRow(7)]);

    const rows = await listMessages(CHANNEL, { before: 10, limit: 3 });

    expect(calls.find((c) => c.op === "lt")?.args).toEqual(["seq", 10]);
    expect(calls.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: false,
    });
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([3]);
    expect(rows.map((r) => r.seq)).toEqual([7, 8, 9]);
  });

  it("BEATS `since` on the ordering when both ends are given (a bounded window)", async () => {
    // Both cursors is legal and means a window; `before` still decides which end
    // the limit bites, so the page is the NEWEST rows inside it.
    const calls = makeAdmin([messageRow(6), messageRow(5)]);

    const rows = await listMessages(CHANNEL, { since: 2, before: 7, limit: 2 });

    expect(calls.find((c) => c.op === "gt")?.args).toEqual(["seq", 2]);
    expect(calls.find((c) => c.op === "lt")?.args).toEqual(["seq", 7]);
    expect(calls.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: false,
    });
    expect(rows.map((r) => r.seq)).toEqual([5, 6]);
  });

  it("applies NO `lt` when the cursor is absent (the newest-page read is unchanged)", async () => {
    const calls = makeAdmin([messageRow(2), messageRow(1)]);

    const rows = await listMessages(CHANNEL, { limit: 2 });

    expect(calls.some((c) => c.op === "lt")).toBe(false);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
  });

  it("composes with the thread filter — a thread pages back too", async () => {
    const calls = makeAdmin([messageRow(4, THREAD_UUID)]);

    await listMessages(CHANNEL, {
      before: 5,
      limit: 50,
      threadId: THREAD_UUID,
    });

    expect(eqFilters(calls)["metadata->>taskId"]).toBe(THREAD_UUID);
    expect(calls.find((c) => c.op === "lt")?.args).toEqual(["seq", 5]);
  });
});

describe("listMessages — thread scope", () => {
  it("filters on metadata->>taskId when a thread id is passed", async () => {
    const calls = makeAdmin([messageRow(3, THREAD_UUID)]);

    const rows = await listMessages(CHANNEL, { limit: 50, threadId: THREAD_UUID });

    // ⚠ `metadata->>taskId` compares as TEXT, which is how the value is stored.
    expect(eqFilters(calls)).toEqual({
      channel_id: CHANNEL,
      "metadata->>taskId": THREAD_UUID,
    });
    expect(rows.map((r) => r.seq)).toEqual([3]);
  });

  it("accepts a LEGACY task-<channelId>-<seq> id verbatim (no uuid coercion)", async () => {
    // ⚠ Legacy ids must pass through untouched rather than 400.
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

    // Unfiltered read: one `eq` on the channel, nothing touching metadata.
    expect(eqFilters(calls)).toEqual({ channel_id: CHANNEL });
    expect(calls.some((c) => String(c.args[0]).includes("metadata"))).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it("survives BOTH cursor modes (the two reads share one filter chain)", async () => {
    const cursorless = makeAdmin([messageRow(9, THREAD_UUID), messageRow(8, THREAD_UUID)]);
    const flipped = await listMessages(CHANNEL, { limit: 2, threadId: THREAD_UUID });
    expect(eqFilters(cursorless)["metadata->>taskId"]).toBe(THREAD_UUID);
    expect(cursorless.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: false,
    });
    expect(flipped.map((r) => r.seq)).toEqual([8, 9]);

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
    // ⚠ Both optional filters applied to the same builder, neither dropping the
    // other — the shared chain must not make them mutually exclusive.
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
 * ⚠ THE AUTHOR EXCLUSION MUST BE NULL-SAFE, IN BOTH QUERIES.
 * `.neq("author_user_id", x)` is `author_user_id <> x`, and SQL `NULL <> x` is
 * NULL, not true — so the plain form silently drops every SYSTEM-authored row
 * from any await that names an author, which the MCP lane ALWAYS does.
 *
 * Asserts the SQL SHAPE, not a behaviour: there is no database here, and the
 * only place to catch the predicate is the string reaching PostgREST.
 */
describe("author exclusion — NULL-safe, and identical in the read and the probe", () => {
  const SELF = "aaaaaaaa-e29b-41d4-a716-446655440000";
  const NULL_SAFE = `author_user_id.is.null,author_user_id.neq.${SELF}`;

  it("listMessages emits `is null OR <>`, never a bare neq", async () => {
    const calls = makeAdmin([]);

    await listMessages(CHANNEL, { limit: 10, excludeAuthor: SELF });

    expect(calls.find((c) => c.op === "or")?.args).toEqual([NULL_SAFE]);
    // ⚠ The bare form is the bug — its absence is the assertion.
    expect(calls.some((c) => c.op === "neq")).toBe(false);
  });

  it("hasMessagesAfter emits the SAME predicate", async () => {
    // ⚠ Probe and read must agree EXACTLY — a probe missing a row the read
    // returns (or hitting one the read drops) spins the hold either way.
    const calls = makeAdmin([]);

    await hasMessagesAfter(CHANNEL, 5, SELF);

    expect(calls.find((c) => c.op === "or")?.args).toEqual([NULL_SAFE]);
    expect(calls.some((c) => c.op === "neq")).toBe(false);
  });

  it("applies nothing at all when no author is excluded (the desktop lane)", async () => {
    // ⚠ Desktop listener sends no `excludeAuthor` (it needs its own account's
    // rows), so the unfiltered query must stay byte-identical.
    const read = makeAdmin([]);
    await listMessages(CHANNEL, { limit: 10 });
    expect(read.some((c) => c.op === "or" || c.op === "neq")).toBe(false);

    const probe = makeAdmin([]);
    await hasMessagesAfter(CHANNEL, 5);
    expect(probe.some((c) => c.op === "or" || c.op === "neq")).toBe(false);
  });
});

/**
 * ⚠ A `latestThreadActivitySeq — the anchor a re-proposal is keyed on` block
 * ended here (wiring plan Phase 4, 2026-08-18). The repository function went
 * with `proposeTaskClose`; ⚠ **this file's import of it was the only thing
 * keeping `npx knip` quiet about the orphan**, which is why the deletion had to
 * be found by grep rather than by the gate.
 *
 * The NULL-safety half of what it pinned is live and is asserted above, on
 * `excludeAuthorFilter`: a `metadata->>` / column filter over a key that is
 * ABSENT on ordinary rows yields NULL, and a bare `neq` there drops every row it
 * was meant to keep.
 */
