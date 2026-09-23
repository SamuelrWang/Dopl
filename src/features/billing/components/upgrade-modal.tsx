"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import { Check } from "lucide-react";
// Deep import, not the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`. This modal
// mounts in desktop-SPA-reused pages, where any `next/*` fails the build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { apiRequest, ApiError } from "@/shared/api/api-client";
import { getSpaBridge, isSpaRenderer } from "@/shared/lib/spa-bridge";
import { getAppOrigin } from "@/shared/lib/app-origin";
import { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } from "../credits";
import { planNumber } from "../plans";
import { formatMoney, PRO_PRICE, TEAM_SEAT_PRICE } from "../prices";
import { billingUrl, type CheckoutPlan } from "../url";
import { EmbeddedCheckoutForm } from "./embedded-checkout";
import {
  AddMemberBlocked,
  AlreadyPaidNote,
  AskAdminNote,
  PlanOption,
  type Ent,
} from "./upgrade-modal-parts";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";

/**
 * The credits line is interpolated, never typed out (plans.ts's G4 rule).
 * "per member" is load-bearing on the Team list: the allocation is fixed per
 * person and not pooled (`credits.ts › SEAT_MONTHLY_CREDITS`).
 */
const TEAM_UNLOCKS = [
  "Uncapped ontology objects",
  "Full chat history restored",
  `${planNumber(SEAT_MONTHLY_CREDITS.team)} credits per member every month`,
  "Priority support",
] as const;

/**
 * What Pro buys on a personal container (2026-09-08). No "per member" (one
 * member by construction) and no object-cap line — the cap is a multi-member
 * free rule (`plans.ts › FREE_MULTI_MEMBER_OBJECT_CAP`), so listing it would
 * sell an unlock the buyer already has.
 */
const PRO_UNLOCKS = [
  `${planNumber(PERSONAL_MONTHLY_CREDITS.pro)} credits a month`,
  "Full chat history",
  "Priority support",
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scope the seat / total figures to a specific workspace. */
  workspaceId?: string;
  /** Admin/owner only — others get an "ask an admin" note instead of checkout. */
  canManageBilling?: boolean;
  /** Optional context line explaining why the modal opened. */
  reason?: string;
  /**
   * "generic" (default): the free-container upsell — Team on a standard
   * workspace, Pro on a personal one.
   * "add-member": invite/join blocked path — Team, and a live legacy Pro sub
   * swaps in place via `/api/billing/upgrade-to-team` (no checkout).
   *
   * The variants differ only in why the modal opened, not in what they sell
   * within a kind. "add-member" is standard-only (2026-09-08) and falls back to
   * the generic upsell on a personal container, which has no roster to add to
   * (`server/entitlements.ts › assertCanAddMember`).
   */
  variant?: "generic" | "add-member";
}

export function UpgradeModal({
  open,
  onOpenChange,
  workspaceId,
  canManageBilling = true,
  reason,
  variant = "generic",
}: Props) {
  const ent = useWorkspaceEntitlements(workspaceId);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  function close() {
    setCheckoutPlan(null);
    setSwitchError(null);
    onOpenChange(false);
  }

  async function switchToTeam() {
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await apiRequest<{ ok: boolean; seatCount: number }>(
        "/api/billing/upgrade-to-team",
        { method: "POST", workspaceId }
      );
      if (res?.ok) {
        await ent.refresh();
        close();
        return;
      }
      setSwitchError("The switch didn't complete — please try again.");
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "NOT_ON_SOLO" || err.message === "NOT_ON_SOLO")
      ) {
        setSwitchError(
          "This workspace is no longer on the legacy Pro plan. Refreshing billing state…"
        );
        void ent.refresh();
      } else {
        setSwitchError(userFacingMessage(err, "Couldn't switch to Team"));
      }
    } finally {
      setSwitching(false);
    }
  }

  const isPersonal = ent.containerKind === "personal";
  const showAddMember = variant === "add-member" && !isPersonal;

  const label = showAddMember
    ? "Upgrade to add members"
    : isPersonal
      ? "Upgrade to Pro"
      : "Upgrade your workspace";

  return (
    <ModalShell open={open} onClose={close} label={label} size="narrow">
      <div className="p-6">
        {checkoutPlan ? (
          <CheckoutView
            plan={checkoutPlan}
            ent={ent}
            workspaceId={workspaceId}
            onBack={() => setCheckoutPlan(null)}
          />
        ) : showAddMember ? (
          <AddMemberBlocked
            ent={ent}
            reason={reason}
            canManageBilling={canManageBilling}
            switching={switching}
            switchError={switchError}
            onSwitchToTeam={() => void switchToTeam()}
            onCheckout={() => setCheckoutPlan("team")}
            onClose={close}
          />
        ) : (
          <GenericUpsell
            ent={ent}
            reason={reason}
            canManageBilling={canManageBilling}
            switching={switching}
            switchError={switchError}
            onSwitchToTeam={() => void switchToTeam()}
            onChoose={setCheckoutPlan}
            onClose={close}
          />
        )}
      </div>
    </ModalShell>
  );
}

