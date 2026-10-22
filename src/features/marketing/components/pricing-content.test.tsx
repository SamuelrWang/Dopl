// @vitest-environment jsdom
/**
 * /pricing — THE PUBLIC PRICE LIST, and the one surface where a stale number is
 * misrepresentation rather than a bug (`plans.ts`'s G4: "drift here is PUBLIC
 * PRICING MISREPRESENTATION that no test could see — a string is a string").
 * G4's remedy was to interpolate the constants; this suite is the other half —
 * it asserts the SHAPE the constants are poured into, which interpolation
 * cannot protect: how many groups there are, how many columns each has, and
 * which plans they name.
 *
 * 🔒 **TWO GROUPS SINCE 2026-09-08 (spec §11): Personal and Workspaces.** They
 * are different products — a home space is billed flat and a standard
 * workspace by the seat — and a checkout for one on the other answers 400
 * `PLAN_NOT_FOR_CONTAINER`. Every assertion below is scoped to ONE group's
 * markup for that reason: a whole-page `toContain` passes while the two groups
 * quote each other's numbers, which is precisely the drift this page cannot
 * afford.
 *
 * ⚠ Mostly `renderToStaticMarkup` — signed-out first paint is what an
 * unauthenticated visitor sees. The env is jsdom only so the CTA case can
 * CLICK: which URL a button pushes is the one fact no markup carries.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  user: null as { id: string } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));
vi.mock("@/shared/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: nav.user } }) },
  }),
}));

const { PricingContent } = await import("./pricing-content");
const { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } = await import(
  "@/features/billing/credits"
);
const { MAX_PLAN_NAME, planNumber } = await import("@/features/billing/plans");
const { formatMoney, launchOfferFor, MAX_PRICE, PRO_PRICE, TEAM_SEAT_PRICE } =
  await import("@/features/billing/prices");
const { billingPath } = await import("@/features/billing/url");
const { WEB_POST_AUTH_LANDING } = await import("@/shared/lib/url/post-auth-landing");

afterEach(() => {
  cleanup();
  nav.push.mockReset();
  nav.user = null;
});

function tree() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <PricingContent />
    </QueryClientProvider>
  );
}

function paint(): string {
  return renderToStaticMarkup(tree());
}

/**
 * ONE group's markup, by its heading. ⚠ The scoping is load-bearing: the two
 * groups carry the same row labels and the same `$8.99`, so a page-wide
 * assertion cannot tell which one it matched.
 */
function group(markup: string, title: string): string {
  const parts = markup.split('<div class="lp-plan-group">');
  const found = parts.find((part) => part.includes(`>${title}</h2>`));
  expect(found).toBeDefined();
  return found as string;
}

/** One `<tr>` of a group's comparison table, by its row header. */
function compareRow(scope: string, label: string): string {
  const after = scope.split(`<th scope="row">${label}</th>`)[1];
  expect(after).toBeDefined();
  return (after as string).split("</tr>")[0];
}

describe("the two products", () => {
  const markup = paint();

  it("names both groups", () => {
    expect(markup).toContain("Personal");
    expect(markup).toContain("Workspaces");
  });

  it("gives Personal three cards and Workspaces two — never one five-column list", () => {
    expect(markup.match(/class="lp-plan(?: lp-plan--popular)?"/g)?.length).toBe(5);
    expect(markup.split('<div class="lp-plan-group">').length - 1).toBe(2);
    const cards = (scope: string) =>
      scope.match(/class="lp-plan(?: lp-plan--popular)?"/g)?.length;
    expect(cards(group(markup, "Personal"))).toBe(3);
    expect(cards(group(markup, "Workspaces"))).toBe(2);
    // The three-card grid is a modifier, so Workspaces keeps two full columns.
    expect(group(markup, "Personal")).toContain('class="lp-plans lp-plans--3"');
    expect(group(markup, "Workspaces")).toContain('class="lp-plans"');
  });

  it("puts Free, Pro and Max under Personal", () => {
    const personal = group(markup, "Personal");
    expect(personal).toContain(">Free<");
    expect(personal).toContain(">Pro<");
    expect(personal).toContain(`>${MAX_PLAN_NAME}<`);
    // 🔒 The workspace plans never leak into this group: `team` on a personal
    // container answers 400 `PLAN_NOT_FOR_CONTAINER`.
    expect(personal).not.toContain("Starter");
    expect(personal).not.toContain(">Team<");
    expect(personal).not.toContain("seat");
  });

  it("puts Starter and Team under Workspaces", () => {
    const workspaces = group(markup, "Workspaces");
    expect(workspaces).toContain(">Starter<");
    expect(workspaces).toContain(">Team<");
    expect(workspaces).not.toContain(">Pro<");
    expect(workspaces).not.toContain(`>${MAX_PLAN_NAME}<`);
  });

  it("still refuses to sell the retired Solo plan anywhere", () => {
    // 🔒 Retired from sale 2026-09-07; a column for it would be an offer to buy
    // a plan checkout answers 400 for.
    expect(markup).not.toContain("$5.99");
    expect(markup).not.toContain("Just you");
  });

  it("gives each group its own comparison table, one column per card", () => {
    // 🔒 Two tables (4 + 3 cells), not one 6-cell table. `.lp-compare-table`
    // has `min-width: 560px` inside its own `overflow-x: auto` scroller, so the
    // PAGE never scrolls sideways.
    const cols = (title: string) =>
      group(paint(), title).split("<tbody>")[0].match(/<th scope="col"/g)?.length;
    expect(cols("Personal")).toBe(4);
    expect(cols("Workspaces")).toBe(3);
    // Every body row carries one cell per plan — a short row would pair a
    // figure with the wrong card.
    for (const [title, n] of [["Personal", 3], ["Workspaces", 2]] as const) {
      for (const row of group(paint(), title).split("<tbody>")[1].split("</tr>").slice(0, -1)) {
        expect(row.match(/<td/g)?.length).toBe(n);
      }
    }
  });
});

