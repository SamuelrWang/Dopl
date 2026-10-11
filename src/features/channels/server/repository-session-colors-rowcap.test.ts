/**
 * 🔒 **THE AGENT-COLOUR TAKEN SET, PAST ONE POSTGREST PAGE (Samuel #2935, the
 * `max_rows` sweep).** Both reads in `repository-session-colors.ts` asked
 * `.limit(COLOR_ROWS_LIMIT)` — 2,000 — and `supabase/config.toml › max_rows`
 * clips every select SERVER-SIDE at 1,000 and **raises nothing**.
 *
 * ⚠ **THE CONSTANT'S OWN DOCBLOCK NAMES THE CONSEQUENCE: "a truncated taken set
 * would hand out a colour somebody already holds."** Not a short list: a key
 * missing from the set is reported FREE, so the push lane assigns it twice and
 * the unique index answers 23505 — on the one lane whose contract is that it
 * REFUSES rather than substitutes (`server/errors.ts › AgentColorTakenError`).
 *
 * ⚠ **THE ORDERS ARE NEW.** Neither read had an `ORDER BY`: harmless for one
 * statement folding rows into a map, worst case for a page walk, which PostgREST
 * may answer in any permutation per page. Both now order by PRIMARY KEY `id`,
 * ORDERED ON AND NEVER SELECTED, so the narrow projection is untouched.
 *
 * ⚠ **`selectTolerant` NOW RUNS PER PAGE** — the riskiest structural part of this
 * change, so the legacy path is driven across a page boundary below, not assumed.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `.limit(COLOR_ROWS_LIMIT)` back for either page walk → "every one of
 *    1,500 live sessions" / "every one of 1,500 directives" fail.
 *  - drop `.order("id")` from either → the "order is TOTAL" case for it fails.
 *  - turn the `catch` back into an `error` branch → the PGRST205 degrade cases
 *    fail (the walk THROWS what a page answered).
 *  - hoist `selectTolerant` back out of the page builder → "a legacy database
 *    still pages" fails.
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
import { AGENT_COLOR_KEYS } from "../lib/agent-colors";
import { __resetColorSharedCompatForTests } from "./color-shared-compat";
import type { ForeignColorsByChannel } from "./session-colors";
import {
  foreignLiveColorsByChannel,
  pendingDirectiveColors,
} from "./repository-session-colors";

const WS = "11111111-2222-4333-8444-555555555555";
const OTHER_WS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CH = "22222222-3333-4444-8555-666666666666";
const CH_B = "22222222-3333-4444-8555-666666666777";
const ME = "99999999-8888-4777-8666-555555555555";
const PEER = "88888888-7777-4666-8555-444444444444";

/** The declared hard cap for both reads. ⚠ The cap case is driven PAST it, so the
 *  walk is proven to stop there rather than merely to page. */
const COLOR_CAP = 2_000;
const OVER_CAP = 2_400;

/** `n` live, coloured sessions in `channel`, cycling the sixteen-key bank. ⚠ Every
 *  row carries `id` (the PRIMARY KEY the walk orders by) and is otherwise
 *  DELIBERATELY identical to its neighbours, which is what the totality case needs. */
function sessions(
  n: number,
  opts: { channel?: string; workspace?: string; user?: string; from?: number } = {}
): Row[] {
  const { channel = CH, workspace = WS, user = PEER, from = 0 } = opts;
  return Array.from({ length: n }, (_, i) => ({
    id: `s-${String(from + i).padStart(7, "0")}`,
    channel_id: channel,
    workspace_id: workspace,
    user_id: user,
    color: AGENT_COLOR_KEYS[(from + i) % AGENT_COLOR_KEYS.length],
    state: "working",
    color_shared: false,
  }));
}

