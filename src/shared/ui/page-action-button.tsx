import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { INK_PILL_FACE } from "./small-action-button";

/**
 * The page action, the 36px ink pill ("New channel"), as one string. It lives in root `src/`
 * because the landing's banner demo renders /home's chrome and the Next tree cannot import
 * `apps/`. Face and scale only; behavioural states and spacing stay with the caller.
 */
export const PAGE_ACTION_BTN = cn(INK_PILL_FACE, "h-9 px-3.75 text-small");

/**
 * {@link PAGE_ACTION_BTN}'s white twin on the kit's raised-light face, at the same geometry: the
 * two sit side by side, so any difference reads as a bug.
 */
export const PAGE_ACTION_BTN_LIGHT =
  "auth-btn-3d-light flex h-9 cursor-pointer items-center rounded-full px-3.75 text-small font-medium text-text-primary";

/**
 * The /home header's white pill (search, Profile) at the page scale: `.white-card` on the
 * `.raise-pill` lift. Face and height only; width and padding stay with the caller.
 */
export const WHITE_PILL =
  "white-card raise-pill inline-flex h-9 cursor-pointer items-center rounded-full text-small font-medium text-text-primary";

/** Glyph size inside {@link PAGE_ACTION_BTN}. */
export const PAGE_ACTION_ICON = 13;

/** A section header's create button (every /home panel `action`): the page pill plus a glyph. */
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
      className={cn(PAGE_ACTION_BTN, "gap-1.5 disabled:opacity-60")}
      disabled={disabled}
      onClick={onClick}
    >
      <Plus size={PAGE_ACTION_ICON} aria-hidden="true" />
      {children}
    </button>
  );
}
