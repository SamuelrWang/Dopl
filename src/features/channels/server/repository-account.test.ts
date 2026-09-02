/**
 * THE ACCOUNT-WIDE READS' QUERY SHAPE — the file `repository-account.ts` has
 * cited by name since it was written, and which did not exist until 2026-09-02.
 *
 * Supabase is mocked with a chainable builder that records every call, so these
 * assert the filters that actually reach PostgREST rather than the JavaScript
 * around them.
 *
 * The properties that fail quietly:
 *  - 🔒 **THE MEMBERSHIP PROOF IS `user_id`, PLUS B1's LOCK WHEN THERE IS ONE
 *    (R3).** The lock narrows the PROOF, so no downstream query can be handed an
 *    id from another tenancy.
 *  - 🔒 **`deleted_at IS NULL` ON THE CHANNEL READ.** A membership row outlives
 *    a soft-delete tombstone.
 *  - **THE AUTHOR-EXCLUSION PREDICATE IS A STRING THAT READS CORRECTLY AS
 *    JAVASCRIPT AND WRONG AS SQL.** `NULL <> x` is NULL, not true, so a bare
 *    `neq` would drop every SYSTEM row; the `or(...is.null,...neq...)` shape is
 *    the only place to catch that, and it is a deliberate THIRD copy of the same
 *    string.
 *  - **AT THE CEILING COUNTS AS CLIPPED** (§9) — at is indistinguishable from
 *    over.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository-sessions", () => ({ sessionRowsWhere: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { sessionRowsWhere } from "./repository-sessions";
import {
  ACCOUNT_ADDRESSED_LIMIT,
  ACCOUNT_CHANNEL_LIMIT,
  ACCOUNT_MESSAGE_LIMIT,
  listAccountChannelRefs,
  listAccountMessagesAfter,
  listAccountSessionStates,
  listAddressedToMe,
  listMyLatestSeqByChannel,
  presenceAnywhereForUser,
  tallyAccountMessagesAfter,
} from "./repository-account";

const ME = "22222222-3333-4444-5555-666666666666";
const WS_A = "11111111-2222-3333-4444-555555555555";
const CH_A = "33333333-4444-5555-6666-777777777777";
const CH_B = "44444444-5555-6666-7777-888888888888";

type Call = { op: string; args: unknown[] };

/**
 * A chainable, thenable Supabase-builder stub — `repository-messages.test.ts`'s
 * shape. `results` is consumed one entry per awaited statement, so a two-query
 * function is driven by a two-entry list.
 */