function CheckoutView({
  plan,
  ent,
  workspaceId,
  onBack,
}: {
  plan: CheckoutPlan;
  ent: Ent;
  workspaceId?: string;
  onBack: () => void;
}) {
  const seats = ent.billableSeats;
  const isPro = plan === "pro";
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 cursor-pointer text-small text-text-secondary transition-colors hover:text-text-primary"
      >
        ← Back
      </button>
      <h2 className="mb-1 text-display font-semibold tracking-tight text-text-primary">
        Subscribe to {isPro ? "Pro" : "Team"}
      </h2>
      {/* Branched on the plan, not the container: this line describes the
          session about to be created, and `pro` is flat quantity-1, so seat
          math would name a unit it does not have. */}
      <p className="mb-4 text-caption text-text-secondary">
        {isPro
          ? `${formatMoney(PRO_PRICE)} / month`
          : `${seats} ${seats === 1 ? "seat" : "seats"} · ${formatMoney(
              seats * TEAM_SEAT_PRICE
            )} / month`}
      </p>
      {isSpaRenderer() ? (
        <BrowserCheckoutHandoff plan={plan} />
      ) : (
        <EmbeddedCheckoutForm workspaceId={workspaceId} plan={plan} />
      )}
    </div>
  );
}

/**
 * Desktop leg of checkout — same handoff as
 * `apps/desktop-ui/src/components/settings-modal/billing-pane.tsx`. The
 * packaged renderer cannot mount Stripe at all (`script-src 'self'`,
 * `connect-src 'none'`, `frame-src 'none'`, and a `file://` document), so the
 * paywall stops at the pitch and sends the purchase to the browser (GAP-9).
 */
function BrowserCheckoutHandoff({ plan }: { plan: CheckoutPlan }) {
  const [opened, setOpened] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void getSpaBridge()?.openExternal(browserBillingUrl(plan));
          setOpened(true);
        }}
        className="auth-btn-3d flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-small font-semibold text-white"
      >
        Continue in your browser
      </button>
      <p className="mt-3 text-caption text-text-secondary">
        {opened
          ? "Finish the payment in your browser — your plan updates here as soon as it lands."
          : "Payment steps finish in your browser — the desktop app never handles card details."}
      </p>
    </div>
  );
}

/**
 * `/billing/{segment}?billing=upgrade&plan=…` for the workspace the desktop app
 * is currently showing (`src/app/billing/[segment]/page.tsx`). Segment comes off
 * the desktop hash router's location, since a segment-less `/billing` resolves
 * or asks and need not land on the one being upgraded. Origin comes from the
 * preload constant, never `window.location` (a `file://` document here).
 */
