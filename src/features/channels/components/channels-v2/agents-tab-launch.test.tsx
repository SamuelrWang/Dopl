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
 * ⚠ THE PINNED PROPERTY IS THE ONE-CLICK BLANK LAUNCH, and it is pinned because
 * the spec proposed removing it. Samuel's standing channels-v2 ruling is *one
 * lane, one-click launch*: the button's FACE still spawns a blank agent in
 * exactly one click, with a payload carrying no template and no overrides. The
 * picker lives behind an ADJACENT chevron with its own accessible name and its
 * own hit target — two controls, never one control with a menu in front of it.
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

  it("launches a BLANK agent in ONE click, with no template and no overrides", async () => {
    const { onLaunchAgent } = mountLaunch();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    await waitFor(() => expect(onLaunchAgent).toHaveBeenCalledWith("t-1"));
    // ⚠ EXACTLY ONE ARGUMENT. A `null` template id spelled out here would be a
    // different object on the wire from the one this button has always sent.
    expect(onLaunchAgent.mock.calls[0].length).toBe(1);
  });

  it("opens NO picker on the face's click", () => {
    mountLaunch();
    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(screen.queryByRole("menu")).toBeNull();
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
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Launch from template" })).toBeTruthy();
  });

  it("renders NO chevron without a workspace to list", () => {
    // ⚠ The same feature-detected degradation every bridge affordance here
    // follows, applied to a READ: no affordance beats one that can only be empty.
    mountLaunch({ workspaceId: null });
    expect(screen.getByRole("button", { name: "Launch agent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Launch from template" })).toBeNull();
  });

  // ⚠ CHANNEL VIEW IS WHERE MOST PEOPLE ARRIVE, and the button used to be
  // absent there entirely (gated on `openThreadId`) — Samuel opened the tab and
  // found no way to start an agent at all. It is present now, and because an
  // agent runs INSIDE a thread it takes the first step of the same lane: the
  // composer's new-thread panel. It must NOT reach the launch write with no
  // target, and it must not grow a template chevron naming a thread that does
  // not exist yet.
  it("with no thread open, starts a thread instead of launching", () => {
    const onNewThread = vi.fn();
    const { onLaunchAgent } = mountLaunch({ openThreadId: null, onNewThread });

    fireEvent.click(screen.getByRole("button", { name: "Launch agent" }));
    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(onLaunchAgent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Launch from template" })).toBeNull();
  });

  it("renders no button at all when no thread can be started either", () => {
    // Nothing to launch into AND no way to make one: the honest answer is no
    // control, the same feature-detected degradation `canLaunch` gets.
    mountLaunch({ openThreadId: null, onNewThread: undefined });
    expect(screen.queryByRole("button", { name: "Launch agent" })).toBeNull();
  });

  it("renders neither half when the bridge cannot launch", () => {
    mountLaunch({ canLaunch: false });
    expect(screen.queryByRole("button", { name: "Launch agent" })).toBeNull();
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
