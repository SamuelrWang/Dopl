/**
 * The list-extras reads whose QUERY SHAPE is the correctness argument, pinned by
 * recording what each one asks the database for.
 *
 * ⚠ **`listLinksByWorkspaces`' CASES ARRIVED FROM `home/server/repository.test.ts`
 * IN WAVE 3 (R-26)**, unchanged: the chip is `Channel.linkOut` now, so the read
 * moved and its pins came with it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  listAccountChannelRows,
  listChannelPeerIds,
  listContainers,
  listLinksByWorkspaces,
} from "./repository-list-extras";
// 🔒 THE OTHER READER OF THE ONE PROOF — imported so the twin case below can
// compare what the two ask for rather than trusting that they agree.
import {
  ACCOUNT_CHANNEL_LIMIT,
  listAccountChannelRefs,
} from "./repository-account";

const WS = "cccccccc-3333-4333-8333-333333333333";
const WS2 = "dddddddd-4444-4444-8444-444444444444";
const ME = "11111111-1111-4111-8111-111111111111";

interface Recorded {
  tables: string[];
  selects: string[];
  /** `.eq()`, `.is()`, `.neq()` and `.in()` alike — every narrowing applied. */
  filters: Array<[string, unknown]>;
  order: Array<[string, boolean | undefined]>;
  limits: number[];
}

let rec: Recorded;

/** Each call to `.from()` takes the NEXT batch, so a two-statement read can be
 *  primed with two result sets. */
