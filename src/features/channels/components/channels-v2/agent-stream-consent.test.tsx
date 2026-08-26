// @vitest-environment jsdom
/**
 * THE OUTBOUND GATE ON THE WORK-STREAM CARD — the whole held-draft lifecycle,
 * from the frame main stamps to the face the operator reads (Samuel, 2026-08-25).
 *
 * ⚠ ITS OWN FILE since the lifecycle fix, and the seam is a REASON TO CHANGE
 * rather than the line count that forced the question (INVARIANTS §1).
 * `agent-stream.test.tsx` is about LANES — which face a frame wears, what the two
 * absences say, how the log lane is bounded — and changes when the stream's
 * vocabulary does. This file is about a DECISION and its state machine, and
 * changes when the consent model does. They were one file and every consent fix
 * re-opened the lane suite for review.
 *
 * ⚠ THE PROPERTIES HERE ARE THE ONES THAT SHIPPED WRONG, TWICE IN TWO DAYS:
 *
 *  - **A HELD DRAFT IS NOT A SENT POST.** The `post` frame is pushed when the
 *    agent CALLS the tool — before the consent row exists — so the box said
 *    "Posted to channel" over words nobody had seen.
 *  - **ABSENCE IS NOT FAILURE.** "No pending row matched" was rendered "Not
 *    sent", which is also true of the seconds between a Post and delivery. An
 *    operator told that about a post that went out sends it again.
 *  - **THE LANDING CHECK CANNOT USE THE AGENT-SCOPED LANE.** It filters on a
 *    `metadata.taskId` that a threadless post does not carry (F-311), so on a
 *    solo /home container it can never see the delivered row.
 *  - **NOTHING MAY BE LOCAL.** A pressed card survives a remount and is visible
 *    to the other agent surface only if every input is a server fact.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AgentStream,
  POST_ACTION_LABEL,
  POST_NOT_SENT_LABEL,
  POST_PENDING_LABEL,
} from "./agent-stream";
import { buildAgentStream, postEcho } from "./agent-stream-model";
import type { AgentNarrationEntry } from "./use-agent-narration";
import type { ChannelConsentRequest } from "../../types";
import { CHANNEL_ID, ME, message } from "./test-fixtures";

afterEach(cleanup);

function frame(over: Partial<AgentNarrationEntry> = {}): AgentNarrationEntry {
  return { at: 1_000, kind: "assistant", text: "thinking about it", ...over };
}

/** A pending OUTBOUND row — this operator's own agent holding a draft. */
function consent(over: Partial<ChannelConsentRequest> = {}): ChannelConsentRequest {
  return {
    id: "c-1",
    channelId: CHANNEL_ID,
    workspaceId: "ws-1",
    operatorUserId: ME,
    requesterUserId: null,
    kind: "outbound",
    messageSeq: 2,
    summary: "",
    bodyPreview: "",
    proposedReply: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-08-25T12:00:00.000Z",
    expiresAt: null,
    requesterName: null,
    requesterAvatarUrl: null,
    ...over,
  };
}

/** A `post` frame the outbound gate is HOLDING (`session-narration.js`). */
function heldPost(text: string, over: Partial<AgentNarrationEntry> = {}) {
  return {
    ...frame({ kind: "post", text, ...over }),
    lane: "channel",
    pending: true,
  } as AgentNarrationEntry;
}

function renderStream(
  over: Partial<React.ComponentProps<typeof AgentStream>> = {}
) {
  return render(
    <AgentStream
      entries={[]}
      supported
      sent={[]}
      threadTitle="UI-kit design"
      {...over}
    />
  );
}

/**
 * THE OUTBOUND GATE, ON THE CARD (Samuel, 2026-08-25).
 *
 * ⚠ THE DEFECT THIS REPLACES: the box said "Posted to channel" the moment the
 * agent CALLED the tool. The frame is pushed before the consent row is even
 * created, so a draft a human had not approved — and might never approve — was
 * painted as words the counterparty already had.
 */
