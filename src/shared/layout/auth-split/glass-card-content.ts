import type { ReactNode } from "react";
import type { AuthGlassPose, CardRect } from "./auth-glass-geometry";

/**
 * The contract for content painted ON the glass's white card. Types only — its
 * own file so `./auth-banner-panel.tsx` stays under the 500-line cap
 * (INVARIANTS §1). The panel renders it; `./auth-split-layout.tsx` passes it
 * through as `glassCardContent`.
 */

/** What a card-content renderer is handed. */
export interface GlassCardContext {
  /** The card's two rects in the glass box's px — see `cardRegions`. */
  regions: { main: CardRect; side: CardRect | null };
  /** True only while the card is settled AND faded in. Turns false the frame
   *  the card starts fading out, so a timeline can freeze rather than move
   *  under the fade, and restart cleanly when it comes back. */
  active: boolean;
  /** `prefers-reduced-motion: reduce`. */
  still: boolean;
}

/**
 * Content painted ON the white card, per pose. Keyed by POSE, not handed in
 * bare, because the card's content must leave WITH the card: the panel picks
 * the renderer for the pose the glass is actually in (`movePose`), which lags
 * the requested one by the card's fade-out — so a step change keeps the old
 * content on screen exactly as long as the card it sits on.
 */
export type GlassCardContent = Partial<Record<AuthGlassPose, (ctx: GlassCardContext) => ReactNode>>;
