/**
 * 🔒 **THE CHANNEL-ROW FACES, PAST ONE POSTGREST PAGE (Samuel #2935, the
 * `max_rows` sweep).**
 *
 * `listChannelPeerIds` takes its ceiling from the caller — `service-list.ts ›
 * PEER_ROW_LIMIT` = 2,000 — and passed it to `.limit()`. `supabase/config.toml ›
 * max_rows` clips every select SERVER-SIDE at 1,000 and **raises nothing**, so the
 * read lost its LAST channels' rosters at HALF the declared ceiling. ⚠ The symptom
 * was indistinguishable from an empty room: the surface draws no faces either way,
 * which is why a wrong answer survived in a read with its own test file.
 *
 * 🔒 ⚠ **AND THE ORDER NEEDED A THIRD COLUMN.** F-307 made it total *within one
 * channel* (`joined_at` then `user_id`); this read spans channels, where that pair
 * is **NOT UNIQUE** — `now()` is TRANSACTION-wide in Postgres, so one statement
 * seating a member in two channels stamps both rows the same `joined_at`, and
 * `user_id` is equal too. Two indistinguishable rows across a page boundary is the
 * paging failure that returns one twice and drops the other, and the dropped one
 * is a missing face in the OTHER channel. `PRIMARY KEY (channel_id, user_id)`
 * closes it, and `channel_id` goes LAST so oldest-join-first still decides which
 * faces survive `perChannel`.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, INVARIANTS §14), `MAX_ROWS` read out of `supabase/config.toml`.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `.limit(rowLimit)` back for the page walk → "every one of 1,500 peers"
 *    and the page-shape cases fail.
 *  - drop `.order("channel_id")` → "the order is TOTAL across channels" fails.
 *  - move `.order("channel_id")` FIRST → "oldest join still decides the seats"
 *    fails.
 *  - drop `.neq("user_id", viewerId)` → "the viewer is excluded on every page" fails.
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
import { listChannelPeerIds } from "./repository-list-extras";

const WS = "11111111-2222-4333-8444-555555555555";
const CH = "22222222-3333-4444-8555-666666666666";
const CH_B = "22222222-3333-4444-8555-666666666777";
const OTHER_CH = "33333333-4444-4555-8666-777777777777";
const VIEWER = "99999999-8888-4777-8666-555555555555";

/** 🔒 `service-list.ts › PEER_ROW_LIMIT`, the number the real caller passes. It is
 *  the CALLER'S to size, which is why it is a literal here rather than an import:
 *  the repository must honour whatever it is handed. */
const PEER_ROW_LIMIT = 2_000;
const OVER_CAP = 2_400;
/** Big enough that the per-channel cap never hides a paging bug. */
const ALL_SEATS = 10_000;

function uid(i: number): string {
  return `u-${String(i).padStart(7, "0")}`;
}

/**
 * `n` membership rows in `channel`, joined one minute apart ascending. ⚠ Each row
 * carries `PRIMARY KEY (channel_id, user_id)` plus `joined_at`, because the paging
 * order runs across all three.
 */
function members(
  n: number,
  opts: { channel?: string; from?: number; joinedAt?: string } = {}
): Row[] {
  const { channel = CH, from = 0, joinedAt } = opts;
  const base = Date.parse("2026-09-02T00:00:00.000Z");
  return Array.from({ length: n }, (_, i) => ({
    channel_id: channel,
    user_id: uid(from + i),
    workspace_id: WS,
    joined_at: joinedAt ?? new Date(base + (from + i) * 60_000).toISOString(),
  }));
}

