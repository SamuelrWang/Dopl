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
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan="solo" />
    );
    expect(markup).toContain("Subscribe to Pro");
    expect(markup).toContain("Back to plans");
    expect(markup).not.toContain("Plans and Billing");
  });

  it("does the same for Team", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan="team" />
    );
    expect(markup).toContain("Subscribe to Team");
  });

  it("leaves the settings-modal binding untouched when unset", () => {
    const markup = paint(
      <PlansBilling role="owner" workspaceId="ws-1" initialCheckoutPlan={null} />
    );
    expect(markup).toContain("Plans and Billing");
    expect(markup).not.toContain("Subscribe to");
  });
});
