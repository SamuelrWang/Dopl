// @vitest-environment jsdom
/**
 * THE COLOUR ROW IN THE NEW-AGENT POPUP (Samuel, 2026-09-13; docs/specs/agent-colors.md
 * item 7) — the sixteen circles, the keys this room's live agents have out of reach, and
 * the first-free default.
 *
 * The properties here, every one of which fails SILENTLY — a wrong circle still looks
 * like a circle:
 *
 *  - 🔒 **A TAKEN COLOUR CANNOT BE PICKED, ON EITHER PATH** (*"If that color already
 *    exists on the agent, that color should be unselectable … if my agent is a specific
 *    shade of red, then the other user should not be able to launch an agent with that
 *    specific color of red either"*). **MUTATION-VERIFY:** deleting the `if (held)
 *    return;` guard in `agent-color-circles.tsx › AgentColorCircles`'s `onClick` fails
 *    `§2 › a taken circle does not select`, and deleting the `free`-only travel in
 *    `› step` fails `§2 › the arrow keys skip it`. Neither mutation changes one pixel:
 *    the dimmed face and the `aria-disabled` attribute survive both, which is exactly
 *    why the fence cannot be pinned by asserting the attribute alone. The server's
 *    partial unique index is the other half of this rule (spec item 1) and is pinned with
 *    the migration.
 *  - **AN ENDED AGENT'S KEY IS BACK IN THE BANK** (*"once the agent has ended, that color
 *    needs to be returned to the color bank to be used again"*) — `agentColorsTaken` is
 *    the one place that is decided, and a row it wrongly counted would quietly shrink
 *    every later operator's choice.
 *  - **THE DEFAULT IS THE FIRST FREE KEY, AND IT IS DISPLAY ONLY.** The row shows it;
 *    `panel.color` stays `null` until a circle is clicked, so the server keeps the
 *    assignment (`launch-agent-dialog.tsx › effectiveColor`, and the same ruling as the
 *    Model row's back-fill).
 *  - **NO COLOUR VALUE REACHES THE MARKUP.** Every fill is a `var(--agent-color-NN)`
 *    reference off `lib/agent-colors.ts › agentColorVar`; a hex here would be the
 *    docs/DESIGN-SYSTEM.md violation the whole key indirection exists to avoid, and it
 *    would render identically today and diverge from the palette tomorrow.
 *
 * ⚠ THE PAYLOAD'S OWN PINS ARE NOT HERE AND CANNOT BE YET: the colour has no argument to
 * ride to the wire until `use-agents-panel.ts › AgentLaunchControls.launchAgent` takes a
 * sixth parameter (`use-agent-launch.ts › launchWithIdentity` carries the note). What is
 * pinned below is that the PANEL holds the operator's pick, which is the half this slice
 * owns.
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

/** ⚠ NO RUNTIME REPORTED, ON PURPOSE. It is the plain-browser lane, where the Runtime row
 *  is not rendered at all — and the Colour row must still be there, because the bank is
 *  the ROOM's and not this desktop's. */
vi.mock("../../hooks/use-channel-launch-posture", () => ({
  useChannelLaunchPosture: () => ({
    posture: { model: null },
    modelSupported: false,
    runtimeSupported: false,
    runtimes: [],
    runtime: "",
    connected: [],
    connectedKnown: false,
    defaultRuntime: null,
  }),
}));

import { AGENT_COLOR_KEYS, agentColorVar } from "../../lib/agent-colors";
import { AgentColorCircles, agentColorsTaken } from "./agent-color-circles";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, ME, PEER } from "./test-fixtures";

const MINTED = "k3v7d2mq";
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/** ⚠ READ OFF THE BANK, NEVER TYPED. `AGENT_COLOR_KEYS`'s ORDER is the assignment policy
 *  (that file's own docblock), so a literal `"agent-02"` here would be this suite deciding
 *  what "the first free key" means instead of asserting it. */
const FIRST = AGENT_COLOR_KEYS[0];
const SECOND = AGENT_COLOR_KEYS[1];
const THIRD = AGENT_COLOR_KEYS[2];

