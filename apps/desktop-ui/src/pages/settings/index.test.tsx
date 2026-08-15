import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import {
  SEGMENT,
  WORKSPACE,
  bridgeCalls,
  installBridge,
  bootBody,
  ok,
  renderWithProviders,
  resolveBody,
} from "#/test-utils/bridge";
import SettingsPage from "./index";

/**
 * Settings page smoke test.
 *
 * Fixtures, bridge stub and harness come from `#/test-utils/bridge`: the
 * resolve/me wire shapes are declared once for every suite.
 *
 * ⚠ This page reads over BOTH clients — `useWorkspaceRoute`/`useApiQuery` via
 * the SPA transport, reused sections (connected apps, shared workspace-settings
 * body) via the WEB `apiRequest`. Both land on the same bridge when packaged.
 */

const apiRequest = vi.hoisted(() => vi.fn());

const GRANTS = [
  {
    id: "grant-1",
    client_name: "Claude Code",
    scopes: ["dopl.write"],
    last_used_at: null,
    created_at: "2026-07-01T00:00:00Z",
  },
];

/** Routes every path this page reads; anything else fails the test loudly. */
function defaultBridge(path: string, role = "owner"): Promise<BridgeResponse> {
  if (path === "/api/boot") return Promise.resolve(ok(bootBody({ role })));
  if (path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(ok(resolveBody()));
  }
  if (path === `/api/workspaces/${SEGMENT}`) {
    return Promise.resolve(ok({ workspace: WORKSPACE, role }));
  }
  if (path === "/api/oauth/grants") return Promise.resolve(ok({ grants: GRANTS }));
  if (path === "/api/workspaces") {
    return Promise.resolve(ok({ workspaces: [WORKSPACE] }));
  }
  return Promise.reject(new Error(`unexpected request: ${path}`));
}

const calls = () => bridgeCalls(apiRequest);

function renderPage() {
  return renderWithProviders(
    [{ path: "/:workspaceSegment/settings", element: <SettingsPage /> }],
    [`/${SEGMENT}/settings`]
  );
}

describe("settings page", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => defaultBridge(path));
    installBridge({ apiRequest });
  });

  it("renders the workspace header and every section off the bridge", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("/acme")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme")).toBeInTheDocument();
    expect(screen.getByText("Connect & log in")).toBeInTheDocument();
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();

    const paths = calls().map((c) => c.path);
    expect(paths).toContain("/api/boot");
    expect(paths).toContain(`/api/workspaces/${SEGMENT}`);
    expect(paths).toContain("/api/oauth/grants");
    expect(fetch).not.toHaveBeenCalled();
  });

  // ⚠ Trash is gone app-wide. Only the ENDPOINT half is asserted: a re-imported
  // section fails tsc, but a stray `/trash` read is a runtime-only regression
  // nothing else catches — this pins that the bridge stub's unknown-path
  // rejection is never even reached.
  it("never reads the trash endpoint", async () => {
    renderPage();

    await screen.findByDisplayValue("Acme");
    expect(calls().some((c) => c.path.includes("/trash"))).toBe(false);
    expect(calls().length).toBeGreaterThan(0);
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
