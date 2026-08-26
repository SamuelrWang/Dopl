/**
 * `service-overview.ts` — the four things a renderer would otherwise have to
 * trust: metric validation, the zero-filled 31-point series, the ACTIVITY FENCE
 * (visible channels only, resolved server-side), and the member-load ratios.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HttpError } from "@/shared/lib/http-error";

vi.mock("./repository-overview", () => ({
  countMessagesSince: vi.fn(),
  countRunningSessions: vi.fn(),
  countActiveMembers: vi.fn(),
  countOpenChannels: vi.fn(),
  listVisibleChannelRefs: vi.fn(),
  listRecentMessages: vi.fn(),
  listRecentTasksOpened: vi.fn(),
  listRecentTasksClosed: vi.fn(),
  listRecentUserMessageAuthors: vi.fn(),
  countMessagesInWindow: vi.fn(),
  countMcpCallsInWindow: vi.fn(),
  countThreadsInWindow: vi.fn(),
}));
vi.mock("./repository", () => ({ listProfileSummaries: vi.fn() }));

import {
  getWorkspaceOverview,
  getWorkspaceOverviewSeries,
  mergeActivity,
  parseSeriesMetric,
  seriesWindows,
  tallyMemberLoad,
  OVERVIEW_SERIES_DAYS,
} from "./service-overview";
import * as repo from "./repository-overview";
import { listProfileSummaries } from "./repository";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-22T09:30:00.000Z");

const mocked = vi.mocked(repo);
const mockProfiles = vi.mocked(listProfileSummaries);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.countMessagesSince.mockResolvedValue(0);
  mocked.countRunningSessions.mockResolvedValue(0);
  mocked.countActiveMembers.mockResolvedValue(0);
  mocked.countOpenChannels.mockResolvedValue(0);
  mocked.listVisibleChannelRefs.mockResolvedValue([]);
  mocked.listRecentMessages.mockResolvedValue([]);
  mocked.listRecentTasksOpened.mockResolvedValue([]);
  mocked.listRecentTasksClosed.mockResolvedValue([]);
  mocked.listRecentUserMessageAuthors.mockResolvedValue([]);
  mocked.countMessagesInWindow.mockResolvedValue(0);
  mocked.countMcpCallsInWindow.mockResolvedValue(0);
  mocked.countThreadsInWindow.mockResolvedValue(0);
  mockProfiles.mockResolvedValue(new Map());
});

describe("parseSeriesMetric", () => {
  it("accepts exactly the three metrics the histogram can plot", () => {
    expect(parseSeriesMetric("messages")).toBe("messages");
    expect(parseSeriesMetric("mcp")).toBe("mcp");
    expect(parseSeriesMetric("threads")).toBe("threads");
  });

  it("400s an unrecognised metric instead of falling through to a default", () => {
    // ⚠ A default series answers a question nobody asked, drawn as fact.
    for (const bad of ["", "Messages", "sessions", "messages;drop"]) {
      let thrown: unknown;
      try {
        parseSeriesMetric(bad);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).status).toBe(400);
      expect((thrown as HttpError).code).toBe("INVALID_METRIC");
    }
  });

  it("400s a missing metric — absent is not 'messages'", () => {
    expect(() => parseSeriesMetric(null)).toThrow(HttpError);
  });
});

describe("seriesWindows", () => {
  it("is 31 contiguous UTC days ending on today, oldest first", () => {
    const windows = seriesWindows(NOW);
    expect(windows).toHaveLength(OVERVIEW_SERIES_DAYS);
    expect(windows[0].date).toBe("2026-07-23");
    expect(windows.at(-1)?.date).toBe("2026-08-22");
    // Each bin is [midnight, next midnight) and abuts its neighbour.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startIso).toBe(windows[i - 1].endIso);
    }
    expect(windows.at(-1)?.startIso).toBe("2026-08-22T00:00:00.000Z");
  });

  it("bins by UTC day, not by the server's local day", () => {
    // 23:30 UTC on the 22nd is already the 23rd in some zones; the label must
    // not move with the box the route happens to run on.
    expect(seriesWindows(new Date("2026-08-22T23:30:00.000Z")).at(-1)?.date).toBe(
      "2026-08-22"
    );
  });
});

describe("getWorkspaceOverviewSeries", () => {
  it("zero-fills every day, so a silent day is a counted zero", async () => {
    mocked.countMessagesInWindow.mockResolvedValue(0);
    mocked.countMessagesInWindow.mockResolvedValueOnce(4);

    const series = await getWorkspaceOverviewSeries(WORKSPACE, "messages", null, NOW);

    expect(series.metric).toBe("messages");
    expect(series.days).toHaveLength(OVERVIEW_SERIES_DAYS);
    expect(series.days.filter((d) => d.count === 0)).toHaveLength(
      OVERVIEW_SERIES_DAYS - 1
    );
    expect(series.days.map((d) => d.date)).toEqual(
      seriesWindows(NOW).map((w) => w.date)
    );
  });

  it("routes each metric to its own counter and to no other", async () => {
    await getWorkspaceOverviewSeries(WORKSPACE, "mcp", null, NOW);
    expect(mocked.countMcpCallsInWindow).toHaveBeenCalledTimes(
      OVERVIEW_SERIES_DAYS
    );
    expect(mocked.countMessagesInWindow).not.toHaveBeenCalled();
    expect(mocked.countThreadsInWindow).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocked.countThreadsInWindow.mockResolvedValue(1);
    const threads = await getWorkspaceOverviewSeries(WORKSPACE, "threads", null, NOW);
    expect(mocked.countThreadsInWindow).toHaveBeenCalledTimes(
      OVERVIEW_SERIES_DAYS
    );
    expect(threads.days.every((d) => d.count === 1)).toBe(true);
  });

  /**
   * The channel-scoped view (2026-08-25). ⚠ The VISIBILITY fence is the route's
   * (`overview-series/route.test.ts`); what these pin is that the scope
   * actually reaches the counters, and that the one metric which cannot carry
   * it is REFUSED rather than silently answered workspace-wide.
   */
  it("hands the channel scope to every bin of a scopeable metric", async () => {
    mocked.countMessagesInWindow.mockResolvedValue(0);
    await getWorkspaceOverviewSeries(WORKSPACE, "messages", "chan-1", NOW);
    expect(mocked.countMessagesInWindow).toHaveBeenCalledTimes(
      OVERVIEW_SERIES_DAYS
    );
    // Every bin, not just the first — a scope applied to one window and
    // dropped from the rest draws a real number beside 30 wrong ones.
    for (const call of mocked.countMessagesInWindow.mock.calls) {
      expect(call[2]).toBe("chan-1");
    }

    vi.clearAllMocks();
    mocked.countThreadsInWindow.mockResolvedValue(0);
    await getWorkspaceOverviewSeries(WORKSPACE, "threads", "chan-1", NOW);
    for (const call of mocked.countThreadsInWindow.mock.calls) {
      expect(call[2]).toBe("chan-1");
    }
  });

  it("passes NULL through when unscoped — the workspace-wide series is unchanged", async () => {
    mocked.countMessagesInWindow.mockResolvedValue(0);
    await getWorkspaceOverviewSeries(WORKSPACE, "messages", null, NOW);
    for (const call of mocked.countMessagesInWindow.mock.calls) {
      expect(call[2]).toBeNull();
    }
  });

  it("⚠ REFUSES a channel-scoped `mcp` series rather than answering workspace-wide", async () => {
    // `mcp_tool_calls` has no `channel_id`, so the question has no answer in
    // this schema. Answering it with the workspace's number under a
    // channel-scoped label is the fabrication §9 forbids.
    await expect(
      getWorkspaceOverviewSeries(WORKSPACE, "mcp", "chan-1", NOW)
    ).rejects.toMatchObject({ status: 400, code: "CHANNEL_SCOPE_UNSUPPORTED" });
    expect(mocked.countMcpCallsInWindow).not.toHaveBeenCalled();
  });
});

