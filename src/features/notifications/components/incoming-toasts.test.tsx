// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { IncomingToasts } from "./incoming-toasts";
import { ToastHost } from "@/shared/ui/toast";

/**
 * The renderer end of the "Mac + popup" split. Main pushes a toast instead of raising a banner
 * while Dopl is in front; without this subscriber every one of those would be dropped silently.
 */

const original = (globalThis as { dopl?: unknown }).dopl;

afterEach(() => {
  cleanup();
  if (original === undefined) delete (globalThis as { dopl?: unknown }).dopl;
  else (globalThis as { dopl?: unknown }).dopl = original;
});

/**
 * Exactly what main pushes over `onToast`.
 * ⚠ `sticky` WAS MISSING HERE (2026-10-10), which is why it was unasserted end to end: the push
 * helper could not even express it, so deleting `t.sticky ?` from the component broke nothing.
 */
type ToastPush = {
  eventId: string;
  title: string;
  body?: string;
  openId?: string;
  actionLabel?: string;
  sticky?: boolean;
  kind: "incoming";
};

/** Installs a bridge whose `onToast` this test drives, and hands back the push. */
function installBridge(opts: { onToast?: unknown } = {}) {
  let fire: ((t: ToastPush) => void) | null = null;
  const off = vi.fn();
  const onToast =
    "onToast" in opts
      ? opts.onToast
      : (cb: (t: ToastPush) => void) => {
          fire = cb;
          return off;
        };
  const openFromToast = vi.fn(() => Promise.resolve({ ok: true }));
  (globalThis as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    notifications: { refresh: vi.fn(), onToast, openFromToast },
  };
  return {
    push: (t: Partial<Omit<ToastPush, "kind">>) =>
      fire?.({
        eventId: t.eventId ?? "mention",
        title: t.title ?? "",
        body: t.body,
        openId: t.openId,
        actionLabel: t.actionLabel,
        sticky: t.sticky,
        kind: "incoming",
      }),
    off,
    openFromToast,
  };
}

describe("IncomingToasts", () => {
  it("shows a toast main pushed", async () => {
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ title: "A peer's agent asked you something" });
    expect(await screen.findByText("A peer's agent asked you something")).toBeTruthy();
  });

  it("ignores a push with no title, leaving the slot as it was", async () => {
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ title: "Still showing this" });
    await screen.findByText("Still showing this");

    // ⚠ The toast slot holds ONE toast, so a titleless push that was NOT ignored would blank it.
    push({ title: "" });
    await waitFor(() => expect(screen.getByText("Still showing this")).toBeTruthy());
  });

  it("unsubscribes on unmount", () => {
    const { off } = installBridge();
    const view = render(<IncomingToasts />);
    view.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("is a silent no-op with no bridge, an older desktop, or a throwing subscribe", () => {
    // The web tree: no `window.dopl` at all.
    delete (globalThis as { dopl?: unknown }).dopl;
    expect(() => render(<IncomingToasts />).unmount()).not.toThrow();

    // ⚠ CAPABILITY-KEYED: an older main exposes `notifications` WITHOUT `onToast`.
    installBridge({ onToast: undefined });
    expect(() => render(<IncomingToasts />).unmount()).not.toThrow();

    // A subscribe that throws leaves the OS banner as the only surface, which is safe.
    installBridge({
      onToast: () => {
        throw new Error("ipc down");
      },
    });
    expect(() => render(<IncomingToasts />).unmount()).not.toThrow();
  });
});

