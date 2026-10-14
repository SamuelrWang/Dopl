"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GlassCardContext } from "@/shared/layout/auth-split";
import { HOME_TABS } from "@/features/home/tabs";
import { IdentitiesMiniShowcase, type IdentityAgentLogos } from "./identities-mini-showcase";
import { KnowledgeMiniShowcase } from "./knowledge-mini-showcase";
import { OntologyMiniShowcase } from "./ontology-mini-showcase";
import { OverviewMiniShowcase } from "./overview-mini-showcase";

/**
 * Step 4's glass card (Samuel 2026-10-13): the product's home face switcher —
 * gray pills, the raised white one marking the face — stacked top to bottom on
 * the card's left instead of running across. The selection steps Overview →
 * Knowledge → Identities → Ontology and loops (no Channel face here).
 *
 * Same faces as the real control (`shared/ui/segmented-control.tsx` in the
 * /home switcher's form: `plain`, `lg`, semibold — the landing demo mounts it
 * that way too) over `HOME_TABS`, so a renamed or sixth face reaches this card.
 * It is not that component only because the real one swaps `.raised-tab`
 * instantly; here each pill CROSSFADES in place — the white face fading out on
 * the one being left while the next fades in. Nothing travels between rows
 * (Samuel: no sliding pill).
 *
 * Sized at the product's 36px and SCALED as a whole to fill the card's height
 * less a slim margin, so the pills keep their real proportions. Decorative: the
 * card layer is `aria-hidden`, and nothing here is a button.
 */

/** The faces shown: the product's, minus Channel (Samuel 2026-10-13). */
const TABS = HOME_TABS.filter((t) => t.key !== "channels");
/** Ms each face holds before the selection moves on. */
const HOLD_MS = 1500;
/** The crossfade between gray and the raised white face. */
const FADE = "360ms ease";
const GAP = 6;
/** Five 36px pills + four gaps, the stack's natural height. */
const STACK_H = TABS.length * 36 + (TABS.length - 1) * GAP;
/** Margin from the card's left, top and bottom edges. */
const PAD = 16;
/** Upper bound on the growth, so a tall card doesn't blow the pills up. */
const MAX_SCALE = 1.6;
/** `SegmentedControl`'s plain/lg/semibold option, minus its colour faces. */
const PILL =
  "relative flex h-9 items-center justify-center whitespace-nowrap rounded-full px-3 text-small font-semibold";

const NO_PHOTOS: readonly string[] = [];

export function WorkspaceTabsShowcase({
  regions,
  active,
  still,
  photos = NO_PHOTOS,
  agentLogos,
}: GlassCardContext & {
  /** The user's photos (step 1's people), for the Identities face. */
  photos?: readonly string[];
  /** The Identities face's agent logos (Claude, ChatGPT, Muse). */
  agentLogos?: IdentityAgentLogos;
}) {
  const { main } = regions;
  const scale = Math.min(
    MAX_SCALE,
    Math.max(0.5, (main.h - PAD * 2) / STACK_H),
  );

  // Reduced motion holds on Overview, the real default face. Hidden → back to
  // Overview (reset on the way OUT, in cleanup), so every return starts there.
  const [step, setStep] = useState(0);
  const running = active && !still;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setStep((i) => (i + 1) % TABS.length), HOLD_MS);
    return () => {
      clearInterval(t);
      setStep(0);
    };
  }, [running]);
  const at = running ? step : 0;

  // The stack's natural (pre-scale) width, so the face panel to its right
  // (`./knowledge-mini-showcase.tsx`) starts where the pills end.
  const stackRef = useRef<HTMLDivElement>(null);
  const [stackW, setStackW] = useState(110);
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const read = () => setStackW(el.offsetWidth || 110);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const faceLeft = main.x + PAD + stackW * scale + PAD * 1.5;
  const face = {
    x: faceLeft,
    y: main.y + PAD,
    w: Math.max(0, main.x + main.w - PAD - faceLeft),
    h: Math.max(0, main.h - PAD * 2),
  };
  const fade = still ? undefined : FADE;

  return (
    <>
      <div
        ref={stackRef}
        aria-hidden
        style={{
          position: "absolute",
          left: main.x + PAD,
          top: main.y + main.h / 2,
          transform: `translateY(-50%) scale(${scale.toFixed(3)})`,
          transformOrigin: "left center",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: GAP,
          pointerEvents: "none",
        }}
      >
        {TABS.map(({ key, label }, i) => {
          const on = i === at;
          return (
            <span key={key} className={`${PILL} bg-[var(--seg-fill)]`}>
              {/* The selected face, `.raised-tab`, faded over the gray in place. */}
              <span
                className="raised-tab absolute inset-0 rounded-full"
                style={{
                  opacity: on ? 1 : 0,
                  transition: fade && `opacity ${fade}`,
                }}
              />
              <span
                className={`relative ${on ? "text-text-primary" : "text-text-secondary"}`}
                style={{ transition: fade && `color ${fade}` }}
              >
                {label}
              </span>
            </span>
          );
        })}
      </div>
      {/* The selected face, to the right — one per pill. */}
      <OverviewMiniShowcase rect={face} on={TABS[at].key === "overview"} still={still} />
      <KnowledgeMiniShowcase
        rect={face}
        on={TABS[at].key === "knowledge"}
        still={still}
      />
      <IdentitiesMiniShowcase
        rect={face}
        on={TABS[at].key === "identities"}
        still={still}
        photos={photos}
        logos={agentLogos}
      />
      <OntologyMiniShowcase rect={face} on={TABS[at].key === "ontology"} still={still} />
    </>
  );
}
