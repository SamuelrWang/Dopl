/**
 * URL-driven entry states of Plans & Billing. `/billing/[segment]` renders this
 * pane as a PAGE, so whatever the URL said must be true on the FIRST PAINT.
 * ⚠ `renderToStaticMarkup`, not a DOM render — this repo's node test env has no
 * DOM, so only the first paint is assertable.
 */

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SEAT_MONTHLY_CREDITS } from "@/features/billing/credits";
import { planNumber } from "@/features/billing/plans";
import {
  formatMoney,
  TEAM_SEAT_PRICE,
} from "@/features/billing/components/use-workspace-entitlements";
import { PlansBilling } from "./plans-billing";

function paint(node: ReactElement): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
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
 * renders `PLANS`, so a Solo card coming back is a `plans.ts` regression this
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
