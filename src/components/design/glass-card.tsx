/**
 * GlassCard — Opaque surface panel with luminous border and highlights.
 *
 * Uses opaque CSS-variable-driven surface colors with subtle border
 * and top highlight. Designed to float over dark backgrounds.
 *
 * Variants:
 *  - "default"  — standard panel (--card-surface)
 *  - "elevated" — brighter surface + border (for modals, dropdowns)
 *  - "subtle"   — darker, lower contrast (for inline/nested use)
 */

import { cn } from "@/lib/utils";
import { HTMLAttributes, ReactNode } from "react";

type GlassVariant = "default" | "elevated" | "subtle";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional label rendered at the top of the card (mono uppercase) */
  label?: ReactNode;
  /** Visual intensity variant */
  variant?: GlassVariant;
  /** Accent color for the label bar (CSS color string — use coral/mint/gold tokens) */
  accentColor?: string;
  /** Whether to show the separator below the label */
  labelDivider?: boolean;
  /** Disable the border entirely */
  borderless?: boolean;
  /** Render as a different element (for semantic HTML) */
  as?: "div" | "section" | "aside" | "article";
}

const variantStyles: Record<
  GlassVariant,
  {
    bg: string;
    border: string;
    shadow: string;
  }
> = {
  default: {
    bg: "bg-[var(--card-surface)]",
    border: "border border-white/[0.2]",
    shadow:
      "shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.15)]",
  },
  elevated: {
    bg: "bg-[var(--card-surface-elevated)]",
    border: "border border-white/[0.28]",
    shadow:
      "shadow-[0_12px_48px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.2)]",
  },
  subtle: {
    bg: "bg-[var(--card-surface-subtle)]",
    border: "border border-white/[0.12]",
    shadow:
      "shadow-[0_4px_16px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.1)]",
  },
};

export function GlassCard({
  className,
  label,
  variant = "default",
  accentColor,
  labelDivider = false,
  borderless = false,
  as: Component = "div",
  children,
  ...props
}: GlassCardProps) {
  const v = variantStyles[variant];

  return (
    <Component
      data-slot="glass-card"
      className={cn(
        // Layout
        "relative rounded-2xl p-6 overflow-hidden",
        // Surface
        v.bg,
        !borderless && v.border,
        v.shadow,
        // Transition for interactive states
        "transition-colors duration-200",
        className
      )}
      {...props}
    >
      {/* Top highlight — simulates light refraction on glass edge */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 30%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.3) 70%, transparent 100%)",
        }}
      />

      {/* Label */}
      {label && (
        <div
          className={cn(
            "flex items-center gap-2 mb-4",
            labelDivider && "pb-4 border-b border-white/[0.1]"
          )}
        >
          {accentColor && (
            <div
              className="w-0.5 h-4 rounded-full"
              style={{ backgroundColor: accentColor }}
            />
          )}
          {typeof label === "string" ? (
            <span className="font-mono text-[10px] uppercase tracking-wide text-white/70">
              {label}
            </span>
          ) : (
            label
          )}
        </div>
      )}

      {/* Content */}
      {children}
    </Component>
  );
}

/**
 * GlassDivider — A subtle separator for use inside GlassCard.
 * Matches the liquid glass aesthetic with a soft gradient line.
 */
export function GlassDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-px w-full my-3", className)}
      style={{
        background:
          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 20%, rgba(255,255,255,0.15) 80%, transparent 100%)",
      }}
    />
  );
}
