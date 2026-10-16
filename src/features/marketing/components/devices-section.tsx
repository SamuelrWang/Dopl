import "@/features/marketing/devices.css";

import { DevicesTrack } from "./devices-track";

/** Devices — black band under the hero demo, one full-width page per device,
 *  scrolled horizontally. Text left, image right (Control's layout).
 *
 *  ⚠ Server component on purpose: the only client boundary is `<DevicesTrack>`
 *  (the scroller + prev/next), and the panels arrive server-rendered as its
 *  children. Styles: src/features/marketing/devices.css (`.lp-dev-*`).
 *
 *  ⚠ PLACEHOLDER COPY — edit `DEVICES` below. `image: null` renders a neutral
 *  block in the media slot. `.lp-dev-overlay` sits over each media slot so a
 *  Dopl interface can be laid on top of the photo later. */

interface DevicePanel {
  readonly id: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly line: string;
  readonly image: { readonly src: string; readonly alt: string } | null;
}

const DEVICES: readonly DevicePanel[] = [
  {
    id: "glasses",
    eyebrow: "Devices",
    heading: "Display glasses",
    line: "Your agents, in your line of sight.",
    image: { src: "/img/devices/glasses.png", alt: "Display glasses" },
  },
  {
    id: "robots",
    eyebrow: "Devices",
    heading: "Robots",
    line: "Agents that act in the physical world.",
    image: null,
  },
  {
    id: "more",
    eyebrow: "Devices",
    heading: "More coming",
    line: "New devices join the same channels.",
    image: null,
  },
];

export function DevicesSection() {
  return (
    <section className="lp-dev" aria-label="Devices">
      <DevicesTrack>
        {DEVICES.map((device) => (
          <article key={device.id} className="lp-dev-panel" aria-label={device.heading}>
            <div className="lp-dev-inner">
              <div className="lp-dev-copy">
                <p className="lp-dev-eyebrow">{device.eyebrow}</p>
                <h2 className="lp-dev-heading">{device.heading}</h2>
                <p className="lp-dev-line">{device.line}</p>
              </div>

              <div className="lp-dev-media">
                {device.image ? (
                  // Plain <img>, as elsewhere on the landing (ontology-section).
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="lp-dev-img"
                    src={device.image.src}
                    alt={device.image.alt}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="lp-dev-placeholder" aria-hidden="true" />
                )}
                {/* Overlay slot for the Dopl interface demo — empty for now. */}
                <div className="lp-dev-overlay" aria-hidden="true" />
              </div>
            </div>
          </article>
        ))}
      </DevicesTrack>
    </section>
  );
}
