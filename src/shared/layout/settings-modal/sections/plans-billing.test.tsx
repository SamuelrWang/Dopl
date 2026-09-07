// @vitest-environment jsdom
/**
 * URL-driven entry states of Plans & Billing, and WHICH TWO CARDS the pane
 * offers. `/billing/[segment]` renders this pane as a PAGE, so whatever the URL
 * said must be true on the FIRST PAINT.
 *
 * ⚠ MOSTLY `renderToStaticMarkup` — first paint is what a URL decides, and a
 * string assertion cannot be fooled by a later effect. The env is jsdom only so
 * the CTA cases below can CLICK: the plan a button hands `onUpgrade` is the one
 * thing no markup can show, and it is exactly what a mis-wired Pro card would
 * get wrong (`pro` on a standard workspace answers 400
 * `PLAN_NOT_FOR_CONTAINER`).
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } from "@/features/billing/credits";
import { planNumber } from "@/features/billing/plans";
import { formatMoney, PRO_PRICE, TEAM_SEAT_PRICE } from "@/features/billing/prices";
import {
  BILLING_STATUS_PATH,
  type WorkspaceEntitlementsStatus,
} from "@/features/billing/components/use-workspace-entitlements";
import { PlansBillingCore } from "./plans-billing-core";
import { PlansBilling } from "./plans-billing";

afterEach(cleanup);

/** A container the endpoint has already answered for. ⚠ Seeded rather than
 *  mocked: the hook's own stale-cache fallbacks stay in the path. */
const STANDARD_FREE: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  containerKind: "standard",
  memberCount: 3,
  seatCount: null,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: 90,
  credits: {
    wallet: "seat" as const,
    used: 0,
    limit: SEAT_MONTHLY_CREDITS.free,
    remaining: SEAT_MONTHLY_CREDITS.free,
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T12:00:00.000Z",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

const PERSONAL_FREE: WorkspaceEntitlementsStatus = {
  ...STANDARD_FREE,
  containerKind: "personal",
  memberCount: 1,
  credits: {
    ...STANDARD_FREE.credits,
    wallet: "personal" as const,
    limit: PERSONAL_MONTHLY_CREDITS.free,
    remaining: PERSONAL_MONTHLY_CREDITS.free,
  },
};

function client(status?: WorkspaceEntitlementsStatus): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (status) qc.setQueryData([BILLING_STATUS_PATH, "ws-1", undefined], status);
  return qc;
}

function paint(node: ReactElement, status?: WorkspaceEntitlementsStatus): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={client(status)}>{node}</QueryClientProvider>
  );
}

/** Mounts the core with a spy in `onUpgrade`'s slot; returns the spy. */
function mountCore(status: WorkspaceEntitlementsStatus) {
  const onUpgrade = vi.fn();
  render(
    <QueryClientProvider client={client(status)}>
      <PlansBillingCore
        role="owner"
        workspaceId="ws-1"
        onUpgrade={onUpgrade}
        onManage={() => {}}
      />
    </QueryClientProvider>
  );
  return onUpgrade;
}

describe("a plain visit", () => {
  it("opens on the plan list, with nothing claiming a purchase is in flight", () => {
    const markup = paint(<PlansBilling role="owner" workspaceId="ws-1" />);
    expect(markup).toContain("Plans and Billing");
    expect(markup).not.toContain("Finalizing your subscription");
    expect(markup).not.toContain("Subscribe to");
  });
});

describe("the checkout return (?billing=success)", () => {
  it("says the subscription is finalizing — i.e. the poll is armed", () => {
    // Banner == `plans-billing-core`'s 20×1s poll being armed. A page that
    // drops the param shows a paid customer a Starter plan.
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" billingReturn="success" />
    );
    expect(markup).toContain("Finalizing your subscription");
  });

  it("the portal return polls too, but quietly", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" billingReturn="return" />
    );
    expect(markup).not.toContain("Finalizing your subscription");
    expect(markup).not.toContain("Welcome to");
  });
});

