/**
 * THE /home USAGE HISTOGRAM'S TWO NARROWINGS — the `channel` and `month`
 * parsers, the scope → origin-container resolution, and the two of them reaching
 * the ledger read (2026-09-13, Samuel's scope dropdown + month arrows).
 *
 * ⚠ **ITS OWN FILE**: `service-overview.test.ts` was at 446 of the 500-line cap
 * (§1) the day these landed, and it owns the window arithmetic and the tallies —
 * a different reason to change.
 *
 * 🔒 **THE CENTRE OF GRAVITY IS WHAT "Desktop agent" *IS*.** `credit_usage_events`
 * has NO channel column: the channel dimension is `origin_workspace_id`, the
 * ADDRESSED CONTAINER, so a channel is its `kind='link'` container and
 * desktop-agent spend is the reader's own `kind='personal'` shelf. ⚠ **A NULL
 * origin is NEITHER** — that column is `ON DELETE SET NULL`, i.e. a deleted
 * container, and bucketing it as "Desktop agent" would invent a source for spend
 * nobody can place. These cases pin all three.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

const repo = vi.hoisted(() => ({
  listOwnedPersonalWalletContainers: vi.fn(),
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
  resolveUsageOrigins,
} from "./overview-series-params";
import { getHomeOverviewSeries } from "./service-overview";
import type { CreditEventScanRow } from "./repository-overview";

const VIEWER = "u1";
const LINK_A = "11111111-1111-4111-8111-111111111111";
const LINK_B = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";
/** A container the reader is a MEMBER of but does not OWN — its burns spend the
 *  owner's wallet, so none of them are ever on this reader's series. */
const NOT_OWNED = "44444444-4444-4444-8444-444444444444";

const CONTAINERS = [
  { id: LINK_A, kind: "link" },
  { id: LINK_B, kind: "link" },
  { id: PERSONAL, kind: "personal" },
];

function burn(over: Partial<CreditEventScanRow> = {}): CreditEventScanRow {
  return {
    origin_workspace_id: LINK_A,
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

  it("accepts the reserved desktop word and a container uuid", () => {
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

describe("resolveUsageOrigins", () => {
  /** 🔒 **NO NARROWING IS NOT "EVERY OWNED CONTAINER".** A row whose container
   *  was DELETED carries a null origin and is still the reader's spend — it has to
   *  stay on the unfiltered plot, which an `in.(…)` over the owned list would drop. */
  it("answers null for the whole wallet", () => {
    expect(resolveUsageOrigins(null, CONTAINERS)).toBeNull();
  });

  /** 🔒 **DESKTOP IS `kind='personal'`, AND ONLY THAT** — the shelf a call naming
   *  no container is resolved to. */
  it("resolves desktop to the personal shelf alone", () => {
    expect(resolveUsageOrigins("desktop", CONTAINERS)).toEqual([PERSONAL]);
  });

  it("resolves a channel to its own container", () => {
    expect(resolveUsageOrigins(LINK_B, CONTAINERS)).toEqual([LINK_B]);
  });

  /**
   * 🔒 **AN UNOWNED ID ANSWERS `[]` — THE FENCE, AND IT COSTS NO ROUND TRIP
   * (INVARIANTS §2).** The caller already read this list for the wallet
   * predicate, so nothing a caller SENT is ever handed to the RLS-bypassing admin
   * client. ⚠ And `[]` is not a refusal: a channel the reader merely JOINED is a
   * legitimate row in their channel list whose burns spend the OWNER's wallet, so
   * "none of your credits went there" is the true answer.
   */
  it("drops a container the reader does not own", () => {
    expect(resolveUsageOrigins(NOT_OWNED, CONTAINERS)).toEqual([]);
  });

  it("drops desktop when the reader has no personal shelf", () => {
    expect(resolveUsageOrigins("desktop", [{ id: LINK_A, kind: "link" }])).toEqual(
      []
    );
  });
});

describe("getHomeOverviewSeries — the narrowed credits arm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.listOwnedPersonalWalletContainers.mockResolvedValue(CONTAINERS);
    repo.scanCreditEvents.mockResolvedValue({ rows: [], truncated: false });
  });

  /** The unnarrowed read passes NO `originIds`, and it bounds the haul at both
   *  ends so a clip is reported rather than silently mis-binned. */
  it("hauls the whole wallet for the current month", async () => {
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      now: NOW,
    });

    expect(series.points).toHaveLength(30);
    expect(series.points[0].at).toBe("2026-09-01T00:00:00.000Z");
    const [, , sinceIso, opts] = repo.scanCreditEvents.mock.calls[0];
    expect(sinceIso).toBe("2026-09-01T00:00:00.000Z");
    expect(opts.untilIso).toBe("2026-10-01T00:00:00.000Z");
    expect(opts.originIds).toBeUndefined();
  });

  it("narrows the haul to one channel's container", async () => {
    await getHomeOverviewSeries(VIEWER, "month", "credits", {
      scope: LINK_B,
      now: NOW,
    });
    expect(repo.scanCreditEvents.mock.calls[0][3].originIds).toEqual([LINK_B]);
  });

  it("narrows the haul to the personal shelf for desktop", async () => {
    await getHomeOverviewSeries(VIEWER, "month", "credits", {
      scope: "desktop",
      now: NOW,
    });
    expect(repo.scanCreditEvents.mock.calls[0][3].originIds).toEqual([PERSONAL]);
  });

  /** 🔒 **A SCOPE THE READER DOES NOT OWN READS AS A ZERO-FILLED MONTH AND ASKS
   *  THE DATABASE NOTHING.** The axis is still the frame (the month ruling), and
   *  PostgREST has no syntax for an empty `in.()` anyway. */
  it("answers a zeroed month without a read when nothing can match", async () => {
    const series = await getHomeOverviewSeries(VIEWER, "month", "credits", {
      scope: NOT_OWNED,
      now: NOW,
    });

    expect(series.points).toHaveLength(30);
    expect(series.points.every((point) => point.count === 0)).toBe(true);
    expect(series.truncated).toBe(false);
    expect(repo.scanCreditEvents).not.toHaveBeenCalled();
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
