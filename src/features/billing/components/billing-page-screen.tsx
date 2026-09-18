"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { Role } from "@/features/workspaces/types";
import type { BillingTab } from "../billing-tabs";
import type { CheckoutPlan } from "../url";
import { BillingPlansPane } from "./billing-plans-pane";
import { BillingUsagePane } from "./billing-usage-pane";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";
import styles from "./billing-page.module.css";

/**
 * `/billing/[segment]` — the browser half of Dopl, after the website retires.
 * It exists as a web page because checkout is `ui_mode: "elements"`, so the
 * payment form is our React mounting Stripe's script against Stripe's origin,
 * and the packaged desktop renderer is a `file://` document under
 * `script-src 'self'` / `connect-src 'none'`. Decision D1(a),
 * docs/migration-research/website-retirement-plan.md.
 *
 * Shell only — header, two tabs, active pane; the panes live in
 * `./billing-usage-pane` / `./billing-plans-pane` to stay under the line cap.
 *
 * One route, two tabs: a second path level would mean re-deriving every
 * `../url.ts` helper, the `upgrade_url` envelopes in the wild, and the
 * desktop's hand-copied deep-link table. Tab selection is
 * `../billing-tabs.ts › resolveBillingTab`, called by the RSC page from a pure
 * module so the page never pulls this client tree into a server render.
 *
 * Deliberately no `AppShell` (rail, sidebar, switcher, graph engine) —
 * importing the app layout re-tethers this KEEP page to the tree Stage D
 * deletes. No profile editor, members pane or icon uploader (GAP-21) either.
 */const TABS = [
  { key: "usage" as const, label: "Usage" },
  { key: "billing" as const, label: "Billing" },
];

export interface BillingPageScreenProps {
  workspaceName: string;
  workspaceId: string;
  role: Role;
  /** From `?billing=success|return`. The poll trigger — see `../url`. */
  billingReturn: "success" | "return" | null;
  /** From `?billing=upgrade&plan=…`; opens checkout at mount. */
  initialCheckoutPlan: CheckoutPlan | null;
  /** Resolved by the RSC page from `?tab=` + `?billing=`, not
   *  `useSearchParams`, so the shareable link decides the first paint. */
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
  // Not a fourth request: same path and `workspaceId` as both panes, so this is
  // the cached billing-status read they already share — the shell needs it only
  // to name what `[segment]` resolved to.
  const ent = useWorkspaceEntitlements(workspaceId);
  const isPersonal = ent.containerKind === "personal";
  // Reported up by `PlansBilling` while Stripe's card form is mounted;
  // switcher inert while true.
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  function selectTab(next: BillingTab) {
    setTab(next);
    // `replaceState`, not a router push: the page is `force-dynamic`, so a push
    // re-runs the whole RSC and remounts an open checkout form.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      // Intent is consumed by this click, so it leaves the URL: `?billing=`
      // outranks `?tab=` at resolve time (`../billing-tabs`), so a URL carrying
      // both would reload onto Billing and re-run the post-payment poll.
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
        {/* The sub-label names what `[segment]` resolved to (2026-09-08): this
            route serves a `kind='personal'` container as well as a standard
            workspace since Pro went on sale. A personal space gets a plain
            label rather than the browser-payment explainer. */}
        <p className="mt-1.5 text-caption text-text-secondary">
          {isPersonal
            ? "Personal space"
            : "Payment lives in your browser — the desktop app never handles card details. Everything else about Dopl is in the app."}
        </p>
        {/* Inert while checkout is mounted: tabs are exclusive, so a click
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
