import "@/features/marketing/marketing.css";

import { FloatingWidgets } from "@/features/marketing/components/floating-widgets";
import { Hero } from "@/features/marketing/components/hero";
import { NavBar } from "@/features/marketing/components/nav-bar";
import { ShowcaseSection } from "@/features/marketing/components/showcase-section";
import { SocialProof } from "@/features/marketing/components/social-proof";

export default function Home() {
  return (
    <div className="flow-landing">
      <NavBar />
      <Hero />
      <ShowcaseSection />
      <SocialProof />
      <FloatingWidgets />
    </div>
  );
}
