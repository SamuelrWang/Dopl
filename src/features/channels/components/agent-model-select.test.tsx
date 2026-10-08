// @vitest-environment jsdom
/**
 * Which model an agent runs on: the label vocabulary, no durable Settings row, the live selector and
 * the effective-model chip. Absent is not `null` is not "Default" (INVARIANTS §11).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  AGENT_MODEL_DEFAULT,
  agentModelLabel,
  agentModelShortLabel,
  normalizeAgentModel,
} from "../lib/agent-models";
import { agentRunningModel } from "./agents-model";
import { ChannelAgentSettingsView } from "./settings-agent";
import { PostureControls } from "./agent-posture";
import { CHANNEL_ID } from "./test-fixtures";
import type { ModelCatalogs } from "../lib/model-catalog";
import {
  catalog,
  channelRecordBridge,
  launchSelectionStub,
} from "../hooks/launch-selection-harness";
import { installSpaBridge } from "@/shared/testing/spa-bridge";

afterEach(cleanup);

const noop = () => {};

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    agentId: "k3v7d2mq",
    name: "k3v7d2mq",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

const CLAUDE_CATALOGS: ModelCatalogs = {
  claude: catalog(
    "claude",
    // What a live roster answers; the web tree types no lineup of its own (agent-models.ts).
    [
      { id: "claude-opus-5-5", label: "Opus 5.5", short: "Opus" },
      { id: "claude-sonnet-5-5", label: "Sonnet 5.5", short: "Sonnet", isDefault: true },
      { id: "claude-haiku-5-5", label: "Haiku 5.5", short: "Haiku" },
    ]
  ),
};

/** Just enough bridge for the live controls' two capability probes and the channel's launch record. */
function stubBridge(sessions: Record<string, unknown> = {}, catalogs = CLAUDE_CATALOGS) {
  installSpaBridge({
    sessions: { setMode: vi.fn(async () => ({ ok: true })), ...sessions },
    channels: channelRecordBridge({ catalogs }),
  });
}

/** Renders the live strip and lets the channel's launch record answer. */
async function renderLive(agent: DesktopSessionSummary) {
  render(<PostureControls agent={agent} channelId={CHANNEL_ID} taskId="t-1" />);
  await act(async () => {});
}

