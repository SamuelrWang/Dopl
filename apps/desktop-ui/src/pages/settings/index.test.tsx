import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import SettingsPage from "./index";

/**
 * Smoke test for the ported settings page.
 *
 * Mocked at `window.dopl.apiRequest` — the Electron bridge — because this page
 * reads over BOTH clients: the seam (`useWorkspaceRoute`, `useApiQuery`) uses
 * the SPA transport while every reused section (trash, connected apps, and the
 * two workspace cores) uses the WEB `apiRequest`. Both land on the same bridge
 * in the packaged app.
 *
 * `fetch` is a never-resolving tripwire: nothing here may touch the network
 * directly (`connect-src 'none'` in the packaged renderer). The section that
 * used to — `connected-apps-section`'s revoke — was moved onto `apiRequest` by
 * this slice, and the last assertion is what holds that.
 */

const apiRequest = vi.hoisted(() => vi.fn());

const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";
const SEGMENT = "acme-ab12cd";

const WORKSPACE = {
  id: WORKSPACE_ID,
  ownerId: "user-1",
  name: "Acme",
  slug: "acme",
  publicId: "ab12cd",
  description: "The workspace",
  iconUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const GRANTS = [
  {
    id: "grant-1",
    client_name: "Claude Code",
    scopes: ["dopl.write"],
    last_used_at: null,
    created_at: "2026-07-01T00:00:00Z",
  },
];

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** Routes every path this page reads; anything else fails the test loudly. */
function defaultBridge(path: string, role = "owner"): Promise<BridgeResponse> {
  if (path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(
      ok({ workspace: WORKSPACE, canonical: SEGMENT, needsRedirect: false })
    );
  }
  if (path === `/api/workspaces/${SEGMENT}`) {
    return Promise.resolve(ok({ workspace: WORKSPACE, role }));
  }
  if (path === "/api/oauth/grants") return Promise.resolve(ok({ grants: GRANTS }));
  if (path.startsWith(`/api/workspaces/${WORKSPACE.slug}/trash`)) {
    return Promise.resolve(ok({ items: [] }));
  }
  if (path === "/api/workspaces") {
    return Promise.resolve(ok({ workspaces: [WORKSPACE] }));
  }
  return Promise.reject(new Error(`unexpected request: ${path}`));
}

const calls = () =>
  apiRequest.mock.calls.map((args) => ({
    path: (args as unknown[])[0] as string,
    opts: ((args as unknown[])[1] ?? {}) as BridgeRequestOpts,
  }));

function renderPage() {
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment/settings", element: <SettingsPage /> }],
    { initialEntries: [`/${SEGMENT}/settings`] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("settings page", () => {
  beforeEach(() => {
    apiRequest.mockImplementation((path: string) => defaultBridge(path));
    Object.defineProperty(window, "dopl", {
      configurable: true,
      writable: true,
      value: { apiRequest },
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("renders the workspace header and every section off the bridge", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("/acme")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme")).toBeInTheDocument();
    expect(screen.getByText("Connect & log in")).toBeInTheDocument();
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();

    const paths = calls().map((c) => c.path);
    expect(paths).toContain(`/api/workspaces/resolve?segment=${SEGMENT}`);
    expect(paths).toContain(`/api/workspaces/${SEGMENT}`);
    expect(paths).toContain("/api/oauth/grants");
    expect(paths).toContain(`/api/workspaces/${WORKSPACE.slug}/trash`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("saves the workspace with a PATCH over the bridge", async () => {
    renderPage();

    const input = await screen.findByDisplayValue("Acme");
    fireEvent.change(input, { target: { value: "Acme Rebranded" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === `/api/workspaces/${SEGMENT}` && c.opts.method === "PATCH"
        )
      ).toBe(true)
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes a connected app over the bridge, never fetch", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(
        calls().some(
          (c) => c.path === "/api/oauth/grants/grant-1" && c.opts.method === "DELETE"
        )
      ).toBe(true)
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the danger zone to owners only", async () => {
    renderPage();
    expect(await screen.findByText("Danger zone")).toBeInTheDocument();
  });

  it("hides the danger zone from non-owners", async () => {
    apiRequest.mockImplementation((path: string) => defaultBridge(path, "admin"));
    renderPage();

    await screen.findByDisplayValue("Acme");
    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
  });

  it("surfaces a failed workspace read as the shared page error", async () => {
    apiRequest.mockImplementation((path: string) =>
      path === `/api/workspaces/${SEGMENT}`
        ? Promise.resolve({
            status: 404,
            statusText: "Not Found",
            hasBody: true,
            body: {
              error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" },
            },
          })
        : defaultBridge(path)
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found");
  });
});
