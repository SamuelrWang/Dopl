// @vitest-environment jsdom
/**
 * THE AGENT WINDOW's surface (2026-08-20, F-212's closure) — the three lanes the mock drew
 * and the panel could only state the absence of.
 *
 * The properties that fail quietly:
 *
 *  - **"CANNOT SHOW THE WORK" AND "IT HAS DONE NOTHING YET" ARE DIFFERENT FACTS.** A plain
 *    browser, or a main without the narration ops, must not render as an idle agent —
 *    that is a claim about the operator's machine this surface cannot make
 *    (INVARIANTS §11 — UNKNOWN is not EMPTY).
 *  - **THE COMPOSER RENDERS ONLY WHEN IT CAN SEND.** The panel's own rule, and the reason
 *    it shipped with no composer at all: an inert input looks exactly like every input
 *    that does send.
 *  - **A REFUSED MESSAGE KEEPS THE TEXT.** Retyping something main never took is the worst
 *    way to find out it was refused.
 *  - **NOTHING TYPED HERE IS POSTED TO THE THREAD**, and the surface says so — an input
 *    under a transcript normally posts to it, which makes this the one genuinely
 *    surprising property of the window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import {
  ChannelsV2AgentWindow,
  NARRATION_EMPTY,
  NARRATION_UNSUPPORTED,
  MESSAGE_AUTH_HELD,
  MESSAGE_REFUSED,
  agentWindowTitle,
} from "./agent-window";
import { CHANNEL_ID, ME } from "./test-fixtures";

const TASK = "t-1";
const WS = "ws-1";

// The transcript read is a real hook; this suite is about the window's own lanes.
vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, refetch: () => {} }),
}));

function summary(over: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: TASK,
    name: "flint",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    detail: "tool",
    toolLabel: "Bash",
    ...over,
  };
}

interface BridgeOver {
  sessions?: DesktopSessionSummary[];
  entries?: unknown[];
  message?: ReturnType<typeof vi.fn>;
  withNarration?: boolean;
  withMessage?: boolean;
}

function installBridge(over: BridgeOver = {}) {
  const {
    sessions = [summary()],
    entries = [],
    message = vi.fn().mockResolvedValue({ ok: true }),
    withNarration = true,
    withMessage = true,
  } = over;
  const api: Record<string, unknown> = {
    summaries: () => Promise.resolve({ sessions }),
    onSummaries: () => () => {},
    reopen: vi.fn(),
  };
  if (withNarration) {
    api.narration = () => Promise.resolve({ entries });
    api.onNarration = () => () => {};
  }
  if (withMessage) api.message = message;
  (window as unknown as { dopl?: unknown }).dopl = {
    apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
    sessions: api,
  };
  return { message };
}

async function mount() {
  await act(async () => {
    render(
      <ChannelsV2AgentWindow
        workspaceId={WS}
        channelId={CHANNEL_ID}
        taskId={TASK}
        currentUserId={ME}
      />
    );
  });
}

beforeEach(() => {
  document.title = "Dopl";
});
afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

describe("the window names itself", () => {
  it("titles on the agent's handle, with a fallback for a window still loading", () => {
    expect(agentWindowTitle("flint")).toBe("Dopl — flint");
    expect(agentWindowTitle(null)).toBe("Dopl");
  });

  it("writes document.title, which is how main learns the name it cannot read", async () => {
    installBridge();
    await mount();
    await waitFor(() => expect(document.title).toBe("Dopl — flint"));
  });
});

describe("the header shows what the agent is doing", () => {
  it("carries the finer detail, not just Running", async () => {
    installBridge();
    await mount();
    expect(screen.getByText("flint")).toBeTruthy();
    expect(await screen.findByText("Running Bash")).toBeTruthy();
  });
});

describe("the work lane's two absences are worded differently", () => {
  it("says it CANNOT SHOW the work when this build has no narration ops", async () => {
    installBridge({ withNarration: false });
    await mount();
    expect(await screen.findByText(NARRATION_UNSUPPORTED)).toBeTruthy();
    expect(screen.queryByText(NARRATION_EMPTY)).toBeNull();
  });

  // ⚠ THE PAIR THIS SURFACE MOST EASILY COLLAPSES. Rendering "nothing yet" over a browser
  // claims the operator's agent is idle, which is not a claim this surface can make.
  it("says NOTHING YET when it asked and the agent has said nothing", async () => {
    installBridge({ entries: [] });
    await mount();
    expect(await screen.findByText(NARRATION_EMPTY)).toBeTruthy();
    expect(screen.queryByText(NARRATION_UNSUPPORTED)).toBeNull();
  });

  it("renders the work, with tool NAMES — the half F-212 called out by name", async () => {
    installBridge({
      entries: [
        { at: 1, kind: "tool", tool: "Bash", text: "npm test" },
        { at: 2, kind: "result", ok: true, text: "158 passed" },
        { at: 3, kind: "assistant", text: "tests are green" },
      ],
    });
    await mount();
    expect(await screen.findByText("npm test")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("158 passed")).toBeTruthy();
    expect(screen.getByText("tests are green")).toBeTruthy();
  });

  it("shortens an MCP tool name the way the rest of the app does", async () => {
    // ⚠ Main sends the RAW name so one call is not named two ways on one screen; the
    // shortening rule is `mcpShortName`'s — the segment after the last `__` (F-139).
    installBridge({
      entries: [{ at: 1, kind: "tool", tool: "mcp__dopl__dopl_channel", text: "{}" }],
    });
    await mount();
    expect(await screen.findByText("dopl_channel")).toBeTruthy();
  });
});

describe("the 1:1 composer", () => {
  it("is not rendered at all on a build that cannot send", async () => {
    // The panel's rule: an inert input looks exactly like every input that does send.
    installBridge({ withMessage: false });
    await mount();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("sends the operator's words to their own agent, by (channel, thread)", async () => {
    const { message } = installBridge();
    await mount();
    const box = await screen.findByLabelText("Message flint");
    fireEvent.change(box, { target: { value: "look at the failing test" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(message).toHaveBeenCalledWith(CHANNEL_ID, TASK, "look at the failing test");
  });

  it("submits on Enter and keeps Shift+Enter for a newline", async () => {
    const { message } = installBridge();
    await mount();
    const box = await screen.findByLabelText("Message flint");
    fireEvent.change(box, { target: { value: "one" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    });
    expect(message).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(message).toHaveBeenCalledWith(CHANNEL_ID, TASK, "one");
  });

  it("clears on a real send and KEEPS the text on a refusal", async () => {
    const message = vi.fn().mockResolvedValue({ ok: false });
    installBridge({ message });
    await mount();
    const box = (await screen.findByLabelText("Message flint")) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "did this land" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(await screen.findByText(MESSAGE_REFUSED)).toBeTruthy();
    // ⚠ Retyping something main never took is the worst way to learn it was refused.
    expect(box.value).toBe("did this land");
  });

  it("names the auth hold specifically — the operator can act on that one", async () => {
    installBridge({ message: vi.fn().mockResolvedValue({ ok: false, reason: "auth-hold" }) });
    await mount();
    const box = await screen.findByLabelText("Message flint");
    fireEvent.change(box, { target: { value: "hi" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(await screen.findByText(MESSAGE_AUTH_HELD)).toBeTruthy();
  });

  it("refuses to send an empty or whitespace-only body", async () => {
    const { message } = installBridge();
    await mount();
    const box = await screen.findByLabelText("Message flint");
    fireEvent.change(box, { target: { value: "   " } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(message).not.toHaveBeenCalled();
  });

  // ⚠ The one genuinely surprising property of this surface: an input under a transcript
  // normally posts to it.
  it("says out loud that nothing here is posted to the thread", async () => {
    installBridge();
    await mount();
    expect(await screen.findByText(/not posted to the thread/i)).toBeTruthy();
  });
});

describe("an agent that is not running", () => {
  it("says so once the feed has ANSWERED, and not before", async () => {
    installBridge({ sessions: [] });
    await mount();
    expect(await screen.findByText("That agent isn't running")).toBeTruthy();
  });

  // ⚠ `sessions === null` is "could not ask", which is NOT "this agent is gone".
  it("does not claim the agent is gone when it could not ask", async () => {
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
      sessions: {},
    };
    await mount();
    expect(screen.queryByText("That agent isn't running")).toBeNull();
  });
});
