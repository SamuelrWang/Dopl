// @vitest-environment jsdom
/**
 * THE NEW AGENT SPLIT BUTTON — split out of `agents-tab.test.tsx` on 2026-08-22
 * at the 500-line cap, on the seam between what a CARD renders and what the
 * LAUNCH control does.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const templateList = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: templateList.templates,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

import { AgentsTab } from "./agents-tab";
import { CHANNEL_ID, ME } from "./test-fixtures";

afterEach(() => {
  cleanup();
  templateList.templates = [];
});

/**
 * THE NEW AGENT SPLIT BUTTON (2026-08-22, the agent-templates launch wave).
 *
 * ⚠ **THE FACE OPENS THE POPUP SINCE 2026-09-08 AND NO LONGER LAUNCHES**, which supersedes this
 * file's oldest pin. Samuel: *"put in the new agent button in the agents tab"* — the button that
 * spawned a blank agent in one click now opens `launch-agent-dialog.tsx › LaunchAgentDialog`,
 * preselected to Blank agent. Two properties replace the one that left, and both fail silently:
 * the click must reach the FORM (a face still wired to `onLaunchAgent` would spawn an agent the
 * operator was about to name) and it must reach NOTHING ELSE (a face wired to both would spawn
 * one AND open the form over it).
 * ⚠ THE CHEVRON IS UNTOUCHED, payload included — the picker's own launch is still a THREE-argument
 * call, which is what `passes the picker's template through` pins.
 * ⚠ THE POPUP'S OWN CONTRACT IS `launch-agent-dialog.test.tsx` (the five fields, the defaults, the
 * payload's parity with the slide-out's). What belongs HERE is the WIRING — that this tab's button
 * opens it, on this tab's thread.
 */