describe("an upgrade arrival that names a plan (?billing=upgrade&plan=…)", () => {
  it("opens that plan's checkout instead of asking the question again", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan="team" />
    );
    expect(markup).toContain("Subscribe to Team");
    expect(markup).toContain("Back to plans");
    expect(markup).not.toContain("Plans and Billing");
  });

  it("leaves the settings-modal binding untouched when unset", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan={null} />
    );
    expect(markup).toContain("Plans and Billing");
    expect(markup).not.toContain("Subscribe to");
  });
});

/**
 * 🔒 **TWO PLANS, AND PRO IS NOT ONE OF THEM (Samuel, 2026-09-07).** The pane
 * renders `plansForKind(kind)`, so a Solo card coming back is a `plans.ts`
 * regression this
 * suite is meant to catch at the SURFACE — the place a customer would see it.
 * ⚠ Asserted on the CARD's own strings (its name and its flat price), not on
 * the word "Pro", which the legacy note below is allowed to use.
 */
describe("what the plan list sells", () => {
  const markup = paint(<PlansBilling role="owner" workspaceId="ws-1" />);

  it("offers Starter and Team", () => {
    expect(markup).toContain("Starter");
    expect(markup).toContain("Team");
  });

  it("offers no Pro card and no flat single-member price", () => {
    expect(markup).not.toContain("$5.99");
    expect(markup).not.toContain("Single-member workspace");
    expect(markup).not.toContain("Get Pro");
  });

  it("prices Team per seat, from the constant rather than a literal", () => {
    expect(markup).toContain(`${formatMoney(TEAM_SEAT_PRICE)}/seat`);
  });

  it("quotes the per-member credit allowance on both cards", () => {
    // ⚠ "per member" is the ruling in as many words — a fixed, non-pooled
    // allocation. A card that dropped it would read as a workspace pool.
    expect(markup).toContain(
      `${planNumber(SEAT_MONTHLY_CREDITS.free)} credits per member`
    );
    expect(markup).toContain(
      `${planNumber(SEAT_MONTHLY_CREDITS.team)} credits per member`
    );
  });
});

/**
 * 🔒 **WHICH CARDS A CONTAINER IS SHOWN (2026-09-08, spec §11).** The pane
 * renders `plans.ts › plansForKind(ent.containerKind)`, so a standard workspace
 * sees seats and a personal container sees its own flat plan. The two groups are
 * NEVER concatenated: `pro` is refused on a standard workspace and `team` on a
 * personal one (400 `PLAN_NOT_FOR_CONTAINER`), so a pane showing all four would
 * be offering two purchases that answer 400.
 */
describe("the plan list on a PERSONAL container", () => {
  const markup = paint(
    <PlansBilling role="owner" workspaceId="ws-1" />,
    PERSONAL_FREE
  );

  it("offers Free and Pro", () => {
    expect(markup).toContain("Pro");
    expect(markup).toContain("Upgrade to Pro");
    expect(markup).toContain(formatMoney(PRO_PRICE));
  });

  it("offers no workspace plan and no seat wording", () => {
    expect(markup).not.toContain("Starter");
    expect(markup).not.toContain("Upgrade to Team");
    expect(markup).not.toContain("/ seat / month");
    expect(markup).not.toContain("/seat");
  });

  it("quotes the personal allowance, per MONTH and never per member", () => {
    // ⚠ "per member" beside a one-member container invites the reader to
    // multiply by a roster that cannot exist.
    expect(markup).toContain(
      `${planNumber(PERSONAL_MONTHLY_CREDITS.pro)} credits / month`
    );
    expect(markup).toContain(
      `${planNumber(PERSONAL_MONTHLY_CREDITS.free)} credits / month`
    );
    expect(markup).not.toContain("credits per member");
  });

  it("says nothing about a legacy Solo row — that plan never existed here", () => {
    // `solo` was only ever sold on a standard workspace, so the note and the
    // in-place switch have nothing to act on.
    expect(markup).not.toContain("legacy Pro");
    expect(markup).not.toContain("Switch to Team");
  });

  it("counts no members", () => {
    expect(markup).not.toContain("1 member");
  });
});

/**
 * THE PLAN A CTA HANDS `onUpgrade` — the one fact markup cannot carry, and the
 * one a mis-wired card gets wrong in a way that only shows up as a 400 at
 * checkout.
 */
