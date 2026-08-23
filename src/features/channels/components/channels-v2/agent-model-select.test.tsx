// @vitest-environment jsdom
/**
 * WHICH MODEL AN AGENT RUNS ON — the vocabulary, the DURABLE row on the Settings
 * tab, the LIVE selector on a running agent, and the effective-model chip
 * (Samuel, 2026-08-22).
 *
 * Its own file rather than an addition to `settings-tab.test.tsx` (410 lines) or
 * `agents-tab.test.tsx` (456 of the 500-line cap): the feature crosses three
 * surfaces and one vocabulary module, and the properties below are about the
 * FEATURE rather than about any one of those surfaces' layout.
 *
 * The properties that fail quietly, and are therefore what this file is for:
 *
 *  - **ONE ID→LABEL MAP.** Four surfaces name a model; a second table is the
 *    two-readers-one-fact defect with a MODEL NAME as the thing that drifts, and
 *    an operator reading "Opus" on a card and "Sonnet" in Settings has no way to
 *    tell which is lying.
 *  - **ABSENT IS NOT `null` IS NOT `"Default"`.** A desktop with no model concept
 *    omits the field; a current one answers `null` for "the SDK default applies".
 *    The Settings row gates on the FIRST distinction and the card renders the
 *    SECOND as no chip at all (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *  - **NO CONTROL WITHOUT THE CAPABILITY.** A row that writes a field main drops
 *    is the worst shape available: the pick appears to save and every launch
 *    ignores it.
 *  - **AN UNKNOWN ID STILL RENDERS.** The roster is the SDK's and moves without
 *    this tree shipping, so a model this build predates must read as itself
 *    rather than vanish.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  AGENT_MODEL_DEFAULT,
  AGENT_MODEL_OPTIONS,
  agentModelLabel,
  agentModelOptionsFor,
  agentModelShortLabel,
  normalizeAgentModel,
} from "../../lib/agent-models";
import {
  hasModelKey,
  normalizePermissionPreset,
  DEFAULT_PERMISSION_PRESET,
} from "../../lib/permission-modes";
import { agentRunningModel } from "./agents-model";
import { ChannelAgentSettingsView } from "./settings-agent";
import { PostureControls } from "./agent-posture";
import { CHANNEL_ID } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

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

/**
 * Stand up just enough bridge for the LIVE controls' two capability probes.
 *
 * ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — without it
 * the whole bridge reads as absent and every probe answers false, which looks
 * exactly like the capability being missing.
 */
function stubBridge(over: Record<string, unknown> = {}) {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
    sessions: {
      setMode: vi.fn(async () => ({ ok: true })),
      ...over,
    },
  };
}

