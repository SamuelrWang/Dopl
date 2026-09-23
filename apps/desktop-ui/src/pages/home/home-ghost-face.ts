/**
 * The one face every /home loading ghost wears: the radius and the border box, nothing visible
 * (skeletons are flat — shimmer blocks only). `border-transparent`, never a dropped border: the
 * background paints under the border box and dropping it would move every block in by a pixel.
 */
export const GHOST_FLAT_FACE = "rounded-[14px] border border-transparent";
