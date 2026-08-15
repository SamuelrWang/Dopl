import "@/features/marketing/marketing.css";

import { SiteNav } from "@/features/marketing/components/site-nav";
import { PricingContent } from "@/features/marketing/components/pricing-content";

/**
 * /pricing — landing shell around the PricingContent body. The site-nav
 * "Pricing" link navigates here; it used to intercept the click and open the
 * same body in a popup, and that popup is gone.
 */
export default function PricingPage() {
  return (
    <div className="lp">
      <SiteNav />
      <PricingContent />
    </div>
  );
}
