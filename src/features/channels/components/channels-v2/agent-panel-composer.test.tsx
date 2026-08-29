// @vitest-environment jsdom
/**
 * THE SLIDE-OUT PANEL'S 1:1 LANE (Samuel, 2026-08-22).
 *
 * The panel shipped with NO composer and a footer note pointing at the agent
 * window — "open the agent to message it directly" — which is a surface sending
 * the operator somewhere else to say one sentence to their own agent. It has the
 * composer now, and these are the properties that fail quietly:
 *
 *  - **THE COMPOSER AND THE FOOTER NOTE READ ONE CAPABILITY.** The note words
 *    itself around whether the composer is there; two detections of one bridge op
 *    is how a note comes to describe a surface the same build did not render.
 *  - **IT ADDRESSES ONE INSTANCE.** The panel is opened FROM a card. Dropping the
 *    `agentId` does not fail — main resolves `(channel, thread)` to the OLDEST
 *    live agent, succeeds against a stranger, and reports `{ok:true}`.
 *  - **THERE IS ONE SEND PATH.** `agent-composer.tsx` is shared with the window;
 *    a second copy would be two refusal vocabularies for one op.
 *  - **A REFUSAL IS NEVER SWALLOWED, and the text stays in the box.** Retyping
 *    something main never took is the worst way to learn it was refused.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { MESSAGE_AUTH_HELD, MESSAGE_REFUSED } from "./agent-composer";
import { agentKey } from "./agents-model";
import { CHANNEL_ID, ME } from "./test-fixtures";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

type Summary = DesktopSessionSummary & { agentId?: string };

function summary(over: Partial<Summary> = {}): Summary {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    taskId: "t-1",
    agentId: "a1b2c3d4",
    name: "a1b2c3d4",
    state: "working",
    channelName: "Website",
    threadTitle: "UI-kit design",
    ...over,
  };
}

/** ⚠ `apiRequest` is the SPA marker `getSpaBridge` keys on — a fake without it is
 *  not a bridge at all, and every case would collapse to "cannot message". */
function bridge(message?: ReturnType<typeof vi.fn>) {
  const op = message ?? vi.fn().mockResolvedValue({ ok: true });
  (window as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    sessions: { reopen: vi.fn(), message: op },
  };
  return op;
}

function mount(agent: Summary = summary()) {
  render(
    <ChannelsV2AgentPanel
      openAgent={agentKey(agent)}
      sessions={[agent]}
      messages={[]}
      currentUserId={ME}
      onClose={() => {}}
    />
  );
}

