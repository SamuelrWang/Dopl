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

// The Knowledge tab body opens reads of its own and has its own suite
// (`knowledge-tab.test.tsx`). What is under test HERE is the tab row: whether
// the tab exists, and whether its body is mounted at all — which an inert stub
// answers, because it is the same element either way. (`vi.mock` is hoisted, so
// it applies to the import above regardless of where it is written.)
vi.mock("./knowledge-tab", () => ({
  ChannelKnowledgeTab: () => <div data-testid="knowledge-tab" />,
}));

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
    // ⚠ FRESH BY DEFAULT, and since 2026-08-22 that is a convenience rather than
    // a requirement: `peerCardsFor` no longer ages a row out at all, and the two
    // cases below OVERRIDE this with a stale stamp to pin exactly that. What the
    // stamp still decides is the CARD's ink (`agents-model.ts › peerRowStale`).
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const THREADS = [thread({ id: "t-a", title: "Alpha audit" }), thread({ id: "t-b", title: "Zebra sweep" })];

function renderPanel(
  over: Partial<React.ComponentProps<typeof ChannelsV2InfoPanel>> = {}
) {
  return render(panel(over));
}

function panel(over: Partial<React.ComponentProps<typeof ChannelsV2InfoPanel>> = {}) {
  return (
    <ChannelsV2InfoPanel
      channel={channel()}
      channelName="Website"
      members={[member({ userId: ME }), member({ userId: PEER, role: "member" })]}
      threads={THREADS}
      threadsTruncated={false}
      threadsLoading={false}
      index={INDEX}
      openThread={null}
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

/** Whether a tab is the lit one. `SegmentedControl` puts the state on
 *  `aria-selected`, which is also the only thing a screen reader has. */
function selected(label: string): boolean {
  return (
    screen.getByRole("tab", { name: new RegExp(`^${label}`) }).getAttribute(
      "aria-selected"
    ) === "true"
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
      openThread: THREADS[0],
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

  // ⚠ A QUIET PEER ROW IS STILL A LIVE AGENT (Samuel, 2026-08-22 — this REVERSES
  // the 2026-08-20 pair that stood here and expected `"0"`). `updated_at` is
  // pushed on a state CHANGE and never on a timer, so an idle agent's row ages
  // while the agent is perfectly alive; ageing it out of the badge made the
  // count disagree with the list the operator was looking at — and then made the
  // card vanish under a running agent. **The badge and the list run one
  // derivation** (`agents-model.ts › peerCardsFor`), so both keep the row; the
  // CARD dims. Liveness is membership: the push replaces the whole set, so a
  // session that ended leaves by omission.
  it("KEEPS a long-quiet peer row — the badge counts what exists, not what is fresh", () => {
    renderPanel({
      agentSessions: [],
      peerSessions: [peer({ updatedAt: "2026-08-20T12:00:00.000Z" })],
    });
    expect(badgeOf("Agents")).toBe("1");
  });

  it("keeps a peer row whose updatedAt cannot be parsed — age is not the rule", () => {
    renderPanel({
      agentSessions: [],
      peerSessions: [peer({ updatedAt: "not-a-date" })],
    });
    expect(badgeOf("Agents")).toBe("1");
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

/**
 * THREAD VIEW RE-SCOPES THE WHOLE COLUMN (Samuel, 2026-08-21).
 *
 * Two properties, and the second is the one that fails silently:
 *
 *  - **THREADS LEAVES THE ROW WITH A THREAD OPEN**, and comes back without one.
 *    It is the single control in this column that navigates away from what the
 *    centre pane is showing.
 *  - **THE SELECTION CANNOT GO DEAD.** Opening a thread from the Threads tab
 *    removes the very tab that is lit; a `value` matching no option leaves the
 *    row with nothing selected over an empty body, which looks like a render bug
 *    and gives the reader nothing to click back to.
 */
describe("thread view's tab row", () => {
  it("drops the Threads tab while a thread is open", () => {
    renderPanel({ openThread: THREADS[0] });
    expect(screen.queryByRole("tab", { name: /^Threads/ })).toBeNull();
    // The other three stay, and Info is still reachable.
    expect(screen.getByRole("tab", { name: /^Info/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Agents/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^Settings/ })).toBeTruthy();
  });

  it("keeps the Threads tab in channel view", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: /^Threads/ })).toBeTruthy();
  });

  it("falls back to Info when the open thread removes the selected tab", () => {
    const view = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Threads/ }));
    expect(selected("Threads")).toBe(true);

    view.rerender(panel({ openThread: THREADS[0] }));

    expect(screen.queryByRole("tab", { name: /^Threads/ })).toBeNull();
    expect(selected("Info")).toBe(true);
    // And the body that landed is the THREAD's info, not the channel's.
    expect(screen.getByText("Thread info")).toBeTruthy();
    expect(screen.queryByText("Channel info")).toBeNull();
  });

  it("leaves a NON-threads selection alone when a thread opens", () => {
    const view = renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: /^Agents/ }));
    view.rerender(panel({ openThread: THREADS[0] }));
    expect(selected("Agents")).toBe(true);
  });
});

