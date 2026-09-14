import {
  TEMPLATE_NAME_TEXT,
  TEMPLATE_NAME_TEXT_LG,
} from "@/features/agent-templates/components/template-section";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import { PAGE_ACTION_BTN } from "./panel-buttons";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import { BILLING_STATUS, renderHome, routes } from "./home-test-harness";
// ⚠ THE MONTH LABEL IS DERIVED, NEVER WRITTEN OUT — a literal `"September 2026"`
// here is a suite that goes red on 1 October.
import { monthKey, monthLabel } from "./overview-usage-filter";

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
  "@/features/channels/components/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

const panel = (name: string) => screen.findByRole("region", { name });

/**
 * THE HISTOGRAM CARD.
 *
 * ⚠ **BY REGION, NOT BY HEADING, SINCE 2026-09-13** — the `Credits used` heading
 * was DELETED (Samuel) and the scope dropdown stands in its place, so the card
 * that used to be `heading.closest("section")` is now named by its own
 * `aria-label`. The two cards are also the assertion that the Usage panel holds
 * TWO `.bento`s and not one.
 */
const histogram = () => screen.findByRole("region", { name: "Usage histogram" });

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
  /**
   * 🔒 **TWO SCALES IN THIS BLOCK, AND THE SPLIT IS THE RULING — THE PANEL
   * HEADING IS THE BIG ONE AND EVERYTHING INSIDE IT IS NOT.**
   *
   * **Usage** wears `template-section.tsx › TEMPLATE_NAME_TEXT_LG` (Samuel,
   * 2026-09-13: *"increase the font size for usage … let's bold it as well"*).
   * The scope menu, the month label and **Credit spend** wear
   * `› TEMPLATE_NAME_TEXT` — the 14px face the agent template card's name wears.
   *
   * ⚠ **THIS CASE ASSERTED ALL FOUR ON `_LG` FOR ONE PASS AND THAT WAS THE
   * DEFECT** (Samuel, same day: *"You changed the font size of the credit spend,
   * all channels, and the date to the super large size, like usage. I did not ask
   * for that. … I only want to change the date selector to match the credit spend
   * and all channels' sizes"*). So the three are pinned POSITIVELY on the small
   * face **and negatively against the big one** — a pass that raises them again
   * has to make this file red, which the positive half alone would not do (both
   * constants share `text-text-primary`).
   */
  /**
   * 🔒 THE DEEPER CARD SHADOW IS THE OVERVIEW FACE'S ALONE (Samuel, 2026-09-13:
   * "the shadow should only apply for the overview page … the pane for agents in
   * the agent tab also changed … it looks weird now"): the face stamps
   * `data-overview-face` on its root and the kit scopes `--shadow-card` under it.
   */
  it("stamps data-overview-face on the Overview root so the deep card shadow is scoped", async () => {
    renderHome();
    await panel("Usage");
    const root = document.querySelector("[data-overview-face]");
    expect(root).not.toBeNull();
    expect(root!.contains(screen.getByRole("heading", { name: "Usage" }))).toBe(true);
  });

  it("puts the panel heading one step above the controls inside it", async () => {
    renderHome();
    const usage = await panel("Usage");
    const heading = screen.getByRole("heading", { name: "Usage" });
    for (const token of TEMPLATE_NAME_TEXT_LG.split(" ")) {
      expect(heading.className).toContain(token);
    }
    // ⚠ THE PANEL HEADING'S OWN `text-label uppercase` FACE STAYS OVERRIDDEN.
    expect(heading.className).not.toMatch(/\buppercase\b/);

    const inside = [
      screen.getByRole("button", { name: "Usage scope" }),
      within(usage).getByText(monthLabel(monthKey())),
      await within(usage).findByRole("heading", { name: "Credit spend" }),
    ];
    for (const node of inside) {
      for (const token of TEMPLATE_NAME_TEXT.split(" ")) {
        expect(node.className).toContain(token);
      }
      // The rejected size, pinned as an absence on each of the three.
      expect(node.className).not.toContain("text-display");
      expect(node.className).not.toContain("font-semibold");
    }
  });
  it("shows the credit allowance, what is left, and when it resets", async () => {
    renderHome();
    const credits = await panel("Usage");

    // ⚠ THE BILLING METER'S OWN FORMAT — `UsageMeter` prints `used / limit`.
    // This face uses that component, so it prints what the billing pane prints.
    expect(await within(credits).findByText("320 / 500")).toBeInTheDocument();
    // 🔒 **AND THE WORD "Credits" IS NOT ON THE METER ANY MORE** (Samuel,
    // 2026-09-13: *"for the usage credits, remove the credits and the 'Credits
    // used' text"*). The `used / limit` pair is the measurement and it stays; the
    // noun beside it restated the panel it sits in.
    expect(within(credits).queryByText("Credits")).toBeNull();
    // ⚠ STILL DERIVED AS `limit - spent` RATHER THAN READ OFF `remaining`, and
    // the two now coincide (180) because the spend is the same counter the
    // payload derived its own remaining from. The derivation is what keeps the
    // DEGRADED case below honest, where `remaining` is a zero against a zero.
    expect(within(credits).getByText("180 left")).toBeInTheDocument();
    // 🔒 **AND THE "N of N credits spent" LINE IS GONE (Samuel, 2026-09-13:
    // *"under the bar … '0 of 500 credits spent'. Can you remove that line"*).**
    // It restated the meter's own header, which is still asserted above. ⚠ Pinned
    // as an ABSENCE because it was the ask of 2026-09-05 (*"it should show 416 out
    // of 25k credits spent"*) and a sentence with that much history comes back.
    expect(within(credits).queryByText(/credits spent/)).toBeNull();
    // 🔒 THE CARD SAYS WHAT IT IS INSTEAD (Samuel, same review: *"put in a header
    // that says 'Credit spend'"*) — and the word is a HEADING, not a caption.
    expect(
      within(credits).getByRole("heading", { name: "Credit spend" })
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

    // The plot's own header total, on the histogram CARD.
    const plot = await histogram();
    expect(within(plot).getByText("210")).toBeInTheDocument();
    // ⚠ **THE METER'S OWN HEADER IS WHERE THE WALLET FIGURE IS READ NOW** — the
    // `320 of 500 credits spent` sentence this case used to assert was deleted on
    // 2026-09-13 (Samuel). The SOURCE being pinned is unchanged: 320 is the
    // wallet's `credits.used`, 210 is the plot's own bars.
    expect(within(usage).getByText("320 / 500")).toBeInTheDocument();

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

    expect(await within(credits).findByText("471 / 500")).toBeInTheDocument();
    expect(within(credits).getByText("29 left")).toBeInTheDocument();
    // The plot is untouched by a billing-payload change.
    expect(within(await histogram()).getByText("210")).toBeInTheDocument();
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

    // ⚠ ON THE METER'S HEADER SINCE THE SENTENCE UNDER THE BAR WAS DELETED
    // (2026-09-13) — same two numbers, same measured `0` numerator.
    expect(
      await within(credits).findByText(
        `0 / ${PERSONAL_MONTHLY_CREDITS.free.toLocaleString()}`
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
   * 🔒 **THE OFFER IS THE PAGE'S BLACK BUTTON, LABELLED "Get more credits"
   * (Samuel, 2026-09-13: *"I need to change the upgrade button to be more like
   * the new channel button, like the black background stuff. Change it to
   * 'Upgrade' or change it to 'Get more credits'"*).** It was a one-word
   * `Upgrade` text action in the caption row (2026-09-08, spec §11).
   *
   * ⚠ **THE FACE IS ASSERTED AGAINST `panel-buttons.tsx › PAGE_ACTION_BTN`
   * ITSELF, not against a class string spelled out here** — that constant IS the
   * "New channel" button, so this case fails the day the two part rather than the
   * day somebody notices.
   *
   * ⚠ **THE ACTION REACHES THE MODAL WITHOUT A PROP ON THIS PAGE**
   * (`home-settings-control.tsx › openHomeSettings`, which carries the
   * measurement that ruled out lifting a callback through `pages/home/index.tsx`).
   * That is why this case clicks and asserts the PANE, rather than asserting a
   * spy: the registry is the thing that could silently go dead.
   */
  it("offers a black Get more credits button that opens billing settings", async () => {
    renderHome();
    const credits = await panel("Usage");
    // ⚠ `find`, not `get`: the bar is a skeleton until BOTH the billing read
    // and the ledger series land (`overview-panels.tsx › CreditsBar`).
    const upgrade = await within(credits).findByRole("button", {
      name: "Get more credits",
    });
    // ⚠ THE OLD WORD MUST NOT SURVIVE BESIDE THE NEW ONE.
    expect(within(credits).queryByRole("button", { name: "Upgrade" })).toBeNull();
    // 🔒 BELOW THE BAR (Samuel, 2026-09-13: *"move Get More Credits below the
    // bar. Right now, it's above the bar. It should be below the bar"*): the
    // meter and its caption row precede the button in document order.
    {
      const button = within(credits).getByRole("button", { name: "Get more credits" });
      // ⚠ THE CAPTION ROW IS NOW ANCHORED ON `N left` — the `credits spent`
      // sentence beside it was deleted on 2026-09-13 (Samuel).
      const caption = within(credits).getByText(/ left$/);
      expect(
        caption.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }

    for (const token of PAGE_ACTION_BTN.split(" ")) {
      expect(upgrade.className).toContain(token);
    }

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
    await within(credits).findByText(/ left$/);

    expect(
      within(credits).queryByRole("button", { name: "Get more credits" })
    ).toBeNull();
  });
});

/**
 * 🔒 **THE RECONCILIATION CAPTION (Samuel, 2026-09-13: *"there's a disconnect
 * between the two charts. we need to nail this down"*; F-693).** This bar is the
 * COUNTER and the plot under it is the LEDGER. When the server's own subtraction of
 * the two is non-zero, the card says so in ONE muted word; when it is zero — which
 * is every state after
 * `20261004120000_credit_consume_with_ledger.sql`, by construction — it says
 * nothing at all.
 *
 * ⚠ **NOTHING-WHEN-RECONCILED IS THE HALF THAT NEEDS PINNING.** A badge that is
 * always present is furniture, and a reader who sees it on every load stops reading
 * it — at which point the one month it matters looks like every other month.
 */
describe("the reconciliation caption", () => {
  const withDrift = (credits: Record<string, unknown>) =>
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(
            ok({
              ...BILLING_STATUS,
              credits: { ...BILLING_STATUS.credits, ...credits },
            })
          )
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );

  it("says NOTHING when the wallet and the ledger agree", async () => {
    withDrift({ ledgerDrift: 0 });
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText(/ left$/);
    expect(within(credits).queryByText("Unreconciled")).toBeNull();
  });

  it("🔒 prints one muted word when they do not", async () => {
    // The incident's own shape: a counter three ahead of its attribution rows.
    withDrift({ ledgerDrift: 3 });
    renderHome();
    const credits = await panel("Usage");
    expect(await within(credits).findByText("Unreconciled")).toBeInTheDocument();
  });

  it("says it in the OTHER direction too — the sign is not the trigger", async () => {
    withDrift({ ledgerDrift: -2 });
    renderHome();
    const credits = await panel("Usage");
    expect(await within(credits).findByText("Unreconciled")).toBeInTheDocument();
  });

  /**
   * ⚠ **MINIMAL COPY (INVARIANTS §5): THE WORD, NOT THE NUMBER.** The figure is on
   * the wire and in the logs; a card whose whole job is two numbers does not get a
   * third one explaining that they disagree.
   */
  it("🔒 never prints the drift figure itself", async () => {
    withDrift({ ledgerDrift: 3 });
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText("Unreconciled");
    expect(within(credits).queryByText(/off by/i)).toBeNull();
    expect(within(credits).queryByText(/3 (rows|credits|missing)/i)).toBeNull();
  });

  /**
   * 🔒 **THE STALE-CACHE CASE (INVARIANTS §8).** The query cache is
   * IndexedDB-persisted with a 24h gcTime, so a row stored before `ledgerDrift`
   * shipped replays after it with the key ABSENT inside an otherwise complete
   * `credits` object — the exact shape a row-wise `?? DEFAULT` cannot see.
   * `use-workspace-entitlements.ts` defaults it FIELD-WISE, and `undefined !== 0`
   * would otherwise put "Unreconciled" on every replayed row.
   */
  it("🔒 treats a cached row with NO ledgerDrift as reconciled", async () => {
    const preFieldCredits: Record<string, unknown> = { ...BILLING_STATUS.credits };
    delete preFieldCredits.ledgerDrift;
    apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) =>
      path.split("?")[0] === "/api/billing/status"
        ? Promise.resolve(ok({ ...BILLING_STATUS, credits: preFieldCredits }))
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    const credits = await panel("Usage");
    await within(credits).findByText(/ left$/);
    expect(within(credits).queryByText("Unreconciled")).toBeNull();
  });
});
