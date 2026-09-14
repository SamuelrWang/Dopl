// @vitest-environment jsdom
/**
 * THE NEW-AGENT POPUP (2026-09-08, Samuel's popup-panel ruling) — the five fields, the three
 * selectors' defaults, the underline's focus state, the two exits, and the ONE property that
 * makes the whole experiment safe to run in front of him: **the wire did not move.**
 *
 * The properties here, all of which fail silently:
 *
 *  - **THE PAYLOAD IS THE SLIDE-OUT'S, ARGUMENT FOR ARGUMENT.** Three selectors replaced three
 *    dropdowns, and each one is a chance to send `""` where the old row sent `undefined`, or the
 *    RESOLVED model where the old row sent none. `§ the payload` asserts the whole call against
 *    `use-agent-launch.ts › launchWithIdentity` driven by hand — the lane the old panel used and
 *    the lane this dialog still uses.
 *  - **THE MODEL ROW SHOWS A PICK IT DOES NOT SEND.** `agentModelSelection` back-fills Sonnet for
 *    DISPLAY; `panel.model` stays `''` until the operator touches the control. A row that wrote
 *    its own resolved value into the panel would turn a channel's setting into a per-spawn pick
 *    that then stops following the setting — and nothing on screen would look different.
 *  - **THE UNDERLINE'S ACTIVE LINE IS STATE, NOT A STYLESHEET.** jsdom loads no CSS, so the
 *    sweep can only be pinned as the class the component toggles (the module states why it is
 *    a class at all).
 *  - **ESCAPE AND DISCARD LAUNCH NOTHING.** A dismissed dialog that had already spawned is the
 *    one failure here that costs the operator a running agent.
 *
 * ⚠ THE TEMPLATE MARKER'S OWN PINS ARE `composer-launch-marker.test.tsx` (§5A), which drives the
 * same row through the composer. Asserting it here too would make that file the wrong place to
 * add the next case.
 */

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const templateList = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: templateList.templates,
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

/**
 * THE DESKTOP'S OWN ANSWER — enough of it for the popup to MOUNT, and no more.
 *
 * ⚠ THE RUNTIME ROW'S OWN CONTRACT MOVED TO `launch-agent-dialog-runtime.test.tsx` (2026-09-08,
 * Samuel's connectivity correction; the split is the same seam as `launch-agent-dialog-runtime.ts`
 * and it is what put this file back under the §1 cap). What this fixture still buys HERE is the
 * two field-list cases in §1 — the row renders when the desktop reported a runtime family and does
 * not when it did not — plus the payload's runtime argument in §3. Every case that MEANS something
 * by `only`, `connected` or `connectedKnown` belongs in that file.
 */
const posture = vi.hoisted(() => ({
  runtimeSupported: false,
  only: null as string | null,
  stored: "",
  /** ⚠ THE ROW'S OWN CONTRACT LIVES IN `launch-agent-dialog-runtime.test.tsx` (split out at the
   *  §1 cap). These two are here only so the dialog mounts; every case that MEANS something by
   *  them is in that file. */
  connected: [] as string[],
  connectedKnown: false,
}));
vi.mock("../../hooks/use-channel-launch-posture", () => ({
  useChannelLaunchPosture: () => ({
    posture: { model: null },
    modelSupported: false,
    runtimeSupported: posture.runtimeSupported,
    runtimes: !posture.runtimeSupported
      ? []
      : posture.only
        ? REAL_DESCRIPTORS.filter((d) => d.id === posture.only)
        : REAL_DESCRIPTORS,
    runtime: posture.stored,
    connected: posture.connected,
    connectedKnown: posture.connectedKnown,
    defaultRuntime: REAL_DEFAULT_RUNTIME,
  }),
}));

import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
} from "../../lib/runtime-descriptors-harness";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch, type AgentLaunchPanel } from "./use-agent-launch";
// ⚠ THE ACT MOVED TO ITS OWN FILE ON 2026-09-13 (`use-agent-launch-run.ts`), on the seam
// `use-agent-launch.ts`'s header had already named: the Instructions field's prefill and its
// baseline pushed that file past the §1 cap. The lane is unchanged, which is what §3 below asserts.
import { launchWithIdentity } from "./use-agent-launch-run";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, ME, PEER } from "./test-fixtures";

