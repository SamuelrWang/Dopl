import { ControlSection } from "./control-section";
import { ConnectSection } from "./connect-section";
import { OntologySection } from "./ontology-section";
import { HeroBanner } from "./hero-banner";
import { HeroIntro } from "./hero-intro";
import { MultiplayerSection } from "./multiplayer-section";

export function Hero() {
  return (
    <section className="lp-hero">
      <HeroIntro />
      <HeroBanner />
      <MultiplayerSection />
      <OntologySection />
      <ControlSection />
      <ConnectSection />
    </section>
  );
}
