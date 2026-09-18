import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout, canonicalPath } from "./index";

/**
 * Shell smoke test: sidebar nav renders off `/api/workspaces`, the
 * stale-segment rewrite lands on the canonical URL, and the guidance + notice
 * layer is mounted and wired to the SPA router.
 *
 * ⚠ TWO transports stubbed because the shell reads over both: `#/lib/api-
 * transport` and the WEB `apiRequest` via `window.dopl`. Both funnel into the
 * same bridge in the packaged app.
 */

const { sendRequest } = vi.hoisted(() => ({ sendRequest: vi.fn() }));
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

const bridgeRequest = vi.hoisted(() => vi.fn());

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

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

function mockApi() {
  sendRequest.mockImplementation(
    ({ path, body }: { path: string; body?: unknown }) => {
      // ONE read for the shell: segment resolve + role + id + access matrix.
      if (path === "/api/boot") {
        const segment = (body as { segment?: string } | undefined)?.segment;
        return Promise.resolve(
          ok({
            isOnboarded: true,
            surveyCompleted: true,
            userId: "user-1",
            workspace: WORKSPACE,
            segment: "acme-ab12cd",
            needsRedirect: segment === "acme",
            role: "owner",
            myAccess: { defaultLevel: "edit", overrides: [] },
          })
        );
      }
      if (path === "/api/workspaces") {
        return Promise.resolve(ok({ workspaces: [{ ...WORKSPACE, role: "owner" }] }));
      }
      return Promise.resolve(ok({}));
    }
  );
}

/**
 * Web-side reads.
 *
 * 🔴 **`/api/me/join-requests`, ITS `/ack` AND `/api/onboarding/mcp-status` ARE
 * NOT ANSWERED HERE (Samuel's ruling R-49, 2026-09-17)** — the shell no longer
 * reads them, and the fall-through below REJECTS an unexpected path, so a
 * re-mounted notice layer fails this file loudly instead of quietly polling.
 */
function mockBridge() {
  bridgeRequest.mockImplementation((path: string) => {
    if (path === "/api/channels/consent") return Promise.resolve(ok({ requests: [] }));
    if (path.endsWith("/my-access")) {
      return Promise.resolve(ok({ defaultLevel: "edit", overrides: [] }));
    }
    return Promise.reject(new Error(`unexpected bridge request: ${path}`));
  });
  Object.defineProperty(window, "dopl", {
    configurable: true,
    writable: true,
    value: { apiRequest: bridgeRequest },
  });
}

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [
          { path: "overview", element: <p>page body</p> },
          // Tour step 1's destination; the router needs it to exist.
          { path: "ontology", element: <p>ontology body</p> },
          // R-05's pair: one PAGE with a record route under it.
          { path: "knowledge", element: <p>knowledge body</p> },
          { path: "knowledge/:kbSlug", element: <p>knowledge record</p> },
        ],
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

