// @vitest-environment jsdom
/**
 * **THE NEW-AGENT POPUP: THE RUNTIME DRIVES THE MODEL ROW, THE COPY AND THE PAYLOAD**
 * (2026-09-21, U7).
 *
 * ⚠ **ITS OWN FILE PAST THE §1 CAP, AND THE SEAM IS WHAT THE CASES ARE ABOUT.**
 * `launch-agent-dialog.test.tsx` is the FORM (the fields, the two exits, the payload's shape);
 * `launch-agent-dialog-runtime.test.tsx` is the RUNTIME ROW (its roster, its hints, its
 * preselect). This file is what the selected runtime IMPLIES — the model roster, the remembered
 * picks, the template-compatibility sentence and the sign-in copy — which is exactly the seam
 * `launch-agent-dialog-state.ts` was split on.
 *
 * Every case is about the SAME defect from a different side: before this wave the dialog held one
 * Claude model table and read it whatever runtime was selected, so choosing Codex offered Fable
 * and submitted it. The claims are what an operator SEES and what main RECEIVES, asserted
 * together — a row that showed the right thing and sent the wrong one is the shape that ships.
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

/** The desktop's own answer — the roster, what each runtime remembers, and each one's catalog. */
const posture = vi.hoisted(() => ({
  stored: "",
  connected: [] as string[],
  modelSupported: false,
  byRuntime: {} as Record<string, { tools?: string; model?: string; native?: Record<string, string> }>,
  catalogs: {} as Record<string, unknown>,
}));

vi.mock("../hooks/use-launch-selection", async () => {
  const harness = await import("../hooks/launch-selection-harness");
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import(
    "../lib/runtime-descriptors-harness"
  );
  return {
    useLaunchSelection: () =>
      harness.launchSelectionStub({
        runtimeSupported: true,
        runtimes: REAL_DESCRIPTORS,
        runtime: posture.stored,
        connected: posture.connected,
        connectedKnown: true,
        defaultRuntime: REAL_DEFAULT_RUNTIME,
        modelSupported: posture.modelSupported,
        byRuntime: posture.byRuntime,
        catalogs: posture.catalogs as never,
      }),
  };
});

import { REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";
import { catalog } from "../hooks/launch-selection-harness";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
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

function launcher(): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
    approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
  };
}

