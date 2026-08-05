"use client";

import { cn } from "@/shared/lib/utils";
import type { Role } from "@/features/workspaces/types";
import { DeleteAccount } from "@/shared/layout/settings-modal/sections/delete-account";
import { PlansBilling } from "@/shared/layout/settings-modal/sections/plans-billing";
import type { CheckoutPlan } from "../url";
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
 * ASSEMBLY, NOT NEW PRODUCT. Both panes are the shipped settings-modal
 * sections, rendered as page sections instead of modal panes: `PlansBilling`
 * (plan + entitlements + embedded checkout + portal + the in-place Solo→Team
 * switch) and `DeleteAccount` (the account danger zone the desktop app links
 * out to — `apps/desktop-ui/.../account-actions.tsx`, plan D4).
 *
 * WHAT IT DELIBERATELY LEAVES OUT. No `AppShell`, no rail, sidebar, workspace
 * switcher, tour, join-notices or graph engine — importing the app layout would
 * re-tether this KEEP page to the tree Stage D deletes, which is the one thing
 * this page exists to avoid. No profile editor and no members pane either: the
 * desktop app owns both and neither needs a browser. The workspace icon
 * uploader (GAP-21) also stays out — it is workspace branding, not billing or
 * account, and it is the only remaining reason to open web settings.
 */
export interface BillingPageScreenProps {
  workspaceName: string;
  workspaceId: string;
  role: Role;
  /** From `?billing=success|return`. THE POLL TRIGGER — see `../url`. */
  billingReturn: "success" | "return" | null;
  /** From `?billing=upgrade&plan=…`; opens checkout at mount. */
  initialCheckoutPlan: CheckoutPlan | null;
}

export function BillingPageScreen({
  workspaceName,
  workspaceId,
  role,
  billingReturn,
  initialCheckoutPlan,
}: BillingPageScreenProps) {
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
      </header>

      <section className="bento px-6 py-5">
        <PlansBilling
          billingReturn={billingReturn}
          initialCheckoutPlan={initialCheckoutPlan}
          role={role}
          workspaceId={workspaceId}
        />
        <p className="mt-4 text-caption text-text-muted">
          Done here? Go back to the Dopl app — your plan updates there on its
          own.
        </p>
      </section>

      <section className="bento px-6 py-5">
        <h2 className="mb-1 text-title font-semibold tracking-tight text-text-primary">
          Account
        </h2>
        <p className="mb-4 text-caption text-text-secondary">
          Deleting your account is permanent, which is why it stays here rather
          than behind a click in the app.
        </p>
        <DeleteAccount />
      </section>
    </div>
  );
}
