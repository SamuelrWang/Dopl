/**
 * `requested` — the state the mock had a word for and the model never did.
 *
 * The property this file exists for: **it is derived from the VIEWER'S OWN
 * consent inbox, and it therefore says one thing and not its mirror image.**
 * "You have not answered this" is derivable; "your addressee has not answered
 * you" is not, because a consent read is scoped to `(operator, workspace)` with
 * the operator always `ctx.userId` (INVARIANTS §6). A future change that starts
 * reporting the second from the absence of a pending row would report
 * NEVER-ASKED as APPROVED — see REFACTOR-FINDINGS F-206.
 */

import { describe, expect, it } from "vitest";
import {
  consentExemptThreadIds,
  pendingAsksByChannel,
  requestedThreadIds,
  sidebarThreads,
} from "./view-model-requested";
import { CHANNEL_ID, message, thread, ME, PEER } from "./test-fixtures";
import { SIDEBAR_THREAD_ACTIVE_WINDOW_MS } from "../../constants";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";

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
    // ⚠ THE DROP IS DELIBERATE AND STAYS: this set wears the Clock glyph and
    // the words "awaiting your approval", which are an assertion about ONE
    // thread. What such a row costs the operator is answered separately, by
    // `consentExemptThreadIds` below.
    expect(requestedThreadIds([OPENER], [consent({ messageSeq: null })]).size).toBe(0);
  });

  it("ignores an ABSENT seq the same way it ignores a null one", () => {
    // ⚠ `messageSeq !== null` let `undefined` straight through, and the key it
    // then built was the literal `"ch-1:undefined"`.
    const absent = { ...consent() } as Partial<ChannelConsentRequest>;
    delete absent.messageSeq;
    expect(
      requestedThreadIds([OPENER], [absent as ChannelConsentRequest]).size
    ).toBe(0);
  });

  it("does NOT let two missing values agree with each other", () => {
    // ⚠ THE SELF-MATCH. With the seq absent on BOTH sides, the old key
    // `"ch-1:undefined"` matched `"ch-1:undefined"` and marked a thread
    // requested on the strength of nothing at all. Both sides must be numbers.
    const seqless = { ...consent() } as Partial<ChannelConsentRequest>;
    delete seqless.messageSeq;
    const untimed = { ...OPENER } as Partial<ChannelMessage>;
    delete untimed.seq;
    expect(
      requestedThreadIds(
        [untimed as ChannelMessage],
        [seqless as ChannelConsentRequest]
      ).size
    ).toBe(0);
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

/**
 * THE OTHER HALF OF A SEQ-LESS ASK.
 *
 * A pending inbound consent row with no `message_seq` is LEGAL — the de-dupe
 * index is partial on `message_seq IS NOT NULL` precisely because a request
 * raised without a triggering seq has no trigger identity (migration
 * `20260726140000`). Dropping it from `requestedThreadIds` is right: the row
 * carries no thread reference of any kind (there is no task/thread column on
 * `channel_consent_requests`), so naming one would be a guess wearing the words
 * "awaiting your approval".
 *
 * ⚠ BUT THE SAME SET ALSO DROVE THE SIDEBAR'S 24h-WINDOW EXEMPTION, and there
 * the drop meant the operator had a live pending ask with NO ROW ANYWHERE to
 * walk into once its thread aged out. REACHABILITY is not an assertion, so it
 * can be answered by the join that IS possible: channel + requester + the
 * operator who must decide, against a thread's two parties (INVARIANTS §5).
 */
describe("consentExemptThreadIds — the join a seq-less ask DOES support", () => {
  const ASKED = thread({
    id: "t-asked",
    createdBy: PEER, // the requester opened it…
    targetUserId: ME, // …addressed to the viewer, who must decide
  });
  const seqless = (over: Partial<ChannelConsentRequest> = {}) =>
    consent({ messageSeq: null, ...over });

  it("admits the thread this requester opened for this operator, in this channel", () => {
    expect([...consentExemptThreadIds([ASKED], [seqless()])]).toEqual(["t-asked"]);
  });

  it("admits NOTHING from a row that CAN name its thread — that one is `requested`", () => {
    // A row with a seq is placed exactly by `requestedThreadIds`; a second,
    // looser answer for it would put rows in the tree that surface never marked.
    expect(consentExemptThreadIds([ASKED], [consent()]).size).toBe(0);
  });

  it("does not reach across channels, requesters, or addressees", () => {
    expect(
      consentExemptThreadIds([ASKED], [seqless({ channelId: "ch-other" })]).size
    ).toBe(0);
    expect(
      consentExemptThreadIds([ASKED], [seqless({ requesterUserId: "u-third" })]).size
    ).toBe(0);
    expect(
      consentExemptThreadIds([ASKED], [seqless({ operatorUserId: "u-third" })]).size
    ).toBe(0);
  });

  it("drops a row whose requester is GONE rather than matching every thread", () => {
    // `requester_user_id` is ON DELETE SET NULL. Matching a null against a
    // thread's `createdBy` is not a join, it is a wildcard.
    expect(
      consentExemptThreadIds([ASKED], [seqless({ requesterUserId: null })]).size
    ).toBe(0);
  });

  it("ignores decided and outbound rows, like every other consent read here", () => {
    expect(consentExemptThreadIds([ASKED], [seqless({ status: "denied" })]).size).toBe(0);
    expect(consentExemptThreadIds([ASKED], [seqless({ kind: "outbound" })]).size).toBe(0);
  });
});

describe("the sidebar's exemption arm", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const stale = thread({
    id: "t-stale",
    createdBy: PEER,
    targetUserId: ME,
    lastActivityAt: new Date(now - SIDEBAR_THREAD_ACTIVE_WINDOW_MS - 1_000).toISOString(),
  });

  it("keeps an aged thread reachable when a seq-less ask points at it", () => {
    const exempt = consentExemptThreadIds([stale], [consent({ messageSeq: null })]);
    expect(sidebarThreads([stale], new Set(), now, exempt).map((t) => t.id)).toEqual([
      "t-stale",
    ]);
  });

  it("still drops it with no pending ask at all", () => {
    expect(sidebarThreads([stale], new Set(), now, new Set())).toEqual([]);
  });
});

/**
 * THE ASK SIGNAL — how many threads in each channel await THIS viewer's answer
 * (Samuel's ruling, 2026-08-20: option (a), a per-channel count).
 *
 * ⚠ THE CASE THAT DEFINES IT is the seq-less row. `requestedThreadIds` above
 * must drop such a row — it cannot say which THREAD the ask is about without the
 * join — but this must keep it, because a channel with an ask nobody can locate
 * still has an ask. Requiring the join here would zero every channel whose
 * transcript is not loaded, which is every channel the operator is NOT looking
 * at: the entire set the signal exists for.
 */
describe("pendingAsksByChannel", () => {
  it("counts pending inbound rows per channel", () => {
    const asks = pendingAsksByChannel([
      consent({ id: "c-1", channelId: "ch-a", messageSeq: 1 }),
      consent({ id: "c-2", channelId: "ch-a", messageSeq: 2 }),
      consent({ id: "c-3", channelId: "ch-b", messageSeq: 3 }),
    ]);
    expect(asks.get("ch-a")).toBe(2);
    expect(asks.get("ch-b")).toBe(1);
  });

  it("counts a row with NO messageSeq — a locatable thread is not the question", () => {
    const asks = pendingAsksByChannel([
      consent({ id: "c-1", channelId: "ch-a", messageSeq: null }),
    ]);
    expect(asks.get("ch-a")).toBe(1);
    // …and the thread-level derivation still refuses it, which is the asymmetry
    // this pair exists to hold: two questions, two answers, one set of rows.
    expect(
      requestedThreadIds([], [consent({ channelId: "ch-a", messageSeq: null })]).size
    ).toBe(0);
  });

  it("ignores OUTBOUND rows — those are the operator's own reply, not an ask", () => {
    const asks = pendingAsksByChannel([
      consent({ id: "c-1", channelId: "ch-a", kind: "outbound" }),
    ]);
    expect(asks.size).toBe(0);
  });

  it("ignores rows that are no longer pending", () => {
    const asks = pendingAsksByChannel([
      consent({ id: "c-1", channelId: "ch-a", status: "allowed" }),
      consent({ id: "c-2", channelId: "ch-a", status: "denied" }),
    ]);
    expect(asks.size).toBe(0);
  });

  it("answers an empty map for no rows, and names no channel it did not see", () => {
    expect(pendingAsksByChannel([]).size).toBe(0);
    expect(pendingAsksByChannel([consent({ channelId: "ch-a" })]).get("ch-b")).toBeUndefined();
  });

  // ⚠ SAME ROWS AS THE INBOX BADGE, SLICED. The Inbox nav row counts
  // `requests.length`; this groups the inbound half by channel. If the two ever
  // derive from different filters they will disagree in the same column.
  it("totals to the inbound rows the Inbox badge is counting", () => {
    const rows = [
      consent({ id: "c-1", channelId: "ch-a" }),
      consent({ id: "c-2", channelId: "ch-b" }),
      consent({ id: "c-3", channelId: "ch-b" }),
      consent({ id: "c-4", channelId: "ch-c", kind: "outbound" }),
    ];
    const total = [...pendingAsksByChannel(rows).values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(rows.filter((r) => r.kind === "inbound").length);
  });
});
