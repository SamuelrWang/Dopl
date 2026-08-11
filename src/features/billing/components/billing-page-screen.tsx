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
  // Reported up by `PlansBilling` while Stripe's card form is mounted. The
  // switcher is inert for as long as it is true — see below.
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  function selectTab(next: BillingTab) {
    setTab(next);
    // `history.replaceState`, not a router push: switching tabs is not a
    // navigation, and this page is `force-dynamic`, so a push would re-run the
    // whole RSC (and remount an open checkout form) to change one word in the
    // address bar. Same call the ontology cluster switcher makes.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      // THE INTENT IS CONSUMED BY THIS CLICK, so it leaves the URL with it.
      // `?billing=` outranks `?tab=` at resolve time (`../billing-tabs`) —
      // deliberately, so a checkout return cannot be stranded on Usage — which
      // means a URL carrying BOTH would reload onto Billing no matter which
      // tab the person actually chose, and would re-run the post-payment poll
      // for a payment they already watched land. `session_id` rides along with
      // it; on its own it names a Stripe session nothing reads any more.
      url.searchParams.delete("billing");
      url.searchParams.delete("session_id");
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
        {/* INERT WHILE CHECKOUT IS MOUNTED. The two tabs are exclusive, so a
            click here unmounts the Billing pane — and with it Stripe's card
            form, the card details half-typed into it, and the checkout session
            they were being collected under. There is no state to restore
            afterwards, so the switcher waits rather than asking. "← Back to
            plans" inside the pane is the exit. */}
        <SegmentedControl
          className="mt-4 max-w-xs"
          options={TABS}
          value={tab}
          onChange={selectTab}
          disabled={checkoutOpen}
        />
        {checkoutOpen && (
          <p role="status" className="mt-2 text-caption text-text-muted">
            Finish checkout — or go back to plans — before switching tabs.
          </p>
        )}
      </header>

      {tab === "usage" ? (
        <BillingUsagePane workspaceId={workspaceId} />
      ) : (
        <BillingPlansPane
          workspaceId={workspaceId}
          role={role}
          billingReturn={billingReturn}
          initialCheckoutPlan={initialCheckoutPlan}
          onCheckoutOpenChange={setCheckoutOpen}
        />
      )}
    </div>
  );
}