describe("the Info tab's two scopes", () => {
  it("renders the CHANNEL's info in channel view", () => {
    renderPanel();
    expect(screen.getByText("Channel info")).toBeTruthy();
    expect(screen.queryByText("Thread info")).toBeNull();
  });

  it("renders the THREAD's info in thread view", () => {
    renderPanel({ openThread: THREADS[0] });
    expect(screen.getByText("Thread info")).toBeTruthy();
    expect(screen.getByText("Alpha audit")).toBeTruthy();
    // ⚠ The channel's own sections must be GONE, not merely pushed down: this
    // column is about one exchange while a thread is open.
    expect(screen.queryByText("Channel info")).toBeNull();
    expect(screen.queryByText("Thread activity")).toBeNull();
  });
});

describe("the badge agrees with the list under it", () => {
  // ⚠ `await` ON THE BODY, NOT THE TAB. The panel body crossfades (150ms), so a
  // tab's content arrives one fade after its click — the badge and the tab
  // state are still synchronous.
  it("draws exactly as many agent cards as the Agents badge claims", async () => {
    renderPanel({
      agentSessions: [summary(), summary({ sessionId: "s-2", taskId: "t-b", name: "onyx" })],
      peerSessions: [peer({ name: "slate" })],
    });
    expect(badgeOf("Agents")).toBe("3");
    fireEvent.click(screen.getByRole("tab", { name: /^Agents/ }));
    // Three handles rendered, one per counted row.
    for (const handle of ["flint", "onyx", "slate"]) {
      expect(await screen.findByText(handle)).toBeTruthy();
    }
  });

  it("draws exactly as many thread rows as the Threads badge claims", async () => {
    renderPanel();
    expect(badgeOf("Threads")).toBe("2");
    fireEvent.click(screen.getByRole("tab", { name: /^Threads/ }));
    await screen.findByText("Alpha audit");
    const panel = screen.getByRole("tab", { name: /^Threads/ }).closest("aside");
    expect(within(panel as HTMLElement).getByText("Alpha audit")).toBeTruthy();
    expect(within(panel as HTMLElement).getByText("Zebra sweep")).toBeTruthy();
  });
});

/**
 * THE KNOWLEDGE TAB IS THE ROW'S ONE OPT-IN (Home Knowledge Panels M4).
 *
 * ⚠ IT DEFAULTS CLOSED, which inverts this column's usual rule that an unpassed
 * capability means "the workspace page's behaviour". The other two REMOVE
 * something; this one ADDS a tab that reads a channel-scoped grant lane, and the
 * workspace page has the whole knowledge surface a click away
 * (`channel-surface.tsx › ChannelSurfaceCapabilities.knowledge`).
 *
 * ⚠ AND ITS BODY MOUNTS WITH THE TAB. `false` is not a hidden control — nothing
 * is requested at all, which is the same property `selfManagement` buys the
 * consent inbox in `guest-surface-reads.test.tsx`.
 */
describe("the Knowledge tab is opt-in", () => {
  /** Tab labels in row order, badges stripped. */
  function tabRow(): string[] {
    return screen
      .getAllByRole("tab")
      .map((t) => (t.textContent ?? "").replace(/\d+$/, ""));
  }

  it("is ABSENT for a host that passes no capabilities — the workspace page", () => {
    renderPanel();
    expect(tabRow()).toEqual(["Info", "Threads", "Agents", "Settings"]);
  });

  it("is absent when the capability is explicitly false", () => {
    renderPanel({ knowledge: false });
    expect(screen.queryByRole("tab", { name: /^Knowledge/ })).toBeNull();
  });

  it("sits between Agents and Settings for a host that opts in", () => {
    renderPanel({ knowledge: true });
    expect(tabRow()).toEqual([
      "Info",
      "Threads",
      "Agents",
      "Knowledge",
      "Settings",
    ]);
  });

  it("carries no badge — the count would cost the read the tab exists to defer", () => {
    renderPanel({ knowledge: true });
    expect(badgeOf("Knowledge")).toBeNull();
  });

  it("STAYS in thread view, where Threads leaves", () => {
    // A knowledge base is granted onto the CHANNEL, so it is as true inside one
    // exchange as outside it.
    renderPanel({ knowledge: true, openThread: THREADS[0] });
    expect(screen.getByRole("tab", { name: /^Knowledge/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /^Threads/ })).toBeNull();
  });

  it("mounts its body only once the tab is opened", async () => {
    renderPanel({ knowledge: true });
    expect(screen.queryByTestId("knowledge-tab")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /^Knowledge/ }));
    expect(await screen.findByTestId("knowledge-tab")).toBeTruthy();
  });

  it("falls back to Info if the capability is withdrawn while it is selected", () => {
    // The same dead-selection rule the open thread exercises — and the fallback
    // asks the ROW which tabs exist rather than re-listing the conditions, so
    // both exits land in one place.
    const view = renderPanel({ knowledge: true });
    fireEvent.click(screen.getByRole("tab", { name: /^Knowledge/ }));
    expect(selected("Knowledge")).toBe(true);
    view.rerender(panel({ knowledge: false }));
    expect(screen.queryByRole("tab", { name: /^Knowledge/ })).toBeNull();
    expect(selected("Info")).toBe(true);
  });
});
