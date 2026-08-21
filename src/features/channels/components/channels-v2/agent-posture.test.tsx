// @vitest-environment jsdom
/**
 * THE LIVE PERMISSION CONTROLS (Samuel, 2026-08-20) — both axes, on a RUNNING session.
 *
 * The properties that fail quietly, and the first one is why this surface exists at all:
 *
 *  - **THE VALUE SHOWN IS MAIN'S, NEVER THE RENDERER'S OWN ASK.** The reducer coerces
 *    fail-closed, and three things move a posture without this control touching it: the auth
 *    hold resetting both axes, a resume, and a change made in another window on the same
 *    agent. A select that stamped its own request would claim a posture nothing is
 *    enforcing — the exact lie the deleted session window's selects earned a fix for twice.
 *  - **A REFUSAL IS SAID OUT LOUD.** A control that visibly does nothing and says nothing is
 *    the failure this whole family has been bitten by repeatedly.
 *  - **AN ENDED AGENT GETS NO CONTROL**, rather than one that always refuses.
 *  - **IT IS NOT THE CHANNEL'S DURABLE POSTURE.** That governs the NEXT spawn and is a
 *    different surface (`settings-agent.tsx`); this stores nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { POSTURE_REFUSED, PostureControls } from "./agent-posture";
import { CHANNEL_ID } from "./test-fixtures";

const TASK = "t-1";
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function agent(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: TASK,
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    toolMode: "manual",
    messageMode: "ask",
    ...over,
  };
}

function install(setMode?: ReturnType<typeof vi.fn>) {
  const api: Record<string, unknown> = {};
  if (setMode) api.setMode = setMode;
  (window as unknown as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
    sessions: api,
  };
}

function mount(over: Partial<DesktopSessionSummary> = {}) {
  render(
    <PostureControls agent={agent(over)} channelId={CHANNEL_ID} taskId={TASK} />
  );
}

describe("what the controls show", () => {
  it("renders the LIVE posture main reported, not a default", () => {
    install(vi.fn());
    mount({ toolMode: "bypass", messageMode: "auto_both" });
    expect(screen.getByLabelText("Tool permissions for this agent").textContent).toMatch(
      /Bypass/
    );
    expect(
      screen.getByLabelText("Message permissions for this agent").textContent
    ).toMatch(/Automatic/);
  });

  // ⚠ Different fact from the channel's stored launch posture, which this never reads.
  it("says WHEN it takes effect — every other posture control means 'next launch'", () => {
    install(vi.fn());
    mount();
    expect(screen.getByText(/from its next decision/i)).toBeTruthy();
  });

  it("falls back to the fail-closed pair when an older main sends no posture", () => {
    install(vi.fn());
    mount({ toolMode: undefined, messageMode: undefined });
    expect(screen.getByLabelText("Tool permissions for this agent").textContent).toMatch(
      /Ask each time/
    );
  });
});

describe("what a change does", () => {
  it("sends ONE axis at a time, keyed by (channel, thread)", async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true, tools: "bypass", messages: "ask" });
    install(setMode);
    mount();
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    });
    expect(setMode).toHaveBeenCalledWith(CHANNEL_ID, TASK, "tools", "bypass");
  });

  it("sends the MESSAGE axis under its own name", async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true });
    install(setMode);
    mount();
    fireEvent.click(screen.getByLabelText("Message permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Auto accept in/ }));
    });
    expect(setMode).toHaveBeenCalledWith(CHANNEL_ID, TASK, "messages", "auto_inbound");
  });

  // ⚠ THE CASE THE WHOLE no-optimistic-stamp RULE EXISTS FOR.
  it("does NOT move the select on its own — the value comes back from the feed", async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true, tools: "bypass", messages: "ask" });
    install(setMode);
    mount({ toolMode: "manual" });
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    });
    // The prop still says `manual`; main's push is what will change it. A select that
    // stamped its own ask would show a posture nothing is enforcing.
    expect(screen.getByLabelText("Tool permissions for this agent").textContent).toMatch(
      /Ask each time/
    );
  });

  it("says so when main refused", async () => {
    install(vi.fn().mockResolvedValue({ ok: false, reason: "no-session" }));
    mount();
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    });
    expect(await screen.findByText(POSTURE_REFUSED)).toBeTruthy();
  });
});

describe("when the controls are not offered at all", () => {
  it("renders nothing on a build without the op", () => {
    install(); // no `setMode`
    const { container } = render(
      <PostureControls agent={agent()} channelId={CHANNEL_ID} taskId={TASK} />
    );
    expect(container.firstChild).toBeNull();
  });

  // An ended agent has no posture to change; main answers `no-session`, and the honest face
  // of that is no control rather than one that always refuses.
  it("renders nothing for an ENDED agent", () => {
    install(vi.fn());
    const { container } = render(
      <PostureControls
        agent={agent({ state: "ended", toolMode: null, messageMode: null })}
        channelId={CHANNEL_ID}
        taskId={TASK}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
