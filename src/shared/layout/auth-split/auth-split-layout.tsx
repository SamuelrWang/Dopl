"use client";

import type { ReactNode } from "react";
// The right pane and the glass geometry both split out of this file on
// 2026-10-11 to stay under the 500-line cap (INVARIANTS §1). `AuthGlassPose`
// arrives as a TYPE import, so that edge is erased and the only runtime import
// is this file → the panel.
import { AuthBannerPanel } from "./auth-banner-panel";
import type { GlassCardContent } from "./glass-card-content";
import type { AuthGlassPose } from "./auth-glass-geometry";

/** ⚠ WEB-only path (served from `public/`). Not usable in the packaged
 *  renderer — see the `bannerSrc` prop. */
const WEB_BANNER_SRC = "/img/framework-banner.jpg";

/**
 * Full-viewport light split for auth surfaces (login, onboarding). Fixed cover
 * so the app's dark frame never bleeds and the page can't scroll; left column
 * scrolls internally. Panel collapses on mobile.
 */
export function AuthSplitLayout({
  children,
  brand,
  bannerSrc = WEB_BANNER_SRC,
  glassPose,
  glassEnterFrom,
  cornerBrand,
  glassCardContent,
  glassCardKey,
}: {
  children: ReactNode;
  /**
   * Pose for the right pane's glass panel.
   *
   * ⚠ OMITTED IS NOT THE SAME AS `"default"`, and the difference is
   * load-bearing: a caller that passes nothing is a PLAIN AUTH SURFACE
   * (login, signup, `/oauth/authorize`, the desktop signed-out screen) and
   * gets the geometry it had before any of this. Only a caller that names a
   * pose is onboarding, and only onboarding gets the footer padding below.
   */
  glassPose?: AuthGlassPose;
  /** Pinned to the PAGE's upper-left corner, matching the landing nav
   *  (`features/marketing/marketing.css` › .lp-brand). Optional: the desktop
   *  signed-out screen keeps its mark INSIDE the form (`LoginFormCore`'s own
   *  `brand`). */
  brand?: ReactNode;
  /**
   * ⚠ The default is WEB-only: the packaged renderer is a `file://` document, so
   * a leading `/` resolves to the filesystem root and the image never loads.
   * Desktop passes a Vite-bundled URL —
   * `apps/desktop-ui/src/lib/auth-banner.ts` › AUTH_BANNER_SRC (same JPEG).
   * ⚠ A static image import works for NEITHER side: this file compiles under
   * both webpack and Vite, which disagree on what it evaluates to (Next →
   * `StaticImageData` object, Vite → bare URL string).
   */
  bannerSrc?: string;
  /** The glass mounts in this pose and slides into `glassPose` — onboarding
   *  opening where the login screen left it. See `AuthBannerPanel` › enterFrom. */
  glassEnterFrom?: AuthGlassPose;
  /**
   * Pinned to the split's own top-left corner, mirroring the banner's
   * top-right one: same inset from the top and the side (the container's
   * padding), so the lockup and the image frame the page as a pair. The
   * desktop signed-out screen and every onboarding step pass the SAME
   * lockup here, so it stays put while the pages change (Samuel 2026-10-13).
   * Distinct from `brand`, which the web pins to the viewport like the
   * landing nav.
   */
  cornerBrand?: ReactNode;
  /** Content ON the glass's white card, keyed by pose — onboarding only (it
   *  needs `glassPose`; a plain surface has no card). See
   *  `AuthBannerPanel` › GlassCardContent. */
  glassCardContent?: GlassCardContent;
  /** Which card this is when two views share a pose (login and step 4 are
   *  both `"default"`). See `AuthBannerPanel` › cardKey. */
  glassCardKey?: string;
}) {
  return (
    // Same fixed white surface, deliberately NOT shared (each differs): `app/auth/desktop-handoff/page.tsx`, `app/link/[token]/page.tsx`.
    <main
      className="fixed inset-0 z-50 overflow-hidden bg-white"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      {/* Mirrors `.lp-nav`'s brand slot (`features/marketing/marketing.css`) —
          keep in sync. ⚠ Gutter written out, not referenced: `--gutter` is
          declared on `.lp`, which no auth page is inside, and an undefined
          custom property collapses the inset to 0. ⚠ `main` is
          `position: fixed`, so this `absolute` measures from the VIEWPORT; the
          centred container below must NOT become its containing block. */}
      {brand && (
        <div
          className="absolute z-10"
          // 42px row + centring mirrors the landing nav's brand cell: `.lp-nav`
          // pads 22px top and its tallest control (`.lp-icon-btn`) makes the
          // grid row 42px with the brand centred in it — lockup centre lands
          // 43px from the viewport top on both pages. Inline (not Tailwind
          // arbitrary classes) so the geometry cannot be dropped by the
          // scanner — see WebBrand in `src/app/(auth)/layout.tsx`.
          style={{
            top: 22,
            left: "clamp(20px, 4vw, 56px)",
            height: 42,
            display: "flex",
            alignItems: "center",
          }}
        >
          {brand}
        </div>
      )}
      <div className="relative mx-auto flex h-full max-w-[1500px] items-stretch gap-10 p-6 md:p-10">
        {cornerBrand && (
          // Same inset as the container padding (p-6 / md:p-10), i.e. the
          // banner's top-right corner, mirrored. `h-8` = the mark's height,
          // so the lockup's centre line sits on the banner's top edge + 16.
          <div className="absolute left-6 top-6 z-10 flex h-8 items-center md:left-10 md:top-10">
            {cornerBrand}
          </div>
        )}
        {/* ⚠ THE PADDING IS INLINE STYLE AND ONBOARDING-ONLY, and both halves
            were learned by measuring rather than reasoning.
            INLINE because this file's geometry must be: Tailwind's scan does
            not reliably emit this file's utilities for every route chain (the
            same note the glass panel below carries). Shipped as `py-7` first —
            the class sat in the DOM on web with NO rule emitted and padding
            computing to 0, so the fix worked in the desktop SPA and did
            nothing on the web. A class-name assertion would have passed.
            ONBOARDING-ONLY because that is whose button it is (Samuel #3064),
            and onboarding exists solely in the desktop SPA. Login, signup,
            `/oauth/authorize` and the signed-out screen pass no pose and keep
            the geometry they have always had.
            SYMMETRIC, not `paddingBottom` alone: the child's `min-h-full`
            resolves against this element's CONTENT box, so equal padding
            shifts it down 28 and shortens it 56, leaving the centre on the
            same pixel. Bottom alone would lift the form 14px.
            28px clears the HOVER shadow (`0 10px 24px`,
            `--shadow-raised-hover`), not the resting `0 6px 16px` — pad for
            the resting one and it clips again exactly on hover. */}
        <div
          className="flex-[4] overflow-y-auto"
          style={
            // A corner lockup needs the column to clear it (32px mark + gap);
            // symmetric so the content's centre stays on the same pixel.
            cornerBrand
              ? { paddingTop: 56, paddingBottom: 56, scrollPaddingBottom: 56 }
              : glassPose
                ? { paddingTop: 28, paddingBottom: 28, scrollPaddingBottom: 28 }
                : undefined
          }
        >
          <div className="flex min-h-full items-center justify-center">{children}</div>
        </div>
        <div className="hidden flex-[5] md:block">
          {/* A surface that names no pose renders the panel's historical
              slab: `"default"` IS that slab.
              ⚠ `card` CARRIES THE OMITTED-VS-DEFAULT DISTINCTION ACROSS THIS
              BOUNDARY, and it has to be a second argument because `pose`
              collapses it: `glassPose ?? "default"` makes a plain auth surface
              and onboarding's step 3 indistinguishable inside the panel, and
              they disagree about the card. Derived from the SAME signal as the
              footer padding above — "the caller named a pose" is what means
              onboarding here — rather than a second opt-in prop, so the two
              cannot drift apart and a future onboarding caller cannot get the
              pose right and the card wrong. */}
          <AuthBannerPanel
            src={bannerSrc}
            pose={glassPose ?? "default"}
            card={glassPose !== undefined}
            enterFrom={glassEnterFrom}
            cardContent={glassCardContent}
            cardKey={glassCardKey}
          />
        </div>
      </div>
    </main>
  );
}
