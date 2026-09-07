/**
 * /pricing — THE PUBLIC PRICE LIST, and the one surface where a stale number is
 * misrepresentation rather than a bug (`plans.ts`'s G4: "drift here is PUBLIC
 * PRICING MISREPRESENTATION that no test could see — a string is a string").
 * G4's remedy was to interpolate the constants; this suite is the other half —
 * it asserts the SHAPE the constants are poured into, which interpolation
 * cannot protect: how many columns there are, and which plans they name.
 *
 * ⚠ `renderToStaticMarkup`, not a DOM render — this repo's node test env has no
 * DOM, so only the first paint is assertable. Signed-out first paint is the
 * whole point anyway: it is what an unauthenticated visitor sees.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/shared/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  }),
}));

const { PricingContent } = await import("./pricing-content");
const { SEAT_MONTHLY_CREDITS } = await import("@/features/billing/credits");
const { planNumber } = await import("@/features/billing/plans");
const { formatMoney, TEAM_SEAT_PRICE } = await import(
  "@/features/billing/components/use-workspace-entitlements"
);

function paint(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PricingContent />
    </QueryClientProvider>
  );
}

describe("the plans on offer", () => {
  it("shows Starter and Team, and nothing else", () => {
    const markup = paint();
    expect(markup).toContain("Starter");
    expect(markup).toContain("Team");
    // 🔒 Pro/`solo` is RETIRED FROM SALE (Samuel, 2026-09-07). A third column
    // here would be an offer to sell a plan checkout answers 400 for.
    expect(markup).not.toContain("Go Pro");
    expect(markup).not.toContain("Just you");
    expect(markup).not.toContain("$5.99");
  });

  it("has exactly two plan columns in the comparison table", () => {
    // Header row = the caption cell + one cell per plan.
    const header = paint().split("<tbody>")[0];
    expect(header.match(/<th scope="col"/g)?.length).toBe(3);
  });
});

/** One `<tr>` of the comparison table, by its row header. */
function compareRow(markup: string, label: string): string {
  const after = markup.split(`<th scope="row">${label}</th>`)[1];
  expect(after).toBeDefined();
  return (after as string).split("</tr>")[0];
}

describe("the numbers, all of them interpolated", () => {
  it("prices Team per seat from the constant", () => {
    const row = compareRow(paint(), "Price");
    expect(row).toContain("Free");
    expect(row).toContain(formatMoney(TEAM_SEAT_PRICE));
    expect(row).toContain("/ seat / month");
  });

  /**
   * ⚠ ASSERTED ON THE ROW, NOT ON THE PAGE. The plan CARDS above the table also
   * carry "credits per member / month" (`plans.ts › creditsFeature`), so a
   * whole-markup `toContain` passes even when this row says something else
   * entirely — it did, and a mutation that dropped "per member" from both table
   * cells survived it.
   */
  it("quotes both credit allowances PER MEMBER", () => {
    // 🔒 Samuel, 2026-09-07: "each person gets 100 credits" / "each person gets
    // 5,000 credits". ⚠ "per member" is load-bearing beside an Unlimited
    // members row — without it the figure reads as a workspace pool, which is
    // the one thing the ruling says it is not ("fixed … not pooled").
    const row = compareRow(paint(), "Credits");
    expect(row).toContain(planNumber(SEAT_MONTHLY_CREDITS.free));
    expect(row).toContain(planNumber(SEAT_MONTHLY_CREDITS.team));
    expect(row.match(/per member \/ month/g)?.length).toBe(2);
  });

  it("says members are unlimited on BOTH tiers", () => {
    // Creating a workspace is free and members are unlimited; the tier buys the
    // per-person allowance, not the right to add people.
    const row = compareRow(paint(), "Members");
    expect(row.match(/Unlimited/g)?.length).toBe(2);
  });
});
