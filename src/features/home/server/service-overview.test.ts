/**
 * The /home Overview service's PURE half: window arithmetic, the two parsers,
 * and the four tallies.
 *
 * ⚠ THE READS ARE NOT EXERCISED HERE. Everything in `getHomeOverview` below the
 * fence is a `supabaseAdmin()` call, and a suite that mocked nine of them would
 * assert that the mocks were called rather than that the numbers are right. What
 * IS pinned here is every decision the payload's honesty rests on: an
 * unrecognised range is a refusal, a person with no account is dropped rather
 * than bucketed, and a quiet channel keeps its row.
 *
 * ⚠ **THE `mapAttention` BLOCK WENT WITH ITS PANEL ON 2026-09-05.** The
 * urgency-ordering cases lived here because **Waiting on you** rendered them;
 * the panel, its three reads and the mapper were all cut together, so the cases
 * were deleted rather than left asserting a function nothing calls.
 */

import { describe, expect, it } from "vitest";
import { HttpError } from "@/shared/lib/http-error";
import type { Role } from "@/features/workspaces/types";
import {
  bucketFor,
  parseMetric,
  parseRange,
  rangeSince,
  rangeWindows,
} from "./service-overview";
// ⚠ THE PURE HALF LIVES NEXT DOOR (2026-09-01) — `overview-tally.ts`, split out
// when the activity sections took the service past the 500-line cap. It does no
// IO, which is why almost every case in this file can import it directly and
// mock nothing.
import { tallyChannels, tallyCreditPeople, tallyTools } from "./overview-tally";
import {
  roleKey,
  type CreditEventScanRow,
  type McpCallScanRow,
} from "./repository-overview";

const NOW = new Date("2026-09-01T13:37:00.000Z");

const WS_A = "ws-a";
const WS_B = "ws-b";

function call(over: Partial<McpCallScanRow> = {}): McpCallScanRow {
  return { workspace_id: WS_A, user_id: "u1", tool: "kb", op: "read_file", ...over };
}

/** One `credit_usage_events` row, as the ledger scan hands it over. ⚠ The
 *  channel dimension is `origin_workspace_id` — never the payer. */
function burn(over: Partial<CreditEventScanRow> = {}): CreditEventScanRow {
  return {
    origin_workspace_id: WS_A,
    user_id: "u1",
    amount: 1,
    created_at: "2026-09-01T12:00:00.000Z",
    ...over,
  };
}

describe("parseRange / parseMetric", () => {
  it.each(["24h", "7d", "30d", "month"] as const)("accepts %s", (range) => {
    expect(parseRange(range)).toBe(range);
  });

  it.each(["credits", "mcp", "messages"] as const)(
    "accepts metric %s",
    (metric) => {
      expect(parseMetric(metric)).toBe(metric);
    }
  );

  // ⚠ NEVER A SILENT FALL-THROUGH. A page that answers for 30 days under a
  // "24h" heading is worse than an error (INVARIANTS §9).
  it.each([null, "", "1h", "90d", "MONTH"])("400s the range %o", (raw) => {
    expect(() => parseRange(raw)).toThrow(HttpError);
    try {
      parseRange(raw);
    } catch (err) {
      expect((err as HttpError).status).toBe(400);
      expect((err as HttpError).code).toBe("INVALID_RANGE");
    }
  });

  /**
   * 🔒 **`tokens` STILL DOES NOT EXIST, AND ITS ABSENCE IS THE CONTRACT.**
   * `channel_sessions.tokens_spent` is a live snapshot the desktop overwrites in
   * place, so binning it by any timestamp on that row attributes a running total
   * to one instant. It must stay a 400 rather than become a chart of something
   * nearby.
   *
   * ⚠ **`credits` LEFT THIS LIST ON 2026-09-01** — it was here because
   * `workspace_credit_usage` is a one-row-per-period counter, which was true of
   * THAT table and is why F-328 stood. `credit_usage_events` is a ledger and the
   * metric is real now.
   */
  it.each(["tokens", "threads", "calls", null])("400s the metric %o", (raw) => {
    expect(() => parseMetric(raw)).toThrow(HttpError);
  });
});

