// @vitest-environment jsdom
/**
 * The agent view, WIRED (wiring plan Phase 5, 2026-08-18), split from `agents-tab.test.tsx` at the
 * 500-line cap. Each property here fails QUIETLY, which is why it is pinned:
 *  - The sent lane is the viewer's own agent on THIS thread — the derivation's
 *    own cases live in `agent-sent-messages.test.ts`.
 *  - One gate per control capability, and a refused stop verb is said out loud.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChannelsAgentPanel } from "./agent-panel";
import { AGENT_CONTROL_REFUSED } from "./agent-panel-controls";
import { agentKey } from "./agents-model";
import { CHANNEL_ID, ME, message, sessionSummary as summary } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const noop = () => {};

describe("ChannelsAgentPanel", () => {
  it("shows the real sent lane and STATES the two lanes with no backing", () => {
    const agent = summary();
    render(
      <ChannelsAgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[
          message({
            id: "m-sent",
            authorUserId: ME,
            authorKind: "agent",
            body: "Renamed btn/secondary to btn/light.",
            metadata: { threadId: "t-1" },
          }),
        ]}
        currentUserId={ME}
        onClose={noop}
      />
    );
    expect(screen.getByText("Renamed btn/secondary to btn/light.")).toBeTruthy();
    // ⚠ THE POST WEARS THE v1 SENT BOX (2026-08-22), whose banner says where it
    // went — the "→ sent to X · date" meta line under each item is DELETED, and
    // its one useful fact moved into the banner rather than being lost.
    expect(screen.getByText("Posted to UI-kit design thread")).toBeTruthy();
    // ⚠ THE FOOTER EXPLAINER IS GONE (Samuel's minimal-copy ruling, 2026-08-22).
    // It pointed at another surface for lanes this one now renders itself.
    expect(screen.queryByText(/only what it sent/i)).toBeNull();
    // ⚠ And the direct lane's input is NOT rendered. An inert field that looks
    // like every field that does send is the worse failure (F-212).
    expect(screen.queryByLabelText(/Message this agent directly/i)).toBeNull();
  });

  it("hides EVERY control when the bridge cannot offer any of them", () => {
    // No `window.dopl` at all — a plain browser, or a main older than the ops.
    const agent = summary();
    render(
      <ChannelsAgentPanel
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
      <ChannelsAgentPanel
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
    expect(pause).toHaveBeenCalledWith(CHANNEL_ID, "t-1", undefined);
    expect(end).not.toHaveBeenCalled();
  });

  it("disables both stop verbs on an ENDED agent — there is nothing left to stop", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), pause: vi.fn(), end: vi.fn() },
    };
    const agent = summary({ state: "ended" });
    render(
      <ChannelsAgentPanel
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
      <ChannelsAgentPanel
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
      <ChannelsAgentPanel
        openAgent={agentKey(agent)}
        sessions={[agent]}
        messages={[]}
        currentUserId={ME}
        onClose={noop}
      />
    );

  // ⚠ "Open window" became "Open agent" on 2026-08-20 (F-212) and is "Open
  // window" again since 2026-08-25 (Samuel) — the panel IS the agent, so the
  // verb named what the operator was already looking at. The ORIGINAL note: a window is a VIEW,
  // not a runtime property, so the noun is what the operator is asking for.
  it("offers OPEN AGENT on a main that has reopen and neither stop verb", () => {
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

  // ⚠ WHAT THE BUTTON CALLS moved to `agents-detail.test.tsx` on 2026-08-20, whole:
  // that file owns the open-agent behaviour (prefer the new op, fall back to `reopen`,
  // carry the workspace segment), and asserting the same click in two files is how two
  // suites come to disagree about one button. This block keeps what it is ABOUT — which
  // capability shows which control.
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
      <ChannelsAgentPanel
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
