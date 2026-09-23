/**
 * /home's PAGE ACTION BUTTON — the black 36px pill (`docs/DESIGN-SYSTEM.md`:
 * `h-9` + `auth-btn-3d`), as ONE string.
 *
 * ⚠ IT IS THE "New channel" BUTTON'S OWN CLASS LIST, extracted rather than
 * copied (`apps/desktop-ui/src/pages/home/home-header.tsx` renders this
 * constant, so the two cannot drift). It was spelled out verbatim at three call
 * sites in the SPA tree before 2026-09-09; a class string repeated by hand is a
 * restyle that lands on whichever file the next reader opened.
 *
 * ⚠ **IT MOVED OUT OF `pages/home/panel-buttons.tsx` ON 2026-09-17, AND THE
 * REASON IS A SECOND TREE.** The landing page's hero demo renders /home's own
 * chrome (`features/marketing/components/banner-demo/`) and the Next tree cannot
 * import `apps/` at all — the root `tsconfig.json` excludes it and those files
 * resolve `#/*` against the SPA's own src. The direction that DOES work is
 * apps → root `src/`, which the SPA already takes for `@/shared/**` and for
 * eleven feature components, so the one declaration lives here and
 * `panel-buttons.tsx` re-exports it. **Nothing about the face changed in the
 * move.**
 *
 * ⚠ `text-text-on-cta`, NOT `text-white`. Same pixels (`--text-on-cta` is
 * `#ffffff`), but the design system's rule is that ink comes from a token
 * utility — a literal colour utility here is what a page-level restyle cannot
 * follow.
 *
 * ⚠ FACE AND SCALE ONLY. Behavioural states and inline spacing stay with the
 * caller through `cn` — the same division `open-scale-button.tsx` holds.
 */
export const PAGE_ACTION_BTN =
  "auth-btn-3d flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-text-on-cta";

/**
 * **{@link PAGE_ACTION_BTN}'S WHITE TWIN — the same button, raised-light face**
 * (Samuel, 2026-09-20, over the Threads/Artifacts switcher: *"Change it into a
 * white elevated button and move it to the right. Put it directly to the left of
 * the New Thread button"*).
 *
 * ⚠ **THE GEOMETRY IS THE DARK ONE'S, TO THE CHARACTER** — height, radius, pad,
 * type and weight are the same string; only the FACE and the INK differ. The two
 * sit side by side on that row, so any difference between them reads as one
 * button being slightly wrong rather than as two kinds of action.
 * ⚠ **`.auth-btn-3d-light` IS THE KIT'S EXISTING RAISED-LIGHT FACE**, the one
 * `.raised-tab` is built from (globals.css: *"ONE elevation … so the two cannot
 * drift"*). No new recipe and no local gradient is minted here.
 * ⚠ **BOLD, LIKE ITS TWIN.** `font-semibold` is the shared weight, which is also
 * the whole of *"bold the text that says Artifacts"* — it is a WEIGHT, never a
 * selected state: this is one button whose label is the face you are going to.
 */
export const PAGE_ACTION_BTN_LIGHT =
  "auth-btn-3d-light flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-text-primary";

/** Glyph size inside {@link PAGE_ACTION_BTN}. ONE number: two icons at two
 *  sizes in the same pill is the drift in miniature. */
export const PAGE_ACTION_ICON = 13;
