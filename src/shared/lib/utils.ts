import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * ⚠ tailwind-merge must be taught the design system's semantic font-size
 * utilities (docs/DESIGN-SYSTEM.md type ramp), else it lumps `text-caption`
 * into the same conflict group as text COLORS (`text-text-primary`) and
 * silently strips the size whenever both appear in one cn() call.
 *
 * ⚠ **THIS LIST IS THE TYPE RAMP AND MUST STAY EQUAL TO IT.** `text-stat` was
 * missing until 2026-08-30 — a real rung (`--text-stat` is declared in BOTH
 * `src/app/globals.css` and `apps/desktop-ui/src/styles/tokens.css`) that was
 * never taught here, so `cn("text-stat", "text-text-primary")` dropped the SIZE
 * and rendered a dashboard figure at body scale. It was live at
 * `apps/desktop-ui/src/pages/overview/overview-bits.tsx › StatFigure`, which
 * pairs exactly those two and imports `cn` from this module. F-240's residual.
 * **A rung added to the ramp is a rung added HERE**, and the failure mode is
 * silent in both directions — nothing errors, the class simply vanishes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "label",
            "caption",
            "small",
            "body",
            "lead",
            "title",
            "stat",
            "display",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
