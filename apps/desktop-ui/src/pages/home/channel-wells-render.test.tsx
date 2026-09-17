import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge } from "#/test-utils/bridge";
import type { HomeChannelsPayload } from "@/features/home/types";
import { PANEL_WELL, PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { channelKeys } from "@/features/channels/client/query-keys";
import { HOME, openChannels, renderHome, withHome } from "./home-test-harness";

/**
 * /home's CHANNEL COLUMN AS THREE GRAY WELLS — the structure, not the row.
 *
 * ⚠ **SPLIT OUT OF `relationship-list.test.tsx` ON 2026-09-15** (the §1 cap).
 * **The seam is the ROW versus the COLUMN'S STRUCTURE**: what one row looks like
 * belongs there, which gray box it lands in belongs here. Both render through the
 * real page and share `home-test-harness.tsx`.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

/**
 * 🔒 **THE COLUMN IS THREE GRAY WELLS SINCE 2026-09-15 (Samuel, verbatim):**
 * *"look on the agents tab, there is the gray box, for recents, 7 days, etc. I
 * want to bring that over. Basically, one for Pinned, one for Recents (this will
 * be in effect channels with activity in the last 24 hours), and Earlier. Also,
 * notice how in the agents tab, those the top gray, kinda extends over the entire
 * width. Can you make the channels one looks more like a tab, meaning, it will
 * be, Recent (arrow), then the gray drops. Each corner needs to be curved."*
 *
 * ⚠ **THE BOUNDARY IS `channel-wells.test.ts`'s** — a rendered case cannot state
 * an age (the page holds no clock to pass). What is pinned here is what the RENDER
 * does with that answer.
 */
describe("the list column's THREE WELLS", () => {
  /** A second channel, last spoken in months ago — the **Earlier** row. ⚠ Its own
   *  `workspaceId`, because that is what `channelRowId` keys the row on. */
  const ANCIENT: HomeChannelsPayload["channels"][number] = {
    ...HOME.channels[0],
    workspaceId: "ws-ancient",
    name: "Cold Storage",
    createdAt: "2026-02-01T09:00:00.000Z",
    lastMessageAt: "2026-02-03T09:00:00.000Z",
  };

  /** The default (minutes old) channel plus the ancient one, no legacy link row. */
  const SPREAD: HomeChannelsPayload = {
    channels: [HOME.channels[0], ANCIENT],
    pendingLinks: [],
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("files a fresh channel under Recent and an old one under a CLOSED Earlier", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();

    await screen.findByRole("heading", { name: "Recent" });

    const recent = screen.getByRole("heading", { name: "Recent" }).closest("section")!;
    expect(within(recent).getByText("Priya Shah")).toBeInTheDocument();
    // ⚠ COLLAPSED MEANS UNMOUNTED, NOT HIDDEN (§5) — the old row is not present.
    expect(screen.queryByText("Cold Storage")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    const earlier = screen.getByRole("heading", { name: "Earlier" }).closest("section")!;
    expect(within(earlier).getByText("Cold Storage")).toBeInTheDocument();
  });

  /**
   * 🔒 **A SEARCH THAT MATCHES MUST SHOW WHAT IT MATCHED** (2026-09-16, found reviewing
   * `dce0030a` before push).
   *
   * ⚠ **THE COLUMN WENT BLANK AND SAID NOTHING.** `Earlier` is closed by default and a
   * collapsed well UNMOUNTS its rows (§5), so a query whose only hit was filed there rendered
   * three empty boxes — and the empty sentence did not draw either, because `rows.length > 0`
   * is true: neither "No matches" nor "No channels yet" is the honest answer when there IS a
   * match. The operator types a name they can see in the list and the list empties.
   * ⚠ **THE FIX DOES NOT TOUCH THE `Earlier`-IS-CLOSED DEFAULT**, which `channel-wells.ts`
   * flags as the one part Samuel did not state: `WellsColumn`'s `forceOpen` opens the non-empty
   * wells while the list is NARROWED and writes nothing to the stored state.
   */
  it("🔒 a search whose only hit is filed under CLOSED Earlier still shows it", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();
    await screen.findByRole("heading", { name: "Recent" });
    expect(screen.queryByText("Cold Storage")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "Cold" },
    });

    expect(await screen.findByText("Cold Storage")).toBeInTheDocument();
    // ⚠ AND NO SENTENCE BESIDE IT — a match is not "No matches".
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  /** ⚠ **AND CLEARING THE QUERY RESTORES THE OPERATOR'S OWN SHAPE** — `forceOpen` is not a
   *  write, so `Earlier` closes again rather than staying open from a search. */
  it("🔒 clearing the search re-closes Earlier — forceOpen never persists", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();
    await screen.findByRole("heading", { name: "Recent" });

    const search = screen.getByLabelText("Search");
    fireEvent.change(search, { target: { value: "Cold" } });
    await screen.findByText("Cold Storage");
    fireEvent.change(search, { target: { value: "" } });

    await waitFor(() =>
      expect(screen.queryByText("Cold Storage")).not.toBeInTheDocument()
    );
  });

  /**
   * 🔒 **THE AGENTS TAB'S WELL, EXACTLY (Samuel, 2026-09-15, retracting the tab he
   * had asked for that morning):** *"Okay, I actually don't like the tab look.
   * Instead, let's just make it match the agents one directly, or the one on the
   * agents tab. Just make the gray dropdowns match exactly those instead."*
   */
  it("wears the Agents tab's well — full-width header INSIDE the box, one step darker so it reads", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();

    const row = await screen.findByRole("button", { name: "Recent" });
    // ⚠ THE HEADER IS THE AGENTS TAB'S: inside the box, full width, no fill of its
    // own. **Bidirectional on the tab's own marks**, or this passes on a page that
    // grew the tab back.
    expect(row.className).toContain("w-full");
    expect(row.className).not.toContain("self-start");
    expect(row.className).not.toContain("rounded-t-[14px]");
    expect(row.className).not.toContain("bg-");
    // ⚠ AND THE BOX IS THE WELL RECIPE, by the CONSTANT — same geometry as the
    // Agents tab's `PANEL_WELL`, one step darker.
    const well = row.closest("section")!;
    expect(well.className).toBe(PANEL_WELL_ON_PANEL);
    expect(PANEL_WELL_ON_PANEL).toContain("rounded-[14px]");
    // 🔒 **AND IT IS NOT `PANEL_WELL` (Samuel, same day: *"there's no gray
    // background on this at all"*).** THIS PAGE is why the fill had to move:
    // `index.tsx` paints `<main>` `bg-home-panel`, so the Agents tab's own fill
    // here is `#f1f3f5` on `#f1f3f5`. The assertion lives on the real page,
    // because that is the only place the collision is a fact.
    expect(well.className).not.toContain("bg-home-panel");
    expect(PANEL_WELL).toContain("bg-home-panel");
  });

  /**
   * 🔒 **THE CARD SHADOWS ARE NOT SLICED (Samuel, 2026-09-15):** *"there are these
   * like weird vertical shadows/the shadows are being cut off."* /home is where he
   * saw it, because these rows wear `HOME_CARD_FACE` — a heavier elevation than
   * the `.bento` cards the two tabs put in the same box.
   */
  it("leaves the card shadows bleed room inside the well's clip box", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();

    const row = await screen.findByRole("button", { name: "Recent" });
    const box = row.parentElement!.querySelector(".collapse-grid")!;
    // The clip box reaches 12px past the cards on each side…
    expect(box.className).toContain("-mx-3");
    // …and the column puts the rows back on the well's own inset, so no row moved.
    expect(box.firstElementChild!.className).toContain("px-3");
    // 🔒 **AND 12px BELOW THEM TOO (Samuel, 2026-09-17):** *"the last box or last
    // channel in each box gets cut off at the bottom … The shadowing and the bottom
    // border get cut off."* — the growth edge clipped flush with the last card, and
    // /home is again where he saw it, because the SELECTED row here is the black
    // button and carries the heaviest drop in the box.
    expect(box.className).toContain("pb-3");
    expect(box.className).toContain("-mb-3");
    // ⚠ AND THE ROW IS STILL THE RAISED FACE THAT NEEDED THE ROOM — bidirectional,
    // or this passes on a list whose shadow was simply removed.
    const card = within(box as HTMLElement).getByText("Priya Shah").closest("button")!;
    // ⚠ A RAISED KIT FACE EITHER WAY — this row is the SELECTED one (the black
    // button since 2026-09-15) and both faces carry an outer drop that the clip
    // box has to leave room for.
    expect(card.className).toMatch(/auth-btn-3d/);
  });

  /**
   * 🔒 **AND ALL THREE ARE ALWAYS DRAWN (Samuel, same message):** *"Also, I want
   * there to be something there, like the gray box. Basically, it will just be
   * empty until the user actually puts something in it, but I still want it to be
   * there."*
   */
  it("draws every well even with nothing in it — an empty Pinned box is still a box", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();

    await screen.findByRole("heading", { name: "Recent" });
    expect(
      screen
        .queryAllByRole("heading", { name: /Pinned|Recent|Earlier/ })
        .map((h) => h.textContent)
    ).toEqual(["Pinned", "Recent", "Earlier"]);
    // ⚠ THE EMPTY ONE IS A REAL WELL, not a heading on its own…
    const pinned = screen.getByRole("heading", { name: "Pinned" }).closest("section")!;
    expect(pinned.className).toBe(PANEL_WELL_ON_PANEL);
    // …and it carries NO placeholder sentence (minimal copy): the heading, the
    // chevron, and an empty column.
    expect(pinned.textContent).toBe("Pinned");
    // 🔒 **AND THE EMPTY COLUMN HAS NO PADDING OF ITS OWN (Samuel, same message:
    // *"when the gray box is retracted, the text isn't vertically centered"*)** —
    // 8px of body padding under a header with nothing beneath it is the dead band
    // he saw. The box is `p-3` + the header + `p-3`, and the header does not move
    // when the well fills.
    const emptyColumn = pinned.querySelector(".collapse-grid")!.firstElementChild!;
    expect(emptyColumn.className).not.toContain("pt-2");
  });

  /**
   * 🔒 **PINNED MEANS FAVOURITED, AND THE PIN IS THE BOOKMARK (Samuel,
   * 2026-09-15):** *"remove the pin icon that appears when i hover over the
   * picker. instead replace the bookmark icon next to the channel name with the
   * pin icon."* ⚠ **THE ROW'S OWN HOVER TOGGLE AND ITS `localStorage` STORE ARE
   * DELETED** — the well reads `HomeChannel.favoritedAt` off the wire, which is
   * `channel_members.favorited_at`, which is what the channel header's one toggle
   * has always written.
   */
  it("files a FAVOURITED channel under Pinned, off the wire", async () => {
    apiRequest.mockImplementation(
      withHome({
        channels: [
          { ...HOME.channels[0], favoritedAt: "2026-09-14T09:00:00.000Z" },
          ANCIENT,
        ],
        pendingLinks: [],
      })
    );
    renderHome();
    await openChannels();

    const pinned = (await screen.findByRole("heading", { name: "Pinned" })).closest(
      "section"
    )!;
    expect(within(pinned).getByText("Priya Shah")).toBeInTheDocument();
    // ⚠ ONE ROW, ONE WELL — **Recent** still DRAWS (`showEmpty`) and holds nothing.
    const recent = screen.getByRole("heading", { name: "Recent" }).closest("section")!;
    expect(recent.textContent).toBe("Recent");
    // 🚫 AND NO ROW-LEVEL PIN CONTROL SURVIVES — bidirectional, or this suite
    // would pass on a list that grew the deleted toggle back.
    expect(screen.queryByRole("button", { name: "Pin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
  });

  /**
   * 🔒 **THE STALE-CACHE CASE FOR THE NEW KEY (INVARIANTS §8).** `favoritedAt` is
   * new on an IndexedDB-persisted payload with a 24h `gcTime`, so the FIRST PAINT
   * after this bundle ships reads entries that DO NOT HAVE IT. The row must file
   * by its own recency — `undefined !== null` would drop the whole list into
   * **Pinned**.
   */
  it("files a row written before `favoritedAt` existed by its recency", async () => {
    const stale: Record<string, unknown> = { ...HOME.channels[0] };
    delete stale.favoritedAt;
    apiRequest.mockImplementation(
      withHome({
        channels: [stale as unknown as HomeChannelsPayload["channels"][number]],
        pendingLinks: [],
      })
    );
    renderHome();
    await openChannels();

    const recent = (await screen.findByRole("heading", { name: "Recent" })).closest(
      "section"
    )!;
    expect(within(recent).getByText("Priya Shah")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pinned" }).closest("section")!.textContent
    ).toBe("Pinned");
  });

  /**
   * 🔒 **THE BUG BEHIND *"the bookmark icon like alway breaks and is super
   * buggy"*, PINNED ON THE REAL PAGE.** The pin lives in TWO client caches —
   * `GET /api/channels` (what the header's toggle patches) and
   * `GET /api/home/channels` (what this list renders) — and the write only ever
   * told the first. `use-home-channel-sync.ts` is the bridge; this is the case
   * that fails without it.
   */
  it("moves the row into Pinned when the CHANNELS cache learns of a pin", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    const { client } = renderHome();
    await openChannels();
    await screen.findByRole("heading", { name: "Recent" });

    // The header's toggle patches the channels cache optimistically; the bridge
    // copies the fact across, so the well moves on the CLICK and not on a reload.
    act(() => {
      client.setQueryData(
        channelKeys.list().entry({ workspaceId: HOME.channels[0].workspaceId }),
        {
          channels: [
            {
              id: HOME.channels[0].channelId,
              myFavoritedAt: "2026-09-15T09:00:00.000Z",
            },
          ],
        }
      );
    });

    await waitFor(() => {
      const pinned = screen
        .getByRole("heading", { name: "Pinned" })
        .closest("section")!;
      expect(within(pinned).getByText("Priya Shah")).toBeInTheDocument();
    });
  });

  it("files a pending link row by its `at`, and it can never be pinned", async () => {
    apiRequest.mockImplementation(
      withHome({ channels: [], pendingLinks: HOME.pendingLinks })
    );
    renderHome();
    await openChannels();

    // The link was minted an hour ago (the harness's own stamp), so it is Recent.
    const recent = (await screen.findByRole("heading", { name: "Recent" })).closest(
      "section"
    )!;
    expect(within(recent).getByText("Not yet claimed")).toBeInTheDocument();
    // ⚠ A LINK HAS NO CHANNEL, so there is no membership row to carry a pin.
    expect(
      screen.getByRole("heading", { name: "Pinned" }).closest("section")!.textContent
    ).toBe("Pinned");
  });

  it("keeps the two empty sentences BESIDE the three empty wells", async () => {
    apiRequest.mockImplementation(withHome({ channels: [], pendingLinks: [] }));
    renderHome();
    await openChannels();

    // ⚠ BOTH, AND THAT IS NOT THE PLACEHOLDER COPY MINIMAL-COPY FORBIDS: three
    // empty boxes cannot say WHICH emptiness this is, and the 2026-09-10 ruling
    // that separates "No channels yet" from "No matches" is still live.
    expect(await screen.findByText("No channels yet")).toBeInTheDocument();
    expect(
      screen
        .queryAllByRole("heading", { name: /Pinned|Recent|Earlier/ })
        .map((h) => h.textContent)
    ).toEqual(["Pinned", "Recent", "Earlier"]);
  });
});
