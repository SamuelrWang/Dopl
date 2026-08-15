import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerIntentPill } from "@/features/channels/components/composer-intent-pill";

/**
 * MESSAGE / REQUEST PILL. DOM half pinned HERE: the root suite runs in the node
 * environment with no DOM, so a menu that only exists after a click cannot be
 * opened there; the root suite pins the closed first-paint SSR markup.
 *
 * Two facts worth pinning: BOTH options are visible once the menu is open (a
 * click-through toggle would show one), and each row states its CONSEQUENCE,
 * because starting somebody else's agent must never be picked by accident.
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
   * ⚠ Mode decides what an in-flight send WAS, so flipping it mid-send leaves
   * the help line describing a consequence that matches nothing.
   */
  it("cannot be opened while a send is in flight", () => {
    render(<ComposerIntentPill mode="chat" onChange={vi.fn()} disabled />);
    const trigger = screen.getByRole("button", { name: "Send as: Message" });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
