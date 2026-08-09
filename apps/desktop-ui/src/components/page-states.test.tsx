import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLoading } from "./page-states";

/**
 * `PageLoading` is the loading state of EVERY desktop page, and a cold launch
 * of Channels crosses five of them back to back (boot ×3, the shell, then the
 * page's own access gate). It used to be a single grey `<span>` reading
 * "Loading…", so that chain was four flickers of bare text in four different
 * positions. It renders a shape now.
 */

function ghosts(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="skeleton"]');
}

describe("PageLoading", () => {
  it("renders a shaped page surface, not a line of copy", () => {
    const { container } = render(<PageLoading label="Loading skills" />);
    expect(container.querySelector(".page-float")).not.toBeNull();
    expect(ghosts(container).length).toBeGreaterThan(5);
  });

  it("never paints the label as visible text", () => {
    render(<PageLoading label="Loading skills" />);
    expect(screen.queryByText("Loading skills…")).toBeNull();
  });

  it("keeps the label available to a screen reader", () => {
    render(<PageLoading label="Starting Dopl" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Starting Dopl");
  });

  it("defaults to the generic page shape — right for overview, settings, boot", () => {
    const { container } = render(<PageLoading />);
    // one surface, no list/detail split
    expect(container.querySelector(".border-r")).toBeNull();
  });

  it("takes the two-pane shape for list pages", () => {
    const { container } = render(<PageLoading variant="two-pane" />);
    expect(container.querySelector(".page-float")).not.toBeNull();
    expect(container.querySelector(".border-r")).not.toBeNull();
  });

  it("holds ONE steady shape across a whole boot chain", () => {
    // The five sequential pending states must not each paint something
    // different — that is the flicker the text loader produced.
    const a = render(<PageLoading label="Starting Dopl" />).container.innerHTML;
    const b = render(<PageLoading label="Opening workspace" />).container.innerHTML;
    expect(a.replace("Starting Dopl", "")).toBe(b.replace("Opening workspace", ""));
  });
});
