import "@/features/marketing/marketing.css";

import { ComparisonSection } from "@/features/marketing/components/comparison-section";
import { CtaSection } from "@/features/marketing/components/cta-section";
import { FeatureBlocks } from "@/features/marketing/components/feature-blocks";
import { Hero } from "@/features/marketing/components/hero";
import { NavBar } from "@/features/marketing/components/nav-bar";
import { PlatformBand } from "@/features/marketing/components/platform-band";
import { SiteFooter } from "@/features/marketing/components/site-footer";
import { TeamsSection } from "@/features/marketing/components/teams-section";
import { ToolsSection } from "@/features/marketing/components/tools-section";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f2f5fa] font-(family-name:--font-inter) antialiased">
      <NavBar />
      <main>
        <Hero />
        <div className="space-y-6 px-3 pb-6 sm:px-5">
          <ToolsSection />
          <ComparisonSection />
          <TeamsSection />
          <FeatureBlocks />
          <PlatformBand />
          <CtaSection />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
