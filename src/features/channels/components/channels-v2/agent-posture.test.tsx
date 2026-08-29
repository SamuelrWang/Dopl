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

  /**
   * F-236's SPA HALF (2026-08-20). A windowless session has NO ACCEPT SURFACE, so
   * `"ask"` on the MESSAGE axis held the peer's next message with every release
   * path deleted — the session parked at `awaiting_inbound` permanently and the
   * message was invisible to the agent, with no error anywhere. Main now floors
   * the live axis (`session-profiles.js › floorWindowlessMessage`), so the option
   * can no longer strand a reply; offering it anyway would leave a control that
   * silently snaps back, which is the lie this surface has been fixed for twice.
   *
   * ⚠ THE TOOL AXIS IS UNTOUCHED — "Ask each time" there is a real, working
   * posture, and asserting its presence is what stops this being read as a blanket
   * ban on the phrase.
   */
  it("does NOT offer Ask each time on the live MESSAGE axis — there is no accept surface", () => {
    install(vi.fn());
    mount();
    fireEvent.click(screen.getByLabelText("Message permissions for this agent"));
    expect(screen.queryByRole("menuitem", { name: /^Ask each time/ })).toBeNull();
    // The three that remain all resolve at or above the floor.
    expect(screen.getByRole("menuitem", { name: /^Auto accept in/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Auto send out/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Automatic/ })).toBeTruthy();
  });

  it("still offers Ask each time on the TOOL axis — that one has a live gate", () => {
    install(vi.fn());
    mount();
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    expect(screen.getByRole("menuitem", { name: /^Ask each time/ })).toBeTruthy();
  });

  it("shows the FLOOR, not 'ask', when an older main sends no message posture", () => {
    install(vi.fn());
    mount({ toolMode: undefined, messageMode: undefined });
    // Defaulting the display to a value the list no longer carries renders an
    // empty control; `auto_inbound` is what such a session actually runs on.
    expect(
      screen.getByLabelText("Message permissions for this agent").textContent
    ).toMatch(/Auto accept in/);
  });

  /**
   * ALL THREE WEAR THE CONSOLIDATED DROPDOWN SIZE (Samuel, 2026-08-29) —
   * `select-menu.tsx › TRIGGER_FACE.raisedField`, the size the composer launch panel's
   * Template/Model rows already wore, so the app has ONE small dropdown rather than two.
   *
   * ⚠ THIS PIN IS LOAD-BEARING FOR A NUMBER IN ANOTHER TREE. `main/agent-window.js ›
   * createAgentWindow` derives the pop-out's default width (540) from THESE dimensions, and the
   * row is `flex-wrap`: putting the taller/wider `raised` box back here does not clip or throw —
   * the third control silently drops to a second line in a window that is now too narrow for it.
   * Nothing in the renderer can observe that, and `test/agent-window.test.mjs` only sees the
   * width. This case is the other half of that pair.
   *
   * ⚠ CLASS TOKENS, NOT SUBSTRINGS — the rule `panel-field.test.tsx` bought: a `toContain`
   * check answers true on a neighbouring utility that merely spells the same letters.
   */
  it("wears the consolidated raisedField size on all three — the window width is measured from it", () => {
    // The MODEL control is a separately detected capability, so the bridge needs both ops for
    // this case to see the third trigger at all.
    (window as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: { setMode: vi.fn(), setModel: vi.fn() },
    };
    mount();
    for (const label of [
      "Tool permissions for this agent",
      "Message permissions for this agent",
      "Model for this agent",
    ]) {
      const tokens = screen.getByLabelText(label).className.split(/\s+/);
      // The FACE is shared with `raised` and must not drift; only the box is smaller.
      expect(tokens).toContain("auth-btn-3d-light");
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("px-2");
      expect(tokens).toContain("text-small");
      // `raised`'s box, the one this replaced.
      expect(tokens).not.toContain("h-9");
      expect(tokens).not.toContain("px-3");
      expect(tokens).not.toContain("text-body");
    }
  });

  /**
   * ONE LINE, AND A LONG LABEL ELLIPSIZES RATHER THAN BREAKING IT (Samuel, 2026-08-29).
   *
   * ⚠ THIS IS THE HALF THAT LETS THE WINDOW BE NARROW. `main/agent-window.js` opened at 540 with
   * ~34px of slack whose ONLY job was a long free-form model label — `agentModelOptionsFor`
   * appends whatever the agent is actually running, and a dated id is far wider than any of the
   * four picks. Samuel ruled the slack out ("only just enough so that they are all on the same
   * line with the same spacing"), so the overflow case had to move to the CONTROL, and the window
   * came down to 510.
   *
   * ⚠ THE ROW WAS `flex-wrap` AND THAT IS WHY THE TRUNCATION NEVER FIRED. `select-menu.tsx` has
   * always given the trigger `min-w-0 max-w-full` and its label span `min-w-0 truncate` — but a
   * flex line break is decided on an item's CONTENT width, BEFORE shrinking is considered, so the
   * pill wrapped to line two while its own ellipsis contract sat there unused. `flex-nowrap` is
   * what connects them.
   *
   * ⚠ jsdom LAYS NOTHING OUT, so this pins the MECHANISM and not the pixels: no wrap on the row,
   * the truncate contract on the span that holds the long text, and the long label present rather
   * than silently dropped. The pixel half is `test/agent-window.test.mjs`'s width bound.
   */
  it("keeps ONE line and ellipsizes a long free-form model label instead of wrapping", () => {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: { setMode: vi.fn(), setModel: vi.fn() },
    };
    // Not one of the four pickable ids — the exact shape `spa-bridge.ts` warns arrives.
    const long = "claude-opus-4-5-20251101[1m]";
    mount({ model: long } as Partial<DesktopSessionSummary>);

    const trigger = screen.getByLabelText("Model for this agent");
    const row = trigger.parentElement!;
    const rowTokens = row.className.split(/\s+/);
    expect(rowTokens).toContain("flex-nowrap");
    // The class whose presence used to make the window pay for this label.
    expect(rowTokens).not.toContain("flex-wrap");

    // The label is SHOWN, not swallowed — a `SelectMenu` whose value matches no option renders
    // blank, which is the surface saying nothing where it has an answer.
    expect(trigger.textContent).toContain(long);
    // …and it is the span carrying the ellipsis contract that holds it.
    const label = Array.from(trigger.querySelectorAll("span")).find((s) =>
      s.textContent?.includes(long)
    )!;
    expect(label).toBeTruthy();
    const labelTokens = label.className.split(/\s+/);
    expect(labelTokens).toContain("truncate");
    expect(labelTokens).toContain("min-w-0");
    // The trigger itself must be allowed to shrink, or the span never gets the chance.
    expect(trigger.className.split(/\s+/)).toContain("min-w-0");
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
    // ⚠ THE FIFTH ARGUMENT NAMES THE INSTANCE (2026-08-22). `(channel, thread)`
    // is a GROUP since multiplayer and main moves the OLDEST live member of it —
    // so without the id these selects would move a different agent's posture and
    // then show this one's unchanged, reading as a refusal that never happened.
    expect(setMode).toHaveBeenCalledWith(
      CHANNEL_ID,
      TASK,
      "tools",
      "bypass",
      undefined
    );
  });

  it("sends the MESSAGE axis under its own name", async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true });
    install(setMode);
    mount();
    fireEvent.click(screen.getByLabelText("Message permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Auto accept in/ }));
    });
    expect(setMode).toHaveBeenCalledWith(
      CHANNEL_ID,
      TASK,
      "messages",
      "auto_inbound",
      undefined
    );
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

  /**
   * …BUT THE BOX ONLY GOES WHEN IT HOLDS NOTHING (2026-08-27).
   *
   * ⚠ THE REGRESSION THIS PINS. The usage readout moved INSIDE this box in the
   * one-box wave, and the posture gate's bare `return null` then swallowed it:
   * an ended agent's window lost its context meter along with its controls, which
   * looked from the outside like the dropdowns "vanishing" on every agent. The
   * numbers are the summary feed's — they have nothing to do with the session
   * still running, or with the bridge op being present.
   *
   * ⚠ AND THE GATE ITSELF IS UNCHANGED AND MUST STAY: no posture row on an ended
   * agent (`3dc7e6a7`'s rule), and no sentence about when a posture applies.
   */
  it("keeps the STATS on an ended agent, and still offers no posture", () => {
    install(vi.fn());
    render(
      <PostureControls
        agent={agent({ state: "ended", toolMode: null, messageMode: null })}
        channelId={CHANNEL_ID}
        taskId={TASK}
        stats={<p>Context tokens</p>}
      />
    );
    expect(screen.getByText("Context tokens")).toBeTruthy();
    expect(screen.queryByLabelText("Tool permissions for this agent")).toBeNull();
    expect(screen.queryByText(/from its next decision/i)).toBeNull();
  });

  // ⚠ A LIVE agent on a build with the op renders all THREE — the state the
  // "vanished dropdowns" report was actually about. Same component in the pop-out.
  it("renders all three dropdowns for a LIVE agent", () => {
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: { setMode: vi.fn(), setModel: vi.fn() },
    };
    render(
      <PostureControls
        agent={agent()}
        channelId={CHANNEL_ID}
        taskId={TASK}
        stats={<p>Context tokens</p>}
      />
    );
    expect(screen.getByLabelText("Tool permissions for this agent")).toBeTruthy();
    expect(screen.getByLabelText("Message permissions for this agent")).toBeTruthy();
    expect(screen.getByLabelText("Model for this agent")).toBeTruthy();
    expect(screen.getByText("Context tokens")).toBeTruthy();
  });
});
