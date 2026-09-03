/**
 * THE THIRD SURFACE THAT RENDERS A SESSION — `op="status"` WITH NO
 * `channel` (T22) — HELD AGAINST THE PER-CHANNEL ONE.
 *
 * ⚠ **SPLIT OUT OF `channel-session-liveness.test.ts` ON 2026-09-02, AT THE §1
 * CAP.** That file diffs the two ORIGINAL paths (the `op="status"` page and
 * the `await` hold's session block) and adding a third pushed it to 520 of 500.
 * The seam is the surface, not the arithmetic: this file's subject is the
 * ACCOUNT-WIDE render and its own grouping, and it drives the per-channel op
 * only as the reference to diff against.
 *
 * ⚠ **THE DEFECT IT EXISTS FOR.** `channel-ops-account.ts ›
 * opReadSessionsAccount` rendered `formatSessionLine` — the PRE-TERSE prose form
 * — while `opReadSessions` rendered `SESSION_TABLE_HEAD` + `sessionRow` (T13).
 * One session described in two shapes inside ONE orchestrator loop is exactly
 * the drift the liveness file exists to catch, and the account path was outside
 * it. Every case here fails if the prose line comes back.
 *
 * ⚠ **THE FIXTURES ARE THIS FILE'S OWN AND THAT IS DELIBERATE.** Importing them
 * from a sibling `*.test.ts` would run that suite as a side effect of this one,
 * and a shared non-test module would be a `dist/` file whose only consumer is a
 * test. What must not drift is the RENDERER, and the renderer is imported.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ChannelSessionStateOwn, DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { opReadSessions } from "./channel-ops-read";
import { opReadSessionsAccount } from "./channel-ops-account";
import { SESSION_TABLE_HEAD } from "./channel-session-table";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const fresh = new Date(NOW - 5_000).toISOString();
const quietFor = (ms: number) => new Date(NOW - ms).toISOString();

/** The rich row, exactly as an own-scoped read maps it. */
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
    templateName: null,
    ...over,
  };
}

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

/** The PER-CHANNEL op's client — the reference render. */
function channelStub(sessions: ChannelSessionStateOwn[]): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listWorkspaceMembers: vi.fn(async () => []),
    listChannelSessions: vi.fn(async () => ({ sessions })),
  } as unknown as DoplClient;
}

/** The ACCOUNT op's client. One room, so the grouping is not what differs. */
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

/** ⚠ Not container-locked: `narrowToLock` is B3's business and is tested with it. */
const UNLOCKED: WorkspaceDirectory = {
  lockedWorkspaceId: () => null,
} as unknown as WorkspaceDirectory;

/**
 * The session ROWS out of whatever a path rendered.
 *
 * ⚠ TABLE ROWS, NOT `- **` LINES — and the header is dropped by IDENTITY against
 * the exported constant rather than by a `---` sniff, so a future column cannot
 * slip past this filter and a HAND-ROLLED header survives as a "row" and fails.
 * ⚠ The filter would match NOTHING against the prose form, which is why every
 * case below asserts the LENGTH before the equality: two empty arrays are equal.
 */
function sessionLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !SESSION_TABLE_HEAD.includes(l));
}

beforeEach(() => {
  // ⚠ BOTH PATHS CALL `Date.now()` THEMSELVES, so the only honest way to diff
  // them is to freeze the clock rather than pass a stamp into one and not both.
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
      "no template, suffixed model — the observed shape",
      rich({ model: "claude-opus-5[1m]" }),
    ],
    ["a template AND a model", rich({ templateName: "Code Auditor" })],
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
      // ⚠ MUTATION CHECK. Render `formatSessionLine` in `channel-ops-account.ts`
      // again and `sessionLines` finds nothing on this side, so the length
      // assertion fails before the equality can pass on two empty arrays.
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

  it("heads each group with the room AND its `workspace=` handle", async () => {
    // ⚠ THE ONE THING THIS PAGE ADDS THAT THE TABLE CANNOT CARRY. The `channel`
    // COLUMN names the room; only the heading carries the value every other tool
    // takes to reach it, which is why the grouping survived the move to a table.
    const text = (await opReadSessionsAccount(accountStub([rich()]), UNLOCKED))
      .content[0].text;
    expect(text).toContain("### `General`");
    expect(text).toContain("workspace=`ws-1`");
  });

  it("says so in one line when nothing is being reported, and renders no table", async () => {
    // ⚠ "BEING REPORTED" IS THE LOAD-BEARING PHRASE on both surfaces: an asleep,
    // signed-out or older machine reports nothing, so empty is not evidence.
    const text = (await opReadSessionsAccount(accountStub([]), UNLOCKED))
      .content[0].text;
    expect(text).toMatch(/being reported/i);
    for (const line of SESSION_TABLE_HEAD) expect(text).not.toContain(line);
  });
});
