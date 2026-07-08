"use client";

import { useEffect, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { useSubscription } from "@/features/billing/components/use-subscription";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { PLANS, type PlanDef } from "@/features/billing/plans";
import { cn } from "@/shared/lib/utils";
import styles from "../settings-modal.module.css";

type Interval = "monthly" | "annual";

/**
 * Plans & Billing — usage/trial banner, Monthly/Annual toggle, and three
 * plan cards, all on the global tokens + kit classes. The Pro CTA opens
 * the live Stripe checkout; paid users get a Manage-subscription portal
 * link. Annual is a visual option for now — checkout runs the live
 * monthly price. With `pollOnMount` (a Stripe checkout return) the
 * subscription status is re-fetched until the webhook lands.
 */
export function PlansBilling({ pollOnMount = false }: { pollOnMount?: boolean }) {
  const sub = useSubscription();
  const [interval, setInterval] = useState<Interval>("monthly");
  const [showCheckout, setShowCheckout] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(pollOnMount);

  useEffect(() => {
    if (!pollOnMount) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      sub.refresh();
      if (attempts >= 10) {
        window.clearInterval(timer);
        setFinalizing(false);
      }
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollOnMount]);

  useEffect(() => {
    if (sub.isPaid) setFinalizing(false);
  }, [sub.isPaid]);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Couldn't open billing portal");
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

  if (showCheckout && !sub.isPaid) {
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
        <EmbeddedCheckoutForm />
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
          onClick={() => sub.refresh()}
          aria-label="Refresh billing status"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {pollOnMount && sub.isPaid && (
        <div className="mb-4 rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-caption text-success">
          Welcome to Pro! Your subscription is now active.
        </div>
      )}
      {finalizing && !sub.isPaid && (
        <div className="mb-4 rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
          Finalizing your subscription… this usually takes a few seconds.
        </div>
      )}

      <UsageBanner sub={sub} onUpgrade={() => setShowCheckout(true)} />

      <div className="mb-5 flex justify-center">
        <div className="concave-track flex items-center gap-1">
          {(["monthly", "annual"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={cn(
                "flex h-6 cursor-pointer items-center rounded-[6px] px-3 text-caption font-medium transition-colors",
                interval === iv
                  ? "raised-tab text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {iv === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
      </div>

      {portalError && (
        <p className="mb-3 text-caption text-danger">{portalError}</p>
      )}

      <div className="grid grid-cols-3 gap-2 max-[900px]:grid-cols-1">
        {PLANS.map((plan) => (
          <PlanColumn
            key={plan.id}
            plan={plan}
            interval={interval}
            sub={sub}
            portalLoading={portalLoading}
            onUpgrade={() => setShowCheckout(true)}
            onManage={handleManage}
          />
        ))}
      </div>
    </div>
  );
}

type Sub = ReturnType<typeof useSubscription>;

function UsageBanner({ sub, onUpgrade }: { sub: Sub; onUpgrade: () => void }) {
  if (sub.loading) {
    return <div className="bento mb-5 h-20 animate-pulse opacity-50" />;
  }
  let head: string;
  let pct = 100;
  let sub_: React.ReactNode;
  const upgradeLink = (
    <button
      type="button"
      onClick={onUpgrade}
      className="cursor-pointer font-semibold text-link underline"
    >
      Upgrade to Pro
    </button>
  );
  if (sub.isPaid) {
    head = "Pro plan — unlimited";
    sub_ = <>Thanks for supporting Dopl. Manage your subscription below.</>;
  } else if (sub.isTrialing) {
    head = "You're on the free trial";
    pct = 60;
    sub_ = (
      <>
        {sub.access.trial_expires_at
          ? `Trial ends ${new Date(sub.access.trial_expires_at).toLocaleDateString()}. `
          : ""}
        {upgradeLink} for unlimited access.
      </>
    );
  } else {
    head = "Your trial has ended";
    pct = 100;
    sub_ = <>{upgradeLink} to keep using knowledge bases, skills, and MCP.</>;
  }
  return (
    <div className="bento mb-5 p-4">
      <div className="text-body font-semibold text-text-primary">{head}</div>
      <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-bg-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
        <div
          className="h-full rounded-full bg-surface-cta"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-caption text-text-secondary">{sub_}</div>
    </div>
  );
}

function PlanColumn({
  plan,
  interval,
  sub,
  portalLoading,
  onUpgrade,
  onManage,
}: {
  plan: PlanDef;
  interval: Interval;
  sub: Sub;
  portalLoading: boolean;
  onUpgrade: () => void;
  onManage: () => void;
}) {
  const isCurrent =
    (plan.id === "pro" && sub.isPaid) ||
    (plan.id === "basic" && !sub.isPaid);
  const highlight = plan.id === "pro";

  return (
    <div
      className={cn(
        "bento flex flex-col p-4",
        highlight && "border-border-highlight"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-caption text-text-secondary">{plan.audience}</div>
        {highlight && (
          <span className="rounded-full bg-surface-cta px-2 py-0.5 text-micro font-semibold text-text-on-cta">
            Popular
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 text-display font-semibold tracking-tight text-text-primary">
        {plan.name}
        {plan.id === "pro" && interval === "annual" && (
          <span className="rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-micro font-semibold text-text-secondary">
            -20%
          </span>
        )}
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
          sub={sub}
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
  sub,
  portalLoading,
  onUpgrade,
  onManage,
}: {
  plan: PlanDef;
  isCurrent: boolean;
  sub: Sub;
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
    return (
      <button type="button" className={ghost} disabled={portalLoading} onClick={onManage}>
        {portalLoading ? "Loading…" : "Manage subscription"}
      </button>
    );
  }
  if (isCurrent) {
    return <div className={current}>Current plan</div>;
  }
  if (plan.id === "pro") {
    return (
      <button type="button" className={primary} onClick={onUpgrade}>
        {sub.isTrialing ? "Upgrade to Pro" : "Subscribe — $7.99/mo"}
      </button>
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
  return <div className={current}>Free forever</div>;
}
