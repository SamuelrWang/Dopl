"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import {
  formatMoney,
  PRO_PRICE,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
} from "@/features/billing/prices";
import type { WalletKind } from "@/features/billing/credits";
import { plansForKind } from "@/features/billing/plans";
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
 * Plans & Billing — TWO cards, and WHICH TWO depends on the container
 * (`plans.ts › plansForKind`, 2026-09-08):
 *
 *   - a STANDARD workspace sells seats — Starter (free, 100 credits per member
 *     per month) and Team ($8.99 per seat per month, 5,000 per member);
 *   - a `kind='personal'` container sells one person their own home space —
 *     Free (500 credits a month) and Pro ($8.99 a month, 5,000).
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
 * sells it. That note is STANDARD-ONLY: a personal container cannot hold one.
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
          {/* ⚠ A personal container has no seats to count — naming them here
              would report a roster the container cannot have. */}
          {ent.containerKind === "personal"
            ? "Welcome to Pro."
            : `Welcome to Team — ${ent.billableSeats} ${
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
            Your {ent.isPro ? "Pro" : ent.isSolo ? "legacy Pro" : "Team"} plan
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
      />

      {portalError && <p className="mb-3 text-caption text-danger">{portalError}</p>}
      {switchError && <p className="mb-3 text-caption text-danger">{switchError}</p>}

      <div className="grid grid-cols-2 gap-2 max-[900px]:grid-cols-1">
        {plansForKind(ent.containerKind).map((plan) => (
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

/** ⚠ Named off the CARD LIST this container is shown, so the badge and the
 *  cards under it cannot disagree about which product the reader is on. */
function planLabel(ent: WorkspaceEntitlements): string {
  if (ent.containerKind === "personal") {
    return ent.isPro ? "Pro plan" : "Free plan";
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
}: PlanActions) {
  // The one branch that decides every line below: a personal container is one
  // person's home space, so it has no seats, no roster and no legacy row.
  const isPersonal = ent.containerKind === "personal";

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
        {/* ⚠ NO MEMBER COUNT ON A PERSONAL CONTAINER. It has exactly one member
            by construction and cannot gain another, so "1 member" is a fact
            about the schema rather than about this reader's plan. */}
        {!isPersonal && (
          <span className="text-caption text-text-secondary">
            {ent.memberCount} {ent.memberCount === 1 ? "member" : "members"}
          </span>
        )}
      </div>

      {isPersonal ? (
        ent.isPro && (
          <div className="mt-3 text-body text-text-primary">
            <span className="font-semibold">{formatMoney(PRO_PRICE)}</span>{" "}
            <span className="text-caption text-text-muted">/ month</span>
          </div>
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
          bar puts in its caption row (`apps/desktop-ui/src/pages/home/
          overview-sections.tsx › CreditCapacityBar`), off the same field, so the
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
          isPersonal ? (
            <button
              type="button"
              onClick={() => onUpgrade("pro")}
              className="auth-btn-3d flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white"
            >
              Upgrade to Pro — {formatMoney(PRO_PRICE)}/month
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onUpgrade("team")}
              className="auth-btn-3d flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white"
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

