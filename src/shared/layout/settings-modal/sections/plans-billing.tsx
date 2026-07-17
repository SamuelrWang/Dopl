"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import {
  formatMoney,
  PRO_SEAT_PRICE,
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { PLANS, type PlanDef } from "@/features/billing/plans";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import styles from "../settings-modal.module.css";

/**
 * Plans & Billing — the workspace per-seat model. Shows the current
 * plan, seat math (members × $7.99), an object usage meter when the free
 * workspace is capped, the chats-window note, and the right action:
 * admins/owners upgrade (embedded checkout) or manage billing (portal);
 * everyone else sees plan info with an "ask an admin" note. A past_due
 * workspace keeps Pro but surfaces a warning banner. `billingReturn`
 * marks a Stripe redirect back: "success" (checkout) polls + celebrates
 * until the webhook lands; "return" (portal cancel/downgrade) polls
 * quietly so the pane never lingers on stale Pro. `workspaceId` scopes
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
  const [showCheckout, setShowCheckout] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
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
    if (ent.isPro) setFinalizing(false);
  }, [ent.isPro]);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: workspaceId ? { "x-workspace-id": workspaceId } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't open billing portal");
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  if (showCheckout && !ent.isPro) {
    return (
      <div>
        <button
          type="button"
          className="mb-4 cursor-pointer text-small text-text-secondary transition-colors hover:text-text-primary"
          onClick={() => setShowCheckout(false)}
        >
          ← Back to plans
        </button>
        <h2 className={styles.paneTitle}>Subscribe to Pro</h2>
        <p className="mb-4 text-caption text-text-secondary">
          {ent.billableSeats} {ent.billableSeats === 1 ? "seat" : "seats"} ·{" "}
          {formatMoney(ent.monthlyTotal)} / month
        </p>
        <EmbeddedCheckoutForm workspaceId={workspaceId} />
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

      {isSuccessReturn && ent.isPro && (
        <div className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-caption text-success">
          Welcome to Pro — {ent.billableSeats}{" "}
          {ent.billableSeats === 1 ? "seat" : "seats"} active.
        </div>
      )}
      {finalizing && !ent.isPro && (
        <div className="mb-4 rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
          Finalizing your subscription… this usually takes a few seconds.
        </div>
      )}

      {ent.isPastDue && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-caption text-warning">
          <div className="font-semibold">Payment past due</div>
          <div className="mt-0.5 text-text-secondary">
            Your Pro workspace stays active for now. Update your payment method to
            avoid losing Pro features.
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
        onUpgrade={() => setShowCheckout(true)}
        onManage={handleManage}
      />

      {portalError && <p className="mb-3 text-caption text-danger">{portalError}</p>}

      <div className="grid grid-cols-3 gap-2 max-[900px]:grid-cols-1">
        {PLANS.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            ent={ent}
            canManage={canManage}
            portalLoading={portalLoading}
            onUpgrade={() => setShowCheckout(true)}
            onManage={handleManage}
          />
        ))}
      </div>
    </div>
  );
}

function BillingSummary({
  ent,
  canManage,
  portalLoading,
  onUpgrade,
  onManage,
}: {
  ent: WorkspaceEntitlements;
  canManage: boolean;
  portalLoading: boolean;
  onUpgrade: () => void;
  onManage: () => void;
}) {
  if (ent.loading) {
    return <div className="bento mb-5 h-24 animate-pulse opacity-50" />;
  }
  return (
    <div className="bento mb-5 p-4">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-caption font-semibold",
            ent.isPro
              ? "border-border-strong bg-surface-cta text-text-on-cta"
              : "border-border-strong bg-bg-inset text-text-secondary"
          )}
        >
          {ent.isPro ? "Pro plan" : "Free plan"}
        </span>
        <span className="text-caption text-text-secondary">
          {ent.memberCount} {ent.memberCount === 1 ? "member" : "members"}
        </span>
      </div>

      {ent.isPro ? (
        <div className="mt-3 text-body text-text-primary">
          <span className="font-semibold">{ent.billableSeats}</span>{" "}
          {ent.billableSeats === 1 ? "seat" : "seats"} ×{" "}
          {formatMoney(PRO_SEAT_PRICE)} ={" "}
          <span className="font-semibold">{formatMoney(ent.monthlyTotal)}</span>{" "}
          <span className="text-caption text-text-muted">/ month</span>
        </div>
      ) : (
        <>
          {ent.isCapped && ent.objectCap !== null && (
            <UsageMeter used={ent.objectsUsed} cap={ent.objectCap} over={ent.overCap} />
          )}
          <p className="mt-3 text-caption text-text-secondary">
            {ent.chatsWindowDays
              ? `Chats older than ${ent.chatsWindowDays} days are hidden on Free — they're never deleted, and full history is restored the moment you upgrade.`
              : "Full chat history is available."}
          </p>
        </>
      )}

      <div className="mt-4">
        {ent.isPro ? (
          canManage ? (
            <button
              type="button"
              disabled={portalLoading}
              onClick={onManage}
              className="btn-light flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50"
            >
              {portalLoading ? "Loading…" : "Manage billing"}
            </button>
          ) : (
            <p className="text-caption text-text-muted">
              Contact a workspace admin to manage billing.
            </p>
          )
        ) : canManage ? (
          <button
            type="button"
            onClick={onUpgrade}
            className="flex h-8 cursor-pointer items-center justify-center rounded-lg bg-surface-cta px-4 text-small font-semibold text-text-on-cta transition-opacity hover:opacity-90"
          >
            Upgrade to Pro
          </button>
        ) : (
          <p className="text-caption text-text-muted">
            Ask a workspace admin or owner to upgrade to Pro.
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

function PlanColumn({
  plan,
  ent,
  canManage,
  portalLoading,
  onUpgrade,
  onManage,
}: {
  plan: PlanDef;
  ent: WorkspaceEntitlements;
  canManage: boolean;
  portalLoading: boolean;
  onUpgrade: () => void;
  onManage: () => void;
}) {
  const isCurrent =
    (plan.id === "pro" && ent.isPro) || (plan.id === "free" && !ent.isPro);
  const highlight = plan.id === "pro";

  return (
    <div className={cn("bento flex flex-col p-4", highlight && "border-border-highlight")}>
      <div className="flex items-center justify-between">
        <div className="text-caption text-text-secondary">{plan.audience}</div>
        {highlight && (
          <span className="rounded-full bg-surface-cta px-2 py-0.5 text-micro font-semibold text-text-on-cta">
            Popular
          </span>
        )}
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
          canManage={canManage}
          portalLoading={portalLoading}
          onUpgrade={onUpgrade}
          onManage={onManage}
        />
      </div>
    </div>
  );
}

function PlanCta({
  plan,
  isCurrent,
  canManage,
  portalLoading,
  onUpgrade,
  onManage,
}: {
  plan: PlanDef;
  isCurrent: boolean;
  canManage: boolean;
  portalLoading: boolean;
  onUpgrade: () => void;
  onManage: () => void;
}) {
  const ghost =
    "btn-light flex h-8 w-full cursor-pointer items-center justify-center rounded-lg text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50";
  const primary =
    "flex h-8 w-full cursor-pointer items-center justify-center rounded-lg bg-surface-cta text-small font-semibold text-text-on-cta transition-opacity hover:opacity-90";
  const current =
    "flex h-8 w-full items-center justify-center text-small font-semibold text-text-secondary";

  if (isCurrent && plan.id === "pro") {
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
  if (plan.id === "pro") {
    return canManage ? (
      <button type="button" className={primary} onClick={onUpgrade}>
        Upgrade — $7.99/seat
      </button>
    ) : (
      <div className={cn(current, "text-text-muted")}>Ask an admin</div>
    );
  }
  if (plan.id === "team") {
    return (
      <a
        href="mailto:support@usedopl.com?subject=Dopl%20Team%20plan"
        className={cn(ghost, "no-underline")}
      >
        Talk to us
      </a>
    );
  }
  return <div className={current}>Included</div>;
}
