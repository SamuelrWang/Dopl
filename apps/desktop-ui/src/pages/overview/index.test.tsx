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
    // The page's workspace read is `POST /api/boot` now (P0-2) — the same
    // answer as resolve, plus the role/caller-id that used to cost a `me` hop.
    if (path === "/api/boot") {
      return Promise.resolve(
        ok({
          isOnboarded: true,
          surveyCompleted: true,
          userId: "user-1",
          workspace: WORKSPACE,
          segment: "acme-ab12cd",
          needsRedirect: false,
          role: "owner",
          myAccess: { defaultLevel: "edit", overrides: [] },
        })
      );
    }
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

    // ── THE STAT ROW, PINNED AS A SET ──────────────────────────────────
    // Assert the WHOLE row, never one card: the count went 4 → 3 with the
    // retirement and nothing failed, because only Skills was ever checked
    // and the "2 people in this workspace" line below is MembersWidgetCore
    // copy, not a card. Deleting "Knowledge bases" or "Members" must fail
    // HERE. The row doubles as navigation, so each href is a real route, and
    // the length check is what stops a fourth card linking to "Not found".
    const skills = screen.getByRole("link", { name: /Skills 11 agent playbooks/ });
    const statRow = skills.parentElement as HTMLElement;
    const cards = within(statRow).getAllByRole("link");
    expect(cards).toHaveLength(3);
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/acme-ab12cd/knowledge",
      "/acme-ab12cd/skills",
      "/acme-ab12cd/members",
    ]);
    // Counts come straight off overview-counts, in card order.
    expect(cards.map((card) => within(card).getByText(/^\d+$/).textContent)).toEqual([
      "7",
      "11",
      "2",
    ]);

    expect(await screen.findByText("2 people in this workspace")).toBeInTheDocument();
  });

  it("reads counts and members through the canonical segment", async () => {
    renderOverview();
    await screen.findByRole("heading", { name: "Acme" });

    const paths = sendRequest.mock.calls.map(([req]) => req.path);
    expect(paths).toContain("/api/boot");
    // The segment travels in the boot BODY, not the query string.
    expect(sendRequest.mock.calls.map(([req]) => req.body)).toContainEqual({
      segment: "acme-ab12cd",
    });
    // Deleted hop: the boot answer carries the caller's role and id.
    expect(paths).not.toContain("/api/workspaces/me");
    expect(paths).toContain("/api/workspaces/acme-ab12cd/overview-counts");
    expect(paths).toContain("/api/workspaces/acme-ab12cd/members");
  });

  it("surfaces a failed workspace resolve as the shared page error", async () => {
    sendRequest.mockImplementation(({ path }: { path: string }) =>
      path === "/api/boot"
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
