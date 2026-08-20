// @vitest-environment jsdom
/**
 * The Agents tab and the agent view, WIRED (wiring plan Phase 5, 2026-08-18).
 *
 * These are the properties that go quiet rather than loud when they break, which
 * is why each one is pinned here:
 *
 *  - **"COULD NOT ASK" IS NOT "NOTHING IS RUNNING."** `null` (plain browser, or
 *    a main without the feed) and `[]` are different facts and are worded
 *    differently. An empty list under a browser reads as "you have no agents",
 *    which this surface cannot honestly claim (INVARIANTS §11 — UNKNOWN is not
 *    EMPTY).
 *  - **AN UNMEASURED METRIC RENDERS AS AN ABSENCE, NEVER AS 0.** A context meter
 *    reading 0% of a window that is nearly full is a lie the operator acts on.
 *  - **THE COPY RULE** (INVARIANTS §5): inside one member's window there is
 *    exactly ONE session, so it never needs a qualifier — "agent session" and
 *    "channel session" must appear nowhere on this surface, and the agent view
 *    is where the temptation lives.
 *  - **THE SENT LANE IS THE VIEWER'S OWN AGENT, ON THIS THREAD.** Matching on
 *    `authorKind` alone would put a teammate's agent in my panel.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { AgentsTab } from "./agents-tab";
import {
  AGENT_CONTROL_REFUSED,
  agentSentMessages,
  ChannelsV2AgentPanel,
} from "./agent-panel";
import { agentKey, agentsForChannel, formatTokens } from "./agents-model";
import { CHANNEL_ID, ME, PEER, message } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const HOUR = 3_600_000;

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    contextUsed: 84_000,
    contextWindow: 200_000,
    tokensSpent: 1_200_000,
    startedAt: Date.now() - 2 * HOUR,
    lastActivityAt: Date.now() - 60_000,
    ...over,
  };
}

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
    expect(screen.getByText("UI-kit design")).toBeTruthy();
    expect(screen.getByText(/Tokens spent: 1\.2M/)).toBeTruthy();
    // The meter's own label, from the shared UsageMeter.
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
    expect(screen.queryByText("Context tokens")).toBeNull();
    expect(screen.getByText(/Tokens spent: not measured yet/)).toBeTruthy();
    expect(screen.queryByText(/Started/)).toBeNull();
    // The one thing that must never happen: a fabricated zero.
    expect(screen.queryByText(/0k/)).toBeNull();
  });

  it("says a session with no first-class thread has no title, rather than nothing", () => {
    render(
      <AgentsTab
        sessions={[summary({ taskId: "", threadTitle: null })]}
        channelId={CHANNEL_ID}
        openAgent={null}
        onOpenAgent={noop}
      />
    );
    expect(screen.getByText("No thread title")).toBeTruthy();
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
    // ⚠ The desktop's registry is keyed on (channel, thread), so TWO live
    // sessions cannot share a taskId today — the grouping is what keeps the tab
    // correct if that ever widens, and it must not reorder anything meanwhile.
    const rows = [
      summary({ sessionId: "a", taskId: "t-1", name: "one" }),
      summary({ sessionId: "b", taskId: "t-2", name: "two" }),
      summary({ sessionId: "c", taskId: "t-1", name: "three" }),
    ];
    expect(agentsForChannel(rows, CHANNEL_ID).map((s) => s.name)).toEqual([
      "one",
      "three",
      "two",
    ]);
  });

  it("keys an agent on (channel, thread) — NOT the ephemeral sessionId", () => {
    // A park+recreate mints a new sessionId for the same agent. Keying the open
    // panel on it would close the view under the operator.
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
});

describe("agentSentMessages — what this agent actually posted", () => {
  const MINE = message({
    id: "m-mine",
    authorUserId: ME,
    authorKind: "agent",
    body: "posted by my agent",
    metadata: { taskId: "t-1" },
  });

  it("takes agent-authored rows on this thread under the viewer's OWN account", () => {
    expect(agentSentMessages([MINE], "t-1", ME).map((m) => m.id)).toEqual(["m-mine"]);
  });

  it("excludes a PEER's agent — `authorKind` alone would let it in", () => {
    const theirs = message({
      id: "m-theirs",
      authorUserId: PEER,
      authorKind: "agent",
      metadata: { taskId: "t-1" },
    });
    expect(agentSentMessages([theirs], "t-1", ME)).toEqual([]);
  });

  it("excludes my own HUMAN message, another thread, and lifecycle rows", () => {
    const human = message({ id: "m-h", authorUserId: ME, metadata: { taskId: "t-1" } });
    const other = message({
      id: "m-o",
      authorUserId: ME,
      authorKind: "agent",
      metadata: { taskId: "t-2" },
    });
    const lifecycle = message({
      id: "m-l",
      authorUserId: ME,
      authorKind: "agent",
      kind: "task_started",
      metadata: { taskId: "t-1" },
    });
    expect(agentSentMessages([human, other, lifecycle], "t-1", ME)).toEqual([]);
  });

  it("answers nothing for a session with no first-class thread", () => {
    // An empty taskId must not match every untagged row in the channel.
    const untagged = message({ id: "m-u", authorUserId: ME, authorKind: "agent" });
    expect(agentSentMessages([untagged, MINE], "", ME)).toEqual([]);
  });
});

describe("ChannelsV2AgentPanel", () => {
  it("shows the real sent lane and STATES the two lanes with no backing", () => {
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[
          message({
            id: "m-sent",
            authorUserId: ME,
            authorKind: "agent",
            body: "Renamed btn/secondary to btn/light.",
            metadata: { taskId: "t-1" },
          }),
        ]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    expect(screen.getByText("Renamed btn/secondary to btn/light.")).toBeTruthy();
    expect(screen.getByText(/sent to UI-kit design/)).toBeTruthy();
    // ⚠ The absent lanes are STATED, not drawn and not silently dropped: without
    // this line the panel reads as "this agent did nothing but post".
    expect(screen.getByText(/only what it sent/i)).toBeTruthy();
    // ⚠ And the direct lane's input is NOT rendered. An inert field that looks
    // like every field that does send is the worse failure (F-212).
    expect(screen.queryByLabelText(/Message this agent directly/i)).toBeNull();
  });

  it("hides EVERY control when the bridge cannot offer any of them", () => {
    // No `window.dopl` at all — a plain browser, or a main older than the ops.
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open window" })).toBeNull();
  });

  it("offers pause / end on a live agent and calls the bridge with (channel, thread)", () => {
    const pause = vi.fn().mockResolvedValue({ ok: true });
    const end = vi.fn().mockResolvedValue({ ok: true });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), pause, end },
    };
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    screen.getByRole("button", { name: "Pause" }).click();
    // ⚠ NEVER the sessionId — that id does not survive a park+recreate, and main
    // resolves the pair against its own registry (which is what makes these
    // own-agents-only).
    expect(pause).toHaveBeenCalledWith(CHANNEL_ID, "t-1");
    expect(end).not.toHaveBeenCalled();
  });

  it("disables both stop verbs on an ENDED agent — there is nothing left to stop", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), pause: vi.fn(), end: vi.fn() },
    };
    const agent = summary({ state: "ended" });
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    expect(
      (screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "End" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("NEVER writes 'agent session' or 'channel session' (INVARIANTS §5)", () => {
    const agent = summary();
    const { container } = render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("agent session");
    expect(text).not.toContain("channel session");
  });
});

/**
 * THE THREE CAPABILITIES ARE THREE GATES.
 *
 * ⚠ `reopen` is the OLD op, shared by both preloads (main has ONE reopen path);
 * `pause` / `end` arrived with the SPA. A single `canControlAgents()` gate over
 * the whole strip therefore hid "Open window" on every main that has `reopen`
 * and neither stop verb — a real build shape, and the affordance it hid is the
 * one that still worked. The matrix below is the old-preload matrix: a feed
 * with no controls, and controls with no reopen.
 */
