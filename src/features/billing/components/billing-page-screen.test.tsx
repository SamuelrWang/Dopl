/**
 * WHAT THE BILLING PAGE IS, AND WHAT IT MUST NEVER BECOME.
 *
 * The page exists so the `src/app/[workspaceSlug]` tree can be deleted. That
 * makes its import graph, not its markup, the load-bearing property: one
 * `AppShell` import and the page drags the rail, the sidebar, the workspaces
 * fetch, the tour and the graph engine back into the KEEP set, and Stage D
 * stops being a deletion. So this file pins both halves — the two panes are
 * really there, and the app shell really is not.
 *
 * SINCE THE USAGE/BILLING SPLIT it also pins the tab contract: which pane a
 * URL opens on, and that each tab carries what it claims. The default is not
 * cosmetic — a 402 upgrade envelope and a Stripe checkout return both land
 * here, and a visitor mid-transaction who is shown a usage meter has been
 * dropped by the flow that sent them.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { BillingPageScreen } from "./billing-page-screen";
import { resolveBillingTab } from "../billing-tabs";
import {
  BILLING_STATUS_PATH,
  type WorkspaceEntitlementsStatus,
} from "./use-workspace-entitlements";

const FREE: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  memberCount: 3,
  seatCount: null,
  objectCap: 100,
  objectsUsed: 12,
  canCreateObjects: true,
  chatsWindowDays: 90,
  credits: {
    used: 120,
    limit: 500,
    remaining: 380,
    periodStart: "2026-08-01T00:00:00.000Z",
    // Midday UTC on purpose: `formatDate` renders in the RUNNER's timezone, and
    // a midnight instant flips to the previous day for anyone west of UTC.
    periodEnd: "2026-09-01T12:00:00.000Z",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

const TEAM: WorkspaceEntitlementsStatus = {
  ...FREE,
  plan: "team",
  status: "active",
  seatCount: 4,
  objectCap: null,
  chatsWindowDays: null,
  credits: { ...FREE.credits, limit: 25_000, remaining: 24_880 },
  subscription_period_end: "2026-09-04T12:00:00.000Z",
  has_stripe_customer: true,
};

/** Seeds the billing-status cache so the panes render their LOADED state —
 *  `useApiQuery`'s key is `[path, workspaceId, query]`, built by the hook. */
function paint(node: ReactElement, status: WorkspaceEntitlementsStatus): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData([BILLING_STATUS_PATH, "ws-1", undefined], status);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

function screen(
  overrides: Partial<Parameters<typeof BillingPageScreen>[0]> = {},
  status: WorkspaceEntitlementsStatus = FREE
) {
  return paint(
    <BillingPageScreen
      workspaceName="Acme"
      workspaceId="ws-1"
      role="owner"
      billingReturn={null}
      initialCheckoutPlan={null}
      initialTab="billing"
      {...overrides}
    />,
    status
  );
}

describe("which tab a URL opens on", () => {
  it("opens on Usage for a bare visit", () => {
    expect(resolveBillingTab(null, false)).toBe("usage");
  });

  it("opens on Billing when the visitor arrived with a ?billing= intent", () => {
    // The 402 upgrade envelopes, the Stripe checkout return and the portal
    // return all carry one. They are mid-transaction; the plan cards are what
    // they were sent for.
    expect(resolveBillingTab(null, true)).toBe("billing");
  });

  it("lets ?tab= decide when no intent is present", () => {
    expect(resolveBillingTab("billing", false)).toBe("billing");
    expect(resolveBillingTab("usage", false)).toBe("usage");
  });

  it("puts the INTENT above ?tab=, because only Billing polls", () => {
    // `?billing=success&tab=usage` is a URL the shell itself produces — it
    // writes `?tab=` on every click — so honouring `?tab=` here would strand a
    // reloading payer on Usage, where the post-payment poll never mounts and
    // their plan stays Starter forever.
    expect(resolveBillingTab("usage", true)).toBe("billing");
  });

  it("ignores a ?tab= that names no tab", () => {
    expect(resolveBillingTab("invoices", false)).toBe("usage");
    expect(resolveBillingTab("", true)).toBe("billing");
  });

  it("renders the tab switcher itself", () => {
    const markup = screen();
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain("Usage");
    expect(markup).toContain("Billing");
  });

  it("renders ONE pane — the tabs are exclusive, not a stacked page", () => {
    // Usage carries the meters; Billing carries the plan cards + danger zone.
    const usage = screen({ initialTab: "usage" });
    expect(usage).toContain("MCP credits");
    expect(usage).not.toContain("Plans and Billing");
    expect(usage).not.toContain("Delete account");

    const billing = screen({ initialTab: "billing" });
    expect(billing).toContain("Plans and Billing");
    expect(billing).not.toContain("Workspace limits");
  });
});

