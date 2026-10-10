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

/** Installs a bridge whose `onToast` this test drives, and hands back the push. */
function installBridge(opts: { onToast?: unknown } = {}) {
  let fire: ((t: { eventId: string; title: string; kind: "incoming" }) => void) | null = null;
  const off = vi.fn();
  const onToast =
    "onToast" in opts
      ? opts.onToast
      : (cb: (t: { eventId: string; title: string; kind: "incoming" }) => void) => {
          fire = cb;
          return off;
        };
  (globalThis as { dopl?: unknown }).dopl = {
    apiRequest: vi.fn(),
    notifications: { refresh: vi.fn(), onToast },
  };
  return { push: (t: Partial<{ eventId: string; title: string }>) =>
      fire?.({ eventId: t.eventId ?? "mention", title: t.title ?? "", kind: "incoming" }),
    off };
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
