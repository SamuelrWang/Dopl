/**
 * Billing page: pins the import graph (one `AppShell` import drags the rail,
 * sidebar, workspaces fetch, tour and graph engine back into the KEEP set) plus
 * the tab contract — which pane a URL opens on, and what each tab carries.
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
import { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } from "../credits";
import { PRO_PRICE } from "../prices";
import { planNumber } from "../plans";
import { resolveBillingTab } from "../billing-tabs";
import {
  BILLING_STATUS_PATH,
  type WorkspaceEntitlementsStatus,
} from "./use-workspace-entitlements";

const FREE: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  containerKind: "standard",
  memberCount: 3,
  seatCount: null,
  objectCap: 100,
  objectsUsed: 12,
  canCreateObjects: true,
  chatsWindowDays: 90,
  // The meter is the reader's own seat, not a workspace pool (2026-09-07):
  // `wallet` says which counter answered, and the limit is the per-member
  // allowance, built from `credits.ts` so a retune moves the fixture too.
  credits: {
    wallet: "seat" as const,
    used: 42,
    limit: SEAT_MONTHLY_CREDITS.free,
    remaining: SEAT_MONTHLY_CREDITS.free - 42,
    periodStart: "2026-08-01T00:00:00.000Z",
    // Midday UTC: `formatDate` renders in the runner's timezone, so a midnight
    // instant flips a day west of UTC.
    periodEnd: "2026-09-01T12:00:00.000Z",
    ledgerDrift: 0,
    unmeteredSince: null,
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
  credits: {
    ...FREE.credits,
    limit: SEAT_MONTHLY_CREDITS.team,
    remaining: SEAT_MONTHLY_CREDITS.team - 42,
  },
  subscription_period_end: "2026-09-04T12:00:00.000Z",
  has_stripe_customer: true,
};

/** A workspace that bought Pro before it was retired from sale (2026-09-07)
 *  and has not switched or cancelled. Not sellable, still billed. */
const LEGACY_SOLO: WorkspaceEntitlementsStatus = {
  ...TEAM,
  plan: "solo",
  memberCount: 1,
  seatCount: 1,
};

/**
 * The same page addressed at a `kind='personal'` container (spec §11.1). Every
 * "workspace" fact is dropped rather than set to a small number: one member is a
 * fact about the schema, and the object cap is a multi-member rule.
 */
const PERSONAL_FREE: WorkspaceEntitlementsStatus = {
  ...FREE,
  containerKind: "personal",
  memberCount: 1,
  objectCap: null,
  credits: {
    ...FREE.credits,
    wallet: "personal" as const,
    limit: PERSONAL_MONTHLY_CREDITS.free,
    remaining: PERSONAL_MONTHLY_CREDITS.free - 42,
  },
};

/** The personal paid tier — flat monthly, paid credit allowance (2026-09-08). */
const PERSONAL_PRO: WorkspaceEntitlementsStatus = {
  ...PERSONAL_FREE,
  plan: "pro",
  status: "active",
  chatsWindowDays: null,
  credits: {
    ...PERSONAL_FREE.credits,
    limit: PERSONAL_MONTHLY_CREDITS.pro,
    remaining: PERSONAL_MONTHLY_CREDITS.pro - 42,
  },
  subscription_period_end: "2026-09-04T12:00:00.000Z",
  has_stripe_customer: true,
};