/** `n` pending launch directives in one channel, each holding a colour. */
function directives(
  n: number,
  opts: { channel?: string; workspace?: string; status?: string; from?: number } = {}
): Row[] {
  const { channel = CH, workspace = WS, status = "pending", from = 0 } = opts;
  return Array.from({ length: n }, (_, i) => ({
    id: `d-${String(from + i).padStart(7, "0")}`,
    channel_id: channel,
    workspace_id: workspace,
    status,
    color: AGENT_COLOR_KEYS[(from + i) % AGENT_COLOR_KEYS.length],
    expires_at: "2026-10-10T12:00:00.000Z",
  }));
}

function mount(table: string, rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ [table]: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

/** Every statement answers `code` — the relation is not in this environment. */
function mountMissing(code: string): void {
  const client = {
    from: () => client,
    select: () => client,
    eq: () => client,
    in: () => client,
    not: () => client,
    neq: () => client,
    order: () => client,
    range: () => client,
    then: (resolve: (r: unknown) => void) =>
      resolve({ data: null, error: { code, message: `no relation (${code})` } }),
  } as Record<string, unknown>;
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
}

/**
 * A database WITHOUT `channel_sessions.color_shared`: the full column list answers
 * Postgres `42703`, the legacy list answers normally, and the clip still applies.
 * ⚠ It wraps the shared fake rather than replacing it, so the ceiling under test
 * is still the one read out of `supabase/config.toml`.
 */
function mountWithoutColorShared(rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ channel_sessions: rows });
  const real = fake.client as Record<string, (...a: unknown[]) => unknown>;
  let askedForMissingColumn = false;
  const proxy: Record<string, unknown> = {};
  for (const name of ["from", "select", "eq", "in", "not", "neq", "order", "range"]) {
    proxy[name] = (...args: unknown[]) => {
      if (name === "select") {
        askedForMissingColumn = String(args[0] ?? "").includes("color_shared");
      }
      real[name](...args);
      return proxy;
    };
  }
  proxy.then = (resolve: (r: unknown) => void) =>
    askedForMissingColumn
      ? resolve({
          data: null,
          error: {
            code: "42703",
            message: "column channel_sessions.color_shared does not exist",
          },
        })
      : (real.then as (r: (x: unknown) => void) => unknown)(resolve);
  vi.mocked(supabaseAdmin).mockReturnValue(proxy as never);
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
    // ⚠ No page wider than the ceiling: that is the walk's ONLY exhaustion signal.
    expect(to - from + 1).toBeLessThanOrEqual(MAX_ROWS);
    expect(from).toBe(i === 0 ? 0 : seen[i - 1][1] + 1);
  });
}

/** Total holders across every channel — how many ROWS the fold actually saw. ⚠ The
 *  completeness check for a read whose answer collapses into sixteen keys. */
function heldRows(byChannel: ForeignColorsByChannel): number {
  let n = 0;
  for (const { holders } of byChannel.values()) {
    for (const count of holders.values()) n += count;
  }
  return n;
}

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠ `selectTolerant` remembers a missing column for RECHECK_MS at MODULE scope,
  // so one legacy-database case would otherwise decide the next test's shape.
  __resetColorSharedCompatForTests();
});

