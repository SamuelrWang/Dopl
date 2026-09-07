"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  formatMoney,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import type { WalletKind } from "@/features/billing/credits";
import { PLANS } from "@/features/billing/plans";
import { apiRequest, ApiError } from "@/shared/api/api-client";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { isLegacySolo, PlanColumn, type CheckoutPlan, type PlanActions } from "./plan-cards";

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
 * Plans & Billing — TWO cards: Starter (free, 100 credits per member per month)
 * and Team ($8 per seat per month, 5,000 credits per member per month). Every
 * figure is interpolated from `billing/credits.ts` / `use-workspace-entitlements`
 * — never restated here (plans.ts's G4 rule).
 *
 * ⚠ PRO/`solo` IS RETIRED FROM SALE (2026-09-07) AND HAS NO CARD. A workspace
 * still holding a live legacy row gets a one-line note plus the in-place
 * `/api/billing/upgrade-to-team` switch (no second checkout); nothing sells it.
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
        setSwitchError(
          err instanceof Error ? err.message : "Couldn't switch to Team"
        );
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          Plans and Billing
        </h2>
        <button
          type="button"
          className="cursor-pointer p-1 text-text-muted transition-colors hover:text-text-secondary"
          onClick={() => ent.refresh()}
          aria-label="Refresh billing status"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {isSuccessReturn && ent.isPaid && (
        <div className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-caption text-success">
          {`Welcome to Team — ${ent.billableSeats} ${
            ent.billableSeats === 1 ? "seat" : "seats"
          } active.`}
        </div>
      )}
      {finalizing && !ent.isPaid && (
        <div className="mb-4 rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
          Finalizing your subscription… this usually takes a few seconds.
        </div>
      )}

      {ent.isPastDue && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-caption text-warning">
          <div className="font-semibold">Payment past due</div>
          <div className="mt-0.5 text-text-secondary">
            Your {ent.isSolo ? "legacy Pro" : "Team"} workspace stays active
            for now. Update your payment method to avoid losing paid features.
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
      />

      {portalError && <p className="mb-3 text-caption text-danger">{portalError}</p>}
      {switchError && <p className="mb-3 text-caption text-danger">{switchError}</p>}

      <div className="grid grid-cols-2 gap-2 max-[900px]:grid-cols-1">
        {PLANS.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            ent={ent}
            canManage={canManage}
            portalLoading={portalLoading}
            switching={switching}
            onUpgrade={onUpgrade}
            onManage={onManage}
            onSwitchToTeam={handleSwitchToTeam}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Whose meter this is. `wallet` says which counter the status endpoint read —
 * the caller's SEAT in this workspace, or their PERSONAL home-space wallet
 * (`billing/credits.ts › WalletKind`). Null = an older cached payload; the
 * neutral label claims nothing about the payer.
 */
function creditsLabel(wallet: WalletKind | null): string {
  if (wallet === "seat") return "Your credits";
  if (wallet === "personal") return "Personal credits";
  return "Credits";
}

function planLabel(ent: WorkspaceEntitlements): string {
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
}: PlanActions) {
  if (ent.loading) {
    return <div className="bento mb-5 h-24 animate-pulse opacity-50" />;
  }

  return (
    <div className="bento mb-5 p-4">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-caption font-semibold",
            ent.isPaid
              ? "border-border-strong bg-surface-cta text-text-on-cta"
              : "border-border-strong bg-bg-inset text-text-secondary"
          )}
        >
          {planLabel(ent)}
        </span>
        <span className="text-caption text-text-secondary">
          {ent.memberCount} {ent.memberCount === 1 ? "member" : "members"}
        </span>
      </div>

      {isLegacySolo(ent) ? (
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

      <div className="mt-4">
        {ent.isPaid ? (
          canManage ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={portalLoading}
                onClick={onManage}
                className="btn-light flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50"
              >
                {portalLoading ? "Loading…" : "Manage billing"}
              </button>
              {isLegacySolo(ent) && (
                <button
                  type="button"
                  disabled={switching}
                  onClick={onSwitchToTeam}
                  className="auth-btn-3d flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white disabled:cursor-default disabled:opacity-60"
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
          <button
            type="button"
            onClick={() => onUpgrade("team")}
            className="auth-btn-3d flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white"
          >
            Upgrade to Team — {formatMoney(TEAM_SEAT_PRICE)}/seat
          </button>
        ) : (
          <p className="text-caption text-text-muted">
            Ask a workspace admin or owner to upgrade this workspace.
          </p>
        )}
      </div>
    </div>
  );
}

