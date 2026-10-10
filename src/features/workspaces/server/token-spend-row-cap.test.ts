/**
 * 🔒 **THIS CONTAINER'S TOKEN STRIP, OVER A WINDOW BIGGER THAN ONE POSTGREST
 * PAGE (Samuel #2935, the `max_rows` sweep).** `listWorkspaceTokenSpend` asked
 * `.limit(TOKEN_SPEND_LIMIT)` — 2,000 runs — and `supabase/config.toml ›
 * max_rows` clips a select at 1,000 and raises NOTHING. Two wrong answers out of
 * that one line: the newest 1,000 runs came back for an ask of 2,000, so a heavy
 * operator's 31 days were drawn from their newest half and the oldest columns
 * rendered as ZERO; and `truncated = rows.length >= 2000` computed
 * `1000 >= 2000` = **false**, so the one read that WAS a floor said it was whole.
 *
 * 🔒 **THE FIX IS A PAGE WALK, NOT AN AGGREGATE, AND THAT IS A RULING.** Every
 * row is a MARK — nothing is summed — because the strip buckets by the
 * OPERATOR'S LOCAL DAY and this server cannot know that zone
 * (`20260927120000` § "DAYS ARE DERIVED"). A `date_trunc` group-by would answer
 * UTC buckets for a local-day axis.
 *
 * ⚠ Fixtures and the fake's clip: `_fake-usage-db.ts`.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `.limit(TOKEN_SPEND_LIMIT)` back in place of the walk → "carries every
 *    one of 1,500 runs", the page-read case and the hard-cap case fail.
 *  - drop the `session_key` tie-break → "the paging order is TOTAL" fails.
 *  - drop `.eq("user_id", …)` → the fence case fails.
 *  - widen the `catch` back to every error → "42501 is not an empty month" fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { MAX_ROWS } from "@/shared/testing/postgrest-cap";
import {
  ME,
  NOW,
  PEER,
  WS,
  chain,
  mount,
  runs,
} from "./_fake-usage-db";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { listWorkspaceTokenSpend } from "./repository-usage";
import { getWorkspaceTokenSpend } from "./service-usage";

beforeEach(() => vi.clearAllMocks());

describe("token spend — LISTED, so it pages", () => {
  /** 🔒 The control for the LISTED half: the old `.limit(2_000)` was declined
   *  down to 1,000 with no error, so the oldest runs vanished from a 31-day
   *  strip. */
  it(`⚠ the old 2,000-row ask still comes back as exactly ${MAX_ROWS}, silently`, async () => {
    const { client } = mount({ spend: runs(1_500) });
    const { data } = await chain(client)
      .from("workspace_token_spend")
      .select("started_at, tokens")
      .eq("user_id", ME)
      .order("started_at", { ascending: false })
      .limit(2_000);
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("carries every one of 1,500 runs — the marks the old ask could not reach", async () => {
    mount({ spend: runs(1_500) });

    const report = await getWorkspaceTokenSpend(WS, ME, NOW);

    expect(report.marks).toHaveLength(1_500);
    expect(report.truncated).toBe(false);
  });

  it("walks in TWO page reads of the server's own ceiling", async () => {
    const fake = mount({ spend: runs(1_500) });

    await getWorkspaceTokenSpend(WS, ME, NOW);

    expect(fake.pageReads()).toBe(2);
    expect(
      fake.calls.filter((c) => c.op === "range").map((c) => c.args)
    ).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
  });

  /** ⚠ **A NON-UNIQUE ORDER BY IS NOT A STYLE POINT WHEN THE READ PAGES.**
   *  Postgres may hand one row back on two pages and skip another between them,
   *  so a duplicated run would be double-counted on the strip. `(started_at,
   *  session_key)` is unique once the two `eq`s pin the rest of the primary key. */
  it("orders started_at DESC then session_key, and repeats no run", async () => {
    const fake = mount({ spend: runs(1_500) });

    const report = await getWorkspaceTokenSpend(WS, ME, NOW);

    // ⚠ TWO PAGES, so the pair is recorded twice — every page must carry the
    // whole order or the boundary moves between them.
    const orders = fake.calls
      .filter((c) => c.op === "order")
      .map((c) => c.args);
    expect(orders).toHaveLength(4);
    for (let i = 0; i < orders.length; i += 2) {
      expect(orders[i]).toEqual(["started_at", { ascending: false }]);
      expect(orders[i + 1]).toEqual(["session_key", { ascending: true }]);
    }
    expect(new Set(report.marks.map((m) => m.at)).size).toBe(1_500);
  });

  it("stops at the 2,000 hard cap over 2,400 runs and reports truncated TRUE", async () => {
    mount({ spend: runs(2_400) });

    const report = await getWorkspaceTokenSpend(WS, ME, NOW);

    expect(report.marks).toHaveLength(2_000);
    expect(report.truncated).toBe(true);
  });

  /** 🔒 `user_id` IS THE WHOLE FENCE: there is no workspace-wide variant of this
   *  read and there must not be one (INVARIANTS §9), so it has to survive a
   *  rewrite that now issues several statements. */
  it("names the caller on every page and returns none of a peer's runs", async () => {
    const fake = mount({ spend: [...runs(1_100), ...runs(1_200, PEER)] });

    const report = await getWorkspaceTokenSpend(WS, ME, NOW);

    expect(report.marks).toHaveLength(1_100);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs.filter((a) => a[0] === "user_id")).toHaveLength(2);
    expect(eqs.every((a) => a[1] === WS || a[1] === ME)).toBe(true);
  });

  it("degrades to an empty list when the spend ledger is not applied", async () => {
    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      eq: () => client,
      gte: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "PGRST205", message: "no table" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    expect(await listWorkspaceTokenSpend(WS, ME, "2026-09-01T00:00:00.000Z")).toEqual(
      { rows: [], truncated: false }
    );
  });

  /** ⚠ A PERMISSION ERROR MEANS "UNKNOWN", NEVER "NONE" — and the walk THROWS
   *  what a page answered, so this is the `catch` being narrow on purpose. */
  it("throws anything else — 42501 is not an empty month", async () => {
    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      eq: () => client,
      gte: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "42501", message: "denied" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    await expect(
      listWorkspaceTokenSpend(WS, ME, "2026-09-01T00:00:00.000Z")
    ).rejects.toMatchObject({ code: "42501" });
  });
});
