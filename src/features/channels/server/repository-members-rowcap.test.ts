/**
 * 🔒 **`memberCount` ON EVERY CHANNEL ROW, PAST ONE POSTGREST PAGE (Samuel #2935,
 * the `max_rows` sweep).**
 *
 * `memberCounts` asked `.limit(CHANNEL_MEMBER_ROWS_LIMIT)` — 10,000 — and
 * `supabase/config.toml › max_rows` clips every select server-side at 1,000 and
 * **raises nothing**. Its own docblock already described the cost ("a clipped page
 * is a wrong number on every channel row, not a crash anyone would see") while the
 * line beneath it asked for a bound the server was never going to honour: past a
 * thousand membership rows across one page, the count came back SHORT on the
 * channels whose rows sorted last and **ZERO** on the ones that fell off entirely.
 * ⚠ A count is the one value a reader cannot sanity-check by eye, which is why
 * this one could be wrong in production without a single report.
 *
 * ⚠ **THIS READ IS A COUNT-BY-GROUP AND ITS END SHAPE IS `count` PER CHANNEL IN
 * SQL, NOT THE WALK THESE CASES PIN.** The grouped aggregate belongs in a
 * migration, which this change does not write (§12), so the page walk is the
 * interim: it makes the number correct up to the ceiling already declared here.
 * When the aggregate lands, these cases are replaced by its own — what carries
 * over is the ceiling, the fence, and the fact that the answer must be EXACT.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, INVARIANTS §14), with `MAX_ROWS` read out of
 * `supabase/config.toml` rather than written beside it.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `.limit(CHANNEL_MEMBER_ROWS_LIMIT)` back for the page walk → "counts a
 *    1,500-member channel exactly" and the page-shape cases fail.
 *  - drop `.order("user_id")` → "the order is TOTAL across channels" fails.
 *  - widen the projection to `select("channel_id, user_id")` → "one column on the
 *    wire" fails.
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
import { CHANNEL_MEMBER_ROWS_LIMIT } from "./repository-collab";
import { memberCounts } from "./repository-members";

const WS = "11111111-2222-4333-8444-555555555555";
const CH = "22222222-3333-4444-8555-666666666666";
const CH_B = "22222222-3333-4444-8555-666666666777";
const OTHER_CH = "33333333-4444-4555-8666-777777777777";

/** ⚠ Past the 10,000 hard cap, so the cap case is driven past TEN pages — a
 *  1,200-row fixture is caught by the walk and proves nothing about the cap. */
const OVER_CAP = 10_400;

function members(n: number, channel = CH, from = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    channel_id: channel,
    user_id: `u-${String(from + i).padStart(7, "0")}`,
    workspace_id: WS,
    joined_at: "2026-09-02T00:00:00.000Z",
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

function pagesTo(cap: number): number {
  return Math.ceil(cap / MAX_ROWS);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("memberCounts — past the PostgREST ceiling", () => {
  /** 🔒 **THE CONTROL.** Without it every case below proves nothing: it shows the
   *  harness really does clip the OLD one-statement shape at `max_rows`, so the
   *  read this replaced counted 1,000 of 1,500 members and said nothing. */
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
              limit: (n: number) => PromiseLike<{ data: Row[]; error: unknown }>;
            };
          };
        };
      }
    )
      .from("channel_members")
      .select("channel_id")
      .in("channel_id", [CH])
      // ⚠ THE OLD ASK, VERBATIM: 10,000. The server hands back 1,000.
      .limit(CHANNEL_MEMBER_ROWS_LIMIT)) as { data: Row[]; error: unknown };
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  /** ⚠ **EXACT EQUALITY IS THE SET CHECK FOR A COUNT READ.** A row counted twice
   *  across a page boundary reads 1,501; a skipped one reads 1,499. Only the
   *  complete set, counted once each, reads 1,500. */
  it("counts a 1,500-member channel exactly — 500 more than the old ask could reach", async () => {
    mount(members(1_500));
    expect((await memberCounts([CH])).get(CH)).toBe(1_500);
  });

  it("counts two channels straddling a page boundary, each exactly", async () => {
    const seeded = [...members(900, CH), ...members(900, CH_B, 20_000)];
    mount(seeded);
    const counts = await memberCounts([CH, CH_B]);
    expect(counts.get(CH)).toBe(900);
    expect(counts.get(CH_B)).toBe(900);
    // ⚠ The whole fixture is accounted for: no row landed in no channel.
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(seeded.length);
  });

  /** ⚠ **A CHANNEL THAT FELL OFF THE PAGE READ ZERO**, which rendered as an empty
   *  room. `CH_B`'s ids sort entirely after `CH`'s 1,100, so under the old shape it
   *  was absent from the map altogether. */
  it("does not drop the channel whose rows sort last", async () => {
    mount([...members(1_100, CH), ...members(40, CH_B, 20_000)]);
    const counts = await memberCounts([CH, CH_B]);
    expect(counts.get(CH)).toBe(1_100);
    expect(counts.get(CH_B)).toBe(40);
  });

  it("walks TWO contiguous pages of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount(members(1_500));
    await memberCounts([CH]);
    expect(fake.pageReads()).toBe(2);
    const seen = ranges(fake);
    expect(seen).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
    // ⚠ No page wider than the ceiling — the walk's only exhaustion signal.
    expect(seen.every(([from, to]) => to - from + 1 <= MAX_ROWS)).toBe(true);
  });

  it(`stops at the ${CHANNEL_MEMBER_ROWS_LIMIT} hard cap over ${OVER_CAP} rows and asks for nothing past it`, async () => {
    const fake = mount(members(OVER_CAP));
    // ⚠ STILL A FLOOR AT THE CAP — the cap is honoured at 10,000 now rather than
    // at the server's 1,000, and the floor now SAYS SO (see below).
    expect((await memberCounts([CH])).get(CH)).toBe(CHANNEL_MEMBER_ROWS_LIMIT);
    expect(ranges(fake)).toHaveLength(pagesTo(CHANNEL_MEMBER_ROWS_LIMIT));
    expect(ranges(fake).at(-1)).toEqual([
      CHANNEL_MEMBER_ROWS_LIMIT - MAX_ROWS,
      CHANNEL_MEMBER_ROWS_LIMIT - 1,
    ]);
  });

  /**
   * 🔒 **THE FLOOR AT THE CAP IS REPORTED NOW (Samuel #2935, the review).** The
   * paragraph this case replaces said the clip "is reported nowhere because this
   * read returns a bare `Map<string, number>`" — which is the same defect one
   * order of magnitude later: the walk computed `truncated` and the function kept
   * only `rows`, so a count folded out of a capped haul was handed to
   * `service-list.ts` as exact and rendered on every channel row.
   *
   * ⚠ **THE MARKER RIDES THE `Map`, NON-ENUMERABLY** (`MemberCounts`): the clean
   * shape is `Clipped<Map<…>>` and it would rewrite the caller and five suites
   * that mock this function. Non-enumerable is what keeps `Object.keys`, a
   * `JSON.stringify` and a `toEqual` deep-compare seeing the Map they always saw.
   *
   * ⚠ **AND IT IS STILL NOT THE END SHAPE.** The exact answer is a grouped SQL
   * aggregate, which needs a migration this change does not write (§12) — the
   * marker is what makes the interim HONEST rather than what makes it right.
   */
  it(`REPORTS the floor at the hard cap, and reports an exhausted walk as complete`, async () => {
    mount(members(OVER_CAP));
    const capped = await memberCounts([CH]);
    expect(capped.truncated).toBe(true);
    expect(capped.get(CH)).toBe(CHANNEL_MEMBER_ROWS_LIMIT);
    // ⚠ The marker is invisible to enumeration, so the Map still deep-compares.
    expect(Object.keys(capped)).toEqual([]);

    mount(members(1_500));
    const exhausted = await memberCounts([CH]);
    expect(exhausted.truncated).toBe(false);
    expect(exhausted.get(CH)).toBe(1_500);
  });

  it("an un-queried empty channel set is COMPLETE, not a floor", async () => {
    mount(members(10));
    expect((await memberCounts([])).truncated).toBe(false);
  });

  it("no channels is no query, and no counts", async () => {
    const fake = mount(members(10));
    expect((await memberCounts([])).size).toBe(0);
    expect(fake.pageReads()).toBe(0);
  });

  it("an empty channel set is one read and an empty map", async () => {
    const fake = mount([]);
    expect((await memberCounts([CH])).size).toBe(0);
    expect(fake.pageReads()).toBe(1);
  });
});

