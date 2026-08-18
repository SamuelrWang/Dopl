/**
 * `requested` — the state the mock had a word for and the model never did.
 *
 * The property this file exists for: **it is derived from the VIEWER'S OWN
 * consent inbox, and it therefore says one thing and not its mirror image.**
 * "You have not answered this" is derivable; "your addressee has not answered
 * you" is not, because a consent read is scoped to `(operator, workspace)` with
 * the operator always `ctx.userId` (INVARIANTS §6). A future change that starts
 * reporting the second from the absence of a pending row would report
 * NEVER-ASKED as APPROVED — see REFACTOR-FINDINGS F-203.
 */

import { describe, expect, it } from "vitest";
import { requestedThreadIds } from "./view-model-requested";
import { CHANNEL_ID, message, ME, PEER } from "./test-fixtures";
import type { ChannelConsentRequest } from "../../types";

function consent(
  over: Partial<ChannelConsentRequest> = {}
): ChannelConsentRequest {
  return {
    id: "c-1",
    channelId: CHANNEL_ID,
    workspaceId: "ws-1",
    operatorUserId: ME,
    requesterUserId: PEER,
    kind: "inbound",
    messageSeq: 2,
    summary: "",
    bodyPreview: "",
    proposedReply: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-08-18T12:00:00.000Z",
    expiresAt: null,
    requesterName: null,
    requesterAvatarUrl: null,
    ...over,
  };
}

const OPENER = message({
  id: "op",
  seq: 2,
  metadata: { taskId: "t-1", fanoutGroup: "grp-1" },
});
const PLAIN = message({ id: "chat", seq: 3 });

describe("requestedThreadIds", () => {
  it("marks the thread whose triggering message still has a pending request", () => {
    const ids = requestedThreadIds([OPENER, PLAIN], [consent()]);
    expect([...ids]).toEqual(["t-1"]);
  });

  it("ignores a DECIDED request — the state is 'unanswered', not 'was asked'", () => {
    expect(requestedThreadIds([OPENER], [consent({ status: "allowed" })]).size).toBe(0);
    expect(requestedThreadIds([OPENER], [consent({ status: "denied" })]).size).toBe(0);
    expect(requestedThreadIds([OPENER], [consent({ status: "expired" })]).size).toBe(0);
    // ⚠ `auto_allowed` too: a trust rule answered it, so nothing is waiting.
    expect(
      requestedThreadIds([OPENER], [consent({ status: "auto_allowed" })]).size
    ).toBe(0);
  });

  it("ignores an OUTBOUND review — that gate is about this operator's own reply", () => {
    expect(requestedThreadIds([OPENER], [consent({ kind: "outbound" })]).size).toBe(0);
  });

  it("ignores a seq-less request rather than guessing which thread it names", () => {
    // ⚠ A seq-less row is also the one the de-dupe index does not cover
    // (INVARIANTS §6) — there is no trigger identity to match on, either.
    expect(requestedThreadIds([OPENER], [consent({ messageSeq: null })]).size).toBe(0);
  });

  it("matches on (channel, seq), not seq alone", () => {
    // `seq` is globally unique today, which is exactly why the redundancy is
    // worth keeping: the day it stops being, this read must not mark a thread
    // in a different channel.
    expect(
      requestedThreadIds([OPENER], [consent({ channelId: "ch-other" })]).size
    ).toBe(0);
  });

  it("marks nothing when the triggering message carries no thread tag", () => {
    expect(requestedThreadIds([PLAIN], [consent({ messageSeq: 3 })]).size).toBe(0);
  });

  it("marks every thread of a fan-out the viewer has been asked about", () => {
    const second = message({
      id: "op-b",
      seq: 4,
      metadata: { taskId: "t-2", fanoutGroup: "grp-1" },
    });
    const ids = requestedThreadIds(
      [OPENER, second],
      [consent(), consent({ id: "c-2", messageSeq: 4 })]
    );
    expect([...ids].sort()).toEqual(["t-1", "t-2"]);
  });
});
