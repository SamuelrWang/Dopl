"use client";

import "@/features/marketing/marketing.css";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { SiteNav } from "@/features/marketing/components/site-nav";
import { PLANS, type PlanDef } from "@/features/billing/plans";
import type { User } from "@supabase/supabase-js";

/**
 * Public pricing — the landing-page (light Lattice) language: three plan
 * cards from the shared plan defs, Pro highlighted. Checkout only sells
 * the live monthly Pro price; Basic maps to the 24-hour free trial and
 * Team is a contact CTA.
 */

export default function PricingPage() {
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
  const isPaid = statusQuery.data?.status === "active";

  function handleSubscribe() {
    if (!user) {
      router.push("/login?redirect=/pricing");
      return;
    }
    setShowCheckout(true);
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
      <div className="lp">
        <SiteNav />
        <section className="lp-checkout">
          <button
            type="button"
            className="lp-checkout-back"
            onClick={() => setShowCheckout(false)}
          >
            &larr; Back to pricing
          </button>
          <h1 className="lp-checkout-title">Subscribe to Dopl Pro</h1>
          <p className="lp-checkout-sub">$7.99/month · cancel anytime</p>
          <EmbeddedCheckoutForm />
        </section>
      </div>
    );
  }

  return (
    <div className="lp">
      <SiteNav />
      <section className="lp-pricing">
        <div className="lp-pricing-head">
          <h1 className="lp-pricing-title">Pricing</h1>
          <p className="lp-pricing-sub">
            Try Dopl free for 24 hours. No credit card required.
          </p>
        </div>

        <div className="lp-plans">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isPaid={isPaid}
              authChecked={authChecked}
              onSubscribe={handleSubscribe}
              onGetStarted={handleGetStarted}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  isPaid,
  authChecked,
  onSubscribe,
  onGetStarted,
}: {
  plan: PlanDef;
  isPaid: boolean;
  authChecked: boolean;
  onSubscribe: () => void;
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
        {plan.id === "basic" && "24-hour full-access trial on signup."}
        {plan.id === "pro" && "Cancel anytime."}
        {plan.id === "team" && "We'll tailor a plan to your team."}
      </p>

      <PlanCardCta
        plan={plan}
        isPaid={isPaid}
        authChecked={authChecked}
        onSubscribe={onSubscribe}
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
          <strong>Try before you pay</strong>
          Every account starts with a 24-hour free trial — no card required.
        </p>
      )}
    </div>
  );
}

function PlanCardCta({
  plan,
  isPaid,
  authChecked,
  onSubscribe,
  onGetStarted,
}: {
  plan: PlanDef;
  isPaid: boolean;
  authChecked: boolean;
  onSubscribe: () => void;
  onGetStarted: () => void;
}) {
  if (plan.id === "pro") {
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
