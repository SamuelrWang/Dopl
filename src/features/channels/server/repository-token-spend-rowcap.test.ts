/**
 * 🔒 **THE SPEND STRIP'S ROWS, OVER A WINDOW BIGGER THAN ONE POSTGREST PAGE
 * (Samuel #2935, the `max_rows` sweep).** `listTokenSpend` asked
 * `.limit(SPEND_ROWS_LIMIT)` — 2,000 runs — and `supabase/config.toml ›
 * max_rows` clips a select server-side at 1,000 and raises NOTHING. Two wrong
 * answers came out of that one line:
 *
 *   1. **THE ROWS.** The newest 1,000 runs came back for an ask of 2,000, so a
 *      heavy operator's month was drawn from its newest third and the oldest
 *      columns of the strip rendered as ZERO rather than as clipped.
 *   2. **THE MARKER.** `truncated = rows.length >= 2000` computed `1000 >= 2000`
 *      = **false**, so the one read that WAS a floor reported itself COMPLETE and
 *      no clip note fired. ⚠ This is why a bigger `max_rows` was never the fix:
 *      it moves the number and keeps the silence.
 *
 * The fix is {@link readAllPages}, not an aggregate, and that is a RULING:
 * `service-token-spend.ts › readTokenSpend` says **this server names no days**
 * (Samuel, 2026-09-06) because the strip buckets by the operator's LOCAL day. A
 * `date_trunc` group-by would answer UTC buckets for a local-day axis. So the
 * instants travel, and the read's job is to carry ALL of them.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, and INVARIANTS §14). A chainable recorder proves a query was
 * WRITTEN and can never prove a list is COMPLETE, because nothing in it ever
 * drops a row. The silent clip IS the finding, so the harness performs it — and
 * `MAX_ROWS` is read out of `supabase/config.toml`, never written beside it.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `.limit(SPEND_ROWS_LIMIT)` back in place of the page walk → "carries
 *    every one of 1,500 runs" and "two page reads" fail, and `truncated` goes
 *    back to lying on the 1,500-row case.
 *  - drop the `session_key` / `workspace_id` tie-breaks → "the paging order is
 *    TOTAL" fails.
 *  - drop `.eq("user_id", …)` → both fence cases fail.
 *  - delete the `catch` → the two degrade cases fail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { MAX_ROWS, fakePostgrest, type Row } from "@/shared/testing/postgrest-cap";
import { listTokenSpend } from "./repository-token-spend";

const ME = "22222222-3333-4444-8555-666666666666";
const PEER = "99999999-8888-4777-8666-555555555555";
const WS = "11111111-2222-4333-8444-555555555555";
const SINCE = "2026-09-01T00:00:00.000Z";

/** ⚠ 2,000 is the HARD CAP, so the clip case has to be driven past TWO pages —
 *  a 1,200-row case would be caught by the walk and prove nothing about it. */
const OVER_CAP = 2_400;

/**
 * `n` runs for `user`, one minute apart ascending from 2026-09-02, newest last.
 * ⚠ Every row carries the full primary key (`workspace_id, user_id, session_key,
 * started_at`) because the paging order is tie-broken down to it.
 */
function runs(n: number, user = ME, tokensEach = 10): Row[] {
  const base = Date.parse("2026-09-02T00:00:00.000Z");
  return Array.from({ length: n }, (_, i) => ({
    workspace_id: WS,
    user_id: user,
    session_key: `run-${String(i).padStart(6, "0")}`,
    started_at: new Date(base + i * 60_000).toISOString(),
    tokens: tokensEach,
    agent_name: null,
    channel_id: null,
  }));
}

/**
 * The seed row behind a returned one. ⚠ `TokenSpendRow` is the FIVE PROJECTED
 * COLUMNS; `session_key` and `user_id` are ordered and fenced on but never
 * selected, so the two cases that need them read through the seed's shape rather
 * than widening the repository's type to suit a test.
 */
function seeded(row: unknown): Row {
  return row as Row;
}