function mount(rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ channel_members: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

function orderedColumns(fake: FakePostgrest): string[] {
  return [
    ...new Set(
      fake.calls.filter((c) => c.op === "order").map((c) => String(c.args[0]))
    ),
  ];
}

function tupleCount(rows: readonly Row[], cols: readonly string[]): number {
  return new Set(rows.map((r) => cols.map((c) => String(r[c])).join("\u0000")))
    .size;
}

function ranges(fake: FakePostgrest): number[][] {
  return fake.calls
    .filter((c) => c.op === "range")
    .map((c) => [Number(c.args[0]), Number(c.args[1])]);
}

function expectContiguousPages(fake: FakePostgrest, expectedPages: number): void {
  const seen = ranges(fake);
  expect(seen).toHaveLength(expectedPages);
  seen.forEach(([from, to], i) => {
    // ⚠ No page wider than the ceiling: the walk's ONLY exhaustion signal.
    expect(to - from + 1).toBeLessThanOrEqual(MAX_ROWS);
    expect(from).toBe(i === 0 ? 0 : seen[i - 1][1] + 1);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listChannelPeerIds — past the PostgREST ceiling", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** It shows
   *  the harness really clips the OLD one-statement shape at `max_rows`: an ask of
   *  2,000 came back as 1,000, so the page's last channels drew no faces. */
  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS}, silently, by the same fake`, async () => {
    const { client } = mount(members(1_500));
    const { data, error } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (
              c: string,
              v: unknown
            ) => {
              neq: (
                c: string,
                v: unknown
              ) => {
                order: (
                  c: string,
                  o: unknown
                ) => {
                  limit: (
                    n: number
                  ) => PromiseLike<{ data: Row[]; error: unknown }>;
                };
              };
            };
          };
        };
      }
    )
      .from("channel_members")
      .select("channel_id, user_id")
      .in("channel_id", [CH])
      .neq("user_id", VIEWER)
      .order("joined_at", { ascending: true, nullsFirst: false })
      // ⚠ THE OLD ASK, VERBATIM: the caller's 2,000. The server hands back 1,000.
      .limit(PEER_ROW_LIMIT)) as { data: Row[]; error: unknown };
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("carries every one of 1,500 peers — no id twice, none missing", async () => {
    const seeded = members(1_500);
    mount(seeded);
    const out = await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    const seats = out.get(CH) ?? [];
    expect(seats).toHaveLength(1_500);
    expect(new Set(seats).size).toBe(1_500);
    expect(seeded.every((r) => new Set(seats).has(String(r.user_id)))).toBe(true);
  });

  it("walks TWO contiguous pages of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount(members(1_500));
    await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(fake.pageReads()).toBe(2);
    expectContiguousPages(fake, 2);
    expect(ranges(fake)).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
  });

  /** 🔒 **THE REPORTED SYMPTOM.** `CH_B`'s rows sort entirely after `CH`'s 1,100,
   *  so under the clip that channel's row drew NO faces — identical on screen to a
   *  room with nobody in it. */
  it("does not drop the channel whose rows sort last", async () => {
    mount([
      ...members(1_100, { channel: CH }),
      ...members(40, { channel: CH_B, from: 20_000 }),
    ]);
    const out = await listChannelPeerIds([CH, CH_B], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(out.get(CH)).toHaveLength(1_100);
    expect(out.get(CH_B)).toHaveLength(40);
  });

  it(`stops at the caller's ${PEER_ROW_LIMIT} ceiling over ${OVER_CAP} rows and asks for nothing past it`, async () => {
    const fake = mount(members(OVER_CAP));
    const out = await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    // ⚠ STILL A CEILING. This read returns a `Map` and carries no `truncated`
    // channel — the service documents the clip as "the LAST channels' faces" — so
    // the observable is that the cap is honoured at 2,000 now, not at 1,000.
    expect(out.get(CH)).toHaveLength(PEER_ROW_LIMIT);
    expectContiguousPages(fake, Math.ceil(PEER_ROW_LIMIT / MAX_ROWS));
    expect(ranges(fake).at(-1)).toEqual([PEER_ROW_LIMIT - MAX_ROWS, PEER_ROW_LIMIT - 1]);
  });

  /** ⚠ **THE CEILING IS THE CALLER'S AND THE LAST PAGE IS NARROWED TO IT**, so the
   *  walk never fetches rows it would immediately discard. */
  it("honours an odd caller ceiling, narrowing the final page to it", async () => {
    const fake = mount(members(OVER_CAP));
    const out = await listChannelPeerIds([CH], VIEWER, ALL_SEATS, 1_500);
    expect(out.get(CH)).toHaveLength(1_500);
    expect(ranges(fake)).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 1_499],
    ]);
  });

  it("no channels is no query", async () => {
    const fake = mount(members(10));
    expect((await listChannelPeerIds([], VIEWER, ALL_SEATS, PEER_ROW_LIMIT)).size).toBe(0);
    expect(fake.pageReads()).toBe(0);
  });

  it("an empty roster is a complete answer in one read", async () => {
    const fake = mount([]);
    expect((await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT)).size).toBe(0);
    expect(fake.pageReads()).toBe(1);
  });
});

