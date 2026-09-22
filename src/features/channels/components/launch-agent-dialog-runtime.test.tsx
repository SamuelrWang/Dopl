// @vitest-environment jsdom
/**
 * THE NEW-AGENT POPUP'S RUNTIME ROW — the roster, the "not connected" hints, and the four-link
 * preselect chain, driven through the real dialog.
 *
 * SAMUEL, 2026-09-08, correcting a pass that had narrowed this row to the runtimes the desktop
 * could start: *"No, even if the user does not have codex or cursor connected, I still want them to
 * be options there so that the user knows that those are options, so they can connect them. It
 * should just be logged in, like it is just put in their default, right? I did not say to remove
 * them."* And, earlier: *"It should just be what the user is already connected to … In my case, I'm
 * connected to Claude Code, so it should be Claude Code."*
 *
 * THE FOUR PROPERTIES, ALL OF WHICH FAIL SILENTLY:
 *
 *  - **THE ROSTER IS NEVER SHORTENED.** A `filter` on connectivity is the exact mistake this file
 *    was written to prevent, and it looks like a working row: three registered adapters, one pill,
 *    and no operator ever learns Codex was an option.
 *  - **THE HINTS LAND ON THE UNCONNECTED ONES AND NOWHERE ELSE**, and on NONE of them when the
 *    desktop did not answer — a machine running three runtimes must not have all three labelled
 *    absent (INVARIANTS §8, §11 — UNKNOWN is not EMPTY).
 *  - **THE PRESELECT IS THE CHAIN, LINK BY LINK.** Since the pick is always on the wire, a wrong
 *    preselect is not a cosmetic default: it is what LAUNCHES.
 *  - **AN UNCONNECTED PILL IS STILL SELECTABLE AND STILL SENT.** It is a setup step, not a
 *    capability the platform lacks, and `runtime/index.js › acquire` is what refuses at spawn.
 *
 * ⚠ SPLIT OUT OF `launch-agent-dialog.test.tsx` at the §1 cap, on the same seam as
 * `launch-agent-dialog-runtime.ts`. The dialog's own file keeps the five fields, the payload
 * parity and the two exits; the runtime row's whole contract is here.
 */

import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: [],
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

/**
 * THE DESKTOP'S OWN ANSWER, THE FIVE WAYS IT COMES.
 *
 * ⚠ `only` IS WHAT MAKES THE ROSTER TESTABLE: a build registering ONE adapter is a real shipped
 * machine, and a fixture that always reports three cannot tell "the first reported" from "the
 * build's default". ⚠ `stored` is the channel's durable pick, fed UNREPORTED in one case on
 * purpose. ⚠ `connected` and `connectedKnown` are the two halves of the new field — the ids main's
 * cached probe answered, and whether main answered AT ALL.
 */
const posture = vi.hoisted(() => ({
  runtimeSupported: false,
  only: null as string | null,
  stored: "",
  connected: [] as string[],
  connectedKnown: false,
  /** ⚠ U7: what each runtime REMEMBERS, and which models each one offers. */
  modelSupported: false,
  byRuntime: {} as Record<string, { tools?: string; model?: string; native?: Record<string, string> }>,
  catalogs: {} as Record<string, unknown>,
}));
// ⚠ **THE DIALOG READS THE VERSIONED, RUNTIME-KEYED RECORD SINCE 2026-09-21 (U7)** — one hook,
// mounted inside `launch-agent-dialog-state.ts`, which is also where the roster, the preselect,
// the model row and the sign-in sentence are derived. The fixture below is the desktop's answer.
vi.mock("../hooks/use-launch-selection", async () => {
  const harness = await import("../hooks/launch-selection-harness");
  const { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } = await import(
    "../lib/runtime-descriptors-harness"
  );
  return {
    useLaunchSelection: () =>
      harness.launchSelectionStub({
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
        modelSupported: posture.modelSupported,
        byRuntime: posture.byRuntime,
        catalogs: posture.catalogs as never,
      }),
  };
});

import {
  REAL_DEFAULT_RUNTIME,
  REAL_DESCRIPTORS,
} from "../lib/runtime-descriptors-harness";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, ME, PEER } from "./test-fixtures";


const MINTED = "k3v7d2mq";
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/** ⚠ NAMED OFF THE REAL REGISTRY, never hardcoded: the ids are `main/runtime/index.js`'s, and a
 *  literal here would be a second authority that goes stale the day an adapter ships. */
const FIRST = REAL_DESCRIPTORS[0];
const SECOND = REAL_DESCRIPTORS[1];
const LAST = REAL_DESCRIPTORS[REAL_DESCRIPTORS.length - 1];

const rename = vi.fn();
const describe_ = vi.fn();
const mintAgentId = vi.fn();

