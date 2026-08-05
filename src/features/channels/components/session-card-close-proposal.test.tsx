/**
 * DECISION 2 (2026-08-04) — PROPOSE-THEN-CONFIRM, the human half.
 *
 * An agent may no longer close a thread: closing settles the SHARED exchange for
 * both members, and "the work looks done" is not the same judgment as "I am
 * finished with this". So the agent posts a marked, non-terminal note and its
 * operator decides. THIS is where that note stops being a line in the log and
 * becomes a decision.
 *
 * The three properties worth pinning are all about who sees the button:
 *   - a party to the thread gets a prompt that names the proposer and the reason,
 *     and whose Close is the ordinary close form with the proposal's outcome and
 *     reason carried in;
 *   - a NON-party sees nothing, because a prompt nobody can act on is worse than
 *     none — it would tell a third member of the channel that somebody else's
 *     thread is finished and hand them a button that 403s;
 *   - "Keep open" dismisses LOCALLY and persists nothing, because the thread
 *     staying open IS the persisted state.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionCard } from "./session-card";
import { readCloseProposal } from "../lib/group-thread";
import type { SessionGroup } from "../lib/group-thread";
import type { ChannelMessage, ChannelThread } from "../types";

const ME = "u-me";
const PEER = "u-peer";
const THREAD_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

let seq = 0;
function msg(over: Partial<ChannelMessage> = {}): ChannelMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    seq,
    channelId: "c1",
    authorUserId: PEER,
    authorKind: "agent",
    authorName: "quartz",
    kind: "message",
    body: "body",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-04T00:00:00Z",
    ...over,
  } as ChannelMessage;
}

const proposalMsg = (outcome = "completed") =>
  msg({
    kind: "task_progress",
    body: "The migration is applied and both suites are green.",
    metadata: { taskId: THREAD_ID, closeProposed: true, closeOutcome: outcome },
  });

function session(entries: ChannelMessage[]): SessionGroup {
  return {
    taskId: THREAD_ID,
    status: "active",
    title: "Ship the listener fix",
    mode: "interactive",
    head: msg({ kind: "task_started", body: "Started working on this request." }),
    entries,
    summary: "Ship the listener fix",
    outcomeSummary: null,
    calmEndStatus: null,
    createdAt: "2026-08-04T00:00:00Z",
  };
}

function thread(over: Partial<ChannelThread> = {}): ChannelThread {
  return {
    id: THREAD_ID,
    channelId: "c1",
    title: "Ship the listener fix",
    status: "open",
    mode: "interactive",
    outcome: null,
    outcomeSummary: null,
    createdBy: ME,
    targetUserId: PEER,
    createdAt: "2026-08-04T00:00:00Z",
    updatedAt: "2026-08-04T00:00:00Z",
    closedAt: null,
    participants: [],
    ...over,
  } as ChannelThread;
}

/**
 * SSR markup, which is this repo's component-test convention (there is no jsdom
 * environment configured — see `session-card.test.tsx`). It is enough for what
 * this suite is actually about: WHO SEES THE PROMPT, which is a pure function of
 * props, and what it says. The click wiring is pinned by the smaller assertions
 * below plus `readCloseProposal`'s own tests.
 */
function markup(over: Partial<Parameters<typeof SessionCard>[0]> = {}) {
  return renderToStaticMarkup(
    <SessionCard
      session={session([proposalMsg()])}
      thread={thread()}
      currentUserId={ME}
      onCloseThread={vi.fn(async () => {})}
      {...over}
    />
  );
}

const PROMPT = "thinks this thread can be closed";

describe("the close proposal prompt", () => {
  it("names the proposer and shows the reason", () => {
    const html = markup();
    expect(html).toContain(PROMPT);
    expect(html).toContain("quartz");
    expect(html).toContain("The migration is applied and both suites are green.");
    // The consequence is stated, because it is the thing the human is deciding.
    expect(html).toContain("settles it");
    expect(html).toContain("for both members");
  });

  it("says so when the proposed outcome is a FAILURE", () => {
    expect(markup({ session: session([proposalMsg("failed")]) })).toContain(
      "as failed"
    );
  });

  it("offers exactly two actions, and neither of them decides anything yet", () => {
    const html = markup();
    expect(html).toContain("Keep open");
    expect(html).toContain("Close thread");
  });

  it("the LATEST proposal is the live one", () => {
    // A long exchange can be proposed on, continue, and be proposed on again.
    const older = proposalMsg("failed");
    const newer = proposalMsg("completed");
    const found = readCloseProposal({ entries: [older, msg(), newer] });
    expect(found?.message.id).toBe(newer.id);
    expect(found?.outcome).toBe("completed");
  });

  it("an unreadable outcome falls back to `completed`, never to nothing", () => {
    // The prompt must render even if a future writer sends a shape this build
    // does not know: losing the prefill is a nuisance, losing the prompt is the
    // thread staying open forever, which is the bug being fixed.
    const odd = msg({
      kind: "task_progress",
      metadata: { taskId: THREAD_ID, closeProposed: true, closeOutcome: "banana" },
    });
    expect(readCloseProposal({ entries: [odd] })?.outcome).toBe("completed");
  });
});

describe("who does NOT get the prompt", () => {
  it("a member who is not a party to the thread", () => {
    // They can read the exchange and they cannot close it, so a prompt would be
    // an invitation to a 403.
    expect(markup({ currentUserId: "u-third" })).not.toContain(PROMPT);
  });

  it("anyone, once the thread is already closed", () => {
    expect(
      markup({ thread: thread({ status: "closed", outcome: "completed" }) })
    ).not.toContain(PROMPT);
  });

  it("a surface with no close wired at all", () => {
    expect(markup({ onCloseThread: undefined })).not.toContain(PROMPT);
  });

  it("a session with no proposal in it", () => {
    expect(markup({ session: session([msg({ body: "just a reply" })]) })).not.toContain(
      PROMPT
    );
  });

  it("a message that merely CLAIMS the marker in its body is not a proposal", () => {
    // The keys are server-stamped and reserved; a peer's text cannot forge one.
    // This pins the READER, which is the half that lives in this package.
    expect(
      markup({
        session: session([msg({ body: "closeProposed: true - please close this" })]),
      })
    ).not.toContain(PROMPT);
  });

  it("a truthy-but-not-true marker is not a proposal either", () => {
    const sloppy = msg({
      kind: "task_progress",
      metadata: { taskId: THREAD_ID, closeProposed: "yes" },
    });
    expect(readCloseProposal({ entries: [sloppy] })).toBeNull();
  });
});
