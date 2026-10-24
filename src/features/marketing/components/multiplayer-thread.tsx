"use client";

import { LiquidGlass } from "@/shared/design/liquid-glass/liquid-glass";
import { MULTIPLAYER_COPY } from "./multiplayer-content";
import { at } from "./multiplayer-visuals";
import { useVisualPlay } from "./use-visual-play";

/**
 * Card 3: Alex's Admin Assistant on Alex's iMessage, talking to a new outside
 * contact and booking the meeting; a liquid-glass Dopl notification slides down
 * over the top at the end. The header is a frosted overlay and the thread runs
 * the full panel height under it, so by the end the banner's glass has real
 * message bubbles behind it to refract. Same play contract as ./multiplayer-visuals.tsx
 * (`--d` start times, `data-play`, CSS-only motion, base rules = final frame).
 * Messages GROW in (grid rows 0fr → 1fr) at the bottom of a flex-end column,
 * so earlier ones scroll up and off under the header like a real thread.
 *
 * Typing dots come only before the CONTACT's (incoming) messages — the
 * assistant's blue ones are being sent from this phone, so they just appear.
 */

/** Timeline knobs, ms (Samuel 2026-10-16: ~18% slower than the first cut). */
const START = 350;
/** Pause before an assistant message is sent. */
const SEND_PAUSE = 820;
/** Reading time after any message lands. */
const READ = 540;
/** Incoming typing-dots length scales with the reply, clamped. */
const typingFor = (text: string) => Math.min(1400, Math.max(800, 350 + text.length * 13));
/** Notification, after the last message. */
const NOTIFY_PAUSE = 450;

type Slot = { at: number; typing?: readonly [number, number] };

/** Derives the whole timeline from the message list, so copy edits never
 *  desync it. Returns each message's slot and the notification's start. */
function schedule(messages: readonly { from: string; text: string }[]) {
  let t = START;
  const slots: Slot[] = messages.map((m, i) => {
    if (m.from === "alex") {
      if (i > 0) t += SEND_PAUSE;
      const slot = { at: t };
      t += READ;
      return slot;
    }
    const w = typingFor(m.text);
    const slot = { at: t + w, typing: [t, w] as const };
    t += w + READ;
    return slot;
  });
  return { slots, notifyAt: t + NOTIFY_PAUSE };
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
}

export function DeployVisual() {
  const ref = useVisualPlay<HTMLDivElement>();
  const c = MULTIPLAYER_COPY.deploy;
  const n = c.notification;
  const { slots, notifyAt } = schedule(c.messages);
  return (
    <div className="lp-mp-panel lp-mp-phone" aria-hidden="true" ref={ref}>
      <div className="lp-mp-notify" style={at(notifyAt)}>
        {/* The hero notification's glass, verbatim (hero-banner.tsx: radius 18,
            component defaults, `edge="rim"`, static map) minus its hover tilt.
            Its drop shadow is overridden smaller in marketing.css. */}
        <LiquidGlass radius={18} edge="rim" staticMap className="lp-mp-notify-glass">
          <div className="lp-mp-notify-pad">
            {/* eslint-disable-next-line @next/next/no-img-element -- local onboarding asset */}
            <img src={n.mark} alt="" className="lp-mp-notify-icon" />
            <span className="lp-mp-notify-text">
              <span className="lp-mp-notify-meta">
                <span>{n.app}</span>
                <span>{n.time}</span>
              </span>
              <span className="lp-mp-notify-title">{n.title}</span>
              <span className="lp-mp-notify-body">{n.body}</span>
            </span>
          </div>
        </LiquidGlass>
      </div>

      <div className="lp-mp-phone-head">
        <span className="lp-mp-contact-disc">{initials(c.contact)}</span>
        <span className="lp-mp-contact-name">{c.contact}</span>
      </div>

      <div className="lp-mp-thread">
        {c.messages.map((m, i) => {
          const { at: msgAt, typing } = slots[i];
          const mine = m.from === "alex";
          return (
            <div key={i} className="lp-mp-msg-group">
              {typing && (
                <div className="lp-mp-typing" style={at(typing[0], typing[1])}>
                  <div>
                    <div className="lp-mp-line">
                      <span className="lp-mp-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div className="lp-mp-grow" style={at(msgAt)}>
                <div>
                  <div className="lp-mp-line">
                    <span className={mine ? "lp-mp-bubble lp-mp-bubble--me" : "lp-mp-bubble"}>{m.text}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
