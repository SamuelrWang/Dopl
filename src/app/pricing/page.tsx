import "@/features/marketing/marketing.css";

import { SiteNav } from "@/features/marketing/components/site-nav";
import { PricingContent } from "@/features/marketing/components/pricing-content";

/**
 * Standalone /pricing page — landing shell around the shared
 * PricingContent body (the site-nav pricing popup renders the same body).
 * Kept as a real route for deep links, middle-click, and no-JS.
 */
export default function PricingPage() {
  return (
    <div className="lp">
      <SiteNav />
      <PricingContent />
    </div>
  );
}
