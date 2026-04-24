/**
 * Orb — the glowing cyan/blue logo orb from the screenshot.
 *
 * It's a circular element with a radial gradient interior and a soft outer
 * glow that bleeds into surrounding elements. Used for the logo and can also
 * serve as a status indicator.
 *
 * Sizes: sm (24px), md (40px), lg (56px), xl (80px)
 * Glow intensity: subtle, default, strong
 */

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

const orbVariants = cva(
  "relative rounded-full shrink-0 isolate",
  {
    variants: {
      size: {
        sm: "size-6",
        md: "size-10",
        lg: "size-14",
        xl: "size-20",
      },
      glow: {
        subtle: "shadow-[0_0_16px_oklch(0.68_0.22_250/30%)]",
        default:
          "shadow-[0_0_24px_oklch(0.68_0.22_250/50%),0_0_48px_oklch(0.68_0.22_250/25%)]",
        strong:
          "shadow-[0_0_32px_oklch(0.68_0.22_250/70%),0_0_64px_oklch(0.68_0.22_250/40%),0_0_96px_oklch(0.68_0.22_250/20%)]",
      },
    },
    defaultVariants: {
      size: "md",
      glow: "default",
    },
  }
);

export interface OrbProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof orbVariants> {}

export function Orb({ className, size, glow, ...props }: OrbProps) {
  return (
    <div
      data-slot="orb"
      className={cn(orbVariants({ size, glow }), className)}
      style={{
        background: "var(--gradient-orb)",
      }}
      {...props}
    >
      {/* Inner specular highlight */}
      <div
        className="absolute inset-0 rounded-full opacity-60 mix-blend-screen"
        style={{
          background:
            "radial-gradient(circle at 30% 25%, oklch(1 0 0 / 80%) 0%, transparent 35%)",
        }}
      />
      {/* Subtle inner cross pattern */}
      <div
        className="absolute inset-0 rounded-full opacity-30 mix-blend-overlay"
        style={{
          background:
            "conic-gradient(from 45deg, transparent 0deg, oklch(1 0 0 / 40%) 40deg, transparent 90deg, oklch(1 0 0 / 40%) 130deg, transparent 180deg, oklch(1 0 0 / 40%) 220deg, transparent 270deg, oklch(1 0 0 / 40%) 310deg, transparent 360deg)",
        }}
      />
    </div>
  );
}

export { orbVariants };
