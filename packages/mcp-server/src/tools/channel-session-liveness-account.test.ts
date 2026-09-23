// `op="status"` with no `channel` must render the same table rows as the per-channel op, so one
// session never appears in two shapes inside one orchestrator loop.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ChannelSessionStateOwn, DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { opReadSessions } from "./channel-ops-read";
import { opReadSessionsAccount } from "./channel-ops-account";
import { SESSION_TABLE_HEAD } from "./channel-session-table";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const fresh = new Date(NOW - 5_000).toISOString();
const quietFor = (ms: number) => new Date(NOW - ms).toISOString();

/** The rich row, as an own-scoped read maps it. */
function rich(
  over: Partial<ChannelSessionStateOwn> = {},
): ChannelSessionStateOwn {
  return {
    channelId: "chan-1",
    threadId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    name: "flint",
    state: "working",
    detail: "tool",
    channelName: "General",
    threadTitle: "Deploy check",
    updatedAt: fresh,
    model: "claude-opus-5",
    toolLabel: "Bash",
    contextUsed: 124_000,
    contextWindow: 1_000_000,
    tokensSpent: 41_233,
    startedAt: new Date(NOW - 12 * 60_000).toISOString(),
    lastActivityAt: new Date(NOW - 30_000).toISOString(),
    identityName: null,
    ...over,
  };
}

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

/** The per-channel op's client: the reference render. */
function channelStub(sessions: ChannelSessionStateOwn[]): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => []),
    listChannelSessions: vi.fn(async () => ({ sessions })),
  } as unknown as DoplClient;
}

/** The account op's client. One room, so the grouping is not what differs. */
function accountStub(sessions: ChannelSessionStateOwn[]): DoplClient {
  return {
    getAccountStatus: vi.fn(async () => ({
      channels: [
        {
          channelId: "chan-1",
          channelName: "General",
          channelSlug: "general",
          workspaceId: "ws-1",
          lastSeq: null,
          lastMessageAt: null,
          unread: null,
          sessions,
          waiting: [],
        },
      ],
      operatorOnline: undefined,
      since: null,
      truncated: { channels: false, unread: false, waiting: false },
    })),
  } as unknown as DoplClient;
}

/** Not container-locked; `narrowToLock` is tested with the directory. */
const UNLOCKED: WorkspaceDirectory = {
  resolveContainerRef: async () => null,
  homeContainer: async () => null,
  containerKindIndex: async () => new Map(),
  lockedWorkspaceId: () => null,
} as unknown as WorkspaceDirectory;

// Table rows only, header dropped by identity against `SESSION_TABLE_HEAD`; the prose form matches
// nothing, so every case asserts the length before the equality.
function sessionLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !SESSION_TABLE_HEAD.includes(l));
}

beforeEach(() => {
  // Both paths call `Date.now()` themselves, so the clock is frozen rather than a stamp passed to one.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the ACCOUNT-WIDE status renders the same rows as the per-channel one", () => {
  const cases: Array<[string, ChannelSessionStateOwn]> = [
    ["the full rich row", rich()],
    [
      "no identity, suffixed model — the observed shape",
      rich({ model: "claude-opus-5[1m]" }),
    ],
    ["an identity AND a model", rich({ identityName: "Code Auditor" })],
    [
      "every telemetry field absent — an older desktop",
      rich({
        model: null,
        toolLabel: null,
        contextUsed: null,
        contextWindow: null,
        tokensSpent: null,
        startedAt: null,
        lastActivityAt: null,
      }),
    ],
    ["a quiet row", rich({ updatedAt: quietFor(10 * 60_000) })],
  ];

  for (const [label, session] of cases) {
    it(`${label} — byte-identical from both paths`, async () => {
      // The length check fails first if the prose line comes back (two empty arrays are equal).
      const fromAccount = sessionLines(
        (await opReadSessionsAccount(accountStub([session]), UNLOCKED))
          .content[0].text,
      );
      expect(fromAccount).toHaveLength(1);
      const fromRead = sessionLines(
        (await opReadSessions(channelStub([session]))).content[0].text,
      );
      expect(fromAccount).toEqual(fromRead);
    });
  }

  it("ships the SHARED header, not a hand-rolled one", async () => {
    const text = (await opReadSessionsAccount(accountStub([rich()]), UNLOCKED))
      .content[0].text;
    for (const line of SESSION_TABLE_HEAD) expect(text).toContain(line);
  });

  it("heads each group with the room AND its `container=` handle", async () => {
    // Only the heading carries the `container=` value other tools take to reach the room.
    const text = (await opReadSessionsAccount(accountStub([rich()]), UNLOCKED))
      .content[0].text;
    expect(text).toContain("### `General`");
    expect(text).toContain("container=`ws-1`");
  });

  it("says so in one line when nothing is being reported, and renders no table", async () => {
    // An asleep, signed-out or older machine reports nothing, so empty is not evidence.
    const text = (await opReadSessionsAccount(accountStub([]), UNLOCKED))
      .content[0].text;
    expect(text).toMatch(/being reported/i);
    for (const line of SESSION_TABLE_HEAD) expect(text).not.toContain(line);
  });
});
