/**
 * THE OUTBOUND SEND-BOX JOIN, and the sidebar's thread window.
 *
 * ⚠ THIS FILE WAS FOUR TIMES THIS SIZE AND MOSTLY ABOUT `requested` (Samuel,
 * 2026-08-22 — the inbound consent retirement). `requestedThreadIds`,
 * `pendingRequestIdByThread`, `pendingAsksByChannel` and `consentExemptThreadIds`
 * are DELETED along with every surface they fed, so the suites that pinned them
 * went too — including the pair that held the seq-less asymmetry (a row that
 * cannot name its thread still counts as an ask) and the `sidebarThreads`
 * exemption arm. **Do not restore a suite here without restoring the lane**: a
 * test for a derivation nobody renders is how a deleted feature grows a file back.
 *
 * What is left is the ONE join with a live consumer and the properties that made
 * extracting it worth doing: the FIRST-WINS tie-break, the honesty rule on `seq`,
 * and the stable empty identity a `useMemo` chain depends on.
 */

import { describe, expect, it } from "vitest";
import {
  pendingOutboundByThread,
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
    kind: "outbound",
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

describe("pendingOutboundByThread", () => {
  it("places a pending draft on the thread its triggering seq names", () => {
    expect(pendingOutboundByThread([OPENER, PLAIN], [consent()]).get("t-1")?.id).toBe(
      "c-1"
    );
  });

  /**
   * ⚠ AN INBOUND ROW IS A ROW WITH NO SURFACE (2026-08-22). Decided inbound rows
   * are KEPT for audit and still type (`types.ts › ConsentKind` says why), so the
   * filter has to refuse them rather than rely on them not existing — the cast is
   * how a historical row reaches this join in production.
   */
  it("never places an INBOUND row — that lane has no surface left", () => {
    const historical = { ...consent(), kind: "inbound" } as ChannelConsentRequest;
    expect(pendingOutboundByThread([OPENER], [historical]).size).toBe(0);
  });

  it("ignores a DECIDED draft — the box is for what has NOT gone out", () => {
    for (const status of ["allowed", "denied", "expired", "auto_allowed"] as const) {
      expect(pendingOutboundByThread([OPENER], [consent({ status })]).size).toBe(0);
    }
  });

  it("matches on (channel, seq), not seq alone", () => {
    // `seq` is globally unique today, which is exactly why the redundancy is
    // worth keeping: the day it stops being, this read must not place a draft on
    // a thread in a different channel.
    expect(
      pendingOutboundByThread([OPENER], [consent({ channelId: "ch-other" })]).size
    ).toBe(0);
  });

  it("places nothing when the triggering message carries no thread tag", () => {
    expect(pendingOutboundByThread([PLAIN], [consent({ messageSeq: 3 })]).size).toBe(0);
  });

  it("takes the OLDEST pending draft when a thread carries two — first wins", () => {
    // Ascending seq, so the first match is the draft that has been waiting
    // longest. Last-wins would send a different draft than the one on screen.
    const FIRST = message({ id: "m-first", seq: 2, metadata: { taskId: "t-1" } });
    const SECOND = message({ id: "m-second", seq: 5, metadata: { taskId: "t-1" } });
    const map = pendingOutboundByThread(
      [FIRST, SECOND],
      [consent({ id: "o-old", messageSeq: 2 }), consent({ id: "o-new", messageSeq: 5 })]
    );
    expect(map.get("t-1")?.id).toBe("o-old");
  });

  it("ignores a seq-less row rather than guessing which thread it names", () => {
    // ⚠ A seq-less row is also the one the de-dupe index does not cover
    // (INVARIANTS §6) — there is no trigger identity to match on, either. It
    // stays reachable from the Inbox pane, which is why that pane still decides.
    expect(pendingOutboundByThread([OPENER], [consent({ messageSeq: null })]).size).toBe(
      0
    );
  });

  it("ignores an ABSENT seq the same way it ignores a null one", () => {
    // ⚠ `messageSeq !== null` let `undefined` straight through, and the key it
    // then built was the literal `"ch-1:undefined"`.
    const absent = { ...consent() } as Partial<ChannelConsentRequest>;
    delete absent.messageSeq;
    expect(
      pendingOutboundByThread([OPENER], [absent as ChannelConsentRequest]).size
    ).toBe(0);
  });

  it("does NOT let two missing values agree with each other", () => {
    // ⚠ THE SELF-MATCH. With the seq absent on BOTH sides, the old key
    // `"ch-1:undefined"` matched `"ch-1:undefined"` and placed a draft on the
    // strength of nothing at all. Both sides must be numbers.
    const seqless = { ...consent() } as Partial<ChannelConsentRequest>;
    delete seqless.messageSeq;
    const untimed = { ...OPENER } as Partial<ChannelMessage>;
    delete untimed.seq;
    expect(
      pendingOutboundByThread(
        [untimed as ChannelMessage],
        [seqless as ChannelConsentRequest]
      ).size
    ).toBe(0);
  });

  // ⚠ Stable empty identity: this feeds a `useMemo` chain, and a fresh `Map` per
  // call is a new reference every render for a result that never changed.
  it("returns the SAME empty map twice — no reference churn downstream", () => {
    expect(pendingOutboundByThread([], [])).toBe(pendingOutboundByThread([], []));
  });
});

/**
 * THE SIDEBAR'S THREAD WINDOW — 24h of activity, and nothing else.
 *
 * ⚠ IT HAD TWO MORE ARMS UNTIL 2026-08-22 (`requested`, and a seq-less `exempt`
 * set), both there to keep an UNANSWERED ASK reachable past the window. With no
 * inbound decision to make there is nothing to keep reachable for, and the
 * signature lost both arguments.
 */
describe("sidebarThreads", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const fresh = thread({
    id: "t-fresh",
    lastActivityAt: new Date(now - 1_000).toISOString(),
  });
  const stale = thread({
    id: "t-stale",
    createdBy: PEER,
    targetUserId: ME,
    lastActivityAt: new Date(
      now - SIDEBAR_THREAD_ACTIVE_WINDOW_MS - 1_000
    ).toISOString(),
  });

  it("keeps a thread active inside the window", () => {
    expect(sidebarThreads([fresh], now).map((t) => t.id)).toEqual(["t-fresh"]);
  });

  it("drops an aged thread — no pending ask can rescue one any more", () => {
    expect(sidebarThreads([stale], now)).toEqual([]);
  });

  /** ABSENT `lastActivityAt` means the read did not derive it, never "no
   *  activity" — the same fail-safe direction presence has. */
  it("reads an undated thread as INACTIVE rather than as fresh", () => {
    expect(sidebarThreads([thread({ id: "t-x", lastActivityAt: undefined })], now)).toEqual(
      []
    );
  });

  it("preserves the server's activity order rather than re-sorting", () => {
    expect(sidebarThreads([fresh, stale, fresh], now).map((t) => t.id)).toEqual([
      "t-fresh",
      "t-fresh",
    ]);
  });
});