describe("the model vocabulary — one map, four surfaces", () => {
  it("carries Default plus the four models, Default first", () => {
    expect(AGENT_MODEL_OPTIONS.map((o) => o.value)).toEqual([
      AGENT_MODEL_DEFAULT,
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
    expect(AGENT_MODEL_OPTIONS[0].label).toBe("Default");
  });

  /** ⚠ THE DEFAULT WRITES NO ID. A sentinel would be a value main has to
   *  special-case, and would make "never chosen" and "chose the default"
   *  indistinguishable the moment the SDK default moved. */
  it("spells Default as the ABSENCE of an id, never as a sentinel", () => {
    expect(AGENT_MODEL_DEFAULT).toBe("");
    expect(normalizeAgentModel("")).toBeNull();
    expect(normalizeAgentModel("   ")).toBeNull();
    expect(normalizeAgentModel(undefined)).toBeNull();
    expect(normalizeAgentModel(null)).toBeNull();
  });

  it("gives each id its full label for a surface where you are CHOOSING", () => {
    expect(agentModelLabel("claude-fable-5")).toBe("Fable 5");
    expect(agentModelLabel("claude-opus-5")).toBe("Opus 5");
    expect(agentModelLabel("claude-sonnet-5")).toBe("Sonnet 5");
    expect(agentModelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(agentModelLabel(null)).toBe("Default");
  });

  /**
   * ⚠ THE TWO LABEL FUNCTIONS DISAGREE ON ABSENCE ON PURPOSE, and that is the
   * property most likely to be "simplified" into one. `agentModelLabel` is for a
   * PICKER, where Default is one of the picks; `agentModelShortLabel` is for a
   * CARD, which states what an agent IS RUNNING — and a build that reports no
   * model has said nothing about that.
   */
  it("renders a glance surface's absence as NOTHING, not as Default", () => {
    expect(agentModelShortLabel("claude-opus-5")).toBe("Opus");
    expect(agentModelShortLabel("claude-fable-5")).toBe("Fable");
    expect(agentModelShortLabel(null)).toBeNull();
    expect(agentModelShortLabel(undefined)).toBeNull();
    expect(agentModelLabel(null)).toBe("Default");
  });

  /** ⚠ The roster is the SDK's and moves without this tree shipping. Erasing an
   *  id this build predates would report a real model as no model. */
  it("renders an UNKNOWN id as itself rather than dropping it", () => {
    expect(agentModelLabel("claude-something-9")).toBe("claude-something-9");
    expect(agentModelShortLabel("claude-something-9")).toBe("claude-something-9");
    expect(normalizeAgentModel("claude-something-9")).toBe("claude-something-9");
  });

  /**
   * ⚠ THE EFFECTIVE MODEL IS FREE-FORM AND THE PICKABLE ROSTER IS NOT
   * (`spa-bridge.ts › DesktopSessionSummary.model` — a dated id, a `[1m]`
   * variant). A `SelectMenu` whose value matches no option renders BLANK, so an
   * agent on a dated id would show an empty control where its model should be.
   */
  it("appends an OFF-ROSTER effective model so the control can show it", () => {
    const opts = agentModelOptionsFor("claude-opus-4-5-20251101");
    expect(opts).toHaveLength(AGENT_MODEL_OPTIONS.length + 1);
    expect(opts[opts.length - 1]).toEqual({
      value: "claude-opus-4-5-20251101",
      label: "claude-opus-4-5-20251101",
    });
  });

  /** ⚠ It appends the CURRENT VALUE and nothing else — the four the desktop
   *  accepts stay the four an operator can PICK. */
  it("adds nothing for a known id, for Default, or for an absent model", () => {
    expect(agentModelOptionsFor("claude-opus-5")).toBe(AGENT_MODEL_OPTIONS);
    expect(agentModelOptionsFor(AGENT_MODEL_DEFAULT)).toBe(AGENT_MODEL_OPTIONS);
    expect(agentModelOptionsFor(null)).toBe(AGENT_MODEL_OPTIONS);
  });
});

/**
 * THE CAPABILITY PROBE. The model rides the EXISTING posture ops, so there is no
 * bridge member to feature-detect — the signal is whether the get reply carried
 * the KEY.
 */
describe("hasModelKey — absent is a different fact from null", () => {
  it("says YES for an explicit null and NO for a missing key", () => {
    expect(hasModelKey({ tools: "manual", messages: "ask", model: null })).toBe(true);
    expect(hasModelKey({ tools: "manual", messages: "ask", model: "claude-opus-5" })).toBe(
      true
    );
    expect(hasModelKey({ tools: "manual", messages: "ask" })).toBe(false);
    expect(hasModelKey(null)).toBe(false);
    expect(hasModelKey("nope")).toBe(false);
  });

  /**
   * ⚠ THE MODEL IS NOT PART OF THE WHOLE-PAIR REJECTION. Both AXES must be known
   * or the posture is refused entirely — but a reply with two good axes and no
   * model is valid from every desktop older than the field, and rejecting it
   * would blank the permission controls on all of them.
   */
  it("keeps a two-axis reply valid with no model, and carries one when present", () => {
    expect(normalizePermissionPreset({ tools: "auto", messages: "ask" })).toEqual({
      tools: "auto",
      messages: "ask",
    });
    expect(
      normalizePermissionPreset({ tools: "auto", messages: "ask", model: "claude-opus-5" })
    ).toEqual({ tools: "auto", messages: "ask", model: "claude-opus-5" });
    // An explicit null survives as null — it is the "default applies" answer.
    expect(
      normalizePermissionPreset({ tools: "auto", messages: "ask", model: null })
    ).toEqual({ tools: "auto", messages: "ask", model: null });
    // A half-valid PAIR is still refused whole, model or no model.
    expect(
      normalizePermissionPreset({ tools: "nonsense", messages: "ask", model: "x" })
    ).toBeNull();
  });

  /** ⚠ The default preset omits the key so it cannot be mistaken for a probe
   *  that ran — it also stands in for "could not read the posture at all". */
  it("leaves the key off the default preset", () => {
    expect(hasModelKey(DEFAULT_PERMISSION_PRESET)).toBe(false);
  });
});

describe("the DURABLE model row on the Settings tab", () => {
  const view = (over: Parameters<typeof ChannelAgentSettingsView>[0] extends never
    ? never
    : Partial<Parameters<typeof ChannelAgentSettingsView>[0]> = {}) =>
    render(
      <ChannelAgentSettingsView
        profile="full"
        onSetToolProfile={noop}
        toolProfileBusy={false}
        posture={DEFAULT_PERMISSION_PRESET}
        postureBusy={false}
        onChangePosture={noop}
        folder={null}
        {...over}
      />
    );

  const modelSelect = () => screen.queryByLabelText("Model for agents you launch");

  /**
   * ⚠ ABSENT, NOT DISABLED. An older main DROPS the field on write, so a live row
   * would let the operator pick Opus, report success, and launch every agent on
   * the default with nothing anywhere saying so.
   */
  it("renders NO row on a desktop that does not know the field", () => {
    view({ modelSupported: false });
    expect(modelSelect()).toBeNull();
  });

  it("renders the row when the desktop reported the field", () => {
    view({ modelSupported: true });
    expect(modelSelect()).not.toBeNull();
  });

  /** ⚠ It is gated on the POSTURE too: no bridge, no posture group at all. */
  it("renders no row outside the desktop shell, however supported it claims to be", () => {
    view({ posture: null, modelSupported: true });
    expect(modelSelect()).toBeNull();
  });

  it("shows Default for an unset model and the full label for a set one", () => {
    view({ modelSupported: true });
    expect(screen.getByLabelText("Model for agents you launch").textContent).toContain(
      "Default"
    );
    cleanup();
    view({
      modelSupported: true,
      posture: { ...DEFAULT_PERMISSION_PRESET, model: "claude-opus-5" },
    });
    expect(screen.getByLabelText("Model for agents you launch").textContent).toContain(
      "Opus 5"
    );
  });

  /** ⚠ Default writes `null`, never `""` — the record carries no id. */
  it("writes an id for a model and null for Default", () => {
    const onChangePosture = vi.fn();
    view({
      modelSupported: true,
      onChangePosture,
      posture: { ...DEFAULT_PERMISSION_PRESET, model: "claude-opus-5" },
    });
    fireEvent.click(screen.getByLabelText("Model for agents you launch"));
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Fable 5/ }));
    });
    expect(onChangePosture).toHaveBeenCalledWith({ model: "claude-fable-5" });
    onChangePosture.mockClear();
    fireEvent.click(screen.getByLabelText("Model for agents you launch"));
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Default/ }));
    });
    expect(onChangePosture).toHaveBeenCalledWith({ model: null });
  });

  /** The posture write is one flight for all three controls. */
  it("goes inert with the other posture selects while a write is in flight", () => {
    view({ modelSupported: true, postureBusy: true });
    expect(
      (screen.getByLabelText("Model for agents you launch") as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("the LIVE model selector on a running agent", () => {
  const live = () => screen.queryByLabelText("Model for this agent");

  /**
   * ⚠ TWO CAPABILITIES, TWO DETECTIONS. The model op lands on the desktop in a
   * different wave than the two axes, so "has `setMode`, no `setModel`" is a real
   * build shape — gating both on one flag would either hide working controls or
   * render one that can only refuse.
   */
  it("renders no selector on a build with the axes and no model op", () => {
    stubBridge();
    render(<PostureControls agent={summary()} channelId={CHANNEL_ID} taskId="t-1" />);
    expect(screen.getByLabelText("Tool permissions for this agent")).not.toBeNull();
    expect(live()).toBeNull();
  });

  it("renders it when the op exists", () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    render(<PostureControls agent={summary()} channelId={CHANNEL_ID} taskId="t-1" />);
    expect(live()).not.toBeNull();
  });

  /**
   * ⚠ `agentId` NAMES THE INSTANCE. Without it main moves the OLDEST live agent
   * on the thread, which under multiplayer is a different agent than the card
   * these controls belong to — and the feed would then show this card unchanged,
   * reading as a refusal that never happened (F-239's rule).
   */
  it("addresses the instance, and spells Default as the empty id", () => {
    const setModel = vi.fn(async () => ({ ok: true }));
    stubBridge({ setModel });
    render(
      <PostureControls
        agent={summary({ agentId: "k3v7d2mq" })}
        channelId={CHANNEL_ID}
        taskId="t-1"
      />
    );
    fireEvent.click(screen.getByLabelText("Model for this agent"));
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: /^Opus 5/ }));
    });
    expect(setModel).toHaveBeenCalledWith(CHANNEL_ID, "t-1", "claude-opus-5", "k3v7d2mq");
  });

  /** ⚠ An ENDED agent has no posture to change — no strip at all, not a strip
   *  that always refuses. */
  it("renders nothing at all for an ended agent", () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    render(
      <PostureControls agent={summary({ state: "ended" })} channelId={CHANNEL_ID} taskId="t-1" />
    );
    expect(live()).toBeNull();
  });

  /**
   * ⚠ A FREE-FORM EFFECTIVE MODEL STILL RENDERS. Main stamps whatever the CLI
   * reported, which need not be one of the four `setModel` accepts.
   */
  it("shows an off-roster effective model rather than a blank control", () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    render(
      <PostureControls
        agent={{ ...summary(), model: "claude-opus-4-5-20251101" }}
        channelId={CHANNEL_ID}
        taskId="t-1"
      />
    );
    expect(screen.getByLabelText("Model for this agent").textContent).toContain(
      "claude-opus-4-5-20251101"
    );
  });

  /** ⚠ MAIN'S VALUE, ALWAYS — the same rule both axes follow. */
  it("shows the model main reports, and Default when it reports none", () => {
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    render(
      <PostureControls
        agent={{ ...summary(), model: "claude-haiku-4-5-20251001" }}
        channelId={CHANNEL_ID}
        taskId="t-1"
      />
    );
    expect(screen.getByLabelText("Model for this agent").textContent).toContain("Haiku 4.5");
    cleanup();
    stubBridge({ setModel: vi.fn(async () => ({ ok: true })) });
    render(<PostureControls agent={summary()} channelId={CHANNEL_ID} taskId="t-1" />);
    expect(screen.getByLabelText("Model for this agent").textContent).toContain("Default");
  });
});

/**
 * THE EFFECTIVE MODEL A CARD SHOWS — the SESSION's, never the channel's stored
 * pick. A live agent may have been switched mid-run, or spawned before the
 * posture changed, which is the F-142 defect restated for a different field.
 */
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
