import "@/features/marketing/marketing.css";

import { SiteNav } from "@/features/marketing/components/site-nav";
import { PricingContent } from "@/features/marketing/components/pricing-content";

/** /pricing — landing shell around the PricingContent body; the site-nav "Pricing" link
 *  navigates here. */
export default function PricingPage() {
  return (
    <div className="lp">
      <SiteNav />
      <PricingContent />
    </div>
  );
}