describe("a HELD draft is not a sent post", () => {
  const DRAFT = "Renamed btn/secondary.";

  it("keeps the held frame even when the transcript has OTHER posts", () => {
    // ⚠ THE BLANKET "drop every sent frame once the transcript has anything"
    // rule would delete the one row the operator has to act on: a gated post has
    // no transcript row BY CONSTRUCTION.
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [message({ id: "m-1", body: "an earlier post" })],
      pending: [consent({ proposedReply: DRAFT })],
    });
    const held = items.filter((i) => i.pending);
    expect(held).toHaveLength(1);
    expect(held[0].requestId).toBe("c-1");
  });

  it("drops the held frame once its OWN words land in the transcript", () => {
    // ⚠ The row is the record; the frame never clears itself (main writes the
    // ring entry once). Without this the card would double after every Post.
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [message({ id: "m-1", body: DRAFT })],
      pending: [],
    });
    expect(items.filter((i) => i.lane === "sent")).toHaveLength(1);
    expect(items[0].pending).toBeUndefined();
  });

  it("joins through the SAME normalization main applied to the frame", () => {
    // The frame is whitespace-collapsed and capped; `proposedReply` is the raw
    // body. Only a shared normalizer can make the two equal.
    const items = buildAgentStream({
      entries: [heldPost("one   two")],
      sent: [],
      pending: [consent({ proposedReply: "one \n two " })],
    });
    expect(items[0].requestId).toBe("c-1");
    expect(postEcho("one \n two ")).toBe("one two");
  });

  it("reports NO row rather than guessing when nothing pending matches", () => {
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      pending: [consent({ proposedReply: "a different draft" })],
    });
    expect(items[0].pending).toBe(true);
    expect(items[0].requestId).toBeNull();
  });

  it("leaves an UNGATED post exactly as it was — absent is not a third state", () => {
    const items = buildAgentStream({
      entries: [frame({ kind: "post", text: "sent it" })],
      sent: [],
      pending: [consent({ proposedReply: "sent it" })],
    });
    expect(items[0].pending).toBeUndefined();
    expect(items[0].requestId).toBeUndefined();
  });
});

/**
 * THE LIFECYCLE BUG SAMUEL HIT (2026-08-25), pinned from the real rows.
 *
 * Consent `9d66bdcd…` went `allowed` (decided_by=web) at 16:14:15Z; the
 * `channel_messages` row landed at 16:14:30Z with a body byte-identical to
 * `proposed_reply` (95 chars, no whitespace to collapse). The card still said
 * **"Not sent"**. Two causes, both pinned below: the landing check was reading
 * the AGENT-FILTERED lane (which drops a threadless post — the measured row's
 * metadata was `{intent, runtime, summary, session_id}`, no `taskId`), and
 * "no pending row" was being rendered as failure.
 */
describe("a delivered draft converges to the posted face", () => {
  const DRAFT =
    "Standing by in this channel — watching the main room. Tag me or address me and I'll pick it up.";
  /** The delivered row EXACTLY as measured: agent-authored, and no `taskId`. */
  const threadless = message({
    id: "m-standby",
    authorKind: "agent",
    body: DRAFT,
    metadata: { intent: "chat", runtime: "desktop-session" },
  });

  it("reads the CHANNEL transcript, not the agent-filtered lane", () => {
    // ⚠ THE BUG, EXACTLY: `sent` is empty because `agentSentMessages` filters on
    // `metadata.taskId` and a threadless post has none. The row still exists.
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [threadless],
      pending: [],
    });
    expect(items).toHaveLength(1);
    expect(items[0].pending).toBeUndefined();
    expect(items[0].requestId).toBeUndefined();
  });

  it("renders the frame as POSTED rather than dropping it into nothing", () => {
    // ⚠ Dropping would be wrong here: the delivered row is NOT in the
    // agent-scoped lane, so nothing else would render it and the operator would
    // watch the post they just authorized vanish.
    renderStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [threadless],
      pending: [],
      onPost: vi.fn(),
    });
    expect(screen.getByText("Sent to UI-kit design")).toBeTruthy();
    expect(screen.queryByText(POST_NOT_SENT_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });

  it("still DROPS the echo when the agent-scoped lane does carry the row", () => {
    // The thread case, unchanged: the real transcript row renders it, so the
    // frame must not double.
    const attributed = message({ id: "m-1", body: DRAFT });
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [attributed],
      delivered: [attributed],
      pending: [],
    });
    expect(items.filter((i) => i.lane === "sent")).toHaveLength(1);
    expect(items[0].key).toBe("m:m-1");
  });

  it("reconciles a >1000-char delivered post whose 1000th char is a space", () => {
    // ⚠ THE BOUNDARY BUG (2026-08-25). main's `line(body, 1000)` collapses
    // whitespace, trims, slices at 1000, THEN trims AGAIN; `postEcho` must apply
    // the identical discipline or the two sides of the join drift. For a body
    // over 1000 chars whose char 999 is the space between two words,
    // `slice(0, 1000)` ends ON that space and only the second trim drops it. The
    // frame arrives already `line()`'d (space gone); the delivered `body` is the
    // RAW full string, so `postEcho(body)` must ALSO drop the boundary space —
    // otherwise `landed.has(echo)` is false and the card stays "Pending" over a
    // message the counterparty already has.
    const raw = "a".repeat(999) + " " + "b".repeat(200); // 1200 chars; index 999 = space
    // What main actually pushed onto the ring — computed by the reference chain,
    // NOT by postEcho, so reverting postEcho's trailing trim breaks the join.
    const mainLine = raw.replace(/\s+/g, " ").trim().slice(0, 1000).trim();
    expect(mainLine).toBe("a".repeat(999)); // the boundary space is gone from the frame

    const delivered = message({
      id: "m-long",
      authorKind: "agent",
      body: raw, // the FULL untruncated body the channel stored
      metadata: { intent: "chat", runtime: "desktop-session" },
    });
    const items = buildAgentStream({
      entries: [heldPost(mainLine)],
      sent: [],
      delivered: [delivered],
      pending: [],
    });
    // Reconciled to POSTED: one sent row, no lingering pending flag. With the
    // trailing trim gone, `landed` keeps the boundary space, the echo does not,
    // the join fails and this row would still be `pending`.
    expect(items.filter((i) => i.lane === "sent")).toHaveLength(1);
    expect(items[0].pending).toBeUndefined();
  });

  it("survives a REMOUNT and a decision made on another surface", () => {
    // ⚠ No local state is consulted (the pressed-card `useState` Set is deleted):
    // a fresh mount with the same server facts answers identically, which is what
    // `decided_by: "web"` from a different surface looks like from here.
    const build = () =>
      buildAgentStream({
        entries: [heldPost(DRAFT)],
        sent: [],
        delivered: [threadless],
        pending: [],
      });
    expect(build()[0].pending).toBeUndefined();
    expect(build()[0].pending).toBeUndefined();
  });
});