describe("the Launch agent split button", () => {
  const WS = "ws-1";

  function mountLaunch(over: Partial<React.ComponentProps<typeof AgentsTab>> = {}) {
    const onLaunchAgent = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AgentsTab
        sessions={[]}
        channelId={CHANNEL_ID}
        workspaceId={WS}
        openThreadId="t-1"
        currentUserId={ME}
        canLaunch
        onLaunchAgent={onLaunchAgent}
        openAgent={null}
        onOpenAgent={vi.fn()}
        {...over}
      />
    );
    return { onLaunchAgent };
  }

  it("OPENS THE POPUP on the face's click, and launches nothing itself", async () => {
    // 🔒 MUTATION-PROOF BOTH WAYS: restore `onClick={() => void onLaunchAgent(openThreadId ?? null)}`
    // and the dialog never appears; wire the face to BOTH and the second expectation fails.
    const { onLaunchAgent } = mountLaunch();
    expect(screen.queryByRole("dialog", { name: "New agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "New agent" })).toBeTruthy()
    );
    expect(onLaunchAgent).not.toHaveBeenCalled();
  });

  it("opens the popup on BLANK AGENT — the one-click lane, one Launch away", async () => {
    templateList.templates = [
      { id: "tpl-9", workspaceId: WS, name: "Code auditor", createdBy: ME },
    ];
    mountLaunch();
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "New agent" })).toBeTruthy()
    );
    // ⚠ THE DEFAULT IS AN OPTION, NOT A PLACEHOLDER — `use-agent-launch.ts` opens on
    // `templateId: null`, which is the row's `Blank agent` pill.
    expect(
      screen
        .getByRole("tablist", { name: "Agent template" })
        .querySelector('[aria-selected="true"]')?.textContent
    ).toBe("Blank agent");
  });

  it("opens NO picker on the face's click", () => {
    mountLaunch();
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders the popup WITHOUT a workspace — the template row degrades, the form does not", async () => {
    // ⚠ `workspaceId` GATES THE CHEVRON AND THE TEMPLATE READ, NEVER THE BUTTON. A New agent
    // button whose form did not open would be the dead control this whole gate exists to avoid.
    mountLaunch({ workspaceId: null });
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "New agent" })).toBeTruthy()
    );
  });

  it("opens the picker from the ADJACENT chevron, which launches nothing itself", () => {
    const { onLaunchAgent } = mountLaunch();
    const chevron = screen.getByRole("button", { name: "Launch from template" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(chevron);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Blank agent/ })).toBeTruthy();
    expect(onLaunchAgent).not.toHaveBeenCalled();
  });

  it("gives the chevron its OWN accessible name — two controls, not one", () => {
    mountLaunch();
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Launch from template" })).toBeTruthy();
  });

  it("renders NO chevron without a workspace to list", () => {
    // ⚠ The same feature-detected degradation every bridge affordance here
    // follows, applied to a READ: no affordance beats one that can only be empty.
    mountLaunch({ workspaceId: null });
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Launch from template" })).toBeNull();
  });

  // ⚠ CHANNEL VIEW IS WHERE MOST PEOPLE ARRIVE, and the button used to be
  // absent there entirely (gated on `openThreadId`) — Samuel opened the tab and
  // found no way to start an agent at all. It is present now, and because an
  // ⚠ FLIPPED 2026-08-31 (Samuel's ruling): it used to open the new-thread
  // panel on the argument that an agent runs inside a thread — but the
  // threadless lane (an agent ON THE ROOM, the composer's Bot icon since
  // 2026-08-21) makes that redirect the one surface pretending otherwise. The
  // channel view now launches CHANNEL-LEVEL in one click, `threadId: null`.
  // ⚠ AND THE CHEVRON CAME WITH IT ON 2026-09-08 (Samuel: *"Same one, that
  // enables me to launch a template"*). This case asserted the chevron was
  // ABSENT here — the last piece of the redirect — and the ruling flipped it.
  it("with no thread open, the popup's Launch is CHANNEL-LEVEL — threadId null", async () => {
    // 🔒 THE TAB'S OWN WIRING, END TO END: the face opens the form and the form's Launch carries
    // THIS TAB's thread. `openThreadId ?? null` is read the same way by all three controls, and a
    // popup that fabricated or dropped a thread id would be worse than the redirect it replaced.
    const onNewThread = vi.fn();
    const { onLaunchAgent } = mountLaunch({ openThreadId: null, onNewThread });

    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    const name = (await screen.findByLabelText("Agent name")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Research" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(onLaunchAgent).toHaveBeenCalled());
    expect(onLaunchAgent.mock.calls[0][0]).toBeNull();
    expect(onLaunchAgent.mock.calls[0][1]).toBeNull();
    expect(onNewThread).not.toHaveBeenCalled();
  });

  // 🔒 THE WHOLE SPLIT BUTTON IS IN CHANNEL VIEW, NOT HALF OF IT. The face
  // moved on 2026-08-31 and the chevron stayed behind, so the view most people
  // arrive in offered a blank launch and no template lane at all.
  it("renders the chevron with NO open thread — `workspaceId` is the only gate", () => {
    mountLaunch({ openThreadId: null });
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Launch from template" })).toBeTruthy();
  });

  it("still renders WITHOUT a new-thread lane — the launch no longer needs one", () => {
    // The old case pinned "no thread + no way to make one = no control"; the
    // channel-level lane means the control stands on `canLaunch` alone now.
    mountLaunch({ openThreadId: null, onNewThread: undefined });
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
  });

  it("renders neither half when the bridge cannot launch", () => {
    mountLaunch({ canLaunch: false });
    expect(screen.queryByRole("button", { name: "New agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Launch from template" })).toBeNull();
  });

  it("passes the picker's template through to the launch", async () => {
    templateList.templates = [
      {
        id: "tpl-9",
        workspaceId: WS,
        name: "Code auditor",
        description: null,
        instructions: null,
        model: null,
        fields: [],
        visibility: "private",
        teamIds: [],
        knowledgeBases: [],
        createdBy: ME,
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ];
    const { onLaunchAgent } = mountLaunch();
    fireEvent.click(screen.getByRole("button", { name: "Launch from template" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    await waitFor(() =>
      expect(onLaunchAgent).toHaveBeenCalledWith("t-1", "tpl-9", undefined)
    );
    templateList.templates = [];
  });

  // 🔒 A TEMPLATE LAUNCH IN CHANNEL VIEW IS THE SAME LAUNCH, THREADLESS. The
  // picker's half must read `openThreadId` exactly as the face does — a chevron
  // that rendered but sent a stale or fabricated thread id would be worse than
  // the absence it replaced.
  it("with no thread open, the picker launches the template CHANNEL-LEVEL", async () => {
    templateList.templates = [
      {
        id: "tpl-9",
        workspaceId: WS,
        name: "Code auditor",
        description: null,
        instructions: null,
        model: null,
        fields: [],
        visibility: "private",
        teamIds: [],
        knowledgeBases: [],
        createdBy: ME,
        createdAt: "2026-08-01T00:00:00Z",
        updatedAt: "2026-08-01T00:00:00Z",
      },
    ];
    const { onLaunchAgent } = mountLaunch({ openThreadId: null });
    fireEvent.click(screen.getByRole("button", { name: "Launch from template" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    await waitFor(() =>
      expect(onLaunchAgent).toHaveBeenCalledWith(null, "tpl-9", undefined)
    );
    templateList.templates = [];
  });
});

/**
 * WHICH IDENTITY THE CARD SAYS AN AGENT IS WEARING (2026-08-22).
 *
 * ⚠ OPERATOR-ONLY, AND IT IS STRUCTURAL RATHER THAN A CHECK. `templateName`
 * exists on `DesktopSessionSummary` — this machine's own registry — and NOT on
 * `ChannelPeerSession`, because `channel_sessions.template_name` is excluded from
 * the peer projection: a private template's name on a colleague's card is an
 * existence oracle. There is nothing to plumb into `PeerCards` and nothing to
 * assert about it here beyond that.
 */
describe("the template name on an own-agent card", () => {
  function card(over: Record<string, unknown> = {}) {
    render(
      <AgentsTab
        sessions={[
          {
            sessionId: "s-1",
            channelId: CHANNEL_ID,
            taskId: "t-1",
            name: "flint",
            state: "working",
            threadTitle: "UI-kit design",
            ...over,
          },
        ] as never}
        channelId={CHANNEL_ID}
        openThreadId="t-1"
        currentUserId={ME}
        openAgent={null}
        onOpenAgent={vi.fn()}
      />
    );
  }

  it("names the template it launched as, before the model", () => {
    card({ templateName: "Code auditor", model: "claude-opus-5" });
    const line = screen.getByText("UI-kit design").parentElement!;
    expect(line.textContent).toContain("· Code auditor");
    // WHO it is reads before WHAT it runs on.
    expect(line.textContent!.indexOf("Code auditor")).toBeLessThan(
      line.textContent!.indexOf("Opus")
    );
  });

  it("renders NOTHING for a blank agent, and nothing on a main that omits the field", () => {
    card({ templateName: null, model: "claude-opus-5" });
    expect(screen.getByText("UI-kit design").parentElement!.textContent).toBe(
      "UI-kit design· Opus"
    );
    cleanup();
    // ⚠ Absent and `null` are the same answer — an older main has no field, and
    // "Default" would be this build claiming to know (INVARIANTS §11).
    card({ model: "claude-opus-5" });
    expect(screen.getByText("UI-kit design").parentElement!.textContent).toBe(
      "UI-kit design· Opus"
    );
  });
});
