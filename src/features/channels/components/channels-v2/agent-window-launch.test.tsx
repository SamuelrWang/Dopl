// @vitest-environment jsdom
/**
 * THE "+" TAB ACTUALLY OPENS A FORM (2026-09-13).
 *
 * ⚠ **THE BUG THIS FILE EXISTS FOR IS A CONTROL THAT DID NOTHING.** The tab strip's ruling gave the
 * `+` a job — *"a new agent on the ACTIVE tab's channel"* — and the chrome drew it, reported the
 * click, and no host mounted a dialog. Nothing threw, nothing was logged, and the button looked
 * exactly like the working one on the Agents tab. That is §11's silent-feature shape, which is why
 * the pins are (a) the dialog really mounts and opens, (b) the PAGE really wires the `+` to it.
 *
 * ⚠ **THE DIALOG'S OWN CONTRACT IS `launch-agent-dialog.test.tsx`** — the five fields, the defaults,
 * the payload argument-for-argument. Nothing here re-asserts any of it; what is this file's subject
 * is the POP-OUT's wiring of it, which is the half that had no home.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: [],
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));
vi.mock("../../hooks/use-channel-launch-posture", () => ({
  useChannelLaunchPosture: () => ({
    posture: { model: null },
    modelSupported: false,
    runtimeSupported: false,
    runtimes: [],
    runtime: "",
    connected: [],
    connectedKnown: false,
    defaultRuntime: "claude",
  }),
}));

import { AgentWindowLaunch } from "./agent-window-launch";
import { useAgentLaunch } from "./use-agent-launch";
import { summary } from "./agent-window-harness";
import { CHANNEL_ID, ME } from "./test-fixtures";
// ⚠ READ OFF THE BANK, NEVER TYPED — `AGENT_COLOR_KEYS`'s ORDER *is* the assignment policy, so a
// literal "agent-02" would be this suite deciding what "the first free key" means.
import { AGENT_COLOR_KEYS } from "../../lib/agent-colors";

const [FIRST, SECOND, THIRD] = AGENT_COLOR_KEYS;

const launch = vi.fn();
const mintAgentId = vi.fn();

/** ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`); `sessions.launch` is what
 *  `canLaunchAgents()` detects. Omit the latter and the `+` must offer no form at all. */
function stubBridge(over: { withLaunch?: boolean } = {}) {
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      mintAgentId,
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
      ...(over.withLaunch === false ? {} : { launch }),
    },
  };
}

/** The pop-out's own wiring: the panel above, the `+` beside the form. */
function Harness({
  taskId = "t-1",
  sessions,
}: {
  taskId?: string;
  sessions?: React.ComponentProps<typeof AgentWindowLaunch>["sessions"];
}) {
  const panel = useAgentLaunch();
  return (
    <>
      <button type="button" aria-label="New agent" onClick={panel.toggle} />
      <AgentWindowLaunch
        panel={panel}
        workspaceId="ws-1"
        currentUserId={ME}
        channelId={CHANNEL_ID}
        taskId={taskId}
        sessions={sessions}
        agent={summary({ channelName: "Website", threadTitle: "UI-kit design" })}
      />
    </>
  );
}

beforeEach(() => {
  launch.mockReset().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" });
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: "k3v7d2mq" });
  stubBridge();
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

