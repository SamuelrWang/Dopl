/**
 * THE 30px FLAT TEXT BUTTON — `--action-h-sm`, no face at rest, a raised-1 tint on hover: the
 * composer card's Discard and every popup form's Discard. Extend it through `cn`.
 */
export const SMALL_TEXT_BUTTON =
  "flex h-[var(--action-h-sm)] items-center rounded-md px-2.5 text-caption font-medium " +
  "text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

/**
 * THE 30px BLACK VERB — `.auth-btn-3d` at `--action-h-sm`, the popup form's primary
 * (`form-dialog.tsx › FormDialog`'s footer: New channel, Add person, New agent). A rounded
 * rectangle, not a pill: the pill-shaped twin is `pill-button.tsx › pillButton("ink", "md")`.
 */
export const SMALL_PRIMARY_BUTTON =
  "auth-btn-3d flex h-[var(--action-h-sm)] items-center rounded-md px-3.5 text-caption " +
  "font-semibold text-text-on-cta";
