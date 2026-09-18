import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge } from "#/test-utils/bridge";
import type { Channel, ChannelListPayload } from "@/features/channels/types";
import {
  CROWDED_CHANNEL,
  HOME,
  MENTIONED_CHANNEL,
  SOLO_CHANNEL,
  UNREAD_CHANNEL,
  openChannels,
  renderHome,
  withHome,
} from "./home-test-harness";
import {
  HOME_CARD_FACE,
  HOME_CARD_FACE_SELECTED,
} from "./channel-row-marks";

/**
 * THE LIST COLUMN AS SAMUEL RE-SPECIFIED IT (live reviews 2026-09-13 and
 * 2026-09-15): the page's one primary action at its head, and channel rows whose
 * second line is the ROSTER plus an unread signal instead of a paraphrase of the
 * last message.
 *
 * ⚠ **ITS OWN SUITE, not more cases in `index.test.tsx`** (a page SHAPE smoke
 * test, already at the §1 cap). What lives here is the ROW: the column's head, the
 * row's two lines, its marks, and its selected face.
 *
 * ⚠ **THE WELLS ARE NEXT DOOR SINCE 2026-09-15** — `channel-wells-render.test.tsx`.
 * **The seam is the ROW versus the COLUMN'S STRUCTURE**: what one row looks like
 * here, which gray box it lands in there. Both render through the real page and
 * share `home-test-harness.tsx`.
 *
 * ⚠ RENDERED THROUGH THE REAL PAGE, not by mounting `RelationshipList` with
 * props. The row reads two NEW keys off a cached payload, and the thing worth
 * pinning is that the wire shape reaches them — a hand-built prop proves the
 * component and says nothing about the read.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

/** The header's list-width CELL (`home-header.tsx`) as a `closest` selector. */
const CELL = ".w-\\[var\\(--home-list-w\\)\\]";

/** One channel and no legacy link row, so a case owns the whole column. */
function onlyChannel(
  channel: Channel
): ChannelListPayload {
  return { channels: [channel], pendingLinks: [] };
}

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

/**
 * ⚠ **WHAT HEADS THE COLUMN** — the "New channel" pill since 2026-09-15 (Samuel:
 * *"ok actually, move the new channel button to be where the search bar now is.
 * It will be left aligned basically. And move the search bar back"*). The
 * operator's own control is `index.test.tsx`'s.
 */
describe("the list column's HEAD", () => {
  it("is the New channel pill, left-aligned, and nothing else", async () => {
    apiRequest.mockImplementation(withHome(HOME));
    renderHome();

    // In the list-width cell, so its LEFT edge lands on the rows' left edge.
    const create = await screen.findByRole("button", { name: "New channel" });
    expect(create.closest(CELL)).not.toBeNull();
    // ⚠ HUGGING ITS LABEL, NOT STRETCHED (Samuel's "left aligned basically").
    expect(create.className).not.toMatch(/w-full/);
    // 🚫 AND THE TWO THINGS THAT USED TO HEAD IT ARE NOT BACK — bidirectional, or
    // this suite would pass on a page that grew the bar or the field back above
    // the rows.
    expect(screen.queryByText(/'s Home$/)).toBeNull();
    expect(screen.getByLabelText("Search").closest(CELL)).toBeNull();
  });

  it("opens settings from the operator's Profile pill, which is NOT in the column", async () => {
    apiRequest.mockImplementation(withHome(HOME));
    renderHome();
    // ⚠ "Profile", NOT "Settings", since 2026-09-15 — the control has a visible
    // label now and the accessible name is it.
    const control = await screen.findByRole("button", { name: "Profile" });
    expect(control.closest(CELL)).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    control.click();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});

describe("the channel ROW's second line", () => {
  it("shows the peer stack and NOT the last message", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(CROWDED_CHANNEL)));
    renderHome();
    await openChannels();

    // 🔒 THE PREVIEW IS GONE THOUGH THE PAYLOAD STILL CARRIES IT.
    expect(
      screen.queryByText("Three renewals over $1k before October")
    ).not.toBeInTheDocument();
    // THREE faces, from `peers` — `AvatarStack` titles each one, so the roster is
    // assertable without reaching into its markup.
    for (const name of ["Priya Shah", "Dana Ruiz", "Omar Idris"]) {
      expect(screen.getAllByTitle(name).length).toBeGreaterThan(0);
    }
  });

  it("caps the stack at three faces and counts the rest", async () => {
    apiRequest.mockImplementation(
      withHome(
        onlyChannel({
          ...CROWDED_CHANNEL,
          peers: [
            ...CROWDED_CHANNEL.peers,
            { userId: "user-5", displayName: "Ada Byron", email: null, avatarUrl: null },
          ],
        })
      )
    );
    renderHome();
    await openChannels();

    // ⚠ `+1` IS WHAT IS HIDDEN, NOT THE TOTAL (`AvatarStack`'s own rule).
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.queryByTitle("Ada Byron")).not.toBeInTheDocument();
  });

  it("shows NOTHING on the left for a solo channel — no faces, no `Just you`", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(SOLO_CHANNEL)));
    renderHome();
    await openChannels();

    expect(await screen.findByText("Q3 Fundraise")).toBeInTheDocument();
    expect(screen.queryByText(/just you/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle("Priya Shah")).not.toBeInTheDocument();
  });
});

