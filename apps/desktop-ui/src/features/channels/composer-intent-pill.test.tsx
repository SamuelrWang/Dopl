import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerIntentPill } from "@/features/channels/components/composer-intent-pill";

/**
 * THE MESSAGE / REQUEST PILL, exercised where it actually runs.
 *
 * The component lives in the WEB tree because this renderer bundles that tree,
 * and its DOM half is pinned HERE for the reason `session-pills-bar.test.tsx`
 * gives: the root suite runs in the node environment with no DOM, so a menu that
 * only exists after a click cannot be opened there. The root suite pins the
 * closed, first-paint surface (SSR markup); these cases pin what happens when
 * the operator uses it.
 *
 * WHAT THESE CASES ARE ABOUT. Rollback §3.2 replaces discoverability-by-syntax
 * with discoverability-by-control, so the two facts worth pinning are that BOTH
 * options are visible once the menu is open (a click-through toggle would show
 * one), and that each row states its CONSEQUENCE rather than repeating its name
 * — starting somebody else's agent is the option that must never be picked by
 * accident.
 */

function open() {
  fireEvent.click(screen.getByRole("button", { name: /^Send as:/ }));
}

describe("ComposerIntentPill", () => {
  it("shows only the picked mode until it is opened", () => {
    render(<ComposerIntentPill mode="chat" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Send as: Message" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers BOTH modes, each with its consequence, once opened", () => {
    render(<ComposerIntentPill mode="chat" onChange={vi.fn()} />);
    open();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "MessageGoes to the channel. No agent is started.",
      "RequestOpens a thread and starts their agent.",
    ]);
  });

  it("reports the pick and closes", () => {
    const onChange = vi.fn();
    render(<ComposerIntentPill mode="chat" onChange={onChange} />);
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Request/ }));
    expect(onChange).toHaveBeenCalledWith("request");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("wears the mode it is given, so the face is never stale", () => {
    render(<ComposerIntentPill mode="request" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send as: Request" })).toBeTruthy();
  });

  /**
   * The mode decides what an in-flight send WAS, so flipping it mid-send left
   * the help line below describing a consequence that matched nothing. The old
   * `SegmentedControl` had no `disabled` prop and had to be neutralised by a
   * `pointer-events-none` wrapper; a plain button says it properly.
   */
  it("cannot be opened while a send is in flight", () => {
    render(<ComposerIntentPill mode="chat" onChange={vi.fn()} disabled />);
    const trigger = screen.getByRole("button", { name: "Send as: Message" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