describe("tallyMemberLoad", () => {
  it("is a share of the scanned total, top 6, descending", () => {
    const authors = [
      ...Array(5).fill("u1"),
      ...Array(3).fill("u2"),
      ...Array(2).fill("u3"),
    ];
    const names = new Map<string, string | null>([
      ["u1", "Ada"],
      ["u2", "Grace"],
    ]);

    const load = tallyMemberLoad(authors, names);

    expect(load.totalMessages).toBe(10);
    expect(load.rows).toEqual([
      { userId: "u1", name: "Ada", percent: 50 },
      { userId: "u2", name: "Grace", percent: 30 },
      { userId: "u3", name: "", percent: 20 },
    ]);
  });

  it("keeps only the top 6 bars", () => {
    const authors = Array.from({ length: 9 }, (_, i) =>
      Array(9 - i).fill(`u${i}`)
    ).flat();
    const load = tallyMemberLoad(authors, new Map());
    expect(load.rows).toHaveLength(6);
    expect(load.rows[0].userId).toBe("u0");
  });

  it("returns a zero denominator rather than dividing by it", () => {
    expect(tallyMemberLoad([], new Map())).toEqual({
      totalMessages: 0,
      rows: [],
    });
  });
});

describe("mergeActivity", () => {
  const channelNames = new Map([["c1", "general"]]);
  const names = new Map<string, string | null>([["u1", "Ada"]]);

  it("interleaves the three feeds newest-first and caps at 8", () => {
    const rows = mergeActivity({
      messages: Array.from({ length: 8 }, (_, i) => ({
        id: `m${i}`,
        channel_id: "c1",
        author_user_id: "u1",
        body: "hello",
        created_at: `2026-08-${10 + i}T00:00:00.000Z`,
      })),
      opened: [
        {
          id: "t1",
          channel_id: "c1",
          title: "Ship it",
          created_by: "u1",
          created_at: "2026-08-21T00:00:00.000Z",
          closed_at: null,
        },
      ],
      closed: [
        {
          id: "t0",
          channel_id: "c1",
          title: "Old thing",
          created_by: "u1",
          created_at: "2026-08-01T00:00:00.000Z",
          closed_at: "2026-08-22T00:00:00.000Z",
        },
      ],
      channelNames,
      names,
    });

    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({
      id: "thread_closed:t0",
      kind: "thread_closed",
    });
    expect(rows[1]).toMatchObject({
      id: "thread_opened:t1",
      kind: "thread_opened",
      actorName: "Ada",
    });
    expect(rows.map((r) => r.at)).toEqual(
      [...rows].map((r) => r.at).sort().reverse()
    );
  });

  it("leaves thread_closed unattributed — the schema records no closer", () => {
    const [row] = mergeActivity({
      messages: [],
      opened: [],
      closed: [
        {
          id: "t0",
          channel_id: "c1",
          title: "Done",
          created_by: "u1",
          created_at: "2026-08-01T00:00:00.000Z",
          closed_at: "2026-08-22T00:00:00.000Z",
        },
      ],
      channelNames,
      names,
    });
    // ⚠ Naming the OPENER here would be a fabrication, not a fallback.
    expect(row.actorName).toBeNull();
  });

  it("truncates the preview server-side and collapses whitespace", () => {
    const [row] = mergeActivity({
      messages: [
        {
          id: "m1",
          channel_id: "c1",
          author_user_id: null,
          body: `${"x".repeat(400)}\n\n  y`,
          created_at: "2026-08-22T00:00:00.000Z",
        },
      ],
      opened: [],
      closed: [],
      channelNames,
      names,
    });
    expect(row.preview).toHaveLength(120);
    expect(row.preview.endsWith("…")).toBe(true);
    expect(row.actorName).toBeNull();
  });
});

