/**
 * The two URL-driven entry states of Plans & Billing, at the component that
 * owns them — because `/billing/[segment]` renders this pane as a PAGE, and a
 * page has no modal-open effect to hide behind: whatever the URL said has to be
 * true on the first paint.
 *
 * Rendered with `renderToStaticMarkup` (this repo's node test environment has
 * no DOM), so what is asserted is the first paint and nothing after it — which
 * is exactly the paint a returning payer sees.
 */

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    // `plans-billing-core` starts its 20×1s status poll exactly when
    // `billingReturn` is non-null, and this banner is that state made visible.
    // A page that drops the param shows a paid customer a Starter plan.
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" billingReturn="success" />
    );
    expect(markup).toContain("Finalizing your subscription");
  });

  it("the portal return polls too, but quietly", () => {
    // "return" (a cancel/downgrade) must settle a stale Pro pane without
    // congratulating anybody.
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
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan="solo" />
    );
    expect(markup).toContain("Subscribe to Pro");
    expect(markup).toContain("Back to plans");
    // The plan list is replaced, not merely scrolled past.
    expect(markup).not.toContain("Plans and Billing");
  });

  it("does the same for Team", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan="team" />
    );
    expect(markup).toContain("Subscribe to Team");
  });

  it("leaves the settings-modal binding untouched when unset", () => {
    // The modal passes no `initialCheckoutPlan`; it must still open on plans.
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan={null} />
    );
    expect(markup).toContain("Plans and Billing");
    expect(markup).not.toContain("Subscribe to");
  });
});
