// @vitest-environment jsdom
/**
 * THE RIGHT PANEL'S TAB ROW, and specifically its COUNT BADGES (2026-08-20).
 *
 * Three properties, each of which fails quietly rather than loudly:
 *
 *  - **THE BADGE AND THE LIST ARE ONE DERIVATION.** The Agents badge runs
 *    `agents-model.ts › ownAgentsFor` + `› peerCardsFor` — the exact functions
 *    `agents-tab.tsx` draws its cards from. A second copy of those predicates is
 *    F-142's defect wearing a number: a badge reading 3 over a list of 2, with
 *    nothing anywhere saying which is right.
 *  - **"COULD NOT ASK" RENDERS NO BADGE, NEVER A ZERO.** `agentSessions === null`
 *    is a plain browser or a main without the feed. A `0` there is a confident
 *    claim about the operator's own machine that this surface cannot make
 *    (INVARIANTS §11 — UNKNOWN is not EMPTY), and it is indistinguishable from
 *    the real "asked, nothing is running".
 *  - **INFO AND SETTINGS CARRY NO BADGE.** Info already renders the mentions
 *    unread count inside itself; two numbers for one tab is a guess about which.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { ChannelsV2InfoPanel } from "./info-panel";
import { indexMembers } from "./view-model";
import { CHANNEL_ID, ME, PEER, channel, member, thread } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-a",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "Alpha audit",
    ...over,
  };
}

function peer(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
  return {
    userId: PEER,
    channelId: CHANNEL_ID,
    threadId: "t-a",
    name: "onyx",
    state: "working",
    channelName: "Website",
    threadTitle: "Alpha audit",
    // ⚠ FRESH BY CONSTRUCTION, never a literal. `peerCardsFor` drops a row older
    // than `PRESENCE_ONLINE_WINDOW_MS` (2026-08-20), so a hardcoded stamp makes
    // this fixture pass on the day it is written and silently stop counting
    // afterwards — the badge tests would then assert the staleness path while
    // reading like they assert the happy one.
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const THREADS = [thread({ id: "t-a", title: "Alpha audit" }), thread({ id: "t-b", title: "Zebra sweep" })];

function renderPanel(
  over: Partial<React.ComponentProps<typeof ChannelsV2InfoPanel>> = {}
) {
  render(
    <ChannelsV2InfoPanel
      channel={channel()}
      channelName="Website"
      members={[member({ userId: ME }), member({ userId: PEER, role: "member" })]}
      threads={THREADS}
      threadsTruncated={false}
      threadsLoading={false}
      index={INDEX}
      openThreadId={null}
      onOpenThread={vi.fn()}
      agentSessions={[]}
      peerSessions={[]}
      openAgent={null}
      onOpenAgent={vi.fn()}
      mentions={[]}
      mentionsTruncated={false}
      mentionsLoading={false}
      onOpenMention={vi.fn()}
      onMarkAllMentionsRead={vi.fn()}
      {...over}
    />
  );
}

/** The badge on one tab, or `null` when that tab carries none. The tab label is
 *  the button's own text, so the badge is whatever digits sit beside it. */
function badgeOf(label: string): string | null {
  const tab = screen.getByRole("tab", { name: new RegExp(`^${label}`) });
  const text = (tab.textContent ?? "").replace(label, "").trim();
  return text === "" ? null : text;
}

