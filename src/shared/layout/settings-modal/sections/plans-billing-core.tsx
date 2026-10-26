"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import {
  formatMoney,
  PERSONAL_PLAN_PRICES,
  PRO_PRICE,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
} from "@/features/billing/prices";
import type { WalletKind } from "@/features/billing/credits";
import {
  PERSONAL_PLAN_NAMES,
  personalPlanRank,
  plansForKind,
  type PersonalPaidPlan,
} from "@/features/billing/plans";
import { useUpgradeConfirm } from "@/features/billing/components/upgrade-confirm-dialog";
import { usePersonalPlanChange } from "@/features/billing/components/use-personal-plan-change";
import { formatDate } from "@/shared/lib/format-time";
import { apiRequest, ApiError } from "@/shared/api/api-client";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { pillButton } from "@/shared/ui/pill-button";
import { CHIP } from "@/shared/ui/wells";
import {
  isLegacySolo,
  PlanColumn,
  type CheckoutPlan,
  type PlanActions,
} from "./plan-cards";
import { SettingsPane, SettingsPanel } from "./settings-panel";

export type { CheckoutPlan };

export interface PlansBillingCoreProps {
  /** Set from a Stripe redirect — polls status until it settles. "success"
   *  (checkout) celebrates + finalizes; "return" (portal cancel/downgrade)
   *  polls quietly so a stale paid card doesn't linger. */
  billingReturn?: "success" | "return" | null;
  role: Role;
  workspaceId?: string;
  /** ONLY Stripe-shaped action here: web mounts embedded checkout in place,
   *  desktop opens the web billing surface in the browser (packaged CSP
   *  refuses the Stripe script and every network origin). */
  onUpgrade: (plan: CheckoutPlan) => void;
  /** Stripe billing portal. Binding-owned because reaching it leaves this
   *  document — same-tab redirect on web, `openExternal` on desktop. */
  onManage: () => void;
  /** Portal request state, owned by whoever owns `onManage`. */
  portalLoading?: boolean;
  portalError?: string | null;
}

/**
 * Plans & Billing — the cards depend on the container
 * (`plans.ts › plansForKind`, 2026-09-08):
 *
 *   - a STANDARD workspace sells seats — Starter and Team (two cards);
 *   - a `kind='home'` container sells one person their own home space —
 *     Free, Pro and Max (three cards since 2026-10-22). A live Pro or Max
 *     subscription switches tier IN PLACE (`/api/billing/change-plan`, via
 *     `usePersonalPlanChange`), never through a second checkout.
 *
 * Every figure is interpolated from `billing/credits.ts` / `billing/prices.ts`
 * — never restated here (plans.ts's G4 rule).
 *
 * ⚠ **THE TWO GROUPS ARE NEVER CONCATENATED AND NEVER CROSS.** `pro` is refused
 * checkout on a standard workspace and `team` on a personal one (400
 * `PLAN_NOT_FOR_CONTAINER`), so a pane that showed all four cards would be
 * offering two purchases that answer 400.
 *
 * ⚠ PRO/`solo` — the RETIRED flat WORKSPACE plan, a different thing from the
 * personal `pro` above — IS RETIRED FROM SALE (2026-09-07) AND HAS NO CARD. A
 * workspace still holding a live legacy row gets a one-line note plus the
 * in-place `/api/billing/upgrade-to-team` switch (no second checkout); nothing
 * sells it. That note is STANDARD-ONLY: a home space cannot hold one.
 * Admins/owners upgrade, switch, or open the portal.
 * ⚠ `workspaceId` scopes every read/checkout/portal call to the workspace whose
 * settings are open — without it the DEFAULT workspace leaks in.
 * Next- and Stripe-free core; Stripe hand-offs arrive as props.
 * `./plans-billing` = web binding, desktop's is
 * `apps/desktop-ui/src/components/settings-modal/billing-pane.tsx`.
 */