/**
 * 🔒 **THE DESCRIPTION LINE, AND THE RULE THAT DECIDES WHEN IT APPEARS AT ALL**
 * (Samuel, 2026-09-15): under the channel name, italic — but only on a channel
 * with NOBODY else in it. A channel with other people keeps the profile icons it
 * has today.
 *
 * ⚠ **THE TWO ARE ALTERNATIVES AND BOTH DIRECTIONS ARE PINNED**, because the
 * cheap half-implementation passes a one-sided test: printing the description
 * ALWAYS still satisfies "a solo channel shows it". The crowded case below is the
 * one that fails that.
 * ⚠ RENDERED THROUGH THE REAL PAGE, on this file's own standing rule — the value
 * is a NEW key on the wire payload, and a hand-built prop would prove the markup
 * while saying nothing about whether the read reaches it.
 */
describe("the row's DESCRIPTION line", () => {
  /** SOLO plus a description — the only shape that draws the line. */
  const DESCRIBED = {
    ...SOLO_CHANNEL,
    topic: "Series B prep and the diligence room",
  };

  it("prints the description under the name when nobody else is in the channel", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(DESCRIBED)));
    renderHome();
    await openChannels();

    expect(
      await screen.findByText("Series B prep and the diligence room")
    ).toBeInTheDocument();
  });

  it("renders it ITALIC, which is the whole of the styling ruling", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(DESCRIBED)));
    renderHome();
    await openChannels();

    const line = await screen.findByText("Series B prep and the diligence room");
    expect(line.className).toContain("italic");
  });

  it("shows the FACES and not the description when the channel has other people", async () => {
    // ⚠ THE FIXTURE CARRIES A DESCRIPTION ON PURPOSE. The rule is about the
    // ROSTER, not about whether a description exists — a crowded channel with one
    // written must still show icons, or the line would be "print it when you have
    // one", which is a different feature.
    apiRequest.mockImplementation(
      withHome(onlyChannel({ ...CROWDED_CHANNEL, topic: "Series B prep" }))
    );
    renderHome();
    await openChannels();

    expect(screen.getAllByTitle("Priya Shah").length).toBeGreaterThan(0);
    expect(screen.queryByText("Series B prep")).not.toBeInTheDocument();
  });

  it("draws no line at all for a solo channel nobody described", async () => {
    // ⚠ `""` IS THE COLUMN DEFAULT, so this is every channel until somebody writes
    // one — the row must keep today's look rather than open an empty italic slot.
    apiRequest.mockImplementation(withHome(onlyChannel({ ...SOLO_CHANNEL, topic: "" })));
    renderHome();
    await openChannels();

    const row = (await screen.findByText("Q3 Fundraise")).closest("button");
    expect(row?.querySelector(".italic")).toBeNull();
  });

  it("survives a cached payload written before `topic` existed", async () => {
    // 🔒 INVARIANTS §8: `GET /api/channels?scope=account` is IndexedDB-persisted with a 24h
    // `gcTime`, so the first paint after this bundle ships reads entries with NO
    // such key. The read spells `?? ""`, so the row degrades to today's look
    // instead of printing `undefined` under the channel name.
    const stale = { ...SOLO_CHANNEL } as Partial<typeof SOLO_CHANNEL>;
    delete stale.topic;
    apiRequest.mockImplementation(
      withHome(onlyChannel(stale as typeof SOLO_CHANNEL))
    );
    renderHome();
    await openChannels();

    expect(await screen.findByText("Q3 Fundraise")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});

describe("the row's UNREAD MARKS", () => {
  it("prints `@ 3` for three unread mentions", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(MENTIONED_CHANNEL)));
    renderHome();
    await openChannels();

    const badge = await screen.findByText("@ 3");
    // ⚠ **THE INVERTED PAIR, BECAUSE THIS ROW IS THE SELECTED ONE** — /home
    // selects the first row on load and the selected row has been the page's
    // BLACK BUTTON since 2026-09-15, so the pill swaps its two tokens rather
    // than printing ink on ink. The unselected pair is asserted in
    // `the SELECTED row's face` below, on a row that is not selected.
    expect(badge.className).toMatch(/bg-text-on-cta/);
    expect(badge.className).toMatch(/text-surface-cta/);
    // ⚠ AND NO DOT BESIDE IT: the two marks are exclusive, or one fact reads as
    // two.
    expect(screen.queryByLabelText("Unread messages")).not.toBeInTheDocument();
  });

  it("falls back to a plain dot when there are unread messages but no mentions", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(UNREAD_CHANNEL)));
    renderHome();
    await openChannels();

    expect(await screen.findByLabelText("Unread messages")).toBeInTheDocument();
    expect(screen.queryByText(/^@ /)).not.toBeInTheDocument();
  });

  it("shows neither mark on a fully read channel — and never an `@ 0` pill", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(HOME.channels[0])));
    renderHome();
    await openChannels();

    expect(await screen.findByText("Priya Shah")).toBeInTheDocument();
    expect(screen.queryByLabelText("Unread messages")).not.toBeInTheDocument();
    expect(screen.queryByText("@ 0")).not.toBeInTheDocument();
  });

  /**
   * 🔒 **THE STALE-CACHE CASE (INVARIANTS §8).** `GET /api/channels?scope=account` is
   * IndexedDB-persisted with a 24h `gcTime`, so the FIRST PAINT after this bundle
   * ships serves entries written by the previous one — which have NEITHER new key.
   * `unread` reads `?? false` and `mentionCount` reads `?? 0`, so the row paints
   * with no marks rather than printing `@ NaN` or dotting every row in the list.
   *
   * ⚠ THE CAST IS THE POINT. Both wire types are non-optional and are RIGHT; the
   * `delete` reproduces the one moment they are absent, which typing the fixture
   * would make unrepresentable.
   */
  it("paints no marks at all on a payload written before the fields existed", async () => {
    const stale: Record<string, unknown> = { ...MENTIONED_CHANNEL };
    delete stale.unread;
    // ⚠ `mentionCount` SINCE WAVE 3 (R-26) — the badge's field moved with the
    // projection, and this fixture deletes the key the row actually reads.
    delete stale.mentionCount;
    apiRequest.mockImplementation(
      withHome(
        onlyChannel(stale as unknown as Channel)
      )
    );
    renderHome();
    await openChannels();

    // The row still renders — the absent keys must not blank the column.
    expect(await screen.findByText("Priya Shah")).toBeInTheDocument();
    expect(screen.queryByLabelText("Unread messages")).not.toBeInTheDocument();
    expect(screen.queryByText(/^@ /)).not.toBeInTheDocument();
  });
});


