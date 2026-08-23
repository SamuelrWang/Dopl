import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Small raised icon plate at a card's top-left. `.raised-tab` is the kit's
 * white-raised FACE (it already dresses the Switch thumb and active nav chips,
 * neither of them a tab) — the only thing local here is the size and radius.
 */
export function IconTile({
  children,
  round = false,
}: {
  children: ReactNode;
  round?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "raised-tab flex h-7 w-7 shrink-0 items-center justify-center text-text-secondary",
        round ? "rounded-full" : "rounded-[8px]"
      )}
    >
      {children}
    </span>
  );
}

/** Uppercase card label — the ramp's `text-label` role, spelled once. */
export function CardLabel({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 flex-1 truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
      {children}
    </span>
  );
}

/** The big figure. `text-stat` is the ramp rung added for exactly this. */
export function StatFigure({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-stat font-semibold tabular-nums text-text-primary">
      {children}
    </p>
  );
}

/**
 * Card counts read "03", not "3" — the clone's zero-padding, kept now that the
 * numbers are live. Anything into double figures groups normally.
 */
export function padCount(value: number): string {
  return value >= 0 && value < 10 ? `0${value}` : value.toLocaleString();
}