/** Seeds billing-status cache; `useApiQuery` key = `[path, workspaceId, query]`. */
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
    expect(resolveBillingTab(null, true)).toBe("billing");
  });

  it("lets ?tab= decide when no intent is present", () => {
    expect(resolveBillingTab("billing", false)).toBe("billing");
    expect(resolveBillingTab("usage", false)).toBe("usage");
  });

  it("puts the INTENT above ?tab=, because only Billing polls", () => {
    // The shell produces `?billing=success&tab=usage` itself; honouring `?tab=`
    // would strand a reloading payer on Usage where the poll never mounts.
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
    const usage = screen({ initialTab: "usage" });
    expect(usage).toContain("Your credits");
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

  it("meters Credits on a FREE workspace and says when they reset", () => {
    const markup = usage(FREE);
    expect(markup).toContain("42");
    expect(markup).toContain(String(SEAT_MONTHLY_CREDITS.free));
    expect(markup).toContain("Resets Sep 1, 2026");
  });

  it("meters them on a paid workspace too — every plan has an allowance", () => {
    expect(usage(TEAM)).toContain(
      SEAT_MONTHLY_CREDITS.team.toLocaleString("en-US")
    );
  });

  /**
   * The label names the payer (2026-09-07): `/api/billing/status` answers with
   * the caller's own meter and `credits.wallet` says which, so a bare "Credits"
   * over a per-member allocation would read as the pool it is not.
   * The null arm is the stale-cache arm (§8) — a row written before `wallet`
   * shipped replays without it, and the neutral label guesses no payer.
   */
  it("names whose meter it is, from the wallet the payload declares", () => {
    expect(usage(FREE)).toContain("Your credits");
    expect(
      usage({ ...FREE, credits: { ...FREE.credits, wallet: "personal" } })
    ).toContain("Personal credits");
    const stale = usage({
      ...FREE,
      credits: { ...FREE.credits, wallet: null },
    });
    expect(stale).toContain("Credits");
    expect(stale).not.toContain("Your credits");
    expect(stale).not.toContain("Personal credits");
  });

  it("drops the explainer paragraph — label and control only (§5)", () => {
    // Minimal-copy ruling: `used / limit` plus a reset date is the whole
    // explanation.
    expect(usage(FREE)).not.toContain("Every plan has a monthly MCP allowance");
    expect(usage(FREE)).toContain("Usage this period");
  });

  it("meters ontology objects against the cap only while capped", () => {
    expect(usage(FREE)).toContain("12 / 100");
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

  /**
   * A legacy Pro row is still paying and the pane must say so (2026-09-07).
   * With Pro retired there is no Solo card to badge, so the row gets a one-line
   * note plus the in-place switch (`/api/billing/upgrade-to-team`) and nothing
   * offers to sell it Pro again.
   */
  it("names a live legacy Pro row without ever selling Pro", () => {
    const markup = screen({}, LEGACY_SOLO);
    expect(markup).toContain("On the legacy Pro plan");
    expect(markup).toContain("Switch to Team");
    // The retired card and its checkout CTA are both gone.
    expect(markup).not.toContain("Single-member workspace");
    expect(markup).not.toContain("Get Pro");
  });

  it("does NOT badge Starter as the current plan of a paying legacy row", () => {
    // With the Solo card gone, `!ent.isTeam` is the tempting simplification for
    // Starter's arm, and it would tell a workspace being charged every month
    // that it is on the free tier. `!ent.isPaid` is the right test, so a live
    // legacy row matches neither card and nothing is badged.
    const markup = screen({}, LEGACY_SOLO);
    expect(markup).not.toContain("Current plan");
  });

  it("still badges Starter for a workspace that actually is on it", () => {
    // The other direction: a guard that never lets Starter be current is just
    // as wrong — a cancelled legacy row is genuinely on Starter.
    expect(screen({}, FREE)).toContain("Current plan");
    expect(screen({}, { ...LEGACY_SOLO, status: "canceled" })).toContain(
      "Current plan"
    );
  });

  it("carries the account danger zone the desktop app links out to", () => {
    // `apps/desktop-ui/.../account-actions.tsx` links here for deletion (D4) —
    // API delete + sign-out + redirect is not reproducible in the packaged
    // renderer.
    const markup = screen();
    expect(markup).toContain("Danger zone");
    expect(markup).toContain("Delete account");
  });

  it("shows card, invoices and cancel ONLY for a paying workspace", () => {
    // Starter has no Stripe customer — an empty card/invoice table would invent
    // an account.
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

/**
 * The same route serves a personal container since Pro went on sale
 * (2026-09-08, spec §11.1): its subscription lives in `workspace_billing` keyed
 * by that container, so checkout, portal, invoices and cancel are unchanged and
 * only the wording that assumed a roster differs.
 */
describe("addressed at a personal container", () => {
  const usage = (status: WorkspaceEntitlementsStatus) =>
    screen({ initialTab: "usage" }, status);

  it("names the space rather than calling it a workspace", () => {
    const markup = screen({}, PERSONAL_FREE);
    expect(markup).toContain("Acme");
    expect(markup).toContain("Personal space");
    // The browser-payment explainer is a workspace-surface note; §5 minimal copy
    // leaves a personal space with a label and no paragraph.
    expect(markup).not.toContain("Payment lives in your browser");
  });

  it("meters the PERSONAL wallet and drops the roster", () => {
    const markup = usage(PERSONAL_FREE);
    expect(markup).toContain("Personal credits");
    expect(markup).toContain(String(PERSONAL_MONTHLY_CREDITS.free));
    // Both directions: the Members line and the section title that framed it
    // are the two places a home space was called a workspace.
    expect(markup).not.toContain("Members");
    expect(markup).not.toContain("Workspace limits");
    expect(markup).toContain("Limits");
    // Chat history survives — a real limit on a personal container.
    expect(markup).toContain("Last 90 days");
  });

  it("never says seat on the usage pane", () => {
    const markup = usage(PERSONAL_PRO);
    expect(markup).toContain(planNumber(PERSONAL_MONTHLY_CREDITS.pro));
    expect(markup).not.toContain("billable seat");
  });

  it("sells Free and Pro — never Starter, Team or a seat price", () => {
    const markup = screen({}, PERSONAL_FREE);
    expect(markup).toContain("Upgrade to Pro");
    expect(markup).toContain(`$${PRO_PRICE.toFixed(2)}`);
    // The two groups are never concatenated: `team` on a personal container
    // answers 400 `PLAN_NOT_FOR_CONTAINER`, so offering it would sell a checkout
    // that refuses.
    expect(markup).not.toContain("Starter");
    expect(markup).not.toContain("/ seat / month");
    expect(markup).not.toContain("Upgrade to Team");
  });

  it("badges the current plan in BOTH directions", () => {
    // Free container: the free card is current and Pro is on offer.
    const free = screen({}, PERSONAL_FREE);
    expect(free).toContain("Current plan");
    expect(free).toContain("Upgrade to Pro");
    // Pro container: Pro is current, and nothing offers to sell it again.
    const pro = screen({}, PERSONAL_PRO);
    expect(pro).toContain("Current plan");
    expect(pro).not.toContain("Upgrade to Pro");
    expect(pro).toContain("Manage subscription");
  });

  /**
   * The Stripe gate has no plan test: `hasStripeAccount` is
   * `canManage && isPaid && has_stripe_customer` (`billing-plans-pane.tsx`), and
   * a `plan === "team"` anywhere in it would strand every Pro payer with no way
   * to change a card or read an invoice.
   */
  it("gives a Pro payer the card, invoices and cancel sections", () => {
    const markup = screen({}, PERSONAL_PRO);
    expect(markup).toContain("Payment method");
    expect(markup).toContain("Invoices");
    expect(markup).toContain("Cancel plan");
    // And a free personal container gets none of them — no customer exists.
    const free = screen({}, PERSONAL_FREE);
    expect(free).not.toContain("Payment method");
    expect(free).not.toContain("Invoices");
  });

  it("opens Pro's checkout when the URL named it", () => {
    expect(
      screen({ initialCheckoutPlan: "pro" }, PERSONAL_FREE)
    ).toContain("Subscribe to Pro");
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
    // R-49 (2026-09-17): `@/features/tour` and the join-request-notices module
    // left this list with the modules themselves — a forbidden-import string
    // naming a module that no longer exists asserts nothing.
    for (const forbidden of [
      "@/shared/layout/app-shell",
      "@/features/onboarding/components",
    ]) {
      expect(imports.join("\n")).not.toContain(forbidden);
    }
  });

  it("renders no app chrome — no rail, no sidebar, no settings modal", () => {
    const markup = screen();
    expect(markup).not.toContain("role=\"dialog\"");
    expect(markup).not.toContain("Workspace switcher");
    // Settings-modal nav: if it appears, the page re-absorbed the shell.
    expect(markup).not.toContain("Plans &amp; Billing");
  });

  it("leaves the profile editor and the workspace icon uploader to the app", () => {
    const markup = screen();
    expect(markup).not.toContain("Display name");
    expect(markup).not.toContain("Workspace icon");
  });
});
