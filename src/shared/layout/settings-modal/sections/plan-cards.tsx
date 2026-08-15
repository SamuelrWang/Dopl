"use client";

import { Check } from "lucide-react";
import type { WorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import type { PlanDef } from "@/features/billing/plans";
import { cn } from "@/shared/lib/utils";

/** The two paid plans checkout can sell. */
export type CheckoutPlan = "solo" | "team";

/** Entitlements + whether the caller may act + the three actions (two owned by
 *  the app binding — see `./plans-billing-core`). */
export interface PlanActions {
  ent: WorkspaceEntitlements;
  canManage: boolean;
  portalLoading: boolean;
  switching: boolean;
  onUpgrade: (plan: CheckoutPlan) => void;
  onManage: () => void;
  onSwitchToTeam: () => void;
}

function isCurrentPlan(plan: PlanDef, ent: WorkspaceEntitlements): boolean {
  if (plan.id === "solo") return ent.isSolo;
  if (plan.id === "team") return ent.isTeam;
  return !ent.isPaid;
}

/** One plan column: name, price, features, state-appropriate CTA. Split out of
 *  `plans-billing-core` to keep both files under the 500-line cap. */
export function PlanColumn({
  plan,
  ent,
  canManage,
  portalLoading,
  switching,
  onUpgrade,
  onManage,
  onSwitchToTeam,
}: PlanActions & { plan: PlanDef }) {
  const isCurrent = isCurrentPlan(plan, ent);
  const highlight = plan.id === "team";

  return (
    <div
      className={cn(
        "bento flex flex-col p-4",
        highlight && "border-border-highlight",
        isCurrent && "border-2 border-text-primary"
      )}
    >
      <div className="flex items-center justify-end">
        {isCurrent ? (
          <span className="rounded-full border border-text-primary px-2 py-0.5 text-micro font-semibold text-text-primary">
            Current plan
          </span>
        ) : highlight ? (
          <span className="rounded-full bg-surface-cta px-2 py-0.5 text-micro font-semibold text-text-on-cta">
            Popular
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-display font-semibold tracking-tight text-text-primary">
        {plan.name}
      </div>
      <div className="mt-1 text-title font-semibold text-text-primary">
        {plan.priceMonthly}
        {plan.priceNote && (
          <span className="ml-1 text-caption font-normal text-text-muted">
            {plan.priceNote}
          </span>
        )}
      </div>

      <ul className="mt-4 flex flex-col gap-2.5 border-t border-border-subtle pt-4">
        {plan.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-small leading-snug text-text-primary"
          >
            <Check size={13} strokeWidth={2.4} className="mt-0.5 shrink-0 text-success" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4">
        <PlanCta
          plan={plan}
          isCurrent={isCurrent}
          ent={ent}
          canManage={canManage}
          portalLoading={portalLoading}
          switching={switching}
          onUpgrade={onUpgrade}
          onManage={onManage}
          onSwitchToTeam={onSwitchToTeam}
        />
      </div>
    </div>
  );
}

function PlanCta({
  plan,
  isCurrent,
  ent,
  canManage,
  portalLoading,
  switching,
  onUpgrade,
  onManage,
  onSwitchToTeam,
}: PlanActions & { plan: PlanDef; isCurrent: boolean }) {
  const ghost =
    "btn-light flex h-8 w-full cursor-pointer items-center justify-center rounded-lg text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50";
  const primary =
    "auth-btn-3d flex h-8 w-full cursor-pointer items-center justify-center rounded-lg text-small font-semibold text-white disabled:cursor-default disabled:opacity-60";
  const current =
    "flex h-8 w-full items-center justify-center text-small font-semibold text-text-secondary";
  const muted =
    "flex h-8 w-full items-center justify-center text-small font-medium text-text-muted";

  if (isCurrent && (plan.id === "solo" || plan.id === "team")) {
    return canManage ? (
      <button type="button" className={ghost} disabled={portalLoading} onClick={onManage}>
        {portalLoading ? "Loading…" : "Manage subscription"}
      </button>
    ) : (
      <div className={current}>Current plan</div>
    );
  }
  if (isCurrent) {
    return <div className={current}>Current plan</div>;
  }

  if (plan.id === "solo") {
    // Solo sells only to free single-member workspaces; no in-product
    // Team → Solo downgrade (the portal handles cancels).
    if (ent.isPaid || ent.memberCount >= 2) {
      return <div className={muted}>Single-member workspaces only</div>;
    }
    return canManage ? (
      <button type="button" className={primary} onClick={() => onUpgrade("solo")}>
        Upgrade — $5.99/mo
      </button>
    ) : (
      <div className={muted}>Ask an admin</div>
    );
  }

  if (plan.id === "team") {
    if (ent.isSolo) {
      // Live Solo subscription swaps in place — no second checkout.
      return canManage ? (
        <button
          type="button"
          className={primary}
          disabled={switching}
          onClick={onSwitchToTeam}
        >
          {switching ? "Switching…" : "Switch to Team"}
        </button>
      ) : (
        <div className={muted}>Ask an admin</div>
      );
    }
    return canManage ? (
      <button type="button" className={primary} onClick={() => onUpgrade("team")}>
        Upgrade — $7.99/seat
      </button>
    ) : (
      <div className={muted}>Ask an admin</div>
    );
  }

  return <div className={current}>Included</div>;
}
