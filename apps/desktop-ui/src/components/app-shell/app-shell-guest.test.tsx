import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout } from "./index";

/**
 * 🔒 A MEMBER OF A HOME-CHANNEL CONTAINER AT A WORKSPACE URL LANDS ON THEIR
 * CHANNEL — the GUEST by Samuel's 2026-08-30 ruling (ledger ASK-2, option b),
 * every other member of the same container by R-01 option (a), 2026-09-17.
 *
 * ⚠ THE ROLE IS NOT THE FENCE ANY MORE AND THE OWNER CASE BELOW FLIPPED TO SAY
 * SO. A `kind='link'` container is a relationship: its member, admin and owner
 * were all getting the eight-row nav, the Members console, Skills, Chats and a
 * Settings page with an owner delete, on a URL nothing links to. The kind is
 * the fence, read through `isStandardWorkspace` (positive form, INVARIANTS §4A)
 * — so a STANDARD workspace is untouched, which is the last case here.
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
 * the renderer's twin is `GET /api/channels?scope=account` matched on
 * `workspaceId` (ONE endpoint since R-26 (b)). The
 * "wrong container" case below is what makes that match load-bearing rather than
 * "take the first row".
 *
 * ⚠ MUTATION-VERIFY — MEASURED 2026-08-30, 6 tests baseline, 5 reverts:
 *   - the effect never navigates ................................. 4 red
 *   - `isGuest` widened to "any known role" (the gate dropped) .... 1 red
 *   - `channels[0]` instead of matching `workspaceId` ............. 1 red
 *   - `navigate(target)` instead of `{ replace: true }` ........... 1 red
 *   ⚠ THE SECOND ROW IS NOW THE OTHER WAY UP (2026-09-17): the gate is the
 *   KIND. Re-measured:
 *   the gate narrowed back to `role === "guest"` ................. 3 red
 *   the ghost dropped over the redirect window .................... 1 red
 *   `!isStandardWorkspace` flipped to `kind === "link"` .......... 0 red,
 *   recorded rather than papered over — the union has no fourth kind to catch
 *   it with, which is why `check-role-drift.ts › checkWorkspaceKind` holds the
 *   positive form and not a test here.
 *   - `?? []` dropped from the `select` .......................... **0 red**,
 *     and that is recorded rather than papered over. A throwing `select` puts
 *     the query in an ERROR state, which lands on the same `/home` the absent
 *     channel does — so no assertion here can tell them apart. The guard stays
 *     (INVARIANTS §8: this payload is IndexedDB-persisted) and the stale case
 *     stays, because "a stale entry lands somewhere sane" is worth pinning even
 *     where only one route to it is. **Do not read that case as covering §8.**
 *
 * ⚠ THE STANDARD-WORKSPACE CASE ASSERTS AN UNASKED QUESTION, not just a
 * pathname — see its own comment. The pathname half alone stays green under a
 * dropped gate.
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

/** A real workspace, which the redirect must leave completely alone. */
const STANDARD = { ...CONTAINER, kind: "standard" };