describe("the tab row's count badges", () => {
  it("counts the LOADED thread list on Threads", () => {
    renderPanel();
    expect(badgeOf("Threads")).toBe("2");
  });

  it("counts my own agents PLUS live peers on Agents", () => {
    renderPanel({
      agentSessions: [summary(), summary({ sessionId: "s-2", taskId: "t-b" })],
      peerSessions: [peer()],
    });
    expect(badgeOf("Agents")).toBe("3");
  });

  it("narrows BOTH halves to the open thread, exactly as the tab's list does", () => {
    renderPanel({
      openThreadId: "t-a",
      agentSessions: [summary(), summary({ sessionId: "s-2", taskId: "t-b" })],
      peerSessions: [peer(), peer({ name: "slate", threadId: "t-b" })],
    });
    // One of mine on t-a, one peer on t-a. The two t-b rows are out of scope.
    expect(badgeOf("Agents")).toBe("2");
  });

  it("excludes MY OWN rows from the peer half — the local feed is the truth for mine", () => {
    renderPanel({
      agentSessions: [summary()],
      // The server projection carries my own machine's row back to me too.
      peerSessions: [peer({ userId: ME, name: "flint" })],
    });
    expect(badgeOf("Agents")).toBe("1");
  });

  it("excludes ENDED peers — the server row outlives the run it describes", () => {
    renderPanel({ agentSessions: [], peerSessions: [peer({ state: "ended" })] });
    expect(badgeOf("Agents")).toBe("0");
  });

  // ⚠ THE ASYMMETRY THIS PAIR EXISTS TO FORBID (Samuel, 2026-08-20). The badge
  // summed `ownAgentsFor` (which keeps `ended`) and `peerCardsFor` (which drops
  // it), so it counted MY stopped agents and not my teammates'. One rule now —
  // `agents-model.ts › isAgentActive` — over both halves.
  it("excludes MY OWN ended agents too — the badge counts what is ACTIVE", () => {
    renderPanel({
      agentSessions: [summary(), summary({ sessionId: "s-2", state: "ended" })],
      peerSessions: [],
    });
    expect(badgeOf("Agents")).toBe("1");
  });

  it("counts an ended own agent and an ended peer THE SAME WAY — zero", () => {
    renderPanel({
      agentSessions: [summary({ state: "ended" })],
      peerSessions: [peer({ state: "ended" })],
    });
    expect(badgeOf("Agents")).toBe("0");
  });

  // ⚠ A STALE PEER ROW IS NOT A LIVE AGENT. `channel_sessions` rows outlive the
  // process that wrote them and nothing sweeps them, so a crashed desktop leaves
  // `working` on disk forever. The row must age out of the badge exactly as it
  // ages out of `peer-activity.tsx › peerWorkingOn`.
  it("drops a STALE peer row — a crashed desktop is not a working agent", () => {
    renderPanel({
      agentSessions: [],
      peerSessions: [peer({ updatedAt: "2026-08-20T12:00:00.000Z" })],
    });
    expect(badgeOf("Agents")).toBe("0");
  });

  it("drops a peer row whose updatedAt cannot be parsed — absent reads as stale", () => {
    renderPanel({
      agentSessions: [],
      peerSessions: [peer({ updatedAt: "not-a-date" })],
    });
    expect(badgeOf("Agents")).toBe("0");
  });

  // ⚠ THE CASE THE WHOLE `undefined` PATH EXISTS FOR.
  it("renders NO Agents badge when the feed could not be asked (null), not a 0", () => {
    renderPanel({ agentSessions: null });
    expect(badgeOf("Agents")).toBeNull();
  });

  it("still renders the Threads badge when the agent feed is absent", () => {
    renderPanel({ agentSessions: null });
    expect(badgeOf("Threads")).toBe("2");
  });

  it("gives Info and Settings no badge at all", () => {
    renderPanel({ agentSessions: [summary()] });
    expect(badgeOf("Info")).toBeNull();
    expect(badgeOf("Settings")).toBeNull();
  });

  it("renders 0 for a channel with no threads — asked, and there are none", () => {
    renderPanel({ threads: [] });
    expect(badgeOf("Threads")).toBe("0");
  });
});

describe("the badge agrees with the list under it", () => {
  it("draws exactly as many agent cards as the Agents badge claims", () => {
    renderPanel({
      agentSessions: [summary(), summary({ sessionId: "s-2", taskId: "t-b", name: "onyx" })],
      peerSessions: [peer({ name: "slate" })],
    });
    expect(badgeOf("Agents")).toBe("3");
    fireEvent.click(screen.getByRole("tab", { name: /^Agents/ }));
    // Three handles rendered, one per counted row.
    for (const handle of ["flint", "onyx", "slate"]) {
      expect(screen.getByText(handle)).toBeTruthy();
    }
  });

  it("draws exactly as many thread rows as the Threads badge claims", () => {
    renderPanel();
    expect(badgeOf("Threads")).toBe("2");
    fireEvent.click(screen.getByRole("tab", { name: /^Threads/ }));
    const panel = screen.getByRole("tab", { name: /^Threads/ }).closest("aside");
    expect(within(panel as HTMLElement).getByText("Alpha audit")).toBeTruthy();
    expect(within(panel as HTMLElement).getByText("Zebra sweep")).toBeTruthy();
  });
});
