import { Section, Tile } from "./bits";
import { PORTAL } from "./content";

/** 8. Developer portal: a bento of the day-two tools. Tiles with a `sample` show it in a well,
 *  as the portal prints it (key prefixes, request lines). */
export function PortalSection() {
  return (
    <Section id="dv-portal" eyebrow={PORTAL.eyebrow} heading={PORTAL.heading} line={PORTAL.line}>
      <div className="lp-dv-grid lp-dv-grid--auto">
        {PORTAL.tiles.map((tile) => (
          <Tile
            key={tile.title}
            title={tile.title}
            body={tile.body}
            visual={
              "sample" in tile ? (
                <div className="lp-dv-well lp-dv-well--short">
                  <pre className="lp-dv-snippet">{tile.sample.join("\n")}</pre>
                </div>
              ) : undefined
            }
          />
        ))}
      </div>
    </Section>
  );
}
