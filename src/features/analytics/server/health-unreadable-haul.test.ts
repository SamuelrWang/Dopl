/**
 * 🔒 **AN UNREADABLE `system_events` RENDERED AS "All clear in the last 24h"
 * (Samuel #2935, the review of the `max_rows` sweep).**
 *
 * Both degrade hauls in `health.ts` destructured `{ data }` **and never looked at
 * `error`**, so a `42501`, a statement timeout or an RLS change answered
 * `data: null` and fell straight through to `rows: [], truncated: false` — which
 * {@link computeOverallStatus} reads as a **GREEN all-clear** over a table it
 * could not open.
 *
 * ⚠ **AND THE HAULS ARE THE LIVE PATH.** The aggregate migration ships unapplied
 * (this repo's standing gate), so `getRecentAlerts` and `getServerErrorsByRoute`
 * reach their fallback on every real request today — the file's own header says
 * so, and its new contract ("refuses to call a clipped read an all-clear") rests
 * entirely on these two reads reporting honestly.
 *
 * ⚠ **`truncated: true` IS THE HONEST FIELD FOR A READ THAT RETURNED NOTHING, NOT
 * A STRETCH OF IT.** {@link OverallStatus} already defines it as *"`green` is
 * 'nothing in the sample', not 'nothing'"*, and no sample at all is the extreme of
 * exactly that — which is why the banner needed no new arm: the level still rests
 * on positive findings and only the REASON stops claiming an absence.
 *
 * ⚠ **A 500 IS NOT THE ALTERNATIVE.** Each panel sits in the /admin/health fan and
 * a throw blanks the page, the trade `getMcpHealth` already records. The failure
 * is LOGGED rather than swallowed.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - restore `const { data } = await db.from("system_events")…` on the alerts haul
 *    → "an unreadable alerts haul is NOT an all-clear" fails.
 *  - restore it on the routes haul → "an unreadable routes haul…" fails.
 *  - return `truncated: false` from `unreadableHaul` → the banner cases fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  computeOverallStatus,
  getRecentAlerts,
  getServerErrorsByRoute,
} from "./health";

/** The codes an unreadable `system_events` actually answers with: a column/table
 *  GRANT or RLS refusal, and a statement timeout. ⚠ NEITHER is "no rows". */
const UNREADABLE = [
  { code: "42501", message: "permission denied for table system_events" },
  { code: "57014", message: "canceling statement due to statement timeout" },
];

/**
 * A database where the AGGREGATE is absent (the live shape — the migration ships
 * unapplied, so every call degrades to the haul) and the HAUL then fails with
 * `error`.
 *
 * ⚠ **IT ANSWERS THE SAME `{ data: null, error }` TO BOTH**, which is the point:
 * the RPC's `error` was always inspected, and the haul's never was, so the
 * fallback is reached and then silently believed.
 */
function mountUnreadable(error: { code: string; message: string }): void {
  const client: Record<string, unknown> = {};
  Object.assign(client, {
    from: () => client,
    select: () => client,
    gte: () => client,
    in: () => client,
    or: () => client,
    not: () => client,
    order: () => client,
    limit: () => client,
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "function does not exist" },
      }),
    then: (resolve: (r: unknown) => void) => resolve({ data: null, error }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
}

let warned: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  warned = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an unreadable degrade haul is a FLOOR, never an all-clear", () => {
  for (const error of UNREADABLE) {
    it(`an unreadable alerts haul is NOT an all-clear (${error.code})`, async () => {
      mountUnreadable(error);

      const alerts = await getRecentAlerts();

      expect(alerts.rows).toEqual([]);
      // 🔒 THE FIX: `false` here is what produced the green banner below.
      expect(alerts.truncated).toBe(true);
    });

    it(`an unreadable routes haul is NOT an all-clear (${error.code})`, async () => {
      mountUnreadable(error);

      const routes = await getServerErrorsByRoute();

      expect(routes.rows).toEqual([]);
      expect(routes.truncated).toBe(true);
    });
  }

  /**
   * 🔒 **THE BANNER, WHICH IS WHERE THE LIE WAS VISIBLE.** Level stays `green` —
   * red and yellow rest on a POSITIVE finding and there is none to be had from a
   * read that returned nothing — but `truncated` is now true and the REASON stops
   * claiming an absence it has no evidence for. ⚠ `green` + `truncated: false` is
   * the combination this case forbids.
   */
  it("the banner refuses to say 'All clear' over a table it could not open", async () => {
    mountUnreadable(UNREADABLE[0]);

    const status = computeOverallStatus({
      alerts: await getRecentAlerts(),
      routes: await getServerErrorsByRoute(),
    });

    expect(status.truncated).toBe(true);
    expect(status.reason).not.toBe("All clear in the last 24h");
    expect(status.reason).toContain("clipped");
    // ⚠ The forbidden pair, spelled out: an unevidenced all-clear.
    expect(status.level === "green" && status.truncated === false).toBe(false);
  });

  /** ⚠ **LOGGED, NEVER SILENT** — the dashboard says calm and the log says why. */
  it("logs the panel and the code rather than failing quietly", async () => {
    mountUnreadable(UNREADABLE[0]);

    await getRecentAlerts();
    await getServerErrorsByRoute();

    const hauls = warned.filter((w) => w.includes("haul unreadable"));
    expect(hauls).toHaveLength(2);
    expect(hauls[0]).toContain("recent alerts");
    expect(hauls[0]).toContain("42501");
    expect(hauls[1]).toContain("server errors by route");
  });

  /** ⚠ **IT DOES NOT THROW**: a 500 here blanks the whole /admin/health fan, the
   *  trade `getMcpHealth` records. */
  it("does not throw — the fan survives one dead panel", async () => {
    mountUnreadable(UNREADABLE[1]);

    await expect(getRecentAlerts()).resolves.toBeDefined();
    await expect(getServerErrorsByRoute()).resolves.toBeDefined();
  });
});
