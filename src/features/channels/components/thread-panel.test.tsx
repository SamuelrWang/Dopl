import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadPanel } from "./thread-panel";
import type { ChannelMember, ChannelThread } from "../types";

/**
 * The v3.0 vocabulary is a PRODUCT contract, not a cosmetic choice: the panel
 * lists THREADS (one shared exchange each), never "tasks". These assertions pin
 * the visible copy so a future edit cannot quietly reintroduce the old word.
 */

const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";
const ME = "u-me";
const PEER = "u-ada";
/** The third member: present in the channel, party to nothing by default. */
const CARL = "u-carl";
const MEMBER_NAMES = new Map([
  [ME, "Me"],
  [PEER, "Ada"],
  [CARL, "Carl"],
]);

function member(userId: string, displayName: string): ChannelMember {
  return {
    channelId: CHANNEL_ID,
    userId,
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: null,
    joinedAt: "2026-07-30T00:00:00.000Z",
    displayName,
    email: null,
    avatarUrl: null,
  };
}

const MEMBERS = [member(ME, "Me"), member(PEER, "Ada"), member(CARL, "Carl")];

function thread(over: Partial<ChannelThread> = {}): ChannelThread {
  return {
    id: "thread-1",
    channelId: CHANNEL_ID,
    workspaceId: "w1",
    title: "Ship the fix",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: ME,
    targetUserId: PEER,
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    closedAt: null,
    outcomeSummary: null,
    ...over,
  };
}

function render(over: {
  threads?: ChannelThread[];
  threadsLoading?: boolean;
  currentUserId?: string;
} = {}) {
  return renderToStaticMarkup(
    <ThreadPanel
      threads={over.threads ?? [thread()]}
      threadsLoading={over.threadsLoading ?? false}
      members={MEMBERS}
      memberNames={MEMBER_NAMES}
      onSelectThread={() => {}}
      currentUserId={over.currentUserId}
    />
  );
}

describe("ThreadPanel copy — THREAD vocabulary", () => {
  it("heads the panel with Threads and never says task", () => {
    const markup = render();
    expect(markup).toContain("Threads");
    expect(markup.toLowerCase()).not.toContain("task");
  });

  it("labels an open thread 'Thread active'", () => {
    expect(render()).toContain("Thread active");
  });

  // ⚠ THE NEXT TWO ARE ABOUT LEGACY ROWS. Nothing closes a thread since the
  // wiring plan's Phase 4 (2026-08-18), so a `closed` row is one settled before
  // the removal; `displayStatus` is the last surviving READ of `status` and it
  // exists so an old transcript still explains itself. The `closed <time>` line
  // and the outcome summary under the row went with the close.
  it("labels a legacy completed thread 'Thread complete'", () => {
    const markup = render({
      threads: [
        thread({
          status: "closed",
          outcome: "completed",
          closedAt: "2026-07-30T01:00:00.000Z",
        }),
      ],
    });
    expect(markup).toContain("Thread complete");
    expect(markup).not.toContain("Thread active");
  });

  it("labels a legacy failed thread 'Thread failed'", () => {
    const markup = render({
      threads: [
        thread({
          status: "closed",
          outcome: "failed",
          closedAt: "2026-07-30T01:00:00.000Z",
        }),
      ],
    });
    expect(markup).toContain("Thread failed");
  });

  // ⚠ THREE TESTS ENDED HERE, and they were the whole per-row Close / Reopen
  // strip: offered to a thread's creator while open, swapped for Reopen once
  // closed, hidden from a non-party. Thread closing was REMOVED (wiring plan
  // Phase 4, 2026-08-18) and `ThreadRowActions` with it. What replaces them is
  // the absence assertion below — this panel offers no settlement control at all
  // now, whoever is looking.
  it("offers NO close or reopen control, to a party or to anyone else", () => {
    for (const currentUserId of [ME, "u-stranger", undefined]) {
      const markup = render({ currentUserId });
      expect(markup).not.toContain("Close thread");
      expect(markup).not.toContain("Reopen thread");
      expect(markup).not.toContain("Mark complete");
    }
  });

  it("says 'no addressee' rather than rendering a lone creator", () => {
    // `target_user_id` is ON DELETE SET NULL: a deleted account leaves a thread
    // with one party. The row used to drop the arrow half silently, which reads
    // as a solo note instead of an exchange nobody can answer.
    const markup = render({
      currentUserId: ME,
      threads: [thread({ targetUserId: null })],
    });
    expect(markup).toContain("no addressee");
  });

  it("says 'No threads yet.' when the channel has none", () => {
    expect(render({ threads: [] })).toContain("No threads yet.");
  });

  it("says 'Loading threads…' while the first read resolves", () => {
    const markup = render({ threads: [], threadsLoading: true });
    expect(markup).toContain("Loading threads…");
    expect(markup).not.toContain("No threads yet.");
  });
});

/**
 * Whose thread is this? A channel holds many threads, and from three members up
 * they run between different pairs — so a row that renders a bare
 * creator-arrow-target tells a reader nothing about their own standing in it.
 * Reads are channel-transparent by design; writes are refused for anyone
 * outside the pair, and these cases pin that the panel says so.
 */
describe("ThreadPanel party rendering", () => {
  const count = (markup: string, needle: string) =>
    markup.split(needle).length - 1;

  it("renders the viewer as 'You' inside the pair, with no read-only marker", () => {
    const markup = render({ currentUserId: ME });
    expect(markup).toContain("You");
    expect(markup).toContain("Ada");
    expect(markup).not.toContain("Read-only");
  });

  it("marks a thread between two OTHER members read-only", () => {
    const markup = render({
      currentUserId: CARL,
      threads: [thread({ createdBy: ME, targetUserId: PEER })],
    });
    expect(markup).toContain("Read-only");
    expect(markup).toContain("only its two members can post into it");
    // The controls were already hidden; the marker explains why.
    expect(markup).not.toContain("Close thread");
  });

  it("marks the viewer read-only on other pairs' threads only", () => {
    // Two concurrent exchanges in one channel: mine, and Ada's with Carl.
    const markup = render({
      currentUserId: ME,
      threads: [
        thread({ id: "t-mine", title: "MY-THREAD", createdBy: ME, targetUserId: PEER }),
        thread({ id: "t-theirs", title: "THEIR-THREAD", createdBy: PEER, targetUserId: CARL }),
      ],
    });
    expect(markup).toContain("MY-THREAD");
    expect(markup).toContain("THEIR-THREAD");
    expect(count(markup, "Read-only")).toBe(1);
    // The one marker belongs to the row it follows, not to mine.
    expect(markup.indexOf("Read-only")).toBeGreaterThan(
      markup.indexOf("THEIR-THREAD")
    );
  });

  it("claims nothing about a viewer it does not know", () => {
    // No `currentUserId`: not-a-party and unknown-viewer are different states,
    // and only the first may be shown.
    const markup = render({
      threads: [thread({ createdBy: PEER, targetUserId: CARL })],
    });
    expect(markup).not.toContain("Read-only");
    expect(markup).not.toContain("You");
  });
});