function mount(rows: Row[]) {
  const fake = fakePostgrest({ workspace_token_spend: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

/** The ledger is not in this environment: every statement answers the code. */
function mountMissing(code: string) {
  const client = {
    from: () => client,
    select: () => client,
    eq: () => client,
    gte: () => client,
    order: () => client,
    range: () => client,
    then: (resolve: (r: unknown) => void) =>
      resolve({ data: null, error: { code, message: `no ledger (${code})` } }),
  } as Record<string, unknown>;
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listTokenSpend — past the PostgREST ceiling", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** It shows
   *  the harness really does clip a one-statement read at `max_rows`, so the
   *  shape this read replaced answered the newest 1,000 of 1,500 runs — the
   *  wrong-answer half of the finding rather than a missing-rows half. */
  it(`⚠ the old shape is still clipped to exactly ${MAX_ROWS}, silently, by the same fake`, async () => {
    const { client } = mount(runs(1_500));
    const { data, error } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: unknown) => {
              gte: (c: string, v: unknown) => {
                order: (
                  c: string,
                  o: { ascending: boolean }
                ) => {
                  limit: (n: number) => PromiseLike<{
                    data: Row[];
                    error: unknown;
                  }>;
                };
              };
            };
          };
        };
      }
    )
      .from("workspace_token_spend")
      .select("started_at, tokens")
      .eq("user_id", ME)
      .gte("started_at", SINCE)
      .order("started_at", { ascending: false })
      // ⚠ THE OLD ASK, VERBATIM: 2,000. The server hands back 1,000.
      .limit(2_000)) as { data: Row[]; error: unknown };
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("carries every one of 1,500 runs — the rows the old ask could not reach", async () => {
    mount(runs(1_500));
    const out = await listTokenSpend(ME, SINCE);
    expect(out.rows).toHaveLength(1_500);
    // ⚠ The number the strip actually sums, and it is 50% higher than the clip.
    expect(out.rows.reduce((n, r) => n + Number(r.tokens), 0)).toBe(15_000);
  });

  it("walks in TWO page reads of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount(runs(1_500));
    await listTokenSpend(ME, SINCE);
    expect(fake.pageReads()).toBe(2);
    const ranges = fake.calls.filter((c) => c.op === "range").map((c) => c.args);
    expect(ranges).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
  });

  it("a complete walk reports truncated FALSE — the short last page is the proof", async () => {
    mount(runs(1_500));
    expect((await listTokenSpend(ME, SINCE)).truncated).toBe(false);
  });

  /** 🔒 **THE MARKER'S OWN BUG, EXECUTABLE.** `1000 >= 2000` was false, so this
   *  exact row count used to answer `truncated: false` while holding the newest
   *  third of a month. Now the walk fetches to the 2,000 hard cap and SAYS it
   *  stopped there. */
  it(`stops at the 2,000 hard cap over ${OVER_CAP} runs and reports truncated TRUE`, async () => {
    mount(runs(OVER_CAP));
    const out = await listTokenSpend(ME, SINCE);
    expect(out.rows).toHaveLength(2_000);
    expect(out.truncated).toBe(true);
  });

  it("asks for no rows past the hard cap — the last page is narrowed to it", async () => {
    const fake = mount(runs(OVER_CAP));
    await listTokenSpend(ME, SINCE);
    expect(fake.calls.filter((c) => c.op === "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
  });

  it("an empty ledger is a complete answer, in one read", async () => {
    const fake = mount([]);
    expect(await listTokenSpend(ME, SINCE)).toEqual({
      rows: [],
      truncated: false,
    });
    expect(fake.pageReads()).toBe(1);
  });
});

