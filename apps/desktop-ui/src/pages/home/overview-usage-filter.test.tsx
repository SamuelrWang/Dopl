import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge } from "#/test-utils/bridge";
import { renderHome, routes } from "./home-test-harness";
import { LINK_WORKSPACE_ID } from "./home-test-ids";
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
  "@/features/channels/components/channels-v2/channel-surface-standalone",
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
   * ⚠ **THE CHANNEL ROWS ARE `GET /api/home/channels`' — THE LEFT PANE'S OWN
   * READ.** `useApiQuery` keys on the path, so the dropdown is a cache hit and
   * costs no request; the fixture's one channel is the row the pane shows.
   */
  it("lists All channels, every home channel, then Desktop agent — and adds no read", async () => {
    renderHome();
    const before = bridgeCalls(apiRequest).filter(
      (call) => call.path.split("?")[0] === "/api/home/channels"
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
      (call) => call.path.split("?")[0] === "/api/home/channels"
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
   * 🔒 **PICKING A CHANNEL REFETCHES WITH `channel=<container id>`** — the
   * container id, because that is the credit ledger's own channel dimension
   * (`overview-series-params.ts`: `credit_usage_events` has no `channel_id`).
   */
  it("refetches with channel=<id> when a channel is picked", async () => {
    renderHome();
    await openScope();

    fireEvent.click(screen.getByRole("menuitem", { name: "Priya Shah" }));

    await waitFor(() =>
      expect(seriesCalls()).toContain(
        `/api/home/overview-series?range=month&metric=credits&channel=${LINK_WORKSPACE_ID}`
      )
    );
  });

  /** 🔒 **AND `Desktop agent` SENDS THE RESERVED WORD**, not a container id — the
   *  client does not know which container is the reader's personal shelf, and it
   *  must not have to (the server resolves it by `kind`). */
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
   * 🔒 **THE CAPACITY BAR IS UNTOUCHED BY EITHER CONTROL (Samuel: the arrows are
   * for *"the histogram, not the top bar"*).** The bar is the WALLET's current
   * period off `/api/billing/status`; a month arrow that moved it would print a
   * past month's spend against today's allowance.
   */
  it("never re-reads billing or moves the bar when the month changes", async () => {
    renderHome();
    const usage = await screen.findByRole("region", { name: "Usage" });
    await within(usage).findByText("320 of 500 credits spent");
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
    expect(
      within(usage).getByText("320 of 500 credits spent")
    ).toBeInTheDocument();
  });

  /** The two pure helpers, because the year carry is the arithmetic a reader
   *  would not notice going wrong until January. */
  it("carries the year across January", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});
