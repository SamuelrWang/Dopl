import "@/features/marketing/marketing.css";

import { Hero } from "@/features/marketing/components/hero";
import { NavBar } from "@/features/marketing/components/nav-bar";
import { OntologyScroll } from "@/features/marketing/components/ontology-scroll";
import { SmoothScroll } from "@/features/marketing/components/smooth-scroll";
import { Stats } from "@/features/marketing/components/stats";
import { TrustedBy } from "@/features/marketing/components/trusted-by";

export default function Home() {
  return (
    <SmoothScroll>
      <div className="dopl-landing">
        <NavBar />
        <div className="dopl-frame">
          <div className="dopl-card">
            <Hero />
            <TrustedBy />
          </div>
          <OntologyScroll />
          <Stats />
        </div>
      </div>
    </SmoothScroll>
  );
}