describe("listTokenSpend — the paging order is TOTAL", () => {
  /** ⚠ **A NON-UNIQUE ORDER BY IS NOT A STYLE POINT WHEN THE READ PAGES.**
   *  Postgres may hand the same row back on two pages and skip another between
   *  them, so a duplicated run would be double-counted in the strip's sum. The
   *  tie-break runs down to the primary key — `(workspace_id, user_id,
   *  session_key, started_at)` — and `user_id` is pinned by the fence. */
  it("orders started_at DESC then session_key then workspace_id", async () => {
    const fake = mount(runs(3));
    await listTokenSpend(ME, SINCE);
    expect(fake.calls.filter((c) => c.op === "order").map((c) => c.args)).toEqual([
      ["started_at", { ascending: false }],
      ["session_key", { ascending: true }],
      ["workspace_id", { ascending: true }],
    ]);
  });

  it("still answers newest run first — the read's contract, not just its index", async () => {
    mount(runs(3));
    const { rows } = await listTokenSpend(ME, SINCE);
    expect(rows[0].started_at).toBe("2026-09-02T00:02:00.000Z");
    expect(rows.at(-1)?.started_at).toBe("2026-09-02T00:00:00.000Z");
  });

  /** ⚠ A row seen twice across the boundary is the paging failure this order
   *  prevents; asserting DISTINCTNESS is how it is visible at all. */
  it("returns no run twice across the page boundary", async () => {
    mount(runs(1_500));
    const { rows } = await listTokenSpend(ME, SINCE);
    const keys = new Set(
      rows.map((r) => `${r.started_at}|${seeded(r).session_key}`)
    );
    expect(keys.size).toBe(1_500);
  });
});

describe("listTokenSpend — the fence survives the rewrite", () => {
  /** 🔒 **`user_id` IS THE WHOLE FENCE AND THERE IS NO ARGUMENT THAT WIDENS IT.**
   *  `workspace_token_spend` is RLS-denied to every login role, so this predicate
   *  is the only thing between one operator's spend and a colleague's — and
   *  nobody has ruled that a workspace member may read a peer's token spend. A
   *  fence is invisible in a return value when only one user has rows, which is
   *  why the peer below has 1,200 of them. */
  it("names the caller on every page", async () => {
    const fake = mount(runs(1_500));
    await listTokenSpend(ME, SINCE);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toHaveLength(2);
    expect(eqs.every((a) => a[0] === "user_id" && a[1] === ME)).toBe(true);
  });

  it("returns none of a peer's 1,200 runs, even paging past the ceiling", async () => {
    mount([...runs(1_100), ...runs(1_200, PEER)]);
    const { rows } = await listTokenSpend(ME, SINCE);
    expect(rows).toHaveLength(1_100);
    expect(rows.every((r) => seeded(r).user_id === ME)).toBe(true);
  });

  it("keeps the `since` bound and the five projected columns", async () => {
    const fake = mount(runs(2));
    await listTokenSpend(ME, SINCE);
    expect(fake.calls.find((c) => c.op === "gte")?.args).toEqual([
      "started_at",
      SINCE,
    ]);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe(
      "started_at, tokens, agent_name, channel_id, workspace_id"
    );
  });
});

describe("listTokenSpend — the un-applied ledger still answers", () => {
  /** ⚠ **TWO CODES AND NOTHING ELSE** (`isMissingLedger`). The walk THROWS what a
   *  page answered, so the degrade is a `catch` now — and a `catch` is exactly
   *  where a narrow rule gets widened by accident, which is why both codes and
   *  the re-throw are pinned here. */
  it("degrades to an empty, complete list on PGRST205 (no relation)", async () => {
    mountMissing("PGRST205");
    expect(await listTokenSpend(ME, SINCE)).toEqual({
      rows: [],
      truncated: false,
    });
  });

  it("degrades on PGRST202 (no function) too", async () => {
    mountMissing("PGRST202");
    expect(await listTokenSpend(ME, SINCE)).toEqual({
      rows: [],
      truncated: false,
    });
  });

  /** ⚠ A PERMISSION ERROR MEANS "UNKNOWN", NEVER "NONE". Swallowing 42501 would
   *  render a zero strip for an operator whose spend is simply unreadable. */
  it("throws anything else — 42501 is not an empty month", async () => {
    mountMissing("42501");
    await expect(listTokenSpend(ME, SINCE)).rejects.toMatchObject({
      code: "42501",
    });
  });
});
