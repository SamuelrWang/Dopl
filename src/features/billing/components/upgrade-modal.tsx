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
 * ⚠ THE CREDITS LINE IS INTERPOLATED, NEVER TYPED OUT (plans.ts's G4 rule) —
 * it said "10,000+ Credits every month" while the allowance was three other
 * numbers. "per member" is load-bearing on the TEAM list: the allocation is
 * fixed per person and NOT pooled (`credits.ts › SEAT_MONTHLY_CREDITS`).
 */
const TEAM_UNLOCKS = [
  "Uncapped ontology objects",
  "Full chat history restored",
  `${planNumber(SEAT_MONTHLY_CREDITS.team)} credits per member every month`,
  "Priority support",
] as const;

/**
 * What PRO buys on a personal container (2026-09-08).
 *
 * ⚠ **NO "per member", AND NO OBJECT-CAP LINE.** A personal container has one
 * member by construction, so "per member" would invite the reader to multiply;
 * and the ontology cap is a MULTI-member free rule (`plans.ts ›
 * FREE_MULTI_MEMBER_OBJECT_CAP`), so uncapping it is not something Pro sells —
 * a personal container was never capped. Listing it would be selling an unlock
 * the buyer already has.
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
   * ⚠ THE TWO VARIANTS DO NOT DIFFER ON *WHAT* THEY SELL WITHIN A KIND
   * (2026-09-07, Solo retired from sale) — only on why the modal opened and
   * what the blocked path has to explain. `AddMemberBlocked` lives in
   * `./upgrade-modal-parts`.
   *
   * ⚠ **"add-member" IS STANDARD-ONLY (2026-09-08)** and falls back to the
   * generic upsell on a personal container: that path exists because a member
   * could not be ADDED, and a personal container has no roster to add one to
   * (`server/entitlements.ts › assertCanAddMember`). Its whole pitch — seats,
   * "invite your team", the legacy single-member limit — describes a thing the
   * reader cannot do, so rendering it there would sell the wrong plan for the
   * wrong reason.
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
      {/* ⚠ BRANCHED ON THE PLAN, NOT THE CONTAINER: this line describes the
          session about to be created. `pro` is flat quantity-1, so seat math
          would name a unit it does not have. */}
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
  // ⚠ **`pro` GOES SEGMENT-LESS, DELIBERATELY (2026-09-08).** The hash segment
  // names the STANDARD workspace this window is showing, and `pro` is refused
  // there (400 `PLAN_NOT_FOR_CONTAINER`). Bare `/billing?plan=pro` is the one
  // link that resolves the caller's personal container (`app/billing/page.tsx`)
  // — a segment the desktop window never holds.
  if (plan === "pro") {
    return billingUrl(getAppOrigin(), { intent: "upgrade", plan });
  }
  const segment = window.location.hash.replace(/^#\/?/, "").split(/[/?#]/)[0];
  return billingUrl(getAppOrigin(), { segment, intent: "upgrade", plan });
}

/**
 * The free-container upsell — ONE option, because one plan is on sale FOR THIS
 * KIND: Team on a standard workspace, Pro on a personal one (2026-09-08).
 *
 * ⚠ THE SINGLE-MEMBER BRANCH IS GONE (2026-09-07). It offered Solo to a
 * one-member free workspace; Solo is retired from sale, and a workspace's
 * member count no longer changes what it can buy — unlimited members on both
 * tiers. ⚠ The kind branch below is NOT that branch coming back: it keys on the
 * CONTAINER, which decides which plan exists at all, not on how many people are
 * in it.
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
  // ⚠ Live (or grace-period) sub behind a free-reporting plan = degraded legacy
  // Solo sub; checkout would 409, so Team must swap in place via
  // /api/billing/upgrade-to-team. Entitled paid containers show
  // AlreadyPaidNote instead, so this only fires for the degraded case.
  // ⚠ STANDARD-ONLY: `solo` was never sold on a personal container, so there is
  // no subscription there to swap and a live one would be Pro itself.
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
                // ⚠ NO SEAT MATH AND NO ROSTER — `pro` is flat, quantity 1.
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
