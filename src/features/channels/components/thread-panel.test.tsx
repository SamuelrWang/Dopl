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
const MEMBER_NAMES = new Map([
  [ME, "Me"],
  [PEER, "Ada"],
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

const MEMBERS = [member(ME, "Me"), member(PEER, "Ada")];

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
      onCloseThread={async () => {}}
      onReopenThread={async () => {}}
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

  it("labels a completed thread 'Thread complete'", () => {
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

  it("labels a failed thread 'Thread failed'", () => {
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

  it("offers 'Close thread' to a thread's creator while it is open", () => {
    const markup = render({ currentUserId: ME });
    expect(markup).toContain("Close thread");
    expect(markup).not.toContain("Reopen thread");
  });

  it("offers 'Reopen thread' to a thread's creator once it is closed", () => {
    const markup = render({
      currentUserId: ME,
      threads: [thread({ status: "closed", outcome: "completed" })],
    });
    expect(markup).toContain("Reopen thread");
    expect(markup).not.toContain("Close thread");
  });

  it("hides both controls from a member who is neither creator nor target", () => {
    const markup = render({ currentUserId: "u-stranger" });
    expect(markup).not.toContain("Close thread");
    expect(markup).not.toContain("Reopen thread");
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
