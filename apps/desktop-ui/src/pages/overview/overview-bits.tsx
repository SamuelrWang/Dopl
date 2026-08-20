import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * The per-card overflow affordance. Inert in this pass — the page is a static
 * clone, so there is nothing yet for `Popover` to open. Kept a real `<button>`
 * with a label so swapping in the kit's `Popover` later is a wrap, not a
 * rewrite, and so the card is not decorated with an unreachable glyph.
 */
export function KebabButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="-mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-secondary"
    >
      <MoreHorizontal size={14} aria-hidden="true" />
    </button>
  );
}

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
