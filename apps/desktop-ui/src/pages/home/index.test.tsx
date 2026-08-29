import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import {
  USER_ID,
  bridgeCalls,
  failure,
  installBridge,
  ok,
} from "#/test-utils/bridge";
import type { HomeChannelsPayload } from "@/features/home/types";
import {
  CHANNEL,
  CHANNEL_ID,
  HOME,
  LINK_OUT,
  LINK_SEGMENT,
  LINK_WORKSPACE_ID,
  SEVEN_DAYS_MS,
  SOLO_CHANNEL,
  failing,
  renderHome,
  routes,
  withHome,
} from "./home-test-harness";

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
      slots?: {
        // ⚠ A RENDER FUNCTION since 2026-08-25, taking the surface's own
        // refetch gate — the person card writes now (`channel-surface.tsx ›
        // ChannelInfoTabContext`). The stub supplies an inert one: this suite
        // owns that Home MOUNTS the slot, not what the gate coordinates.
        infoTab?: (ctx: { gate: { begin: () => void; end: () => void } }) => React.ReactNode;
      };
    }) => (
      <div
        data-testid="channel-surface"
        data-workspace={props.workspaceId}
        data-slug={props.workspaceSlug}
        data-channel={props.channel.id}
        data-user={props.currentUserId}
        data-member-management={String(props.capabilities?.memberManagement)}
      >
        {props.slots?.infoTab?.({ gate: { begin: () => {}, end: () => {} } })}
      </div>
    ),
  })
);

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

  /**
   * ⚠ THE GATE PAINTS /home's OWN FRAME, NOT A GENERIC PAGE (Samuel,
   * 2026-08-28: the old ghosts were "way off"). It was `PageLoading` in a bare
   * `h-screen` box — a 52px bar over a centred `max-w-[960px]` column, a
   * surface this page has never had — and is `HomePageSkeleton` now: the rail,
   * the header, the 290px list and the bordered record pane, at the page's own
   * width var. The width class is the assertion because it is the ONE number
   * `home.module.css` calls load-bearing in two places.
   */
  it("holds the shape gate until every read lands", () => {
    const { view } = renderHome();
    expect(screen.getByRole("status")).toHaveTextContent("Opening home");
    expect(screen.queryByText("Priya Shah")).not.toBeInTheDocument();

    const { container } = view;
    expect(container.querySelector(".w-\\[var\\(--home-list-w\\)\\]")).not.toBeNull();
    expect(container.querySelector(".border-home-panel-line")).not.toBeNull();
    expect(container.querySelector(".max-w-\\[960px\\]")).toBeNull();
  });

  /**
   * THE RECORD PANE IS A COLUMN, NOT A FLOATING CARD (Samuel, live review
   * 2026-08-27 — the shadow seam beside the info column's tab pills).
   *
   * ⚠ WHY THIS IS PINNED AS A CLASS AND NOT A LOOK. `.bento` was painting exactly
   * ONE thing on this element — its two drop shadows — because the utilities
   * beside it already restate the fill, the border and the radius, and the
   * utility layer outranks the kit layer. The pane has no top or left margin
   * (the header selector is aligned to its left edge), so the upward half of an
   * 18px blur printed a gray band into the gap under the page header. Re-adding
   * the class is silent: nothing about the pane's geometry would change, and the
   * band would come straight back.
   */
  it("gives the record pane NO drop shadow — the 2px line is its whole boundary", async () => {
    renderHome();
    const pane = (await screen.findByTestId("channel-surface")).parentElement
      ?.parentElement;
    expect(pane?.className).toMatch(/border-home-panel-line/);
    expect(pane?.className).not.toMatch(/\bbento\b/);
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
    // ⚠ THE LIST COLUMN HAS NO CONTROLS OF ITS OWN (Samuel, 2026-08-27). The
    // "All | Links" segmented filter above the rows is DELETED — links are no
    // longer a filterable state — and the rows themselves are untouched: the
    // link row above is still in this list, still chipped. The only tabs left
    // on the page are the header's three faces.
    expect(screen.queryByRole("tab", { name: /^All/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Links/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Chat",
      "Knowledge",
      "Agents",
    ]);
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
    expect(screen.getByText("Created")).toBeInTheDocument();
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
    // ⚠ FROM THE CHANNEL'S OWN Info tab (2026-08-25), not the page header: the
    // act belongs to the container it binds to. (A SOLO channel is used here
    // because it has no open link — the two-state rule, not a capacity one.)
    apiRequest.mockImplementation(
      withHome({ channels: [SOLO_CHANNEL], pendingLinks: [] })
    );
    renderHome();
    await screen.findByTestId("channel-surface");

    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    // ⚠ `find`, not `get`: Add person opens a `StandardDialog` since
    // 2026-08-27 (it was a Popover, which rendered synchronously), and
    // `ModalShell` mounts a FRAME after `open` flips so it can animate in.
    const create = await screen.findByRole("button", { name: "Create link" });
    const before = Date.now();
    fireEvent.click(create);

    await waitFor(() => {
      const mint = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/home/links" && c.opts.method === "POST"
      );
      expect(mint).toBeDefined();
      const body = mint?.opts.body as {
        expiresAt: string;
        workspaceId: string;
        maxUses?: number;
      };
      // ⚠ THE LINK IS BOUND to the selected channel's container — an unbound
      // mint is not a thing any more, and `maxUses` is not a field the client
      // may send: a bound link admits ONE named person by construction.
      expect(body.workspaceId).toBe(LINK_WORKSPACE_ID);
      expect(body.maxUses).toBeUndefined();
      // The picker's default: 7 days. The WINDOW is relative; what leaves is an
      // instant, because that is what the route validates.
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
          (c) => c.path === "/api/home/channels"
        ).length
      ).toBeGreaterThan(1)
    );
  });

  it("renders a SOLO channel by its own name, subtitled 'Just you'", async () => {
    // ⚠ A channel with nobody in it is the NORMAL first state after the
    // 2026-08-24 inversion, not a half-built row: it is titled by the CHANNEL,
    // because there is no person to title it after, and its subline is the
    // static words — never an agent or thread count (Samuel's ruling).
    const solo: HomeChannelsPayload = {
      channels: [
        {
          ...HOME.channels[0],
          name: "Q3 Fundraise",
          // ⚠ BOTH, or the fixture contradicts itself: `peer` is `peers[0]`, so
          // a null head over a non-empty list is a payload the server cannot emit.
          peers: [],
          peer: null,
          lastMessageAt: null,
          lastMessagePreview: null,
        },
      ],
      pendingLinks: [],
    };
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path.split("?")[0] === "/api/home/channels"
          ? Promise.resolve(ok(solo))
          : (routes(path, opts) ??
            Promise.reject(new Error(`unexpected: ${path}`)))
    );

    renderHome();
    await screen.findByRole("tab", { name: "Chat", selected: true });

    expect(screen.getAllByText("Q3 Fundraise").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Just you").length).toBeGreaterThan(0);
    expect(screen.queryByText("priya@shahco.tax")).not.toBeInTheDocument();

    // ⚠ AND THE INFO TAB IS THE CHANNEL'S CARD, not a person's with the fields
    // blanked: an "Email —" row on a channel with nobody in it implies a member
    // who is not there. What survives is what the channel itself knows.
    // ⚠ Awaited FIRST — the absence below means nothing until the slot is on
    // screen, and an unmounted panel would pass it for free.
    await screen.findByTestId("channel-surface");
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Last activity")).toBeInTheDocument();
  });

  it("creates a channel from the header and lands on the new row", async () => {
    // ⚠ THE WHOLE POINT OF THE INVERSION: a channel exists BEFORE anybody else
    // is in it, so creating one is a name and nothing more — no invitee, no
    // second field — and the operator is dropped straight into it.
    const created = {
      ...HOME.channels[0],
      workspaceId: "ws-link-new",
      workspaceSegment: "link-q3-cc22dd",
      channelId: "chan-new",
      name: "Q3 Fundraise",
      peers: [],
      peer: null,
      lastMessageAt: null,
      lastMessagePreview: null,
    };
    let channels = [...HOME.channels];
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) => {
        const bare = path.split("?")[0];
        if (bare === "/api/home/channels" && opts.method === "POST") {
          channels = [created, ...channels];
          return Promise.resolve(ok({ channel: created }));
        }
        if (bare === "/api/home/channels") {
          return Promise.resolve(ok({ channels, pendingLinks: [] }));
        }
        if (bare === "/api/channels") {
          return Promise.resolve(
            ok({ channels: [CHANNEL, { ...CHANNEL, id: "chan-new" }] })
          );
        }
        return routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`));
      }
    );

    renderHome();
    await screen.findByRole("tab", { name: "Chat", selected: true });
    fireEvent.click(screen.getByRole("button", { name: "New channel" }));

    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "  Q3 Fundraise  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/home/channels" && c.opts.method === "POST"
      );
      // TRIMMED, because the server trims and would otherwise store the spaces
      // this field's own schema refuses to count toward its 1..80.
      expect(post?.opts.body).toEqual({ name: "Q3 Fundraise" });
    });

    // The new row is SELECTED — the surface remounts on its container.
    await waitFor(() =>
      expect(screen.getByTestId("channel-surface")).toHaveAttribute(
        "data-workspace",
        "ws-link-new"
      )
    );
  });

  it("wears the Link out chip and offers Revoke where Add person was", async () => {
    // ⚠ ONE SECTION, TWO STATES, and this is the rule that SURVIVED the member
    // cap's retirement. An invitation already out IS the answer to "add a
    // person": a container may hold at most one OPEN link at a time, so
    // offering the act again would mint over a URL already sent.
    apiRequest.mockImplementation(
      withHome({
        channels: [{ ...SOLO_CHANNEL, linkOut: LINK_OUT }],
        pendingLinks: [],
      })
    );
    renderHome();
    await screen.findByTestId("channel-surface");

    // TWICE, and both are load-bearing: the chip names it on the ROW, where you
    // scan for it, and the section heading names it INSIDE the channel, where
    // you act on it.
    expect(screen.getAllByText("Link out")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add person" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      const revoke = bridgeCalls(apiRequest).find(
        (c) => c.path === `/api/home/links/${LINK_OUT.id}`
      );
      expect(revoke?.opts.method).toBe("DELETE");
    });
    // Revoking re-reads the channels; the chip clears with the payload, never
    // by a cache edit here.
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).filter((c) => c.path === "/api/home/channels")
          .length
      ).toBeGreaterThan(1)
    );
  });

  it("keeps ONE primary action in the header, and Add person is not one of them", async () => {
    // ⚠ THE ASSERTION IS ABOUT PLACEMENT, NOT CAPACITY (rewritten 2026-08-26).
    // It used to read "no Add person on a FULL channel" over the default
    // fixture, which already has a peer — and the cap is gone, so that channel
    // now offers the act like any other. What survives is WHERE: `New channel`
    // is the page's one primary action, there is no `Invite`, and Add person
    // exists EXACTLY ONCE — on the selected channel's Info tab, never lifted
    // into the header beside it.
    renderHome();
    await screen.findByTestId("channel-surface");

    expect(screen.getAllByRole("button", { name: "New channel" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add person" })).toHaveLength(1);
  });

  it("routes a 401 to the signed-out screen, not an error card", async () => {
    apiRequest.mockImplementation(
      failing(
        "/api/home/channels",
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
      failing("/api/home/channels", failure(404, "NOT_FOUND", "Home blew up"))
    );

    renderHome();
    expect(await screen.findByRole("alert")).toHaveTextContent("Home blew up");
  });
});
