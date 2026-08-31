import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout } from "./index";

/**
 * 🔒 A GUEST AT A WORKSPACE URL LANDS ON THEIR CHANNEL (Samuel's ruling,
 * 2026-08-30 — ledger ASK-2, option b).
 *
 * WHAT THIS REPLACES. `segment.ts › BOOT_MIN_ROLE` is `"guest"` on purpose, and
 * `AppShellLayout` added no floor of its own — so a guest reaching
 * `/{linkContainerSegment}` got the shell in full (nav, upsell card, gear,
 * switcher, providers, banners) and then every routed page 403'd at the `viewer`
 * default: fully painted chrome around a stack of `PageError` cards. Nothing
 * links a guest there, so it was never a leak; it was URL-reachable.
 *
 * ⚠ THE FLOOR IS NOT THE FIX AND THIS FILE PINS THAT TOO. Raising
 * `BOOT_MIN_ROLE` to `viewer` would 404 the two pop-out windows, which live
 * OUTSIDE this layout and pay the boot read themselves. The redirect is at the
 * SHELL layer for exactly that reason.
 *
 * ⚠ THE CONTAINER HAS ONE CHANNEL AND IT IS RESOLVED THE WAY THE GUEST WEB LANE
 * RESOLVES IT — `/c/{workspaceId}` calls `getHomeChannel(user, workspaceId)`;
 * the renderer's twin is `GET /api/home/channels` matched on `workspaceId`. The
 * "wrong container" case below is what makes that match load-bearing rather than
 * "take the first row".
 *
 * ⚠ MUTATION-VERIFY — MEASURED 2026-08-30, 6 tests baseline, 5 reverts:
 *   - the effect never navigates ................................. 4 red
 *   - `isGuest` widened to "any known role" (the gate dropped) .... 1 red
 *   - `channels[0]` instead of matching `workspaceId` ............. 1 red
 *   - `navigate(target)` instead of `{ replace: true }` ........... 1 red
 *   - `?? []` dropped from the `select` .......................... **0 red**,
 *     and that is recorded rather than papered over. A throwing `select` puts
 *     the query in an ERROR state, which lands on the same `/home` the absent
 *     channel does — so no assertion here can tell them apart. The guard stays
 *     (INVARIANTS §8: this payload is IndexedDB-persisted) and the stale case
 *     stays, because "a stale entry lands somewhere sane" is worth pinning even
 *     where only one route to it is. **Do not read that case as covering §8.**
 *
 * ⚠ THE OWNER CASE ASSERTS AN UNASKED QUESTION, not just a pathname — see its
 * own comment. The pathname half alone stayed green under the dropped gate.
 */

const { sendRequest } = vi.hoisted(() => ({ sendRequest: vi.fn() }));
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

const bridgeRequest = vi.hoisted(() => vi.fn());