function browserBillingUrl(plan: CheckoutPlan): string {
  // `pro` goes segment-less deliberately (2026-09-08): the hash segment names
  // the standard workspace this window is showing, where `pro` is refused (400
  // `PLAN_NOT_FOR_CONTAINER`). Bare `/billing?plan=pro` is the one link that
  // resolves the caller's personal container (`app/billing/page.tsx`).
  if (plan === "pro") {
    return billingUrl(getAppOrigin(), { intent: "upgrade", plan });
  }
  const segment = window.location.hash.replace(/^#\/?/, "").split(/[/?#]/)[0];
  return billingUrl(getAppOrigin(), { segment, intent: "upgrade", plan });
}

/**
 * The free-container upsell — one option, because one plan is on sale for this
 * kind: Team on a standard workspace, Pro on a personal one (2026-09-08). The
 * branch below keys on the container, never on member count: since Solo was
 * retired (2026-09-07) a workspace's size no longer changes what it can buy.
 */
function GenericUpsell({
  ent,
  reason,
  canManageBilling,
  switching,
  switchError,
  onSwitchToTeam,
  onChoose,
  onClose,
}: {
  ent: Ent;
  reason?: string;
  canManageBilling: boolean;
  switching: boolean;
  switchError: string | null;
  onSwitchToTeam: () => void;
  onChoose: (plan: CheckoutPlan) => void;
  onClose: () => void;
}) {
  const isPersonal = ent.containerKind === "personal";
  // A live (or grace-period) sub behind a free-reporting plan is a degraded
  // legacy Solo sub; checkout would 409, so Team swaps in place via
  // /api/billing/upgrade-to-team. Entitled paid containers show AlreadyPaidNote
  // instead. Standard-only: `solo` was never sold on a personal container.
  const hasLiveSub =
    !isPersonal && (ent.status === "active" || ent.status === "past_due");
  const unlocks = isPersonal ? PRO_UNLOCKS : TEAM_UNLOCKS;

  return (
    <div>
      <h2 className="text-display font-semibold tracking-tight text-text-primary">
        {isPersonal ? "Upgrade to Pro" : "Upgrade your workspace"}
      </h2>
      {reason && (
        <p className="mt-1 text-caption text-text-secondary">{reason}</p>
      )}

      <ul className="mt-4 flex flex-col gap-2.5">
        {unlocks.map((f) => (
          <li
            key={f}
            className="flex items-start gap-2 text-small leading-snug text-text-primary"
          >
            <Check
              size={13}
              strokeWidth={2.4}
              className="mt-0.5 shrink-0 text-success"
            />
            {f}
          </li>
        ))}
      </ul>

      {ent.loading ? (
        <div className="bento mt-5 h-24 animate-pulse opacity-50" />
      ) : ent.isPaid ? (
        <AlreadyPaidNote ent={ent} onClose={onClose} />
      ) : (
        <>
          {switchError && (
            <p className="mt-4 text-caption text-danger">{switchError}</p>
          )}
          <div className="mt-5 flex flex-col gap-2.5">
            {isPersonal ? (
              <PlanOption
                title="Pro"
                priceLine={
                  <>
                    {formatMoney(PRO_PRICE)}{" "}
                    <span className="text-caption font-normal text-text-muted">
                      / month
                    </span>
                  </>
                }
                // No seat math and no roster — `pro` is flat, quantity 1.
                pitch="Billed monthly. Cancel anytime."
                cta="Continue to checkout"
                highlight
                canManageBilling={canManageBilling}
                onSelect={() => onChoose("pro")}
              />
            ) : (
              <PlanOption
                title="Team"
                priceLine={
                  <>
                    {formatMoney(TEAM_SEAT_PRICE)}{" "}
                    <span className="text-caption font-normal text-text-muted">
                      / seat / month
                    </span>
                  </>
                }
                pitch={`${ent.billableSeats} ${
                  ent.billableSeats === 1 ? "member" : "members"
                } × ${formatMoney(TEAM_SEAT_PRICE)} = ${formatMoney(
                  ent.billableSeats * TEAM_SEAT_PRICE
                )} / month. Seats sync automatically as your team changes.`}
                cta={
                  hasLiveSub
                    ? switching
                      ? "Switching to Team…"
                      : "Switch to Team"
                    : "Continue to checkout"
                }
                highlight
                canManageBilling={canManageBilling}
                disabled={hasLiveSub && switching}
                // Degraded legacy Solo (live sub): swap in place. Else checkout.
                onSelect={hasLiveSub ? onSwitchToTeam : () => onChoose("team")}
              />
            )}
          </div>

          {canManageBilling ? (
            <button
              type="button"
              onClick={onClose}
              className="btn-light mt-4 flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-small font-medium text-text-primary"
            >
              Maybe later
            </button>
          ) : (
            <AskAdminNote
              onClose={onClose}
              action={isPersonal ? "upgrade your plan" : "upgrade this workspace"}
            />
          )}
        </>
      )}
    </div>
  );
}
