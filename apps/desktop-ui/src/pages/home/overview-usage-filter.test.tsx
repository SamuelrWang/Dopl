import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge } from "#/test-utils/bridge";
import {
  isAccountChannels,
  renderHome,
  routes,
} from "./home-test-harness";
import { CHANNEL_ID } from "./home-test-ids";
import { monthKey, shiftMonthKey, monthLabel } from "./overview-usage-filter";

/**
 * /home → OVERVIEW → **THE USAGE HISTOGRAM'S TWO CONTROLS** — the scope dropdown
 * that replaced the `Credits used` heading, and the month arrows beside it
 * (Samuel, 2026-09-13).
 *
 * ⚠ **ITS OWN FILE.** `overview-panels.test.tsx` owns the face's STRUCTURE and
 * measured 495 of the 500-line cap the day these landed (§1 —
 * `eslint.config.mjs › max-lines`, no exemptions under `apps/*​/src/**`); these
 * cases own one pair of controls and the READ PATHS they produce, which is a
 * different reason to change.
 *
 * 🔒 **WHAT IS PINNED IS THE REQUEST, NOT THE BARS.** Both controls do their work
 * by narrowing `GET /api/home/overview-series`, so the assertion that matters is
 * which path the pane asks for — the binning itself is the server's and is pinned
 * in `src/features/home/server/overview-series-params.test.ts`.
 *
 * ⚠ **THE MONTH IS DERIVED, NEVER WRITTEN OUT.** A literal `"2026-09"` here is a
 * suite that goes red on 1 October, so every expectation is built from
 * `monthKey()` / `shiftMonthKey()` — the same functions the control uses.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED, like every other suite on this page.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

const seriesCalls = () =>
  bridgeCalls(apiRequest)
    .filter((call) => call.path.startsWith("/api/home/overview-series"))
    .map((call) => call.path);

const histogram = () => screen.findByRole("region", { name: "Usage histogram" });

/** Open the scope menu. ⚠ `SelectMenu` is a Popover, so the options are
 *  `role="menuitem"` OUTSIDE the card — never `within(histogram)`. */
async function openScope(): Promise<void> {
  const card = await histogram();
  fireEvent.click(within(card).getByRole("button", { name: "Usage scope" }));
  await screen.findByRole("menuitem", { name: "All channels" });
}