describe("the + opens the New agent form", () => {
  it("mounts nothing until the click, then the popup", async () => {
    render(<Harness />);
    expect(screen.queryByRole("heading", { name: "New agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(await screen.findByRole("heading", { name: "New agent" })).toBeTruthy();
    // The blank lane is one click plus one Launch — the form is preselected, never empty.
    await waitFor(() => expect(screen.getByLabelText("Agent name")).toBeTruthy());
  });

  /**
   * 🔒 **IT IS THE SAME LANE** — `sessions.launch`, the bridge op the Agents tab's form submits
   * through (INVARIANTS §5A: *"there is still exactly ONE launch lane"*). ⚠ AND THE ROOM'S NAME AND
   * THE THREAD'S TITLE COME OFF THE ACTIVE TAB'S FEED ROW, which is the only source this window has
   * for either: it never reads the channel.
   */
  it("launches on the bridge, with the active tab's channel and thread", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await screen.findByRole("heading", { name: "New agent" });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    const payload = launch.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.channelId).toBe(CHANNEL_ID);
    expect(payload.taskId).toBe("t-1");
    expect(payload.workspaceId).toBe("ws-1");
    expect(payload.channelName).toBe("Website");
    expect(payload.threadTitle).toBe("UI-kit design");
    // ⚠ A BLANK LAUNCH CARRIES NO TEMPLATE AND NO OVERRIDES — absent, not `null`, which is the
    // byte-identical payload a build predating templates sent.
    expect(payload.templateId ?? null).toBeNull();
    expect(payload.overrides).toBeUndefined();
  });

  /** ⚠ `""` IS A RESPONDER WHOSE EXCHANGE NEVER BECAME FIRST-CLASS, so the sibling starts on the
   *  ROOM — `taskId: null` on the wire, the channel-level lane. Never `''` passed through as a
   *  thread that is not addressable. */
  it("starts a CHANNEL-level agent when the active tab has no thread", async () => {
    render(<Harness taskId="" />);
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await screen.findByRole("heading", { name: "New agent" });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect((launch.mock.calls[0]![0] as { taskId: unknown }).taskId).toBeNull();
  });

  /** ⚠ ABSENT, NOT DISABLED, on a build that cannot launch (INVARIANTS §11) — the form offers no
   *  Launch rather than one that refuses. */
  it("offers no launch at all when the bridge has no op", async () => {
    stubBridge({ withLaunch: false });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await screen.findByRole("heading", { name: "New agent" });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(launch).not.toHaveBeenCalled();
  });
});

/**
 * ⚠ **THE PAGE'S HALF, AS SOURCE.** The dialog can be perfect and the `+` still inert — that WAS the
 * bug — and the wiring lives in the SPA page, which this suite cannot mount (it is router- and
 * workspace-bound). Three lines are the whole contract.
 */
describe("the pop-out page wires the + to the form", () => {
  const page = readFileSync(
    join(import.meta.dirname, "../../../../../apps/desktop-ui/src/pages/agent-window/index.tsx"),
    "utf8"
  );

  it("holds one launch panel and hands its toggle to the strip", () => {
    expect(page).toContain("useAgentLaunch()");
    expect(page).toMatch(/onNewAgent=\{launch\.toggle\}/);
  });

  it("mounts the form for the ACTIVE tab, keyed by it", () => {
    expect(page).toMatch(/<AgentWindowLaunch[\s\S]{0,400}key=\{active\.key\}/);
    expect(page).toMatch(/channelId=\{active\.channelId\}/);
    expect(page).toMatch(/taskId=\{active\.taskId\}/);
  });
});

/**
 * **THE COLOUR ROW'S TAKEN SET IN THIS WINDOW** (2026-09-13; docs/specs/agent-colors.md item 7).
 *
 * ⚠ **THE OWN FEED IS THE ONLY SOURCE HERE**, and it is advisory: this window reads no channel
 * projection, so a PEER's key looks free until the server's partial unique index answers 409. What
 * it can fence is the operator's own live agents in this room, which is the common collision.
 */
describe("the popup's colour row, in the pop-out", () => {
  it("fences the keys THIS ROOM'S own live agents hold, and ignores other rooms and ended rows", async () => {
    // 🔒 MUTATION-PROOF: drop `liveSessions` from the `LaunchAgentDialog` mount (its pre-2026-09-13
    // state) and `FIRST` reads as free — the row offers a key the operator's own agent is wearing
    // and the launch comes back 409.
    render(
      <Harness
        sessions={[
          summary({ channelId: CHANNEL_ID, agentId: "aa11bb22", name: "aa11bb22", color: FIRST, state: "working" }),
          // ⚠ ENDED ⇒ its key is back in the bank (Samuel: *"once the agent has ended, that color
          // needs to be returned"*), and the rule lives in `agentColorsTaken`, not here.
          summary({ channelId: CHANNEL_ID, agentId: "cc33dd44", name: "cc33dd44", color: SECOND, state: "ended" }),
          // ⚠ ANOTHER ROOM ⇒ irrelevant: the key is unique per CHANNEL.
          summary({ channelId: "ch-other", agentId: "ee55ff66", name: "ee55ff66", color: THIRD, state: "working" }),
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await screen.findByRole("heading", { name: "New agent" });
    expect(screen.getByRole("radio", { name: FIRST }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("radio", { name: SECOND }).getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.getByRole("radio", { name: THIRD }).getAttribute("aria-disabled")).not.toBe("true");
    // The preselect is the first FREE key, so it skips the one this room holds.
    expect(
      screen
        .getAllByRole("radio")
        .find((el) => el.getAttribute("aria-checked") === "true")
        ?.getAttribute("data-agent-color")
    ).toBe(SECOND);
  });

  it("offers every key when the bridge could not answer — an empty feed is not a full bank", async () => {
    render(<Harness sessions={null} />);
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await screen.findByRole("heading", { name: "New agent" });
    expect(screen.getByRole("radio", { name: FIRST }).getAttribute("aria-disabled")).not.toBe("true");
  });
});
