// @vitest-environment jsdom
/**
 * THE PEER-ACTIVITY ROW (2026-08-20) — "Anthony's agent is working…" above the
 * composer, in the page's thread view and in the pop-out window alike.
 *
 * The properties that fail quietly, and one that fails loudly in the worst way:
 *
 *  - **A STALE ROW MUST RENDER NOTHING.** `channel_sessions` rows OUTLIVE the
 *    process that wrote them — `session-state-push.js`'s own header says so, and
 *    names signing out as the case nothing covers. A crashed desktop therefore
 *    leaves a row reading `working` forever, and an indicator that believes it
 *    is strictly worse than no indicator: the reader waits for a reply from a
 *    machine that is gone. This is the case the whole liveness window exists for.
 *  - **IT SAYS "WORKING", NOT "THINKING".** The cross-machine wire is coarse by
 *    design (INVARIANTS §11); the finer word is local to the machine running the
 *    agent. A test that expected "thinking" here would be pinning a widening
 *    nobody decided.
 *  - **ZERO PEERS RENDERS NOTHING**, not an empty reserved strip. This sits
 *    directly above the composer, and a permanent blank band is chrome every
 *    thread pays for.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
import { PeerActivityRow, peerActivityText, peerWorkingOn } from "./peer-activity";
import { indexMembers } from "./view-model";
import { CHANNEL_ID, ME, PEER, member } from "./test-fixtures";

afterEach(cleanup);

const OTHER = "u-other";
const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const THREAD = "t-a";

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
    member({ userId: OTHER, displayName: "Anthony Reed", role: "member" }),
  ],
  ME
);

function peer(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
  return {
    userId: PEER,
    channelId: CHANNEL_ID,
    threadId: THREAD,
    name: "onyx",
    state: "working",
    channelName: "Website",
    threadTitle: "Alpha audit",
    // Fresh by default: one second old against NOW.
    updatedAt: new Date(NOW - 1_000).toISOString(),
    ...over,
  };
}

describe("peerWorkingOn — four predicates, all failing closed", () => {
  it("keeps a live peer working on THIS thread", () => {
    expect(peerWorkingOn([peer()], ME, THREAD, NOW)).toHaveLength(1);
  });

  it("drops MY OWN row — the Agents tab has far better data for mine", () => {
    expect(peerWorkingOn([peer({ userId: ME })], ME, THREAD, NOW)).toHaveLength(0);
  });

  it("drops an IDLE or ENDED peer — nothing there to wait for", () => {
    expect(peerWorkingOn([peer({ state: "idle" })], ME, THREAD, NOW)).toHaveLength(0);
    expect(peerWorkingOn([peer({ state: "ended" })], ME, THREAD, NOW)).toHaveLength(0);
  });

  it("drops a peer working on a DIFFERENT thread", () => {
    expect(peerWorkingOn([peer({ threadId: "t-b" })], ME, THREAD, NOW)).toHaveLength(0);
  });

  it("renders nothing at all in the CHANNEL view, which has no thread to be about", () => {
    expect(peerWorkingOn([peer()], ME, null, NOW)).toHaveLength(0);
  });

  // ⚠ THE CASE THE LIVENESS WINDOW EXISTS FOR.
  it("drops a row older than the presence window — a crashed desktop leaves one forever", () => {
    const dead = peer({
      updatedAt: new Date(NOW - PRESENCE_ONLINE_WINDOW_MS - 1).toISOString(),
    });
    expect(peerWorkingOn([dead], ME, THREAD, NOW)).toHaveLength(0);
  });

  it("keeps a row right at the edge of the window", () => {
    const edge = peer({
      updatedAt: new Date(NOW - PRESENCE_ONLINE_WINDOW_MS + 1).toISOString(),
    });
    expect(peerWorkingOn([edge], ME, THREAD, NOW)).toHaveLength(1);
  });

  it("treats an absent or unparseable stamp as STALE, never as fresh", () => {
    for (const updatedAt of ["", "not-a-date"]) {
      expect(peerWorkingOn([peer({ updatedAt })], ME, THREAD, NOW)).toHaveLength(0);
    }
  });
});

describe("peerActivityText — the sentence", () => {
  // ⚠ "Anthony R.", not "Anthony": that is `view-model.ts › shortName`'s output,
  // and the point of reusing it is that this row and the transcript byline
  // shorten one member the SAME way. Asserted verbatim so a change to that rule
  // fails here rather than drifting one surface against the other.
  it("names one peer, using the roster's own shortening rule", () => {
    expect(peerActivityText([peer({ userId: OTHER })], INDEX.byId, ME)).toBe(
      "Anthony R.'s agent is working…"
    );
  });

  // ⚠ The roster read and the session read are separate requests, so a peer row
  // can arrive before their member row. An empty possessive reads as a bug.
  it("says Someone rather than nothing when the roster has not caught up", () => {
    expect(peerActivityText([peer({ userId: "u-unknown" })], INDEX.byId, ME)).toBe(
      "Someone's agent is working…"
    );
  });

  it("counts above one, where names stop earning their width", () => {
    expect(
      peerActivityText([peer(), peer({ userId: OTHER })], INDEX.byId, ME)
    ).toBe("2 agents are working…");
  });

  it("is null for nobody", () => {
    expect(peerActivityText([], INDEX.byId, ME)).toBeNull();
  });
});

describe("PeerActivityRow — what actually paints", () => {
  it("renders the sentence and the owner's avatar for one peer", () => {
    render(
      <PeerActivityRow
        peers={[peer({ userId: OTHER })]}
        byUser={INDEX.byId}
        currentUserId={ME}
      />
    );
    expect(screen.getByText("Anthony R.'s agent is working…")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders NOTHING for zero peers — no reserved blank band above the composer", () => {
    const { container } = render(
      <PeerActivityRow peers={[]} byUser={INDEX.byId} currentUserId={ME} />
    );
    expect(container.firstChild).toBeNull();
  });

  // ⚠ The coarse wire is the design, not a gap. A "thinking" claim here would be
  // a widening of `channel_sessions.state` that nobody decided.
  it("says working, never thinking — the peer wire carries no finer word", () => {
    render(
      <PeerActivityRow peers={[peer()]} byUser={INDEX.byId} currentUserId={ME} />
    );
    expect(screen.queryByText(/thinking/i)).toBeNull();
    expect(screen.getByText(/is working…$/)).toBeTruthy();
  });
});