describe("foreignLiveColorsByChannel — past the PostgREST ceiling", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** It shows
   *  the harness really clips the OLD one-statement shape at `max_rows`, so the
   *  read this replaced saw 1,000 of 1,500 live sessions and called the rest free. */
  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS}, silently, by the same fake`, async () => {
    const { client } = mount("channel_sessions", sessions(1_500));
    const { data, error } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              in: (
                c: string,
                v: unknown
              ) => {
                not: (
                  c: string,
                  o: string,
                  v: unknown
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
      .from("channel_sessions")
      .select("channel_id, color, state, color_shared")
      .eq("workspace_id", WS)
      .in("channel_id", [CH])
      .not("color", "is", null)
      // ⚠ THE OLD ASK, VERBATIM: 2,000. The server hands back 1,000.
      .limit(COLOR_CAP)) as { data: Row[]; error: unknown };
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("sees every one of 1,500 live sessions — the 500 the old ask called free", async () => {
    mount("channel_sessions", sessions(1_500));
    const out = await foreignLiveColorsByChannel(WS, [CH], null);
    expect(heldRows(out)).toBe(1_500);
    // ⚠ All sixteen keys are held, and under the old clip the tail keys' counts
    // were simply lower — a wrong number nothing surfaced.
    expect(out.get(CH)?.holders.size).toBe(AGENT_COLOR_KEYS.length);
    expect(out.get(CH)?.exclusive.size).toBe(AGENT_COLOR_KEYS.length);
  });

  it("walks TWO contiguous pages of the server's own ceiling", async () => {
    const fake = mount("channel_sessions", sessions(1_500));
    await foreignLiveColorsByChannel(WS, [CH], null);
    expect(fake.pageReads()).toBe(2);
    expectContiguousPages(fake, 2);
    expect(ranges(fake)).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
  });

  it(`stops at the ${COLOR_CAP} hard cap over ${OVER_CAP} rows and asks for nothing past it`, async () => {
    const fake = mount("channel_sessions", sessions(OVER_CAP));
    const out = await foreignLiveColorsByChannel(WS, [CH], null);
    // ⚠ STILL A CEILING AND STILL A FLOOR AT IT. This read returns a `Map` with no
    // `truncated` channel (a taken set is consulted, not reported), so the
    // observable is that the cap is honoured — at 2,000 now, not the server's 1,000.
    expect(heldRows(out)).toBe(COLOR_CAP);
    expectContiguousPages(fake, Math.ceil(COLOR_CAP / MAX_ROWS));
    expect(ranges(fake).at(-1)).toEqual([COLOR_CAP - MAX_ROWS, COLOR_CAP - 1]);
  });

  it("keeps each channel's claims apart across a page boundary", async () => {
    mount("channel_sessions", [
      ...sessions(900, { channel: CH }),
      ...sessions(900, { channel: CH_B, from: 50_000 }),
    ]);
    const out = await foreignLiveColorsByChannel(WS, [CH, CH_B], null);
    expect(heldRows(out)).toBe(1_800);
    expect([...out.keys()].sort()).toEqual([CH, CH_B].sort());
  });

  it("no channels is still no query at all", async () => {
    const fake = mount("channel_sessions", sessions(10));
    expect((await foreignLiveColorsByChannel(WS, [], null)).size).toBe(0);
    expect(fake.pageReads()).toBe(0);
  });

  it("an empty table is a complete answer in one read", async () => {
    const fake = mount("channel_sessions", []);
    expect((await foreignLiveColorsByChannel(WS, [CH], null)).size).toBe(0);
    expect(fake.pageReads()).toBe(1);
  });

  it("still drops ENDED sessions, on both pages", async () => {
    mount("channel_sessions", [
      ...sessions(1_100),
      ...sessions(400, { from: 60_000 }).map((r) => ({ ...r, state: "ended" })),
    ]);
    expect(heldRows(await foreignLiveColorsByChannel(WS, [CH], null))).toBe(1_100);
  });

  /**
   * 🔒 **THE ONLY NON-COLLIDING COLUMN IN THIS READ IS THE PRIMARY KEY.** The
   * fixture is deliberately uniform — one channel, one workspace, one user, one
   * state, and sixteen colours over 1,200 rows — so every column a cheaper order
   * might have used is massively non-unique. `id` is what makes the order total,
   * and the two prefixes below are what dropping it leaves.
   */
  it("the order is TOTAL — `id`, where every other column collides", async () => {
    const seeded = sessions(1_200);
    const fake = mount("channel_sessions", seeded);
    await foreignLiveColorsByChannel(WS, [CH], null);
    expect(orderedColumns(fake)).toEqual(["id"]);
    expect(tupleCount(seeded, ["id"])).toBe(seeded.length);
    expect(tupleCount(seeded, ["channel_id"])).toBe(1);
    expect(tupleCount(seeded, ["color", "state"])).toBe(AGENT_COLOR_KEYS.length);
  });

  it("holds the workspace fence and the own-rows exclusion on EVERY page", async () => {
    const fake = mount("channel_sessions", [
      ...sessions(1_100, { user: PEER }),
      ...sessions(300, { user: ME, from: 70_000 }),
      ...sessions(300, { workspace: OTHER_WS, from: 80_000 }),
    ]);
    // ⚠ The exclusion is what keeps a colour stable: the caller's own live rows are
    // not competitors, and a page that forgot it would reassign every push.
    expect(heldRows(await foreignLiveColorsByChannel(WS, [CH], ME))).toBe(1_100);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs.every((a) => a[0] === "workspace_id" && a[1] === WS)).toBe(true);
    expect(eqs).toHaveLength(2);
    const neqs = fake.calls.filter((c) => c.op === "neq").map((c) => c.args);
    expect(neqs).toHaveLength(2);
    expect(neqs.every((a) => a[0] === "user_id" && a[1] === ME)).toBe(true);
  });

  it("keeps the NULL-colour filter in SQL on every page", async () => {
    const fake = mount("channel_sessions", sessions(1_200));
    await foreignLiveColorsByChannel(WS, [CH], null);
    const nots = fake.calls.filter((c) => c.op === "not").map((c) => c.args);
    expect(nots).toHaveLength(2);
    expect(nots.every((a) => a[0] === "color" && a[1] === "is" && a[2] === null)).toBe(
      true
    );
  });

  /** 🔒 **A LEGACY DATABASE STILL PAGES.** `selectTolerant` moved INSIDE the page
   *  builder, so each page tolerates the missing column — and because it remembers
   *  the absence for RECHECK_MS, only the first page pays the failed round trip. */
  it("a legacy database without `color_shared` still pages, every row exclusive", async () => {
    const fake = mountWithoutColorShared(
      // ⚠ The rows a pre-`20261115120000` database actually holds: no such column.
      sessions(1_500).map(({ id, channel_id, workspace_id, user_id, color, state }) => ({
        id,
        channel_id,
        workspace_id,
        user_id,
        color,
        state,
      }))
    );
    const out = await foreignLiveColorsByChannel(WS, [CH], null);
    expect(heldRows(out)).toBe(1_500);
    expect(out.get(CH)?.exclusive.size).toBe(AGENT_COLOR_KEYS.length);
    // ⚠ TWO ROWS-BEARING READS: the full-column probe is refused before it reaches
    // the table at all, and the walk then pages the legacy shape to exhaustion. The
    // probe is NOT repeated on page two — `selectTolerant` remembers the absence.
    expect(fake.pageReads()).toBe(2);
    expect(ranges(fake).at(-1)).toEqual([MAX_ROWS, 2 * MAX_ROWS - 1]);
    expect(
      fake.calls.filter((c) => c.op === "select" && String(c.args[0]).includes("color_shared"))
    ).toHaveLength(1);
  });

  /** ⚠ **A `catch` NOW, NOT AN `error` BRANCH** — the walk throws what a page
   *  answered, and a `catch` is exactly where a narrow rule gets widened by
   *  accident. Both the degrade and the re-throw are pinned. */
  it("degrades to an empty map on PGRST205 (no relation)", async () => {
    mountMissing("PGRST205");
    expect((await foreignLiveColorsByChannel(WS, [CH], null)).size).toBe(0);
  });

  it("throws anything else — 42501 is not an empty taken set", async () => {
    mountMissing("42501");
    await expect(foreignLiveColorsByChannel(WS, [CH], null)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("pendingDirectiveColors — past the PostgREST ceiling", () => {
  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS} on the same fixture`, async () => {
    const { client } = mount("channel_launch_directives", directives(1_500));
    const { data } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: unknown
            ) => {
              eq: (
                c: string,
                v: unknown
              ) => {
                in: (
                  c: string,
                  v: unknown
                ) => {
                  not: (
                    c: string,
                    o: string,
                    v: unknown
                  ) => {
                    limit: (
                      n: number
                    ) => PromiseLike<{ data: Row[]; error: unknown }>;
                  };
                };
              };
            };
          };
        };
      }
    )
      .from("channel_launch_directives")
      .select("color, expires_at")
      .eq("workspace_id", WS)
      .eq("channel_id", CH)
      .in("status", ["pending", "claimed"])
      .not("color", "is", null)
      .limit(COLOR_CAP)) as { data: Row[]; error: unknown };
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("carries every one of 1,500 directives, no id twice and none missing", async () => {
    const seeded = directives(1_500);
    mount("channel_launch_directives", seeded);
    const rows = await pendingDirectiveColors(WS, CH);
    expect(rows).toHaveLength(1_500);
    const ids = new Set(rows.map((r) => String((r as unknown as Row).id)));
    expect(ids.size).toBe(1_500);
    expect(seeded.every((r) => ids.has(String(r.id)))).toBe(true);
  });

  it("walks TWO contiguous pages of the server's own ceiling", async () => {
    const fake = mount("channel_launch_directives", directives(1_500));
    await pendingDirectiveColors(WS, CH);
    expect(fake.pageReads()).toBe(2);
    expectContiguousPages(fake, 2);
  });

  it(`stops at the ${COLOR_CAP} hard cap over ${OVER_CAP} directives`, async () => {
    const fake = mount("channel_launch_directives", directives(OVER_CAP));
    expect(await pendingDirectiveColors(WS, CH)).toHaveLength(COLOR_CAP);
    expectContiguousPages(fake, Math.ceil(COLOR_CAP / MAX_ROWS));
    expect(ranges(fake).at(-1)).toEqual([COLOR_CAP - MAX_ROWS, COLOR_CAP - 1]);
  });

  /** ⚠ `id` is the directives table's PRIMARY KEY and the only column here that
   *  does not collide: one workspace, one channel, one status, one expiry. */
  it("the order is TOTAL — `id`, where every other column collides", async () => {
    const seeded = directives(1_200);
    const fake = mount("channel_launch_directives", seeded);
    await pendingDirectiveColors(WS, CH);
    expect(orderedColumns(fake)).toEqual(["id"]);
    expect(tupleCount(seeded, ["id"])).toBe(seeded.length);
    expect(tupleCount(seeded, ["workspace_id", "channel_id", "status"])).toBe(1);
  });

  it("holds the claim-lane predicate and both fences on every page", async () => {
    const fake = mount("channel_launch_directives", [
      ...directives(700, { status: "pending" }),
      ...directives(700, { status: "claimed", from: 10_000 }),
      // ⚠ Neither of these may be counted: a refused launch holds no key, and
      // another channel's directive is another room's business.
      ...directives(400, { status: "refused", from: 20_000 }),
      ...directives(400, { channel: CH_B, from: 30_000 }),
    ]);
    expect(await pendingDirectiveColors(WS, CH)).toHaveLength(1_400);
    const ins = fake.calls.filter((c) => c.op === "in").map((c) => c.args);
    expect(ins).toHaveLength(2);
    expect(ins.every((a) => a[0] === "status")).toBe(true);
    expect(
      fake.calls.filter((c) => c.op === "eq").map((c) => c.args[0])
    ).toEqual(["workspace_id", "channel_id", "workspace_id", "channel_id"]);
  });

  it("degrades to an empty list on PGRST205, and throws anything else", async () => {
    mountMissing("PGRST205");
    expect(await pendingDirectiveColors(WS, CH)).toEqual([]);
    mountMissing("42501");
    await expect(pendingDirectiveColors(WS, CH)).rejects.toMatchObject({
      code: "42501",
    });
  });
});
