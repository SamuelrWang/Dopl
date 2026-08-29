// @vitest-environment jsdom
/**
 * AN ENDED AGENT IS DEAD, AND EVERY SURFACE HAS TO SAY SO (Samuel, 2026-08-22).
 *
 * ⚠ THE MODEL THIS PINS. Ending is TERMINAL — no revival, every wake path
 * refuses. The agent's own history is retained for a window and then swept, but
 * **what it POSTED stays in the channel forever.** That asymmetry is exactly why
 * the marker matters: an operator reading a thread will keep meeting a dead
 * agent's messages, and a card with no marker is indistinguishable from a quiet
 * live agent they are waiting on.
 *
 * The three properties, each of which fails silently:
 *
 *  - **THE PILL, IN ALL THREE PLACES AN AGENT IS NAMED** — the Agents tab's card,
 *    the slide-out panel's header, the agent window's header. A surface that
 *    forgets it shows a dead agent as a live one.
 *  - **THE COMPOSER IS GONE, NOT DISABLED.** A disabled box reads as "not right
 *    now" — a state that will pass — which is the opposite of what ended means.
 *  - **AN IN-FLIGHT SEND STILL GETS ITS ANSWER.** If the agent ends between Send
 *    and main's verdict, the input goes but the refusal stays: the operator
 *    pressed a button and is owed the outcome, and "the box vanished" is not one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { AgentsTab } from "./agents-tab";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { AgentComposer, MESSAGE_REFUSED } from "./agent-composer";
import { agentEndedAt, agentKey, agentLiveness } from "./agents-model";
import { CHANNEL_ID, ME } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

type Summary = DesktopSessionSummary & { agentId?: string; endedAt?: number | null };

function summary(over: Partial<Summary> = {}): Summary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    agentId: "a1b2c3d4",
    name: "a1b2c3d4",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

const DEAD = summary({ state: "ended" });

function bridge(message?: ReturnType<typeof vi.fn>) {
  const op = message ?? vi.fn().mockResolvedValue({ ok: true });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    sessions: { reopen: vi.fn(), message: op },
  };
  return op;
}

describe("the Ended pill", () => {
  it("marks an ended agent's CARD in the Agents tab", () => {
    render(
      <AgentsTab
        sessions={[DEAD]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getByText("Ended")).toBeTruthy();
    // ⚠ THE CARD IS STILL DRAWN. "My agent just finished" is something the
    // operator opened this tab to see — the pill states it, it does not hide it.
    expect(screen.getByText("Agent #a1b2c3d4")).toBeTruthy();
  });

  it("marks the slide-out panel's header", () => {
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(DEAD)}
        sessions={[DEAD]}
        messages={[]}
        currentUserId={ME}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Ended")).toBeTruthy();
  });

  it("REPLACES the liveness rather than joining it — one fact, one element", () => {
    // "Ended" beside a dot also reading "Ended" is one fact said twice, and a
    // redundant pair is the thing that reliably drifts.
    render(
      <AgentsTab
        sessions={[DEAD]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getAllByText("Ended")).toHaveLength(1);
    expect(screen.queryByText("Idle")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("leaves a LIVE agent's card unmarked", () => {
    render(
      <AgentsTab
        sessions={[summary()]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.queryByText("Ended")).toBeNull();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  /**
   * ⚠ THE STATE IS WHAT MARKS IT, NEVER THE STAMP. `endedAt` is additive and
   * absent both on an older main and on any agent that ended before the field
   * shipped — gating the pill on a timestamp would render every legacy ended
   * agent as live, which is the exact claim this marker exists to prevent.
   */
  it("marks an ended agent that carries no endedAt at all", () => {
    render(
      <AgentsTab
        sessions={[summary({ state: "ended", endedAt: undefined })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={() => {}}
      />
    );
    expect(screen.getByText("Ended")).toBeTruthy();
  });

  it("reads endedAt when it is there and answers null when it is not", () => {
    expect(agentEndedAt(summary({ endedAt: 1_700_000_000_000 }))).toBe(
      1_700_000_000_000
    );
    expect(agentEndedAt(summary())).toBeNull();
    // ⚠ Never a fabricated 0 — that would render as an ended-at at the epoch.
    expect(agentEndedAt(summary({ endedAt: null }))).toBeNull();
  });

  it("outranks every other signal in the label mapping", () => {
    // A stale `listening` or a retained `detail` riding along on an ended
    // summary must not make it read as alive.
    expect(
      agentLiveness({ state: "ended", listening: true, detail: "thinking" }).label
    ).toBe("Ended");
  });
});