function makeAdmin(results: unknown[][]) {
  const calls: Call[] = [];
  const pending = [...results];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    rpc: (fn: string, args: unknown) => rec("rpc", [fn, args]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    is: (c: string, v: unknown) => rec("is", [c, v]),
    or: (f: string) => rec("or", [f]),
    gt: (c: string, v: unknown) => rec("gt", [c, v]),
    order: (c: string, o: unknown) => rec("order", [c, o]),
    limit: (n: number) => rec("limit", [n]),
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: pending.shift() ?? [], error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

/** Every `eq` filter the queries applied, as `column -> value`. */
function eqFilters(calls: Call[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of calls) if (c.op === "eq") out[String(c.args[0])] = c.args[1];
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 listAccountChannelRefs — the proof behind every other read", () => {
  it("fences on user_id and keeps only LIVE channels", async () => {
    const calls = makeAdmin([
      [{ channel_id: CH_A, workspace_id: WS_A }],
      [{ id: CH_A, name: "Build", slug: "build" }],
    ]);

    const out = await listAccountChannelRefs(ME);

    expect(eqFilters(calls).user_id).toBe(ME);
    // ⚠ MUTATION CHECK. Drop this and a soft-deleted channel keeps serving
    // rows — the membership row outlives the tombstone.
    expect(calls.find((c) => c.op === "is")?.args).toEqual([
      "deleted_at",
      null,
    ]);
    // ⚠ ORDERED, BECAUSE IT IS LIMITED. An un-ordered `.limit` takes an ARBITRARY
    // page, so a clipped account would show a different set of rooms per call.
    expect(calls.find((c) => c.op === "order")?.args).toEqual([
      "channel_id",
      { ascending: true },
    ]);
    // The tenancy comes off the MEMBERSHIP row, denormalised — no second join.
    expect(out.rows).toEqual([
      { id: CH_A, name: "Build", slug: "build", workspaceId: WS_A },
    ]);
  });

  it("applies NO workspace filter for an unlocked credential", async () => {
    const calls = makeAdmin([
      [
        { channel_id: CH_A, workspace_id: WS_A },
        { channel_id: CH_B, workspace_id: "ws-other" },
      ],
      [
        { id: CH_A, name: "Build", slug: "build" },
        { id: CH_B, name: "Ops", slug: "ops" },
      ],
    ]);

    const out = await listAccountChannelRefs(ME);

    expect(eqFilters(calls).workspace_id).toBeUndefined();
    expect(out.rows).toHaveLength(2);
  });

  it("narrows the PROOF to B1's locked workspace when one is set (R3)", async () => {
    // ⚠ MUTATION CHECK. Remove the `eq("workspace_id", …)` and a
    // container-locked credential reads every workspace its operator belongs
    // to — `withUserAuth` applies no lock of its own on these two routes.
    const calls = makeAdmin([
      [{ channel_id: CH_A, workspace_id: WS_A }],
      [{ id: CH_A, name: "Build", slug: "build" }],
    ]);

    await listAccountChannelRefs(ME, WS_A);

    expect(eqFilters(calls).workspace_id).toBe(WS_A);
  });

  it("treats null and undefined alike — neither is a lock", async () => {
    const calls = makeAdmin([[], []]);
    await listAccountChannelRefs(ME, null);
    expect(eqFilters(calls).workspace_id).toBeUndefined();
  });

  it("reports a clip from the MEMBERSHIP read, which is the one that can end", async () => {
    // ⚠ AT the ceiling counts as clipped — at is indistinguishable from over.
    const rows = Array.from({ length: ACCOUNT_CHANNEL_LIMIT }, (_, i) => ({
      channel_id: `c-${i}`,
      workspace_id: WS_A,
    }));
    makeAdmin([rows, []]);
    const out = await listAccountChannelRefs(ME);
    expect(out.truncated).toBe(true);
  });

  it("issues no second query, and reports no clip, when the caller is in nothing", async () => {
    const calls = makeAdmin([[]]);
    const out = await listAccountChannelRefs(ME);
    expect(out).toEqual({ rows: [], truncated: false });
    expect(calls.filter((c) => c.op === "from")).toHaveLength(1);
  });
});

describe("the author-exclusion predicate — a NULL author is not 'my own post'", () => {
  it("is an OR of is.null and neq on the message page", async () => {
    // ⚠ MUTATION CHECK. A bare `.neq("author_user_id", ME)` reads correctly as
    // JavaScript and is WRONG as SQL: `NULL <> x` is NULL, not true, so every
    // SYSTEM row would silently disappear from an account-wide page.
    const calls = makeAdmin([[]]);
    await listAccountMessagesAfter([CH_A], 4, 50, ME);
    expect(calls.find((c) => c.op === "or")?.args[0]).toBe(
      `author_user_id.is.null,author_user_id.neq.${ME}`
    );
  });

  it("is the identical string on the tally", async () => {
    const calls = makeAdmin([[]]);
    await tallyAccountMessagesAfter([CH_A], 4, ME);
    expect(calls.find((c) => c.op === "or")?.args[0]).toBe(
      `author_user_id.is.null,author_user_id.neq.${ME}`
    );
  });

  it("is ABSENT when no author was excluded — the filter is opt-in", async () => {
    const calls = makeAdmin([[]]);
    await listAccountMessagesAfter([CH_A], 4, 50);
    expect(calls.find((c) => c.op === "or")).toBeUndefined();
  });
});

describe("the message page and the tally", () => {
  it("reads ASCENDING past the cursor, so a clipped page is resumed not skipped", async () => {
    const calls = makeAdmin([[]]);
    await listAccountMessagesAfter([CH_A, CH_B], 7, 50, ME);
    expect(calls.find((c) => c.op === "in")?.args).toEqual([
      "channel_id",
      [CH_A, CH_B],
    ]);
    expect(calls.find((c) => c.op === "gt")?.args).toEqual(["seq", 7]);
    expect(calls.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: true,
    });
  });

  it("caps a caller's limit at ACCOUNT_MESSAGE_LIMIT and floors it at 1", async () => {
    let calls = makeAdmin([[]]);
    await listAccountMessagesAfter([CH_A], 0, 10_000, ME);
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([
      ACCOUNT_MESSAGE_LIMIT,
    ]);
    calls = makeAdmin([[]]);
    await listAccountMessagesAfter([CH_A], 0, 0, ME);
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([1]);
  });

  it("reports a page AT its ceiling as clipped", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `m-${i}` }));
    makeAdmin([rows]);
    const out = await listAccountMessagesAfter([CH_A], 0, 3, ME);
    expect(out.truncated).toBe(true);
  });

  it("reads TWO COLUMNS for the tally — bodies are the payload §9 forbids", async () => {
    const calls = makeAdmin([[]]);
    await tallyAccountMessagesAfter([CH_A], 4, ME);
    expect(calls.find((c) => c.op === "select")?.args[0]).toBe(
      "channel_id, seq"
    );
  });

  it("answers empty with no channel ids, issuing no query at all", async () => {
    const calls = makeAdmin([[]]);
    expect(await listAccountMessagesAfter([], 0, 50, ME)).toEqual({
      rows: [],
      truncated: false,
    });
    expect(await tallyAccountMessagesAfter([], 0, ME)).toEqual({
      rows: [],
      truncated: false,
    });
    expect(await listAddressedToMe([], ME)).toEqual({
      rows: [],
      truncated: false,
    });
    expect(await listMyLatestSeqByChannel([], ME, 0)).toEqual(new Map());
    expect(await listAccountSessionStates(ME, [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("the 'waiting on you' pair", () => {
  it("reads addressed messages NEWEST first, bounded and reported", async () => {
    const rows = Array.from({ length: ACCOUNT_ADDRESSED_LIMIT }, (_, i) => ({
      id: `m-${i}`,
    }));
    const calls = makeAdmin([rows]);
    const out = await listAddressedToMe([CH_A], ME);
    expect(eqFilters(calls)["metadata->>to_user_id"]).toBe(ME);
    expect(calls.find((c) => c.op === "order")?.args[1]).toEqual({
      ascending: false,
    });
    expect(out.truncated).toBe(true);
  });

  it("takes the caller's own MAXIMUM seq per channel from one descending scan", async () => {
    // ⚠ First row per channel wins — PostgREST cannot group, so DESCENDING is
    // what makes one bounded scan answer a per-channel aggregate.
    const calls = makeAdmin([
      [
        { channel_id: CH_A, seq: 30 },
        { channel_id: CH_A, seq: 12 },
        { channel_id: CH_B, seq: 9 },
      ],
    ]);
    const out = await listMyLatestSeqByChannel([CH_A, CH_B], ME, 8);
    expect(calls.find((c) => c.op === "gt")?.args).toEqual(["seq", 8]);
    expect(out.get(CH_A)).toBe(30);
    expect(out.get(CH_B)).toBe(9);
  });
});

describe("the session read reuses the shared builder, with both fences", () => {
  it("applies user_id AND channel_id through sessionRowsWhere", async () => {
    const applied: Call[] = [];
    const q = {
      eq: (c: string, v: unknown) => {
        applied.push({ op: "eq", args: [c, v] });
        return q;
      },
      in: (c: string, v: unknown) => {
        applied.push({ op: "in", args: [c, v] });
        return q;
      },
    };
    vi.mocked(sessionRowsWhere).mockImplementation(async (fence) => {
      (fence as unknown as (b: unknown) => unknown)(q);
      return [] as never;
    });
    await listAccountSessionStates(ME, [CH_A]);
    expect(applied).toEqual([
      { op: "eq", args: ["user_id", ME] },
      { op: "in", args: ["channel_id", [CH_A]] },
    ]);
  });
});

describe("presenceAnywhereForUser — every unknown reads as OFFLINE", () => {
  it("is true inside the window", async () => {
    makeAdmin([[{ last_seen_at: new Date().toISOString() }]]);
    expect(await presenceAnywhereForUser(ME, 60_000)).toBe(true);
  });

  it("is false with no row, no stamp, or an unparseable one", async () => {
    makeAdmin([[]]);
    expect(await presenceAnywhereForUser(ME, 60_000)).toBe(false);
    makeAdmin([[{ last_seen_at: null }]]);
    expect(await presenceAnywhereForUser(ME, 60_000)).toBe(false);
    makeAdmin([[{ last_seen_at: "not a date" }]]);
    expect(await presenceAnywhereForUser(ME, 60_000)).toBe(false);
  });

  it("is false past the window, and asks only for the newest beat", async () => {
    const calls = makeAdmin([
      [{ last_seen_at: new Date(Date.now() - 600_000).toISOString() }],
    ]);
    expect(await presenceAnywhereForUser(ME, 60_000)).toBe(false);
    expect(calls.find((c) => c.op === "limit")?.args).toEqual([1]);
  });
});
