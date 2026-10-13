// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ToastHost, toast } from "./toast";

/**
 * 🔒 **THE CARD ITSELF IS A CONTROL WHEN IT IS GIVEN ONE** (Samuel, 2026-10-12, #4358 opt 1:
 * *"whole in-app mention pop-up clickable, jumps to the message"*, 4s dismiss kept, no button).
 *
 * `onBodyClick` is NOT an `action`: an action renders a button, and the mention toast was ruled
 * to have none. These pin the three things that separate "the card is the control" from "the
 * card swallows every click": the card fires it, the two real buttons inside do NOT, and the
 * keyboard reaches it through a REAL `<button>` rather than a hand-rolled `role="button"`.
 */

afterEach(() => {
  cleanup();
  // The host holds ONE toast in a module global; a leftover would be the next test's first card.
  act(() => { toast({ title: "__reset__", durationMs: 1 }); });
  act(() => { vi.useFakeTimers(); vi.advanceTimersByTime(5); vi.useRealTimers(); });
  cleanup();
});

/** The card element the host renders — the live region, which is also the click surface. */
const card = () => screen.getByRole("status");

describe("toast > onBodyClick", () => {
  it("fires when the card is clicked, and dismisses the card", () => {
    const onBodyClick = vi.fn();
    render(<ToastHost />);
    act(() => { toast({ title: "Design", description: "Ada mentioned you", onBodyClick }); });

    expect(screen.queryByText("Design")).toBeTruthy();
    act(() => { card().click(); });
    expect(onBodyClick).toHaveBeenCalledTimes(1);
    // One-shot: the card is gone, so a second press has nothing to land on.
    expect(screen.queryByText("Design")).toBeNull();
  });

  it("is reachable by KEYBOARD through a real button, not a faked role", () => {
    // ⚠ THE POINT OF A REAL `<button>`: Enter and Space come from the platform, so there is no
    // hand-rolled key handler to get wrong. Asserting the ELEMENT is the honest pin for that —
    // and the card keeps `role="status"`, which a `role="button"` on it would have cost.
    const onBodyClick = vi.fn();
    render(<ToastHost />);
    act(() => { toast({ title: "Design", description: "Ada mentioned you", onBodyClick }); });

    const content = screen.getByText("Design").closest("button");
    expect(content).not.toBeNull();
    expect(content!.getAttribute("type")).toBe("button");
    expect(content!.className).toContain("focus-visible:ring");
    expect(card().getAttribute("role")).toBe("status");
    expect(card().getAttribute("aria-live")).toBe("polite");

    // Activating it runs the handler exactly once — the card's own onClick must not double-fire.
    act(() => { content!.click(); });
    expect(onBodyClick).toHaveBeenCalledTimes(1);
  });

  it("DISMISS is not 'open': the X closes the card and runs nothing", () => {
    const onBodyClick = vi.fn();
    render(<ToastHost />);
    act(() => { toast({ title: "Design", onBodyClick }); });

    act(() => { screen.getByRole("button", { name: "Dismiss" }).click(); });
    expect(onBodyClick).not.toHaveBeenCalled();
    expect(screen.queryByText("Design")).toBeNull();
  });

  it("an action button answers for itself, never also for the card", () => {
    const onBodyClick = vi.fn();
    const onClick = vi.fn();
    render(<ToastHost />);
    act(() => { toast({ title: "Design", action: { label: "Open", onClick }, onBodyClick }); });

    act(() => { screen.getByRole("button", { name: "Open" }).click(); });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onBodyClick).not.toHaveBeenCalled();
  });

  it("a card with no handler is inert, and renders no button but Dismiss", () => {
    // The CONTROL for every case above: without this they could all pass on a card that is
    // always clickable, which would make every ordinary toast swallow a stray click.
    render(<ToastHost />);
    act(() => { toast({ title: "Design", description: "nothing to open" }); });

    expect(screen.getByText("Design").closest("button")).toBeNull();
    expect(card().className).not.toContain("cursor-pointer");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Dismiss"]);
  });

  it("a forced invert + handler still renders the BLACK LINE, with nothing to click", () => {
    // ⚠ RENAMED AND STRENGTHENED (Review 41, finding 2). It used to be called "the black line
    // takes no click target", which claimed to pin the `variant === "invert" ? undefined : …`
    // strip in `toast()` — and did not: deleting that strip left this suite 6/6 green, measured.
    //
    // ⚠ AND THAT STRIP CANNOT BE PINNED FROM THE DOM AT ALL, which is worth saying so nobody
    // re-adds a guard that cannot bite. The invert BRANCH returns before any click wiring
    // exists, so whether `onBodyClick` was stored or stripped has no observable difference. The
    // strip is normalization, consistent with the `description` and `action` lines beside it;
    // the BRANCH is the actual guarantee, and the branch is what this now asserts.
    const onBodyClick = vi.fn();
    render(<ToastHost />);
    // `invert` options do not accept a handler; a caller that forces one past the type must not
    // be promoted to the clickable card.
    act(() => {
      (toast as (o: unknown) => void)({ title: "Saved", variant: "invert", onBodyClick });
    });

    // The black face, not the card: one line, no controls of any kind — not even Dismiss.
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(card().className).not.toContain("cursor-pointer");
    act(() => { card().click(); });
    expect(onBodyClick).not.toHaveBeenCalled();
  });
});