describe("the model vocabulary — one map, four surfaces", () => {
  // A sentinel would make "never chosen" and "chose the default" indistinguishable once the default moved.
  it("spells the absent state as the ABSENCE of an id, never as a sentinel", () => {
    expect(AGENT_MODEL_DEFAULT).toBe("");
    expect(normalizeAgentModel("")).toBeNull();
    expect(normalizeAgentModel("   ")).toBeNull();
    expect(normalizeAgentModel(undefined)).toBeNull();
    expect(normalizeAgentModel(null)).toBeNull();
  });

  it("gives each id the CATALOG's label where you are choosing; with none, the id prettified, nothing guessed", () => {
    const catalogs = CLAUDE_CATALOGS;
    expect(agentModelLabel("claude-opus-5-5", catalogs)).toBe("Opus 5.5");
    expect(agentModelLabel("claude-sonnet-5-5", catalogs)).toBe("Sonnet 5.5");
    // Offline: one generic rule, no vendor knowledge — the id reformatted, never a remembered name.
    expect(agentModelLabel("claude-opus-5")).toBe("Claude Opus 5");
    expect(agentModelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5 20251001");
    expect(agentModelLabel("claude-opus-5-5[1m]")).toBe("Claude Opus 5.5 [1m]");
    expect(agentModelLabel("gpt-5.6-sol")).toBe("Gpt 5.6 Sol");
    expect(agentModelLabel(null)).toBe("Default");
  });

  // The two disagree on absence on purpose: a picker offers Default; a card states what is running.
  it("renders a glance surface's absence as NOTHING, not as Default", () => {
    expect(agentModelShortLabel("claude-opus-5-5", CLAUDE_CATALOGS)).toBe("Opus");
    expect(agentModelShortLabel("claude-opus-5")).toBe("Claude Opus 5");
    expect(agentModelShortLabel(null)).toBeNull();
    expect(agentModelShortLabel(undefined)).toBeNull();
    expect(agentModelLabel(null)).toBe("Default");
  });

  // The roster moves without this tree shipping; an id this build predates is still a real model.
  it("renders an UNKNOWN id as itself rather than dropping it", () => {
    expect(agentModelLabel("claude-something-9")).toBe("Claude Something 9");
    expect(agentModelShortLabel("claude-something-9")).toBe("Claude Something 9");
    expect(agentModelLabel("-")).toBe("-");
    expect(normalizeAgentModel("claude-something-9")).toBe("claude-something-9");
  });
});
// The durable model row is deleted; its absence is pinned with a catalog that could fill it.
describe("NO model row on the Settings tab", () => {
  const view = (over: Partial<Parameters<typeof ChannelAgentSettingsView>[0]> = {}) =>
    render(
      <ChannelAgentSettingsView
        profile="full"
        onSetToolProfile={noop}
        toolProfileBusy={false}
        folder={null}
        selection={launchSelectionStub({
          defaultRuntime: "",
          catalogs: { "": catalog("", [{ id: "claude-sonnet-5", label: "Sonnet 5", isDefault: true }]) },
        })}
        {...over}
      />
    );

  it("renders no Model control and no Reasoning-effort control, even with a catalog to offer", () => {
    view();
    expect(screen.queryByLabelText("Model for agents you launch")).toBeNull();
    expect(screen.queryByLabelText(/Reasoning effort for agents you launch/)).toBeNull();
    expect(screen.getByLabelText("Messaging for agents you launch")).toBeTruthy();
  });
});

describe("the LIVE model selector on a running agent", () => {
  const live = () => screen.queryByLabelText("Model for this agent");

  // Separate capabilities: a build with `setMode` and no `setModel` is a real shape.
  it("renders no selector on a build with the axes and no model op", async () => {
    stubBridge();
    await renderLive(summary());
    expect(screen.getByLabelText("Tool permissions for this agent")).not.toBeNull();
    expect(live()).toBeNull();
  });

  it("renders it when the op exists", async () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    await renderLive(summary());
    expect(live()).not.toBeNull();
  });

  // Without `agentId` main moves the thread's oldest live agent, not this card's (F-239).
  it("addresses the instance", async () => {
    const setModel = vi.fn(async () => ({ ok: true }));
    stubBridge({ setModel });
    await renderLive(summary({ agentId: "k3v7d2mq" }));
    fireEvent.click(screen.getByLabelText("Model for this agent"));
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Opus 5\.5/ }));
    });
    expect(setModel).toHaveBeenCalledWith(CHANNEL_ID, "t-1", "claude-opus-5-5", "k3v7d2mq");
  });

  it("renders nothing at all for an ended agent", async () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    await renderLive(summary({ state: "ended" }));
    expect(live()).toBeNull();
  });

  // Main stamps whatever the CLI reported, which need not be on the roster.
  it("shows an off-roster effective model rather than a blank control", async () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    await renderLive({ ...summary(), model: "claude-opus-4-5-20251101" });
    expect(screen.getByLabelText("Model for this agent").textContent).toContain(
      "claude-opus-4-5-20251101"
    );
  });

  it("shows the model main reports, and the runtime's own default when it reports none", async () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    await renderLive({ ...summary(), model: "claude-haiku-5-5" });
    expect(screen.getByLabelText("Model for this agent").textContent).toContain("Haiku 5.5");
    cleanup();
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    await renderLive(summary());
    expect(screen.getByLabelText("Model for this agent").textContent).toContain("Sonnet 5.5");
  });

  // Never a frozen Claude list in the catalog's place.
  it("renders no selector when the desktop sent no catalog for the agent's runtime", async () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) }, {});
    await renderLive(summary());
    expect(live()).toBeNull();
  });
});

// The session's model, never the channel's stored pick: an agent may have been switched mid-run (F-142).
describe("agentRunningModel", () => {
  it("reads the summary's own model", () => {
    expect(
      agentRunningModel({ ...summary(), model: "claude-opus-5" })
    ).toBe("claude-opus-5");
  });

  it("answers null when this build reports none — absent is not the default", () => {
    expect(agentRunningModel(summary())).toBeNull();
    expect(
      agentRunningModel({ ...summary(), model: null })
    ).toBeNull();
    expect(agentModelShortLabel(agentRunningModel(summary()))).toBeNull();
  });
});