/** The `kind='link'` CONTAINER a guest is a member of. */
const CONTAINER = {
  id: "ws-link-1",
  ownerId: "user-host",
  name: "Priya Shah",
  slug: "link-priya",
  publicId: "aa11bb",
  kind: "link",
  description: null,
  iconUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const SEGMENT = "link-priya-aa11bb";
const CHANNEL_ID = "7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90";

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** One home-channel row, as `GET /api/home/channels` serialises it. */
function homeChannel(over: Record<string, unknown> = {}) {
  return {
    workspaceId: CONTAINER.id,
    workspaceSegment: SEGMENT,
    channelId: CHANNEL_ID,
    name: "Priya Shah",
    peers: [],
    peer: null,
    createdAt: "2026-01-01T00:00:00Z",
    lastMessageAt: null,
    lastMessagePreview: null,
    linkOut: null,
    ...over,
  };
}

/** `role` and the home-channels payload are what each case varies. */
let role = "guest";
let homePayload: unknown = { channels: [homeChannel()], pendingLinks: [] };

function mockApi() {
  sendRequest.mockImplementation(({ path }: { path: string }) => {
    if (path === "/api/boot") {
      return Promise.resolve(
        ok({
          isOnboarded: true,
          surveyCompleted: true,
          userId: "user-guest",
          workspace: CONTAINER,
          segment: SEGMENT,
          needsRedirect: false,
          role,
          myAccess: { defaultLevel: null, overrides: [] },
        })
      );
    }
    if (path === "/api/home/channels") return Promise.resolve(ok(homePayload));
    if (path === "/api/workspaces") return Promise.resolve(ok({ workspaces: [] }));
    return Promise.resolve(ok({}));
  });
}

function mockBridge() {
  bridgeRequest.mockImplementation((path: string) => {
    if (path === "/api/me/join-requests") return Promise.resolve(ok({ notices: [] }));
    if (path === "/api/onboarding/mcp-status") {
      return Promise.resolve(ok({ connected: true }));
    }
    if (path.endsWith("/my-access")) {
      return Promise.resolve(ok({ defaultLevel: null, overrides: [] }));
    }
    return Promise.resolve(ok({}));
  });
  Object.defineProperty(window, "dopl", {
    configurable: true,
    writable: true,
    value: { apiRequest: bridgeRequest },
  });
}

/** The shell over the routes a guest can be bounced BETWEEN. */
function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/home", element: <p>account home</p> },
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [
          { path: "overview", element: <p>overview body</p> },
          { path: "channels/:channelId", element: <p>channel body</p> },
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

describe("the shell sends a guest to their channel", () => {
  beforeEach(() => {
    role = "guest";
    homePayload = { channels: [homeChannel()], pendingLinks: [] };
    window.localStorage.clear();
    // ⚠ `mockImplementation` does NOT reset the call log, and the last case
    // asserts on an ABSENT call — without this it reads the previous case's.
    sendRequest.mockClear();
    mockApi();
    mockBridge();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  it("redirects off the workspace page onto the container's one channel", async () => {
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`)
    );
    expect(await screen.findByText("channel body")).toBeTruthy();
    // REPLACE, not push: Back must not bounce them into the loop.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("stays put once it is ON the channel — no redirect loop", async () => {
    const router = renderShell(`/${SEGMENT}/channels/${CHANNEL_ID}`);

    expect(await screen.findByText("channel body")).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`);
  });

  it("falls back to /home when the container has no channel for them", async () => {
    // ⚠ NOT A THIRD ERROR CARD. `/home` is the guest's own surface; a workspace
    // URL is never where a guest belongs, whatever the read answered.
    homePayload = { channels: [], pendingLinks: [] };
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
    expect(await screen.findByText("account home")).toBeTruthy();
  });

  it("matches on the CONTAINER, never on the first row", async () => {
    // A guest holds several relationships. Taking `channels[0]` would send them
    // into somebody else's container — and it would look right in every
    // single-row test.
    homePayload = {
      channels: [
        homeChannel({ workspaceId: "ws-other", channelId: "not-this-one" }),
        homeChannel(),
      ],
      pendingLinks: [],
    };
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`)
    );
  });

  it("survives a STALE cached payload with no `channels` key (§8)", async () => {
    // The entry is IndexedDB-persisted; a `.find` on an absent key throws INSIDE
    // the shell, which blanks every page rather than one pane.
    homePayload = { pendingLinks: [] };
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
  });

  it("leaves a non-guest where they are, and never even ASKS", async () => {
    // ⚠ THE UNASKED QUESTION IS THE ASSERTION. "Still on /overview" alone is
    // VACUOUS here: the redirect needs a round trip, and the render assertion
    // resolves before it lands — measured, a dropped `isGuest` gate keeps that
    // half green. `enabled: isGuest` is what makes the read cost nothing on
    // every workspace page for every member of every workspace, and the request
    // log is the only place that shows.
    role = "owner";
    const router = renderShell(`/${SEGMENT}/overview`);

    expect(await screen.findByText("overview body")).toBeTruthy();
    // Let anything the shell was going to fetch actually fetch.
    await waitFor(() =>
      expect(sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/workspaces" })
      )
    );
    expect(
      sendRequest.mock.calls.some(
        (c: unknown[]) => (c[0] as { path?: string })?.path === "/api/home/channels"
      )
    ).toBe(false);
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/overview`);
  });
});