describe("IncomingToasts > an actionable event raised while Dopl is in front", () => {
  it("renders ONE button that only navigates, and never a decision", async () => {
    const { push, openFromToast } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({
      eventId: "peer_ask",
      title: "Design",
      body: "Ada's agent asks: ship it",
      openId: "open-1",
      actionLabel: "Open",
    });

    expect(await screen.findByText("Design")).toBeTruthy();
    expect(await screen.findByText("Ada's agent asks: ship it")).toBeTruthy();
    // ⚠ The affirmative lives on the OS banner only. A toast auto-dismisses and a dismissal
    // decides nothing, so "Launch agent" / "Send" / "Allow" must never appear here.
    for (const decisive of ["Launch agent", "Send", "Allow"]) {
      expect(screen.queryByRole("button", { name: decisive })).toBeNull();
    }
    const open = screen.getByRole("button", { name: "Open" });
    open.click();
    await waitFor(() => expect(openFromToast).toHaveBeenCalledWith("open-1"));
  });

  /**
   * 🔒 **THE PLAIN MENTION CARD IS THE CONTROL ITSELF** (Samuel, 2026-10-12, #4358 opt 1:
   * *"whole in-app mention pop-up clickable, jumps to the message"*, 4s dismiss KEPT, no button).
   *
   * ⚠ **`openId` WITH NO `actionLabel` IS THE SHAPE**, and it is what keeps the 4s life and the
   * single slot: `lifeOf` and `show` both key on `openId && actionLabel`. These cases assert the
   * ABSENCE of a button as hard as the presence of the click.
   */
  it("a mention push with a handle and NO label is clickable, with no button added", async () => {
    const { push, openFromToast } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ eventId: "mention", title: "Design", body: "Ada mentioned you: ship it", openId: "open-7" });

    expect(await screen.findByText("Design")).toBeTruthy();
    // No "Open", and none of the decisive verbs either.
    for (const label of ["Open", "Launch agent", "Send", "Allow"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    screen.getByText("Ada mentioned you: ship it").click();
    await waitFor(() => expect(openFromToast).toHaveBeenCalledWith("open-7"));
  });

  it("…and it still dismisses in 4s, so a burst of mentions is unchanged", async () => {
    vi.useFakeTimers();
    try {
      const { push } = installBridge();
      render(
        <>
          <IncomingToasts />
          <ToastHost />
        </>
      );
      act(() => { push({ eventId: "mention", title: "first", openId: "open-8" }); });
      expect(screen.queryByText("first")).toBeTruthy();
      // ⚠ 15s would be the ACTIONABLE life — the promotion the ruling refused. Assert it is gone
      // by 4s, and that the NEXT mention takes the slot immediately after.
      act(() => { vi.advanceTimersByTime(4001); });
      expect(screen.queryByText("first")).toBeNull();
      act(() => { push({ eventId: "mention", title: "second", openId: "open-9" }); });
      expect(screen.queryByText("second")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a TITLE-ONLY push with a handle takes the default card, not the black line", async () => {
    // ⚠ THE ONE VISUAL CHANGE THIS FIX MAKES (Review 41, finding 1). A title-only push used to
    // take `variant: "invert"` — the small black line — unconditionally. That face carries NO
    // controls by design, so a handle on it would be an invisible click target: the reader would
    // have no way to know the line was clickable, and the card is the face that reads as one.
    // So the condition is `body || handle`, and this is the case that pins the `|| handle` half.
    const { push, openFromToast } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ eventId: "mention", title: "Design", openId: "open-11" });

    expect(await screen.findByText("Design")).toBeTruthy();
    // The default card has a Dismiss control; the black line has none at all. That difference is
    // the cheapest honest way to tell the two faces apart from the outside.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    // …and still no Open button: the card is the control, which is the ruling.
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();

    screen.getByText("Design").click();
    await waitFor(() => expect(openFromToast).toHaveBeenCalledWith("open-11"));
  });

  it("…while a title-only push with NO handle is still the black line", async () => {
    // The CONTROL for the case above: without it, that one would pass against a component that
    // had simply stopped using the invert face at all.
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ eventId: "agent_started", title: "An agent started" });
    expect(await screen.findByText("An agent started")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("a mention with no handle is an ordinary card — nothing to click, nothing parked", async () => {
    const { push, openFromToast } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ eventId: "mention", title: "Design", body: "no navigation given" });
    const body = await screen.findByText("no navigation given");
    body.click();
    expect(openFromToast).not.toHaveBeenCalledWith(expect.stringMatching(/^open-/));
  });

  it("stays silent when the bridge cannot open, rather than claiming it did", async () => {
    const { push } = installBridge();
    (globalThis as { dopl?: { notifications?: { openFromToast?: unknown } } }).dopl!.notifications!
      .openFromToast = () => Promise.reject(new Error("ipc down"));
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ eventId: "draft_reply", title: "Design", openId: "open-2", actionLabel: "Open" });
    const open = await screen.findByRole("button", { name: "Open" });
    expect(() => open.click()).not.toThrow();
  });
});

