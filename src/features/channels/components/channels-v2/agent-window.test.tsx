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
 *  - **THIS WINDOW IS A LIVE SURFACE.** Its narration and posture lanes are bridge-PUSHED
 *    and stay live on their own, which is exactly what made the gap invisible: the window
 *    looked healthy while the SENT lane — its only server read — quietly stopped updating
 *    after mount. A third `BrowserWindow` inherits nothing, so it must register the
 *    doorbell through the same `useChannelsV2Live` the core and the pop-out take
 *    (INVARIANTS §7).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { agentWindowTitle } from "./agent-window";
// ⚠ THE WORK LANE MOVED OUT OF THE WINDOW ON 2026-08-22 and is now shared with
// the slide-out panel (`agent-stream.tsx`). Its copy travelled with it; the
// window's own cases below are unchanged, because the behaviour did not move —
// only the file did.
import { NARRATION_EMPTY, NARRATION_UNSUPPORTED } from "./agent-stream";
import { toolRunLabel } from "./agent-stream-log";
// ⚠ THE 1:1 COMPOSER MOVED OUT OF THE WINDOW ON 2026-08-22 and is now shared with
// the slide-out panel (`agent-composer.tsx`). Its copy travelled with it; the
// window's own cases below are unchanged, because the behaviour did not move —
// only the file did.
import { MESSAGE_AUTH_HELD, MESSAGE_REFUSED } from "./agent-composer";
import { CHANNEL_ID } from "./test-fixtures";
// ⚠ THE RENDER MACHINERY IS A HARNESS since 2026-08-27 (§1) — the fake bridge, the
// summary fixture and the mount. It moved WHOLE, unchanged; the cases below are
// what this file is about. `agent-window-harness.tsx` carries why.
import { TASK, WS, installBridge, mount, summary } from "./agent-window-harness";

const { live, refetchMessages, refetchPending, consentMutate } = vi.hoisted(() => ({
  live: vi.fn<
    (opts: {
      workspaceId: string;
      refetchAll: () => void;
      refetchMembers: () => void;
    }) => { gate: object }
  >(() => ({ gate: {} })),
  refetchMessages: vi.fn(),
  refetchPending: vi.fn(),
  consentMutate: vi.fn(),
}));

// The transcript read is a real hook; this suite is about the window's own lanes.
vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [],
    loading: false,
    refetch: refetchMessages,
  }),
}));

// The realtime registration is asserted, not exercised — `live.ts` owns the
// subscription and has its own coverage.
vi.mock("./live", () => ({ useChannelsV2Live: live }));

// ⚠ THE WINDOW READS AND WRITES CONSENT SINCE 2026-08-25 (Samuel's outbound-review
// ruling): the work stream's held-draft card is decidable here. Both are real
// hooks over TanStack + the API, and this suite mounts with no QueryClient — the
// card's own behaviour is `agent-stream.test.tsx`'s, over the pure model.
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: refetchPending }),
}));
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: consentMutate, pending: false },
  }),
}));

