import "@/features/marketing/marketing.css";
import "@/features/marketing/closing.css";
import "./devices-landing.css";

import { SiteFooter } from "../components/site-footer";
import { SiteNav } from "../components/site-nav";
import { CodeSection } from "./code-section";
import { CoverageSection } from "./coverage-section";
import { GetStartedSection } from "./get-started-section";
import { GuidanceSection } from "./guidance-section";
import { HeroSection } from "./hero-section";
import { HowSection } from "./how-section";
import { PortalSection } from "./portal-section";
import { PricingSection } from "./pricing-section";
import { ProblemSection } from "./problem-section";
import { ProductionSection } from "./production-section";
import { SupportSection } from "./support-section";
import { TrustSection } from "./trust-section";
import { VerbsSection } from "./verbs-section";

/**
 * The Dopl Devices SDK landing page, served at `/devices` (src/app/devices/page.tsx). Sections 1
 * to 12 of the KB outline "SDK Split/Plans/Dopl Devices SDK - Landing Page Outline", in its order:
 * problem, what it does, device guidance, how it works, code, features, coverage, portal, trust,
 * pricing, support, get started. Inside `.lp` so it wears the main landing's tokens and type.
 */
export function DevicesLanding() {
  return (
    <div className="lp lp-dv">
      <SiteNav />
      <main>
        <HeroSection />
        <ProblemSection />
        <VerbsSection />
        <GuidanceSection />
        <HowSection />
        <CodeSection />
        <ProductionSection />
        <CoverageSection />
        <PortalSection />
        <TrustSection />
        <PricingSection />
        <SupportSection />
        <GetStartedSection />
      </main>
      <SiteFooter />
    </div>
  );
}