describe("listChannelPeerIds — the order survives paging", () => {
  /**
   * 🔒 **`joined_at` + `user_id` IS NOT UNIQUE ACROSS CHANNELS, WHICH IS THE WHOLE
   * REASON `channel_id` JOINED THE ORDER.** The fixture is the real colliding case:
   * the same 600 members seated in two channels by one statement, so every row has
   * a twin sharing BOTH F-307 columns. A page boundary through that pair returns
   * one row twice and loses the other — a face duplicated in one room and missing
   * from the other.
   */
  it("the order is TOTAL across channels — and its F-307 prefix is not", async () => {
    const stamp = "2026-09-02T00:00:00.000Z";
    const seeded = [
      ...members(600, { channel: CH, joinedAt: stamp }),
      ...members(600, { channel: CH_B, joinedAt: stamp }),
    ];
    const fake = mount(seeded);
    await listChannelPeerIds([CH, CH_B], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    const cols = orderedColumns(fake);
    expect(cols).toEqual(["joined_at", "user_id", "channel_id"]);
    expect(tupleCount(seeded, cols)).toBe(seeded.length);
    expect(tupleCount(seeded, cols.slice(0, -1))).toBeLessThan(seeded.length);
    // ⚠ And the rows all arrive, once each, in both rooms.
    const out = await listChannelPeerIds([CH, CH_B], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(out.get(CH)).toHaveLength(600);
    expect(out.get(CH_B)).toHaveLength(600);
    expect(new Set(out.get(CH)).size).toBe(600);
  });

  it("pins the full clause list, tie-break LAST", async () => {
    const fake = mount(members(3));
    await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(fake.calls.filter((c) => c.op === "order").map((c) => c.args)).toEqual([
      // ⚠ `nullsFirst: false` SURVIVES: an unstamped legacy row goes LAST rather
      // than claiming the first face from somebody who really did join first.
      ["joined_at", { ascending: true, nullsFirst: false }],
      ["user_id", { ascending: true }],
      ["channel_id", { ascending: true }],
    ]);
  });

  /** 🔒 **OLDEST JOIN STILL DECIDES THE SEATS, ACROSS A PAGE BOUNDARY.** The
   *  per-channel cap keeps whatever arrives FIRST, so a `channel_id`-first order
   *  would hand the three seats to whichever channel sorted first rather than to
   *  the three oldest members — the F-307 shuffle, re-introduced by a tie-break. */
  it("keeps the three OLDEST peers when perChannel is 3", async () => {
    mount(members(1_200));
    const out = await listChannelPeerIds([CH], VIEWER, 3, PEER_ROW_LIMIT);
    expect(out.get(CH)).toEqual([uid(0), uid(1), uid(2)]);
  });

  it("the viewer is excluded on every page", async () => {
    const fake = mount([
      ...members(1_100),
      { channel_id: CH, user_id: VIEWER, workspace_id: WS, joined_at: "2026-09-01T00:00:00.000Z" },
    ]);
    const out = await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(out.get(CH)).toHaveLength(1_100);
    expect(out.get(CH)?.includes(VIEWER)).toBe(false);
    const neqs = fake.calls.filter((c) => c.op === "neq").map((c) => c.args);
    expect(neqs).toHaveLength(2);
    expect(neqs.every((a) => a[0] === "user_id" && a[1] === VIEWER)).toBe(true);
  });

  it("returns none of another channel's 1,200 rows, even paging past the ceiling", async () => {
    const fake = mount([
      ...members(1_100, { channel: CH }),
      ...members(1_200, { channel: OTHER_CH, from: 40_000 }),
    ]);
    const out = await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(out.get(CH)).toHaveLength(1_100);
    expect(out.has(OTHER_CH)).toBe(false);
    const ins = fake.calls.filter((c) => c.op === "in").map((c) => c.args);
    expect(ins).toHaveLength(2);
    expect(ins.every((a) => a[0] === "channel_id")).toBe(true);
  });

  it("keeps the two-column projection", async () => {
    const fake = mount(members(3));
    await listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe(
      "channel_id, user_id"
    );
  });

  it("propagates a page error rather than reporting a short roster", async () => {
    const client = {
      from: () => client,
      select: () => client,
      in: () => client,
      neq: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "42501", message: "denied" } }),
    } as Record<string, unknown>;
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);
    await expect(
      listChannelPeerIds([CH], VIEWER, ALL_SEATS, PEER_ROW_LIMIT)
    ).rejects.toMatchObject({ code: "42501" });
  });
});