beforeEach(() => {
  document.title = "Dopl";
  // ⚠ Both are module-level `vi.hoisted` fakes, so a call count is cumulative
  // across the file unless it is reset here — "called once" would otherwise mean
  // "once since the suite started".
  live.mockClear();
  refetchMessages.mockClear();
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

  // ⚠ THE TOOL DETAIL IS BEHIND ONE CLICK SINCE 2026-08-27 (Samuel) — a run of
  // consecutive tool activity is one muted "Used N tools" row, collapsed by default
  // (`agent-stream-log.tsx`). The COUNT is tool USES, so a call and its result are one.
  it("renders the work, with tool NAMES — the half F-212 called out by name", async () => {
    installBridge({
      entries: [
        { at: 1, kind: "tool", tool: "Bash", text: "npm test" },
        { at: 2, kind: "result", ok: true, text: "158 passed" },
        { at: 3, kind: "assistant", text: "tests are green" },
      ],
    });
    await mount();
    // ⚠ The agent's own words are NEVER behind the chevron: they are the thing the
    // operator opened this window to read.
    expect(await screen.findByText("tests are green")).toBeTruthy();
    expect(screen.queryByText("npm test")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: toolRunLabel(1) }));
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("158 passed")).toBeTruthy();
  });

  /**
   * ⚠ THE LANE IS LIVE, AND NOTHING PROVED IT UNTIL 2026-08-22 (F-250).
   * `onNarration` was stubbed as a no-op in this file, so the frozen filter
   * below shipped green: the hook built the OLD two-segment key
   * `<channel>:<thread>` while `main/session-narration.js › flush` sends the
   * session key, which gained a third segment with multiplayer. The compare
   * could never match, on ANY build — so after the mount read the Work lane
   * never moved again, and the window still looked healthy because its header
   * runs off the summaries feed.
   */
  describe("the work lane follows the live push", () => {
    it("takes a frame keyed <channel>:<thread>:<agent> for the agent on screen", async () => {
      const { push } = installBridge({
        sessions: [summary({ agentId: "a1b2c3d4" })],
        entries: [],
      });
      await mount();
      expect(await screen.findByText(NARRATION_EMPTY)).toBeTruthy();
      await push(`${CHANNEL_ID}:${TASK}:a1b2c3d4`, [
        { at: 9, kind: "tool", tool: "Bash", text: "npm run lint" },
      ]);
      fireEvent.click(await screen.findByRole("button", { name: toolRunLabel(1) }));
      expect(screen.getByText("npm run lint")).toBeTruthy();
    });

    it("ignores a SIBLING agent's frame on the same thread", async () => {
      const { push } = installBridge({
        sessions: [summary({ agentId: "a1b2c3d4" })],
        entries: [],
      });
      await mount();
      await push(`${CHANNEL_ID}:${TASK}:e5f6g7h8`, [
        { at: 9, kind: "assistant", text: "not this agent's work" },
      ]);
      expect(screen.queryByText("not this agent's work")).toBeNull();
      expect(screen.getByText(NARRATION_EMPTY)).toBeTruthy();
    });

    // ⚠ THE HONEST DEGRADATION, not a refusal: a main that emits no `agentId` on
    // its summaries runs at most one agent per thread, so the (channel, thread)
    // prefix names exactly that agent. A dead lane would be strictly worse.
    it("still follows the prefix when the feed carries no instance id", async () => {
      const { push } = installBridge({ entries: [] });
      await mount();
      await push(`${CHANNEL_ID}:${TASK}:whatever`, [
        { at: 9, kind: "assistant", text: "legacy main, one agent" },
      ]);
      expect(await screen.findByText("legacy main, one agent")).toBeTruthy();
    });

    it("ignores another THREAD's frame, prefix or not", async () => {
      const { push } = installBridge({ entries: [] });
      await mount();
      // ⚠ The trailing colon is what stops `t-1` also matching `t-12`.
      await push(`${CHANNEL_ID}:${TASK}2:a1b2c3d4`, [
        { at: 9, kind: "assistant", text: "a different thread" },
      ]);
      expect(screen.queryByText("a different thread")).toBeNull();
    });

    // ⚠ The mount read resolves against main's blended (channel, thread, agent)
    // slot, so without the third argument it lands on the thread's OLDEST live
    // agent rather than the one whose header is above the lane.
    it("names the instance on the mount read too", async () => {
      const { narration } = installBridge({
        sessions: [summary({ agentId: "a1b2c3d4" })],
      });
      await mount();
      await waitFor(() =>
        expect(narration).toHaveBeenCalledWith(CHANNEL_ID, TASK, "a1b2c3d4")
      );
    });
  });

  it("shortens an MCP tool name the way the rest of the app does", async () => {
    // ⚠ Main sends the RAW name so one call is not named two ways on one screen; the
    // shortening rule is `mcpShortName`'s — the segment after the last `__` (F-139).
    installBridge({
      entries: [{ at: 1, kind: "tool", tool: "mcp__dopl__dopl_channel", text: "{}" }],
    });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: toolRunLabel(1) }));
    expect(screen.getByText("dopl_channel")).toBeTruthy();
  });
});

