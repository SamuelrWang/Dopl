// @vitest-environment jsdom
/**
 * **THE SENDER PILL'S SECOND PRESS CLOSES THE AGENT VIEW AND RESETS THE COLUMN**
 * (Samuel, 2026-09-16, verbatim): *"if a user clicks on the badge and opens the agent view,
 * i want to make it so that if they click the badge again/aka click the badge of an agent
 * already opened up in view, it goes back to the channel info view, basically resets."*
 *
 * ⚠ **ITS OWN FILE, ON `agent-pill-open.test.tsx`'S OWN SEAM (§1).** That file pins the
 * pill's VERB and the gate on it — who becomes a button, and which id it sends. This one
 * pins what the SURFACE does with that id, which is two pieces of state in two components
 * and is why the behaviour can be half-built and look finished.
 *
 * The three properties, each of which fails quietly:
 *
 *  - **THE SAME KEY CLOSES, A DIFFERENT KEY SWITCHES.** A toggle written as
 *    `setOpenAgent(open === key ? null : key)` gets this right; one written as a plain
 *    close gets the multiplayer case wrong, and a room with six agents in it is exactly
 *    where the pill is used most.
 *  - **CLOSING RESETS THE TAB, WHICH IS THE HALF NOBODY SEES.** The agent view is drawn
 *    OVER the info column, so `setOpenAgent(null)` alone reveals whatever tab was
 *    underneath — the Agents tab, most often, since that is the other way in. Samuel's
 *    *"basically resets"* is that second half.
 *  - **BOTH SURFACES, BY CONSTRUCTION.** The workspace channels page
 *    (`channels-core.tsx`) and /home's pane (`channel-surface-standalone.tsx`) both mount
 *    `channel-surface.tsx`, so the wiring is pinned once — at the ONE call site that has
 *    to read `toggleAgent` rather than `setOpenAgent`.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { ChannelsInfoPanel } from "./info-panel";
import { useChannelsSelection } from "./use-channels-selection";
import { indexMembers } from "./view-model";
import { ME, PEER, channel, member, thread } from "./test-fixtures";

vi.mock("./knowledge-tab", () => ({
  ChannelKnowledgeTab: () => <div data-testid="knowledge-tab" />,
}));

afterEach(cleanup);

const A = "k3v7d2mq";
const B = "a1b2c3d4";

describe("useChannelsSelection — the pill's toggle", () => {
  it("opens an agent, closes the SAME one, and switches on a DIFFERENT one", () => {
    const { result } = renderHook(() => useChannelsSelection({}));
    expect(result.current.openAgent).toBeNull();

    act(() => result.current.toggleAgent(A));
    expect(result.current.openAgent).toBe(A);

    // ⚠ THE MULTIPLAYER ARM. A pill for another agent must SWITCH, never close — and
    // this is the case a "second press always closes" implementation passes nothing of.
    act(() => result.current.toggleAgent(B));
    expect(result.current.openAgent).toBe(B);

    act(() => result.current.toggleAgent(B));
    expect(result.current.openAgent).toBeNull();
  });

  it("bumps the info-tab signal ONLY when it actually closes a view", () => {
    const { result } = renderHook(() => useChannelsSelection({}));
    const start = result.current.infoTabSignal;

    act(() => result.current.toggleAgent(A));
    expect(result.current.infoTabSignal).toBe(start);
    act(() => result.current.toggleAgent(B));
    expect(result.current.infoTabSignal).toBe(start);

    // ⚠ THE RESET RIDES WITH THE CLOSE AND WITH NOTHING ELSE. Bumping on every press
    // would throw the operator off the Agents tab each time they opened an agent from
    // it, which is the opposite of what the ruling asks for.
    act(() => result.current.toggleAgent(B));
    expect(result.current.infoTabSignal).toBe(start + 1);

    // ⚠ ASKING TWICE ASKS TWICE — the nonce discipline `newThreadSignal` already keeps.
    act(() => result.current.toggleAgent(A));
    act(() => result.current.toggleAgent(A));
    expect(result.current.infoTabSignal).toBe(start + 2);
  });

  /** ⚠ THE PLAIN SETTER SURVIVES, because the Agents tab's cards still use it: a card
   *  for the open agent reads "Viewing" and pressing it must stay a no-op. */
  it("keeps setOpenAgent as a plain setter beside the toggle", () => {
    const { result } = renderHook(() => useChannelsSelection({}));
    act(() => result.current.setOpenAgent(A));
    act(() => result.current.setOpenAgent(A));
    expect(result.current.openAgent).toBe(A);
    expect(result.current.infoTabSignal).toBe(0);
  });
});

const INDEX = indexMembers(
  [member({ userId: ME }), member({ userId: PEER, role: "member" })],
  ME
);

function panel(signal: number) {
  return (
    <ChannelsInfoPanel
      channel={channel()}
      channelName="Website"
      members={[member({ userId: ME }), member({ userId: PEER, role: "member" })]}
      threads={[thread({ id: "t-a", title: "Alpha audit" })]}
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
      infoTabSignal={signal}
    />
  );
}

const selected = (label: string) =>
  screen.getByRole("tab", { name: new RegExp(`^${label}`) }).getAttribute("aria-selected") ===
  "true";

describe("the info column lands back on Info when the pill closes a view", () => {
  it("returns to the DEFAULT face from whatever tab was open", () => {
    const { rerender } = render(panel(0));
    act(() => {
      screen.getByRole("tab", { name: /^Agents/ }).click();
    });
    expect(selected("Agents")).toBe(true);

    // The pill's second press: `toggleAgent` closed the view and bumped the nonce.
    rerender(panel(1));
    expect(selected("Info")).toBe(true);
    expect(selected("Agents")).toBe(false);
  });

  it("leaves the operator's own tab pick alone while the nonce is unchanged", () => {
    // ⚠ THE OTHER DIRECTION, and the one a "reset on every render" bug passes the case
    // above with: re-rendering for any other reason must not steal the column back.
    const { rerender } = render(panel(3));
    act(() => {
      screen.getByRole("tab", { name: /^Threads/ }).click();
    });
    rerender(panel(3));
    expect(selected("Threads")).toBe(true);
  });
});

/**
 * ⚠ **A SOURCE PIN, AND IT IS THE HONEST SHAPE FOR THIS ONE.** The two handlers differ by a
 * single identifier at two call sites in one file, they render identically, and the
 * behavioural difference only appears on a SECOND press against live surface state — so a
 * mount-level test of it would have to reconstruct `ChannelSurface`'s whole data contract to
 * assert one prop reference. What matters is that the TRANSCRIPT reads the toggle and the
 * TAB COLUMN does not, and that is exactly what this reads.
 */
describe("both channel surfaces get the toggle, because both mount one surface", () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

  it("hands the transcript `toggleAgent` and the tab column `setOpenAgent`", () => {
    const surface = read("src/features/channels/components/channel-surface.tsx");
    expect(surface).toContain("onOpenAgent={sel.toggleAgent}");
    const tabs = read("src/features/channels/components/surface-info-panel.tsx");
    expect(tabs).toContain("onOpenAgent={sel.setOpenAgent}");
    expect(tabs).toContain("infoTabSignal={sel.infoTabSignal}");
  });

  it("is the ONE surface both hosts mount", () => {
    for (const host of [
      "src/features/channels/components/channels-core.tsx",
      "src/features/channels/components/channel-surface-standalone.tsx",
    ]) {
      expect(read(host)).toContain("<ChannelSurface");
    }
  });
});