describe("rangeWindows", () => {
  it("bins 24h by the hour, ending on the hour NOW falls in", () => {
    const windows = rangeWindows("24h", NOW);
    expect(windows).toHaveLength(24);
    expect(bucketFor("24h")).toBe("hour");
    // The last bin is the CURRENT hour and is deliberately partial — it is "so
    // far this hour", never a bin extended into the future to look finished.
    expect(windows.at(-1)?.startIso).toBe("2026-09-01T13:00:00.000Z");
    expect(windows.at(-1)?.endIso).toBe("2026-09-01T14:00:00.000Z");
    expect(windows[0]?.startIso).toBe("2026-08-31T14:00:00.000Z");
  });

  it.each([
    ["7d", 7, "2026-08-26T00:00:00.000Z"],
    ["30d", 30, "2026-08-03T00:00:00.000Z"],
  ] as const)("bins %s into %i UTC days", (range, bins, first) => {
    const windows = rangeWindows(range, NOW);
    expect(windows).toHaveLength(bins);
    expect(bucketFor(range)).toBe("day");
    expect(windows[0]?.startIso).toBe(first);
    expect(windows.at(-1)?.startIso).toBe("2026-09-01T00:00:00.000Z");
  });

  /**
   * 🔒 **`month` IS THE WHOLE CALENDAR MONTH — 28..31 BINS — AND THE BIN COUNT
   * DOES NOT DEPEND ON TODAY'S DATE (Samuel, 2026-09-01: "show the month").**
   *
   * ⚠ **THIS ASSERTED THE OPPOSITE FOR ONE PASS AND THE TEST WAS THE BUG'S
   * ACCOMPLICE.** It was month-to-DATE, `bins = now.getUTCDate()`, and this case
   * pinned `toHaveLength(1)` on the first of the month — a green suite over a
   * chart that rendered ONE bar stretched across the entire plot. A range whose
   * width collapses on a calendar boundary is not a month.
   */
  it("bins month across the WHOLE calendar month, whatever the day", () => {
    const onTheFirst = rangeWindows("month", NOW);
    expect(onTheFirst).toHaveLength(30);
    expect(onTheFirst[0]?.startIso).toBe("2026-09-01T00:00:00.000Z");
    expect(onTheFirst.at(-1)?.startIso).toBe("2026-09-30T00:00:00.000Z");

    // Mid-month is the SAME axis — the frame does not grow as the month runs.
    const midMonth = rangeWindows("month", new Date("2026-09-14T05:00:00.000Z"));
    expect(midMonth).toEqual(onTheFirst);
  });

  /** ⚠ Month LENGTH is read off the calendar, not a table — February and a leap
   *  February are the cases a hardcoded 30 would get wrong. */
  it.each([
    ["2026-02-10T00:00:00.000Z", 28],
    ["2028-02-10T00:00:00.000Z", 29],
    ["2026-07-04T00:00:00.000Z", 31],
  ])("gives %s its real month length (%i days)", (iso, days) => {
    expect(rangeWindows("month", new Date(iso))).toHaveLength(days);
  });

  it("every bin abuts the next — no gap a row could fall into", () => {
    for (const range of ["24h", "7d", "30d", "month"] as const) {
      const windows = rangeWindows(range, NOW);
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]?.startIso).toBe(windows[i - 1]?.endIso);
      }
    }
  });

  // ⚠ THE TOTALS AND THE BARS DESCRIBE THE SAME WINDOW, or the card and the
  // chart under it are two nearby measurements wearing one heading.
  it("opens the window on the FIRST bin's start", () => {
    for (const range of ["24h", "7d", "30d", "month"] as const) {
      expect(rangeSince(range, NOW)).toBe(rangeWindows(range, NOW)[0]?.startIso);
    }
  });
});

describe("tallyTools", () => {
  it("counts (tool, op) pairs, descending", () => {
    const rows = [
      call({ tool: "kb", op: "read_file" }),
      call({ tool: "kb", op: "read_file" }),
      call({ tool: "channel", op: "post" }),
    ];
    expect(tallyTools(rows)).toEqual([
      { tool: "kb", op: "read_file", calls: 2 },
      { tool: "channel", op: "post", calls: 1 },
    ]);
  });

  it("keeps a tool with no op as its own row rather than a trailing separator", () => {
    expect(tallyTools([call({ tool: "current_workspace", op: "" })])).toEqual([
      { tool: "current_workspace", op: "", calls: 1 },
    ]);
  });

  // ⚠ A TOTAL ORDER, so two loads that measured the same numbers render the
  // same list instead of shuffling.
  it("breaks ties on the key", () => {
    const rows = [call({ tool: "b", op: "x" }), call({ tool: "a", op: "x" })];
    expect(tallyTools(rows).map((row) => row.tool)).toEqual(["a", "b"]);
  });
});

