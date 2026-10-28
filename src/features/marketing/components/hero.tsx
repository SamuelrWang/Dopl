import { AgentNativeSection } from "./agent-native-section";
import { ControlSection } from "./control-section";
import { ConnectSection } from "./connect-section";
import { OntologySection } from "./ontology-section";
import { DevicesSection } from "./devices-section";
import { HeroBanner } from "./hero-banner";
import { HeroIntro } from "./hero-intro";
import { MultiplayerSection } from "./multiplayer-section";
import { SdkSection } from "./sdk-section";
import { ANCHORS } from "./closing-content";
import { FaqSection } from "./faq-section";
import { FinalCta } from "./final-cta";
import { PricingSummary } from "./pricing-summary";

/** Zero-size jump target for the footer's on-page links. A sibling, not an
 *  id on the section, so the section files (and their pinned scrubs) stay
 *  untouched. Styled in closing.css. */
function Anchor({ id }: { id: string }) {
  return <span id={id} className="lp-anchor" aria-hidden />;
}

export function Hero() {
  return (
    <section className="lp-hero">
      <HeroIntro />
      <HeroBanner />
      <Anchor id={ANCHORS.identities} />
      <MultiplayerSection />
      <Anchor id={ANCHORS.orchestration} />
      <OntologySection />
      <ControlSection />
      <AgentNativeSection />
      <Anchor id={ANCHORS.connect} />
      <ConnectSection />
      <Anchor id={ANCHORS.devices} />
      <DevicesSection />
      <Anchor id={ANCHORS.developers} />
      <SdkSection />
      <PricingSummary />
      <FaqSection />
      <FinalCta />
    </section>
  );
}
