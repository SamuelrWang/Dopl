import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must be taught the design system's semantic font-size
 * utilities (docs/DESIGN-SYSTEM.md type ramp). Without this it lumps
 * `text-caption` etc. into the same conflict group as text COLORS
 * (`text-text-primary`), silently stripping the size whenever both
 * appear in one cn() call.
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