describe("app shell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockApi();
    mockBridge();
    // Nothing may reach the network directly (`connect-src 'none'`).
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("renders the section nav and the workspace switcher for the routed workspace", async () => {
    renderShell("/acme-ab12cd/overview");

    expect(await screen.findByText("page body")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/knowledge"
    );
    expect(screen.getByRole("link", { name: "Channels" })).toHaveAttribute(
      "href",
      "/acme-ab12cd/channels"
    );
    // Brand pill names the open workspace; switching lives in its popover.
    // `expanded` pins the query to the popup trigger — the account rail's
    // workspace tile carries the same accessible name but no aria-expanded.
    expect(
      screen.getByRole("button", { name: /Acme/, expanded: false })
    ).toBeInTheDocument();
    // The account rail: Home pinned above this account's workspace tiles.
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  // ⚠ `GET /api/workspaces` is UNFILTERED and now answers with the account
  // surface's `kind='link'` CONTAINERS — one per relationship, and the caller is
  // a member of every one. A rail that showed them would list plumbing.
  it("keeps link containers out of the rail and the switcher", async () => {
    const inner = sendRequest.getMockImplementation()!;
    sendRequest.mockImplementation((req: { path: string; body?: unknown }) =>
      req.path === "/api/workspaces"
        ? Promise.resolve(
            ok({
              workspaces: [
                { ...WORKSPACE, role: "owner" },
                {
                  ...WORKSPACE,
                  id: "ws-link-1",
                  name: "Priya Shah",
                  slug: "link-priya",
                  publicId: "aa11bb",
                  kind: "link",
                  role: "member",
                },
              ],
            })
          )
        : inner(req)
    );

    renderShell("/acme-ab12cd/overview");

    await screen.findByText("page body");
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Priya Shah" })
    ).not.toBeInTheDocument();
  });

  /**
   * 🔒 R-05 (Samuel, 2026-09-17) — option (a), against 03 §C2's recommended (b):
   * the shell crossfades on PAGE SWITCHES too, not only on a page's own record
   * pick. Same component, same 150ms, same reduced-motion rule; one call site.
   *
   * ⚠ THE SECOND CASE IS THE ONE WITH TEETH. A token cut from the whole path
   * would fade on every channel click and every knowledge-base click — over the
   * fade those pages already run themselves — and the first case alone cannot
   * see that.
   */
  const fade = () => document.querySelector(".crossfade")!;

  it("crossfades when the PAGE changes", async () => {
    const router = renderShell("/acme-ab12cd/overview");

    await screen.findByText("page body");
    expect(fade().hasAttribute("data-out")).toBe(false);

    await act(async () => {
      await router.navigate("/acme-ab12cd/ontology");
    });
    expect(fade().hasAttribute("data-out")).toBe(true);
    expect(fade().getAttribute("aria-busy")).toBe("true");

    // And it lands: the surface is not left dimmed.
    await waitFor(() => expect(fade().hasAttribute("data-out")).toBe(false));
  });

  it("does NOT fade when one page picks a record", async () => {
    const router = renderShell("/acme-ab12cd/knowledge");

    await screen.findByText("knowledge body");
    await act(async () => {
      await router.navigate("/acme-ab12cd/knowledge/kb-1");
    });

    expect(await screen.findByText("knowledge record")).toBeInTheDocument();
    expect(fade().hasAttribute("data-out")).toBe(false);
  });

  it("does NOT fade when only the query string moves", async () => {
    // A page's own filter/tab state rides the search params. The token is cut
    // from `pathname`, so this cannot fire — pinned because a token cut from
    // `location.key` or from the full URL would blink the surface on every
    // filter press.
    const router = renderShell("/acme-ab12cd/overview");

    await screen.findByText("page body");
    await act(async () => {
      await router.navigate("/acme-ab12cd/overview?tab=agents");
    });

    expect(fade().hasAttribute("data-out")).toBe(false);
  });

  it("rewrites a stale segment to the canonical one, keeping the page", async () => {
    const router = renderShell("/acme/overview");

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/acme-ab12cd/overview")
    );
    // ⚠ Regression tripwire: the redirect key-switch once stranded the
    // canonical resolve at pending+idle.
    expect(await screen.findByText("page body")).toBeInTheDocument();
  });

  it("keeps the deeper path when rewriting the segment", () => {
    expect(canonicalPath("/old-slug/skills/x", "acme-ab12cd")).toBe(
      "/acme-ab12cd/skills/x"
    );
  });

  /**
   * 🔒 **THE GUIDANCE LAYER IS DELETED, AND THE ABSENCE IS THE RULING**
   * (Samuel, R-49, 2026-09-17): the tour, the join-request notices, the
   * connect-agent banner and the welcome popup were all mounted here. Five
   * cases stood in their place and went with them.
   *
   * ⚠ **THIS IS AN ABSENCE TEST — DELETING IT DELETES THE RULING** (04
   * §F-5a). A wave that re-adds one of the four surfaces has to come through
   * here, which is the point; the fix is Samuel's word, not a green edit.
   */
  it("mounts NO guidance layer — no tour, notice, banner or welcome popup", async () => {
    // The welcome popup read this flag; onboarding no longer writes it, and
    // setting it must now do nothing at all.
    window.localStorage.setItem("dopl:welcome", "1");
    renderShell("/acme-ab12cd/overview");
    expect(await screen.findByText("page body")).toBeInTheDocument();

    expect(screen.queryByText("Welcome to Dopl!")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Product tour" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to workspace" })).toBeNull();
    expect(
      screen.queryByText("Connect your AI agent to build out your workspace")
    ).toBeNull();

    // ⚠ AND NOTHING IS READ FOR THEM. `mockBridge` rejects an unexpected path,
    // so a surviving poll would already have thrown — this states the rule the
    // rejection enforces.
    const asked = bridgeRequest.mock.calls.map((c: unknown[]) => c[0]);
    expect(asked).not.toContain("/api/me/join-requests");
    expect(asked).not.toContain("/api/onboarding/mcp-status");
  });
});
