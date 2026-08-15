import { ControlSection } from "./control-section";
import { DevelopersSection } from "./developers-section";
import { FrameworkSection } from "./framework-section";
import { HeroBanner } from "./hero-banner";
import { HeroIntro } from "./hero-intro";
import { MultiplayerSection } from "./multiplayer-section";

/**
 * Composition only — the order of the landing's opening sections. Each piece
 * owns its own markup and styles; change the running order here, nowhere else.
 */
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