function primeSupabase(...batches: unknown[][]) {
  let call = -1;
  const builder: Record<string, unknown> = {};
  let rangeFrom = 0;
  let rangeSize = Number.POSITIVE_INFINITY;
  Object.assign(builder, {
    from: (t: string) => {
      rec.tables.push(t);
      call += 1;
      rangeFrom = 0;
      rangeSize = Number.POSITIVE_INFINITY;
      return builder;
    },
    select: (cols: string) => {
      rec.selects.push(cols);
      return builder;
    },
    eq: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    neq: (col: string, val: unknown) => {
      rec.filters.push([`neq:${col}`, val]);
      return builder;
    },
    is: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    in: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      rec.order.push([col, opts?.ascending]);
      return builder;
    },
    limit: (n: number) => {
      rec.limits.push(n);
      return builder;
    },
    // ⚠ **IT SLICES, IT DOES NOT JUST RECORD** (Samuel #2935). `listChannelPeerIds`
    // pages now, so one logical read is ONE `from` and MANY `range`s — a recorder
    // that returned the whole batch per page would multiply the result and prove
    // nothing about the walk.
    range: (a: number, b: number) => {
      rangeFrom = a;
      rangeSize = b - a + 1;
      return builder;
    },
    then: (resolve: (r: unknown) => void) =>
      resolve({
        data: (batches[Math.max(call, 0)] ?? []).slice(
          rangeFrom,
          rangeFrom + rangeSize
        ),
        error: null,
      }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

beforeEach(() => {
  rec = { tables: [], selects: [], filters: [], order: [], limits: [] };
  vi.clearAllMocks();
});

describe("listContainers", () => {
  it("selects NAMED COLUMNS and does not invent a kind", async () => {
    primeSupabase([{ id: WS, slug: "acme", public_id: "abc", kind: null }]);
    const out = await listContainers([WS]);
    expect(rec.selects[0]).not.toBe("*");
    expect(rec.selects[0]).toContain("kind");
    // ⚠ The DEFAULT lives in the DTO (§4A's positive predicate). A repository
    // that filled it in would hide which rows actually carry one.
    expect(out.get(WS)?.kind).toBeNull();
  });

  it("short-circuits on an empty id list", async () => {
    primeSupabase([]);
    expect((await listContainers([])).size).toBe(0);
    expect(rec.tables).toEqual([]);
  });
});

describe("listChannelPeerIds", () => {
  it("orders by `joined_at` THEN `user_id`, and puts an unstamped row LAST", async () => {
    // 🔒 F-307: `joined_at` alone is not a total order, so the faces shuffle
    // between loads without the tiebreaker.
    primeSupabase([]);
    await listChannelPeerIds(["chan-1"], ME, 20, 2000);
    // ⚠ `channel_id` JOINED THE ORDER IN THE `max_rows` SWEEP (Samuel #2935) and
    // it is LAST on purpose: the page walk needs a TOTAL order across channels
    // (`joined_at` + `user_id` is not unique once the read spans them — `now()`
    // is transaction-wide), and keeping the tie-break last leaves F-307's
    // oldest-join-first prefix deciding which faces survive `perChannel`.
    // `repository-list-extras-rowcap.test.ts` pins that prefix separately.
    expect(rec.order).toEqual([
      ["joined_at", true],
      ["user_id", true],
      ["channel_id", true],
    ]);
    expect(rec.filters).toContainEqual([`neq:user_id`, ME]);
  });

  it("caps PER CHANNEL in code, because PostgREST cannot limit per group", async () => {
    primeSupabase([
      { channel_id: "chan-1", user_id: "u1" },
      { channel_id: "chan-1", user_id: "u2" },
      { channel_id: "chan-1", user_id: "u3" },
      { channel_id: "chan-2", user_id: "u4" },
    ]);
    const out = await listChannelPeerIds(["chan-1", "chan-2"], ME, 2, 2000);
    expect(out.get("chan-1")).toEqual(["u1", "u2"]);
    expect(out.get("chan-2")).toEqual(["u4"]);
    // ⚠ **`rowLimit` IS NO LONGER ASKED FOR IN ONE STATEMENT (Samuel #2935).** It
    // was `.limit(2000)` and `max_rows` answered 1,000 silently, so the ceiling is
    // now reached a page at a time and NOTHING calls `.limit()` here. The ceiling
    // itself is pinned in `repository-list-extras-rowcap.test.ts`; what this case
    // owns is the per-channel cap above, which no query could express.
    expect(rec.limits).toEqual([]);
  });
});

describe("listLinksByWorkspaces", () => {
  it("is bounded and selects NAMED COLUMNS, never a star", async () => {
    primeSupabase([]);
    await listLinksByWorkspaces([WS], 200);

    expect(rec.tables).toEqual(["channel_links"]);
    expect(rec.selects[0]).not.toBe("*");
    expect(rec.selects[0]).toContain("workspace_id");
    expect(rec.selects[0]).toContain("token");
    expect(rec.filters).toEqual([
      ["workspace_id", [WS]],
      ["revoked_at", null],
    ]);
    expect(rec.limits).toEqual([200]);
  });

  it("keys the first open link per container", async () => {
    primeSupabase([
      { id: "link-1", workspace_id: WS },
      { id: "link-2", workspace_id: WS },
    ]);
    expect((await listLinksByWorkspaces([WS], 200)).get(WS)?.id).toBe("link-1");
  });

  it("short-circuits on an empty id list", async () => {
    primeSupabase([]);
    expect((await listLinksByWorkspaces([], 200)).size).toBe(0);
    expect(rec.tables).toEqual([]);
  });
});

describe("listAccountChannelRows — the scope=account fence", () => {
  it("proves membership FIRST and hands that id set to the channel read", async () => {
    // 🔒 `channel_members.user_id = <caller>`, and nothing else. The channel read
    // is BOUNDED BY the ids the proof returned — never the other way round.
    primeSupabase(
      [{ channel_id: "chan-1" }],
      [{ id: "chan-1", workspace_id: WS }]
    );
    await listAccountChannelRows(ME, null, 500);
    expect(rec.tables).toEqual(["channel_members", "channels"]);
    expect(rec.filters).toEqual([
      ["user_id", ME],
      ["id", ["chan-1"]],
      ["deleted_at", null],
    ]);
  });

  it("applies the credential's container LOCK at the PROOF (B1 / R3)", async () => {
    // A filter downstream of the proof is one a future caller forgets.
    primeSupabase([{ channel_id: "chan-1" }], []);
    await listAccountChannelRows(ME, WS2, 500);
    expect(rec.filters[0]).toEqual(["user_id", ME]);
    expect(rec.filters[1]).toEqual(["workspace_id", WS2]);
  });

  it("ORDERS the proof, because it is limited — an arbitrary page is not repeatable", async () => {
    primeSupabase([{ channel_id: "chan-1" }], []);
    await listAccountChannelRows(ME, null, 500);
    expect(rec.order[0]).toEqual(["channel_id", true]);
  });

  it("reports AT the ceiling as clipped — at is indistinguishable from over", async () => {
    primeSupabase([{ channel_id: "a" }, { channel_id: "b" }], []);
    expect((await listAccountChannelRows(ME, null, 2)).truncated).toBe(true);
  });

  it("runs NO second statement when the caller is in no channel", async () => {
    primeSupabase([]);
    const out = await listAccountChannelRows(ME, null, 500);
    expect(out).toEqual({ rows: [], truncated: false });
    expect(rec.tables).toEqual(["channel_members"]);
  });

  /**
   * 🔒 **ONE PROOF, TWO READERS, AND THIS IS WHAT SAYS SO.** The account-wide
   * STATUS answer (`repository-account.ts › listAccountChannelRefs`) and the
   * account-wide LIST answer (this file) both enter through
   * `listMyChannelMemberships`. Each spells the container lock, the stable order
   * and the `>=` ceiling — three clauses that used to be written twice, which is
   * how one of them silently loses one. The pin is that the two ask the database
   * the SAME question, so a re-fork fails here rather than in production.
   */
  it("🔒 asks the SAME proof question as the account STATUS read", async () => {
    primeSupabase([{ channel_id: "chan-1", workspace_id: WS }], []);
    await listAccountChannelRows(ME, WS2, ACCOUNT_CHANNEL_LIMIT);
    const list = { ...rec };

    rec = { tables: [], selects: [], filters: [], order: [], limits: [] };
    primeSupabase([{ channel_id: "chan-1", workspace_id: WS }], []);
    await listAccountChannelRefs(ME, WS2);
    const status = rec;

    expect(list.tables[0]).toBe("channel_members");
    expect(status.tables[0]).toBe(list.tables[0]);
    expect(status.selects[0]).toBe(list.selects[0]);
    expect(status.filters.slice(0, 2)).toEqual(list.filters.slice(0, 2));
    expect(status.order[0]).toEqual(list.order[0]);
    expect(status.limits[0]).toBe(list.limits[0]);
  });
});
