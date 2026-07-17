"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { PLANS, type PlanDef } from "@/features/billing/plans";
import type { User } from "@supabase/supabase-js";

/**
 * Public pricing body — the landing-page (light Lattice) language: three
 * plan cards from the shared plan defs, Pro highlighted, embedded checkout
 * revealed in place. Plans are workspace-level: Free is fully featured,
 * Pro is $7.99 per seat / month (checkout sells the live per-seat price),
 * and Team is a contact CTA. Rendered two ways: as the /pricing page body
 * and inside the site-nav pricing popup (`.lp-modal`), so it carries no
 * page chrome of its own.
 */
export function PricingContent() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    supabase.auth.getUser().then(({ data }: { data: { user: User | null } }) => {
      setUser(data.user);
      setAuthChecked(true);
    });
  }, []);

  // Fires once the auth check finds a session (the old version read a
  // stale `user` closure and only worked via a dep-triggered second run).
  const statusQuery = useApiQuery<{ status?: string }>("/api/billing/status", {
    enabled: user !== null,
  });
  // past_due is still a paid subscription — showing "Upgrade to Pro" would
  // start a duplicate checkout. Treat active + past_due as subscribed and
  // route past_due users to manage their existing billing instead.
  const status = statusQuery.data?.status;
  const isPaid = status === "active" || status === "past_due";
  const isPastDue = status === "past_due";

  function handleSubscribe() {
    if (!user) {
      router.push("/login?redirect=/pricing");
      return;
    }
    setShowCheckout(true);
  }

  // Route into the in-app Plans & Billing pane (via the /canvas redirect
  // the app shell reads) where the past_due warning + Stripe portal live —
  // no duplicate portal logic on this public page.
  function handleManageBilling() {
    router.push(user ? "/canvas?billing=return" : "/login?redirect=/pricing");
  }

  function handleGetStarted() {
    if (user) {
      router.push("/canvas");
    } else {
      router.push("/login?redirect=/canvas");
    }
  }

  if (showCheckout) {
    return (
      <section className="lp-checkout">
        <button
          type="button"
          className="lp-checkout-back"
          onClick={() => setShowCheckout(false)}
        >
          &larr; Back to pricing
        </button>
        <h1 className="lp-checkout-title">Subscribe to Dopl Pro</h1>
        <p className="lp-checkout-sub">
          $7.99 per seat / month · seats sync automatically · cancel anytime
        </p>
        <EmbeddedCheckoutForm />
      </section>
    );
  }

  return (
    <section className="lp-pricing">
      <div className="lp-pricing-head">
        <h1 className="lp-pricing-title">Pricing</h1>
        <p className="lp-pricing-sub">
          Start free — every feature included. Upgrade to Pro at $7.99 per seat
          when your team grows.
        </p>
      </div>

      <div className="lp-plans">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isPaid={isPaid}
            isPastDue={isPastDue}
            authChecked={authChecked}
            onSubscribe={handleSubscribe}
            onManageBilling={handleManageBilling}
            onGetStarted={handleGetStarted}
          />
        ))}
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  isPaid,
  isPastDue,
  authChecked,
  onSubscribe,
  onManageBilling,
  onGetStarted,
}: {
  plan: PlanDef;
  isPaid: boolean;
  isPastDue: boolean;
  authChecked: boolean;
  onSubscribe: () => void;
  onManageBilling: () => void;
  onGetStarted: () => void;
}) {
  const popular = plan.id === "pro";

  return (
    <div className={`lp-plan${popular ? " lp-plan--popular" : ""}`}>
      <div className="lp-plan-top">
        <span className="lp-plan-audience">{plan.audience}</span>
        {popular && <span className="lp-plan-badge">Popular</span>}
      </div>

      <h2 className="lp-plan-name">{plan.name}</h2>
      <div className="lp-plan-price">
        <span className="lp-plan-price-figure">{plan.priceMonthly}</span>
        {plan.priceNote && (
          <span className="lp-plan-price-note">{plan.priceNote}</span>
        )}
      </div>
      <p className="lp-plan-fine">
        {plan.id === "free" && "Free forever — no credit card required."}
        {plan.id === "pro" && "Billed per member · cancel anytime."}
        {plan.id === "team" && "We'll tailor a plan to your team."}
      </p>

      <PlanCardCta
        plan={plan}
        isPaid={isPaid}
        isPastDue={isPastDue}
        authChecked={authChecked}
        onSubscribe={onSubscribe}
        onManageBilling={onManageBilling}
        onGetStarted={onGetStarted}
      />

      <ul className="lp-plan-features">
        {plan.features.map((f) => (
          <li key={f}>
            <span className="lp-plan-check">
              <CheckIcon />
            </span>
            {f}
          </li>
        ))}
      </ul>

      {popular && (
        <p className="lp-plan-guarantee">
          <strong>Only pay for your team</strong>
          $7.99 per member each month. Seats sync automatically as people join or
          leave — cancel anytime.
        </p>
      )}
    </div>
  );
}

function PlanCardCta({
  plan,
  isPaid,
  isPastDue,
  authChecked,
  onSubscribe,
  onManageBilling,
  onGetStarted,
}: {
  plan: PlanDef;
  isPaid: boolean;
  isPastDue: boolean;
  authChecked: boolean;
  onSubscribe: () => void;
  onManageBilling: () => void;
  onGetStarted: () => void;
}) {
  if (plan.id === "pro") {
    if (isPastDue) {
      return (
        <button
          type="button"
          className="lp-btn lp-btn--3d lp-plan-cta"
          onClick={onManageBilling}
        >
          Payment issue — manage billing
        </button>
      );
    }
    if (isPaid) {
      return (
        <button type="button" className="lp-btn lp-btn--3d-light lp-plan-cta" disabled>
          Current plan
        </button>
      );
    }
    return (
      <button
        type="button"
        className="lp-btn lp-btn--3d lp-plan-cta"
        onClick={onSubscribe}
        disabled={!authChecked}
      >
        Upgrade to Pro
      </button>
    );
  }
  if (plan.id === "team") {
    return (
      <a
        href="mailto:support@usedopl.com?subject=Dopl%20Team%20plan"
        className="lp-btn lp-btn--3d-light lp-plan-cta"
      >
        Talk to us
      </a>
    );
  }
  return (
    <button
      type="button"
      className="lp-btn lp-btn--3d-light lp-plan-cta"
      onClick={onGetStarted}
    >
      Try today
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
    </svg>
  );
}
