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

/** Glyph size inside {@link PAGE_ACTION_BTN}. ONE number: two icons at two
 *  sizes in the same pill is the drift in miniature. */
export const PAGE_ACTION_ICON = 13;