const MINTED = "k3v7d2mq";
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

const rename = vi.fn();
const describe_ = vi.fn();
const mintAgentId = vi.fn();

/** ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — without it the whole
 *  bridge reads as absent and every probe answers false. */
function stubBridge() {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: { mintAgentId, rename, describe: describe_ },
  };
}

function launcher(over: Partial<AgentLaunchControls> = {}): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
    approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

beforeEach(() => {
  rename.mockReset().mockResolvedValue({ ok: true });
  describe_.mockReset().mockResolvedValue({ ok: true });
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  posture.runtimeSupported = false;
  posture.only = null;
  posture.stored = "";
  posture.connected = [];
  posture.connectedKnown = false;
  stubBridge();
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
  templateList.templates = [];
});

/**
 * The dialog with a REAL `useAgentLaunch` behind it, opened on mount.
 *
 * ⚠ THE REAL HOOK, NOT A PANEL LITERAL. The defaults under test — a `null` template, an EMPTY
 * `model`, an EMPTY `runtime` and the `#<id>` name prefill — are that hook's, and a stub panel
 * would let this file assert its own fixture rather than the state the dialog actually gets.
 */
function Harness({
  newAgent,
  openThreadId = null,
}: {
  newAgent: AgentLaunchControls;
  openThreadId?: string | null;
}) {
  const panel = useAgentLaunch();
  // ⚠ `toggle` IS THE OPENER, because it is what MINTS. Setting `open` some other way would
  // exercise a state this surface never reaches.
  useEffect(() => {
    panel.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={newAgent}
      openThreadId={openThreadId}
      channelId="ch-1"
      workspaceId="ws-1"
      currentUserId={ME}
      members={MEMBERS}
    />
  );
}

const nameField = () => screen.getByLabelText("Agent name") as HTMLInputElement;
const descField = () => screen.getByLabelText("Agent description") as HTMLInputElement;
const launchButton = () => screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement;
const pill = (name: string | RegExp) => screen.getByRole("tab", { name });
const selected = (row: string) =>
  screen
    .getByRole("tablist", { name: row })
    .querySelector('[aria-selected="true"]')?.textContent;

/** Mount and wait out BOTH async steps — the mint's round trip and `ModalShell`'s rAF. */
async function open(over: Partial<React.ComponentProps<typeof Harness>> = {}) {
  const controls = over.newAgent ?? launcher();
  render(<Harness {...over} newAgent={controls} />);
  await waitFor(() => expect(nameField().value).toBe(`#${MINTED}`));
  return controls;
}

// ── 1. THE FIVE FIELDS ───────────────────────────────────────────────────────

describe("the popup's five fields", () => {
  it("renders Name, Description, Template, Model and Runtime", async () => {
    posture.runtimeSupported = true;
    await open();
    expect(nameField()).toBeTruthy();
    expect(descField()).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Agent template" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Agent model" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Agent runtime" })).toBeTruthy();
  });

  it("renders NO Runtime row where there is no runtime family", async () => {
    // ⚠ NO DEAD ROWS. A plain browser and every desktop older than the adapter port answer no
    // descriptors, and an empty selector there would be a control that can only refuse.
    await open();
    expect(screen.queryByRole("tablist", { name: "Agent runtime" })).toBeNull();
  });

  it("gives EVERY field label the same (semi-bold) class — weight lives in the module, not per caller", async () => {
    // ⚠ SUPERSEDED 2026-09-08 (Samuel: "All of the headers (name, description, template, etc),
    // should be bolded"). The weight is `launch-agent-dialog.module.css › .label` now, so the
    // pin is that no label carries a per-caller weight utility and all share one class (Runtime is
    // absent in this fixture — the row hides when no runtime family exists).
    await open();
    const labels = ["Name", "Description", "Template", "Model"].map((t) =>
      screen.getByText(t)
    );
    for (const el of labels) expect(el.className).not.toMatch(/font-(semibold|medium|normal)/);
    expect(new Set(labels.map((el) => el.className)).size).toBe(1);
  });

  it("grows the black line on FOCUS and takes it back on BLUR", async () => {
    // ⚠ THE CLASS IS THE ANIMATION'S SWITCH — `launch-agent-dialog.module.css › .lineActive`
    // carries the `scaleX(1)`. jsdom loads no stylesheet, so this is the only layer of the
    // sweep that can be asserted on a rendered tree.
    await open();
    const line = nameField().parentElement as HTMLElement;
    expect(line.className).not.toMatch(/lineActive/);
    fireEvent.focus(nameField());
    expect(line.className).toMatch(/lineActive/);
    fireEvent.blur(nameField());
    expect(line.className).not.toMatch(/lineActive/);
  });
});

// ── 2. THE SELECTORS' DEFAULTS ───────────────────────────────────────────────

describe("what the three selectors hold before anybody touches them", () => {
  it("Template defaults to Blank agent, and that is an OPTION not a placeholder", async () => {
    templateList.templates = [
      { id: "tpl-9", name: "Code auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    await open();
    // ⚠ **"Blank agent" → "None" ON 2026-09-13** (Samuel, docs/specs/agent-colors.md item 7:
    // *"change 'Blank Agent' to 'None' for the template"*). The WIRE is unchanged — the
    // option still sends `templateId: null` — so this is a LABEL pin moving and nothing else.
    expect(selected("Agent template")).toBe("None");
    expect(pill("Code auditor")).toBeTruthy();
  });

  it("Model defaults to the BACK-FILL, and sends nothing", async () => {
    // ⚠ `agentModelSelection` answers Sonnet for an unset model (2026-09-06, Samuel's ruling
    // removing "Default"). The ROW shows it; the WIRE carries no model at all — asserted in §3.
    await open();
    expect(selected("Agent model")).toBe("Sonnet 5");
  });

});

// ── 2A. THE RUNTIME ROW — MOVED ─────────────────────────────────────────────
//
// ⚠ ITS WHOLE CONTRACT IS `launch-agent-dialog-runtime.test.tsx` NOW (2026-09-08, Samuel's
// connectivity correction): the roster that is never shortened, the "not connected" hints, and the
// four-link preselect chain. It left this file at the §1 cap, on the same seam as
// `launch-agent-dialog-runtime.ts`. ⚠ ADD THE NEXT RUNTIME CASE THERE, not here — the two runtime
// assertions that remain in this file are about the popup's FIELD LIST (§1), not about the row.

// ── 3. THE PAYLOAD ───────────────────────────────────────────────────────────

/** The slide-out's own lane, driven by hand with the same inputs. ⚠ NOT A RE-IMPLEMENTATION:
 *  `launchWithIdentity` IS what `composer-launch-panel.tsx` submitted through, unchanged. */
function oldPanelState(over: Partial<AgentLaunchPanel>): AgentLaunchPanel {
  return {
    open: true,
    agentId: MINTED,
    name: "",
    description: "",
    templateId: null,
    model: "",
    runtime: "",
    ready: true,
    identityError: null,
    setIdentityError: () => {},
    setName: () => {},
    setDescription: () => {},
    setTemplateId: () => {},
    setModel: () => {},
    setRuntime: () => {},
    toggle: () => {},
    close: () => {},
    reset: () => {},
    ...over,
  };
}

describe("the payload is the slide-out's, argument for argument", () => {
  it("matches on an UNTOUCHED dialog — no template, no override, no runtime", async () => {
    const controls = await open({ openThreadId: "t-1" });
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());

    const old = launcher();
    await launchWithIdentity(old, oldPanelState({ name: `#${MINTED}` }), "t-1");

    expect(vi.mocked(controls.launchAgent).mock.calls[0]).toEqual(
      vi.mocked(old.launchAgent).mock.calls[0]
    );
    // ⚠ SPELLED OUT AS WELL AS COMPARED, so a parity assertion cannot pass because BOTH lanes
    // regressed together — the one way an equality test lies.
    const [threadId, templateId, overrides, agentId, runtime] = vi.mocked(
      controls.launchAgent
    ).mock.calls[0];
    expect(threadId).toBe("t-1");
    expect(templateId).toBeNull();
    expect(overrides).toBeUndefined();
    expect(agentId).toBe(MINTED);
    expect(runtime).toBeUndefined();
  });

  it("matches on a FULLY PICKED dialog — template, model and runtime", async () => {
    posture.runtimeSupported = true;
    templateList.templates = [
      { id: "tpl-9", name: "Code auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    // ⚠ A REAL ADAPTER THAT IS NOT THE DEFAULT, so `runtime` has to survive as a value rather
    // than passing because both sides dropped it.
    const other = REAL_DESCRIPTORS.find((d) => d.id !== REAL_DEFAULT_RUNTIME);
    expect(other).toBeTruthy();

    const controls = await open({ openThreadId: "t-1" });
    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.change(descField(), { target: { value: "Audits the diff." } });
    fireEvent.click(pill("Code auditor"));
    fireEvent.click(pill("Opus 5"));
    fireEvent.click(pill(other!.label));
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());

    const old = launcher();
    await launchWithIdentity(
      old,
      oldPanelState({
        name: "Research",
        description: "Audits the diff.",
        templateId: "tpl-9",
        model: "claude-opus-5",
        runtime: other!.id,
      }),
      "t-1"
    );

    expect(vi.mocked(controls.launchAgent).mock.calls[0]).toEqual(
      vi.mocked(old.launchAgent).mock.calls[0]
    );
    const [, templateId, overrides, , runtime] = vi.mocked(controls.launchAgent).mock.calls[0];
    expect(templateId).toBe("tpl-9");
    expect(overrides).toEqual({ model: "claude-opus-5" });
    expect(runtime).toBe(other!.id);
  });

  it("sends BLANK back as `null`, never the empty string", async () => {
    // ⚠ THE SELECTOR'S OWN SENTINEL IS `""` — `SegmentedControl` is `<K extends string>`, so the
    // blank option cannot BE null on the control. It has to be mapped back at the boundary, and
    // nothing else in this file exercises that map: the untouched case never fires `onChange`,
    // and the fully-picked case answers a real id. **MUTATION-PROOF: drop the ternary in
    // `onChange` and only this case fails.**
    templateList.templates = [
      { id: "tpl-9", name: "Code auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    const controls = await open({ openThreadId: "t-1" });
    fireEvent.click(pill("Code auditor"));
    // ⚠ **"Blank agent" → "None" ON 2026-09-13** (Samuel, docs/specs/agent-colors.md item 7:
    // *"change 'Blank Agent' to 'None' for the template"*). The WIRE is unchanged — the
    // option still sends `templateId: null` — so this is a LABEL pin moving and nothing else.
    fireEvent.click(pill("None"));
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());

    const old = launcher();
    await launchWithIdentity(old, oldPanelState({ name: `#${MINTED}` }), "t-1");
    expect(vi.mocked(controls.launchAgent).mock.calls[0]).toEqual(
      vi.mocked(old.launchAgent).mock.calls[0]
    );
    expect(vi.mocked(controls.launchAgent).mock.calls[0][1]).toBeNull();
  });

  it("writes the name and the description AFTER the spawn, keyed to main's address", async () => {
    const controls = await open();
    fireEvent.change(nameField(), { target: { value: "Research" } });
    fireEvent.change(descField(), { target: { value: "Audits the diff." } });
    fireEvent.click(launchButton());

    await waitFor(() => expect(describe_).toHaveBeenCalled());
    expect(rename).toHaveBeenCalledWith(MINTED, "Research");
    expect(describe_).toHaveBeenCalledWith(MINTED, "Audits the diff.");
    void controls;
  });
});

// ── 4. THE TWO EXITS ─────────────────────────────────────────────────────────

describe("Discard and Escape close without launching", () => {
  it("DISCARD starts nothing and clears the form", async () => {
    const controls = await open();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByLabelText("Agent name")).toBeNull());
    expect(controls.launchAgent).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("ESCAPE is Discard — the same exit, not a second one", async () => {
    const controls = await open();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Agent name")).toBeNull());
    expect(controls.launchAgent).not.toHaveBeenCalled();
  });

  it("is NOT LAUNCHABLE with no name, and says why", async () => {
    // ⚠ DISABLED WITH A REASON (INVARIANTS §8, rule 4) moved WITH the button when the submit
    // came back inside the form.
    await open();
    fireEvent.change(nameField(), { target: { value: "" } });
    expect(launchButton().disabled).toBe(true);
    expect(launchButton().title).toBe("An agent needs a name");
  });
});
