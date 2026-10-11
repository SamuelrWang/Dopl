/**
 * 🔒 **PRESENCE AND THE CHANNEL ROSTER, PAST ONE POSTGREST PAGE (Samuel #2935, the
 * `max_rows` sweep).** Three reads in `repository-collab.ts` asked for more rows
 * than the server will ever hand back:
 *
 *   - `presenceForWorkspace` — `.limit(PRESENCE_ROWS_LIMIT)`, 5,000.
 *   - `presenceForWorkspaces` — the same 5,000, over (member × container) rows.
 *   - `channelMemberUserIds` — `.limit(CHANNEL_MEMBER_ROWS_LIMIT)`, 10,000.
 *
 * `supabase/config.toml › max_rows` clips every select SERVER-SIDE at 1,000 and
 * **raises nothing**, so each one was answered 1,000 rows with no error and no
 * marker. ⚠ **AND NONE OF THESE THREE RETURNS A `truncated` FLAG AT ALL** — they
 * return `Map`s — so unlike the token-spend read there was no lying marker to
 * notice: the clip was visible only as a member who read OFFLINE because their row
 * fell past the ceiling, and as a channel whose roster read SHORT or EMPTY.
 *
 * ⚠ **THE ORDERS ARE NEW, AND THAT IS THE RISKIER HALF OF THIS FIX.** All three
 * reads had NO `ORDER BY` — harmless for one statement whose rows go into a map,
 * and the WORST case for a page walk, which PostgREST may answer in any
 * permutation per page. Each read's order is pinned below, and each is proven
 * TOTAL over a fixture that collides on every prefix of it.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, INVARIANTS §14) and reads `MAX_ROWS` out of
 * `supabase/config.toml`. A chainable recorder proves a query was WRITTEN and can
 * never prove a map is COMPLETE, because nothing in it drops a row.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `.limit(PRESENCE_ROWS_LIMIT)` back for the page walk → "every one of
 *    1,500 members" + "two page reads" fail.
 *  - drop `.order("workspace_id")` from `presenceForWorkspaces` → "the order is
 *    TOTAL across containers" fails (the clause list AND the distinctness).
 *  - drop `.order("user_id")` from `channelMemberUserIds` → "the order is TOTAL
 *    across channels" fails.
 *  - drop `.eq("workspace_id", …)` / `.in("workspace_id", …)` → the fence cases fail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  MAX_ROWS,
  fakePostgrest,
  type FakePostgrest,
  type Row,
} from "@/shared/testing/postgrest-cap";
import {
  CHANNEL_MEMBER_ROWS_LIMIT,
  channelMemberUserIds,
  presenceForWorkspace,
  presenceForWorkspaces,
} from "./repository-collab";

const WS = "11111111-2222-4333-8444-555555555555";
const WS_B = "11111111-2222-4333-8444-555555555666";
const WS_C = "11111111-2222-4333-8444-555555555777";
const OTHER_WS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CH = "22222222-3333-4444-8555-666666666666";
const CH_B = "22222222-3333-4444-8555-666666666777";
const OTHER_CH = "33333333-4444-4555-8666-777777777777";

/** ⚠ 5,000 is the presence HARD CAP, so the cap case is driven past FIVE pages —
 *  a 1,200-row case is caught by the walk and proves nothing about the cap. */
const PRESENCE_CAP = 5_000;
const OVER_PRESENCE_CAP = 5_400;
/** ⚠ Likewise 10,000 for the roster: the highest ask in the feature. */
const OVER_MEMBER_CAP = 10_400;

function uid(i: number): string {
  return `u-${String(i).padStart(7, "0")}`;
}

/** `n` presence rows in `workspace`, every one FRESH (so `online` is the status's
 *  to decide) and carrying the full `PRIMARY KEY (user_id, workspace_id)`. */
function presence(n: number, workspace = WS, from = 0): Row[] {
  const seen = new Date().toISOString();
  return Array.from({ length: n }, (_, i) => ({
    user_id: uid(from + i),
    workspace_id: workspace,
    last_seen_at: seen,
    status: "active",
  }));
}

