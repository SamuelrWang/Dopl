"use client";

import { Check } from "lucide-react";
import type { WorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import {
  formatMoney,
  launchOfferFor,
  PERSONAL_PLAN_PRICES,
  TEAM_SEAT_PRICE,
} from "@/features/billing/prices";
import {
  isPersonalPaidPlan,
  PERSONAL_PLAN_NAMES,
  personalPlanRank,
  type PersonalPaidPlan,
  type PlanDef,
} from "@/features/billing/plans";
import type { CheckoutPlan } from "@/features/billing/url";
import { formatDate } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { SMALL_PRIMARY_PILL } from "@/shared/ui/small-action-button";

/**
 * ⚠ THE PLAN UNION IS `features/billing/url.ts › CheckoutPlan`, RE-EXPORTED,
 * NEVER RE-DECLARED (2026-09-07). This file used to own a second
 * `"solo" | "team"` union; when Solo was retired from sale that copy would have
 * kept selling a plan checkout answers 400 for. `url.ts` is pure (no `next/*`,
 * no `server-only`), so the desktop binding can import it too.
 */
export type { CheckoutPlan };

/** A queued Pro ⇄ Max switch, as the pane shows it (2026-10-22;
 *  `features/billing/components/use-personal-plan-change.ts`). */
export interface PlanChangeView {
  scheduledPlan: PersonalPaidPlan | null;
  effectiveAt: string | null;
  pending: boolean;
}

/** Entitlements + whether the caller may act + the actions (two owned by the
 *  app binding — see `./plans-billing-core`). */
export interface PlanActions {
  ent: WorkspaceEntitlements;
  canManage: boolean;
  portalLoading: boolean;
  switching: boolean;
  onUpgrade: (plan: CheckoutPlan) => void;
  onManage: () => void;
  onSwitchToTeam: () => void;
  /** Switch a LIVE personal subscription to the other personal tier in place —
   *  never a checkout (2026-10-22). */
  planChange: PlanChangeView;
  onChangePlan: (plan: PersonalPaidPlan) => void;
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
 * ⚠ THE FREE ARM IS `!ent.isPaid`, NEVER `!ent.isTeam`: a live LEGACY Pro
 * (`solo`) row matches no card, and `!ent.isTeam` would badge STARTER as the
 * current plan of a workspace being charged every month. A CANCELLED row does
 * land on the free card: `isPaid` is false there and free is what the container
 * is actually entitled to.
 *
 * ⚠ **THE ARMS ARE DISJOINT BY LIST, NOT BY BRANCH ORDER.** `plansForKind` never
 * mixes the groups (`plans.ts`), so a personal arm is only ever asked about a
 * home space and the `team` arm only about a standard one. Every paid arm asks
 * `isPaid` explicitly, so a row whose plan column says paid while its status
 * does not cannot badge two cards (the client hook reads a payload persisted
 * for 24h, INVARIANTS §8). Pinned in both directions by `plans-billing.test.tsx`.
 */
function isCurrentPlan(plan: PlanDef, ent: WorkspaceEntitlements): boolean {
  if (isPersonalPaidPlan(plan.id)) return ent.personalPlan === plan.id && ent.isPaid;
  if (plan.id === "team") return ent.isTeam && ent.isPaid;
  return !ent.isPaid;
}

/** A plan card's actions: the portal ("Manage billing") is the summary card's alone. */
type CardActions = Omit<PlanActions, "portalLoading" | "onManage">;

/**
 * The card's price line, with the LAUNCH strike when one is live
 * (`prices.ts › launchOfferFor` — bounded by its end date, Samuel's call). The
 * "was" price renders first and struck, the real price after it, so the reader
 * sees what they will be charged as the bigger figure.
 */
function PriceLine({ plan }: { plan: PlanDef }) {
  const offer = launchOfferFor(plan.id);
  return (
    <div className="mt-1 text-title font-semibold text-text-primary">
      {offer && (
        <s className="mr-1.5 text-caption font-normal text-text-muted">
          <span className="sr-only">Regular price </span>
          {formatMoney(offer.wasPrice)}
        </s>
      )}
      {plan.priceMonthly}
      {plan.priceNote && (
        <span className="ml-1 text-caption font-normal text-text-muted">
          {plan.priceNote}
        </span>
      )}
    </div>
  );
}

/** One plan column: name, price, features, state-appropriate CTA. Split out of
 *  `plans-billing-core` to keep both files under the 500-line cap. */
export function PlanColumn({ plan, ...actions }: CardActions & { plan: PlanDef }) {
  const { ent } = actions;
  const isCurrent = isCurrentPlan(plan, ent);
  // Every PAID card is the one being sold in its group — `team` on a standard
  // workspace, `pro` and `max` on a home space.
  const highlight = plan.id !== "free";
  // ⚠ "50% off" REPLACES "Popular" on Pro and Max (Samuel, 2026-10-22) and
  // only while the launch offer is live; Team keeps "Popular".
  const offer = launchOfferFor(plan.id);

  return (
    <div
      className={cn(
        "white-card flex flex-col p-3.5",
        highlight && "border-border-highlight",
        isCurrent && "border-2 border-text-primary"
      )}
    >
      <div className="flex items-center justify-end">
        {isCurrent ? (
          <span className="rounded-full border border-text-primary px-2 py-0.5 text-micro font-semibold text-text-primary">
            Current plan
          </span>
        ) : offer ? (
          <span className="rounded-full bg-surface-cta px-2 py-0.5 text-micro font-semibold text-text-on-cta">
            {offer.percentOff}% off
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
      <PriceLine plan={plan} />

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
        <PlanCta plan={plan} isCurrent={isCurrent} {...actions} />
      </div>
    </div>
  );
}

const PRIMARY = cn(
  SMALL_PRIMARY_PILL,
  "w-full justify-center disabled:cursor-default disabled:opacity-60"
);
const CURRENT =
  "flex h-[var(--action-h-sm)] w-full items-center justify-center text-small font-semibold text-text-secondary";
const MUTED =
  "flex h-[var(--action-h-sm)] w-full items-center justify-center text-center text-small font-medium text-text-muted";

/**
 * A personal paid card's CTA (2026-10-22). Four states, in the order asked:
 *   • no live personal plan → a fresh CHECKOUT (`onUpgrade`);
 *   • this card is the queued downgrade → "Starts <date>", nothing to press;
 *   • the plan is ending or past due → a note: the switch route refuses both
 *     (resume first / fix the card first), so no button may offer it;
 *   • otherwise → the in-place SWITCH (`onChangePlan`): "Upgrade" for the
 *     bigger tier (charged now, prorated), "Switch … at renewal" for the smaller.
 * ⚠ The `!canManage` note is UNREACHABLE on a home space (its only member is
 * its owner) and is kept so the arm cannot render an empty slot.
 */
function PersonalCta({
  plan,
  ent,
  canManage,
  planChange,
  onUpgrade,
  onChangePlan,
}: CardActions & { plan: PersonalPaidPlan }) {
  const name = PERSONAL_PLAN_NAMES[plan];
  const price = formatMoney(PERSONAL_PLAN_PRICES[plan]);
  if (!canManage) return <div className={MUTED}>Ask an admin</div>;
  const current = ent.isPaid ? ent.personalPlan : null;
  if (!current) {
    return (
      <button type="button" className={PRIMARY} onClick={() => onUpgrade(plan)}>
        Upgrade to {name} — {price}/month
      </button>
    );
  }
  if (planChange.scheduledPlan === plan && planChange.effectiveAt) {
    return <div className={MUTED}>Starts {formatDate(planChange.effectiveAt)}</div>;
  }
  if (ent.cancelAtPeriodEnd) return <div className={MUTED}>Resume your plan to switch</div>;
  if (ent.isPastDue) return <div className={MUTED}>Update your payment to switch</div>;
  const upgrade = personalPlanRank(plan) > personalPlanRank(current);
  return (
    <button
      type="button"
      className={PRIMARY}
      disabled={planChange.pending}
      onClick={() => onChangePlan(plan)}
    >
      {planChange.pending
        ? "Switching…"
        : upgrade
          ? `Upgrade to ${name} — ${price}/month`
          : `Switch to ${name} at renewal`}
    </button>
  );
}

function PlanCta({
  plan,
  isCurrent,
  ...actions
}: CardActions & { plan: PlanDef; isCurrent: boolean }) {
  const { ent, canManage, switching, planChange, onUpgrade, onSwitchToTeam, onChangePlan } =
    actions;

  if (isCurrent) {
    // The one action a CURRENT card carries: undoing a queued downgrade.
    // Choosing the current plan is exactly that request (`server/plan-change.ts`).
    if (isPersonalPaidPlan(plan.id) && planChange.scheduledPlan && canManage) {
      const id = plan.id;
      return (
        <button
          type="button"
          className={PRIMARY}
          disabled={planChange.pending}
          onClick={() => onChangePlan(id)}
        >
          {planChange.pending ? "Saving…" : `Keep ${PERSONAL_PLAN_NAMES[id]}`}
        </button>
      );
    }
    // The badge already says it; a paid plan is managed from the summary card.
    return null;
  }

  if (isPersonalPaidPlan(plan.id)) return <PersonalCta {...actions} plan={plan.id} />;

  if (plan.id === "team") {
    if (isLegacySolo(ent)) {
      // Live legacy Pro subscription swaps in place — no second checkout.
      return canManage ? (
        <button
          type="button"
          className={PRIMARY}
          disabled={switching}
          onClick={onSwitchToTeam}
        >
          {switching ? "Switching…" : "Switch to Team"}
        </button>
      ) : (
        <div className={MUTED}>Ask an admin</div>
      );
    }
    return canManage ? (
      <button type="button" className={PRIMARY} onClick={() => onUpgrade("team")}>
        Upgrade — {formatMoney(TEAM_SEAT_PRICE)}/seat
      </button>
    ) : (
      <div className={MUTED}>Ask an admin</div>
    );
  }

  return <div className={CURRENT}>Included</div>;
}
