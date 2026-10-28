"use client";

import "@/features/marketing/closing.css";

import { useRouter } from "next/navigation";

import { MAX_PLAN_NAME, PERSONAL_PLANS } from "@/features/billing/plans";

import { GET_STARTED_URL } from "../constants";
import { ANCHORS, PRICING_SUMMARY_COPY as C } from "./closing-content";
import { PlanGroup } from "./pricing-plan-group";
import { PERSONAL_SUMMARY } from "./pricing-summaries";
import { ScrollReveal } from "./scroll-reveal";

/** Landing pricing summary: the /pricing plan cards in `compact` mode (name,
 *  price, sub-line, CTA, feature checkmarks; no comparison table), reading the
 *  SAME plan defs (`billing/plans.ts`) and sub-lines (`pricing-summaries.ts`).
 *  A client component only because PlanGroup's CTAs are buttons with handlers.
 *
 *  ⚠ NO CHECKOUT AND NO AUTH READ HERE. The free cards go to sign-up; the paid
 *  cards go to /pricing, which owns the auth + workspace resolution a purchase
 *  needs (pricing-content.tsx › handleSubscribe). */
export function PricingSummary() {
  const router = useRouter();
  const toSignUp = () => router.push(GET_STARTED_URL);
  const toPricing = () => router.push("/pricing");

  return (
    <ScrollReveal className="lp-psum">
      <div className="lp-psum-inner" id={ANCHORS.pricing}>
        <p className="lp-psum-eyebrow">{C.eyebrow}</p>
        <h2 className="lp-psum-heading">{C.heading}</h2>

        {/* Personal tiers only on the landing; Teams lives on /pricing. */}
        <div className="lp-psum-groups lp-psum-groups--single">
          <PlanGroup
            compact
            plans={PERSONAL_PLANS}
            summary={PERSONAL_SUMMARY}
            subscribeLabel={(planId) => (planId === "max" ? `Go ${MAX_PLAN_NAME}` : C.personalCta)}
            onSubscribe={() => toPricing()}
            authChecked
            onGetStarted={toSignUp}
          />
        </div>

      </div>
    </ScrollReveal>
  );
}
