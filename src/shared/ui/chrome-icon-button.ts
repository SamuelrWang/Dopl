/**
 * THE CHROME ICON BUTTON — a header's quiet 28px square: no face at rest, a raised-1 tint and
 * primary ink on hover. `channels/components/icon-button.tsx › IconButton` is the component (with
 * the toggle and bare forms); a feature that cannot import it styles a `<button>` with this.
 * The `aria-label` stays with the caller.
 */
export const CHROME_ICON_BOX =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-tile transition-colors";

export const CHROME_ICON_BUTTON = `${CHROME_ICON_BOX} text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary`;
