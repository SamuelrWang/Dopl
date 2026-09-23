// @vitest-environment jsdom
/**
 * Live posture controls on a running agent: the value shown is always main's (no optimistic stamp), a
 * refusal is said out loud, an ended agent gets no control, and nothing is stored.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { POSTURE_REFUSED, PostureControls } from "./agent-posture";
import { CHANNEL_ID } from "./test-fixtures";
import { AGENT_MODELS } from "../lib/agent-models";
import { catalog, channelRecordBridge } from "../hooks/launch-selection-harness";
import { installSpaBridge } from "@/shared/testing/spa-bridge";

const TASK = "t-1";
afterEach(cleanup);

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

const CATALOGS = {
  claude: catalog("claude", [
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-sonnet-5", label: "Sonnet 5", isDefault: true },
  ]),
  codex: catalog("codex", [{ id: "gpt-6-sol", label: "GPT-6 Sol", isDefault: true }]),
  cursor: catalog("cursor", [
    { id: "composer-2", label: "Composer 2", isDefault: true },
    { id: "gpt-6-sol", label: "GPT-6 Sol" },
  ]),
};

function install(
  setMode?: ReturnType<typeof vi.fn>,
  sessions: Record<string, unknown> = {},
  channelRuntime = "claude"
) {
  const api: Record<string, unknown> = { ...sessions };
  if (setMode) api.setMode = setMode;
  installSpaBridge({
    sessions: api,
    channels: channelRecordBridge({ runtime: channelRuntime, catalogs: CATALOGS }),
  });
}

/** Renders, then lets the channel's launch-record read answer. */
async function mount(over: Partial<DesktopSessionSummary> = {}) {
  render(
    <PostureControls agent={agent(over)} channelId={CHANNEL_ID} taskId={TASK} />
  );
  await act(async () => {});
}

describe("what the controls show", () => {
  it("renders the LIVE posture main reported, not a default", async () => {
    install(vi.fn());
    await mount({ toolMode: "bypass", messageMode: "auto_both" });
    expect(screen.getByLabelText("Tool permissions for this agent").textContent).toMatch(
      /Bypass/
    );
    expect(
      screen.getByLabelText("Message permissions for this agent").textContent
    ).toMatch(/Automatic/);
  });

  // Minimal copy (INVARIANTS §5); pinned as an absence because this sentence is the kind that comes back.
  it("says NOTHING about when it takes effect — the sentence is gone", async () => {
    install(vi.fn());
    await mount();
    expect(screen.queryByText(/from its next decision/i)).toBeNull();
  });

  it("falls back to the fail-closed pair when an older main sends no posture", async () => {
    install(vi.fn());
    await mount({ toolMode: undefined, messageMode: undefined });
    expect(screen.getByLabelText("Tool permissions for this agent").textContent).toMatch(
      /Ask each time/
    );
  });

  // A windowless session has no accept surface and main floors the live message axis
  // (`session-profiles.js › floorWindowlessMessage`), so `ask` would silently snap back (F-236).
  it("does NOT offer Ask each time on the live MESSAGE axis — there is no accept surface", async () => {
    install(vi.fn());
    await mount();
    fireEvent.click(screen.getByLabelText("Message permissions for this agent"));
    expect(screen.queryByRole("menuitem", { name: /^Ask each time/ })).toBeNull();
    // The three that remain all resolve at or above the floor.
    expect(screen.getByRole("menuitem", { name: /^Auto accept in/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Auto send out/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^Automatic/ })).toBeTruthy();
  });

  it("still offers Ask each time on the TOOL axis — that one has a live gate", async () => {
    install(vi.fn());
    await mount();
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    expect(screen.getByRole("menuitem", { name: /^Ask each time/ })).toBeTruthy();
  });

  it("shows the FLOOR, not 'ask', when an older main sends no message posture", async () => {
    install(vi.fn());
    await mount({ toolMode: undefined, messageMode: undefined });
    // `auto_inbound` is what such a session runs on; a value off the list would render empty.
    expect(
      screen.getByLabelText("Message permissions for this agent").textContent
    ).toMatch(/Auto accept in/);
  });

  // `main/agent-window.js` sizes the pop-out from these triggers, so the larger `raised` box would wrap
  // the third control. Class tokens, not substrings: `toContain` would match a neighbouring utility.
  it("wears the consolidated raisedField size on all three — the window width is measured from it", async () => {
    // The model control is a separate capability, so the bridge needs both ops.
    install(vi.fn(), { setModel: vi.fn() });
    await mount();
    for (const label of [
      "Tool permissions for this agent",
      "Message permissions for this agent",
      "Model for this agent",
    ]) {
      const tokens = screen.getByLabelText(label).className.split(/\s+/);
      // The face is shared with `raised`; only the box is smaller.
      expect(tokens).toContain("auth-btn-3d-light");
      expect(tokens).toContain("h-6");
      expect(tokens).toContain("px-2");
      expect(tokens).toContain("text-small");
      // `raised`'s box.
      expect(tokens).not.toContain("h-9");
      expect(tokens).not.toContain("px-3");
      expect(tokens).not.toContain("text-body");
    }
  });

  // A flex line breaks on content width before shrinking, so only `flex-nowrap` lets the label truncate.
  // jsdom lays nothing out: this pins the mechanism; the pixel half is `test/agent-window.test.mjs`.
  it("keeps ONE line and ellipsizes a long free-form model label instead of wrapping", async () => {
    install(vi.fn(), { setModel: vi.fn() });
    // Off the roster, the shape `spa-bridge.ts` warns arrives.
    const long = "claude-opus-4-5-20251101[1m]";
    await mount({ model: long } as Partial<DesktopSessionSummary>);

    const trigger = screen.getByLabelText("Model for this agent");
    const row = trigger.parentElement!;
    const rowTokens = row.className.split(/\s+/);
    expect(rowTokens).toContain("flex-nowrap");
    expect(rowTokens).not.toContain("flex-wrap");

    // Shown, not swallowed: a `SelectMenu` whose value matches no option renders blank.
    expect(trigger.textContent).toContain(long);
    // …held by the span carrying the ellipsis contract.
    const label = Array.from(trigger.querySelectorAll("span")).find((s) =>
      s.textContent?.includes(long)
    )!;
    expect(label).toBeTruthy();
    const labelTokens = label.className.split(/\s+/);
    expect(labelTokens).toContain("truncate");
    expect(labelTokens).toContain("min-w-0");
    // The trigger must be allowed to shrink, or the span never gets the chance.
    expect(trigger.className.split(/\s+/)).toContain("min-w-0");
  });
});

