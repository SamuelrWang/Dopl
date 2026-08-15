import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { TransportRequest } from "#/lib/api-transport";
import { SEGMENT, WORKSPACE, WORKSPACE_ID, bootBody, ok } from "#/test-utils/bridge";
import { useWorkspaceRoute } from "./use-workspace-route";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * The launch round-trip collapse, pinned at the seam that produces it.
 *
 * `POST /api/boot` answers `onboarding-state` + `ensure-default` + `resolve` +
 * `me` together, and `seedBootAnswer` writes that one response into the cache
 * entries of the endpoints it replaced. ⚠ BOTH halves are asserted: an endpoint
 * that answers everything but seeds nothing leaves the old callers (chats page,
 * settings modal, `MyAccessProvider`) issuing their requests anyway.
 */

const sendRequest = vi.hoisted(() => vi.fn());
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

const calls = () =>
  sendRequest.mock.calls.map((args) => (args as unknown[])[0] as TransportRequest);

/** Renders the hook pair every ported page reads through. */
function Probe() {
  const route = useWorkspaceRoute();
  const { access, isPending } = useWorkspaceAccess();
  if (isPending) return <p>loading</p>;
  return (
    <div>
      <p data-testid="segment">{route.segment}</p>
      <p data-testid="role">{access?.role ?? "-"}</p>
      <p data-testid="user">{access?.currentUserId ?? "-"}</p>
      <p data-testid="admin">{String(access?.isAdmin)}</p>
    </div>
  );
}

function renderAt(path: string) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(
    [{ path: "/:workspaceSegment", element: <Probe /> }],
    { initialEntries: [path] }
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return queryClient;
}

beforeEach(() => {
  sendRequest.mockReset();
  sendRequest.mockImplementation(({ path, body }: TransportRequest) => {
    if (path === "/api/boot") {
      const segment = (body as { segment?: string } | undefined)?.segment;
      return Promise.resolve(
        ok(bootBody({ needsRedirect: segment !== SEGMENT, role: "member" }))
      );
    }
    return Promise.resolve(ok({}));
  });
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

describe("useWorkspaceRoute — one read for the whole boot", () => {
  it("resolves the segment AND the caller's identity from a single request", async () => {
    renderAt(`/${SEGMENT}`);

    expect(await screen.findByTestId("role")).toHaveTextContent("member");
    expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    expect(screen.getByTestId("admin")).toHaveTextContent("false");

    const paths = calls().map((c) => c.path);
    expect(paths).toEqual(["/api/boot"]);
    // The two hops it replaced are gone from the wire entirely.
    expect(paths).not.toContain("/api/workspaces/resolve");
    expect(paths).not.toContain("/api/workspaces/me");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the segment in the body, not the query string", async () => {
    renderAt(`/${SEGMENT}`);
    await screen.findByTestId("role");

    expect(calls()[0]).toMatchObject({
      path: "/api/boot",
      method: "POST",
      body: { segment: SEGMENT },
    });
  });

  it("seeds resolve / me / my-access so the callers that still read them never fetch", async () => {
    const queryClient = renderAt(`/${SEGMENT}`);
    await screen.findByTestId("role");

    await waitFor(() =>
      expect(
        queryClient.getQueryData(["/api/workspaces/resolve", undefined, { segment: SEGMENT }])
      ).toEqual({ workspace: WORKSPACE, canonical: SEGMENT, needsRedirect: false })
    );
    expect(
      queryClient.getQueryData(["/api/workspaces/me", WORKSPACE_ID, undefined])
    ).toEqual({ role: "member", userId: "user-1" });
    expect(
      queryClient.getQueryData([`/api/workspaces/${SEGMENT}/my-access`, undefined, undefined])
    ).toEqual({ defaultLevel: "edit", overrides: [] });
    // Onboarding page shares boot's answer rather than re-asking.
    expect(
      queryClient.getQueryData(["/api/user/onboarding-state", undefined, undefined])
    ).toEqual({ isOnboarded: true, surveyCompleted: true });
  });

  it("a stale segment answers for BOTH urls, so the rewrite costs no second read", async () => {
    const queryClient = renderAt("/acme");
    await screen.findByTestId("role");

    // Canonical key warm BEFORE the shell replaces the URL — the web 301's
    // property, where one response serves both paths.
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["/api/boot", undefined, { segment: SEGMENT }])
      ).toMatchObject({ segment: SEGMENT, needsRedirect: false })
    );
    expect(calls().map((c) => c.path)).toEqual(["/api/boot"]);
  });

  it("falls back to the me hop only when the answer carries no identity", async () => {
    sendRequest.mockImplementation(({ path }: TransportRequest) => {
      if (path === "/api/boot") {
        return Promise.resolve(ok(bootBody({ role: null })));
      }
      if (path === "/api/workspaces/me") {
        return Promise.resolve(ok({ role: "viewer", userId: "user-9" }));
      }
      return Promise.resolve(ok({}));
    });

    renderAt(`/${SEGMENT}`);

    expect(await screen.findByTestId("role")).toHaveTextContent("viewer");
    expect(calls().map((c) => c.path)).toContain("/api/workspaces/me");
  });
});