function stubBridge() {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: { mintAgentId, rename, describe: describe_ },
  };
}

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
  posture.runtimeSupported = true;
  posture.only = null;
  posture.stored = "";
  posture.connected = [];
  posture.connectedKnown = true;
  posture.modelSupported = false;
  posture.byRuntime = {};
  posture.catalogs = {};
  stubBridge();
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
const pills = () => Array.from(row().querySelectorAll('[role="tab"]'));
const selected = () => row().querySelector('[aria-selected="true"]')?.textContent;
/** The pill whose LABEL is this descriptor's — matched on the label alone, so a hint appended to
 *  the button's text cannot make the lookup miss. */
const pillFor = (label: string) =>
  pills().find((el) => (el.textContent || "").startsWith(label))!;
const runtimeArg = (c: AgentLaunchControls) => vi.mocked(c.launchAgent).mock.calls[0][4];

async function open() {
  const controls = launcher();
  render(<Harness newAgent={controls} />);
  // ⚠ **THE MINT NO LONGER SHOWS UP IN THE NAME FIELD (Samuel, 2026-09-15: *"The name should be
  // blank"*), so this waited on a prefill that is gone.** The id is still minted and still
  // forwarded on the launch — it is the agent's ADDRESS — it is simply not rendered, so the
  // readiness signal is the CALL plus its settle rather than a value on screen.
  await waitFor(() => expect(mintAgentId).toHaveBeenCalled());
  // ⚠ AND THE DIALOG'S OWN MOUNT — `ModalShell` reveals on a rAF, which the old prefill
  // assertion happened to wait out as a side effect. The Launch button is the one control every
  // one of these popups has.
  await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
  return controls;
}

async function launchAndRead() {
  const controls = await open();
  fireEvent.click(launchButton());
  await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
  return controls;
}

// ── 1. THE ROSTER ────────────────────────────────────────────────────────────

describe("every reported runtime is an option, connected or not", () => {
  it("lists ALL THREE with only ONE connected — the ruling, as one assertion", async () => {
    // ⚠ **MUTATION-PROOF: filter `runtimes` by `connected` anywhere in the chain and this fails
    // first.** Samuel: "I did not say to remove them."
    posture.connected = [FIRST.id];
    await open();
    expect(pills()).toHaveLength(REAL_DESCRIPTORS.length);
    for (const d of REAL_DESCRIPTORS) expect(pillFor(d.label)).toBeTruthy();
  });

  it("lists all three with NOTHING connected — an empty answer is not an empty row", async () => {
    posture.connected = [];
    await open();
    expect(pills()).toHaveLength(REAL_DESCRIPTORS.length);
  });

  it("still offers no Channel default — the option is GONE, not relabelled", async () => {
    posture.connected = [FIRST.id];
    await open();
    expect(screen.queryByRole("tab", { name: "Channel default" })).toBeNull();
  });

  it("ONE reported runtime: the row STILL renders, holding that one selected pill", async () => {
    // ⚠ IT DOES NOT COLLAPSE TO NOTHING: hiding the row would put the answer to "what will this
    // run on" nowhere on screen.
    posture.only = LAST.id;
    posture.connected = [LAST.id];
    const controls = await launchAndRead();
    expect(pills()).toHaveLength(1);
    expect(selected()).toContain(LAST.label);
    expect(runtimeArg(controls)).toBe(LAST.id);
  });

  it("NOTHING reported: no row, and no runtime on the wire", async () => {
    // ⚠ THE ONE LANE THAT STILL OMITS THE KEY — a plain browser, and every desktop older than the
    // adapter port (INVARIANTS §11: UNKNOWN is not EMPTY).
    posture.runtimeSupported = false;
    const controls = await launchAndRead();
    expect(screen.queryByRole("tablist", { name: "Agent runtime" })).toBeNull();
    expect(runtimeArg(controls)).toBeUndefined();
  });
});

// ── 2. THE HINTS ─────────────────────────────────────────────────────────────

describe("the unconnected runtimes say so, and nothing else does", () => {
  it("hints ONLY the ones that are not connected", async () => {
    posture.connected = [FIRST.id];
    await open();
    expect(pillFor(FIRST.label).textContent).not.toMatch(/not connected/);
    for (const d of REAL_DESCRIPTORS.slice(1)) {
      expect(pillFor(d.label).textContent).toMatch(/not connected/);
    }
  });

  it("hints NOTHING when the desktop never answered — absent is not empty", async () => {
    // ⚠ **MUTATION-PROOF: drop the `connectedKnown` guard and every pill on a pre-2026-09-08
    // desktop reads "not connected" while three runtimes work perfectly well.**
    posture.connectedKnown = false;
    posture.connected = [];
    await open();
    for (const d of REAL_DESCRIPTORS) {
      expect(pillFor(d.label).textContent).not.toMatch(/not connected/);
    }
  });

  it("an unconnected pill is SELECTABLE, and what it selects is what is sent", async () => {
    // ⚠ NOT DISABLED. The operator may be about to connect it, and the spawn's own refusal is
    // what explains a real failure — a dead pill explains nothing.
    posture.connected = [FIRST.id];
    const controls = await open();
    const target = pillFor(LAST.label) as HTMLButtonElement;
    expect(target.disabled).toBe(false);
    fireEvent.click(target);
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(runtimeArg(controls)).toBe(LAST.id);
  });
});

