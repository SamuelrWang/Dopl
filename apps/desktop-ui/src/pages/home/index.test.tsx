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
import type { Channel, ChannelListPayload } from "@/features/channels/types";
import {
  CHANNEL,
  CHANNEL_ID,
  HOME,
  LINK_SEGMENT,
  LINK_WORKSPACE_ID,
  failing,
  isAccountChannels,
  openChannelRecord,
  openChannels,
  renderHome,
  routes,
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
 *
 * ⚠ THE INVITATION LIFECYCLE IS NEXT DOOR — `home-links.test.tsx` (2026-09-01),
 * split off when this file crossed the 500-line cap for the second time. Mint,
 * revoke and the one-open-link rule live there; the page's SHAPE lives here.
 */

const apiRequest = vi.hoisted(() => vi.fn());

/** The header's list-width CELL (`home-header.tsx`) as a `closest` selector: inside it heads the channel picker, outside it is a page control. */
const LIST_CELL = ".w-\\[var\\(--home-list-w\\)\\]";

// ⚠ **ONE STUB, SIX FILES (`surface-slot-fixtures.tsx`) — THIS FILE'S INLINE COPY
// WENT IN WAVE 1A (2026-09-17).** It rendered whatever body the host injected,
// which was the right shape while /home injected one; there is ONE Info body now
// and a host may only ADD to it, so a stub that does not render the shared body
// cannot answer what this page puts on screen. The shared stub carries the same
// `data-*` attributes this suite asserts on, and it MAKES the surface's reads, so
// the cases below went from mounting a fake to mounting the real body.
// ⚠ ASYNC FACTORY because `vi.mock` is hoisted over every import.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
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
    await openChannels();
    const pane = (await screen.findByTestId("channel-surface")).parentElement
      ?.parentElement;
    expect(pane?.className).toMatch(/border-home-panel-line/);
    expect(pane?.className).not.toMatch(/\bbento\b/);
  });

  /**
   * THE ONLY WAY INTO SETTINGS FROM /home (Samuel, 2026-08-30). The workspace
   * shell reaches it through the sidebar's gear; this page has no sidebar, and
   * before this it had no settings entry at all.
   *
   * ⚠ PINNED AS "THE CONTROL OPENS THE MODAL", not as a face rendering — but the
   * SHAPE is Samuel's own words now (2026-09-15: "turn the profile button to be
   * black, and have it say Profile"). ⚠ **IT ANSWERS TO "Profile", NOT "Settings",
   * SINCE THAT SAME REVIEW**: it has visible text now, and an `aria-label` that did
   * not contain it would break voice control. */
  it("opens settings from the operator's Profile pill", async () => {
    renderHome();
    // Black face, ONE WORD, no glyph (Samuel, 2026-09-15: "remove the profile
    // icon"), RIGHT GROUP. The role query proves text IS the accessible name.
    const control = await screen.findByRole("button", { name: "Profile" });
    expect(control.className).toMatch(/auth-btn-3d\b/);
    expect(control.querySelector("svg")).toBeNull();
    expect(control.closest(LIST_CELL)).toBeNull();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(control);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  it("renders claimed relationships and pending links in one list", async () => {
    renderHome();
    // The header's selector replaced the page title — "Channel" is the
    // surface (from "Chat" 2026-09-01, singular since 2026-09-09), and it is
    // no longer the face the page OPENS on (Samuel: Overview is the landing).
    await openChannels();
    // 🔒 THE ROW IS THE CHANNEL'S NAME AND NO MEMBER IDENTITY (2026-09-01) —
    // this asserted the peer's EMAIL until the roster-derived row was removed.
    expect(screen.getAllByText("Priya Shah").length).toBeGreaterThan(0);
    // 🔒 THE LAST-MESSAGE PREVIEW ASSERTION LEFT THIS FILE ON 2026-09-13 (Samuel:
    // it "just doesn't make sense imo" on a row). The row's LINE TWO — the absent
    // preview, the peer stack, the `@ N` badge — is `relationship-list.test.tsx`.
    // The pending link is a row of the same list, marked as one.
    expect(screen.getByText("Link out")).toBeInTheDocument();
    expect(screen.getByText("Not yet claimed")).toBeInTheDocument();
    // ⚠ THE LIST COLUMN HAS NO CONTROLS OF ITS OWN (Samuel, 2026-08-27). The
    // "All | Links" segmented filter above the rows is DELETED — links are no
    // longer a filterable state — and the rows themselves are untouched: the
    // link row above is still in this list, still chipped. The only tabs left
    // on the page are the header's five faces, and ORDER is the assertion:
    // Overview sits LEFT of Channels (Samuel, 2026-09-01) and Ontology sits to
    // the RIGHT of Agents (Samuel, 2026-09-09: the ontology page comes in "as a
    // new tab, to the right of the Agents tab").
    // ⚠ **THE FIRST FIVE, not every tab** (FOUR until 2026-09-09). The face row
    // is the page header's and is first in document order; the OUTGOING Overview
    // pane is still mounted for one 150ms `Crossfade` fade after the click, and
    // it carries the chart's metric switcher — which is also `role="tab"`.
    expect(screen.queryByRole("tab", { name: /^All/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Links/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("tab").slice(0, 5).map((tab) => tab.textContent)
    ).toEqual(["Overview", "Channel", "Knowledge", "Agents", "Ontology"]);
  });

  it("drops link containers from the account rail", async () => {
    renderHome();
    await openChannels();

    expect(screen.getByRole("button", { name: "Acme" })).toBeInTheDocument();
    // The container workspace is named for the peer — it must not be a tile.
    expect(
      screen.queryByRole("button", { name: "Priya Shah" })
    ).not.toBeInTheDocument();
  });

  it("selecting a relationship mounts the surface on its container", async () => {
    renderHome();

    const surface = await openChannelRecord();
    expect(surface).toHaveAttribute("data-workspace", LINK_WORKSPACE_ID);
    expect(surface).toHaveAttribute("data-slug", LINK_SEGMENT);
    expect(surface).toHaveAttribute("data-channel", CHANNEL_ID);
    expect(surface).toHaveAttribute("data-user", USER_ID);
    expect(surface).toHaveAttribute("data-member-management", "false");
    // The person card is the INFO slot, not the channel's own metadata tab.
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();

    // ⚠ **THE RECORD PANE'S READ IS THE `container` SCOPE, AND THE PAGE'S LIST IS
    // THE `account` ONE — ONE PATH, TWO SCOPES (R-26).** So this looks for the
    // container call by its scope rather than by the path, which since Wave 3
    // matches both. The container read is addressed over the workspace header;
    // the account read carries none, and must not (`withUserAuth` resolves no
    // workspace, and a header would key the cache per rail selection).
    const calls = bridgeCalls(apiRequest).filter((c) =>
      c.path.startsWith("/api/channels?")
    );
    const container = calls.find((c) => c.path.includes("scope=container"));
    expect(container?.opts.workspaceId).toBe(LINK_WORKSPACE_ID);
    expect(
      calls.find((c) => c.path.includes("scope=account"))?.opts.workspaceId
    ).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  /**
   * 🔒 **ZERO ROWS HAS ONE SENTENCE AGAIN (2026-09-17).** It had two — "No
   * matches" and "No channels yet" — and the list said the wrong one to every
   * new account until 2026-09-10, which is what bought the distinction. **The
   * search narrowing is now deleted** (Samuel's popup ruling), so there is no
   * filter for a sentence to report on: "No matches" is gone from both halves
   * and this case pins that it cannot come back under a typed query.
   */
  it("🔒 says No channels yet with nothing to show — and a typed query never says No matches", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        isAccountChannels(path)
          ? Promise.resolve(ok({ channels: [], pendingLinks: [] }))
          : (routes(path, opts) ??
            Promise.reject(new Error(`unexpected: ${path}`)))
    );

    renderHome();
    await openChannels();

    // ⚠ BOTH PANES AGAIN, and they say the SAME thing now — the list's line plus
    // the record pane's `EmptyState` title.
    await waitFor(() =>
      expect(screen.getAllByText("No channels yet")).toHaveLength(2)
    );
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();

    // 🔒 AND A TYPED QUERY DOES NOT CHANGE IT — it cannot: nothing on this page
    // narrows this list any more.
    fireEvent.focus(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "nobody" },
    });
    await waitFor(() =>
      expect(screen.getAllByText("No channels yet")).toHaveLength(2)
    );
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("renders a SOLO channel by its own name, like every other channel", async () => {
    // 🔒 NO LONGER A SPECIAL CASE SINCE 2026-09-01, which is the point: the row
    // was titled by the channel HERE and by the peer everywhere else, and the
    // "Just you" subline was the roster said a second way. Both are gone.
    const solo: ChannelListPayload = {
      channels: [
        {
          ...HOME.channels[0],
          name: "Q3 Fundraise",
          peers: [],
          lastMessageAt: null,
        },
      ],
      pendingLinks: [],
    };
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        isAccountChannels(path)
          ? Promise.resolve(ok(solo))
          : (routes(path, opts) ??
            Promise.reject(new Error(`unexpected: ${path}`)))
    );

    renderHome();
    await openChannels();

    expect(screen.getAllByText("Q3 Fundraise").length).toBeGreaterThan(0);
    expect(screen.queryByText("Just you")).not.toBeInTheDocument();
    expect(screen.queryByText("priya@shahco.tax")).not.toBeInTheDocument();

    // ⚠ AND THE INFO TAB IS THE CHANNEL'S CARD, not a person's with the fields
    // blanked: an "Email —" row on a channel with nobody in it implies a member
    // who is not there. What survives is what the channel itself knows.
    // ⚠ Awaited FIRST — the absence below means nothing until the slot is on
    // screen, and an unmounted panel would pass it for free.
    await openChannelRecord();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("creates a channel from the header and lands on the new row", async () => {
    // ⚠ THE WHOLE POINT OF THE INVERSION: a channel exists BEFORE anybody else
    // is in it, so creating one is a name and nothing more — no invitee, no
    // second field — and the operator is dropped straight into it.
    const created: Channel = {
      ...HOME.channels[0],
      workspaceId: "ws-link-new",
      // ⚠ THE CONTAINER MOVES WITH THE ROW — `container.kind` is what G3 filters
      // on, so a created row that kept the old container id would still render
      // but would address the wrong workspace.
      container: {
        id: "ws-link-new",
        kind: "link",
        segment: "link-q3-cc22dd",
      },
      id: "chan-new",
      name: "Q3 Fundraise",
      peers: [],
      lastMessageAt: null,
    };
    let channels = [...HOME.channels];
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) => {
        const bare = path.split("?")[0];
        // ⚠ **THE SCOPE TELLS THE THREE APART**, and the POST is one of them:
        // "New channel" is `POST /api/channels?scope=account` since R-26 (b).
        if (isAccountChannels(path) && opts.method === "POST") {
          channels = [created, ...channels];
          return Promise.resolve(ok({ channel: created }));
        }
        if (isAccountChannels(path)) {
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
    // ⚠ FROM OVERVIEW, THE FACE THE PAGE OPENS ON — this used to raise Channel
    // first, which made the landing assertion below vacuous. Samuel's ruling is
    // that the create takes the operator there ITSELF (2026-09-09).
    await screen.findByRole("tab", { name: "Overview", selected: true });
    fireEvent.click(await screen.findByRole("button", { name: "New channel" }));

    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "  Q3 Fundraise  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const post = bridgeCalls(apiRequest).find(
        (c) => isAccountChannels(c.path) && c.opts.method === "POST"
      );
      // TRIMMED, because the server trims and would otherwise store the spaces
      // this field's own schema refuses to count toward its 1..80.
      expect(post?.opts.body).toEqual({ name: "Q3 Fundraise" });
    });

    // 🔒 THE FACE MOVED WITH THE SELECTION. Both halves, because either one
    // alone is the bug: a selected row on the Overview face is invisible, and a
    // raised Channel face on the OLD row is somebody else's channel.
    await screen.findByRole("tab", { name: "Channel", selected: true });
    await waitFor(() =>
      expect(screen.getByTestId("channel-surface")).toHaveAttribute(
        "data-workspace",
        "ws-link-new"
      )
    );
  });

  /**
   * 🔒 **A PICK RAISES THE CHANNEL FACE FROM WHEREVER YOU ARE — EVERY FACE, NOT
   * ONLY OVERVIEW (Samuel, 2026-09-13:** *"so wherever the user is, if they click
   * on a different channel in the picker, it needs to go to the channel page of
   * that"*, reported from the Ontology face**).** This SUPERSEDES the 2026-09-09
   * carve-out, which raised it from Overview alone on the argument that Knowledge
   * and Agents render the selected channel's contents so the list beside them is
   * their picker. Re-pointing a face is the header selector's job, one click away.
   * ⚠ BOTH BRANCHES OF THE OLD CONDITIONAL ARE ASSERTED — the face it already
   * moved from, and a face it did not — so a re-narrowing fails here. The
   * ONTOLOGY face's own case is next door (`ontology-panels.test.tsx`), where that
   * face's read table is wired.
   */
  it("picking a channel from OVERVIEW raises that channel's own face", async () => {
    renderHome();
    // The page opens on Overview and no surface is mounted there.
    await screen.findByRole("tab", { name: "Overview", selected: true });
    expect(screen.queryByTestId("channel-surface")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /Priya Shah/ }));

    await screen.findByRole("tab", { name: "Channel", selected: true });
    expect(await screen.findByTestId("channel-surface")).toHaveAttribute(
      "data-workspace",
      LINK_WORKSPACE_ID
    );
  });

  it("…and from KNOWLEDGE too, which used to stay put", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.click(screen.getByText("Knowledge"));
    await screen.findByRole("tab", { name: "Knowledge", selected: true });

    fireEvent.click(await screen.findByRole("button", { name: /Priya Shah/ }));

    await screen.findByRole("tab", { name: "Channel", selected: true });
    expect(await screen.findByTestId("channel-surface")).toHaveAttribute(
      "data-workspace",
      LINK_WORKSPACE_ID
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
    await openChannelRecord();

    expect(screen.getAllByRole("button", { name: "New channel" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Add person" })).toHaveLength(1);
  });

  it("routes a 401 to the signed-out screen, not an error card", async () => {
    apiRequest.mockImplementation(
      // ⚠ THE WHOLE RESOURCE, BOTH SCOPES — `failing` matches the bare path, and
      // a 401 is an identity fact rather than a scope one.
      failing("/api/channels", failure(401, "UNAUTHORIZED", "Not signed in"))
    );

    renderHome();
    expect(
      await screen.findByRole("heading", { name: "Log In" })
    ).toBeInTheDocument();
  });

  it("surfaces a failed read as the shared page error", async () => {
    apiRequest.mockImplementation(
      failing("/api/channels", failure(404, "NOT_FOUND", "Home blew up"))
    );

    renderHome();
    expect(await screen.findByRole("alert")).toHaveTextContent("Home blew up");
  });
});