describe("the personal numbers, all of them interpolated", () => {
  const personal = () => group(paint(), "Personal");

  it("quotes the personal allowance PER MONTH, never per member", () => {
    // 🔒 Samuel, 2026-09-08: "Personal free is 500 … pro individual is 5,000".
    // ⚠ "per member" beside a container that has exactly one member invites the
    // reader to multiply by a roster that cannot exist.
    const row = compareRow(personal(), "Credits");
    expect(row).toContain(planNumber(PERSONAL_MONTHLY_CREDITS.free));
    expect(row).toContain(planNumber(PERSONAL_MONTHLY_CREDITS.pro));
    expect(row).toContain(planNumber(PERSONAL_MONTHLY_CREDITS.max));
    expect(row.match(/per month/g)?.length).toBe(3);
    expect(row).not.toContain("per member");
  });

  it("prices Pro and Max flat, from the constants — the REAL price, no strike", () => {
    const row = compareRow(personal(), "Price");
    expect(row).toContain("Free");
    expect(row).toContain(formatMoney(PRO_PRICE));
    expect(row).toContain(formatMoney(MAX_PRICE));
    expect(row).not.toMatch(/<s[\s>]/);
    expect(row).toContain("/ month");
    expect(row).not.toContain("/ seat");
  });

  it("says Pro restores full chat history", () => {
    const row = compareRow(personal(), "Chat history");
    expect(row).toContain("Full");
  });

  it("has no members row — there is no roster to describe", () => {
    expect(personal()).not.toContain('<th scope="row">Members</th>');
  });
});

/**
 * THE LAUNCH OFFER (2026-10-22, Samuel: "a 50% off badge for Pro and for Power
 * … show the full price crossed out"). It is bounded by `LAUNCH_PRICE_ENDS`, so
 * every assertion is conditioned on the same `launchOfferFor` the cards read:
 * live → badge + strike on Pro and Max; over → neither, anywhere.
 */
describe("the launch offer", () => {
  const markup = paint();
  const card = (scope: string, name: string) => {
    const at = scope.indexOf(`>${name}</h3>`);
    expect(at).toBeGreaterThan(-1);
    return scope.slice(scope.lastIndexOf('<div class="lp-plan', at), at);
  };

  it("replaces Popular with N% off on Pro and Max, and strikes the reference price", () => {
    const personal = group(markup, "Personal");
    for (const [plan, name] of [["pro", "Pro"], ["max", MAX_PLAN_NAME]] as const) {
      const offer = launchOfferFor(plan);
      const after = personal.slice(personal.indexOf(`>${name}</h3>`));
      const top = card(personal, name);
      if (offer) {
        expect(top).toContain(`>${offer.percentOff}% off<`);
        expect(top).not.toContain(">Popular<");
        expect(after.split("</div>")[0] + after.split("</div>")[1]).toContain(
          formatMoney(offer.wasPrice)
        );
      } else {
        expect(top).toContain(">Popular<");
      }
    }
  });

  it("keeps Popular on Team — it has no offer", () => {
    expect(card(group(markup, "Workspaces"), "Team")).toContain(">Popular<");
    expect(group(markup, "Workspaces")).not.toContain("% off");
    expect(group(markup, "Workspaces")).not.toContain("lp-plan-price-was");
  });
});