describe("memberCounts — the order and the projection", () => {
  /**
   * 🔒 **NEITHER ORDERED COLUMN IS UNIQUE ON ITS OWN.** `channel_id` repeats once
   * per member, and `user_id` repeats across channels — only the pair is `PRIMARY
   * KEY (channel_id, user_id)`. Paging a non-unique order lets a page repeat a row
   * the previous page already counted, and a double-counted membership row is an
   * INFLATED count: the same wrong number from the opposite direction.
   */
  it("the order is TOTAL across channels — and its prefix is not", async () => {
    // ⚠ THE SAME MEMBERS IN TWO CHANNELS, so `user_id` collides as well.
    const seeded = [...members(600, CH), ...members(600, CH_B)];
    const fake = mount(seeded);
    await memberCounts([CH, CH_B]);
    const cols = orderedColumns(fake);
    expect(cols).toEqual(["channel_id", "user_id"]);
    expect(tupleCount(seeded, cols)).toBe(seeded.length);
    expect(tupleCount(seeded, cols.slice(0, -1))).toBeLessThan(seeded.length);
  });

  /** ⚠ **ORDER BY REACHES A COLUMN THE SELECT DOES NOT NAME**, which is what keeps
   *  a total order free: the tie-break costs no bytes on the wire. The precedent is
   *  `repository-token-spend.ts`, which orders by `session_key` and never selects
   *  it. */
  it("keeps ONE column on the wire while ordering on two", async () => {
    const fake = mount(members(5));
    await memberCounts([CH]);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe("channel_id");
    expect(orderedColumns(fake)).toEqual(["channel_id", "user_id"]);
  });

  it("counts none of another channel's 1,200 rows, even paging past the ceiling", async () => {
    const fake = mount([
      ...members(1_100, CH),
      ...members(1_200, OTHER_CH, 40_000),
    ]);
    const counts = await memberCounts([CH]);
    expect(counts.get(CH)).toBe(1_100);
    expect(counts.has(OTHER_CH)).toBe(false);
    const ins = fake.calls.filter((c) => c.op === "in").map((c) => c.args);
    expect(ins).toHaveLength(2);
    expect(ins.every((a) => a[0] === "channel_id")).toBe(true);
  });

  it("propagates a page error rather than reporting a short count", async () => {
    const client = {
      from: () => client,
      select: () => client,
      in: () => client,
      order: () => client,
      range: () => client,
      // The tally RPC is absent (migration unapplied), so the walk runs and meets the page error.
      rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "absent" } }),
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "42501", message: "denied" } }),
    } as Record<string, unknown>;
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);
    await expect(memberCounts([CH])).rejects.toMatchObject({ code: "42501" });
  });
});
