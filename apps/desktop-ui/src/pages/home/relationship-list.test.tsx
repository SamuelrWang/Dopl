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
 * THE LIST COLUMN AS SAMUEL RE-SPECIFIED IT (live review 2026-09-13): a header
 * BAR where a bare avatar used to float in empty space, and channel rows whose
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
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

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

describe("the list column's HEADER BAR", () => {
  it("is one bar reading the operator's first name, and it is still the settings trigger", async () => {
    apiRequest.mockImplementation(withHome(HOME));
    renderHome();

    // ⚠ FOUND BY THE SETTINGS LABEL, which is the whole point: the bar is that
    // button's FACE, not a second control beside it.
    const bar = await screen.findByRole("button", { name: "Settings" });
    // `/api/user/profile` answers "Sam Operator" — the FIRST word, possessive.
    await waitFor(() => expect(bar).toHaveTextContent("Sam's Home"));
    // It spans the cell, so the "empty space [that] looks weird" is gone.
    expect(bar.className).toMatch(/w-full/);
    // ⚠ THE SAME CARD FACE THE ROWS WEAR — asserted as the kit recipe rather
    // than as a colour, since that is the thing shared with the rows.
    expect(bar.className).toMatch(/auth-btn-3d-light/);
    expect(bar.className).toMatch(/rounded-\[14px\]/);
  });

  it("opens settings from the bar", async () => {
    apiRequest.mockImplementation(withHome(HOME));
    renderHome();
    const bar = await screen.findByRole("button", { name: "Settings" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    bar.click();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });

  /**
   * ⚠ THE NAMELESS CASE IS NOT HYPOTHETICAL — it is EVERY FIRST PAINT, because
   * `/api/user/profile` is still in flight then. "Home" alone is the answer; a
   * possessive built from an email address is the thing this must never print.
   */
  it("says just `Home` with no display name, and never builds one from the email", () => {
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
