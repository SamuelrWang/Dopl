import { ControlSection } from "./control-section";
import { DevelopersSection } from "./developers-section";
import { FrameworkSection } from "./framework-section";
import { HeroBanner } from "./hero-banner";
import { HeroIntro } from "./hero-intro";
import { MultiplayerSection } from "./multiplayer-section";

export function Hero() {
  return (
    <section className="lp-hero">
      <HeroIntro />
      <HeroBanner />
      <MultiplayerSection />
      <FrameworkSection />
      <ControlSection />
      <DevelopersSection />
    </section>
  );
}