describe("what a change does", () => {
  it("sends ONE axis at a time, keyed by (channel, thread)", async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true, tools: "bypass", messages: "ask" });
    install(setMode);
    await mount();
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    });
    // The fifth argument names the instance: `(channel, thread)` is a group, and without it main moves
    // its oldest live member.
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
    await mount();
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

  it("does NOT move the select on its own — the value comes back from the feed", async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true, tools: "bypass", messages: "ask" });
    install(setMode);
    await mount({ toolMode: "manual" });
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    });
    // The prop still says `manual`; only main's push changes it.
    expect(screen.getByLabelText("Tool permissions for this agent").textContent).toMatch(
      /Ask each time/
    );
  });

  it("says so when main refused", async () => {
    install(vi.fn().mockResolvedValue({ ok: false, reason: "no-session" }));
    await mount();
    fireEvent.click(screen.getByLabelText("Tool permissions for this agent"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    });
    expect(await screen.findByText(POSTURE_REFUSED)).toBeTruthy();
  });
});

describe("when the controls are not offered at all", () => {
  it("renders nothing on a build without the op", async () => {
    install(); // no `setMode`
    const { container } = render(
      <PostureControls agent={agent()} channelId={CHANNEL_ID} taskId={TASK} />
    );
    expect(container.firstChild).toBeNull();
  });

  // Main answers `no-session` for an ended agent; the honest face is no control.
  it("renders nothing for an ENDED agent", async () => {
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

  // The usage readout lives in this box: the ended-agent gate drops the posture row, never the stats.
  it("keeps the STATS on an ended agent, and still offers no posture", async () => {
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

  it("renders all three dropdowns for a LIVE agent", async () => {
    install(vi.fn(), { setModel: vi.fn() });
    render(
      <PostureControls
        agent={agent()}
        channelId={CHANNEL_ID}
        taskId={TASK}
        stats={<p>Context tokens</p>}
      />
    );
    await act(async () => {});
    expect(screen.getByLabelText("Tool permissions for this agent")).toBeTruthy();
    expect(screen.getByLabelText("Message permissions for this agent")).toBeTruthy();
    expect(screen.getByLabelText("Model for this agent")).toBeTruthy();
    expect(screen.getByText("Context tokens")).toBeTruthy();
  });
});

// The agent's own runtime, not the channel's: a per-spawn pick can put a Codex agent on a Claude channel.
describe("a running agent on a runtime other than the channel's", () => {
  it("offers the AGENT's tool words and no Claude model list", async () => {
    install(vi.fn(), { setModel: vi.fn() });
    await mount({ runtimeId: "codex", toolMode: "on-request", model: "gpt-6-sol" });
    const tools = screen.getByLabelText("Tool permissions for this agent");
    expect(tools.textContent).toMatch(/on-request/);
    fireEvent.click(tools);
    expect(screen.getByRole("menuitem", { name: /^never/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Bypass/ })).toBeNull();
    // Codex declares no verified live model switch, so there is no picker.
    expect(screen.queryByLabelText("Model for this agent")).toBeNull();
  });

  it("offers a Claude agent Claude's models on a Codex channel", async () => {
    install(vi.fn(), { setModel: vi.fn() }, "codex");
    await mount({ runtimeId: "claude", model: "claude-sonnet-5" });
    fireEvent.click(screen.getByLabelText("Model for this agent"));
    expect(screen.getByRole("menuitem", { name: /^Opus 5/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /GPT-6 Sol/ })).toBeNull();
  });

  it("offers a non-Claude agent its own catalog's models and no Claude one", async () => {
    install(vi.fn(), { setModel: vi.fn() });
    await mount({ runtimeId: "cursor", model: "composer-2" });
    fireEvent.click(screen.getByLabelText("Model for this agent"));
    const offered = screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
    expect(offered).toHaveLength(2);
    expect(offered[0]).toMatch(/^Composer 2/);
    expect(offered[1]).toMatch(/^GPT-6 Sol/);
    for (const m of AGENT_MODELS) {
      expect(offered.join(" ")).not.toContain(m.label);
      expect(offered.join(" ")).not.toContain(m.id);
    }
  });
});
