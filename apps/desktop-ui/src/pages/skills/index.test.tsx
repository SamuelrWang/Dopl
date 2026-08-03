import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { TransportRequest } from "#/lib/api-transport";
import SkillsPage from "./index";

/**
 * Smoke test for the ported skills index. The DATA LAYER is mocked at the
 * transport (`#/lib/api-transport`) — the one seam below which nothing in the
 * renderer is supposed to reach — so everything above it is the shipped code:
 * `useApiQuery`, `apiRequest`'s envelope decoding, and the reused web
 * component tree (`SkillsBrowserCore` → `SkillRow` → `DetailPane`).
 *
 * `@/shared/supabase/browser` is stubbed because the reused editor mounts
 * realtime + presence, which construct a Supabase browser client from
 * `process.env.NEXT_PUBLIC_*` — absent under Vite. That stub is standing on a
 * real gap, not a test convenience; see the port report.
 */

vi.mock("@/shared/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
      track: () => Promise.resolve(),
      unsubscribe: () => Promise.resolve(),
    }),
    removeChannel: () => Promise.resolve(),
  }),
}));

const sendRequest = vi.hoisted(() => vi.fn());
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

/** The recorded transport calls, typed — `vi.fn()` widens its args to any[]. */
const transportCalls = () =>
  sendRequest.mock.calls.map((args) => (args as unknown[])[0] as TransportRequest);

const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";

function skill(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "skill-1",
    workspaceId: WORKSPACE_ID,
    ownerId: "user-1",
    name: "Draft outreach",
    slug: "draft-outreach",
    description: "Writes a cold email",
    whenToUse: "always",
    whenNotToUse: null,
    status: "active",
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
    agentWriteEnabled: true,
    folder: "Sales",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-08T00:00:00Z",
    ...over,
  };
}

const SKILLS = [
  skill(),
  skill({ id: "skill-2", name: "Summarize call", slug: "summarize-call", folder: null }),
];

function ok(body: unknown) {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** Routes every path this page reads; unknown paths fail loudly. */
function defaultTransport(req: TransportRequest) {
  if (req.path.startsWith("/api/workspaces/resolve")) {
    return Promise.resolve(
      ok({
        workspace: { id: WORKSPACE_ID, slug: "acme", publicId: "ab12cd" },
        canonical: "acme-ab12cd",
        needsRedirect: false,
      })
    );
  }
  if (req.path === "/api/workspaces/me") {
    return Promise.resolve(ok({ role: "admin", userId: "user-1" }));
  }
  if (req.path === "/api/skills") return Promise.resolve(ok({ skills: SKILLS }));
  return Promise.reject(new Error(`unexpected request: ${req.method} ${req.path}`));
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment/skills", element: <SkillsPage /> }],
    { initialEntries: ["/acme-ab12cd/skills"] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("skills index page", () => {
  beforeEach(() => {
    sendRequest.mockImplementation(defaultTransport);
    // The reused feature client (`@/features/skills/client/api`) still goes
    // through the WEB api-client, which calls `fetch` directly.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("resolves the workspace, then lists the workspace's skills", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("Draft outreach")).toBeInTheDocument();
    expect(screen.getByText("Summarize call")).toBeInTheDocument();
    // Grouped by folder, unfiled last.
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Unfiled")).toBeInTheDocument();

    const paths = transportCalls().map((req) => req.path);
    expect(paths).toContain("/api/workspaces/resolve?segment=acme-ab12cd");
    expect(paths).toContain("/api/workspaces/me");
    expect(paths).toContain("/api/skills");

    // Every workspace-scoped read carries the RESOLVED id, not the caller's
    // default workspace — the header the web DetailPane comment calls out.
    const skillsCall = transportCalls().find((req) => req.path === "/api/skills");
    expect(skillsCall?.workspaceId).toBe(WORKSPACE_ID);
  });

  it("filters the list by the search field", async () => {
    renderPage();
    await screen.findByText("Draft outreach");

    fireEvent.change(screen.getByPlaceholderText("Search skills"), {
      target: { value: "summar" },
    });

    expect(screen.queryByText("Draft outreach")).not.toBeInTheDocument();
    expect(screen.getByText("Summarize call")).toBeInTheDocument();
  });

  it("selecting a row pulls that skill's full body by slug", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Summarize call"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/skills/summarize-call",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({ "x-workspace-id": WORKSPACE_ID }),
        })
      );
    });
  });

  it("surfaces a failed workspace resolve as the shared page error", async () => {
    sendRequest.mockImplementation((req: TransportRequest) =>
      req.path.startsWith("/api/workspaces/resolve")
        ? Promise.resolve({
            status: 404,
            statusText: "Not Found",
            hasBody: true,
            body: { error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" } },
          })
        : defaultTransport(req)
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace not found");
  });
});