describe("the panel's composer appears only where it can send", () => {
  it("renders no input at all on a build with no message op", () => {
    // ⚠ An inert input looks exactly like every input that does send — the
    // panel's oldest rule, and why it shipped with no composer rather than a
    // dead one.
    mount();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByLabelText(/^Message /)).toBeNull();
  });

  /**
   * ⚠ THE FOOTER EXPLAINER IS DELETED (Samuel, 2026-08-22 — minimal copy: label
   * and control only). It read "This view shows only what it sent. Open the agent
   * to watch what it is doing", which stopped being true the moment this panel
   * started rendering the whole stream itself. Both variants went, including the
   * one that survived on a build with no composer.
   */
  it("carries NO footer explainer, on either kind of build", () => {
    mount();
    expect(screen.queryByText(/only what it sent/i)).toBeNull();
    expect(screen.queryByText(/message it directly/i)).toBeNull();
    cleanup();
    bridge();
    mount();
    expect(screen.queryByText(/only what it sent/i)).toBeNull();
  });

  it("renders the input on a build that can send", () => {
    // ⚠ THE LABEL IS `Message Agent #<id>`, NOT `Message <id>` (Samuel, 2026-08-27 — INVARIANTS
    // §11). Every case in this file addressed the box by the bare token, which is the string the
    // placeholder was ACTUALLY rendering and precisely what the ruling forbade: the composer read
    // "Message rpa6kq24" on screen. It resolves `agents-model.ts › agentDisplayName` now, so an
    // agent the operator has renamed is addressed here by that name instead.
    bridge();
    mount();
    expect(screen.getByLabelText("Message Agent #a1b2c3d4")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

});

describe("what the panel's composer sends", () => {
  it("names the INSTANCE the panel was opened on", async () => {
    const message = bridge();
    mount();
    fireEvent.change(screen.getByLabelText("Message Agent #a1b2c3d4"), {
      target: { value: "check the failing spec" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(message).toHaveBeenCalledWith(
      CHANNEL_ID,
      "t-1",
      "check the failing spec",
      "a1b2c3d4"
    );
  });

  it("degrades to oldest-live when the summary carries no id", async () => {
    const message = bridge();
    mount(summary({ agentId: undefined, name: "flint" }));
    fireEvent.change(screen.getByLabelText("Message flint"), {
      target: { value: "hi" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(message).toHaveBeenCalledWith(CHANNEL_ID, "t-1", "hi", undefined);
  });

  it("sends on Enter and keeps Shift+Enter for a newline", async () => {
    const message = bridge();
    mount();
    const box = screen.getByLabelText("Message Agent #a1b2c3d4");
    fireEvent.change(box, { target: { value: "one" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    });
    expect(message).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(message).toHaveBeenCalledTimes(1);
  });

  it("lets an IME's Enter commit its candidate instead of submitting", async () => {
    const message = bridge();
    mount();
    const box = screen.getByLabelText("Message Agent #a1b2c3d4");
    fireEvent.change(box, { target: { value: "にほんご" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("sends nothing for an empty or whitespace-only body", async () => {
    const message = bridge();
    mount();
    const box = screen.getByLabelText("Message Agent #a1b2c3d4");
    fireEvent.change(box, { target: { value: "   " } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(message).not.toHaveBeenCalled();
  });

  it("clears on a real send", async () => {
    bridge();
    mount();
    const box = screen.getByLabelText("Message Agent #a1b2c3d4") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "landed" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(box.value).toBe("");
  });

  it("says a refusal out loud and KEEPS the text", async () => {
    bridge(vi.fn().mockResolvedValue({ ok: false }));
    mount();
    const box = screen.getByLabelText("Message Agent #a1b2c3d4") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "did this land" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_REFUSED);
    expect(box.value).toBe("did this land");
  });

  it("names the auth hold specifically — the operator can act on that one", async () => {
    bridge(vi.fn().mockResolvedValue({ ok: false, reason: "auth-hold" }));
    mount();
    fireEvent.change(screen.getByLabelText("Message Agent #a1b2c3d4"), {
      target: { value: "hi" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_AUTH_HELD);
  });

  /**
   * ⚠ THE WAITING BANNER IS THE ONE REFUSAL WITH A REMEDY (2026-08-25).
   *
   * `MESSAGE_AUTH_HELD` said something true and unanswerable for as long as it
   * existed: this Mac has no Claude Code sign-in, main is HOLDING the agent, and
   * there was no way in the product to do anything about it — `startSignInFlow`
   * and `resumeAfterSignIn` both shipped with ZERO callers, so re-posting was
   * refused with `auth-hold` forever. The button is that missing call.
   */
  const SIGN_IN = { name: "Sign in to Claude" };

  /** A bridge whose message op refuses with the auth hold, optionally carrying
   *  the sign-in op. ⚠ `apiRequest` is the SPA marker `getSpaBridge` keys on. */
  function heldBridge(signIn?: ReturnType<typeof vi.fn>) {
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: {
        reopen: vi.fn(),
        message: vi.fn().mockResolvedValue({ ok: false, reason: "auth-hold" }),
      },
      ...(signIn ? { claude: { signIn } } : {}),
    };
    return signIn;
  }

  /** Send once, so the banner is on screen. */
  async function provokeNotice() {
    fireEvent.change(screen.getByLabelText("Message Agent #a1b2c3d4"), {
      target: { value: "hi" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
  }

  it("the waiting banner grows a Sign in button when the bridge carries the op", async () => {
    heldBridge(vi.fn().mockResolvedValue({ ok: true }));
    mount();
    await provokeNotice();
    expect(screen.getByRole("button", SIGN_IN)).toBeTruthy();
    // ⚠ THE BANNER TEXT IS UNCHANGED, and the button is its SIBLING rather than
    // its child: the alert's `textContent` is the pinned contract, and a control
    // nested inside it would rewrite the sentence for every reader.
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_AUTH_HELD);
  });

  it("and NOT on a build without the op — absent, never inert", async () => {
    // ⚠ THE DETECTION IS ON THE BRIDGE OP (`claude.signIn`), never on the wrapper
    // exported by `agents-controls.ts` — that one is always a function, so
    // `typeof` it answers true in a plain browser and paints a button that can
    // only refuse. This composer shipped that exact bug once, with `messageAgent`.
    heldBridge();
    mount();
    await provokeNotice();
    expect(screen.queryByRole("button", SIGN_IN)).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_AUTH_HELD);
  });

  it("clicking it calls the op, and a successful sign-in clears the banner", async () => {
    // Main resumes every held session before it answers `ok`, so by the time this
    // lands the agent is live again — leaving the banner up would send the
    // operator round the sign-in a second time.
    const signIn = heldBridge(vi.fn().mockResolvedValue({ ok: true }))!;
    mount();
    await provokeNotice();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", SIGN_IN));
    });
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", SIGN_IN)).toBeNull();
  });

  it("a sign-in that did NOT take leaves the banner exactly where it was", async () => {
    // A declined dialog and a failed sign-in are one answer, deliberately: the
    // state the banner describes is still true. A surface that cleared on "I
    // asked" rather than on "it worked" is how a held agent comes to look ready.
    heldBridge(vi.fn().mockResolvedValue({ ok: false }));
    mount();
    await provokeNotice();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", SIGN_IN));
    });
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_AUTH_HELD);
    expect(screen.getByRole("button", SIGN_IN)).toBeTruthy();
  });

  it("an ORDINARY refusal never grows the button — nothing here would fix it", async () => {
    // `MESSAGE_REFUSED` means the agent is gone, and no sign-in brings it back.
    (window as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      sessions: { reopen: vi.fn(), message: vi.fn().mockResolvedValue({ ok: false }) },
      claude: { signIn: vi.fn() },
    };
    mount();
    await provokeNotice();
    expect(screen.getByRole("alert").textContent).toBe(MESSAGE_REFUSED);
    expect(screen.queryByRole("button", SIGN_IN)).toBeNull();
  });

  it("takes a message to an IDLE agent — the first one is what wakes it", async () => {
    // ⚠ Spawn-idle: a launched agent has no turn at all until something arrives.
    // Gating on `working` would make every fresh agent unreachable.
    const message = bridge();
    mount(summary({ state: "idle" }));
    fireEvent.change(screen.getByLabelText("Message Agent #a1b2c3d4"), {
      target: { value: "wake up" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(message).toHaveBeenCalledTimes(1);
  });
});