describe("the 1:1 composer", () => {
  it("is not rendered at all on a build that cannot send", async () => {
    // The panel's rule: an inert input looks exactly like every input that does send.
    installBridge({ withMessage: false });
    await mount();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("sends the operator's words to their own agent, naming the INSTANCE", async () => {
    // ⚠ THE FOURTH ARGUMENT IS THE POINT (2026-08-22). `(channel, thread)` names
    // a GROUP of this operator's agents since multiplayer, and main resolves a
    // group to its OLDEST live member — so without the id this window's composer
    // reaches a different agent than the one it is showing, silently.
    const { message } = installBridge({ sessions: [summary({ agentId: "a1b2c3d4" })] });
    await mount();
    // ⚠ `Message Agent #<id>`, NOT `Message <id>` (Samuel, 2026-08-27 — INVARIANTS §11: the raw
    // agent id is never user-visible). This window's composer placeholder was one of the three
    // surfaces that shipped the bare token.
    const box = await screen.findByLabelText("Message #a1b2c3d4");
    fireEvent.change(box, { target: { value: "look at the failing test" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(message).toHaveBeenCalledWith(
      CHANNEL_ID,
      TASK,
      "look at the failing test",
      "a1b2c3d4"
    );
  });

  it("degrades to oldest-live on a main whose summaries carry no id", async () => {
    // ⚠ NOT A REFUSAL. A main that omits `agentId` also runs at most one agent
    // per thread, so oldest-live IS the agent on screen — `undefined` reaches
    // exactly the behaviour that build already had.
    const { message } = installBridge();
    await mount();
    const box = await screen.findByLabelText("Message flint");
    fireEvent.change(box, { target: { value: "hello" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(message).toHaveBeenCalledWith(CHANNEL_ID, TASK, "hello", undefined);
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
    expect(message).toHaveBeenCalledWith(CHANNEL_ID, TASK, "one", undefined);
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
  //
  // ⚠ THE SENTENCE MOVED AND WAS REWRITTEN TWICE (Samuel). It was a `text-micro` footnote under
  // the composer bar; then two lines in the empty state, one of them quoting the agent's id; it
  // is now ONE muted line saying what the lane is and what to do.
  it("says out loud that the lane is private, in one line", async () => {
    installBridge();
    await mount();
    expect(
      await screen.findByText("Chat with your agent privately. Send a message to wake it up.")
    ).toBeTruthy();
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

/**
 * ⚠ THE INVISIBLE REQUIREMENT (2026-08-20). Two of this window's three lanes are
 * bridge-PUSHED and stay live with no subscription at all, so a missing doorbell
 * registration does not look like a broken window — it looks like a working one
 * whose Sent lane happens to be quiet. Asserted as a REGISTRATION rather than by
 * rendering a message, for the same reason `thread-window.test.tsx` does: what
 * fails silently is the window not subscribing, not the row not painting.
 */
describe("the window is a LIVE surface", () => {
  // ⚠ Asserted as CALLED, never as called-once: this is a hook, so it runs on
  // every render, and the feed settling after mount is a second one. A count here
  // would pin React's render schedule, not the registration.
  it("registers the realtime doorbell for its workspace", async () => {
    installBridge({ sessions: [summary()] });
    await mount();
    expect(live).toHaveBeenCalled();
    expect(live.mock.calls.at(-1)?.[0]).toMatchObject({ workspaceId: WS });
  });

  it("refetches the SENT lane's transcript when the bell rings", async () => {
    installBridge({ sessions: [summary()] });
    await mount();
    refetchMessages.mockClear();
    act(() => {
      live.mock.calls.at(-1)?.[0].refetchAll();
    });
    expect(refetchMessages).toHaveBeenCalledTimes(1);
  });

  // ⚠ AND THE PENDING DRAFTS WITH IT (2026-08-25). The held-draft card is the
  // outbound review surface now, so a bell that refreshed the transcript but not
  // the consent rows would leave a Post button pointing at a row that is gone.
  it("refetches the PENDING drafts on the same bell — the card is the review surface", async () => {
    installBridge({ sessions: [summary()] });
    await mount();
    refetchPending.mockClear();
    act(() => {
      live.mock.calls.at(-1)?.[0].refetchAll();
    });
    expect(refetchPending).toHaveBeenCalledTimes(1);
  });

  // ⚠ Deliberately a no-op, not an oversight: this window holds no roster and no
  // presence dot, so there is nothing for the presence debounce to refresh. It is
  // asserted so a reader does not "complete" it with a read this surface would
  // then own for no one.
  it("asks for no roster refetch — it has no roster and no presence to keep fresh", async () => {
    installBridge({ sessions: [summary()] });
    await mount();
    expect(() => live.mock.calls.at(-1)?.[0].refetchMembers()).not.toThrow();
  });
});
