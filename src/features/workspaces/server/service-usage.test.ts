/**
 * `service-usage.ts` — the wave-8 fence, pinned.
 *
 * ⚠ **THE SUBJECT IS THE WALLET BOUNDARY, NOT THE ARITHMETIC.** R-29's privacy
 * half is the whole reason this file exists: a workspace Overview must show SEAT
 * spend and never a personal wallet's, the agent board must carry none of the
 * seven operator-only telemetry columns, and the token-spend read must stay
 * operator-fenced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-usage", () => ({
  scanWorkspaceCreditEvents: vi.fn(),
  scanWorkspaceMcpCalls: vi.fn(),
  scanWorkspaceMessageChannels: vi.fn(),
  listWorkspaceChannelIds: vi.fn(),
  listWorkspaceRunningSessions: vi.fn(),
  listWorkspaceRoles: vi.fn(),
  listWorkspaceTokenSpend: vi.fn(),
}));
vi.mock("./repository", () => ({ listProfileSummaries: vi.fn() }));

import {
  getWorkspaceAgentBoard,
  getWorkspaceTokenSpend,
  getWorkspaceUsage,
  isWorkspaceSeatBurn,
  mapWorkspaceAgents,
  readWorkspaceCreditBins,
  tallyWorkspaceChannels,
  tallyWorkspacePeople,
  tallyWorkspaceTools,
} from "./service-usage";
import * as repo from "./repository-usage";
import { listProfileSummaries } from "./repository";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHAN = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-17T09:30:00.000Z");

const mocked = vi.mocked(repo);

function burn(over: Partial<repo.WorkspaceCreditEventRow> = {}) {
  return {
    origin_workspace_id: WS,
    user_id: "user-1",
    wallet: "seat",
    channel_id: null,
    amount: 1,
    created_at: "2026-09-10T00:00:00.000Z",
    ...over,
  } as repo.WorkspaceCreditEventRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.listWorkspaceChannelIds.mockResolvedValue([CHAN]);
  mocked.scanWorkspaceCreditEvents.mockResolvedValue({
    rows: [],
    truncated: false,
  });
  mocked.scanWorkspaceMcpCalls.mockResolvedValue({ rows: [], truncated: false });
  mocked.scanWorkspaceMessageChannels.mockResolvedValue({
    rows: [],
    truncated: false,
  });
  mocked.listWorkspaceRoles.mockResolvedValue(new Map());
  mocked.listWorkspaceRunningSessions.mockResolvedValue({
    rows: [],
    truncated: false,
  });
  mocked.listWorkspaceTokenSpend.mockResolvedValue({
    rows: [],
    truncated: false,
  });
  vi.mocked(listProfileSummaries).mockResolvedValue(new Map());
});

describe("isWorkspaceSeatBurn — the meters must not mix", () => {
  it("takes a seat burn addressed at this container", () => {
    expect(isWorkspaceSeatBurn(burn(), WS, new Set())).toBe(true);
  });

  it("takes a seat burn whose CHANNEL is here but whose origin is not (rule B)", () => {
    // A workspace-channel agent reading somebody's personal KB charges the
    // caller's seat HERE; `origin_workspace_id` is the personal container.
    const row = burn({ origin_workspace_id: OTHER, channel_id: CHAN });
    expect(isWorkspaceSeatBurn(row, WS, new Set([CHAN]))).toBe(true);
  });

  it("REFUSES a personal-wallet row even when it is addressed at this container", () => {
    // Rule B arm 1: a home channel's agent reaching into this workspace's KB
    // spends the channel owner's wallet. That credit is on /home's figure and on
    // no figure here — summing the two was the 2026-09-12 bug.
    const row = burn({ wallet: "personal" });
    expect(isWorkspaceSeatBurn(row, WS, new Set([CHAN]))).toBe(false);
  });

  it("REFUSES another container's seat burn", () => {
    const row = burn({ origin_workspace_id: OTHER, channel_id: null });
    expect(isWorkspaceSeatBurn(row, WS, new Set([CHAN]))).toBe(false);
  });

  it("takes the LEGACY pooled wallet, and fails closed on an unknown one", () => {
    expect(isWorkspaceSeatBurn(burn({ wallet: "workspace" }), WS, new Set())).toBe(
      true
    );
    expect(isWorkspaceSeatBurn(burn({ wallet: "future" }), WS, new Set())).toBe(
      false
    );
  });

  it("re-applies the predicate over the scan — the pushdown is not trusted", async () => {
    mocked.scanWorkspaceCreditEvents.mockResolvedValue({
      rows: [burn(), burn({ wallet: "personal", amount: 99 })],
      truncated: false,
    });
    const { counts } = await readWorkspaceCreditBins(WS, [
      { startIso: "2026-09-10T00:00:00.000Z", endIso: "2026-09-11T00:00:00.000Z" },
    ]);
    expect(counts).toEqual([1]);
  });
});

describe("the rails", () => {
  it("gives every VISIBLE channel a row and drops burns in the rest", () => {
    const rows = tallyWorkspaceChannels(
      [{ id: CHAN, name: "General" }],
      [burn({ channel_id: CHAN, amount: 4 }), burn({ channel_id: OTHER, amount: 9 })],
      [{ channel_id: CHAN }, { channel_id: OTHER }]
    );
    expect(rows).toEqual([
      { channelId: CHAN, name: "General", credits: 4, messages: 1 },
    ]);
  });

  it("drops a burn with no user rather than bucketing it as 'Unknown'", () => {
    const rows = tallyWorkspacePeople(
      [burn({ user_id: null }), burn({ user_id: "u2", amount: 3 })],
      new Map([["u2", "guest" as const]]),
      new Map([["u2", "Ada"]])
    );
    expect(rows).toEqual([
      { userId: "u2", name: "Ada", role: "guest", credits: 3 },
    ]);
  });

  it("DROPS A DEPARTED MEMBER — the rail is fenced as the members console is", async () => {
    // 🔒 The roster is `status='active'` and departure is a row DELETE
    // (`membership-admin.ts`), so a person who has left is absent from the
    // members page — and their NAME and figure are absent here. The spend still
    // counts on the series above, which is integers.
    const gone = "u-gone";
    mocked.scanWorkspaceCreditEvents.mockResolvedValue({
      rows: [burn({ user_id: gone, amount: 500 }), burn({ user_id: "u2", amount: 3 })],
      truncated: false,
    });
    mocked.listWorkspaceRoles.mockResolvedValue(new Map([["u2", "member"]]));
    vi.mocked(listProfileSummaries).mockResolvedValue(
      new Map([["u2", { displayName: "Ada", email: "ada@example.com" }]]) as never
    );

    const usage = await getWorkspaceUsage(WS, [], NOW);

    expect(usage.people).toEqual([
      { userId: "u2", name: "Ada", role: "member", credits: 3 },
    ]);
    // ⚠ AND THE PROFILE IS NEVER EVEN FETCHED — a name the page may not print
    // must not cross the service boundary either.
    expect(vi.mocked(listProfileSummaries)).toHaveBeenCalledWith(["u2"]);
  });

  it("keeps a VIEWER-FILTERED colleague off the channel rail while their burn stays on the plot", async () => {
    // The by-channel rail prints a NAME, so a room the caller cannot open has no
    // row — but the same burn is still one of the series' integers.
    mocked.scanWorkspaceCreditEvents.mockResolvedValue({
      rows: [burn({ channel_id: CHAN, amount: 7 })],
      truncated: false,
    });
    const usage = await getWorkspaceUsage(WS, [], NOW);
    expect(usage.channels).toEqual([]);

    const { counts } = await readWorkspaceCreditBins(WS, [
      { startIso: "2026-09-10T00:00:00.000Z", endIso: "2026-09-11T00:00:00.000Z" },
    ]);
    expect(counts).toEqual([7]);
  });

  it("renders an EMPTY container as empty lists, never as NaN or a missing key", async () => {
    const usage = await getWorkspaceUsage(WS, [], NOW);
    expect(usage.channels).toEqual([]);
    expect(usage.people).toEqual([]);
    expect(usage.tools).toEqual([]);
    expect(usage.scanned).toBe(0);
    expect(usage.truncated).toBe(false);
  });

  it("orders tools by calls and breaks ties on the key", () => {
    const rows = tallyWorkspaceTools([
      { tool: "b", op: "x" },
      { tool: "a", op: "x" },
      { tool: "b", op: "x" },
    ]);
    expect(rows.map((r) => `${r.tool}:${r.op}=${r.calls}`)).toEqual([
      "b:x=2",
      "a:x=1",
    ]);
  });

  it("reports a clipped scan as truncated, with the denominator beside it", async () => {
    mocked.scanWorkspaceMcpCalls.mockResolvedValue({
      rows: [{ tool: "t", op: "o" }],
      truncated: true,
    });
    const usage = await getWorkspaceUsage(WS, [], NOW);
    expect(usage.truncated).toBe(true);
    expect(usage.scanned).toBe(1);
    // The window is the CURRENT CALENDAR MONTH — the credit period, not a range.
    expect(usage.since).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("the agent board — R-25 and the privacy half", () => {
  const session = {
    id: "s1",
    channel_id: CHAN,
    user_id: "peer",
    task_id: "t1",
    name: "agent_abc12345",
    display_name: null,
    state: "working",
    detail: "thinking",
    channel_name: "stale",
    thread_title: "Ship it",
    updated_at: "2026-09-17T09:00:00.000Z",
  } as repo.WorkspaceSessionRow;

  it("carries NO model, tool label, token or context figure", () => {
    const [row] = mapWorkspaceAgents([session], new Map([[CHAN, "General"]]), "me");
    expect(Object.keys(row).sort()).toEqual([
      "channelId",
      "channelName",
      "detail",
      "id",
      "mine",
      "name",
      "state",
      "threadId",
      "threadTitle",
      "updatedAt",
    ]);
  });

  it("marks a peer's row as not mine and prefers the live channel name", () => {
    const [row] = mapWorkspaceAgents([session], new Map([[CHAN, "General"]]), "me");
    expect(row.mine).toBe(false);
    expect(row.channelName).toBe("General");
  });

  it("drops a session in a channel the caller cannot see", () => {
    expect(mapWorkspaceAgents([session], new Map(), "me")).toEqual([]);
  });

  it("narrows an unrecognised detail key to null rather than printing it", () => {
    const [row] = mapWorkspaceAgents(
      [{ ...session, detail: "seventh_key" }],
      new Map([[CHAN, "General"]]),
      "me"
    );
    expect(row.detail).toBeNull();
  });

  it("reads only sessions the desktop has not ended", async () => {
    await getWorkspaceAgentBoard(WS, "me", [{ id: CHAN, name: "General" }]);
    expect(mocked.listWorkspaceRunningSessions).toHaveBeenCalledWith(
      WS,
      expect.any(Number)
    );
  });
});

describe("token spend — operator-fenced, per member's own", () => {
  it("passes BOTH the container and the CALLER, never the container alone", async () => {
    await getWorkspaceTokenSpend(WS, "me", NOW);
    expect(mocked.listWorkspaceTokenSpend).toHaveBeenCalledWith(
      WS,
      "me",
      "2026-08-17T09:30:00.000Z"
    );
  });

  it("has no workspace-wide variant — the two-member subtraction leak has no door", async () => {
    // 🔒 In a container of two, "everyone" minus "me" IS the colleague's figure,
    // so the fence is the absence of the aggregate, not a filter over it. The
    // module must expose no read that takes the container without the caller.
    const surface = await import("./service-usage");
    const takesContainerOnly = Object.entries(surface).filter(
      ([name, value]) =>
        typeof value === "function" &&
        /token|spend/i.test(name) &&
        (value as (...args: never[]) => unknown).length < 2
    );
    expect(takesContainerOnly).toEqual([]);
    await getWorkspaceTokenSpend(WS, "user-1", NOW);
    expect(mocked.listWorkspaceTokenSpend).toHaveBeenCalledWith(
      WS,
      "user-1",
      expect.any(String)
    );
  });

  it("answers RUNS, not days — the server names no day", async () => {
    mocked.listWorkspaceTokenSpend.mockResolvedValue({
      rows: [{ started_at: "2026-09-16T23:30:00.000Z", tokens: 20_000 }],
      truncated: false,
    });
    const report = await getWorkspaceTokenSpend(WS, "me", NOW);
    expect(report.marks).toEqual([
      { at: "2026-09-16T23:30:00.000Z", tokens: 20_000 },
    ]);
  });
});