describe("IncomingToasts > the ack main waits for", () => {
  it("acks on mount, with main's reserved handle, so a held toast is released", async () => {
    // ⚠ LOAD-BEARING, NOT TELEMETRY. `webContents.send` does not throw into a window whose
    // renderer has not mounted this subscriber, so main counted a push into an unmounted window
    // as DELIVERED — losing the startup resume offer on every cold start. Main now HOLDS a toast
    // until this ack and raises the OS banner without it.
    const { openFromToast } = installBridge();
    render(<IncomingToasts />);
    await waitFor(() => expect(openFromToast).toHaveBeenCalledWith("toast-ready"));
  });

  it("does NOT ack when the subscribe throws: main must fall back to the banner", () => {
    const off = vi.fn();
    const openFromToast = vi.fn(() => Promise.resolve({ ok: true }));
    (globalThis as { dopl?: unknown }).dopl = {
      apiRequest: vi.fn(),
      notifications: {
        refresh: vi.fn(),
        onToast: () => {
          throw new Error("ipc down");
        },
        openFromToast,
      },
    };
    expect(() => render(<IncomingToasts />)).not.toThrow();
    expect(openFromToast).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();
  });
});

describe("IncomingToasts > the single slot, and the yield contract", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("⚠ QUEUES: two mentions inside one slot life show as TWO, not as one", async () => {
    // THE DEFECT. `t.kind` was never read and every push overwrote the single slot
    // (`toast.tsx › currentToast`), so the second of two mentions arriving within the slot's 4s
    // life silently replaced the first and the operator saw one notification for two facts.
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ title: "Ada mentioned you" });
    push({ title: "Bea mentioned you" });

    expect(await screen.findByText("Ada mentioned you")).toBeTruthy();
    expect(screen.queryByText("Bea mentioned you")).toBeNull();
    // Ada's turn ends; Bea takes the slot rather than having been thrown away.
    expect(await screen.findByText("Bea mentioned you", undefined, { timeout: 6000 })).toBeTruthy();
  }, 10000);

  it("shows the body as a second line, and only the title when there is none", async () => {
    // `variant: "invert"` renders the TITLE ONLY, so a push carrying a body has to take the
    // default card face or that body is unreachable — `tool_blocked`'s only surface is this one.
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    push({ eventId: "tool_blocked", title: "Bash was blocked", body: "ask again to allow it" });
    expect(await screen.findByText("Bash was blocked")).toBeTruthy();
    expect(await screen.findByText("ask again to allow it")).toBeTruthy();
  });

  it("a sticky toast survives long past every other toast's life", async () => {
    // ⚠ `sticky` WAS UNASSERTED END TO END. The push type did not declare it and no test sent
    // one, so deleting `t.sticky ?` from the component broke nothing — and the resume offer is
    // raised ONCE at startup, so a 15-second life would simply lose it.
    vi.useFakeTimers();
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    await act(async () => {
      push({
        eventId: "session_resume",
        title: "Resume session",
        body: "A Dopl session was interrupted.",
        openId: "resume-1",
        actionLabel: "Resume",
        sticky: true,
      });
    });
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();

    // Past the 15s an ordinary actionable toast gets, and past the 4s a plain one gets.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.getByText("Resume session")).toBeTruthy();
  });

  it("a NON-sticky actionable toast does expire, which is what makes sticky mean something", async () => {
    vi.useFakeTimers();
    const { push } = installBridge();
    render(
      <>
        <IncomingToasts />
        <ToastHost />
      </>
    );
    await act(async () => {
      push({ eventId: "peer_ask", title: "Design", openId: "open-9", actionLabel: "Open" });
    });
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });
});
