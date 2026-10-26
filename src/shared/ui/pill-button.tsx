import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * THE PILL BUTTON — every rounded-full button face, as one recipe: `variant` × `size`.
 * Callers style a `<button>`, `<a>` or `<Link>` with it and add only layout and behavioural
 * states (`disabled:*`, `ml-auto`, `shrink-0`) through `cn`.
 *
 * - `outline`: hairline, white, raised-1 tint on hover (Open, Sign out, Manage billing).
 * - `quiet`: a subtle hairline, no fill, secondary ink that darkens on hover (Launch agent).
 * - `white`: `.white-card` on the `.raise-pill` lift (the /home header's search and Profile).
 * - `ink`: the black pill on the `.raise-ink` lift (New channel, Open thread, Save).
 *
 * `white` and `ink` stand on their lift by default; `raise` turns it off, or puts an `outline`
 * pill on the white lift. Lives in root `src/` because the landing's banner demo renders /home's
 * chrome and the Next tree cannot import `apps/`.
 */
export type PillVariant = "outline" | "quiet" | "white" | "ink";

/** `xs` 22px, `sm` 26px (a card's actions), `md` 30px (`--action-h-sm`, a popup's actions),
 *  `lg` 36px (a page or header action), `fit` content height (a chip inside a row). */
export type PillSize = "xs" | "sm" | "md" | "lg" | "fit";

const BASE = "inline-flex flex-none items-center rounded-full font-medium";

const FACE: Record<PillVariant, string> = {
  outline:
    "border border-border-default bg-bg-overlay text-text-primary transition-colors hover:bg-surface-raised-1",
  quiet:
    "border border-border-subtle text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60",
  white: "white-card text-text-primary",
  ink: "bg-surface-cta text-text-on-cta",
};

const LIFT: Record<PillVariant, string> = {
  outline: "raise-pill",
  quiet: "raise-pill",
  white: "raise-pill",
  ink: "raise-ink",
};

const SIZE: Record<PillSize, string> = {
  xs: "h-5.5 gap-1 px-2.5 text-caption",
  sm: "h-6.5 gap-1 px-2.75 text-caption",
  md: "h-[var(--action-h-sm)] gap-1.5 px-3.5 text-caption",
  lg: "h-9 gap-1.5 px-3.75 text-small",
  fit: "px-2.5 py-0.5 text-caption",
};

/** The glyph inside a pill at each size. */
export const PILL_ICON: Record<PillSize, number> = { xs: 11, sm: 12, md: 12, lg: 13, fit: 12 };

export function pillButton(
  variant: PillVariant = "outline",
  size: PillSize = "md",
  { raise = variant === "white" || variant === "ink" }: { raise?: boolean } = {}
): string {
  return cn(raise && LIFT[variant], BASE, FACE[variant], SIZE[size]);
}

/** A section header's create button (every /home panel `action`): the `ink` `lg` pill plus a glyph. */
export function CreateButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(pillButton("ink", "lg"), "disabled:opacity-60")}
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={PILL_ICON.lg} aria-hidden="true" />
      {children}
    </button>
  );
}
