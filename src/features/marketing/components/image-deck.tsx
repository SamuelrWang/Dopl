"use client";

import { useState } from "react";

import { DECK_DURATION_S, DECK_PANELS } from "../constants";

const N = DECK_PANELS.length;

/**
 * Folder deck conveyor. Each card has a slot: 0 = main (expanded), > 0 = pending
 * (cascade right with its tab), < 0 = done. A done card slides LEFT until only
 * its tab is parked at the left edge — the body shrinks out of the rectangle but
 * the tab stays in view, mirroring the pending tabs on the right. When the main
 * card's slider fills it slides left to a parked tab and the next card expands.
 * When the last card is reached it stays put and the rest sweep back out to the
 * right to reassemble, then it loops. Tabs never change height — only slide.
 */
export function ImageDeck() {
  const [slots, setSlots] = useState<number[]>(() => DECK_PANELS.map((_, i) => i));
  const [step, setStep] = useState(0); // restarts the slider on every move

  const advance = () => {
    setStep((s) => s + 1);
    setSlots((prev) => {
      // final state (last card is main, every other card already parked) ->
      // sweep them all back to the right into the natural folder order, loop
      if (!prev.some((s) => s >= 1)) return DECK_PANELS.map((_, i) => i);
      // otherwise advance: main -> newest done (-1); the rest shift one left
      return prev.map((s) => (s === 0 ? -1 : s - 1));
    });
  };

  const select = (i: number) => {
    setStep((s) => s + 1);
    let slot = 1;
    setSlots(DECK_PANELS.map((_, j) => (j === i ? 0 : slot++)));
  };

  const doneCount = slots.filter((s) => s < 0).length;

  return (
    <div
      className="lp-deck"
      style={{ "--panels": N, "--dur": `${DECK_DURATION_S}s` } as React.CSSProperties}
    >
      {DECK_PANELS.map((panel, i) => {
        const slot = slots[i];
        const isMain = slot === 0;
        const isDone = slot < 0;

        // the active card sits just right of the done-tab rail; pending cascade
        // to its right; a done card's body glides off-left, leaving a tab parked
        // on the rail that juts right, OVER the active panel's left edge
        const railShift = `var(--rail-step) * ${doneCount}`;
        let transform: string;
        if (isMain) {
          // left edge anchored at 0; the panel grows wider (via --done in CSS)
          // so its right edge still lands where a shifted card's would
          transform = `translateX(0)`;
        } else if (slot > 0) {
          transform = `translateX(calc(${railShift} + var(--edge) * ${slot}))`;
        } else {
          // done: body glides fully off the left edge (clipped); its tab stays,
          // parked FLUSH at the left edge (no horizontal stagger between tabs)
          transform = `translateX(-100%)`;
        }
        // ONE stack via z = N - slot: pending sit below the active (slot > 0 ->
        // z < N), done sit above it (slot < 0 -> z > N) with the OLDEST done on
        // top — so a freshly retracting card glides UNDER the already-parked
        // tabs (and over the active), never jumping above the whole stack
        const z = N - slot;

        return (
          <div
            key={panel.id}
            className="lp-panel"
            data-state={isDone ? "done" : isMain ? "main" : "pending"}
            style={
              {
                "--slot": slot,
                "--i": i,
                "--done": doneCount,
                transform,
                zIndex: z,
              } as React.CSSProperties
            }
          >
            {(isMain || isDone) && (
              <span className="lp-panel-body">
                <span className="lp-panel-eyebrow">{panel.eyebrow}</span>
                <span className="lp-panel-title">{panel.label}</span>
              </span>
            )}
            {isMain && (
              <span className="lp-panel-progress" aria-hidden>
                <span
                  key={step}
                  className="lp-panel-progress-fill"
                  onAnimationEnd={advance}
                />
              </span>
            )}
            <button
              type="button"
              className="lp-tab"
              onClick={() => select(i)}
              aria-label={`Show ${panel.label}`}
              aria-pressed={isMain}
            >
              {panel.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