describe("the agent view's control strip — one gate per capability", () => {
  const mountPanel = (agent = summary()) =>
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );

  it("offers OPEN WINDOW on a main that has reopen and neither stop verb", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn() },
    };
    mountPanel();
    expect(screen.getByRole("button", { name: "Open window" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End" })).toBeNull();
  });

  it("offers the STOP VERBS on a main that has them and no reopen", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { pause: vi.fn(), end: vi.fn() },
    };
    mountPanel();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End" })).toBeTruthy();
    // ⚠ And NOT a button that would throw "reopen is not a function".
    expect(screen.queryByRole("button", { name: "Open window" })).toBeNull();
  });

  it("calls reopen with (channel, thread) when it IS there", () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    (window as { dopl?: unknown }).dopl = { apiRequest: vi.fn(), sessions: { reopen } };
    mountPanel();
    screen.getByRole("button", { name: "Open window" }).click();
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, "t-1");
  });
});

/**
 * A REFUSED STOP VERB IS SAID OUT LOUD.
 *
 * ⚠ `state === "ended"` is a frame old at best: an agent that ends between the
 * paint and the click leaves both buttons enabled, main answers `{ok:false}`,
 * and the boolean used to be DISCARDED — the operator saw a pressed button and
 * no consequence, indistinguishable from success. And because main changed
 * NOTHING, no push follows to correct the panel, which is why the feed is
 * re-read on the same path.
 */
describe("the just-ended race", () => {
  const mountPanel = (onRefreshSessions?: () => void) => {
    const agent = summary();
    render(
      <ChannelsV2AgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
        onRefreshSessions={onRefreshSessions}
      />
    );
  };

  it("shows the refusal and re-reads the feed when main says {ok:false}", async () => {
    const pause = vi.fn().mockResolvedValue({ ok: false, reason: "no such session" });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), pause, end: vi.fn() },
    };
    const refresh = vi.fn();
    mountPanel(refresh);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });

    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByText(AGENT_CONTROL_REFUSED)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stays silent on a control that WORKED", async () => {
    const end = vi.fn().mockResolvedValue({ ok: true });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), pause: vi.fn(), end },
    };
    const refresh = vi.fn();
    mountPanel(refresh);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "End" }));
    });

    expect(screen.queryByText(AGENT_CONTROL_REFUSED)).toBeNull();
    // ⚠ No re-read on success either: a successful stop DOES move main's
    // projection, and the push is the delivery path. This must not become a poll.
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the notice when the operator tries again", async () => {
    const pause = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), pause, end: vi.fn() },
    };
    mountPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    expect(screen.getByText(AGENT_CONTROL_REFUSED)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    });
    expect(screen.queryByText(AGENT_CONTROL_REFUSED)).toBeNull();
  });
});
