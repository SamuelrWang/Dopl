"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import {
  formatMoney,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { PLANS, type PlanDef } from "@/features/billing/plans";
import { apiRequest, ApiError } from "@/shared/api/api-client";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import styles from "../settings-modal.module.css";

type CheckoutPlan = "solo" | "team";

/**
 * Plans & Billing — Starter / Pro ($5.99 flat, single member) / Team
 * ($7.99 per seat). Shows the current plan, the per-plan price line, an
 * object usage meter when the free workspace is capped, the
 * chats-window note, and the right action: admins/owners upgrade
 * (embedded checkout with an explicit plan), switch a live Solo
 * subscription to Team in place (`/api/billing/upgrade-to-team` — no
 * second checkout), or manage billing (portal); everyone else sees plan
 * info with an "ask an admin" note. A past_due workspace keeps its paid
 * plan but surfaces a warning banner. `billingReturn` marks a Stripe
 * redirect back: "success" (checkout) polls + celebrates until the
 * webhook lands; "return" (portal cancel/downgrade) polls quietly so
 * the pane never lingers on a stale paid plan. `workspaceId` scopes
 * every read/checkout/portal call to the workspace whose settings are
 * open — without it the default workspace would leak in.
 */
export function PlansBilling({
  billingReturn = null,
  role,
  workspaceId,
}: {
  billingReturn?: "success" | "return" | null;
  role: Role;
  workspaceId?: string;
}) {
  const ent = useWorkspaceEntitlements(workspaceId);
  const canManage = meetsMinRole(role, "admin");
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
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

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: workspaceId ? { "x-workspace-id": workspaceId } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        // Portal route errors are flat strings; wrapper-layer errors
        // (withWorkspaceAuth) are the nested { error: { message } } shape.
        const message =
          typeof data.error === "string"
            ? data.error
            : typeof data.error?.message === "string"
              ? data.error.message
              : "Couldn't open billing portal";
        throw new Error(message);
      }
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  // Live Solo → Team, swapped in place on the existing subscription.
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
        setSwitchError("This workspace isn't on Pro anymore — refreshing.");
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

  if (checkoutPlan && !ent.isPaid) {
    return (
      <div>
        <button
          type="button"
          className="mb-4 cursor-pointer text-small text-text-secondary transition-colors hover:text-text-primary"
          onClick={() => setCheckoutPlan(null)}
        >
          ← Back to plans
        </button>
        <h2 className={styles.paneTitle}>
          {checkoutPlan === "solo" ? "Subscribe to Pro" : "Subscribe to Team"}
        </h2>
        <p className="mb-4 text-caption text-text-secondary">
          {checkoutPlan === "solo"
            ? `${formatMoney(SOLO_PRICE)} / month — flat, single member`
            : `${ent.billableSeats} ${ent.billableSeats === 1 ? "seat" : "seats"} · ${formatMoney(
                ent.billableSeats * TEAM_SEAT_PRICE
              )} / month`}
        </p>
        <EmbeddedCheckoutForm workspaceId={workspaceId} plan={checkoutPlan} />
      </div>
    );
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
          {ent.isSolo
            ? "Welcome to Pro — your workspace is unlocked."
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
            Your {ent.isSolo ? "Pro" : "Team"} workspace stays active for
            now. Update your payment method to avoid losing paid features.
            {canManage && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={handleManage}
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
        onUpgrade={setCheckoutPlan}
        onManage={handleManage}
        onSwitchToTeam={handleSwitchToTeam}
      />

      {portalError && <p className="mb-3 text-caption text-danger">{portalError}</p>}
      {switchError && <p className="mb-3 text-caption text-danger">{switchError}</p>}

      <div className="grid grid-cols-3 gap-2 max-[900px]:grid-cols-1">
        {PLANS.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            ent={ent}
            canManage={canManage}
            portalLoading={portalLoading}
            switching={switching}
            onUpgrade={setCheckoutPlan}
            onManage={handleManage}
            onSwitchToTeam={handleSwitchToTeam}
          />
        ))}
      </div>
    </div>
  );
}

interface PlanActions {
  ent: WorkspaceEntitlements;
  canManage: boolean;
  portalLoading: boolean;
  switching: boolean;
  onUpgrade: (plan: CheckoutPlan) => void;
  onManage: () => void;
  onSwitchToTeam: () => void;
}

function planLabel(ent: WorkspaceEntitlements): string {
  if (ent.isSolo) return "Pro plan";
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
  const soloEligible = ent.memberCount === 1;

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

      {ent.isSolo ? (
        <div className="mt-3 text-body text-text-primary">
          <span className="font-semibold">{formatMoney(SOLO_PRICE)}</span>{" "}
          <span className="text-caption text-text-muted">
            / month — flat, single-member workspace
          </span>
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
            <UsageMeter used={ent.objectsUsed} cap={ent.objectCap} over={ent.overCap} />
          )}
          {!ent.chatsWindowDays && (
            <p className="mt-3 text-caption text-text-secondary">
              Full chat history is available.
            </p>
          )}
        </>
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
              {ent.isSolo && (
                <button
                  type="button"
                  disabled={switching}
                  onClick={onSwitchToTeam}
                  className="auth-btn-3d flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white disabled:cursor-default disabled:opacity-60"
                >
                  {switching ? "Switching…" : "Switch to Team — $7.99/seat"}
                </button>
              )}
            </div>
          ) : (
            <p className="text-caption text-text-muted">
              Contact a workspace admin to manage billing.
            </p>
          )
        ) : canManage ? (
          <div className="flex items-center gap-2">
            {soloEligible && (
              <button
                type="button"
                onClick={() => onUpgrade("solo")}
                className="auth-btn-3d flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white"
              >
                Get Pro — $5.99/mo
              </button>
            )}
            <button
              type="button"
              onClick={() => onUpgrade("team")}
              className={cn(
                "flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small",
                soloEligible
                  ? "btn-light font-medium text-text-primary"
                  : "auth-btn-3d font-semibold text-white"
              )}
            >
              Upgrade to Team — $7.99/seat
            </button>
          </div>
        ) : (
          <p className="text-caption text-text-muted">
            Ask a workspace admin or owner to upgrade this workspace.
          </p>
        )}
      </div>
    </div>
  );
}

function UsageMeter({ used, cap, over }: { used: number; cap: number; over: boolean }) {
  const pct = Math.min(100, Math.round((used / cap) * 100));
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-baseline justify-between text-caption">
        <span className="text-text-secondary">Ontology objects</span>
        <span className={cn("font-medium", over ? "text-warning" : "text-text-primary")}>
          {used.toLocaleString()} / {cap.toLocaleString()}
        </span>
      </div>
      <div className="concave-track">
        <div
          className={cn(
            "h-1.5 rounded-full transition-[width]",
            over ? "bg-warning" : "bg-surface-cta"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && (
        <p className="mt-1.5 text-micro text-text-secondary">
          New objects are paused. Nothing was deleted — reads and edits still work.
        </p>
      )}
    </div>
  );
}

function isCurrentPlan(plan: PlanDef, ent: WorkspaceEntitlements): boolean {
  if (plan.id === "solo") return ent.isSolo;
  if (plan.id === "team") return ent.isTeam;
  return !ent.isPaid;
}

function PlanColumn({
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

  // Current paid plan → manage; current free → static label.
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
    // Solo is only sellable to free single-member workspaces; there is
    // no Team → Solo downgrade path in-product (portal handles cancels).
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
