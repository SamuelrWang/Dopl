import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
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
 * board, the jumps), and the cases here own one component's ARITHMETIC and
 * its SOURCES. They change for different reasons: the bar's numbers moved when
 * Samuel ruled where the spend is read from, and no structural pin moved with
 * them.
 *
 * 🔒 **THE FIXTURES DISAGREE ON PURPOSE, AND SINCE 2026-09-12 THE BAR FOLLOWS
 * THE WALLET.** `BILLING_STATUS.credits.used` is 320 and `HOME_SERIES` sums to
 * 210: the bar prints **320** (the wallet counter, the same field Settings ›
 * Plans & billing prints) and the plot prints **210** (its own bars' total), so a
 * bar that goes back to `seriesTotal(points)` prints 210 and every case here
 * fails. ⚠ **THE DIRECTION OF THIS PIN REVERSED** — between 2026-09-06 and
 * 2026-09-12 it asserted the opposite, which is why the numbers are still two
 * and not one: in production the two agree, because the server narrows the
 * credits series to the same wallet's ledger rows
 * (`features/home/server/overview-tally.ts › isPersonalWalletBurn`). **A fixture
 * where they agree cannot tell which source the bar read**, which is exactly how
 * a card came to show 416 over a wallet reading 0.
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
   * ⚠ **ALL THREE NUMBERS ARE THE SHARED BILLING ENDPOINT'S NOW (2026-09-12)** —
   * spend, denominator and reset date off one `/api/billing/status` read, which
   * is the read the settings modal's billing pane already makes. The spend was
   * the histogram's ledger sum between 2026-09-06 and this change.
   */
  it("shows the credit allowance, what is left, and when it resets", async () => {
    renderHome();
    const credits = await panel("Usage");

    // ⚠ THE BILLING METER'S OWN FORMAT — `UsageMeter` prints `used / limit`.
    // This face uses that component, so it prints what the billing pane prints.
    expect(await within(credits).findByText("320 / 500")).toBeInTheDocument();
    expect(within(credits).getByText("Credits")).toBeInTheDocument();
    // ⚠ STILL DERIVED AS `limit - spent` RATHER THAN READ OFF `remaining`, and
    // the two now coincide (180) because the spend is the same counter the
    // payload derived its own remaining from. The derivation is what keeps the
    // DEGRADED case below honest, where `remaining` is a zero against a zero.
    expect(within(credits).getByText("180 left")).toBeInTheDocument();
    // 🔒 THE REFERENCE NUMBER IN WORDS (Samuel, 2026-09-05: "it should show 416
    // out of 25k credits spent"). The denominator here is the payload's own
    // measured `limit`; the fallback case below is what pins the constant.
    expect(
      within(credits).getByText("320 of 500 credits spent")
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
   * 🔒 **THE BAR PRINTS THE WALLET, NOT THE SERIES SUM (Samuel, 2026-09-12: "is
   * the credits usage wired in? I want to make sure").** Ruling #10 had made the
   * bar print `seriesTotal(points)` so the two halves of this card could not
   * differ — and they could not, while both were wrong together: the series
   * summed the ledger over EVERY container the reader had burned in, so the bar
   * said `416 of 500` beside a Settings pane reading `0 of 500` off the wallet.
   * The wallet is what enforcement charged, so the wallet is what the bar says.
   *
   * ⚠ **THE PLOT IS STILL 210 AND THAT IS NOT A CONTRADICTION HERE** — the
   * server's narrowing of the credits series is what makes the two agree in
   * production, and this suite deliberately does not stub that agreement (see
   * the file header). What is pinned is WHICH SOURCE each half reads.
   *
   * ⚠ THE CALL COUNT IS STILL HALF THE POINT: the bar gates on the series read
   * (so the card arrives whole), and that must not have become a second request.
   */
  it("prints the wallet's spend on the bar while the plot totals its own bars", async () => {
    renderHome();
    const usage = await panel("Usage");

    // The plot's own header, beside the "Credits used" heading.
    const plot = await card("Credits used");
    expect(within(plot).getByText("210")).toBeInTheDocument();
    expect(
      within(usage).getByText("320 of 500 credits spent")
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
   * 🔒 **AND IT FOLLOWS THE WALLET WHEN THE WALLET MOVES.** The case above pins
   * one pair of numbers; this one changes `credits.used` alone and asserts the
   * bar changed with it while the plot did not. That is the assertion a bar
   * reading the series cannot pass at any fixture value, which is why it is here
   * as well as above.
   */
  it("tracks credits.used when only the wallet figure changes", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(
            ok({
              ...BILLING_STATUS,
              credits: { ...BILLING_STATUS.credits, used: 471, remaining: 29 },
            })
          )
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    const credits = await panel("Usage");

    expect(
      await within(credits).findByText("471 of 500 credits spent")
    ).toBeInTheDocument();
    expect(within(credits).getByText("29 left")).toBeInTheDocument();
    // The plot is untouched by a billing-payload change.
    expect(within(await card("Credits used")).getByText("210")).toBeInTheDocument();
  });

  /**
   * 🔒 **A PAYER THAT NEVER RESOLVED NO LONGER BLANKS THE FIGURE** (Samuel,
   * 2026-09-05, on his own bar: "it should show 416 out of 25k credits spent").
   * `credits-service.ts › unmetered` answers `used: 0, limit: 0, degraded: true`
   * — which printed **Not counted this period** over a month of real bars. The
   * sentence always has a number in it now, and the DENOMINATOR is the half with
   * the fallback.
   *
   * ⚠ **THE NUMERATOR IS THE MEASURED 0 SINCE 2026-09-12, NOT THE LEDGER'S 210.**
   * This case asserted 210 while the spend came from the series; the bar reads the
   * wallet now, so it prints what Settings prints for the same reading. A ledger
   * sum standing over a counter that says nothing was charged is the disagreement
   * this change removed, and printing it here would re-pin it.
   *
   * 🔒 **AND THE CONSTANT IS THE *PERSONAL* WALLET'S FREE TIER (2026-09-07;
   * `.free` since 2026-09-08).** /home is the home space: every call it charges
   * lands on the reader's own personal wallet, so the fallback is
   * `billing/credits.ts › PERSONAL_MONTHLY_CREDITS` and NEVER a workspace plan's
   * allowance, which is a different meter. ⚠ FREE is the right key for a
   * stand-in — this arm only runs when nothing was measured, and quoting the
   * PAID allowance to someone who may not pay is the direction that misleads.
   * ⚠ The expectation is BUILT from the constant, so a literal re-pinned here
   * would survive a retune and this case would not notice.
   *
   * ⚠ The period bounds are blank on that payload and the reset line stays
   * withheld — a date nobody measured must still not be invented.
   */
  it("falls back to the PERSONAL wallet allowance when the payer never resolved", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(
            ok({
              ...BILLING_STATUS,
              credits: {
                wallet: null,
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
      await within(credits).findByText(
        `0 of ${PERSONAL_MONTHLY_CREDITS.free.toLocaleString()} credits spent`
      )
    ).toBeInTheDocument();
    expect(
      within(credits).getByText(
        `${PERSONAL_MONTHLY_CREDITS.free.toLocaleString()} left`
      )
    ).toBeInTheDocument();
    // ⚠ THE SENTENCE THAT MUST NOT COME BACK.
    expect(within(credits).queryByText("Not counted this period")).toBeNull();
    expect(within(credits).queryByText(/^Resets /)).toBeNull();
  });

  /**
   * 🔒 **A FREE HOME SPACE GETS ONE WORD (Samuel, 2026-09-08, spec §11): an
   * "Upgrade" text action on the credit bar that opens the settings modal on its
   * billing section.** Minimal copy (INVARIANTS §5) — a label and a control, no
   * sentence explaining what a plan is.
   *
   * ⚠ **THE ACTION REACHES THE MODAL WITHOUT A PROP ON THIS PAGE**
   * (`home-settings-control.tsx › openHomeSettings`, which carries the
   * measurement that ruled out lifting a callback through `pages/home/index.tsx`).
   * That is why this case clicks and asserts the PANE, rather than asserting a
   * spy: the registry is the thing that could silently go dead.
   */
  it("offers a one-word Upgrade that opens billing settings", async () => {
    renderHome();
    const credits = await panel("Usage");
    // ⚠ `find`, not `get`: the bar is a skeleton until BOTH the billing read
    // and the ledger series land (`overview-panels.tsx › CreditsBar`).
    const upgrade = await within(credits).findByRole("button", {
      name: "Upgrade",
    });

    fireEvent.click(upgrade);

    // The settings modal, on its billing pane — `PlansBillingCore`'s heading.
    expect(await screen.findByText("Plans and Billing")).toBeInTheDocument();
  });

  /**
   * The other direction, and the one that matters more: a payer must not be
   * shown a second checkout. ⚠ `!isPaid` is the test, not `plan === "free"` —
   * a `past_due` payer needs the PORTAL, and a cancelled `pro` row is entitled
   * to the free allowance and SHOULD see the offer.
   */
  it("hides Upgrade once the home container is actually paying", async () => {
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(ok({ ...BILLING_STATUS, plan: "pro", status: "active" }))
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText(/credits spent$/);

    expect(within(credits).queryByRole("button", { name: "Upgrade" })).toBeNull();
  });
});