// ── 3. THE PRESELECT CHAIN ───────────────────────────────────────────────────

/**
 * FOUR LINKS, ONE CASE EACH, plus the two the operator drives. Since the pick is always on the
 * wire, every case asserts the LAUNCH ARGUMENT as well as the pill — a preselect that renders one
 * runtime and sends another is the failure that has nothing on screen saying so.
 */
describe("which pill the row opens on", () => {
  it("link 3 — nothing stored: the first CONNECTED runtime, not the first reported", async () => {
    // ⚠ SAMUEL'S OWN CASE, INVERTED SO IT CANNOT PASS BY ACCIDENT: the connected one is NOT the
    // first in registry order, so "first reported" and "first connected" give different answers.
    posture.connected = [LAST.id];
    const controls = await launchAndRead();
    expect(selected()).toContain(LAST.label);
    expect(runtimeArg(controls)).toBe(LAST.id);
  });

  it("link 2 — the channel's pick is reported AND connected: THAT one", async () => {
    posture.stored = SECOND.id;
    posture.connected = [FIRST.id, SECOND.id];
    const controls = await launchAndRead();
    expect(selected()).toContain(SECOND.label);
    expect(runtimeArg(controls)).toBe(SECOND.id);
  });

  it("link 2 yields — the channel's pick is reported but NOT connected: the first connected wins", async () => {
    // ⚠ **MUTATION-PROOF: drop the connectivity guard on the stored pick and only this case goes
    // red.** Samuel: "It should just be what the user is already connected to."
    posture.stored = SECOND.id;
    posture.connected = [LAST.id];
    const controls = await launchAndRead();
    expect(selected()).toContain(LAST.label);
    expect(runtimeArg(controls)).toBe(LAST.id);
  });

  it("link 2 also yields when the channel's pick is not REPORTED at all", async () => {
    // A downgrade, or a pick made on another machine. Selecting it would name a runtime this build
    // cannot run — and then send it.
    posture.only = LAST.id;
    posture.stored = FIRST.id;
    posture.connected = [LAST.id];
    const controls = await launchAndRead();
    expect(selected()).toContain(LAST.label);
    expect(runtimeArg(controls)).toBe(LAST.id);
  });

  it("link 4 — NOTHING is connected: the first reported, because a launch still runs on one", async () => {
    // ⚠ **MUTATION-PROOF: return `null` when nothing is connected and the row renders with no
    // selection while three pills sit on screen.**
    posture.connected = [];
    const controls = await launchAndRead();
    expect(selected()).toContain(FIRST.label);
    expect(runtimeArg(controls)).toBe(FIRST.id);
  });

  it("`connectedKnown` FALSE — the stored pick wins, exactly as it did before this field", async () => {
    // ⚠ THE OLDER-DESKTOP LANE (INVARIANTS §8). An absence must not be read as "nothing connected"
    // and quietly overrule a pick the operator made in Settings.
    posture.connectedKnown = false;
    posture.connected = [];
    posture.stored = LAST.id;
    const controls = await launchAndRead();
    expect(selected()).toContain(LAST.label);
    expect(runtimeArg(controls)).toBe(LAST.id);
  });

  it("`connectedKnown` FALSE and nothing stored — the first reported", async () => {
    posture.connectedKnown = false;
    posture.connected = [];
    const controls = await launchAndRead();
    expect(selected()).toContain(FIRST.label);
    expect(runtimeArg(controls)).toBe(FIRST.id);
  });

  it("link 1 — the OPERATOR'S OWN pick outranks the channel's AND the probe", async () => {
    // ⚠ CONNECTIVITY DOES NOT OVERRULE A CLICK. They may be about to connect it; a selection that
    // sprang back would be a control that lies.
    posture.stored = FIRST.id;
    posture.connected = [FIRST.id];
    const controls = await open();
    fireEvent.click(pillFor(LAST.label));
    // ⚠ READ BEFORE THE LAUNCH, unlike every case above, and the difference is real: a successful
    // launch RESETS the panel (`use-agent-launch.ts › reset` clears the per-spawn runtime), so
    // afterwards the row re-derives from links 2-4 like a freshly opened dialog. This case is
    // about the operator's own pick, which only exists between the click and the submit.
    expect(selected()).toContain(LAST.label);
    fireEvent.click(launchButton());
    await waitFor(() => expect(controls.launchAgent).toHaveBeenCalled());
    expect(runtimeArg(controls)).toBe(LAST.id);
  });

  it("the default runtime is NOT a link — `defaultRuntime` never breaks a tie", async () => {
    // ⚠ `main/runtime/index.js › DEFAULT_ID` is the FIRST registered adapter by construction, so
    // it is link 4 already. Consulting it as its own link could only ever disagree with the pill
    // the operator is looking at — here it would pull the selection off the connected runtime.
    expect(REAL_DEFAULT_RUNTIME).toBe(FIRST.id);
    posture.connected = [LAST.id];
    await open();
    expect(selected()).not.toContain(FIRST.label);
  });
});
