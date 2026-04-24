/**
 * Surface — the foundational container primitive.
 *
 * Variants:
 * - `elevated` — the navbar look: dark gradient background, subtle border,
 *   top-edge highlight (specular line), and floating shadow. Used for cards,
 *   navbars, panels.
 * - `inset` — the recessed look: slightly darker, single border, no glow.
 *   Used for nav items, inputs, inner pills.
 * - `flat` — minimal: just bg + border, no gradient, no shadow.
 *
 * Shapes:
 * - `pill` — fully rounded
 * - `card` — rounded-2xl
 * - `panel` — rounded-xl
 * - `tile` — rounded-md
 */

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

const surfaceVariants = cva("relative", {
  variants: {
    variant: {
      elevated:
        "bg-[var(--gradient-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-elevated),var(--inset-highlight)]",
      inset:
        "bg-[var(--bg-inset)] border border-[var(--border-subtle)]",
      flat: "bg-[var(--bg-elevated)] border border-[var(--border-subtle)]",
    },
    shape: {
      pill: "rounded-[var(--radius-pill)]",
      card: "rounded-2xl",
      panel: "rounded-xl",
      tile: "rounded-md",
    },
  },
  defaultVariants: {
    variant: "elevated",
    shape: "panel",
  },
});

export interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

export function Surface({
  className,
  variant,
  shape,
  ...props
}: SurfaceProps) {
  return (
    <div
      data-slot="surface"
      className={cn(surfaceVariants({ variant, shape }), className)}
      {...props}
    />
  );
}

export { surfaceVariants };
