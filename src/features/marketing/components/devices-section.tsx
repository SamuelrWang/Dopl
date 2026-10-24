"use client";

import "@/features/marketing/devices.css";

import { DEVICES } from "./devices-content";
import { GlassesHud } from "./glasses-hud";
import { RobotChat } from "./robot-chat";
import { useDevicesScrub } from "./use-devices-scrub";

/** Devices — black band under the hero demo. Text left, a deck of device cards
 *  right. In `scrub` mode the band pins and scrolling deals the deck: the next
 *  card comes to the front, the current one tucks in behind, the copy
 *  cross-fades (./use-devices-scrub). Every other mode lists one row per device.
 *
 *  ⚠ ONE markup for every mode: each device is an `.lp-dev-item` holding its
 *  copy + media. In `scrub` the item is `display: contents`, so all copies
 *  share the left grid cell and all cards share the right one (devices.css).
 *
 *  Copy: ./devices-content.ts. `.lp-dev-overlay` sits over each media slot so
 *  a Dopl interface can be laid on top of the photo later. */
export function DevicesSection() {
  const { mode, sceneRef, listRef } = useDevicesScrub(DEVICES.length);

  return (
    <section className="lp-dev" aria-label="Devices" data-mode={mode} ref={sceneRef}>
      <div className="lp-dev-stage">
        <div className="lp-dev-list" ref={listRef}>
          {DEVICES.map((device) => (
            <article key={device.id} className="lp-dev-item" aria-label={device.heading}>
              <div className="lp-dev-copy">
                <p className="lp-dev-eyebrow">{device.eyebrow}</p>
                <h2 className="lp-dev-heading">{device.heading}</h2>
                <p className="lp-dev-lede">{device.lede}</p>

                <ul className="lp-dev-features">
                  {device.features.map(({ icon: Icon, text }) => (
                    <li key={text} className="lp-dev-feature">
                      <span className="lp-dev-feature-mark" aria-hidden>
                        <Icon size={15} strokeWidth={1.75} />
                      </span>
                      <p className="lp-dev-feature-text">{text}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lp-dev-media">
                {device.image && !device.image.pending ? (
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
                {/* Overlay slot: a live layer over the photo (glasses lens, robot chat). */}
                <div className="lp-dev-overlay" aria-hidden="true">
                  {device.overlay === "glasses-hud" ? <GlassesHud /> : null}
                  {device.overlay === "robot-chat" ? <RobotChat /> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
