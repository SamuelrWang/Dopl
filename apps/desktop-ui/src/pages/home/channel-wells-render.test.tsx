import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge } from "#/test-utils/bridge";
import type { Channel, ChannelListPayload } from "@/features/channels/types";
import { WELL_FACES } from "@/features/channels/components/collapse-wells";
import { channelKeys } from "@/features/channels/client/query-keys";
// ⚠ **A FRESH APP CONTEXT PER CASE (2026-09-20).** This column's wells remember
// their collapses in a MODULE map rather than `localStorage`, because Samuel ruled
// they reset when the app restarts and survive a page change (`well-state.ts`). A
// module map outlives `cleanup()`, so without this a case that opens **Earlier**
// leaves it open for the next one.
import { resetSessionWells } from "@/features/channels/components/well-state";
import { HOME, openChannels, renderHome, withHome } from "./home-test-harness";

/**
 * /home's CHANNEL COLUMN AS THREE COLLAPSIBLE WELLS — the structure, not the row.
 *
 * ⚠ **SPLIT OUT OF `relationship-list.test.tsx` ON 2026-09-15** (the §1 cap).
 * **The seam is the ROW versus the COLUMN'S STRUCTURE**: what one row looks like
 * belongs there, which well it lands in belongs here. Both render through the
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
  resetSessionWells();
});

/**
 * 🔒 **THE COLUMN IS THREE WELLS SINCE 2026-09-15 (Samuel, verbatim):**
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
  const ANCIENT: Channel = {
    ...HOME.channels[0],
    workspaceId: "ws-ancient",
    name: "Cold Storage",
    createdAt: "2026-02-01T09:00:00.000Z",
    lastMessageAt: "2026-02-03T09:00:00.000Z",
  };

  /** The default (minutes old) channel plus the ancient one, no legacy link row. */
  const SPREAD: ChannelListPayload = {
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
   * 🔒 **NEITHER OF THE TWO SEARCH CASES THAT STOOD HERE SURVIVES (2026-09-17)** — "a
   * search whose only hit is filed under CLOSED `Earlier` still shows it" (2026-09-16) and
   * "clearing the search re-closes `Earlier`". **They described `forceOpen`, and `forceOpen`
   * is DELETED with the narrowing it existed for** (Samuel's popup ruling: *"during search …
   * it like removes channel on the left sidebar"*). A query cannot empty this column any
   * more, so a hit it could hide behind a closed well is not a state the page has.
   *
   * ⚠ **WHAT REPLACES THEM IS THE OPPOSITE ASSERTION**, and it lives in `index.test.tsx`
   * (`typing leaves the list alone`): the wells keep the operator's own open/closed shape
   * while a query runs, because the query no longer touches them.
   */
  it("🔒 typing does not open, close or empty a well", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();
    await screen.findByRole("heading", { name: "Recent" });
    // `Earlier` is closed, so its row is unmounted — and a query does not change that.
    expect(screen.queryByText("Cold Storage")).not.toBeInTheDocument();

    const search = screen.getByLabelText("Search");
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "Cold" } });

    expect(screen.queryByText("Cold Storage")).not.toBeInTheDocument();
    expect(within(screen.getByRole("heading", { name: "Recent" }).closest("section")!)
      .getByText("Priya Shah")).toBeInTheDocument();
  });

  /** The staging look: each well is a plain uppercase heading over the row cards, no box. */
  it("heads each well with a plain uppercase heading and draws no gray box", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    renderHome();
    await openChannels();

    const row = await screen.findByRole("button", { name: "Recent" });
    expect(row.className).toContain("w-full");
    expect(row.className).toContain("uppercase");
    expect(row.className).not.toContain("bg-");
    const well = row.closest("section")!;
    expect(well.className).toBe(WELL_FACES.rail.box);
    expect(well.className).not.toContain("bg-");
  });

  /**
   * 🔒 **THE CARD SHADOWS ARE NOT SLICED (Samuel, 2026-09-15):** *"there are these
   * like weird vertical shadows/the shadows are being cut off."* /home is where he
   * saw it, because these rows are lifted cards.
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
    expect(card.className).toContain("raise");
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
    const pinned = screen.getByRole("heading", { name: "Pinned" }).closest("section")!;
    expect(pinned.className).toBe(WELL_FACES.rail.box);
    // …and it carries NO placeholder sentence (minimal copy): the heading, the
    // chevron, and an empty column.
    expect(pinned.textContent).toBe("Pinned");
    // An empty well carries no body padding, so its heading does not hang a dead band.
    const emptyColumn = pinned.querySelector(".collapse-grid")!.firstElementChild!;
    expect(emptyColumn.className).not.toContain("pt-2");
  });

  /**
   * 🔒 **PINNED MEANS FAVOURITED, AND THE PIN IS THE BOOKMARK (Samuel,
   * 2026-09-15):** *"remove the pin icon that appears when i hover over the
   * picker. instead replace the bookmark icon next to the channel name with the
   * pin icon."* ⚠ **THE ROW'S OWN HOVER TOGGLE AND ITS `localStorage` STORE ARE
   * DELETED** — the well reads `HomeChannel.myFavoritedAt` off the wire, which is
   * `channel_members.favorited_at`, which is what the channel header's one toggle
   * has always written.
   */
  it("files a FAVOURITED channel under Pinned, off the wire", async () => {
    apiRequest.mockImplementation(
      withHome({
        channels: [
          { ...HOME.channels[0], myFavoritedAt: "2026-09-14T09:00:00.000Z" },
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
   * 🔒 **THE STALE-CACHE CASE FOR THE NEW KEY (INVARIANTS §8).** `myFavoritedAt` is
   * new on an IndexedDB-persisted payload with a 24h `gcTime`, so the FIRST PAINT
   * after this bundle ships reads entries that DO NOT HAVE IT. The row must file
   * by its own recency — `undefined !== null` would drop the whole list into
   * **Pinned**.
   */
  it("files a row written before `myFavoritedAt` existed by its recency", async () => {
    const stale: Record<string, unknown> = { ...HOME.channels[0] };
    delete stale.myFavoritedAt;
    apiRequest.mockImplementation(
      withHome({
        channels: [stale as unknown as Channel],
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
   * 🔒 **THE BUG BEHIND *"the bookmark icon like alway breaks and is super buggy"*,
   * AND WHAT ACTUALLY FIXED IT (Samuel's ruling R-26 (b), Wave 3).** The pin used
   * to live in TWO client caches — `GET /api/channels` (what the header's toggle
   * patches) and `GET /api/home/channels` (what this list rendered) — and the write
   * only ever told the first. **A 113-line cache-to-cache bridge carried it across;
   * that bridge is DELETED, because there is one entry now.**
   *
   * ⚠ **THIS CASE IS THE PROOF, AND IT IS WHY IT PATCHES THE ACCOUNT ENTRY BY ITS
   * OWN MINTER.** The header's optimistic write reaches this list because the read
   * and the write register the SAME key — not because something copies between two.
   * A hand-typed tuple here would pass while the real minter drifted, which is the
   * failure `shared/api/query-keys.ts` opens with.
   */
  it("moves the row into Pinned off the ONE cache entry, with no bridge", async () => {
    apiRequest.mockImplementation(withHome(SPREAD));
    const { client } = renderHome();
    await openChannels();
    await screen.findByRole("heading", { name: "Recent" });

    act(() => {
      client.setQueryData<ChannelListPayload>(
        channelKeys.list().entry({ query: { scope: "account" } }),
        (prev) => ({
          channels: (prev?.channels ?? []).map((row) => ({
            ...row,
            myFavoritedAt: "2026-09-15T09:00:00.000Z",
          })),
          pendingLinks: prev?.pendingLinks ?? [],
        })
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