describe("the Usage tab", () => {
  const usage = (status: WorkspaceEntitlementsStatus) =>
    screen({ initialTab: "usage" }, status);

  it("meters MCP credits on a FREE workspace and says when they reset", () => {
    const markup = usage(FREE);
    expect(markup).toContain("MCP credits");
    expect(markup).toContain("120");
    expect(markup).toContain("500");
    expect(markup).toContain("Resets Sep 1, 2026");
  });

  it("meters them on a paid workspace too — every plan has an allowance", () => {
    expect(usage(TEAM)).toContain("25,000");
  });

  it("meters ontology objects against the cap only while capped", () => {
    expect(usage(FREE)).toContain("12 / 100");
    // Uncapped: the count, and the word for no cap. Never an empty track
    // against a limit that does not exist.
    const paid = usage(TEAM);
    expect(paid).toContain("Unlimited");
    expect(paid).not.toContain("12 / 100");
  });

  it("carries the members/seats and chat-history lines", () => {
    expect(usage(FREE)).toContain("Last 90 days");
    const team = usage(TEAM);
    expect(team).toContain("4 billable seats");
    expect(team).toContain("Full history");
  });
});

describe("the Billing tab", () => {
  it("carries Plans & Billing — plan, entitlements, upgrade, portal", () => {
    const markup = screen();
    expect(markup).toContain("Plans and Billing");
    expect(markup).toContain("Starter");
    expect(markup).toContain("Team");
  });

  it("carries the account danger zone the desktop app links out to", () => {
    // `apps/desktop-ui/.../account-actions.tsx` opens this page for deletion
    // (plan decision D4): the flow it runs — API delete, Supabase sign-out,
    // redirect — is not reproducible in the packaged renderer.
    const markup = screen();
    expect(markup).toContain("Danger zone");
    expect(markup).toContain("Delete account");
  });

  it("shows card, invoices and cancel ONLY for a paying workspace", () => {
    // A Starter workspace has no Stripe customer, so an empty card and an
    // empty invoice table would be inventing an account it does not have.
    const free = screen();
    expect(free).not.toContain("Payment method");
    expect(free).not.toContain("Invoices");
    expect(free).not.toContain("Cancel plan");

    const paid = screen({}, TEAM);
    expect(paid).toContain("Payment method");
    expect(paid).toContain("Invoices");
    expect(paid).toContain("Cancel plan");
  });

  it("hides all three from a member — they are admin-only routes", () => {
    const markup = screen({ role: "member" }, TEAM);
    expect(markup).not.toContain("Payment method");
    expect(markup).not.toContain("Invoices");
    expect(markup).not.toContain("Cancel plan");
  });

  it("quotes the end date on the cancel section, not just a warning", () => {
    // The date IS the consequence: nothing stops today, and a cancel dialog
    // that does not say when access ends is asking for a decision blind.
    expect(screen({}, TEAM)).toContain("Sep 4, 2026");
  });

  it("swaps cancel for resume once the plan is already ending", () => {
    const ending = screen({}, { ...TEAM, cancelAtPeriodEnd: true });
    expect(ending).toContain("Plan ending");
    expect(ending).toContain("Resume plan");
    expect(ending).not.toContain("Cancel plan");
  });

  it("passes the post-checkout signal straight through to the pane", () => {
    expect(screen({ billingReturn: "success" })).toContain(
      "Finalizing your subscription"
    );
  });

  it("passes the chosen plan straight through to checkout", () => {
    expect(screen({ initialCheckoutPlan: "team" })).toContain("Subscribe to Team");
  });
});

describe("what the page deliberately leaves out", () => {
  const SOURCES = [
    "src/features/billing/components/billing-page-screen.tsx",
    "src/features/billing/components/billing-plans-pane.tsx",
    "src/features/billing/components/billing-usage-pane.tsx",
    "src/app/billing/[segment]/page.tsx",
    "src/app/billing/page.tsx",
  ];

  it.each(SOURCES)("%s imports nothing from the retiring app tree", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*}\s*from\s+"/.test(line));
    for (const forbidden of [
      "@/shared/layout/app-shell",
      "@/features/tour",
      "@/features/onboarding/components",
      "@/features/workspaces/components/join-request-notices",
    ]) {
      expect(imports.join("\n")).not.toContain(forbidden);
    }
  });

  it("renders no app chrome — no rail, no sidebar, no settings modal", () => {
    const markup = screen();
    expect(markup).not.toContain("role=\"dialog\"");
    expect(markup).not.toContain("Workspace switcher");
    // The settings modal's own nav — if this ever appears, the page has
    // re-absorbed the shell it was built to replace.
    expect(markup).not.toContain("Plans &amp; Billing");
  });

  it("leaves the profile editor and the workspace icon uploader to the app", () => {
    const markup = screen();
    expect(markup).not.toContain("Display name");
    expect(markup).not.toContain("Workspace icon");
  });
});
