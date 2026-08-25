import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import {
  USER_ID,
  WORKSPACE,
  bootBody,
  bridgeCalls,
  failure,
  installBridge,
  noContent,
  ok,
  renderWithProviders,
} from "#/test-utils/bridge";
import type { HomeRelationshipsPayload } from "@/features/home/types";
import HomePage from "./index";

/**
 * Home page smoke test — the ACCOUNT surface on real reads.
 *
 * ⚠ Mocked at `window.dopl.apiRequest` like every other page suite: this page
 * reads over BOTH clients (the SPA transport for `/api/home/**` + `/api/boot`,
 * the WEB `apiRequest` for the channels read the record mounts and for the link
 * writes), and both funnel into the one bridge in the packaged app.
 *
 * ⚠ THE CHANNELS SURFACE IS STUBBED. It is C's tree, covered by
 * `channel-surface.test.tsx`; what this suite owns is that Home MOUNTS it with
 * the container's workspace, the resolved channel row, the caller's id and the
 * person slot.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: (props: {
      workspaceId: string;
      workspaceSlug: string;
      channel: { id: string };
      currentUserId: string;
      capabilities?: { memberManagement?: boolean };
      slots?: { infoTab?: React.ReactNode };
    }) => (
      <div
        data-testid="channel-surface"
        data-workspace={props.workspaceId}
        data-slug={props.workspaceSlug}
        data-channel={props.channel.id}
        data-user={props.currentUserId}
        data-member-management={String(props.capabilities?.memberManagement)}
      >
        {props.slots?.infoTab}
      </div>
    ),
  })
);

const LINK_WORKSPACE_ID = "ws-link-1";
const LINK_SEGMENT = "link-priya-aa11bb";
const CHANNEL_ID = "chan-1";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const RELATIONSHIPS: HomeRelationshipsPayload = {
  relationships: [
    {
      workspaceId: LINK_WORKSPACE_ID,
      workspaceSegment: LINK_SEGMENT,
      channelId: CHANNEL_ID,
      peer: {
        userId: "user-2",
        displayName: "Priya Shah",
        email: "priya@shahco.tax",
        avatarUrl: null,
      },
      connectedAt: "2026-07-12T10:00:00.000Z",
      lastMessageAt: "2026-08-22T14:19:00.000Z",
      lastMessagePreview: "Three renewals over $1k before October",
    },
  ],
  pendingLinks: [
    {
      id: "link-1",
      url: "https://dopl.link/c/x7Kd92mQ",
      label: null,
      createdAt: "2026-08-19T09:00:00.000Z",
      expiresAt: "2026-08-28T09:00:00.000Z",
      maxUses: 1,
      useCount: 0,
      revokedAt: null,
    },
  ],
};

const CHANNEL = {
  id: CHANNEL_ID,
  workspaceId: LINK_WORKSPACE_ID,
  slug: "priya-shah",
  name: "Priya Shah",
  topic: "",
  visibility: "private",
  isDirect: true,
  directPeer: { userId: "user-2", displayName: "Priya Shah", avatarUrl: null },
  createdBy: USER_ID,
  archivedAt: null,
  createdAt: "2026-07-12T10:00:00.000Z",
  updatedAt: "2026-08-22T14:19:00.000Z",
  memberCount: 2,
  lastMessageAt: "2026-08-22T14:19:00.000Z",
  role: "owner",
  isMember: true,
  lastReadAt: null,
  unread: false,
  myNotifyScope: null,
  myAgentToolProfile: null,
  myFavoritedAt: null,
  onlineMemberCount: 1,
};

/** ⚠ Carries a `kind: "link"` CONTAINER beside the real workspace on purpose:
 *  `GET /api/workspaces` is unfiltered, and the rail must drop it. */
const WORKSPACES = {
  workspaces: [
    { ...WORKSPACE, role: "owner" },
    {
      ...WORKSPACE,
      id: LINK_WORKSPACE_ID,
      name: "Priya Shah",
      slug: "link-priya",
      publicId: "aa11bb",
      kind: "link",
      role: "member",
    },
  ],
};

function routes(
  path: string,
  opts: BridgeRequestOpts
): Promise<BridgeResponse> | null {
  const bare = path.split("?")[0];
  if (bare === "/api/boot") return Promise.resolve(ok(bootBody()));
  if (bare === "/api/workspaces") return Promise.resolve(ok(WORKSPACES));
  if (bare === "/api/home/relationships") {
    return Promise.resolve(ok(RELATIONSHIPS));
  }
  if (bare === "/api/home/links") {
    return Promise.resolve(
      ok({ link: { ...RELATIONSHIPS.pendingLinks[0], id: "link-2" } })
    );
  }
  if (bare.startsWith("/api/home/links/") && opts.method === "DELETE") {
    return Promise.resolve(noContent());
  }
  if (bare === "/api/channels") {
    return Promise.resolve(ok({ channels: [CHANNEL] }));
  }
  return null;
}

function renderHome() {
  return renderWithProviders(
    [
      { path: "/home", element: <HomePage /> },
      { path: "/:workspaceSegment", element: <p>Workspace page</p> },
    ],
    ["/home"]
  );
}

/** Answer everything normally except one path, which fails. */
function failing(target: string, response: BridgeResponse) {
  return (path: string, opts: BridgeRequestOpts = {}) =>
    path.split("?")[0] === target
      ? Promise.resolve(response)
      : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)));
}

