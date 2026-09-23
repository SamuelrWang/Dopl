import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ApiError, NetworkError } from "@/shared/api/api-envelope";
import { PageError, PageLoading, RouteErrorBoundary } from "./page-states";

/**
 * `PageLoading` is the loading state of EVERY desktop page, and a cold Channels
 * launch crosses five back to back (boot ×3, shell, page access gate) — so it
 * must render a SHAPE, not text.
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
    expect(container.querySelector(".border-r")).toBeNull();
  });

  it("takes the two-pane shape for list pages", () => {
    const { container } = render(<PageLoading variant="two-pane" />);
    expect(container.querySelector(".page-float")).not.toBeNull();
    expect(container.querySelector(".border-r")).not.toBeNull();
  });

  it("holds ONE steady shape across a whole boot chain", () => {
    // ⚠ The five sequential pending states must not each paint something
    // different — that is the flicker.
    const a = render(<PageLoading label="Starting Dopl" />).container.innerHTML;
    const b = render(<PageLoading label="Opening workspace" />).container.innerHTML;
    expect(a.replace("Starting Dopl", "")).toBe(b.replace("Opening workspace", ""));
  });
});

describe("PageError", () => {
  let reload: ReturnType<typeof vi.fn>;
  let realLocation: PropertyDescriptor | undefined;

  beforeEach(() => {
    reload = vi.fn();
    realLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { reload } });
  });

  afterEach(() => {
    if (realLocation) Object.defineProperty(window, "location", realLocation);
  });

  it("never renders Electron's raw wrapper text", () => {
    const raw = new Error("Error invoking remote method 'dopl:api-request': TypeError: fetch failed");
    render(<PageError error={raw} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Dopl ran into a problem.");
    expect(screen.queryByText(/invoking remote method/)).toBeNull();
  });

  it("a network failure reads as can't-reach", () => {
    render(<PageError error={new NetworkError()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach Dopl.");
  });

  it("keeps a server 4xx's own sentence", () => {
    render(<PageError error={new ApiError(404, "NOT_FOUND", "Channel not found")} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Channel not found");
  });

  it("offers Reload, which reloads the app", () => {
    render(<PageError error={new NetworkError()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps Try again beside Reload when there is a retry", () => {
    const onRetry = vi.fn();
    render(<PageError error={new NetworkError()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("the route boundary offers Reload over a render throw, with generic copy", () => {
    function Boom(): never {
      throw new TypeError("Cannot read properties of undefined (reading 'id')");
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    const router = createMemoryRouter(
      [{ path: "/", element: <Boom />, errorElement: <RouteErrorBoundary /> }],
      { initialEntries: ["/"] }
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Dopl ran into a problem.");
    expect(screen.queryByText(/reading 'id'/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
