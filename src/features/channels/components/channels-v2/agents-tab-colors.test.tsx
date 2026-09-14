// @vitest-environment jsdom
/**
 * **THE AGENTS TAB'S COLOUR DOTS — ONE MARK, BOTH CARD SHAPES** (2026-09-14;
 * docs/specs/agent-colors.md item 8: *"the Agents-tab card and the pop-out rail row show a small
 * colour dot before the name for live agents"*).
 *
 * ⚠ **THE DEFECT THIS FILE EXISTS FOR IS HALF A RULING.** `agents-tab-cards.tsx › PeerCards` read
 * `peer.color` off the projection and drew the dot; `agents-tab-cards.tsx › AgentCard` declared a
 * `color` prop, carried a docblock naming its source — and **nothing passed it**. So one list drew
 * the mark for every member's agents EXCEPT the operator's own, which is the one comparison the
 * surface exists to make. A declared-but-unpassed prop is §11's silent-feature shape in a second
 * place: it typechecks, it renders, and it is simply never true.
 *
 * ⚠ **ITS OWN FILE ON `agents-tab-launch.test.tsx`'s PRECEDENT** — `agents-tab.test.tsx` measured
 * 485 lines when this landed and §1's cap is 500, so the tab's suites split by SUBJECT rather than
 * growing one file to the line. This one is the colour lane; the cards' numbers, the two absences
 * and the agent view stay there.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/** ⚠ THE PICKER'S READ IS MOCKED because the tab MOUNTS it (the split button's chevron); this stub
 *  only keeps the tab renderable, exactly as `agents-tab.test.tsx` does. */
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: [],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

import { AgentsTab } from "./agents-tab";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import { CHANNEL_ID, ME } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const OTHER = "u-other";
const noop = () => {};

/** This machine's own feed row — the shape `ownAgentsFor` slices. */
function own(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    agentId: "aa11bb22",
    name: "aa11bb22",
    displayName: "Scout",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

/** One row of the SERVER's per-channel projection — the only source of an assigned key. */
function peer(over: Partial<ChannelPeerSession> = {}): ChannelPeerSession {
  return {
    userId: ME,
    channelId: CHANNEL_ID,
    threadId: "t-1",
    name: "aa11bb22",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function dots(): string[] {
  return [...document.querySelectorAll("[data-agent-color]")].map(
    (el) => el.getAttribute("data-agent-color") ?? ""
  );
}

describe("the colour dot on an Agents-tab card", () => {
  /**
   * 🔒 MUTATION-PROOF: drop the `color` prop from the own `AgentCard` mount in `agents-tab.tsx`,
   * or key `colorOf` off anything but the projection row's `name`, and this fails alone.
   */
  it("draws MY OWN agent's key, off the projection rather than the local feed", () => {
    render(
      <AgentsTab
        sessions={[own()]}
        peers={[peer({ color: "agent-05" })]}
        currentUserId={ME}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    // ⚠ THE KEY ON THE DOM, never the resolved hue — `agent-color-dot.tsx`'s own rule.
    expect(dots()).toContain("agent-05");
  });

  /**
   * ⚠ **`DesktopSessionSummary.color` IS THE MACHINE'S *ASK* AND MUST NOT PAINT THIS CARD.** The
   * server may have substituted the next free key (`server/session-colors.ts`), so a card drawn
   * from the local feed would wear a hue the transcript's boxes do not use — two marks for one
   * agent, which is the whole thing the palette is for.
   */
  it("ignores the local feed's requested key when the projection has none", () => {
    render(
      <AgentsTab
        sessions={[own({ color: "agent-09" })]}
        peers={[peer()]}
        currentUserId={ME}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(dots()).toEqual([]);
  });

  /** ⚠ AND THE PEER HALF STILL WORKS — both shapes, one mark, in one list. */
  it("draws another member's agent key too", () => {
    render(
      <AgentsTab
        sessions={[]}
        peers={[
          peer({ userId: OTHER, name: "cc33dd44", color: "agent-02" }),
        ]}
        currentUserId={ME}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(dots()).toContain("agent-02");
  });
});
