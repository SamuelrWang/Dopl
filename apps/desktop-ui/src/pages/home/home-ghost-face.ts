/**
 * /home's GHOST FACE — the one surface recipe every loading shape on this page
 * wears, as a constants module (the division `shared/ui/panel-well.ts` holds).
 *
 * ⚠ **ITS OWN FILE SINCE 2026-09-22, AND THE SEAM IS SHARING**: `home-skeleton.tsx`
 * and `home-list-skeleton.tsx` both wear it, and it cannot live in either without
 * the other importing THROUGH it — a cycle, and a file that changes for two
 * reasons. Moved VERBATIM; nothing about the face changed in the move.
 */

/**
 * 🔒 THE ONLY FACE A GHOST ON THIS PAGE DRAWS — radius and the border BOX, and
 * nothing that can be seen (Samuel, 2026-09-21: the skeletons are FLAT,
 * *"we basically just shouldn't have elevated components"*, which he defined as
 * SHIMMER BLOCKS ONLY: a skeleton container keeps its geometry and loses its
 * fill, its hairline and its shadow).
 *
 * ⚠ `border border-transparent`, NEVER a dropped border: `.bento` and
 * `auth-btn-3d-light` both carry a 1px line, the background paints under the
 * border box, and removing it would pull every block inside in by a pixel. The
 * same spelling `shared/ui/section-panel.tsx › SECTION_PANEL_GROUND` uses, and
 * the same one `pages/overview/overview-skeleton.tsx › FLAT_PANEL` uses for the
 * workspace face.
 *
 * ⚠ **`SECTION_PANEL_GROUND` IS NOT ELEVATION AND STAYS.** It is
 * `border border-transparent bg-home-panel` — a flat panel gray, which is
 * exactly what the Knowledge and Agents ghosts Samuel named as the REFERENCE
 * already stand on.
 */
export const GHOST_FLAT_FACE = "rounded-[14px] border border-transparent";
