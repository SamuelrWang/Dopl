import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { BILLING_STATUS, renderHome, routes } from "./home-test-harness";

/**
 * /home → OVERVIEW → **THE CAPACITY BAR** — what it says, and where each number
 * on it comes from.
 *
 * ⚠ **ITS OWN FILE SINCE 2026-09-06, AND THE CAP IS ONLY HALF THE REASON.**
 * `overview-panels.test.tsx` reached 545 lines when ruling #10's cases landed —
 * over the hard 500 (§1, `eslint.config.mjs › max-lines`, which covers
 * `apps/*​/src/**` with no exemptions) — and the seam was already there: that
 * suite owns the face's STRUCTURE (which panels exist, what is in them, the
 * board, the jumps), and these three cases own one component's ARITHMETIC and
 * its SOURCES. They change for different reasons: the bar's numbers moved when
 * Samuel ruled where the spend is read from, and no structural pin moved with
 * them.
 *
 * 🔒 **THE FIXTURES DISAGREE ON PURPOSE.** `BILLING_STATUS.credits.used` is 320
 * and `HOME_SERIES` sums to 210, so a bar that goes back to reading the payer's
 * counter prints 320 and every case here fails. Two fixtures that happened to
 * agree would let that regression through in silence.
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

const panel = (name: string) => screen.findByRole("region", { name });

/** A CARD inside a panel, by its heading. */
async function card(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name });
  return heading.closest("section") as HTMLElement;
}

describe("the /home credit capacity bar", () => {
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
   * The capacity bar is a PERIOD TOTAL with its denominator and its reset date.
   * The denominator and the reset date are the shared billing endpoint's; the
   * SPENT figure is the histogram's ledger (ruling #10, 2026-09-06) — no second
   * credits read either way.
   */
  it("shows the credit allowance, what is left, and when it resets", async () => {
    renderHome();
    const credits = await panel("Usage");

    // ⚠ THE BILLING METER'S OWN FORMAT — `UsageMeter` prints `used / limit`.
    // This face uses that component, so it prints what the billing pane prints.
    expect(await within(credits).findByText("210 / 500")).toBeInTheDocument();
    expect(within(credits).getByText("Credits")).toBeInTheDocument();
    // ⚠ `limit - spent`, NOT the payload's `remaining` (180 here): what is left
    // has to be left of the figure printed beside it.
    expect(within(credits).getByText("290 left")).toBeInTheDocument();
    // 🔒 THE REFERENCE NUMBER IN WORDS (Samuel, 2026-09-05: "it should show 416
    // out of 25k credits spent"). ⚠ The denominator is the PLAN'S allowance —
    // 500 here is Starter's, off `billing/credits.ts › MONTHLY_MCP_CREDITS`,
    // and the assertion is on the fixture's plan rather than on a literal this
    // suite chose.
    expect(
      within(credits).getByText("210 of 500 credits spent")
    ).toBeInTheDocument();
    // ⚠ THE WORD THAT MUST NOT COME BACK: a 0 denominator used to print
    // "Unmetered" here, which is the whole defect the bar was rebuilt for.
    expect(within(credits).queryByText("Unmetered")).toBeNull();
    // ⚠ THE BILLING PANE'S OWN LINE AND ITS OWN FORMATTER (`formatDate`), so
    // the assertion is on the SENTENCE rather than on a date string this suite
    // would otherwise be re-implementing.
    expect(within(credits).getByText(/^Resets /)).toBeInTheDocument();
    expect(
      bridgeCalls(apiRequest).filter((call) =>
        call.path.startsWith("/api/billing/status")
      ).length
    ).toBeGreaterThan(0);
  });

  /**
   * 🔒 **THE BAR'S SPEND *IS* THE HISTOGRAM'S TOTAL, AND ONE READ SERVES BOTH**
   * (Samuel's ruling #10, 2026-09-06). The card used to answer from two sources
   * — the payer's period counter over the attribution ledger's bars — so the two
   * halves of one card could differ on screen. They are one array now
   * (`overview-panels.tsx › UsageCard`, summed once by `seriesTotal`).
   *
   * ⚠ THE CALL COUNT IS HALF THE POINT: hoisting the read must not have bought
   * agreement with a second request.
   */
  it("prints the same spend on the bar as the plot totals, from one series read", async () => {
    renderHome();
    const usage = await panel("Usage");

    // The plot's own header, beside the "Credits used" heading.
    const plot = await card("Credits used");
    expect(within(plot).getByText("210")).toBeInTheDocument();
    expect(
      within(usage).getByText("210 of 500 credits spent")
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).filter((call) =>
          call.path.startsWith("/api/home/overview-series")
        ).length
      ).toBe(1)
    );
  });

  /**
   * 🔒 **A PAYER THAT NEVER RESOLVED NO LONGER BLANKS THE FIGURE** (Samuel,
   * 2026-09-05, on his own bar: "it should show 416 out of 25k credits spent").
   * `credits-service.ts › unmetered` answers `used: 0, limit: 0, degraded: true`
   * — which printed **Not counted this period** over a month of real bars. The
   * spend comes from the ledger now, so the sentence has a number in it and the
   * denominator falls back to the PLAN's allowance.
   *
   * ⚠ The period bounds are blank on that payload and the reset line stays
   * withheld — a date nobody measured must still not be invented.
   */
  it("shows the ledger's spend when the payer never resolved", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(
            ok({
              ...BILLING_STATUS,
              credits: {
                used: 0,
                limit: 0,
                remaining: 0,
                periodStart: "",
                periodEnd: "",
                degraded: true,
              },
            })
          )
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    const credits = await panel("Usage");

    expect(
      await within(credits).findByText("210 of 500 credits spent")
    ).toBeInTheDocument();
    expect(within(credits).getByText("290 left")).toBeInTheDocument();
    // ⚠ THE SENTENCE THAT MUST NOT COME BACK.
    expect(within(credits).queryByText("Not counted this period")).toBeNull();
    expect(within(credits).queryByText(/^Resets /)).toBeNull();
  });
});
