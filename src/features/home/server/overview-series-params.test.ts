/**
 * THE /home USAGE HISTOGRAM'S TWO NARROWINGS — the `channel` and `month`
 * parsers, the scope → channel resolution, and the two of them reaching the
 * ledger read (2026-09-13, Samuel's scope dropdown + month arrows).
 *
 * ⚠ **ITS OWN FILE**: `service-overview.test.ts` was at 446 of the 500-line cap
 * (§1) the day these landed, and it owns the window arithmetic and the tallies —
 * a different reason to change.
 *
 * 🔒 **THE CENTRE OF GRAVITY IS THAT THE BUCKETS PARTITION THE WALLET** (rule B,
 * Samuel: "the wallet needs to match the histogram"). A scope is a CHANNEL id and
 * "Desktop agent" is `channel_id IS NULL`, so every row the wallet charged sits in
 * exactly one bucket and the buckets sum to the unfiltered plot.
 *
 * ⚠ **THIS FILE ASSERTED THE OPPOSITE FOR ONE DAY.** Its superseded header said
 * `credit_usage_events` had no channel column, so a channel was its `kind='link'`
 * CONTAINER and Desktop agent was the reader's `kind='home'` shelf — a
 * partition that dropped every burn a home channel's agent made against another
 * container, which is exactly the traffic rule B moved onto that channel's wallet.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

const repo = vi.hoisted(() => ({
  listOwnedHomeSpaceIds: vi.fn(),
  scanCreditEvents: vi.fn(),
}));

vi.mock("./repository-overview", async () => {
  const actual =
    await vi.importActual<typeof import("./repository-overview")>(
      "./repository-overview"
    );
  return { ...actual, ...repo };
});

import {
  parseUsageMonth,
  parseUsageScope,
  resolveUsageChannel,
} from "./overview-series-params";
import { getHomeOverviewSeries } from "./service-overview";
import type { CreditEventScanRow } from "./repository-overview";

const VIEWER = "u1";
const LINK_A = "11111111-1111-4111-8111-111111111111";
const LINK_B = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";
/** A channel the reader is a MEMBER of but whose container they do not OWN — its
 *  burns spend the owner's wallet, so none of them are ever on this reader's
 *  series. */
const NOT_OWNED = "44444444-4444-4444-8444-444444444444";
/** A CHANNEL id — what the dropdown sends since rule B. */
const CHANNEL_B = "55555555-5555-4555-8555-555555555555";

const OWNED_IDS = [LINK_A, LINK_B, PERSONAL];

function burn(over: Partial<CreditEventScanRow> = {}): CreditEventScanRow {
  return {
    origin_workspace_id: LINK_A,
    channel_id: null,
    user_id: VIEWER,
    wallet: "personal",
    payer_user_id: VIEWER,
    amount: 1,
    created_at: "2026-09-04T12:00:00.000Z",
    ...over,
  };
}

const NOW = new Date("2026-09-13T13:37:00.000Z");

describe("parseUsageScope", () => {
  /** ⚠ ABSENT, EMPTY AND THE RESERVED `all` ARE ONE ANSWER — no narrowing. */
  it.each([null, "", "all"])("reads %o as the whole wallet", (raw) => {
    expect(parseUsageScope(raw)).toBeNull();
  });

  it("accepts the reserved desktop word and a channel uuid", () => {
    expect(parseUsageScope("desktop")).toBe("desktop");
    expect(parseUsageScope(LINK_A)).toBe(LINK_A);
  });

  /**
   * 🔒 **AN UNRECOGNISED VALUE IS A 400, NEVER A SILENTLY UNFILTERED PLOT** —
   * `parseRange` / `parseMetric`'s own rule. Ignoring the param would draw the
   * WHOLE wallet under a channel's name, which is the class of lie this endpoint's
   * parsers exist to refuse.
   */
  it.each(["everything", "channel-1", "DESKTOP", "../../etc"])(
    "400s the scope %o",
    (raw) => {
      expect(() => parseUsageScope(raw)).toThrow(HttpError);
      try {
        parseUsageScope(raw);
      } catch (err) {
        expect((err as HttpError).status).toBe(400);
        expect((err as HttpError).code).toBe("INVALID_CHANNEL");
      }
    }
  );
});

