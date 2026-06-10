"use client";

import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { useSubscription } from "@/features/billing/components/use-subscription";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import styles from "../settings-modal.module.css";

type Interval = "monthly" | "annual";

interface PlanDef {
  id: "basic" | "pro" | "team";
  audience: string;
  name: string;
  priceMonthly: string;
  priceNote: string;
  features: string[];
}

const PLANS: ReadonlyArray<PlanDef> = [
  {
    id: "basic",
    audience: "For individuals",
    name: "Basic",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "1 workspace",
      "Up to 3 knowledge bases",
      "Core skills library",
      "Connect 1 MCP client",
      "Community support",
    ],
  },
  {
    id: "pro",
    audience: "For individuals and teams",
    name: "Pro",
    priceMonthly: "$7.99",
    priceNote: "per month",
    features: [
      "Everything in Basic",
      "Unlimited knowledge bases & skills",
      "Unlimited MCP clients",
      "Team collaboration",
      "Priority support",
      "Early access to new features",
    ],
  },
  {
    id: "team",
    audience: "For teams with advanced needs",
    name: "Team",
    priceMonthly: "Custom",
    priceNote: "",
    features: [
      "Everything in Pro",
      "Advanced roles & access control",
      "SSO / SAML",
      "Audit logs",
      "Dedicated support",
      "Custom onboarding",
    ],
  },
];

/**
 * Plans & Billing — a clone of the reference billing layout adapted to
 * Dopl's real plans: a usage/trial banner, a Monthly/Annual toggle, and
 * three plan columns. The Pro CTA opens the live Stripe checkout; paid
 * users get a Manage-subscription portal link. Annual is a visual option
 * for now — checkout runs the live monthly price.
 */
export function PlansBilling() {
  const sub = useSubscription();
  const [interval, setInterval] = useState<Interval>("monthly");
  const [showCheckout, setShowCheckout] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

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
        <button type="button" className={styles.checkoutBack} onClick={() => setShowCheckout(false)}>
          ← Back to plans
        </button>
        <h2 className={styles.paneTitle}>Subscribe to Pro</h2>
        <EmbeddedCheckoutForm />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={styles.refreshBtn}
        onClick={() => sub.refresh()}
        aria-label="Refresh billing status"
      >
        <RefreshCw size={18} />
      </button>
      <h2 className={styles.paneTitle}>Plans and Billing</h2>

      <UsageBanner sub={sub} onUpgrade={() => setShowCheckout(true)} />

      <div className={styles.toggleWrap}>
        <div className={styles.toggle}>
          {(["monthly", "annual"] as const).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              className={`${styles.toggleBtn} ${interval === iv ? styles.toggleActive : ""}`}
            >
              {iv === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
      </div>

      {portalError && (
        <p style={{ color: "#b4452f", fontSize: 13, marginBottom: 14 }}>{portalError}</p>
      )}

      <div className={styles.plans}>
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
    return <div className={styles.usage} style={{ height: 96, opacity: 0.5 }} />;
  }
  let head: string;
  let pct = 100;
  let sub_: React.ReactNode;
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
        <a onClick={onUpgrade}>Upgrade to Pro</a> for unlimited access.
      </>
    );
  } else {
    head = "Your trial has ended";
    pct = 100;
    sub_ = (
      <>
        <a onClick={onUpgrade}>Upgrade to Pro</a> to keep using knowledge bases, skills, and MCP.
      </>
    );
  }
  return (
    <div className={styles.usage}>
      <div className={styles.usageHead}>{head}</div>
      <div className={styles.usageBarTrack}>
        <div className={styles.usageBarFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.usageSub}>{sub_}</div>
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

  return (
    <div className={styles.plan}>
      <div className={styles.planFor}>{plan.audience}</div>
      <div className={styles.planName}>
        {plan.name}
        {plan.id === "pro" && interval === "annual" && (
          <span className={styles.planDiscount}>-20%</span>
        )}
      </div>
      <div className={styles.planPrice}>
        {plan.priceMonthly}
        {plan.priceNote && <span> {plan.priceNote}</span>}
      </div>

      <ul className={styles.planFeatures}>
        {plan.features.map((f) => (
          <li key={f}>
            <Check size={16} strokeWidth={2.4} />
            {f}
          </li>
        ))}
      </ul>

      <PlanCta
        plan={plan}
        isCurrent={isCurrent}
        sub={sub}
        portalLoading={portalLoading}
        onUpgrade={onUpgrade}
        onManage={onManage}
      />
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
  if (isCurrent && plan.id === "pro") {
    return (
      <button
        type="button"
        className={`${styles.planCta} ${styles.ctaGhost}`}
        disabled={portalLoading}
        onClick={onManage}
      >
        {portalLoading ? "Loading…" : "Manage subscription"}
      </button>
    );
  }
  if (isCurrent) {
    return <div className={`${styles.planCta} ${styles.ctaCurrent}`}>Current plan</div>;
  }
  if (plan.id === "pro") {
    return (
      <button type="button" className={`${styles.planCta} ${styles.ctaPrimary}`} onClick={onUpgrade}>
        {sub.isTrialing ? "Upgrade to Pro" : "Subscribe — $7.99/mo"}
      </button>
    );
  }
  if (plan.id === "team") {
    return (
      <a
        href="mailto:support@usedopl.com?subject=Dopl%20Team%20plan"
        className={`${styles.planCta} ${styles.ctaGhost}`}
        style={{ display: "block", textDecoration: "none" }}
      >
        Talk to us
      </a>
    );
  }
  return <div className={`${styles.planCta} ${styles.ctaCurrent}`}>Free forever</div>;
}
