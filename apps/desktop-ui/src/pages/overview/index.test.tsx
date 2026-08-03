import { render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import { AppShellLayout } from "#/components/app-shell";
import OverviewPage from "./index";

/**
 * Overview smoke test: the real page, inside the real shell, on the real query
 * stack — only the TRANSPORT is mocked (`#/lib/api-transport` is the one seam
 * bytes leave through), so the assertions cover the actual request paths the
 * port fires.
 */

const { sendRequest } = vi.hoisted(() => ({ sendRequest: vi.fn() }));
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

const WORKSPACE = {
  id: "ws-1",
  ownerId: "user-1",
  name: "Acme",
  slug: "acme",
  publicId: "ab12cd",
  description: null,
  iconUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const MEMBERS = [
  { userId: "user-1", displayName: "Ada", email: "ada@acme.test", avatarUrl: null },
  { userId: "user-2", displayName: "Grace", email: "grace@acme.test", avatarUrl: null },
];

function ok(body: unknown) {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function mockApi() {
  sendRequest.mockImplementation(({ path }: { path: string }) => {
    if (path.startsWith("/api/workspaces/resolve")) {
      return Promise.resolve(
        ok({ workspace: WORKSPACE, canonical: "acme-ab12cd", needsRedirect: false })
      );
    }
    if (path === "/api/workspaces") {
      return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
    }
    if (path === "/api/workspaces/acme-ab12cd/overview-counts") {
      return Promise.resolve(
        ok({
          workflows: 3,
          knowledgeBases: 7,
          skills: 11,
          members: 2,
          isMcpConnected: true,
        })
      );
    }
    if (path === "/api/workspaces/acme-ab12cd/members") {
      return Promise.resolve(ok({ members: MEMBERS }));
    }
    return Promise.resolve({ status: 404, statusText: "Not Found", hasBody: false });
  });
}

function renderOverview(path = "/acme-ab12cd/overview") {
  const router = createMemoryRouter(
    [
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [{ path: "overview", element: <OverviewPage /> }],
      },
    ],
    { initialEntries: [path] }
  );
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return router;
}

describe("overview page", () => {
  beforeEach(mockApi);

  it("renders the workspace header, counts and members off the API", async () => {
    renderOverview();

    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByText("/acme")).toBeInTheDocument();
    expect(await screen.findByText("Agent connected")).toBeInTheDocument();

    // The four stat cards are the overview-counts payload, each deep-linking
    // into its section on the SPA router.
    const skills = screen.getByRole("link", { name: /Skills 11 agent playbooks/ });
    expect(skills).toHaveAttribute("href", "/acme-ab12cd/skills");
    expect(within(skills).getByText("11")).toBeInTheDocument();

    expect(await screen.findByText("2 people in this workspace")).toBeInTheDocument();
  });

  it("reads counts and members through the canonical segment", async () => {
    renderOverview();
    await screen.findByRole("heading", { name: "Acme" });

    const paths = sendRequest.mock.calls.map(([req]) => req.path);
    expect(paths).toContain("/api/workspaces/resolve?segment=acme-ab12cd");
    expect(paths).toContain("/api/workspaces/acme-ab12cd/overview-counts");
    expect(paths).toContain("/api/workspaces/acme-ab12cd/members");
  });

  it("surfaces a failed workspace resolve as the shared page error", async () => {
    sendRequest.mockImplementation(({ path }: { path: string }) =>
      path.startsWith("/api/workspaces/resolve")
        ? Promise.resolve({
            status: 404,
            statusText: "Not Found",
            hasBody: true,
            body: { error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" } },
          })
        : Promise.resolve(ok({}))
    );
    renderOverview();

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found");
  });
});