beforeEach(() => {
  rename.mockReset().mockResolvedValue({ ok: true });
  describe_.mockReset().mockResolvedValue({ ok: true });
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  posture.stored = "";
  posture.connected = [];
  posture.modelSupported = false;
  posture.byRuntime = {};
  posture.catalogs = {};
  templateList.templates = [];
  // ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — without it the whole
  // bridge reads as absent and every probe answers false.
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: { mintAgentId, rename, describe: describe_ },
  };
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

function Harness({ newAgent }: { newAgent: AgentLaunchControls }) {
  const panel = useAgentLaunch();
  useEffect(() => {
    panel.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={newAgent}
      openThreadId="t-1"
      channelId="ch-1"
      workspaceId="ws-1"
      currentUserId={ME}
      members={MEMBERS}
    />
  );
}

const launchButton = () => screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement;
const row = () => screen.getByRole("tablist", { name: "Agent runtime" });
const pillFor = (label: string) =>
  Array.from(row().querySelectorAll('[role="tab"]')).find((el) =>
    (el.textContent || "").startsWith(label)
  )!;
const runtimeArg = (c: AgentLaunchControls) => vi.mocked(c.launchAgent).mock.calls[0][4];

async function open() {
  const controls = launcher();
  render(<Harness newAgent={controls} />);
  await waitFor(() => expect(mintAgentId).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
  return controls;
}

const CODEX = REAL_DESCRIPTORS.find((d) => d.id === "codex")!;
const CLAUDE = REAL_DESCRIPTORS.find((d) => d.id === "claude")!;
const modelRow = () => screen.getByRole("tablist", { name: "Agent model" });
const modelPills = () =>
  Array.from(modelRow().querySelectorAll('[role="tab"]')).map((el) => el.textContent ?? "");
const modelSelected = () => modelRow().querySelector('[aria-selected="true"]')?.textContent;
const modelPill = (label: string) =>
  Array.from(modelRow().querySelectorAll('[role="tab"]')).find((el) =>
    (el.textContent || "").startsWith(label)
  )!;
const overridesArg = (c: AgentLaunchControls) => vi.mocked(c.launchAgent).mock.calls[0][2];

const CLAUDE_CATALOG = catalog("claude", [
  { id: "claude-fable-5", label: "Fable 5", isDefault: true },
  { id: "claude-opus-5", label: "Opus 5" },
]);
const CODEX_CATALOG = catalog("codex", [
  { id: "gpt-6-astra", label: "GPT-6 Astra", isDefault: true },
  { id: "gpt-6-mini", label: "GPT-6 Mini" },
]);

function bothRuntimes() {
  posture.modelSupported = true;
  posture.connected = ["claude", "codex"];
  posture.catalogs = { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG };
}

describe("the MODEL row follows the RUNTIME row", () => {
  it("opens on Claude showing Fable, and switching to Codex shows Codex models", async () => {
    bothRuntimes();
    await open();
    expect(modelSelected()).toContain("Fable 5");
    expect(modelPills().join(" ")).not.toMatch(/GPT-6/);

    fireEvent.click(pillFor(CODEX.label));
    await waitFor(() => expect(modelPills().join(" ")).toContain("GPT-6 Astra"));
    // ⚠ THE WHOLE POINT: no Claude id survives onto a Codex surface.
    expect(modelPills().join(" ")).not.toMatch(/Fable|Opus|Sonnet|Haiku/);
  });

  it("puts `runtime: codex` AND a Codex model on the wire", async () => {
    bothRuntimes();
    const controls = await open();
    fireEvent.click(pillFor(CODEX.label));
    await waitFor(() => expect(modelPills().join(" ")).toContain("GPT-6 Mini"));
    fireEvent.click(modelPill("GPT-6 Mini"));
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(runtimeArg(controls)).toBe("codex");
    expect(overridesArg(controls)).toEqual({ model: "gpt-6-mini" });
  });

  it("restores BOTH remembered picks when the runtime moves and moves back", async () => {
    // Decision #2. The pre-U5 record CLEARED the model on every switch, because one global field
    // cannot hold two rosters.
    bothRuntimes();
    posture.byRuntime = {
      claude: { model: "claude-opus-5" },
      codex: { model: "gpt-6-mini" },
    };
    await open();
    expect(modelSelected()).toContain("Opus 5");
    fireEvent.click(pillFor(CODEX.label));
    await waitFor(() => expect(modelSelected()).toContain("GPT-6 Mini"));
    fireEvent.click(pillFor(CLAUDE.label));
    await waitFor(() => expect(modelSelected()).toContain("Opus 5"));
  });

  it("drops a per-launch pick that belongs to the runtime the operator left", async () => {
    // ⚠ NOT A RE-POINT — it clears to "no per-spawn pick", so the row falls to the NEW runtime's
    // remembered model and then to its platform default.
    bothRuntimes();
    const controls = await open();
    fireEvent.click(modelPill("Opus 5"));
    expect(modelSelected()).toContain("Opus 5");
    fireEvent.click(pillFor(CODEX.label));
    await waitFor(() => expect(modelSelected()).toContain("GPT-6 Astra"));
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    // ⚠ AND NOTHING FOREIGN REACHES MAIN. An untouched Codex row sends no model at all.
    expect(overridesArg(controls)).toBeUndefined();
  });

  it("offers nothing to pick when the roster could not be read, and says why", async () => {
    posture.modelSupported = true;
    posture.connected = ["claude", "codex"];
    posture.stored = "codex";
    posture.catalogs = {
      claude: CLAUDE_CATALOG,
      codex: catalog("codex", [], {
        status: "unavailable",
        reason: "Dopl could not read this runtime's model list.",
      }),
    };
    render(<Harness newAgent={launcher()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
    expect(modelPills()).toEqual(["Platform default"]);
    expect(document.body.textContent).toContain("could not read this runtime's model list");
    expect(document.body.textContent).not.toMatch(/Fable|Opus/);
  });
});

describe("a runtime this Mac is not connected to", () => {
  it("stays listed and selectable, and routes to ITS OWN sign-in", async () => {
    // Samuel's 2026-09-08 correction: an unconnected runtime is a setup step, not a missing
    // capability. What changed in U10/U7 is that the sentence names the RIGHT platform — a
    // signed-out Codex used to be told to fix a Claude credential the session does not use.
    posture.modelSupported = true;
    posture.connected = ["claude"];
    posture.catalogs = { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG };
    render(<Harness newAgent={launcher()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
    expect(pillFor(CODEX.label)).toBeTruthy();
    expect((pillFor(CODEX.label) as HTMLButtonElement).disabled).toBeFalsy();
    expect(pillFor(CODEX.label).textContent).toContain("not connected");

    fireEvent.click(pillFor(CODEX.label));
    await waitFor(() => expect(document.body.textContent).toContain("Sign in to Codex"));
    expect(document.body.textContent).not.toContain("Sign in to Claude");
  });
});

describe("a TEMPLATE whose model belongs to another runtime", () => {
  it("is not submitted, and the mismatch is explained in both platforms' own names", async () => {
    bothRuntimes();
    posture.stored = "codex";
    templateList.templates = [
      {
        id: "tpl-1",
        name: "Coder",
        workspaceId: "ws-1",
        createdBy: ME,
        model: "claude-opus-5",
      },
    ];
    const controls = await open();
    fireEvent.click(
      Array.from(
        screen.getByRole("tablist", { name: "Agent template" }).querySelectorAll('[role="tab"]')
      ).find((el) => (el.textContent || "").startsWith("Coder"))!
    );
    await waitFor(() =>
      expect(document.body.textContent ?? "").toContain("claude-opus-5")
    );
    const note = screen.getAllByRole("note").map((n) => n.textContent).join(" ");
    expect(note).toContain("Claude Code");
    expect(note).toContain("Codex");
    // ⚠ AND THE ROW SHOWS CODEX'S OWN DEFAULT rather than the template's foreign id.
    expect(modelSelected()).toContain("GPT-6 Astra");
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(overridesArg(controls)).toBeUndefined();
  });
});

