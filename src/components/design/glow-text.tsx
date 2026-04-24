/**
 * GlowText — text with a subtle accent glow.
 * Use sparingly for headings or hero text where you want emphasis.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

const glowTextVariants = cva("inline-block", {
  variants: {
    intensity: {
      subtle:
        "[text-shadow:0_0_12px_oklch(0.68_0.22_250/30%)]",
      default:
        "[text-shadow:0_0_16px_oklch(0.68_0.22_250/50%),0_0_32px_oklch(0.68_0.22_250/25%)]",
      strong:
        "[text-shadow:0_0_20px_oklch(0.68_0.22_250/70%),0_0_40px_oklch(0.68_0.22_250/40%),0_0_64px_oklch(0.68_0.22_250/20%)]",
    },
  },
  defaultVariants: {
    intensity: "default",
  },
});

interface GlowTextProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof glowTextVariants> {}

export function GlowText({
  className,
  intensity,
  children,
  ...props
}: GlowTextProps) {
  return (
    <span
      data-slot="glow-text"
      className={cn(glowTextVariants({ intensity }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

export { glowTextVariants };
