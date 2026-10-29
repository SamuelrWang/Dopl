import { Section, Tile } from "./bits";
import { GUIDANCE as G } from "./content";

/**
 * 3b. Device guidance, the core beat: three panels, one message moving left to right (routed to
 * the person, guided for that device, customized in layers), then the same reply on three
 * surfaces. The routing reason and the glasses rules are the real router string and the real
 * glasses default profile (see content.ts).
 */
export function GuidanceSection() {
  return (
    <Section id="dv-guidance" eyebrow={G.eyebrow} heading={G.heading} line={G.line}>
      <div className="lp-dv-grid">
        <Tile
          title={G.panels.route.title}
          body={G.panels.route.body}
          visual={
            <div className="lp-dv-well">
              <pre className="lp-dv-snippet">
                <span className="lp-dv-key">routed_to</span>
                {": {\n  "}
                <span className="lp-dv-key">kind</span>
                {': "glasses",\n  '}
                <span className="lp-dv-key">reason</span>
                {`: "${G.routeReason}"\n}`}
              </pre>
            </div>
          }
        />
        <Tile
          title={G.panels.guide.title}
          body={G.panels.guide.body}
          visual={
            <div className="lp-dv-well">
              <pre className="lp-dv-snippet">
                <span className="lp-dv-key">profile</span>
                {': "glasses-default"'}
                {G.guideRows.map(([key, value]) => (
                  <span key={key}>
                    {"\n  "}
                    <span className="lp-dv-key">{key}</span>
                    {`: ${value}`}
                  </span>
                ))}
              </pre>
            </div>
          }
        />
        <Tile
          title={G.panels.layers.title}
          body={G.panels.layers.body}
          visual={
            <div className="lp-dv-well">
              <ol className="lp-dv-layers" aria-label="Guidance layers">
                {G.layers.map((layer) => (
                  <li key={layer} className="lp-dv-layer">
                    {layer}
                  </li>
                ))}
              </ol>
            </div>
          }
        />
      </div>

      <div className="lp-dv-grid lp-dv-surfaces" aria-label="The same reply on three devices">
        <div className="lp-dv-surface">
          <span className="lp-dv-surface-label">{G.surfaces[0]}</span>
          <div className="lp-dv-lens">{G.reply}</div>
        </div>
        <div className="lp-dv-surface">
          <span className="lp-dv-surface-label">{G.surfaces[1]}</span>
          <div className="lp-dv-notif">
            <strong>{G.reply}</strong>
            <span className="lp-dv-key">Tap to answer</span>
          </div>
        </div>
        <div className="lp-dv-surface">
          <span className="lp-dv-surface-label">{G.surfaces[2]}</span>
          <div className="lp-dv-panel">
            <span>{G.reply}</span>
            <div className="lp-dv-actions">
              <span className="lp-dv-pill lp-dv-pill--ink">Deploy</span>
              <span className="lp-dv-pill">Not now</span>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
