/**
 * /home's page action button, the black 36px pill ("New channel"), as one string. It lives in
 * root `src/` because the landing's banner demo renders /home's chrome and the Next tree cannot
 * import `apps/`. Ink is `text-text-on-cta`, a token, not `text-white`. Face and scale only;
 * behavioural states and spacing stay with the caller.
 */
export const PAGE_ACTION_BTN =
  "auth-btn-3d flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-text-on-cta";

/**
 * {@link PAGE_ACTION_BTN}'s white twin on the kit's raised-light face. The geometry string is the
 * dark one's to the character: the two sit side by side, so any difference reads as a bug.
 */
export const PAGE_ACTION_BTN_LIGHT =
  "auth-btn-3d-light flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-text-primary";

/** Glyph size inside {@link PAGE_ACTION_BTN}. */
export const PAGE_ACTION_ICON = 13;
