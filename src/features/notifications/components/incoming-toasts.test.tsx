// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

/** Exactly what main pushes over `onToast`. */
type ToastPush = {
  eventId: string;
  title: string;
  body?: string;
  openId?: string;
  actionLabel?: string;
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
