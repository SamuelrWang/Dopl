"use client";

import { useState } from "react";
import { Check } from "lucide-react";
// ⚠ Deep import, NOT the `settings-modal` barrel: the barrel re-exports
// SettingsModal, whose section tree reaches `next/navigation`. This modal
// mounts in desktop-SPA-reused pages, where any `next/*` fails the build.
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { apiRequest, ApiError } from "@/shared/api/api-client";
import { getSpaBridge, isSpaRenderer } from "@/shared/lib/spa-bridge";
import { getAppOrigin } from "@/shared/lib/app-origin";
import { SEAT_MONTHLY_CREDITS } from "../credits";
import { planNumber } from "../plans";
import { billingUrl, type CheckoutPlan } from "../url";
import { EmbeddedCheckoutForm } from "./embedded-checkout";
import {
  AddMemberBlocked,
  AlreadyPaidNote,
  AskAdminNote,
  PlanOption,
  type Ent,
} from "./upgrade-modal-parts";
import {
  formatMoney,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
} from "./use-workspace-entitlements";

/**
 * ⚠ THE CREDITS LINE IS INTERPOLATED, NEVER TYPED OUT (plans.ts's G4 rule) —
 * it said "10,000+ Credits every month" while the allowance was three other
 * numbers. "per member" is load-bearing: the allocation is fixed per person and
 * NOT pooled (`credits.ts › SEAT_MONTHLY_CREDITS`).
 */
const PAID_UNLOCKS = [
  "Uncapped ontology objects",
  "Full chat history restored",
  `${planNumber(SEAT_MONTHLY_CREDITS.team)} credits per member every month`,
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
   * "generic" (default): free-workspace upsell — Team, the only plan on sale.
   * "add-member": invite/join blocked path — Team too, and a live legacy Pro sub
   * swaps in place via `/api/billing/upgrade-to-team` (no checkout).
   *
   * ⚠ THE TWO VARIANTS NO LONGER DIFFER ON *WHAT* THEY SELL (2026-09-07, Pro
   * retired from sale) — only on why the modal opened and what the blocked path
   * has to explain. `AddMemberBlocked` lives in `./upgrade-modal-parts`.
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
        setSwitchError(
          err instanceof Error ? err.message : "Couldn't switch to Team"
        );
      }
    } finally {
      setSwitching(false);
    }
  }

  const label =
    variant === "add-member" ? "Upgrade to add members" : "Upgrade your workspace";

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
        ) : variant === "add-member" ? (
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
        Subscribe to Team
      </h2>
      <p className="mb-4 text-caption text-text-secondary">
        {`${seats} ${seats === 1 ? "seat" : "seats"} · ${formatMoney(
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
 * DESKTOP leg of checkout — same handoff as
 * `apps/desktop-ui/src/components/settings-modal/billing-pane.tsx`.
 *
 * ⚠ Packaged renderer cannot mount Stripe at all: `script-src 'self'` refuses
 * js.stripe.com, `connect-src 'none'` its XHR, `frame-src 'none'` its iframes,
 * and the session fetch would resolve against a `file://` document. So the
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
 * is CURRENTLY showing (`src/app/billing/[segment]/page.tsx`).
 *
 * ⚠ Segment comes off the desktop hash router's location (`#/{segment}/…`): a
 * segment-less `/billing` resolves or asks, and either way not necessarily the
 * one being upgraded. Origin comes from the preload constant, never
 * `window.location` (a `file://` document here). `plan` rides along so the
 * browser opens straight into checkout.
 */
function browserBillingUrl(plan: CheckoutPlan): string {
  const segment = window.location.hash.replace(/^#\/?/, "").split(/[/?#]/)[0];
  return billingUrl(getAppOrigin(), { segment, intent: "upgrade", plan });
}

/**
 * The free-workspace upsell — ONE option, because there is one plan on sale.
 *
 * ⚠ THE SINGLE-MEMBER BRANCH IS GONE (2026-09-07). It offered Pro to a
 * one-member free workspace; Pro is retired from sale, and a workspace's member
 * count no longer changes what it can buy — unlimited members on both tiers.
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
  // ⚠ Live (or grace-period) sub behind a free-reporting plan = degraded legacy
  // Pro sub; checkout would 409, so Team must swap in place via
  // /api/billing/upgrade-to-team. Entitled paid workspaces show
  // AlreadyPaidNote instead, so this only fires for the degraded case.
  const hasLiveSub = ent.status === "active" || ent.status === "past_due";

  return (
    <div>
      <h2 className="text-display font-semibold tracking-tight text-text-primary">
        Upgrade your workspace
      </h2>
      {reason && (
        <p className="mt-1 text-caption text-text-secondary">{reason}</p>
      )}

      <ul className="mt-4 flex flex-col gap-2.5">
        {PAID_UNLOCKS.map((f) => (
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
              // Degraded legacy Pro (live sub): swap in place. Else checkout.
              onSelect={hasLiveSub ? onSwitchToTeam : () => onChoose("team")}
            />
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
            <AskAdminNote onClose={onClose} action="upgrade this workspace" />
          )}
        </>
      )}
    </div>
  );
}