const circles = () => screen.getAllByRole("radio");
const circle = (key: string) => screen.getByRole("radio", { name: key });
const checkedKey = () =>
  circles()
    .find((el) => el.getAttribute("aria-checked") === "true")
    ?.getAttribute("data-agent-color") ?? null;

function control(over: Partial<React.ComponentProps<typeof AgentColorCircles>> = {}) {
  const onChange = vi.fn();
  render(
    <AgentColorCircles value={over.value ?? FIRST} onChange={over.onChange ?? onChange} {...over} />
  );
  return onChange;
}

afterEach(cleanup);

// ── 1. THE ROW ───────────────────────────────────────────────────────────────

describe("the colour row", () => {
  it("is one radiogroup of sixteen circles under the label Colour", () => {
    control();
    expect(screen.getByText("Colour")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Agent colour" })).toBeTruthy();
    expect(circles()).toHaveLength(AGENT_COLOR_KEYS.length);
    expect(circles().map((el) => el.getAttribute("data-agent-color"))).toEqual([
      ...AGENT_COLOR_KEYS,
    ]);
  });

  it("fills every circle from the TOKEN and never from a colour value", () => {
    control();
    for (const key of AGENT_COLOR_KEYS) {
      const style = circle(key).getAttribute("style") ?? "";
      expect(style).toContain(`background-color: ${agentColorVar(key)}`);
      // ⚠ THE NEGATIVE HALF IS THE POINT: a hex or an `oklch()` would paint correctly
      // today and stop following the palette the day it is retuned.
      expect(style).not.toMatch(/#[0-9a-f]{3}|oklch\(|rgb\(/i);
    }
  });

  it("marks exactly one circle checked, and rings that one", () => {
    control({ value: THIRD });
    expect(checkedKey()).toBe(THIRD);
    expect(circle(THIRD).className).toContain("ring-2");
    expect(circle(FIRST).className).not.toContain("ring-2");
  });

  it("selects a free circle on click — the control is not inert", () => {
    const onChange = control({ value: FIRST });
    fireEvent.click(circle(SECOND));
    expect(onChange).toHaveBeenCalledWith(SECOND);
  });
});

// ── 2. THE FENCE — a key a live agent in this channel holds ───────────────────

describe("a colour another agent holds", () => {
  const taken = new Set([SECOND]);
  const takenBy = new Map([[SECOND, "Scout"]]);

  it("says WHO has it, and says so as aria-disabled rather than disabled", () => {
    control({ value: FIRST, taken, takenBy });
    expect(circle(SECOND).getAttribute("title")).toBe("In use by Scout");
    expect(circle(SECOND).getAttribute("aria-disabled")).toBe("true");
    // ⚠ NOT `disabled`: a disabled button renders no tooltip in Chrome, so the one
    // sentence explaining the dimmed circle would never be seen.
    expect((circle(SECOND) as HTMLButtonElement).disabled).toBe(false);
    expect(circle(SECOND).className).toContain("opacity-35");
  });

  /**
   * 🔒 MUTATION-VERIFY. Drop `if (held) return;` from the `onClick` and this is the only
   * case in the repo that fails — the circle keeps its dim face and its `aria-disabled`,
   * so nothing else notices that two agents in one room now share a colour until the
   * server answers 409 (or, on a build whose index is missing, never).
   */
  it("does not select", () => {
    const onChange = control({ value: FIRST, taken, takenBy });
    fireEvent.click(circle(SECOND));
    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * 🔒 MUTATION-VERIFY, the keyboard half. `aria-disabled` is a label and not a
   * behaviour: a native radio group's arrow keys would land on this circle and check it,
   * which is why the circles are buttons and why `step` walks `freeAgentColors` only.
   */
  it("the arrow keys skip it", () => {
    const onChange = control({ value: FIRST, taken, takenBy });
    fireEvent.keyDown(circle(FIRST), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(THIRD);
  });

  it("wraps backwards onto the last free key rather than sticking", () => {
    const onChange = control({ value: FIRST, taken, takenBy });
    fireEvent.keyDown(circle(FIRST), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(AGENT_COLOR_KEYS[AGENT_COLOR_KEYS.length - 1]);
  });
});

// ── 3. THE BANK — which keys the channel's live sessions hold ─────────────────

describe("agentColorsTaken", () => {
  it("counts a live agent's key and returns an ENDED agent's to the bank", () => {
    const { taken, takenBy } = agentColorsTaken([
      { state: "idle", color: FIRST, displayName: "Scout" },
      { state: "ended", color: SECOND, displayName: "Gone" },
    ]);
    expect([...taken]).toEqual([FIRST]);
    expect(takenBy.get(FIRST)).toBe("Scout");
  });

  it("takes nothing out for a live row carrying no colour", () => {
    const { taken } = agentColorsTaken([{ state: "working", color: null, name: "flint" }]);
    expect(taken.size).toBe(0);
  });

  it("falls back to the handle, then to a generic, rather than an empty sentence", () => {
    const { takenBy } = agentColorsTaken([
      { state: "idle", color: FIRST, name: "flint" },
      { state: "idle", color: SECOND, displayName: "  " },
    ]);
    expect(takenBy.get(FIRST)).toBe("flint");
    expect(takenBy.get(SECOND)).toBe("another agent");
  });
});

// ── 4. THE ROW INSIDE THE POPUP ──────────────────────────────────────────────

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
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: { mintAgentId, rename: vi.fn(), describe: vi.fn() },
  };
});
afterEach(() => {
  delete (window as { dopl?: unknown }).dopl;
});

/** The dialog with the REAL `useAgentLaunch` behind it — the first-free default and the
 *  panel's carriage are that hook's state, and a stub panel would let this file assert its
 *  own fixture (`launch-agent-dialog.test.tsx › Harness` states the same rule). */
function Harness({
  liveSessions,
}: {
  liveSessions?: React.ComponentProps<typeof LaunchAgentDialog>["liveSessions"];
}) {
  const panel = useAgentLaunch();
  useEffect(() => {
    panel.toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={launcher()}
      openThreadId={null}
      channelId="ch-1"
      workspaceId="ws-1"
      currentUserId={ME}
      members={MEMBERS}
      liveSessions={liveSessions}
    />
  );
}

async function openPopup(liveSessions?: React.ComponentProps<typeof Harness>["liveSessions"]) {
  render(<Harness liveSessions={liveSessions} />);
  await waitFor(() =>
    expect((screen.getByLabelText("Agent name") as HTMLInputElement).value).toBe(`#${MINTED}`)
  );
}

describe("the popup's colour row", () => {
  it("renders with NO runtime reported, and preselects the FIRST FREE key", async () => {
    await openPopup([
      { state: "idle", color: FIRST, displayName: "Scout" },
      // ⚠ ENDED, so `SECOND` is free again and IS the first free key — one case pinning
      // both the liveness rule and the default.
      { state: "ended", color: SECOND, displayName: "Gone" },
    ]);
    expect(screen.queryByRole("tablist", { name: "Agent runtime" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Agent colour" })).toBeTruthy();
    expect(checkedKey()).toBe(SECOND);
    expect(circle(FIRST).getAttribute("title")).toBe("In use by Scout");
  });

  it("takes the first key when the room holds none", async () => {
    await openPopup();
    expect(checkedKey()).toBe(FIRST);
  });

  it("moves the selection when a circle is clicked — the panel holds the pick", async () => {
    await openPopup();
    fireEvent.click(circle(THIRD));
    await waitFor(() => expect(checkedKey()).toBe(THIRD));
  });

  /** Samuel, 2026-09-13: *"change 'Blank Agent' to 'None' for the template"*. ⚠ THE KEY IS
   *  UNCHANGED — the pill still maps to `templateId: null`, which is what
   *  `launch-agent-dialog.test.tsx § the payload` asserts about the wire. */
  it("names the no-template option None", async () => {
    await openPopup();
    const pills = Array.from(
      screen.getByRole("tablist", { name: "Agent template" }).querySelectorAll('[role="tab"]')
    );
    expect(pills.map((el) => el.textContent)).toEqual(["None"]);
  });
});
