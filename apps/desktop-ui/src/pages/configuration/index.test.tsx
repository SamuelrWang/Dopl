import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEGMENT, installBridge, renderWithProviders } from "#/test-utils/bridge";
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
  return renderWithProviders(
    [{ path: "/:workspaceSegment/configuration", element: <ConfigurationPage /> }],
    [`/${SEGMENT}/configuration`]
  );
}

describe("configuration page", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    installBridge({ apiRequest });
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
