"use client";

/**
 * **THE COMPOSER'S WORKING-AGENT CHIPS, REDESIGNED FOR THE BANNER DEMO ONLY** (Samuel,
 * 2026-10-22: the text input area). The product chips (`agent-activity.tsx`, filled in each
 * agent's colour) still render in the real composer's "→ @handle" line; this hides each one
 * and places a rounded pill after it (`demo-swap.ts`): filled in the agent's colour with
 * white text, as the product chip is (Samuel, 2026-10-22), and the same working dots. The name, colour and working
 * state are read off the product chip, so the face cannot disagree with it.
 *
 * The field, toolbar and send button are restyled in CSS only (`marketing.css › COMPOSER`),
 * so every control and its behaviour stays the product's.
 */

import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { useDemoSwap } from "./demo-swap";

const CHIPS = '[aria-label="Recipients"] [role="status"]';

export function DemoComposerChips({
  paneRef,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
}) {
  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      [...pane.querySelectorAll<HTMLElement>(CHIPS)].map((source, i) => ({
        key: `${source.firstElementChild?.textContent ?? ""}-${i}`,
        source,
      })),
    "lp-demo-chip-host"
  );
  return (
    <>
      {swaps.map(({ key, source, host }) =>
        createPortal(
          <span
            className="lp-demo-chip"
            style={{ background: source.style.backgroundColor || undefined }}
          >
            <span className="lp-demo-chip-name">
              {source.firstElementChild?.textContent ?? ""}
            </span>
            {source.querySelector(".working-dots") && (
              <span aria-hidden className="working-dots lp-demo-chip-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            )}
          </span>,
          host,
          key
        )
      )}
    </>
  );
}