describe("what the upgrade CTAs ask for", () => {
  it("asks for `pro` on a personal container — every button that asks", () => {
    const onUpgrade = mountCore(PERSONAL_FREE);
    const buttons = screen.getAllByRole("button", { name: /Upgrade to Pro/ });
    // Two: the summary card's and the Pro column's. Both must name `pro`.
    expect(buttons.length).toBe(2);
    for (const button of buttons) fireEvent.click(button);
    expect(onUpgrade).toHaveBeenCalledTimes(2);
    for (const call of onUpgrade.mock.calls) expect(call).toEqual(["pro"]);
  });

  it("asks for `team` on a standard workspace", () => {
    const onUpgrade = mountCore(STANDARD_FREE);
    fireEvent.click(
      screen.getByRole("button", { name: `Upgrade to Team — ${formatMoney(TEAM_SEAT_PRICE)}/seat` })
    );
    expect(onUpgrade).toHaveBeenCalledWith("team");
    expect(screen.queryByRole("button", { name: /Upgrade to Pro/ })).toBeNull();
  });
});

/** The other half of `plan-cards.tsx › isCurrentPlan`: it must be able to say
 *  YES as well as NO, on both kinds. */
describe("which card is badged current", () => {
  it("badges Free on a free personal container, and not Pro", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" />,
      PERSONAL_FREE
    );
    expect(markup).toContain("Current plan");
    expect(markup).toContain("Upgrade to Pro");
  });

  it("badges Pro once the subscription is live, and stops selling it", () => {
    const markup = paint(<PlansBilling role="owner" workspaceId="ws-1" />, {
      ...PERSONAL_FREE,
      plan: "pro",
      status: "active",
    });
    expect(markup).toContain("Current plan");
    expect(markup).toContain("Manage subscription");
    expect(markup).not.toContain("Upgrade to Pro");
  });

  /**
   * 🔒 **EXACTLY ONE BADGE, AND A DEAD PLAN COLUMN MUST NOT EARN ONE**
   * (2026-09-08 review). `isTeam` / `isPro` in this hook are raw string tests
   * over `data.plan`, while the Free arm is `!isPaid` — so a row saying `pro`
   * with a non-live status matched BOTH arms and badged two of two cards. The
   * server sends the entitlement verdict today, so no live response produces
   * that row; the CACHE can (IndexedDB, 24h gcTime — INVARIANTS §8), and a
   * renderer that depends on a different module's invariant is one edit away
   * from being wrong.
   *
   * ⚠ **COUNTING, NOT `toContain`** — "contains Current plan" passes happily
   * when BOTH cards carry it, which is the whole bug. The badged card prints
   * the phrase TWICE (the pill and its own inert CTA) and a badged PAID card
   * prints it once beside "Manage subscription", so 2 is one card and 3 is two.
   */
  for (const status of ["canceled", "free"] as const) {
    it(`badges only Free when a \`pro\` column is ${status}, never both cards`, () => {
      const markup = paint(<PlansBilling role="owner" workspaceId="ws-1" />, {
        ...PERSONAL_FREE,
        plan: "pro",
        status,
      });
      expect(markup.split("Current plan").length - 1).toBe(2);
      // …and the card still SELLING is the paid one: a Pro card that thought it
      // was current would offer the portal instead.
      expect(markup).toContain("Upgrade to Pro");
      expect(markup).not.toContain("Manage subscription");
    });
  }

  it("badges only Starter when a `team` column is canceled, never both cards", () => {
    const markup = paint(<PlansBilling role="owner" workspaceId="ws-1" />, {
      ...STANDARD_FREE,
      plan: "team",
      status: "canceled",
    });
    expect(markup.split("Current plan").length - 1).toBe(2);
    expect(markup).toContain(`Upgrade — ${formatMoney(TEAM_SEAT_PRICE)}/seat`);
    expect(markup).not.toContain("Manage subscription");
  });
});

describe("a personal upgrade arrival (?billing=upgrade&plan=pro)", () => {
  it("opens Pro's checkout, priced flat rather than per seat", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan="pro" />,
      PERSONAL_FREE
    );
    expect(markup).toContain("Subscribe to Pro");
    expect(markup).toContain(`${formatMoney(PRO_PRICE)} / month`);
    expect(markup).not.toContain("seats ·");
  });
});