function ok(body: unknown): BridgeResponse {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/**
 * One row of `GET /api/channels?scope=account` — the ONE projection (R-26 (b)).
 * ⚠ **THE FIELDS THIS SHELL ACTUALLY READS AND NOTHING ELSE** (`workspaceId` to
 * match the container, `id` to build the route): the redirect is not a renderer
 * of channels, and a full `Channel` here would be a second fixture drifting
 * beside `pages/home/home-test-harness.tsx`'s real one.
 */
function homeChannel(over: Record<string, unknown> = {}) {
  return {
    workspaceId: CONTAINER.id,
    container: { id: CONTAINER.id, kind: "link", segment: SEGMENT },
    id: CHANNEL_ID,
    name: "Priya Shah",
    peers: [],
    createdAt: "2026-01-01T00:00:00Z",
    lastMessageAt: null,
    unread: false,
    mentionCount: 0,
    linkOut: null,
    ...over,
  };
}

/** ⚠ The SCOPE is the one thing `path.split("?")[0]` throws away, and it is what
 *  picks the route's handler — see `pages/home/home-test-harness.tsx`. */
function isAccountChannels(path: string): boolean {
  const [bare, query = ""] = path.split("?");
  return (
    bare === "/api/channels" &&
    new URLSearchParams(query).get("scope") === "account"
  );
}

/** `role`, the CONTAINER KIND and the account-channels payload vary per case. */
let role = "guest";
let workspaceRow: unknown = CONTAINER;
let homePayload: unknown = { channels: [homeChannel()], pendingLinks: [] };

function mockApi() {
  sendRequest.mockImplementation(({ path }: { path: string }) => {
    if (path === "/api/boot") {
      return Promise.resolve(
        ok({
          isOnboarded: true,
          surveyCompleted: true,
          userId: "user-guest",
          workspace: workspaceRow,
          segment: SEGMENT,
          needsRedirect: false,
          role,
          myAccess: { defaultLevel: null, overrides: [] },
        })
      );
    }
    if (isAccountChannels(path)) return Promise.resolve(ok(homePayload));
    if (path === "/api/workspaces") return Promise.resolve(ok({ workspaces: [] }));
    return Promise.resolve(ok({}));
  });
}

function mockBridge() {
  bridgeRequest.mockImplementation((path: string) => {
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
const mounted: string[] = [];
function MembersProbe() {
  useEffect(() => {
    mounted.push("members");
  }, []);
  return <p>members body</p>;
}

function renderShell(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/home", element: <p>account home</p> },
      {
        path: "/:workspaceSegment",
        element: <AppShellLayout />,
        children: [
          { path: "overview", element: <p>overview body</p> },
          { path: "members", element: <MembersProbe /> },
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

describe("the shell sends a container member to their channel", () => {
  beforeEach(() => {
    mounted.length = 0;
    role = "guest";
    workspaceRow = CONTAINER;
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
        homeChannel({ workspaceId: "ws-other", id: "not-this-one" }),
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

  // 🔒 R-01(a), 2026-09-17: the container's OTHER members get the same answer
  // the guest does. Each of these three had the full shell — Members, Skills,
  // Chats, and a Settings page whose delete ends the relationship for everyone
  // in it — at a URL nothing links to.
  for (const containerRole of ["member", "admin", "owner"] as const) {
    it(`redirects the container's ${containerRole} too, not only the guest`, async () => {
      role = containerRole;
      const router = renderShell(`/${SEGMENT}/members`);

      await waitFor(() =>
        expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`)
      );
      expect(await screen.findByText("channel body")).toBeTruthy();
    });
  }

  /**
   * 🔒 R-13 (Samuel, 2026-09-17) — **AND IT IS DELETED, NOT HIDDEN.** ASK-2 left
   * the guest *"still wearing a nav they cannot use"*: the redirect leaves a
   * container member exactly one reachable shell route, so all eight rows, the
   * switcher and the settings gear pointed at pages that bounce straight back.
   * ⚠ `queryByRole("link")` is the assertion, not a class or a `hidden` prop —
   * a nav that renders and hides is the thing this forbids.
   */
  /**
   * 🔒 THE REDIRECT WINDOW IS PART OF THE RULING (wave 5 review, 2026-09-17).
   * The navigate is an EFFECT, so the render before it mounted the very page
   * R-01(a) refuses — measured: `/members` mounted, ran its own reads and 403'd
   * them, on every cold load for every container member. ⚠ A pathname assertion
   * CANNOT see this: the URL is already the channel by the time it is read. The
   * mount log is the only witness, and holding the shell ghost is the fix.
   */
  it("never paints the page it is about to leave", async () => {
    role = "member";
    const router = renderShell(`/${SEGMENT}/members`);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`)
    );
    expect(mounted).toEqual([]);
  });

  it("renders NO workspace nav for a container member", async () => {
    role = "member";
    renderShell(`/${SEGMENT}/overview`);

    expect(await screen.findByText("channel body")).toBeTruthy();
    for (const label of ["Overview", "Channels", "Members", "Skills", "Chats"]) {
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  it("keeps the nav for a standard workspace", async () => {
    // The other half, or the case above passes on a shell that never renders a
    // nav for anybody.
    role = "owner";
    workspaceRow = STANDARD;
    renderShell(`/${SEGMENT}/overview`);

    expect(await screen.findByRole("link", { name: "Members" })).toBeTruthy();
  });

  it("leaves a STANDARD workspace alone, and never even ASKS", async () => {
    // ⚠ THE UNASKED QUESTION IS THE ASSERTION. "Still on /overview" alone is
    // VACUOUS here: the redirect needs a round trip, and the render assertion
    // resolves before it lands — measured, a dropped gate keeps that half
    // green. `enabled` is what makes the read cost nothing on every workspace
    // page for every member of every workspace, and the request log is the only
    // place that shows.
    role = "owner";
    workspaceRow = STANDARD;
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
        (c: unknown[]) =>
          isAccountChannels((c[0] as { path?: string })?.path ?? "")
      )
    ).toBe(false);
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/overview`);
  });

  it("leaves a workspace whose row carries NO kind alone (pre-migration rows)", async () => {
    // `kind` is absent on rows read before the kind migration — and absent MEANS
    // standard (`isStandardWorkspace`). A `!== "link"` read would agree here and
    // disagree on the next kind added to the union.
    const noKind: Record<string, unknown> = { ...CONTAINER };
    delete noKind.kind;
    role = "owner";
    workspaceRow = noKind;
    renderShell(`/${SEGMENT}/overview`);

    expect(await screen.findByText("overview body")).toBeTruthy();
    await waitFor(() =>
      expect(sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/workspaces" })
      )
    );
    expect(
      sendRequest.mock.calls.some((c: unknown[]) =>
        isAccountChannels((c[0] as { path?: string })?.path ?? "")
      )
    ).toBe(false);
  });
});
