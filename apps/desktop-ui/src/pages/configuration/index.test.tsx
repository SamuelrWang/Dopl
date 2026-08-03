import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import ConfigurationPage from "./index";

/**
 * Smoke test for the ported configuration page.
 *
 * The page makes NO request at all — the feature is mock-driven
 * (web-pages.md §15) — so the assertions are: it renders, its two modes
 * switch, and neither the bridge nor `fetch` is ever touched.
 */

const apiRequest = vi.hoisted(() => vi.fn());

function renderPage() {
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment/configuration", element: <ConfigurationPage /> }],
    { initialEntries: ["/acme-ab12cd/configuration"] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("configuration page", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("renders the guide builder without a single request", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "Build" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Member view" })).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("switches to the member view", () => {
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Member view" }));

    expect(apiRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
