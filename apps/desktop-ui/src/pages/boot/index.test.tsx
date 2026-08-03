import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import BootPage from "./index";

/**
 * Smoke test for the boot route — the launch decision (journey-audit J1 step 9,
 * GAP-1 and G2). Every branch is asserted through the Electron bridge, because
 * boot is the one page whose inputs are the bridge itself: `getAuthState` for
 * the session and `apiRequest` (over IPC) for the two endpoints.
 *
 * `fetch` is a never-resolving tripwire: nothing here may touch the network
 * (`connect-src 'none'` in the packaged renderer).
 */

const apiRequest = vi.hoisted(() => vi.fn());
const getAuthState = vi.hoisted(() => vi.fn());
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));

const SEGMENT = "acme-ab12cd";

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function unauthorized(): BridgeResponse {
  return {
    status: 401,
    statusText: "Unauthorized",
    hasBody: true,
    body: { error: { code: "UNAUTHORIZED", message: "Not signed in" } },
  };
}

function bridgeFor(isOnboarded: boolean) {
  return (path: string): Promise<BridgeResponse> => {
    if (path === "/api/user/onboarding-state") {
      return Promise.resolve(ok({ isOnboarded }));
    }
    if (path === "/api/workspaces/ensure-default") {
      return Promise.resolve(
        ok({ workspace: { id: "w1", slug: "acme", publicId: "ab12cd" }, segment: SEGMENT })
      );
    }
    return Promise.reject(new Error(`unexpected request: ${path}`));
  };
}

function renderBoot() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <BootPage /> },
      { path: "/onboarding", element: <div>ONBOARDING ROUTE</div> },
      { path: "/:workspaceSegment", element: <div>WORKSPACE ROUTE</div> },
    ],
    { initialEntries: ["/"] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("boot page", () => {
  beforeEach(() => {
    getAuthState.mockResolvedValue({ signedIn: true, userId: "user-1" });
    apiRequest.mockImplementation((path: string) => bridgeFor(true)(path));
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: {
        apiRequest,
        getAuthState,
        openExternal,
        appOrigin: "https://www.usedopl.com",
      },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("signed out → the signed-out screen, which opens sign-in externally", async () => {
    getAuthState.mockResolvedValue({ signedIn: false, userId: null });

    renderBoot();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(openExternal).toHaveBeenCalledWith(
      "https://www.usedopl.com/auth/desktop-start"
    );
    // Boot must not read anything for a signed-out caller.
    expect(apiRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("signed in but not onboarded → /onboarding", async () => {
    apiRequest.mockImplementation((path: string) => bridgeFor(false)(path));

    renderBoot();

    expect(await screen.findByText("ONBOARDING ROUTE")).toBeInTheDocument();
    const paths = apiRequest.mock.calls.map((c) => (c as unknown[])[0]);
    expect(paths).toContain("/api/user/onboarding-state");
    // The workspace is not provisioned until onboarding completes.
    expect(paths).not.toContain("/api/workspaces/ensure-default");
  });

  it("signed in and onboarded → ensure-default, then the workspace route (G2)", async () => {
    renderBoot();

    expect(await screen.findByText("WORKSPACE ROUTE")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        apiRequest.mock.calls.some(
          (c) =>
            (c as unknown[])[0] === "/api/workspaces/ensure-default" &&
            ((c as unknown[])[1] as { method?: string } | undefined)?.method === "POST"
        )
      ).toBe(true)
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a 401 from the API falls back to the signed-out screen", async () => {
    apiRequest.mockResolvedValue(unauthorized());

    renderBoot();

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
