import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { BridgeResponse } from "#/lib/dopl-bridge";
import { AppShellLayout } from "./index";

/**
 * 🔒 NOBODY IN A HOME-CHANNEL CONTAINER GETS THE SHELL (2026-10-29, Samuel: "Yes,
 * fix it"). Any URL under a `kind='link'` container's segment lands on /home with
 * that container's row selected, `?thread=`/`?seq=` carried across — every role,
 * the guest included. The container's channel used to open as a WORKSPACE channels
 * page, which Samuel read as "an actual workspace" with no rail icon lit. /home's
 * half (the row, the thread, the cleared query) is `pages/home/home-intent.test.tsx`.
 *
 * 🔒 A GUEST OF A STANDARD WORKSPACE STILL LANDS ON THEIR CHANNEL (ASK-2 option b,
 * 2026-08-30), resolved off `GET /api/channels?scope=account` matched on
 * `workspaceId`; no channel, a failed or a stale read ⇒ `/home`.
 *
 * ⚠ THE FLOOR IS NOT THE FIX. `segment.ts › BOOT_MIN_ROLE` stays `"guest"`: the
 * two pop-out windows live OUTSIDE this layout and pay the boot read themselves.
 *
 * ⚠ THE KIND IS THE FENCE, POSITIVELY (`=== "link"`, INVARIANTS §4A): a FOURTH
 * kind and a row with NO kind stay in the shell, and the standard cases assert an
 * UNASKED question, not just a pathname — the redirect needs a round trip, so
 * "still on /overview" alone stays green under a dropped gate.
 *
 * ⚠ `?? []` in the guest read's `select` is NOT pinned by any case here: a
 * throwing `select` errors the query, which lands on the same `/home` the absent
 * channel does. The guard stays (INVARIANTS §8); do not read the stale case as
 * covering it.
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

const asksAccountChannels = () =>
  sendRequest.mock.calls.some((c: unknown[]) =>
    isAccountChannels((c[0] as { path?: string })?.path ?? "")
  );

const HOME_TARGET = `/home?channel=${CONTAINER.id}`;
const at = (router: ReturnType<typeof renderShell>) =>
  `${router.state.location.pathname}${router.state.location.search}`;

beforeEach(() => {
  mounted.length = 0;
  role = "guest";
  workspaceRow = CONTAINER;
  homePayload = { channels: [homeChannel()], pendingLinks: [] };
  window.localStorage.clear();
  // ⚠ `mockImplementation` does NOT reset the call log, and several cases
  // assert on an ABSENT call — without this they read the previous case's.
  sendRequest.mockClear();
  mockApi();
  mockBridge();
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

describe("a home-channel container member lands on /home", () => {
  it("redirects off the workspace page onto /home with the container's row", async () => {
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() => expect(at(router)).toBe(HOME_TARGET));
    expect(await screen.findByText("account home")).toBeTruthy();
    // REPLACE, not push: Back must not bounce them into the loop.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("carries the thread and the seq off a channel URL", async () => {
    role = "owner";
    const router = renderShell(`/${SEGMENT}/channels/${CHANNEL_ID}?thread=t-1&seq=7`);

    await waitFor(() => expect(at(router)).toBe(`${HOME_TARGET}&thread=t-1&seq=7`));
  });

  for (const containerRole of ["guest", "viewer", "member", "admin", "owner"] as const) {
    it(`sends the container's ${containerRole} there too`, async () => {
      role = containerRole;
      const router = renderShell(`/${SEGMENT}/members`);

      await waitFor(() => expect(at(router)).toBe(HOME_TARGET));
    });
  }

  /**
   * 🔒 THE REDIRECT WINDOW IS PART OF THE RULING (wave 5 review, 2026-09-17).
   * The navigate is an EFFECT, so the render before it could mount the very page
   * being refused. ⚠ A pathname assertion CANNOT see this; the mount log can.
   * And the target needs no read, so the account channels are never asked.
   */
  it("never paints the page it is about to leave, and asks nothing to leave it", async () => {
    role = "member";
    const router = renderShell(`/${SEGMENT}/members`);

    await waitFor(() => expect(at(router)).toBe(HOME_TARGET));
    expect(mounted).toEqual([]);
    expect(asksAccountChannels()).toBe(false);
  });
});

describe("a guest of a standard workspace lands on their channel", () => {
  beforeEach(() => {
    workspaceRow = STANDARD;
  });

  it("redirects off the workspace page onto the channel", async () => {
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`)
    );
    expect(await screen.findByText("channel body")).toBeTruthy();
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("stays put once it is ON the channel — no redirect loop", async () => {
    const router = renderShell(`/${SEGMENT}/channels/${CHANNEL_ID}`);

    expect(await screen.findByText("channel body")).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`);
  });

  it("falls back to /home when the workspace has no channel for them", async () => {
    homePayload = { channels: [], pendingLinks: [] };
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
    expect(await screen.findByText("account home")).toBeTruthy();
  });

  it("matches on the CONTAINER, never on the first row", async () => {
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
    homePayload = { pendingLinks: [] };
    const router = renderShell(`/${SEGMENT}/overview`);

    await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
  });

  it("never paints the page it is about to leave", async () => {
    const router = renderShell(`/${SEGMENT}/members`);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/channels/${CHANNEL_ID}`)
    );
    expect(mounted).toEqual([]);
  });
});

describe("everyone else keeps the shell", () => {
  it("keeps the nav for a standard workspace", async () => {
    role = "owner";
    workspaceRow = STANDARD;
    renderShell(`/${SEGMENT}/overview`);

    expect(await screen.findByRole("link", { name: "Members" })).toBeTruthy();
  });

  /** The standard workspace, a FOURTH container kind (the case that tells `=== "link"`
   *  from a negative spelling) and a pre-migration row with NO kind (absent = standard). */
  const stays: Array<[string, () => unknown]> = [
    ["a STANDARD workspace", () => STANDARD],
    ["a FOURTH container kind", () => ({ ...CONTAINER, kind: "archive" })],
    [
      "a row with NO kind",
      () => {
        const noKind: Record<string, unknown> = { ...CONTAINER };
        delete noKind.kind;
        return noKind;
      },
    ],
  ];
  for (const [label, row] of stays) {
    it(`leaves ${label} alone, and never even ASKS`, async () => {
      role = "owner";
      workspaceRow = row();
      const router = renderShell(`/${SEGMENT}/overview`);

      expect(await screen.findByText("overview body")).toBeTruthy();
      // Let anything the shell was going to fetch actually fetch.
      await waitFor(() =>
        expect(sendRequest).toHaveBeenCalledWith(
          expect.objectContaining({ path: "/api/workspaces" })
        )
      );
      expect(asksAccountChannels()).toBe(false);
      expect(router.state.location.pathname).toBe(`/${SEGMENT}/overview`);
    });
  }
});