describe("getWorkspaceOverview", () => {
  it("fences activity to the caller's VISIBLE channels, server-side", async () => {
    mocked.listVisibleChannelRefs.mockResolvedValue([
      { id: "c1", name: "general" },
      { id: "c2", name: "private-ops" },
    ]);

    await getWorkspaceOverview(WORKSPACE, "user-1", NOW);

    expect(mocked.listVisibleChannelRefs).toHaveBeenCalledWith(
      WORKSPACE,
      "user-1"
    );
    // ⚠ Every activity read takes the fenced id list as its ENTIRE fence —
    // these run on the RLS-bypassing admin client.
    for (const fn of [
      mocked.listRecentMessages,
      mocked.listRecentTasksOpened,
      mocked.listRecentTasksClosed,
    ]) {
      expect(fn).toHaveBeenCalledWith(["c1", "c2"], 8);
    }
  });

  it("never reads activity at all when the caller can see no channel", async () => {
    mocked.listVisibleChannelRefs.mockResolvedValue([]);
    const overview = await getWorkspaceOverview(WORKSPACE, "user-1", NOW);
    expect(mocked.listRecentMessages).toHaveBeenCalledWith([], 8);
    expect(overview.activity).toEqual([]);
  });

  it("counts workspace-wide — an unfenced caller still gets true totals", async () => {
    mocked.countMessagesSince.mockResolvedValue(12);
    mocked.countRunningSessions.mockResolvedValue(3);
    mocked.countActiveMembers.mockResolvedValue(5);
    mocked.countOpenChannels.mockResolvedValue(7);

    const overview = await getWorkspaceOverview(WORKSPACE, "user-1", NOW);

    expect(overview.counts).toEqual({
      messagesToday: 12,
      agentsRunning: 3,
      members: 5,
      channels: 7,
    });
    expect(mocked.countMessagesSince).toHaveBeenCalledWith(
      WORKSPACE,
      "2026-08-22T00:00:00.000Z"
    );
  });

  it("resolves names once, display name over email, for both cards", async () => {
    mocked.listRecentUserMessageAuthors.mockResolvedValue(["u1", "u1", "u2"]);
    mockProfiles.mockResolvedValue(
      new Map([
        ["u1", { email: "ada@x.dev", displayName: "Ada", avatarUrl: null }],
        ["u2", { email: "grace@x.dev", displayName: null, avatarUrl: null }],
      ])
    );

    const overview = await getWorkspaceOverview(WORKSPACE, "user-1", NOW);

    expect(mockProfiles).toHaveBeenCalledTimes(1);
    expect(mockProfiles).toHaveBeenCalledWith(["u1", "u2"]);
    expect(overview.memberLoad).toEqual({
      totalMessages: 3,
      rows: [
        { userId: "u1", name: "Ada", percent: 67 },
        { userId: "u2", name: "grace@x.dev", percent: 33 },
      ],
    });
  });

  it("scans the member-load window from 30 UTC days back, inclusive of today", async () => {
    await getWorkspaceOverview(WORKSPACE, "user-1", NOW);
    expect(mocked.listRecentUserMessageAuthors).toHaveBeenCalledWith(
      WORKSPACE,
      "2026-07-24T00:00:00.000Z",
      10_000
    );
  });
});