describe("tallyCreditPeople", () => {
  const roles = new Map<string, Role>([
    [roleKey(WS_A, "u1"), "owner"],
    [roleKey(WS_A, "u2"), "guest"],
  ]);
  const names = new Map([
    ["u1", "Samuel"],
    ["u2", "Priya"],
  ]);

  /**
   * 🔒 THE GUEST SPLIT, AND IT COMES FROM `workspace_members`.
   * `channel_members.role` is `CHECK (role IN ('owner','member'))` and has no
   * guest arm at all, so a channel-side read would report every guest as a
   * member — which is the one number Samuel asked this face for.
   *
   * ⚠ THE FIGURE IS CREDITS NOW, not MCP calls: `mcp_tool_calls` counts loopback
   * REQUESTS and was never a cost (F-328's UI half, 2026-09-01).
   */
  it("marks a guest with the CONTAINER role, and sums the ledger amounts", () => {
    const rows = [
      burn({ user_id: "u1" }),
      burn({ user_id: "u2" }),
      burn({ user_id: "u2", amount: 3 }),
    ];
    expect(tallyCreditPeople(rows, roles, names)).toEqual([
      { userId: "u2", name: "Priya", role: "guest", credits: 4 },
      { userId: "u1", name: "Samuel", role: "owner", credits: 1 },
    ]);
  });

  /**
   * ⚠ DROPPED, NOT BUCKETED AS "UNKNOWN". `credit_usage_events.user_id` is
   * `ON DELETE SET NULL`, so a null means the account is GONE — an "Unknown" row
   * in a per-person breakdown reads as a person.
   */
  it("drops a row whose account is gone", () => {
    const rows = [burn({ user_id: null }), burn({ user_id: "u1" })];
    const people = tallyCreditPeople(rows, roles, names);
    expect(people).toHaveLength(1);
    expect(people[0]?.userId).toBe("u1");
  });

  // A departed member's spend survives them; the role is simply unknown.
  it("keeps a person with no ACTIVE membership, at a null role", () => {
    const people = tallyCreditPeople([burn({ user_id: "gone" })], roles, new Map());
    expect(people).toEqual([
      { userId: "gone", name: "", role: null, credits: 1 },
    ]);
  });

  /** ⚠ The container may be DELETED (`origin_workspace_id` is SET NULL) and the
   *  spend still happened — attribute it to the person, at a null role, rather
   *  than losing it. */
  it("keeps a burn whose container is gone", () => {
    const people = tallyCreditPeople(
      [burn({ origin_workspace_id: null, user_id: "u1" })],
      roles,
      names
    );
    expect(people).toEqual([
      { userId: "u1", name: "Samuel", role: null, credits: 1 },
    ]);
  });
});

describe("tallyChannels", () => {
  const names = new Map([
    [WS_A, "Q3 Fundraise"],
    [WS_B, "Priya Shah"],
  ]);

  it("sums credits and counts messages per container, descending by credits", () => {
    const rows = tallyChannels(
      names,
      [
        burn({ origin_workspace_id: WS_B }),
        burn({ origin_workspace_id: WS_B }),
        burn(),
      ],
      [{ workspace_id: WS_A }, { workspace_id: WS_A }]
    );
    expect(rows).toEqual([
      { workspaceId: WS_B, name: "Priya Shah", credits: 2, messages: 0 },
      { workspaceId: WS_A, name: "Q3 Fundraise", credits: 1, messages: 2 },
    ]);
  });

  /**
   * ⚠ A QUIET CHANNEL KEEPS ITS ROW. The comparison is "which of MY channels is
   * busy", and dropping the silent ones turns an honest answer of "none of
   * them" into an empty list that reads as a failed read.
   */
  it("gives every channel in the fence a row, including silent ones", () => {
    const rows = tallyChannels(names, [], []);
    expect(rows.map((row) => row.workspaceId).sort()).toEqual([WS_A, WS_B]);
    expect(rows.every((row) => row.credits === 0 && row.messages === 0)).toBe(true);
  });

  it("ignores a burn for a container outside the fence", () => {
    const rows = tallyChannels(
      names,
      [burn({ origin_workspace_id: "ws-foreign" })],
      []
    );
    expect(rows.every((row) => row.credits === 0)).toBe(true);
  });

  /** ⚠ A burn whose container was deleted has no lane to land in — it is
   *  dropped from the per-CHANNEL rail (and kept in the per-PERSON one). */
  it("ignores a burn whose container is gone", () => {
    const rows = tallyChannels(names, [burn({ origin_workspace_id: null })], []);
    expect(rows.every((row) => row.credits === 0)).toBe(true);
  });
});

