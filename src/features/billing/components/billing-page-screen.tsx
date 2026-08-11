"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { Role } from "@/features/workspaces/types";
import type { BillingTab } from "../billing-tabs";
import type { CheckoutPlan } from "../url";
import { BillingPlansPane } from "./billing-plans-pane";
import { BillingUsagePane } from "./billing-usage-pane";
import styles from "./billing-page.module.css";

/**
 * `/billing/[segment]` — the browser half of Dopl, after the website retires.
 *
 * WHY IT IS A WEB PAGE AT ALL. Checkout is `ui_mode: "elements"`: the payment
 * form is OUR React (`./embedded-checkout` + `./checkout-appearance`), mounting
 * Stripe's script and talking to Stripe's origin. The packaged desktop renderer
 * is a `file://` document under `script-src 'self'` / `connect-src 'none'`, so
 * it cannot host that form and never will without giving up either the CSP or
 * the custom checkout. Billing therefore keeps a page — decision D1(a) in
 * docs/migration-research/website-retirement-plan.md — and this is it.
 *
 * THIS FILE IS THE SHELL AND NOTHING ELSE: header, the two tabs, the active
 * pane. Both panes are their own modules (`./billing-usage-pane`,
 * `./billing-plans-pane`), which is what keeps a page that now carries a card,
 * an invoice table and a cancel flow under the 500-line cap.
 *
 * ONE ROUTE, TWO TABS — NOT TWO ROUTES. `[segment]` is the WORKSPACE segment
 * (`{slug}-{publicId}`), so a second path level would mean re-deriving every
 * helper in `../url.ts`, the `upgrade_url` envelopes already in the wild, and
 * the desktop's hand-copied deep-link table. The tab is a `?tab=` query param
 * instead: shareable, and invisible to all of that.
 *
 * Which tab a given URL opens on is decided by `../billing-tabs.ts ›
 * resolveBillingTab`, called by the RSC page — a pure module of its own so the
 * page can import it without pulling this client tree (and its Stripe panes)
 * into a server render.
 *
 * WHY THE DEFAULT FLIPS. A bare visit lands on Usage — the question a member
 * has. An arrival carrying `?billing=` (a 402 upgrade envelope, a Stripe
 * checkout return, a portal return) lands on Billing, because that visitor was
 * sent here mid-transaction and the plan cards are what they were promised.
 *
 * WHAT IT DELIBERATELY LEAVES OUT. No `AppShell`, no rail, sidebar, workspace
 * switcher, tour, join-notices or graph engine — importing the app layout would
 * re-tether this KEEP page to the tree Stage D deletes, which is the one thing
 * this page exists to avoid. No profile editor and no members pane either: the
 * desktop app owns both and neither needs a browser. The workspace icon
 * uploader (GAP-21) also stays out — it is workspace branding, not billing or
 * account, and it is the only remaining reason to open web settings.
 */
const TABS = [
  { key: "usage" as const, label: "Usage" },
  { key: "billing" as const, label: "Billing" },
];

export interface BillingPageScreenProps {
  workspaceName: string;
  workspaceId: string;
  role: Role;
  /** From `?billing=success|return`. THE POLL TRIGGER — see `../url`. */
  billingReturn: "success" | "return" | null;
  /** From `?billing=upgrade&plan=…`; opens checkout at mount. */
  initialCheckoutPlan: CheckoutPlan | null;
  /** Resolved by the RSC page from `?tab=` + `?billing=`. Server-resolved
   *  rather than read from `useSearchParams` so the shareable link decides the
   *  FIRST paint, not the second. */
  initialTab: BillingTab;
}

export function BillingPageScreen({
  workspaceName,
  workspaceId,
  role,
  billingReturn,
  initialCheckoutPlan,
  initialTab,
}: BillingPageScreenProps) {
  const [tab, setTab] = useState<BillingTab>(initialTab);

  function selectTab(next: BillingTab) {
    setTab(next);
    // `history.replaceState`, not a router push: switching tabs is not a
    // navigation, and this page is `force-dynamic`, so a push would re-run the
    // whole RSC (and remount an open checkout form) to change one word in the
    // address bar. Same call the ontology cluster switcher makes.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
  }

  return (
    <div
      className={cn(
        styles.scope,
        "mx-auto flex w-full max-w-3xl flex-col gap-3 py-2"
      )}
    >
      <header className="bento px-6 py-5">
        <p className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Dopl billing
        </p>
        <h1 className="mt-1 text-display font-semibold tracking-tight text-text-primary">
          {workspaceName}
        </h1>
        <p className="mt-1.5 text-caption text-text-secondary">
          Payment lives in your browser — the desktop app never handles card
          details. Everything else about Dopl is in the app.
        </p>
        <SegmentedControl
          className="mt-4 max-w-xs"
          options={TABS}
          value={tab}
          onChange={selectTab}
        />
      </header>

      {tab === "usage" ? (
        <BillingUsagePane workspaceId={workspaceId} />
      ) : (
        <BillingPlansPane
          workspaceId={workspaceId}
          role={role}
          billingReturn={billingReturn}
          initialCheckoutPlan={initialCheckoutPlan}
        />
      )}
    </div>
  );
}
