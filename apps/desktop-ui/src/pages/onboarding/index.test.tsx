import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import OnboardingPage from "./index";

/**
 * Smoke test for the ported /onboarding flow.
 *
 * The data layer is stubbed at `window.dopl.apiRequest` — the Electron bridge —
 * because the page's own gate reads through the SPA client while every step of
 * the reused `OnboardingFlowCore` (survey POST, MCP status poll, complete POST)
 * reads through the WEB `apiRequest`. Both funnel into the same bridge in the
 * packaged app, so stubbing it exercises the real path once. `fetch` is a
 * never-resolving tripwire — the flow used to call it directly, and the
 * packaged renderer ships `connect-src 'none'`.
 *
 * `AuthSplitLayout` is mocked: its crystal panel instantiates a canvas 2D
 * context, which jsdom does not provide (the engine throws by design).
 */

vi.mock("@/shared/layout/auth-split", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-split">{children}</div>
  ),
}));

const apiRequest = vi.hoisted(() => vi.fn());

const SEGMENT = "acme-ab12cd";

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function bridge(isOnboarded: boolean) {
  return (path: string): Promise<BridgeResponse> => {
    if (path === "/api/user/onboarding-state") {
      return Promise.resolve(ok({ isOnboarded }));
    }
    if (path === "/api/onboarding/mcp-status") {
      return Promise.resolve(ok({ connected: true }));
    }
    if (path === "/api/onboarding/survey") return Promise.resolve(ok({ ok: true }));
    if (path === "/api/onboarding/complete") {
      return Promise.resolve(ok({ redirectTo: `/${SEGMENT}/overview` }));
    }
    return Promise.reject(new Error(`unexpected request: ${path}`));
  };
}

const calls = () =>
  apiRequest.mock.calls.map((args) => ({
    path: (args as unknown[])[0] as string,
    opts: ((args as unknown[])[1] ?? {}) as { method?: string; body?: unknown },
  }));

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/onboarding", element: <OnboardingPage /> },
      { path: "/", element: <div>BOOT ROUTE</div> },
      { path: "/:workspaceSegment/overview", element: <div>OVERVIEW ROUTE</div> },
    ],
    { initialEntries: ["/onboarding"] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("onboarding page", () => {
  beforeEach(() => {
    apiRequest.mockImplementation((path: string) => bridge(false)(path));
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest, appOrigin: "https://www.usedopl.com" },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("renders the survey and submits it over the bridge", async () => {
    renderPage();

    expect(await screen.findByText("About You")).toBeInTheDocument();

    // The Continue button is gated on at least one descriptor.
    fireEvent.click(screen.getByRole("button", { name: "Engineering" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === "/api/onboarding/survey" && c.opts.method === "POST"
        )
      ).toBe(true)
    );
    const survey = calls().find((c) => c.path === "/api/onboarding/survey");
    expect(survey?.opts.body).toMatchObject({
      entityType: "team",
      descriptors: ["engineering"],
      size: "2-10",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("advances to the MCP connect step and reports the polled status", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Engineering" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Connect Your Agent")).toBeInTheDocument();
    // The MCP URL is built from the bridge's appOrigin, never window.location
    // (which is a file:// document in the packaged app).
    expect(
      await screen.findByText("https://www.usedopl.com/api/mcp")
    ).toBeInTheDocument();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("names the workspace, completes, and lands on the returned path", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Engineering" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Connected");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const nameField = await screen.findByLabelText("Name");
    fireEvent.change(nameField, { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByText("OVERVIEW ROUTE")).toBeInTheDocument();
    const complete = calls().find((c) => c.path === "/api/onboarding/complete");
    expect(complete?.opts.method).toBe("POST");
    expect(complete?.opts.body).toMatchObject({ mcpConnected: true, name: "Acme" });
    expect(window.localStorage.getItem("dopl:welcome")).toBe("1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounces an already-onboarded caller back to boot", async () => {
    apiRequest.mockImplementation((path: string) => bridge(true)(path));

    renderPage();

    expect(await screen.findByText("BOOT ROUTE")).toBeInTheDocument();
  });
});