export function PlansBillingCore({
  billingReturn = null,
  role,
  workspaceId,
  onUpgrade,
  onManage,
  portalLoading = false,
  portalError = null,
}: PlansBillingCoreProps) {
  const ent = useWorkspaceEntitlements(workspaceId);
  const canManage = meetsMinRole(role, "admin");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const isSuccessReturn = billingReturn === "success";
  const pollOnMount = billingReturn !== null;
  const [finalizing, setFinalizing] = useState(isSuccessReturn);
  // The Pro ⇄ Max switch reads Stripe for a queued downgrade, so it is asked
  // only where one can exist: a live personal plan the caller may manage.
  const personal = usePersonalPlanChange(
    workspaceId,
    ent.containerKind === "home" && ent.isPaid && canManage
  );
  const confirmUpgrade = useUpgradeConfirm(personal, () => void ent.refresh());
  const planChange = {
    scheduledPlan: personal.scheduledPlan,
    effectiveAt: personal.effectiveAt,
    pending: personal.pending || confirmUpgrade.loading,
  };
  // 🔒 AN UPGRADE CHARGES TODAY, SO IT IS CONFIRMED WITH THE AMOUNT FIRST
  // (2026-10-22 review); a downgrade or "Keep …" charges nothing and runs as clicked.
  async function handleChangePlan(plan: PersonalPaidPlan) {
    const current = ent.isPaid ? ent.personalPlan : null;
    if (current && personalPlanRank(plan) > personalPlanRank(current)) {
      await confirmUpgrade.request(plan);
      return;
    }
    if (await personal.change(plan)) await ent.refresh();
  }
  const plans = plansForKind(ent.containerKind);

  useEffect(() => {
    if (!pollOnMount) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      ent.refresh();
      if (attempts >= 20) {
        window.clearInterval(timer);
        setFinalizing(false);
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollOnMount]);

  useEffect(() => {
    if (ent.isPaid) setFinalizing(false);
  }, [ent.isPaid]);

  // Live Solo → Team, swapped in place on the existing subscription. Pure API,
  // no checkout, so it runs identically over either transport.
  async function handleSwitchToTeam() {
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await apiRequest<{ ok: boolean; seatCount: number }>(
        "/api/billing/upgrade-to-team",
        { method: "POST", workspaceId }
      );
      if (!res?.ok) {
        setSwitchError("The switch didn't complete — please try again.");
        return;
      }
      await ent.refresh();
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "NOT_ON_SOLO" || err.message === "NOT_ON_SOLO")
      ) {
        setSwitchError("This workspace isn't on the legacy Pro plan anymore — refreshing.");
        void ent.refresh();
      } else {
        setSwitchError(userFacingMessage(err, "Couldn't switch to Team"));
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <SettingsPane>
      <SettingsPanel
        id="settings-billing-plan"
        label="Plans and Billing"
        action={
          <button
            type="button"
            className={NAKED_ICON_BUTTON}
            onClick={() => ent.refresh()}
            aria-label="Refresh billing status"
          >
            <RefreshCw size={NAKED_ICON} />
          </button>
        }
      >
        {isSuccessReturn && ent.isPaid && (
          <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-caption text-success">
            {/* ⚠ A home space has no seats to count — naming them here
                would report a roster the container cannot have. */}
            {ent.containerKind === "home"
              ? `Welcome to ${PERSONAL_PLAN_NAMES[ent.personalPlan ?? "pro"]}.`
              : `Welcome to Team — ${ent.billableSeats} ${
                  ent.billableSeats === 1 ? "seat" : "seats"
                } active.`}
          </div>
        )}
        {finalizing && !ent.isPaid && (
          <p className="px-1 text-caption text-text-secondary">Finalizing your plan…</p>
        )}

        {ent.isPastDue && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-caption text-warning">
            <div className="font-semibold">Payment past due</div>
            <div className="mt-0.5 text-text-secondary">
              Your{" "}
              {ent.personalPlan
                ? PERSONAL_PLAN_NAMES[ent.personalPlan]
                : ent.isSolo
                  ? "legacy Pro"
                  : "Team"}{" "}
              plan
              stays active for now. Update your payment method to avoid losing
              paid features.
              {canManage && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onManage}
                    disabled={portalLoading}
                    className="cursor-pointer font-semibold text-warning underline disabled:opacity-50"
                  >
                    Update payment method
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <BillingSummary
          ent={ent}
          canManage={canManage}
          portalLoading={portalLoading}
          switching={switching}
          onUpgrade={onUpgrade}
          onManage={onManage}
          onSwitchToTeam={handleSwitchToTeam}
          planChange={planChange}
          onChangePlan={(plan) => void handleChangePlan(plan)}
        />

        {personal.error && <p className="px-1 text-caption text-danger">{personal.error}</p>}
        {personal.notice && (
          <p className="px-1 text-caption text-text-secondary">{personal.notice}</p>
        )}
        {confirmUpgrade.dialog}
        {portalError && <p className="px-1 text-caption text-danger">{portalError}</p>}
        {switchError && <p className="px-1 text-caption text-danger">{switchError}</p>}
      </SettingsPanel>

      <SettingsPanel id="settings-billing-plans" label="Plans">
        <div
          className={cn(
            "grid gap-3 max-[900px]:grid-cols-1",
            plans.length === 3 ? "grid-cols-3" : "grid-cols-2"
          )}
        >
          {plans.map((plan) => (
            <PlanColumn
              key={plan.id}
              plan={plan}
              ent={ent}
              canManage={canManage}
              switching={switching}
              onUpgrade={onUpgrade}
              onSwitchToTeam={handleSwitchToTeam}
              planChange={planChange}
              onChangePlan={(next) => void handleChangePlan(next)}
            />
          ))}
        </div>
      </SettingsPanel>
    </SettingsPane>
  );
}

function creditsLabel(wallet: WalletKind | null): string {
  if (wallet === "seat") return "Your credits";
  if (wallet === "personal") return "Personal credits";
  return "Credits";
}

/** ⚠ Named off the CARD LIST this container is shown, so the badge and the
 *  cards under it cannot disagree about which product the reader is on. */
function planLabel(ent: WorkspaceEntitlements): string {
  if (ent.containerKind === "home") {
    return ent.isPaid && ent.personalPlan
      ? `${PERSONAL_PLAN_NAMES[ent.personalPlan]} plan`
      : "Free plan";
  }
  if (ent.isSolo) return "Legacy Pro plan";
  if (ent.isTeam) return "Team plan";
  return "Starter plan";
}

function BillingSummary({
  ent,
  canManage,
  portalLoading,
  switching,
  onUpgrade,
  onManage,
  onSwitchToTeam,
  planChange,
}: PlanActions) {
  // The one branch that decides every line below: a home space is one
  // person's home space, so it has no seats, no roster and no legacy row.
  const isHomeSpace = ent.containerKind === "home";

  if (ent.loading) {
    return <div className="white-card h-24 animate-pulse opacity-50" />;
  }

  return (
    <div className="white-card p-3.5">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            ent.isPaid
              ? "rounded-full border border-border-strong bg-surface-cta px-2.5 py-0.5 text-small font-medium text-text-on-cta"
              : CHIP
          )}
        >
          {planLabel(ent)}
        </span>
        {/* ⚠ NO MEMBER COUNT ON A HOME SPACE. It has exactly one member
            by construction and cannot gain another, so "1 member" is a fact
            about the schema rather than about this reader's plan. */}
        {!isHomeSpace && (
          <span className="text-caption text-text-secondary">
            {ent.memberCount} {ent.memberCount === 1 ? "member" : "members"}
          </span>
        )}
      </div>

      {isHomeSpace ? (
        ent.isPaid &&
        ent.personalPlan && (
          <>
            <div className="mt-3 text-body text-text-primary">
              <span className="font-semibold">
                {formatMoney(PERSONAL_PLAN_PRICES[ent.personalPlan])}
              </span>{" "}
              <span className="text-caption text-text-muted">/ month</span>
            </div>
            {/* A queued Max → Pro downgrade: the date it lands, and that the
                current plan stays until then. "Keep …" lives on the card. */}
            {planChange.scheduledPlan && planChange.effectiveAt && (
              <p className="mt-1 text-caption text-text-secondary">
                Switches to {PERSONAL_PLAN_NAMES[planChange.scheduledPlan]} on{" "}
                {formatDate(planChange.effectiveAt)}
              </p>
            )}
          </>
        )
      ) : isLegacySolo(ent) ? (
        /* ⚠ A NOTE, NOT A CARD. Pro is retired from sale; the only thing this
           row can still do is keep paying or switch to Team (button below). */
        <div className="mt-3 text-caption text-text-secondary">
          On the legacy Pro plan — {formatMoney(SOLO_PRICE)} / month
        </div>
      ) : ent.isTeam ? (
        <div className="mt-3 text-body text-text-primary">
          <span className="font-semibold">{ent.billableSeats}</span>{" "}
          {ent.billableSeats === 1 ? "seat" : "seats"} ×{" "}
          {formatMoney(TEAM_SEAT_PRICE)} ={" "}
          <span className="font-semibold">{formatMoney(ent.monthlyTotal)}</span>{" "}
          <span className="text-caption text-text-muted">/ month</span>
        </div>
      ) : (
        <>
          {ent.isCapped && ent.objectCap !== null && (
            <UsageMeter
              label="Ontology objects"
              used={ent.objectsUsed}
              limit={ent.objectCap}
              over={ent.overCap}
              overNote="New objects are paused. Nothing was deleted — reads and edits still work."
            />
          )}
          {!ent.chatsWindowDays && (
            <p className="mt-3 text-caption text-text-secondary">
              Full chat history is available.
            </p>
          )}
        </>
      )}

      {/* Outside the plan branch on purpose: credits are metered on EVERY plan,
          unlike the object cap (capped free workspaces only). ⚠ THE READING IS
          THE CALLER'S OWN — their seat in this workspace — not a pooled
          workspace total (`server/status-service.ts`). */}
      <UsageMeter
        label={creditsLabel(ent.credits.wallet)}
        used={ent.credits.used}
        limit={ent.credits.limit}
        over={ent.credits.remaining === 0 && ent.credits.limit > 0}
        overNote="Tool calls are paused until the next period."
      />
      {/* 🔒 **THE FAIL-OPEN CAPTION — ONE MUTED WORD, AND NOTHING AT ALL WHEN
          THIS PROCESS IS METERING (2026-09-14).** The consume route fails OPEN
          by decision, so a dead RPC runs every MCP tool call UNMETERED and this
          meter prints the same `0` a quiet month prints. The SAME word the /home
          Overview puts in its Credits card (`src/features/home/components/
          overview/overview-credits.tsx › CreditsCard`), off the same field, so the
          two surfaces cannot say different things about one outage.
          ⚠ **MINIMAL COPY (INVARIANTS §5): the word, not the timestamp, and no
          explainer sentence.** The ISO instant is on the payload and in the log.
          ⚠ **NOT `degraded`** — that is a decided posture about the answer; this
          is a fault on the charge path. */}
      {ent.credits.unmeteredSince && (
        <p className="mt-1.5 text-caption text-text-muted">Unmetered</p>
      )}

      <div className="mt-4">
        {ent.isPaid ? (
          canManage ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={portalLoading}
                onClick={onManage}
                className={pillButton("outline", "md")}
              >
                {portalLoading ? "Loading…" : "Manage billing"}
              </button>
              {isLegacySolo(ent) && (
                <button
                  type="button"
                  disabled={switching}
                  onClick={onSwitchToTeam}
                  className={cn(pillButton("ink", "md"), "disabled:cursor-default disabled:opacity-60")}
                >
                  {switching
                    ? "Switching…"
                    : `Switch to Team — ${formatMoney(TEAM_SEAT_PRICE)}/seat`}
                </button>
              )}
            </div>
          ) : (
            <p className="text-caption text-text-muted">
              Contact a workspace admin to manage billing.
            </p>
          )
        ) : canManage ? (
          isHomeSpace ? (
            <button
              type="button"
              onClick={() => onUpgrade("pro")}
              className={pillButton("ink", "md")}
            >
              Upgrade to Pro — {formatMoney(PRO_PRICE)}/month
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onUpgrade("team")}
              className={pillButton("ink", "md")}
            >
              Upgrade to Team — {formatMoney(TEAM_SEAT_PRICE)}/seat
            </button>
          )
        ) : (
          <p className="text-caption text-text-muted">
            Ask a workspace admin or owner to upgrade this workspace.
          </p>
        )}
      </div>
    </div>
  );
}

