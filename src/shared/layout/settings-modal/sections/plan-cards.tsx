"use client";

import { Check } from "lucide-react";
import type { WorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { formatMoney, PRO_PRICE, TEAM_SEAT_PRICE } from "@/features/billing/prices";
import type { PlanDef } from "@/features/billing/plans";
import type { CheckoutPlan } from "@/features/billing/url";
import { cn } from "@/shared/lib/utils";

/**
 * ⚠ THE PLAN UNION IS `features/billing/url.ts › CheckoutPlan`, RE-EXPORTED,
 * NEVER RE-DECLARED (2026-09-07). This file used to own a second
 * `"solo" | "team"` union; when Solo was retired from sale that copy would have
 * kept selling a plan checkout answers 400 for. `url.ts` is pure (no `next/*`,
 * no `server-only`), so the desktop binding can import it too.
 */
export type { CheckoutPlan };

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

/**
 * A live LEGACY Pro (`solo`) subscription — retired from sale 2026-09-07, still
 * billed for the rows that hold one. `isSolo` alone is the plan COLUMN, which a
 * cancelled row keeps; the workspace is only legacy-paid while a subscription
 * is live.
 */
export function isLegacySolo(ent: WorkspaceEntitlements): boolean {
  return ent.isSolo && ent.isPaid;
}

/**
 * ⚠ THE FREE ARM IS `!ent.isPaid`, NEVER `!ent.isTeam` — and with the Solo card
 * gone that is an easy simplification to reach for. Each card list holds two
 * cards, so a live LEGACY Pro (`solo`) row matches neither, and `!ent.isTeam`
 * would badge STARTER as the current plan of a workspace being charged every
 * month. Deliberately, a CANCELLED row does land on the free card: `isPaid` is
 * false there and free is what the container is actually entitled to.
 *
 * ⚠ **KIND-AWARE SINCE 2026-09-08, AND THE THREE ARMS ARE DISJOINT BY LIST, NOT
 * BY BRANCH ORDER.** `plansForKind` never mixes the groups (`plans.ts`), so the
 * `pro` arm is only ever asked about a personal container and the `team` arm
 * only about a standard one — this function does not need the kind, only the
 * card in front of it. Both lists carry an `id: "free"` card, which is why the
 * free arm is the FALL-THROUGH rather than a third `plan.id ===` test.
 *
 * ⚠ **EVERY ARM ASKS `isPaid`, AND THE PAID ONES ASK IT EXPLICITLY (2026-09-08
 * review).** `isTeam` / `isPro` are the plan COLUMN — `data.plan === "team"` —
 * and the free arm is `!isPaid`, so a row whose plan says `team` while its
 * status does not say active/past_due would badge TWO cards "Current plan": its
 * old paid one and Starter. The server sends the entitlement VERDICT today
 * (`server/entitlements.ts › getWorkspaceEntitlements` writes `paid ?? "free"`),
 * which is why nobody has seen it — but this file reads a CLIENT hook whose
 * `isTeam` is a raw string test over a payload that is IndexedDB-persisted for
 * 24h (INVARIANTS §8), so "the column and the verdict agree" is a property of a
 * different module and of no cached row in particular. The three arms now
 * partition on `isPaid` and cannot both fire. Pinned in both directions by
 * `plans-billing.test.tsx`.
 */
function isCurrentPlan(plan: PlanDef, ent: WorkspaceEntitlements): boolean {
  if (plan.id === "pro") return ent.isPro && ent.isPaid;
  if (plan.id === "team") return ent.isTeam && ent.isPaid;
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
  // The card being SOLD, whichever group this is — `team` on a standard
  // workspace, `pro` on a personal container. Never both in one list.
  const highlight = plan.id === "team" || plan.id === "pro";

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

  const isPaidCard = plan.id === "team" || plan.id === "pro";

  if (isCurrent && isPaidCard) {
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

  /**
   * ⚠ PRO HAS NO SWITCH-IN-PLACE ARM AND NEEDS NONE. `upgrade-to-team` exists
   * to move a live legacy `solo` subscription without a second checkout; a
   * personal container has never held one (`solo` was only ever sold on a
   * standard workspace), so Pro is always a fresh checkout.
   * ⚠ The `!canManage` note is UNREACHABLE here — a personal container's only
   * member is its owner — and is kept so the arm cannot render an empty slot if
   * that ever stops being true.
   */
  if (plan.id === "pro") {
    return canManage ? (
      <button type="button" className={primary} onClick={() => onUpgrade("pro")}>
        Upgrade to Pro — {formatMoney(PRO_PRICE)}/month
      </button>
    ) : (
      <div className={muted}>Ask an admin</div>
    );
  }

  if (plan.id === "team") {
    if (isLegacySolo(ent)) {
      // Live legacy Pro subscription swaps in place — no second checkout.
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
        Upgrade — {formatMoney(TEAM_SEAT_PRICE)}/seat
      </button>
    ) : (
      <div className={muted}>Ask an admin</div>
    );
  }

  return <div className={current}>Included</div>;
}