describe("absence is UNKNOWN, and only a dead row is failure", () => {
  const DRAFT = "on it";

  it("says PENDING with no button while a Post is still being delivered", () => {
    // ⚠ THE 15-SECOND WINDOW. Approving flips the row out of `pending`
    // immediately; the desktop's poll posts it seconds later. "Not sent" here is
    // the one wrong direction — the operator sends it again.
    renderStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [],
      pending: [],
      onPost: vi.fn(),
    });
    expect(screen.getByText(POST_PENDING_LABEL)).toBeTruthy();
    expect(screen.queryByText(POST_NOT_SENT_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });

  it("says NOT SENT only for a row past its OWN TTL", () => {
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [],
      pending: [
        consent({ proposedReply: DRAFT, expiresAt: "2026-08-25T00:00:00.000Z" }),
      ],
      now: Date.parse("2026-08-26T00:00:00.000Z"),
    });
    expect(items[0].expired).toBe(true);
  });

  it("does NOT expire a row the server has not dated", () => {
    // ⚠ `listConsentRequests` is unswept, so an elapsed row still arrives
    // `status: "pending"` — but an ABSENT `expiresAt` is unknown, not elapsed.
    const items = buildAgentStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [],
      pending: [consent({ proposedReply: DRAFT, expiresAt: null })],
      now: Date.parse("2030-01-01T00:00:00.000Z"),
    });
    expect(items[0].expired).toBe(false);
    expect(items[0].requestId).toBe("c-1");
  });

  it("offers no Post on an expired row — the decide route would refuse it", () => {
    renderStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [],
      pending: [
        consent({ proposedReply: DRAFT, expiresAt: "2020-01-01T00:00:00.000Z" }),
      ],
      onPost: vi.fn(),
    });
    expect(screen.getByText(POST_NOT_SENT_LABEL)).toBeTruthy();
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });
});

describe("a gate note does not outlive its gate", () => {
  const DRAFT = "on it";
  const gateNote = () => frame({ at: 2_000, kind: "status", text: "Waiting for permission" });

  it("drops the stale note once the draft has landed", () => {
    // ⚠ Samuel saw this line sitting under a post that had already been
    // delivered. The ring is append-only, so the READER has to retire it.
    const items = buildAgentStream({
      entries: [heldPost(DRAFT), gateNote()],
      sent: [],
      delivered: [message({ id: "m-1", authorKind: "agent", body: DRAFT, metadata: {} })],
      pending: [],
    });
    expect(items.some((i) => i.text === "Waiting for permission")).toBe(false);
  });

  it("KEEPS it while a card is still held — the gate is real", () => {
    const items = buildAgentStream({
      entries: [heldPost(DRAFT), gateNote()],
      sent: [],
      delivered: [],
      pending: [consent({ proposedReply: DRAFT })],
    });
    expect(items.some((i) => i.text === "Waiting for permission")).toBe(true);
  });

  it("KEEPS it on a main that does not stamp gates at all", () => {
    // ⚠ Without this guard an older build — where the note is the ONLY thing
    // that explains the silence — would lose it.
    const items = buildAgentStream({
      entries: [frame({ kind: "post", text: DRAFT }), gateNote()],
      sent: [],
      delivered: [],
      pending: [],
    });
    expect(items.some((i) => i.text === "Waiting for permission")).toBe(true);
  });
});