/** `n` membership rows in `channel`, carrying `PRIMARY KEY (channel_id, user_id)`. */
function members(n: number, channel = CH, from = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    channel_id: channel,
    user_id: uid(from + i),
    workspace_id: WS,
    role: "member",
    joined_at: "2026-09-02T00:00:00.000Z",
  }));
}

function mount(table: string, rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ [table]: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

/**
 * The columns the read's OWN `ORDER BY` names, read back off the recorder. ⚠ The
 * clause list repeats once per page, and a `Set` keeps insertion order, so this is
 * the list in order — which is what makes the distinctness proofs below assertions
 * about the SHIPPED order rather than about a string a test author retyped.
 */
function orderedColumns(fake: FakePostgrest): string[] {
  return [
    ...new Set(
      fake.calls.filter((c) => c.op === "order").map((c) => String(c.args[0]))
    ),
  ];
}

/** How many DISTINCT values the given column tuple takes over `rows`. */
function tupleCount(rows: readonly Row[], cols: readonly string[]): number {
  return new Set(rows.map((r) => cols.map((c) => String(r[c])).join("\u0000")))
    .size;
}

/** Every `.range()` the walk asked for, as `[from, to]` pairs. */
function ranges(fake: FakePostgrest): number[][] {
  return fake.calls
    .filter((c) => c.op === "range")
    .map((c) => [Number(c.args[0]), Number(c.args[1])]);
}

/**
 * 🔒 **CONTIGUOUS, AND NO PAGE WIDER THAN THE SERVER'S CEILING.** A gap between
 * pages is lost rows; an overlap is doubled ones; and a page wider than
 * `max_rows` destroys the walk's only exhaustion signal, because a short answer
 * would then be the SERVER's clip rather than the table running out.
 */
function expectContiguousPages(fake: FakePostgrest, expectedPages: number): void {
  const seen = ranges(fake);
  expect(seen).toHaveLength(expectedPages);
  seen.forEach(([from, to], i) => {
    expect(to - from + 1).toBeLessThanOrEqual(MAX_ROWS);
    expect(from).toBe(i === 0 ? 0 : seen[i - 1][1] + 1);
  });
}

/** Pages a walk to `cap` takes, and its last range. ⚠ DERIVED from `MAX_ROWS`
 *  rather than written out, so moving `supabase/config.toml` moves these with it
 *  — the same rule the fix itself follows. */
function pagesTo(cap: number): number {
  return Math.ceil(cap / MAX_ROWS);
}
function lastRangeTo(cap: number): number[] {
  const from = (pagesTo(cap) - 1) * MAX_ROWS;
  return [from, Math.min(from + MAX_ROWS, cap) - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("presenceForWorkspace — past the PostgREST ceiling", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** It shows
   *  the harness really does clip the OLD one-statement shape at `max_rows`, so
   *  the read this replaced answered 1,000 of 1,500 members — the wrong-answer
   *  half of the finding rather than a missing-rows half. */
  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS}, silently, by the same fake`, async () => {
    const { client } = mount("agent_presence", presence(1_500));
    const { data, error } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              limit: (n: number) => PromiseLike<{ data: Row[]; error: unknown }>;
            };
          };
        };
      }
    )
      .from("agent_presence")
      .select("user_id, last_seen_at, status")
      .eq("workspace_id", WS)
      // ⚠ THE OLD ASK, VERBATIM: 5,000. The server hands back 1,000.
      .limit(5_000)) as { data: Row[]; error: unknown };
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("carries every one of 1,500 members — the rows the old ask could not reach", async () => {
    const seeded = presence(1_500);
    mount("agent_presence", seeded);
    const out = await presenceForWorkspace(WS);
    // ⚠ THE KEY SET, not the length: a duplicate would collapse into the map and a
    // bare count would still read 1,500 with a gap somewhere behind it.
    expect(out.size).toBe(1_500);
    expect(seeded.every((r) => out.has(String(r.user_id)))).toBe(true);
  });

  it("walks in TWO page reads of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount("agent_presence", presence(1_500));
    await presenceForWorkspace(WS);
    expect(fake.pageReads()).toBe(2);
    expectContiguousPages(fake, 2);
    expect(ranges(fake)).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
  });

  it(`stops at the ${PRESENCE_CAP} hard cap over ${OVER_PRESENCE_CAP} members, and asks for nothing past it`, async () => {
    const fake = mount("agent_presence", presence(OVER_PRESENCE_CAP));
    const out = await presenceForWorkspace(WS);
    // ⚠ THE CAP IS STILL A CAP. These reads return a `Map` and carry no
    // `truncated` channel (their callers read presence off a key, absent or not),
    // so the ceiling being honoured is what is observable — and it is honoured at
    // 5,000 now rather than at the server's 1,000.
    expect(out.size).toBe(PRESENCE_CAP);
    expectContiguousPages(fake, pagesTo(PRESENCE_CAP));
    expect(ranges(fake).at(-1)).toEqual(lastRangeTo(PRESENCE_CAP));
  });

  it("an empty workspace is a complete answer, in one read", async () => {
    const fake = mount("agent_presence", []);
    expect((await presenceForWorkspace(WS)).size).toBe(0);
    expect(fake.pageReads()).toBe(1);
  });

  it("still derives `online` from the status, not from the page it arrived on", async () => {
    mount("agent_presence", [
      ...presence(1_100),
      { user_id: uid(9_999), workspace_id: WS, last_seen_at: new Date().toISOString(), status: "away" },
    ]);
    const out = await presenceForWorkspace(WS);
    expect(out.get(uid(0))?.online).toBe(true);
    // ⚠ A member on the SECOND page, which the old shape never reached at all.
    expect(out.get(uid(1_099))?.online).toBe(true);
    expect(out.get(uid(9_999))?.online).toBe(false);
  });

  /** 🔒 **`user_id` ALONE IS A TOTAL ORDER HERE, AND ONLY BECAUSE OF THE FENCE.**
   *  `PRIMARY KEY (user_id, workspace_id)` with `workspace_id` pinned by the `.eq`
   *  leaves `user_id` unique — which is the whole argument for ordering on one
   *  column, written as an executable claim rather than a comment. */
  it("orders by user_id, which the workspace fence makes unique", async () => {
    const seeded = presence(3);
    const fake = mount("agent_presence", seeded);
    await presenceForWorkspace(WS);
    expect(orderedColumns(fake)).toEqual(["user_id"]);
    expect(tupleCount(seeded, ["user_id"])).toBe(seeded.length);
  });

  it("names the workspace on EVERY page — one widened page is a cross-tenant read", async () => {
    const fake = mount("agent_presence", [
      ...presence(1_100),
      ...presence(1_200, OTHER_WS, 50_000),
    ]);
    const out = await presenceForWorkspace(WS);
    expect(out.size).toBe(1_100);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toHaveLength(2);
    expect(eqs.every((a) => a[0] === "workspace_id" && a[1] === WS)).toBe(true);
  });
});

describe("presenceForWorkspaces — the account scan, widest read in the tree", () => {
  const IDS = [WS, WS_B, WS_C];

  /** One member per container triple: 500 members × 3 containers = 1,500 rows,
   *  which is a page and a half and only 500 distinct members. ⚠ `user_id` is
   *  therefore NON-UNIQUE by construction, which is this read's real shape. */
  function spread(memberCount: number): Row[] {
    return IDS.flatMap((ws, w) =>
      Array.from({ length: memberCount }, (_, i) => ({
        user_id: uid(i),
        workspace_id: ws,
        // ⚠ Container C holds the FRESHEST stamp, so the freshest-wins fold has
        // something to pick and a dropped row would be a visible wrong answer.
        last_seen_at: new Date(Date.now() - (2 - w) * 1_000).toISOString(),
        status: "active",
      }))
    );
  }

  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS} on the same fixture`, async () => {
    const { client } = mount("agent_presence", spread(500));
    const { data } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (
              c: string,
              v: unknown
            ) => {
              limit: (n: number) => PromiseLike<{ data: Row[]; error: unknown }>;
            };
          };
        };
      }
    )
      .from("agent_presence")
      .select("user_id, last_seen_at, status")
      .in("workspace_id", IDS)
      .limit(5_000)) as { data: Row[]; error: unknown };
    expect(data).toHaveLength(MAX_ROWS);
  });

  /** 🔒 **THE BUG, AT ITS MOST CONCRETE.** 1,500 rows clip to 1,000, and the 500
   *  rows lost are the TAIL of the order — so the members they belong to were
   *  absent from the map and read OFFLINE while their machine was awake. */
  it("answers for every one of the 500 members behind 1,500 rows", async () => {
    mount("agent_presence", spread(500));
    const out = await presenceForWorkspaces(IDS);
    expect(out.size).toBe(500);
    expect([...out.values()].every((p) => p.online)).toBe(true);
  });

  it("collapses a member of three containers to ONE entry, keeping the freshest stamp", async () => {
    const seeded = spread(500);
    mount("agent_presence", seeded);
    const out = await presenceForWorkspaces(IDS);
    const freshest = seeded
      .filter((r) => r.user_id === uid(499))
      .map((r) => String(r.last_seen_at))
      .sort()
      .at(-1);
    expect(out.get(uid(499))?.lastSeenAt).toBe(freshest);
  });

  it("walks contiguous pages of the server's ceiling", async () => {
    const fake = mount("agent_presence", spread(500));
    await presenceForWorkspaces(IDS);
    expect(fake.pageReads()).toBe(2);
    expectContiguousPages(fake, 2);
  });

  it(`stops at the ${PRESENCE_CAP} hard cap over ${OVER_PRESENCE_CAP} rows`, async () => {
    const fake = mount("agent_presence", spread(1_800));
    await presenceForWorkspaces(IDS);
    expectContiguousPages(fake, pagesTo(PRESENCE_CAP));
    expect(ranges(fake).at(-1)).toEqual(lastRangeTo(PRESENCE_CAP));
  });

  it("no containers is no query", async () => {
    const fake = mount("agent_presence", spread(500));
    expect((await presenceForWorkspaces([])).size).toBe(0);
    expect(fake.pageReads()).toBe(0);
  });

  /**
   * 🔒 **THE NON-UNIQUE SORT COLUMN, AND WHY THE TIE-BREAK IS NOT DECORATION.**
   * `user_id` repeats once per container here, so ordering on it ALONE leaves one
   * member's rows mutually indistinguishable — and PostgREST may then answer one
   * of them on both sides of a page boundary and never answer another. A skipped
   * row is a LOST MAXIMUM, which flips the member offline. The claim is executable
   * in both directions: the shipped tuple is distinct over this fixture, and its
   * prefix (what dropping the tie-break leaves) is NOT.
   */
  it("the order is TOTAL across containers — and its prefix is not", async () => {
    const seeded = spread(500);
    const fake = mount("agent_presence", seeded);
    await presenceForWorkspaces(IDS);
    const cols = orderedColumns(fake);
    expect(cols).toEqual(["user_id", "workspace_id"]);
    expect(tupleCount(seeded, cols)).toBe(seeded.length);
    expect(tupleCount(seeded, cols.slice(0, -1))).toBeLessThan(seeded.length);
  });

  it("keeps the container fence on every page", async () => {
    const fake = mount("agent_presence", [
      ...spread(400),
      ...presence(1_200, OTHER_WS, 50_000),
    ]);
    const out = await presenceForWorkspaces(IDS);
    expect(out.size).toBe(400);
    const ins = fake.calls.filter((c) => c.op === "in").map((c) => c.args);
    expect(ins).toHaveLength(2);
    expect(ins.every((a) => a[0] === "workspace_id")).toBe(true);
  });
});