describe("parseUsageMonth", () => {
  it("reads an absent month as the current one", () => {
    expect(parseUsageMonth(null, "month")).toBeNull();
    expect(parseUsageMonth("", "month")).toBeNull();
  });

  /** ⚠ THE ANCHOR IS ANY INSTANT INSIDE THE MONTH — `rangeWindows` reads only
   *  the UTC year and month off it. Midday, so no downstream timezone slip can
   *  walk it into the previous month. */
  it("anchors YYYY-MM inside that UTC month", () => {
    const at = parseUsageMonth("2026-02", "month") as Date;
    expect(at.getUTCFullYear()).toBe(2026);
    expect(at.getUTCMonth()).toBe(1);
    expect(at.getUTCHours()).toBe(12);
  });

  it.each(["2026-13", "2026-00", "26-09", "2026-9", "September", "2026-09-01"])(
    "400s the month %o",
    (raw) => {
      expect(() => parseUsageMonth(raw, "month")).toThrow(HttpError);
    }
  );

  /**
   * 🔒 **A `month` BESIDE A ROLLING RANGE IS REFUSED, NOT HONOURED.**
   * `rangeWindows` ends `24h`/`7d`/`30d` AT the instant it is handed, so an
   * anchor there would answer "the 30 days ending on the 1st of February" under a
   * heading that says the last 30 days.
   */
  it.each(["24h", "7d", "30d"] as const)("400s month beside range=%s", (range) => {
    expect(() => parseUsageMonth("2026-02", range)).toThrow(HttpError);
    try {
      parseUsageMonth("2026-02", range);
    } catch (err) {
      expect((err as HttpError).code).toBe("INVALID_MONTH");
    }
  });
});

describe("resolveUsageChannel", () => {
  /** 🔒 **NO NARROWING IS NOT "EVERY CHANNEL".** A row with no channel (Desktop
   *  agent, and every row older than the column) is still the reader's spend and
   *  has to stay on the unfiltered plot, which an `eq` over any id would drop. */
  it("answers null for the whole wallet", () => {
    expect(resolveUsageChannel(null)).toBeNull();
  });

  /** 🔒 **DESKTOP IS THE ABSENCE OF A CHANNEL**, which no id can name — so the
   *  narrowing is `IS NULL` and not a list of containers. */
  it("resolves desktop to the unattributed bucket", () => {
    expect(resolveUsageChannel("desktop")).toBe("unattributed");
  });

  it("resolves a channel id to that channel", () => {
    expect(resolveUsageChannel(CHANNEL_B)).toEqual({ channelId: CHANNEL_B });
  });

  /**
   * 🔒 **AN UNOWNED CHANNEL IS PASSED THROUGH, NOT DROPPED — AND THAT IS SAFE
   * BECAUSE THE SCAN'S FENCE IS THE PAYER (INVARIANTS §2).** ⚠ **THE SUPERSEDED
   * FUNCTION INTERSECTED IT WITH THE READER'S OWN CONTAINERS**, because a
   * container id is an ADDRESSING input handed to the RLS-bypassing admin client.
   * A channel id is not: it composes as an `AND` on top of
   * `payer_user_id = reader`, so it can only HIDE the reader's own rows. The
   * answer for a channel they merely JOINED is still a zero-filled month — by
   * construction now, rather than by a short-circuit.
   */
  it("passes an unowned channel through to the read", () => {
    expect(resolveUsageChannel(NOT_OWNED)).toEqual({ channelId: NOT_OWNED });
  });
});

