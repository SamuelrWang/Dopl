import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Section } from "./bits";
import { PRICING, PRICING_HREF } from "./content";

/** 10. Pricing: one line and a link to the pricing page. No tiers or numbers here (outline). */
export function PricingSection() {
  return (
    <Section id="dv-pricing" eyebrow={PRICING.eyebrow} heading={PRICING.heading} line={PRICING.line} className="lp-dv-pricing">
      <Link href={PRICING_HREF} className="lp-btn lp-btn--sm lp-btn--3d-light">
        {PRICING.link}
        <ArrowRight size={14} strokeWidth={2} aria-hidden />
      </Link>
    </Section>
  );
}