describe("channelMemberUserIds — the 10,000 ask", () => {
  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS} on the same fixture`, async () => {
    const { client } = mount("channel_members", members(1_500));
    const { data } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (
              c: string,
              v: unknown
            ) => {
              limit: (n: number) => PromiseLike<{ data: Row[]; error: unknown }>;
            };
          };
        };
      }
    )
      .from("channel_members")
      .select("channel_id, user_id")
      .in("channel_id", [CH])
      // ⚠ THE OLD ASK, VERBATIM.
      .limit(CHANNEL_MEMBER_ROWS_LIMIT)) as { data: Row[]; error: unknown };
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("carries a 1,500-member channel whole, with no id twice and none missing", async () => {
    const seeded = members(1_500);
    mount("channel_members", seeded);
    const out = await channelMemberUserIds([CH]);
    const ids = out.get(CH) ?? [];
    expect(ids).toHaveLength(1_500);
    expect(new Set(ids).size).toBe(1_500);
    expect(seeded.every((r) => new Set(ids).has(String(r.user_id)))).toBe(true);
  });

  it("splits two channels' rows across a page boundary without losing either", async () => {
    mount("channel_members", [
      ...members(900, CH),
      ...members(900, CH_B, 20_000),
    ]);
    const out = await channelMemberUserIds([CH, CH_B]);
    expect(out.get(CH)).toHaveLength(900);
    expect(out.get(CH_B)).toHaveLength(900);
  });

  it(`stops at the ${CHANNEL_MEMBER_ROWS_LIMIT} hard cap over ${OVER_MEMBER_CAP} rows`, async () => {
    const fake = mount("channel_members", members(OVER_MEMBER_CAP));
    const out = await channelMemberUserIds([CH]);
    expect(out.get(CH)).toHaveLength(CHANNEL_MEMBER_ROWS_LIMIT);
    expectContiguousPages(fake, pagesTo(CHANNEL_MEMBER_ROWS_LIMIT));
    expect(ranges(fake).at(-1)).toEqual(lastRangeTo(CHANNEL_MEMBER_ROWS_LIMIT));
  });

  it("no channels is no query", async () => {
    const fake = mount("channel_members", members(10));
    expect((await channelMemberUserIds([])).size).toBe(0);
    expect(fake.pageReads()).toBe(0);
  });

  /**
   * 🔒 **`channel_id` ALONE IS WILDLY NON-UNIQUE AND `user_id` ALONE REPEATS ACROSS
   * CHANNELS.** Only the pair is `PRIMARY KEY (channel_id, user_id)`. A repeated
   * row here is a member listed TWICE in a channel, which inflates the online count
   * the caller pairs this map with; a skipped one is a member missing from a roster.
   */
  it("the order is TOTAL across channels — and its prefix is not", async () => {
    const seeded = [
      ...members(600, CH),
      // ⚠ THE SAME MEMBERS, IN A SECOND CHANNEL: `user_id` collides too.
      ...members(600, CH_B),
    ];
    const fake = mount("channel_members", seeded);
    await channelMemberUserIds([CH, CH_B]);
    const cols = orderedColumns(fake);
    expect(cols).toEqual(["channel_id", "user_id"]);
    expect(tupleCount(seeded, cols)).toBe(seeded.length);
    expect(tupleCount(seeded, cols.slice(0, -1))).toBeLessThan(seeded.length);
  });

  it("returns none of another channel's 1,200 rows, even paging past the ceiling", async () => {
    const fake = mount("channel_members", [
      ...members(1_100, CH),
      ...members(1_200, OTHER_CH, 40_000),
    ]);
    const out = await channelMemberUserIds([CH]);
    expect(out.get(CH)).toHaveLength(1_100);
    expect(out.has(OTHER_CH)).toBe(false);
    expect(
      fake.calls.filter((c) => c.op === "in").every((c) => c.args[0] === "channel_id")
    ).toBe(true);
  });
});
