// @vitest-environment jsdom
/**
 * **THE AGENTS TAB IS THE ROOM'S, NOT THE OPERATOR'S** (Samuel's ruling R-25,
 * 2026-09-17: *"show EVERYONE's live agents; ended agents hidden"*).
 *
 * ⚠ **THE READ WAS ALREADY ROOM-WIDE AND NOTHING PINNED IT ON THIS SURFACE.**
 * `server/session-state-service.ts › listChannelSessions` is channel-scoped
 * behind `loadVisibleChannel` — the same fence every channel read uses — and
 * `surface-info-panel.tsx` hands `peerSessions` to this tab on EVERY host, so
 * the ruling's "everyone's live agents" half was live before it was ruled. What
 * was missing is these assertions: the half was only ever implied by three
 * derivations in `agents-model.ts` and could have been narrowed by any of them.
 *
 * ⚠ **THE LIVE FILTER IS DOUBLE, AND BOTH HALVES ARE PINNED HERE.**
 * `main/session-state-push.js › liveForWire` keeps an ended row off the wire,
 * and `agents-model.ts › peerCardsFor` drops one that arrives anyway — a legacy
 * desktop can still report it, and the belt is what makes the row's absence a
 * rule rather than a delivery accident.
 *
 * 🔴 **THE OTHER HALF OF R-25 — "an ENDED agent is not [listed]" — COLLIDES WITH
 * SAMUEL'S 2026-08-22 RULE FOR THE OPERATOR'S OWN CARDS** (*"the card is still
 * drawn; the pill states it"*, `agent-ended.test.tsx`), which `ownAgentsFor` and
 * that suite both hold. Neither side was edited: the disagreement is F-724 and
 * the last case below pins what the code does TODAY, so a flip is a test change
 * somebody has to make on purpose.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import { AgentsTab } from "./agents-tab";
import { CHANNEL_ID, ME, PEER, member } from "./test-fixtures";

afterEach(cleanup);

function peerRow(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
  return {
    userId: PEER,
    channelId: CHANNEL_ID,
    threadId: null,
    name: "ab12cd34",
    displayName: "Bug Reviewer",
    state: "working",
    channelName: "Website",
    threadTitle: null,
    // ⚠ NOW, so `peerRowStale` does not dim the row out from under the assertion
    // — staleness is INK, never membership (`agents-model.ts › peerRowStale`).
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function ownRow(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    name: "Scout",
    state: "working",
    channelName: "Website",
    threadTitle: null,
    ...over,
  };
}

function renderTab(
  sessions: DesktopSessionSummary[] | null,
  peers: ChannelPeerSession[]
) {
  return render(
    <AgentsTab
      sessions={sessions}
      channelId={CHANNEL_ID}
      currentUserId={ME}
      members={[member({ userId: PEER, displayName: "Diana" })]}
      peers={peers}
      openAgent={null}
      onOpenAgent={() => {}}
    />
  );
}

describe("every member's live agent is on the tab", () => {
  it("lists a PEER's live agent beside the operator's own", () => {
    renderTab([ownRow()], [peerRow()]);
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.getByText("Bug Reviewer")).toBeTruthy();
    // ⚠ WHOSE IT IS, said on the card — the roster row is what makes a room-wide
    // list readable rather than a pile of handles.
    expect(screen.getByText(/Diana's agent/)).toBeTruthy();
  });

  it("lists a peer's live agent even with NO desktop feed of its own", () => {
    // `null` is "could not ask" about MY agents (INVARIANTS §11) and says nothing
    // about anyone else's — the peer rows are a server read.
    renderTab(null, [peerRow()]);
    expect(screen.getByText("Bug Reviewer")).toBeTruthy();
  });

  it("hides a peer's ENDED agent even when a desktop reports one", () => {
    renderTab([], [peerRow({ state: "ended" })]);
    expect(screen.queryByText("Bug Reviewer")).toBeNull();
    expect(screen.getByText("No agents running in this channel.")).toBeTruthy();
  });

  it("gives a peer row no way in — the operator's own card is the openable one", () => {
    // ⚠ ASSERTED ON THE CARD'S OWN CONTROL, not on a page-wide button count: the
    // four well headings are buttons too (`recency-wells.tsx` collapses).
    const { unmount } = renderTab([], [peerRow()]);
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    unmount();

    renderTab([ownRow()], []);
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  });

  /**
   * 🔴 **F-724's EVIDENCE, NOT AN ENDORSEMENT.** R-25 says an ended agent is not
   * listed; Samuel's 2026-08-22 rule says the operator's OWN ended card stays and
   * wears the pill. This asserts the code as it stands so the collision is
   * visible, and `agent-ended.test.tsx` asserts the same thing for its own reason.
   */
  it("still draws the operator's OWN ended card (2026-08-22, pending F-724)", () => {
    renderTab([ownRow({ state: "ended" })], []);
    expect(screen.getByText("Scout")).toBeTruthy();
    expect(screen.getByText("Ended")).toBeTruthy();
  });
});
