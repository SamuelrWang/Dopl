import { Section, Tile } from "./bits";
import { VERBS } from "./content";

/** 3. What Dopl Devices does: three tiles, one verb each, with the real client call in the well. */
export function VerbsSection() {
  return (
    <Section id="dv-verbs" eyebrow={VERBS.eyebrow} heading={VERBS.heading} line={VERBS.line}>
      <div className="lp-dv-grid">
        {VERBS.tiles.map((tile) => (
          <Tile
            key={tile.title}
            title={tile.title}
            body={tile.body}
            visual={
              <div className="lp-dv-well lp-dv-well--short">
                <code className="lp-dv-snippet">{tile.call}</code>
              </div>
            }
          />
        ))}
      </div>
    </Section>
  );
}
