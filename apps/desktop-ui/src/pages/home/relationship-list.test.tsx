import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge } from "#/test-utils/bridge";
import type { HomeChannelsPayload } from "@/features/home/types";
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
import { homeBarLabel } from "./home-settings-control";

/**
 * THE LIST COLUMN AS SAMUEL RE-SPECIFIED IT (live reviews 2026-09-13 and
 * 2026-09-15): the page's one primary action at its head, and channel rows whose
 * second line is the ROSTER plus an unread signal instead of a paraphrase of the
 * last message.
 *
 * ⚠ **ITS OWN SUITE, not more cases in `index.test.tsx`** — that file is a page
 * SHAPE smoke test and has already crossed the 500-line cap twice (its own
 * docblock, and `home-links.test.tsx` is the first split). What lives here is the
 * COLUMN: the bar's copy, the marks, and what the row no longer says.
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
  channel: HomeChannelsPayload["channels"][number]
): HomeChannelsPayload {
  return { channels: [channel], pendingLinks: [] };
}

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

/**
 * ⚠ **THE HEAD OF THIS COLUMN HAS BEEN FOUR THINGS AND THE LAST TWO WERE THE
 * SAME DAY.** A bare avatar (2026-08-30), a "{Name}'s Home" bar (2026-09-13), the
 * SEARCH FIELD for one revision, and — 2026-09-15, Samuel: *"ok actually, move
 * the new channel button to be where the search bar now is. It will be left
 * aligned basically. And move the search bar back"* — the "New channel" pill.
 * What is pinned here is what this suite owns: WHAT HEADS THE COLUMN. The
 * operator's own control is `index.test.tsx`'s, where the settings entry has
 * always been pinned.
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

  /**
   * 🔒 **THE HELPER HAS NO RENDERER AS OF 2026-09-15 AND THIS IS THE ONLY THING
   * HOLDING IT** (`home-settings-control.tsx › homeBarLabel` carries the same
   * note). Kept because the RULE is the part worth not re-deriving if /home ever
   * grows a possessive label again — the first word, and never one built from an
   * email address. **Delete both together, or neither.**
   */
  it("`homeBarLabel` still takes the first word, and never builds one from the email", () => {
    expect(homeBarLabel(null)).toBe("Home");
    expect(homeBarLabel("   ")).toBe("Home");
    expect(homeBarLabel("Sam Operator")).toBe("Sam's Home");
    // One word is already the first word.
    expect(homeBarLabel("Priya")).toBe("Priya's Home");
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

describe("the row's UNREAD MARKS", () => {
  it("prints `@ 3` for three unread mentions", async () => {
    apiRequest.mockImplementation(withHome(onlyChannel(MENTIONED_CHANNEL)));
    renderHome();
    await openChannels();

    const badge = await screen.findByText("@ 3");
    expect(badge.className).toMatch(/bg-surface-cta/);
    expect(badge.className).toMatch(/text-text-on-cta/);
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
   * 🔒 **THE STALE-CACHE CASE (INVARIANTS §8).** `GET /api/home/channels` is
   * IndexedDB-persisted with a 24h `gcTime`, so the FIRST PAINT after this bundle
   * ships serves entries written by the previous one — which have NEITHER new key.
   * `unread` reads `?? false` and `unreadMentions` reads `?? 0`, so the row paints
   * with no marks rather than printing `@ NaN` or dotting every row in the list.
   *
   * ⚠ THE CAST IS THE POINT. Both wire types are non-optional and are RIGHT; the
   * `delete` reproduces the one moment they are absent, which typing the fixture
   * would make unrepresentable.
   */
  it("paints no marks at all on a payload written before the fields existed", async () => {
    const stale: Record<string, unknown> = { ...MENTIONED_CHANNEL };
    delete stale.unread;
    delete stale.unreadMentions;
    apiRequest.mockImplementation(
      withHome(
        onlyChannel(stale as unknown as HomeChannelsPayload["channels"][number])
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
