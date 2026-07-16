"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Natural design size the feature miniatures are laid out at before being
 * scaled down to fit the deck-panel slot.
 */
export const DEMO_W = 912;
export const DEMO_H = 520;

/**
 * Steps a demo scenario through 0..marks.length while the panel is the
 * active card. `marks` are seconds-from-activation for each advance and
 * must be a module-level constant (referential stability keeps the effect
 * from rescheduling). Deactivating freezes the current frame (the card
 * glides out showing its final state); re-activating replays from 0.
 * `paused` (deck hover — mirrors the CSS progress-bar pause) stops the
 * clock and resumes with the remaining time intact.
 */
export function useDemoTimeline(
  marks: readonly number[],
  active = true,
  paused = false
): number {
  const [step, setStep] = useState(0);
  // ms of scenario time consumed before the current running segment
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!active) {
      elapsedRef.current = 0;
      return;
    }
    if (paused) return;

    const base = elapsedRef.current;
    const startedAt = Date.now();
    const entries = [0, ...marks].map((sec, i) => ({ at: sec * 1000, i }));
    // land on the step the elapsed time has already reached, then schedule
    // only the future ones — no replaying of pop-in animations on resume
    const current = entries.filter((e) => e.at <= base).pop()?.i ?? 0;
    const timers = [
      setTimeout(() => setStep(current), 0),
      ...entries
        .filter((e) => e.at > base)
        .map((e) => setTimeout(() => setStep(e.i), e.at - base)),
    ];
    return () => {
      timers.forEach(clearTimeout);
      elapsedRef.current = base + (Date.now() - startedAt);
    };
  }, [marks, active, paused]);

  return step;
}

/**
 * Chrome shared by every feature demo: the live-narration caption in the
 * panel's text column and the bottom-anchored, self-scaling miniature
 * window. Children are the replica markup at DEMO_W x DEMO_H.
 */
export function DemoShell({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / DEMO_W, r.height / DEMO_H, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      {/* re-keyed per step so each narration line fades in */}
      <span className="lp-demo-caption" key={caption}>
        <span className="lp-demo-caption-dot" aria-hidden />
        {caption}
      </span>
      <div ref={slotRef} className="lp-demo-slot" aria-hidden>
        <div
          className="lp-demo antialiased"
          style={{
            width: DEMO_W,
            height: DEMO_H,
            transform: `scale(${scale ?? 0.8})`,
            opacity: scale === null ? 0 : 1,
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
