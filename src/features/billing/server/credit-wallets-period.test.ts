/**
 * ⚠ **THE COUNTER READ IS ONE PERIOD, NEVER A SUM ACROSS PERIODS.**
 *
 * 2026-10-10, Samuel over the /home Overview: the *Credit spend* card read ~4,000 for October
 * while October's own counter row looked smaller, and the two visible rows (2026-10-01 and
 * 2026-09-01) happened to sum to about that figure — so the card was suspected of summing
 * periods. It was not: the October counter genuinely held 4,278, reconciled byte for byte with
 * `SUM(credit_usage_events.amount)` for the same wallet and period, and the earlier figure was
 * simply a read taken mid-burst the same day.
 *
 * Nothing was broken, which is exactly why this file exists. `getUserCreditsUsed` and
 * `getMemberCreditsUsed` are `vi.mock`ed in every suite that reaches them
 * (`credits-service.test.ts`, `credits-service-window.test.ts`, the consume routes), so the
 * `.eq("period_start", …)` that makes the read single-period had no behavioural test anywhere —
 * a patch that dropped the filter, or widened the read to every row for the user, would have
 * shipped green and turned the suspicion into the truth.
 *
 * So the stub here does NOT record the filter and assert on the string: it HOLDS two period rows
 * and applies the filters the way Postgres would, so the assertion is on the number that comes
 * back. A read that forgets the period filter sees both rows and `maybeSingle` fails on the
 * second — a read that sums them returns 6,145 — and either way these cases go red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { getUserCreditsUsed, getMemberCreditsUsed } from "./credit-wallets";

const USER = "2dac1943-da3b-4fd9-aee6-1716ddfc25f9";
const WS = "cccccccc-3333-4333-8333-333333333333";

/** The CURRENT period and the one before it — the prod shape that raised the report. */
const CURRENT = "2026-10-01T00:00:00.000Z";
const PREVIOUS = "2026-09-01T00:00:00.000Z";

/** The two counter rows, with the real figures: 4,278 + 1,867 = 6,145 if ever summed. */
const USER_ROWS = [
  { user_id: USER, period_start: CURRENT, used: 4278 },
  { user_id: USER, period_start: PREVIOUS, used: 1867 },
];

const MEMBER_ROWS = [
  { workspace_id: WS, user_id: USER, period_start: CURRENT, used: 310 },
  { workspace_id: WS, user_id: USER, period_start: PREVIOUS, used: 95 },
];

/**
 * A PostgREST stub that actually filters. `maybeSingle` throws on more than one surviving row,
 * as PostgREST does, so a dropped `period_start` filter is a failure and not a silent first-row
 * pick.
 */
function primeSupabase(rows: readonly Record<string, unknown>[]) {
  let live = [...rows];
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: () => builder,
    select: () => builder,
    eq: (col: string, val: unknown) => {
      live = live.filter((row) => row[col] === val);
      return builder;
    },
    maybeSingle: () => {
      if (live.length > 1) {
        return Promise.resolve({
          data: null,
          error: { message: "multiple (or no) rows returned", code: "PGRST116" },
        });
      }
      return Promise.resolve({ data: live[0] ?? null, error: null });
    },
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ data: live, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(
    builder as unknown as ReturnType<typeof supabaseAdmin>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserCreditsUsed — one period, never the sum", () => {
  it("returns ONLY the current period's counter when an older period row exists", async () => {
    primeSupabase(USER_ROWS);
    const used = await getUserCreditsUsed(USER, CURRENT);
    expect(used).toBe(4278);
    // The figure the card was accused of printing. Named so a regression says why it is wrong.
    expect(used).not.toBe(4278 + 1867);
  });

  it("reads the PREVIOUS period in isolation too — the filter is the key, not a `latest`", async () => {
    primeSupabase(USER_ROWS);
    expect(await getUserCreditsUsed(USER, PREVIOUS)).toBe(1867);
  });

  it("a period with no row is 0, not the previous period's figure carried forward", async () => {
    primeSupabase(USER_ROWS);
    expect(await getUserCreditsUsed(USER, "2026-11-01T00:00:00.000Z")).toBe(0);
  });

  it("another person's rows are never counted", async () => {
    primeSupabase(USER_ROWS);
    expect(
      await getUserCreditsUsed("eeeeeeee-5555-4555-8555-555555555555", CURRENT)
    ).toBe(0);
  });
});

describe("getMemberCreditsUsed — the same isolation one key wider", () => {
  it("returns ONLY the current period's seat counter", async () => {
    primeSupabase(MEMBER_ROWS);
    const used = await getMemberCreditsUsed(WS, USER, CURRENT);
    expect(used).toBe(310);
    expect(used).not.toBe(310 + 95);
  });

  it("a seat in another workspace is not counted", async () => {
    primeSupabase(MEMBER_ROWS);
    expect(
      await getMemberCreditsUsed(
        "ffffffff-6666-4666-8666-666666666666",
        USER,
        CURRENT
      )
    ).toBe(0);
  });
});
