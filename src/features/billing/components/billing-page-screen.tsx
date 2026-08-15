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
 * WHY A WEB PAGE AT ALL: checkout is `ui_mode: "elements"`, so the payment form
 * is OUR React (`./embedded-checkout` + `./checkout-appearance`) mounting
 * Stripe's script against Stripe's origin. The packaged desktop renderer is a
 * `file://` document under `script-src 'self'` / `connect-src 'none'` and
 * cannot host it. Decision D1(a),
 * docs/migration-research/website-retirement-plan.md.
 *
 * Shell only — header, two tabs, active pane. Panes live in
 * `./billing-usage-pane` / `./billing-plans-pane` to stay under the 500-line
 * cap.
 *
 * ONE ROUTE, TWO TABS: `[segment]` is the WORKSPACE segment
 * (`{slug}-{publicId}`); a second path level would mean re-deriving every
 * `../url.ts` helper, the `upgrade_url` envelopes in the wild, and the
 * desktop's hand-copied deep-link table. Tab selection is
 * `../billing-tabs.ts › resolveBillingTab`, called by the RSC page — a pure
 * module so the page never pulls this client tree into a server render.
 * Bare visit → Usage; `?billing=` (402 envelope, checkout/portal return) →
 * Billing.
 *
 * ⚠ Deliberately NO `AppShell` (rail, sidebar, switcher, tour, join-notices,
 * graph engine) — importing the app layout re-tethers this KEEP page to the
 * tree Stage D deletes. No profile editor, members pane, or workspace icon
 * uploader (GAP-21) either.
 */const TABS = [
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
  /** ⚠ Resolved by the RSC page from `?tab=` + `?billing=`, not
   *  `useSearchParams`, so the shareable link decides the FIRST paint. */
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
  // Reported up by `PlansBilling` while Stripe's card form is mounted;
  // switcher inert while true.
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  function selectTab(next: BillingTab) {
    setTab(next);
    // ⚠ `replaceState`, not a router push: page is `force-dynamic`, so a push
    // re-runs the whole RSC and remounts an open checkout form.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      // ⚠ Intent consumed by this click, so it leaves the URL. `?billing=`
      // outranks `?tab=` at resolve time (`../billing-tabs`), so a URL carrying
      // BOTH would reload onto Billing and re-run the post-payment poll.
      // `session_id` rides along; alone it names a session nothing reads.
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
        {/* ⚠ Inert while checkout is mounted: tabs are exclusive, so a click
            unmounts Stripe's card form, half-typed details and the session,
            with nothing to restore. "← Back to plans" is the exit. */}
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