describe("the workspace numbers, all of them interpolated", () => {
  const workspaces = () => group(paint(), "Workspaces");

  it("prices Team per seat from the constant", () => {
    const row = compareRow(workspaces(), "Price");
    expect(row).toContain("Free");
    expect(row).toContain(formatMoney(TEAM_SEAT_PRICE));
    expect(row).toContain("/ seat / month");
  });

  /**
   * ⚠ ASSERTED ON THE ROW, NOT ON THE PAGE. The plan CARDS above the table also
   * carry "credits per member / month" (`plans.ts › seatCreditsFeature`), so a
   * whole-markup `toContain` passes even when this row says something else
   * entirely — it did, and a mutation that dropped "per member" from both table
   * cells survived it.
   */
  it("quotes both seat allowances PER MEMBER", () => {
    // 🔒 Samuel, 2026-09-07: "each person gets 100 credits" / "each person gets
    // 5,000 credits". ⚠ "per member" is load-bearing beside an Unlimited
    // members row — without it the figure reads as a workspace pool, which is
    // the one thing the ruling says it is not ("fixed … not pooled").
    const row = compareRow(workspaces(), "Credits");
    expect(row).toContain(planNumber(SEAT_MONTHLY_CREDITS.free));
    expect(row).toContain(planNumber(SEAT_MONTHLY_CREDITS.team));
    expect(row.match(/per member \/ month/g)?.length).toBe(2);
  });

  it("says members are unlimited on BOTH tiers", () => {
    // Creating a workspace is free and members are unlimited; the tier buys the
    // per-person allowance, not the right to add people.
    const row = compareRow(workspaces(), "Members");
    expect(row.match(/Unlimited/g)?.length).toBe(2);
  });
});

/**
 * WHERE EACH PAID CTA SENDS A SIGNED-IN VISITOR. ⚠ The Pro link is
 * SEGMENT-LESS on purpose: `/billing?billing=upgrade&plan=pro` is the one URL
 * that resolves the caller's own `kind='home'` container
 * (`src/app/billing/page.tsx`), and a public page holds no segment for it.
 */
describe("the paid CTAs", () => {
  /**
   * ⚠ WAIT FOR THE AUTH CHECK. Every paid CTA is `disabled` until
   * `supabase.auth.getUser()` resolves — clicking before that is a no-op, and a
   * test that did it would pass by asserting nothing.
   * ⚠ Plain `.disabled`, not `toBeDisabled`: the ROOT vitest setup does not load
   * `@testing-library/jest-dom` (only the SPA's does), and a missing matcher
   * inside `waitFor` retries silently until the timeout.
   */
  async function clickCta(name: string) {
    render(tree());
    const button = (await screen.findByRole("button", {
      name,
    })) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
  }

  it("sends Max to the personal billing forward, naming the plan", async () => {
    nav.user = { id: "u-1" };
    await clickCta(`Go ${MAX_PLAN_NAME}`);
    expect(nav.push).toHaveBeenCalledWith("/billing?billing=upgrade&plan=max");
  });

  it("sends Pro to the personal billing forward, naming the plan", async () => {
    nav.user = { id: "u-1" };
    await clickCta("Go Pro");
    expect(nav.push).toHaveBeenCalledWith(
      billingPath({ intent: "upgrade", plan: "pro" })
    );
    // ⚠ Built from the builder, then pinned literally: the builder could agree
    // with itself while producing a URL `parseCheckoutPlan` rejects.
    expect(nav.push).toHaveBeenCalledWith("/billing?billing=upgrade&plan=pro");
  });

  it("still hands Team off to /billing without naming a plan", async () => {
    // Unchanged: this public page cannot pick a workspace, so the segment-less
    // surface resolves or asks rather than billing the wrong one silently.
    nav.user = { id: "u-1" };
    await clickCta("Bring your team");
    expect(nav.push).toHaveBeenCalledWith(billingPath({ intent: "upgrade" }));
  });

  it("bounces a signed-out visitor through login instead", async () => {
    // `nav.user` stays null — the auth check still has to RESOLVE before the
    // CTA is live, which is what makes this the signed-out path rather than the
    // not-yet-known one.
    await clickCta("Go Pro");
    expect(nav.push).toHaveBeenCalledWith(
      `/login?redirectTo=${encodeURIComponent("/pricing")}`
    );
  });
});

/**
 * "Try today" (both Free cards) never disables, so the auth check is awaited
 * through a paid CTA going live — otherwise a signed-in click could race the
 * check and read as signed out.
 */
describe("the free CTA", () => {
  async function clickTryToday() {
    render(tree());
    const paid = (await screen.findByRole("button", { name: "Go Pro" })) as HTMLButtonElement;
    await waitFor(() => expect(paid.disabled).toBe(false));
    const tries = screen.getAllByRole("button", { name: "Try today" });
    expect(tries).toHaveLength(2);
    fireEvent.click(tries[0]!);
  }

  it("takes a signed-in visitor straight to the post-auth landing", async () => {
    nav.user = { id: "u-1" };
    await clickTryToday();
    expect(nav.push).toHaveBeenCalledWith(WEB_POST_AUTH_LANDING);
  });

  it("sends a signed-out visitor through login, returning to the landing", async () => {
    await clickTryToday();
    expect(nav.push).toHaveBeenCalledWith(
      `/login?redirectTo=${encodeURIComponent(WEB_POST_AUTH_LANDING)}`
    );
  });
});