describe("the card is the outbound review surface", () => {
  const DRAFT = "Renamed btn/secondary.";

  it("says PENDING and offers exactly one button, Post", () => {
    renderStream({
      entries: [heldPost(DRAFT)],
      pending: [consent({ proposedReply: DRAFT })],
      onPost: vi.fn(),
    });
    expect(screen.getByText(POST_PENDING_LABEL)).toBeTruthy();
    expect(screen.getByText(DRAFT)).toBeTruthy();
    // ⚠ THE LIE THIS REPLACED. Neither posted face may appear over a held draft.
    expect(screen.queryByText("Posted to channel")).toBeNull();
    expect(screen.queryByText(/^Sent to /)).toBeNull();
    // ⚠ ONE VERB. Samuel asked for "Post" and nothing beside it — no Cancel, no
    // Deny. A pending row's only other exit is the server's 24h expiry.
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([POST_ACTION_LABEL]);
  });

  it("APPROVES the matching consent row on click", () => {
    const onPost = vi.fn();
    renderStream({
      entries: [heldPost(DRAFT)],
      pending: [consent({ id: "c-42", proposedReply: DRAFT })],
      onPost,
    });
    fireEvent.click(screen.getByRole("button", { name: POST_ACTION_LABEL }));
    expect(onPost).toHaveBeenCalledWith("c-42");
  });

  it("stays PENDING after the click and retires the button, never flashing NOT SENT", () => {
    // ⚠ THE GAP IS REAL: approving flips the row out of `pending` at once, but
    // the message only reaches the transcript when the desktop's poll posts it.
    // "Not sent" in that gap is false in the direction that makes an operator
    // send it twice.
    // ⚠ THE MECHANISM CHANGED ON 2026-08-25 AND THE PROPERTY DID NOT. A local
    // `useState` Set of pressed cards used to carry this; it is deleted, because
    // it could not survive a remount and could not see the other surface. The
    // row simply leaving `pending` with nothing delivered yet is now enough.
    const { rerender } = renderStream({
      entries: [heldPost(DRAFT)],
      pending: [consent({ proposedReply: DRAFT })],
      onPost: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: POST_ACTION_LABEL }));
    rerender(
      <AgentStream
        entries={[heldPost(DRAFT)]}
        supported
        sent={[]}
        delivered={[]}
        pending={[]}
        onPost={vi.fn()}
        threadTitle="UI-kit design"
      />
    );
    expect(screen.getByText(POST_PENDING_LABEL)).toBeTruthy();
    expect(screen.queryByText(POST_NOT_SENT_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });

  it("flips to the posted face once the transcript carries the words", () => {
    renderStream({
      entries: [heldPost(DRAFT)],
      sent: [message({ id: "m-1", body: DRAFT })],
      pending: [],
      onPost: vi.fn(),
    });
    expect(screen.getByText("Sent to UI-kit design")).toBeTruthy();
    expect(screen.queryByText(POST_PENDING_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });

  it("offers nothing to press for a draft whose row is gone — but does NOT call it failed", () => {
    // ⚠ THIS CASE ASSERTED "Not sent" UNTIL 2026-08-25 AND THAT WAS THE BUG. A
    // missing row is also what an in-flight delivery looks like, so the claim was
    // made over posts that had already gone out. Failure now needs a dead row —
    // see "absence is UNKNOWN, and only a dead row is failure".
    renderStream({
      entries: [heldPost(DRAFT)],
      sent: [],
      delivered: [],
      pending: [],
      onPost: vi.fn(),
    });
    expect(screen.getByText(POST_PENDING_LABEL)).toBeTruthy();
    expect(screen.queryByText(POST_NOT_SENT_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });

  it("renders NO button at all on a host that cannot decide", () => {
    // ⚠ Never a DISABLED one — the feature-detection rule this tree follows
    // everywhere. Without `onPost` the card is a statement, not an affordance.
    renderStream({
      entries: [heldPost(DRAFT)],
      pending: [consent({ proposedReply: DRAFT })],
    });
    expect(screen.queryByRole("button", { name: POST_ACTION_LABEL })).toBeNull();
  });

  it("guards the double-submit while a decision is in flight", () => {
    renderStream({
      entries: [heldPost(DRAFT)],
      pending: [consent({ proposedReply: DRAFT })],
      onPost: vi.fn(),
      postBusy: true,
    });
    const button = screen.getByRole("button", { name: POST_ACTION_LABEL });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
