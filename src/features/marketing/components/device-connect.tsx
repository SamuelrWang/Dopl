"use client";

import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";

/** The "connected" pill that opens each live device card (glasses-hud.tsx,
 *  robot-chat.tsx): the device's name, its link state, the identity that
 *  takes it over, and the functions the connection hands to that identity, revealed one chip at a time. It is the
 *  first beat of that card's feed, so it rides the same clock
 *  (./use-feed-player): `shown` = chips revealed so far (0 = still
 *  connecting). Styles: devices.css › "Device connect pill".
 *
 *  Glass = the landing's real `LiquidGlass`, on the recipe the Multiplayer
 *  iMessage notification uses (multiplayer-thread.tsx): the hero banner's
 *  settings (component defaults, `edge="rim"`, static map) without hover
 *  tilt, its heavy rim drop swapped for a small tight one in devices.css.
 *
 *  ⚠ NO LAYOUT SHIFT, ON PURPOSE: every chip and both state words are always
 *  in the DOM, the unrevealed ones `visibility: hidden`, so the pill is its
 *  final size from the first frame. That also keeps the glass's displacement
 *  map (built once, `staticMap`) matched to its box. */

export interface DeviceConnection {
  readonly device: string;
  /** Which of the user's identities takes over the device once it links. */
  readonly takeover: string;
  /** Each function the device exposes to agents, as the tool namespace. */
  readonly functions: readonly string[];
}

export function DeviceConnect({
  connection,
  shown,
  place,
}: {
  connection: DeviceConnection;
  shown: number;
  /** Corner of the card: top-left or bottom-left. */
  place: "top" | "bottom";
}) {
  const linked = shown > 0;
  return (
    <div className="lp-dev-connect" data-place={place} data-linked={linked || undefined}>
      <LiquidGlass radius={14} edge="rim" staticMap className="lp-dev-connect-glass">
        <div className="lp-dev-connect-pad">
          <p className="lp-dev-connect-head">
            <span className="lp-dev-connect-dot" />
            <span className="lp-dev-connect-device">{connection.device}</span>
            {/* Both words share one grid cell, so the width never changes. */}
            <span className="lp-dev-connect-state">
              <span data-on={!linked || undefined}>Connecting</span>
              <span data-on={linked || undefined}>Connected</span>
            </span>
          </p>
          {/* Held in place from the start (hidden until linked), so no shift. */}
          <p className="lp-dev-connect-takeover" data-on={linked || undefined}>
            {connection.takeover}
          </p>
          <ul className="lp-dev-connect-fns">
            {connection.functions.map((fn, i) => (
              <li key={fn} className="lp-dev-connect-fn" data-on={i < shown || undefined}>
                {fn}
              </li>
            ))}
          </ul>
        </div>
      </LiquidGlass>
    </div>
  );
}