/**
 * 🔒 **THE SELECTED ROW IS THE PAGE'S BLACK BUTTON (Samuel, 2026-09-15):** *"for
 * the channel picker, for the selected channel, can we have it turn into like
 * the black button UI? And drop the shadow that currently goes on the
 * selected?"*
 *
 * ⚠ **THE ASSERTIONS ARE BIDIRECTIONAL ON PURPOSE.** "Drop the shadow" is a
 * NEGATIVE ruling — what makes it true is that `.selected-ring` and the module's
 * line are ABSENT, and a suite that only checked for the black face would pass on
 * a row wearing both.
 */
describe("the SELECTED row's face", () => {
  /** The row button for a channel, by its name. ⚠ SCOPED TO THE WELLS — the
   *  record pane names the same channel, so an unscoped query finds two, and the
   *  header's own list-width cell matches `CELL` first. Every row lives inside a
   *  well's animated box and nothing else on this page does. */
  function rowFor(name: string): HTMLElement {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".collapse-grid")
    );
    for (const box of rows) {
      const hit = within(box).queryByText(name);
      if (hit) return hit.closest("button")!;
    }
    throw new Error(`no row for ${name}`);
  }

  it("turns black, and carries no ring, halo or white card face with it", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(HOME.channels[0])));
    renderHome();
    await openChannels();

    const row = rowFor("Priya Shah");
    // /home selects the first row on load, so this one IS the selected one.
    expect(row.getAttribute("aria-current")).toBe("true");
    // ⚠ THE CONSTANT, not a copy of its value — and it is the kit recipe the
    // page's own "New channel" pill wears.
    expect(row.className).toContain(HOME_CARD_FACE_SELECTED);
    expect(HOME_CARD_FACE_SELECTED).toContain("auth-btn-3d");
    // 🚫 AND NOTHING OF THE OLD SELECTION SURVIVES.
    expect(row.className).not.toContain("selected-ring");
    expect(row.className).not.toContain("rowSelected");
    expect(row.className).not.toContain(HOME_CARD_FACE);
    // ⚠ GEOMETRY UNCHANGED, so selecting a row cannot shift the list: the box is
    // the same padding on the same radius, only the paint moved.
    expect(row.className).toContain("px-2.5 py-2.5");
    expect(HOME_CARD_FACE_SELECTED).toContain("rounded-[14px]");
    expect(HOME_CARD_FACE).toContain("rounded-[14px]");
  });

  it("keeps the WHITE raised face on every row that is not selected", async () => {
    apiRequest.mockImplementation(
      withHome({
        channels: [
          HOME.channels[0],
          { ...HOME.channels[0], workspaceId: "ws-2", name: "Cold Storage" },
        ],
        pendingLinks: [],
      })
    );
    renderHome();
    await openChannels();

    const other = rowFor("Cold Storage");
    expect(other.getAttribute("aria-current")).toBeNull();
    expect(other.className).toContain(HOME_CARD_FACE);
    expect(other.className).not.toContain(HOME_CARD_FACE_SELECTED);
  });

  /**
   * ⚠ **LEGIBILITY IS THE OTHER HALF OF THE RULING.** Everything on the row that
   * was muted ink is `--text-on-cta` at an alpha on the black face — the ONE
   * on-dark ink token either file declares — and the two unread marks INVERT
   * rather than dim, because a black pill on a black card is not a quiet badge.
   */
  it("inverts the mention pill on the selected row instead of hiding it", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(MENTIONED_CHANNEL)));
    renderHome();
    await openChannels();

    const badge = await screen.findByText("@ 3");
    expect(badge.className).toMatch(/bg-text-on-cta/);
    expect(badge.className).toMatch(/text-surface-cta/);
    // 🚫 NOT the unselected pair, which would be ink on ink.
    expect(badge.className).not.toMatch(/bg-surface-cta\b/);
  });

  it("keeps the BLACK pill on a row that is not selected", async () => {
    apiRequest.mockImplementation(
      withHome({
        channels: [
          HOME.channels[0],
          { ...MENTIONED_CHANNEL, workspaceId: "ws-2", name: "Cold Storage" },
        ],
        pendingLinks: [],
      })
    );
    renderHome();
    await openChannels();

    const badge = await screen.findByText("@ 3");
    expect(badge.closest("button")!.getAttribute("aria-current")).toBeNull();
    expect(badge.className).toMatch(/bg-surface-cta/);
    expect(badge.className).toMatch(/text-text-on-cta/);
  });

  it("puts the unread dot in the on-CTA ink on the selected row", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(UNREAD_CHANNEL)));
    renderHome();
    await openChannels();

    const dot = await screen.findByLabelText("Unread messages");
    expect(dot.className).toContain("bg-text-on-cta");
    expect(dot.className).not.toContain("bg-text-primary");
  });

  it("dims the timestamp to the on-CTA token rather than naming a grey", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(HOME.channels[0])));
    renderHome();
    await openChannels();

    const row = rowFor("Priya Shah");
    // ⚠ ONE on-dark ink token exists (`--text-on-cta`); the quieter lines take it
    // at an alpha. A `text-text-muted` here would be unreadable on black.
    expect(row.innerHTML).toContain("text-text-on-cta/70");
    expect(row.innerHTML).not.toContain("text-text-muted");
  });
});