describe("getHomeOverviewSeries — the narrowed credits arm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.listOwnedHomeSpaceIds.mockResolvedValue(OWNED_IDS);
    repo.scanCreditEvents.mockResolvedValue({ rows: [], truncated: false });
  });

  /** The unnarrowed read passes NO `channel`, and it bounds the haul at both ends
   *  so a clip is reported rather than silently mis-binned. */
  it("hauls the whole wallet for the current month", async () => {
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(series.points).toHaveLength(30);
    expect(series.points[0].at).toBe("2026-09-01T00:00:00.000Z");
    const [, , sinceIso, opts] = repo.scanCreditEvents.mock.calls[0];
    expect(sinceIso).toBe("2026-09-01T00:00:00.000Z");
    expect(opts.untilIso).toBe("2026-10-01T00:00:00.000Z");
    expect(opts.channel).toBeUndefined();
  });

  it("narrows the haul to one CHANNEL", async () => {
    await getHomeOverviewSeries(VIEWER, "month", "credits", {
      scope: CHANNEL_B,
      now: NOW,
    });
    expect(repo.scanCreditEvents.mock.calls[0][3].channel).toEqual({
      channelId: CHANNEL_B,
    });
  });

  it("narrows the haul to the unattributed rows for desktop", async () => {
    await getHomeOverviewSeries(VIEWER, "month", "credits", {
      scope: "desktop",
      now: NOW,
    });
    expect(repo.scanCreditEvents.mock.calls[0][3].channel).toBe("unattributed");
  });

  /** 🔒 **A CHANNEL THE READER DOES NOT OWN READS AS A ZERO-FILLED MONTH** — the
   *  axis is still the frame (the month ruling). ⚠ **IT USED TO SKIP THE READ**,
   *  when the scope was a container id the service had to intersect first; the
   *  wallet fence answers it now, which is one branch and one round trip fewer. */
  it("answers a zeroed month for a channel none of the reader's rows carry", async () => {
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      scope: NOT_OWNED,
      now: NOW,
    });

    expect(series.points).toHaveLength(30);
    expect(series.points.every((point) => point.count === 0)).toBe(true);
    expect(series.truncated).toBe(false);
    expect(repo.scanCreditEvents.mock.calls[0][3].channel).toEqual({
      channelId: NOT_OWNED,
    });
  });

  /**
   * 🔒 **THE MONTH ANCHOR MOVES THE WHOLE WINDOW — BINS, HAUL BOUNDS AND ALL.**
   * February is the case worth pinning: 28 bins, and the `untilIso` is 1 March
   * rather than "now", which is what stops a newest-first capped scan from
   * answering with September's rows.
   */
  it("plots a past month from its anchor, bounded at both ends", async () => {
    repo.scanCreditEvents.mockResolvedValue({
      rows: [
        burn({ created_at: "2026-02-03T09:00:00.000Z", amount: 4 }),
        // ⚠ OUTSIDE EVERY BIN — dropped, never folded into the nearest bar.
        burn({ created_at: "2026-03-02T09:00:00.000Z", amount: 99 }),
      ],
      truncated: true,
    });

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      monthAnchor: new Date(Date.UTC(2026, 1, 1, 12)),
      now: NOW,
    });

    expect(series.points).toHaveLength(28);
    expect(series.points[2]).toEqual({
      at: "2026-02-03T00:00:00.000Z",
      count: 4,
    });
    expect(series.points.reduce((sum, point) => sum + point.count, 0)).toBe(4);
    // ⚠ THE CLIP TRAVELS (§9) — a bounded haul that hit its ceiling is a floor.
    expect(series.truncated).toBe(true);
    const opts = repo.scanCreditEvents.mock.calls[0][3];
    expect(opts.untilIso).toBe("2026-03-01T00:00:00.000Z");
  });

  /**
   * 🔒 **THE WALLET PREDICATE STILL RUNS OVER THE NARROWED HAUL** — "filtered
   * twice on purpose" (`overview-tally.ts › isPersonalWalletBurn`). A `seat` row
   * the pushdown let through is still not the reader's, and this fails CLOSED.
   */
  it("still drops a row the wallet predicate rejects", async () => {
    repo.scanCreditEvents.mockResolvedValue({
      rows: [
        burn({ created_at: "2026-09-02T09:00:00.000Z", amount: 5 }),
        burn({
          created_at: "2026-09-02T10:00:00.000Z",
          amount: 50,
          wallet: "seat",
          payer_user_id: VIEWER,
        }),
      ],
      truncated: false,
    });

    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(series.points.reduce((sum, point) => sum + point.count, 0)).toBe(5);
  });
});