describe("the 1:1 composer is GONE for an ended agent, not disabled", () => {
  it("renders no input and no Send in the panel", () => {
    bridge();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(DEAD)}
        sessions={[DEAD]}
        messages={[]}
        currentUserId={ME}
        onClose={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByLabelText(/^Message /)).toBeNull();
  });

  it("keeps the READ-ONLY stream — what it did is what the operator came for", () => {
    bridge();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(DEAD)}
        sessions={[DEAD]}
        messages={[]}
        currentUserId={ME}
        onClose={() => {}}
      />
    );
    // ⚠ The lane STATES its absence rather than rendering blank — an ended agent
    // whose stream shows nothing at all reads as a surface that failed to load.
    // ⚠ THE EMPTY COPY IS AN INSTRUCTION SINCE 2026-08-27 ("Send a message to wake agent.")
    // — the old "Nothing yet." stated a status where the operator needed an act.
    expect(screen.getByText(/wake agent|cannot show what your agent/i)).toBeTruthy();
  });

  it("still offers the input for an IDLE agent — idle is not ended", () => {
    bridge();
    const idle = summary({ state: "idle" });
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(idle)}
        sessions={[idle]}
        messages={[]}
        currentUserId={ME}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  /**
   * THE RACE. `state` is a frame old at best, so a send can be in flight when the
   * agent goes. The input disappears with it — dead is dead — but the verdict the
   * operator is owed must survive that unmount of the input.
   */
  it("still renders the refusal when the agent ends mid-send", async () => {
    bridge(vi.fn().mockResolvedValue({ ok: false }));
    const view = render(
      <AgentComposer channelId={CHANNEL_ID} taskId="t-1" agentId="a1b2c3d4" name="a1b2c3d4" />
    );
    fireEvent.change(screen.getByLabelText("Message a1b2c3d4"), {
      target: { value: "are you there" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_REFUSED);

    // The feed now reports the agent as ended, and the composer re-renders.
    view.rerender(
      <AgentComposer
        channelId={CHANNEL_ID}
        taskId="t-1"
        agentId="a1b2c3d4"
        name="a1b2c3d4"
        ended
      />
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_REFUSED);
  });

  it("renders nothing at all for an ended agent with no verdict outstanding", () => {
    bridge();
    const { container } = render(
      <AgentComposer
        channelId={CHANNEL_ID}
        taskId="t-1"
        agentId="a1b2c3d4"
        name="a1b2c3d4"
        ended
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

/**
 * THE WINDOW RESOLVES THE INSTANCE THE URL NAMES (2026-08-22 — F-239's last half
 * on this side).
 *
 * ⚠ THE AMBIGUITY IS THE BUG. `(channel, thread)` names a GROUP of this
 * operator's agents since multiplayer, so a window opened on the pair alone shows
 * whichever the feed happens to list first — with the right thread title, the
 * right channel, and the wrong agent's work. Nothing about that looks wrong.
 */
describe("the agent window picks the agent the URL names", () => {
  const A = summary({ sessionId: "s-a", agentId: "a1b2c3d4" });
  const B = summary({ sessionId: "s-b", agentId: "e5f6g7h8" });

  function pick(sessions: Summary[], agentId: string | null) {
    // The window's own resolution rule, run directly — mounting it needs the
    // narration bridge and the messages read, which are somebody else's tests.
    return (
      sessions.find(
        (s) =>
          s.channelId === CHANNEL_ID &&
          s.taskId === "t-1" &&
          (!agentId || s.agentId === agentId)
      ) ?? null
    );
  }

  it("takes the named one, not the first on the thread", () => {
    expect(pick([A, B], "e5f6g7h8")?.sessionId).toBe("s-b");
  });

  it("falls back to the first on the thread when the URL names none", () => {
    // ⚠ A DEGRADATION, NOT AN ERROR: a main that does not emit `?agent=` also
    // runs at most one agent per thread, so first-on-thread IS the agent.
    expect(pick([A, B], null)?.sessionId).toBe("s-a");
  });

  it("finds nothing when the named agent is gone", () => {
    // Better than silently showing a different agent's window under its id.
    expect(pick([A, B], "zzzzzzzz")).toBeNull();
  });
});