describe("home page", () => {
  beforeEach(() => {
    // ⚠ `restoreMocks` resets implementations, NOT the recorded calls of a
    // hoisted `vi.fn()` — and this suite inspects requests.
    apiRequest.mockReset();
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        routes(path, opts) ??
        Promise.reject(new Error(`unexpected request: ${path}`))
    );
    installBridge({
      apiRequest: (path: string, opts: BridgeRequestOpts = {}) =>
        apiRequest(path, opts),
      getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
      onAuthState: () => () => {},
      openExternal: () => Promise.resolve({ ok: true }),
    });
  });

  it("holds the shape gate until every read lands", () => {
    renderHome();
    expect(screen.getByRole("status")).toHaveTextContent("Opening home");
    expect(screen.queryByText("Priya Shah")).not.toBeInTheDocument();
  });

  it("renders claimed relationships and pending links in one list", async () => {
    renderHome();

    // The header's selector replaced the page title — "Chat" is the surface.
    expect(
      await screen.findByRole("tab", { name: "Chat", selected: true })
    ).toBeInTheDocument();
    // ⚠ `getAllBy`: the email is the list row's subline AND the person card's.
    expect(screen.getAllByText("priya@shahco.tax").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Three renewals over $1k before October")
    ).toBeInTheDocument();
    // The pending link is a row of the same list, marked as one.
    expect(screen.getByText("Link out")).toBeInTheDocument();
    expect(screen.getByText("Not yet claimed")).toBeInTheDocument();
    // "Needs you" has no backend signal and is DELETED, not faked.
    expect(screen.queryByRole("tab", { name: /Needs you/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^All/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Links/ })).toBeInTheDocument();
  });

  it("drops link containers from the account rail", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Chat", selected: true });

    expect(screen.getByRole("button", { name: "Acme" })).toBeInTheDocument();
    // The container workspace is named for the peer — it must not be a tile.
    expect(
      screen.queryByRole("button", { name: "Priya Shah" })
    ).not.toBeInTheDocument();
  });

  it("selecting a relationship mounts the surface on its container", async () => {
    renderHome();

    const surface = await screen.findByTestId("channel-surface");
    expect(surface).toHaveAttribute("data-workspace", LINK_WORKSPACE_ID);
    expect(surface).toHaveAttribute("data-slug", LINK_SEGMENT);
    expect(surface).toHaveAttribute("data-channel", CHANNEL_ID);
    expect(surface).toHaveAttribute("data-user", USER_ID);
    expect(surface).toHaveAttribute("data-member-management", "false");
    // The person card is the INFO slot, not the channel's own metadata tab.
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Last activity")).toBeInTheDocument();

    // The channels read is addressed to the CONTAINER, over the workspace header.
    const call = bridgeCalls(apiRequest).find((c) =>
      c.path.startsWith("/api/channels")
    );
    expect(call?.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("searching filters the list by name and email", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Chat", selected: true });

    // The field is behind a collapsed pill — it is unreachable until the round
    // toggle grows it (kit `.search-expand`).
    expect(screen.getByLabelText("Search people")).toHaveAttribute(
      "tabindex",
      "-1"
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByLabelText("Search people")).toHaveAttribute(
      "tabindex",
      "0"
    );

    fireEvent.change(screen.getByLabelText("Search people"), {
      target: { value: "shahco" },
    });
    expect(screen.getAllByText("priya@shahco.tax").length).toBeGreaterThan(0);
    expect(screen.queryByText("Link out")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search people"), {
      target: { value: "nobody" },
    });
    // ⚠ BOTH PANES. The list says "No matches" and so does the record — the
    // pane resolves its selection from the same filtered set the list renders,
    // so it can no longer sit on a person the list has already dropped.
    expect(screen.getAllByText("No matches")).toHaveLength(2);
    expect(screen.queryByText("priya@shahco.tax")).not.toBeInTheDocument();
  });

  it("mints a link with the picked window as an absolute future instant", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Chat", selected: true });

    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    const before = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    await waitFor(() => {
      const mint = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/home/links" && c.opts.method === "POST"
      );
      expect(mint).toBeDefined();
      const body = mint?.opts.body as { expiresAt: string; maxUses: number };
      // The picker's default: 7 days, single use. The WINDOW is relative; what
      // leaves is an instant, because that is what the route validates.
      expect(body.maxUses).toBe(1);
      const delta = Date.parse(body.expiresAt) - before;
      expect(delta).toBeGreaterThan(SEVEN_DAYS_MS - 5_000);
      expect(delta).toBeLessThan(SEVEN_DAYS_MS + 5_000);
    });
  });

  it("revokes a pending link and re-reads the list", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Chat", selected: true });

    fireEvent.click(screen.getByText("Link out"));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      const revoke = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/home/links/link-1"
      );
      expect(revoke?.opts.method).toBe("DELETE");
    });
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).filter(
          (c) => c.path === "/api/home/relationships"
        ).length
      ).toBeGreaterThan(1)
    );
  });

  it("routes a 401 to the signed-out screen, not an error card", async () => {
    apiRequest.mockImplementation(
      failing(
        "/api/home/relationships",
        failure(401, "UNAUTHORIZED", "Not signed in")
      )
    );

    renderHome();
    expect(
      await screen.findByRole("heading", { name: "Log In" })
    ).toBeInTheDocument();
  });

  it("surfaces a failed read as the shared page error", async () => {
    apiRequest.mockImplementation(
      failing("/api/home/relationships", failure(404, "NOT_FOUND", "Home blew up"))
    );

    renderHome();
    expect(await screen.findByRole("alert")).toHaveTextContent("Home blew up");
  });
});
