// @vitest-environment jsdom
/**
 * The Agents tab, WIRED (wiring plan Phase 5, 2026-08-18); the agent view's half is
 * `agents-tab-agent-view.test.tsx`. Each property here fails QUIETLY, which is why it is pinned:
 *  - `null` (could not ask) is not `[]` (nothing running) — INVARIANTS §11.
 *  - An unmeasured metric renders as an absence, never as 0.
 *  - One session per member's window, so it never needs a qualifier (§5).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * ⚠ THE IDENTITY PICKER'S READ IS MOCKED because the tab MOUNTS the picker since
 * 2026-08-22 — the split button's chevron. Its own cases live in
 * `./agents-tab-launch.test.tsx` (split at the 500-line cap); this stub only
 * keeps the tab renderable here.
 */
vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({
    identities: [],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

import { AgentsTab } from "./agents-tab";
import { agentKey, agentsForChannel, NO_THREAD_LABEL } from "./agents-model";
import { formatTokens } from "@/shared/lib/format-tokens";
import { CHANNEL_ID, ME, PEER, member, sessionSummary as summary } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const noop = () => {};

describe("AgentsTab — the two absences", () => {
  it("says the surface is DESKTOP-ONLY when there is no bridge to ask", () => {
    render(
      <AgentsTab sessions={null} channelId={CHANNEL_ID} openAgent={null} onOpenAgent={noop} />
    );
    expect(screen.getByText(/desktop app/i)).toBeTruthy();
    // ⚠ It must not fall back to the empty-list wording — that would report
    // "you have no agents" on a surface that could not ask.
    expect(screen.queryByText(/No agents running in this channel/i)).toBeNull();
  });

  it("says nothing is running when the desktop answered with an empty feed", () => {
    render(
      <AgentsTab sessions={[]} channelId={CHANNEL_ID} openAgent={null} onOpenAgent={noop} />
    );
    expect(screen.getByText(/No agents running in this channel/i)).toBeTruthy();
    expect(screen.queryByText(/desktop app/i)).toBeNull();
  });
});

describe("AgentsTab — the cards", () => {
  it("renders the real name, thread and measured numbers", () => {
    render(
      <AgentsTab
        sessions={[summary()]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("flint")).toBeTruthy();
    expect(screen.getByText(/^↳ UI-kit design/)).toBeTruthy();
    expect(screen.getByText("1.2M tokens spent")).toBeTruthy();
    expect(screen.getByText("Context tokens")).toBeTruthy();
  });

  it("renders an UNMEASURED metric as an absence, never as a zero", () => {
    // The shape an older main sends (fields absent) and the shape a session
    // sends before its first turn reports usage.
    render(
      <AgentsTab
        sessions={[
          summary({
            contextUsed: null,
            contextWindow: null,
            tokensSpent: null,
            startedAt: null,
            lastActivityAt: null,
          }),
        ]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    // 🔒 ⚠ **THE METER IS THE RULED EXCEPTION AND IT DRAWS (Samuel, 2026-08-27 *"the bar at zero,
    // always"*; re-affirmed 2026-09-22, asked directly whether an unmeasured readout should print
    // `0` or `—`: *"have it show 0"*).** This case asserted the OPPOSITE until then — it required
    // the meter to be ABSENT — while `agent-stats.tsx` drew it at zero on the other surface, so
    // one spawn-idle agent looked different depending on where it was read and each surface had a
    // green test defending its own answer. The same finding as the thread-title case below.
    expect(screen.getByText("Context tokens")).toBeTruthy();
    expect(screen.getByText("Context tokens").textContent).not.toContain("/");
    // ⚠ EVERY OTHER ABSENCE IS STILL AN ABSENCE. The ruling is about the BAR, not about inventing
    // facts: a number with no measurement says so, and a missing stamp renders nothing at all.
    expect(screen.getByText(/Tokens spent: not measured yet/)).toBeTruthy();
    expect(screen.queryByText(/Started/)).toBeNull();
  });

  /**
   * ⚠ THIS PINNED THE RETIRED COPY UNTIL 2026-08-28, AND THAT IS THE FINDING RATHER THAN THE FIX.
   * Samuel's 2026-08-27 ruling replaced "No thread title" — a MISSING FIELD — with the PLACE a
   * channel-level agent is actually in (`agents-model.ts › NO_THREAD_LABEL`, "main channel"), and
   * `agents-detail.test.tsx › "names the CHANNEL, not a missing field"` pins it on the PANEL. The
   * card was never converted, so the two surfaces the operator clicks between said different
   * things about one agent — and each had a green test defending its own wording.
   * ⚠ IT ASSERTS THE CONSTANT, NOT A LITERAL, so the next re-wording cannot leave this pin
   * defending a string the product no longer says.
   */
  it("names the CHANNEL for a session on no first-class thread, as the panel does", () => {
    render(
      <AgentsTab
        sessions={[summary({ threadId: "", threadTitle: null })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText(new RegExp(NO_THREAD_LABEL, "i"))).toBeTruthy();
  });

  it("shows only THIS channel's agents, and marks the open one Viewing", () => {
    const mine = summary();
    const elsewhere = summary({ sessionId: "s-2", channelId: "ch-other", name: "quartz" });
    render(
      <AgentsTab
        sessions={[mine, elsewhere]}
        channelId={CHANNEL_ID}
        openAgent={agentKey(mine)}
        onOpenAgent={noop}
      />
    );
    expect(screen.queryByText("quartz")).toBeNull();
    expect(screen.getByRole("button", { name: "Viewing" })).toBeTruthy();
  });

  it("draws each agent as its owner's identity face with its runtime's badge", () => {
    const { container } = render(
      <AgentsTab
        sessions={[summary({ agentId: "aa11bb22", runtimeId: "claude" })]}
        peers={[
          {
            userId: PEER,
            channelId: CHANNEL_ID,
            threadId: "t-1",
            name: "cc33dd44",
            displayName: "Rover",
            runtime: "grok",
            state: "working",
            channelName: "Website",
            threadTitle: "UI-kit design",
            updatedAt: new Date().toISOString(),
          },
        ]}
        members={[member({ userId: ME }), member({ userId: PEER, displayName: "Diana Taylor" })]}
        currentUserId={ME}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(container.querySelectorAll("[data-identity-face]")).toHaveLength(2);
    expect(container.querySelector("svg.lucide-bot")).toBeNull();
    const badges = [...container.querySelectorAll("[data-identity-face] img")].map((i) =>
      i.getAttribute("src")
    );
    expect(badges).toContain("/img/onboarding/claude-logo.svg");
    expect(badges).toContain("/img/onboarding/grok-logo.svg");
    expect(screen.getByText(/^↳ Diana Taylor's agent/)).toBeTruthy();
  });

  it("NEVER writes 'agent session' or 'channel session' (INVARIANTS §5)", () => {
    const { container } = render(
      <AgentsTab
        sessions={[summary()]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("agent session");
    expect(text.toLowerCase()).not.toContain("channel session");
  });
});

describe("agentsForChannel / agentKey", () => {
  it("groups agents sharing a thread together, keeping feed order within one", () => {
    // ⚠ THE SHARED-THREAD CASE IS THE NORMAL ONE SINCE 2026-08-21 (multiplayer
    // agents): every launch mints a new instance, so N of them sit on one
    // threadId. The grouping keeps them adjacent and must not reorder anything.
    const rows = [
      summary({ sessionId: "a", threadId: "t-1", name: "one" }),
      summary({ sessionId: "b", threadId: "t-2", name: "two" }),
      summary({ sessionId: "c", threadId: "t-1", name: "three" }),
    ];
    expect(agentsForChannel(rows, CHANNEL_ID).map((s) => s.name)).toEqual([
      "one",
      "three",
      "two",
    ]);
  });

  it("keys an agent on (channel, thread) with no id — NOT the sessionId", () => {
    // A park+recreate mints a new sessionId for the same agent. Keying the open
    // panel on it would close the view under the operator. ⚠ The pair is the
    // FALLBACK now — `agents-multiplayer.test.tsx` owns the id-keyed half.
    const before = summary({ sessionId: "s-1" });
    const after = summary({ sessionId: "s-99" });
    expect(agentKey(after)).toBe(agentKey(before));
  });
});

describe("formatTokens", () => {
  it("glances rather than reads — thousands, then millions", () => {
    expect(formatTokens(84_000)).toBe("84k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(48_000_000)).toBe("48M");
  });

  /** 🔒 ONE DECLARATION SINCE 2026-09-17, and these are the three inputs on
   *  which the two disagreed. The Overview's floor won: the figure it formats is
   *  ALREADY a floor (`overview/token-spend-strip.tsx`'s header), so rounding up
   *  turns an under-count into an over-claim — and this tab renders the same
   *  quantised number. */
  it("FLOORS, never rounds up", () => {
    expect(formatTokens(84_500)).toBe("84k");
    expect(formatTokens(1_250_000)).toBe("1.2M");
    expect(formatTokens(999_999)).toBe("999k");
  });

  /** 🔒 An agent under 500 tokens read "0k" on every card until this arm
   *  existed — a measured spend rendered as no spend. */
  it("prints a sub-1000 count whole", () => {
    expect(formatTokens(400)).toBe("400");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(0)).toBe("0");
  });
});