describe("the /home Usage histogram controls", () => {
  beforeEach(() => {
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
   * 🔒 **ALL CHANNELS, THEN ONE ENTRY PER CHANNEL, THEN DESKTOP AGENT (Samuel:
   * *"all channels / specific channels / just desktop agent usage"*)** — in that
   * order, because Desktop agent is not a channel and must not sit among them.
   *
   * ⚠ **THE CHANNEL ROWS ARE `GET /api/channels?scope=account`' — THE LEFT
   * PANE'S OWN READ, through the SAME G3 filter (`home-rows.ts › homeChannels`).**
   * The hook keys on path + params, so the dropdown is a cache hit and costs no
   * request; the fixture's one channel is the row the pane shows.
   */
  it("lists All channels, every home channel, then Desktop agent — and adds no read", async () => {
    renderHome();
    const before = bridgeCalls(apiRequest).filter(
      (call) => isAccountChannels(call.path)
    ).length;
    await openScope();

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent)
    ).toEqual([
      "All channels",
      "Priya Shah",
      expect.stringContaining("Desktop agent"),
    ]);
    // ⚠ AND THE DEFAULT IS `All channels` — the trigger says so before it opens.
    expect(bridgeCalls(apiRequest).filter(
      (call) => isAccountChannels(call.path)
    ).length).toBe(before);
  });

  /**
   * 🔒 **THE DEFAULT SELECTION SENDS NO `channel` PARAM AT ALL**, so the pane's
   * first read is byte-for-byte the path it has always been — one cache entry
   * shared with every other mount of this face.
   */
  it("asks for the unnarrowed series until something is picked", async () => {
    renderHome();
    await histogram();
    await waitFor(() => expect(seriesCalls().length).toBeGreaterThan(0));

    expect(seriesCalls()).toContain(
      "/api/home/overview-series?range=month&metric=credits"
    );
    expect(seriesCalls().every((path) => !path.includes("channel="))).toBe(true);
    expect(seriesCalls().every((path) => !path.includes("month="))).toBe(true);
  });

  /**
   * 🔒 **PICKING A CHANNEL REFETCHES WITH `channel=<CHANNEL id>` SINCE 2026-09-13
   * (rule B)** — the channel's OWN id, not its container's. ⚠ **THIS CASE ASSERTED
   * THE CONTAINER ID UNTIL THIS WAVE**, when the ledger had no channel column and
   * its channel dimension was the addressed container; under rule B a home
   * channel's agent can burn credits while addressing ANOTHER container, and the
   * container id would miss exactly those rows.
   */
  it("refetches with channel=<id> when a channel is picked", async () => {
    renderHome();
    await openScope();

    fireEvent.click(screen.getByRole("menuitem", { name: "Priya Shah" }));

    await waitFor(() =>
      expect(seriesCalls()).toContain(
        `/api/home/overview-series?range=month&metric=credits&channel=${CHANNEL_ID}`
      )
    );
  });

  /** 🔒 **AND `Desktop agent` SENDS THE RESERVED WORD**, not an id — it is the
   *  absence of a channel (`channel_id IS NULL`), which no id can name. */
  it("refetches with channel=desktop for Desktop agent", async () => {
    renderHome();
    await openScope();

    fireEvent.click(screen.getByRole("menuitem", { name: /Desktop agent/ }));

    await waitFor(() =>
      expect(seriesCalls()).toContain(
        "/api/home/overview-series?range=month&metric=credits&channel=desktop"
      )
    );
  });

  /**
   * 🔒 **THE ARROWS MOVE ONE CALENDAR MONTH AND `›` IS DISABLED AT THE CURRENT
   * ONE (Samuel: *"a left and right arrow that will let me change the month I'm
   * looking at, specifically for the bar graph … not the top bar"*).**
   */
  it("steps the histogram back a month and forward again", async () => {
    renderHome();
    const card = await histogram();
    const previous = within(card).getByRole("button", {
      name: "Previous month",
    });
    const next = within(card).getByRole("button", { name: "Next month" });

    // At the current month there is nowhere newer to go.
    expect(next).toBeDisabled();
    expect(within(card).getByText(monthLabel(monthKey()))).toBeInTheDocument();

    fireEvent.click(previous);

    const back = shiftMonthKey(monthKey(), -1);
    await waitFor(() =>
      expect(seriesCalls()).toContain(
        `/api/home/overview-series?range=month&metric=credits&month=${back}`
      )
    );
    expect(within(card).getByText(monthLabel(back))).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "Next month" })
    ).toBeEnabled();

    // ⚠ AND COMING BACK DROPS THE PARAM AGAIN rather than sending the current
    // month explicitly — the default path has to stay ONE cache entry.
    fireEvent.click(within(card).getByRole("button", { name: "Next month" }));
    await waitFor(() =>
      expect(within(card).getByText(monthLabel(monthKey()))).toBeInTheDocument()
    );
  });

  /**
   * 🔒 **THE ARROWS SCALE WITH THE LABEL BESIDE THEM (Samuel, 2026-09-13:
   * *"Increase the size of the arrows to match"*).** That label went from
   * `text-caption` to `identity-section.tsx › IDENTITY_NAME_TEXT`'s 14px — the
   * size the scope menu and **Credit spend** wear — so the glyph is 16,
   * `overview-usage-filter.tsx › MONTH_ARROW_ICON`, one notch over the shared
   * `NAKED_ICON` 14 this face otherwise uses.
   *
   * ⚠ **NOT 18, AND NOT `text-display` ON THE LABEL** (Samuel, same day: *"the
   * date to the super large size, like usage. I did not ask for that. … I only
   * want to change the date selector to match the credit spend and all channels'
   * sizes"*). Both halves of that pass are pinned here, the label's size
   * positively and the big face negatively.
   *
   * ⚠ **THE HIT AREA IS THE OTHER HALF AND IT IS THE ONE THAT CAN REGRESS**: the
   * FACE stays `shared/ui/naked-icon-button.ts › NAKED_ICON_BUTTON`, whose `p-2`
   * puts the box at 8 + 16 + 8 = 32px, over the 30px floor. A bigger glyph inside
   * a hand-written smaller box is the shape this asserts against.
   */
  it("draws month arrows at the label's scale, on the naked-icon face", async () => {
    renderHome();
    const card = await histogram();
    for (const name of ["Previous month", "Next month"]) {
      const button = within(card).getByRole("button", { name });
      for (const token of NAKED_ICON_BUTTON.split(" ").filter(Boolean)) {
        expect(button.className).toContain(token);
      }
      const glyph = button.querySelector("svg");
      expect(glyph).not.toBeNull();
      expect(glyph).toHaveAttribute("width", "16");
    }
    // The label they sit beside — the type both were raised to match, and the
    // one they were NOT raised to.
    const label = within(card).getByText(monthLabel(monthKey()));
    for (const token of IDENTITY_NAME_TEXT.split(" ")) {
      expect(label.className).toContain(token);
    }
    expect(label.className).not.toContain("text-display");
  });

  /**
   * 🔒 **THE CAPACITY BAR IS UNTOUCHED BY EITHER CONTROL (Samuel: the arrows are
   * for *"the histogram, not the top bar"*).** The bar is the WALLET's current
   * period off `/api/billing/status`; a month arrow that moved it would print a
   * past month's spend against today's allowance.
   */
  it("never re-reads billing or moves the bar when the month changes", async () => {
    renderHome();
    const usage = await screen.findByRole("region", { name: "Usage" });
    // ⚠ **THE BAR'S FIGURE IS READ OFF THE METER'S HEADER SINCE 2026-09-13** —
    // the `320 of 500 credits spent` line under it was deleted (Samuel: *"under
    // the bar … '0 of 500 credits spent'. Can you remove that line"*). What this
    // case pins is unchanged: the wallet's pair does not move with the month.
    await within(usage).findByText("320 / 500");
    const billingReads = bridgeCalls(apiRequest).filter((call) =>
      call.path.startsWith("/api/billing/status")
    ).length;

    fireEvent.click(
      within(await histogram()).getByRole("button", { name: "Previous month" })
    );
    await waitFor(() => expect(seriesCalls().length).toBeGreaterThan(1));

    expect(
      bridgeCalls(apiRequest).filter((call) =>
        call.path.startsWith("/api/billing/status")
      ).length
    ).toBe(billingReads);
    expect(within(usage).getByText("320 / 500")).toBeInTheDocument();
  });

  /** The two pure helpers, because the year carry is the arithmetic a reader
   *  would not notice going wrong until January. */
  it("carries the year across January", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});
