"use client";

import type { ReactNode } from "react";
import { LiquidGlass } from "@/shared/design";

/** The banner the WEB serves from `public/`. Not usable in the packaged
 *  renderer — see the `bannerSrc` prop. */
const WEB_BANNER_SRC = "/img/framework-banner.jpg";

/**
 * Full-viewport light split used by the auth-adjacent surfaces (login,
 * onboarding): a left content column (form / questionnaire) beside the banner
 * panel. Fixed cover so the app's dark frame never bleeds and the page can't
 * scroll; the left column scrolls internally if a viewport is too short. The
 * panel collapses on mobile. Login's typeface is scoped here.
 *
 * The right pane is the landing page's framework banner under a glass slab
 * (`AuthBannerPanel`, below). It replaced the crystal panel on 2026-08-14; the
 * crystal field it drew is deleted, not benched.
 */
export function AuthSplitLayout({
  children,
  brand,
  bannerSrc = WEB_BANNER_SRC,
}: {
  children: ReactNode;
  /**
   * Optional brand lockup, pinned to the PAGE's upper-left corner rather than
   * sitting at the top of the form column — the landing page's nav brand
   * placement (`features/marketing/marketing.css` › .lp-brand, rendered by
   * `components/site-nav.tsx`), so a visitor arriving from the landing page
   * sees the mark stay where it was.
   *
   * Optional because not every host has one to put here: the desktop SPA's
   * signed-out screen keeps its mark INSIDE the form (`LoginFormCore`'s own
   * `brand` prop) — that window is 900-odd px of chrome-less renderer, and a
   * corner mark there reads as a stray icon rather than as a site header.
   */
  brand?: ReactNode;
  /**
   * Source for the right pane's banner. Defaults to the web's `public/` path,
   * which the PACKAGED RENDERER cannot use: it is a `file://` document, so a
   * leading `/` resolves to the filesystem root and the image never loads
   * (the same trap `OnboardingFlowCore`'s `brand` prop documents, and the
   * reason `boot/signed-out-screen.tsx` bundles its mark).
   *
   * So the desktop hosts pass a Vite-bundled asset URL instead —
   * `apps/desktop-ui/src/lib/auth-banner.ts` › AUTH_BANNER_SRC, which is the
   * same JPEG copied into the SPA's assets. A static image import here would
   * not work for either side: this file compiles under BOTH webpack and Vite,
   * and they disagree on what an image import evaluates to (Next hands back a
   * `StaticImageData` object, Vite a bare URL string).
   */
  bannerSrc?: string;
}) {
  return (
    <main
      className="fixed inset-0 z-50 overflow-hidden bg-white"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      {/* THE LANDING NAV'S BRAND SLOT, REBUILT — not "near the corner", the
          same corner. `.lp-nav` (`features/marketing/marketing.css`) is a
          full-width grid padded `22px var(--gutter)`, whose row is 42px tall
          because `.lp-icon-btn`/`.lp-menu-btn` are, and the brand rides that
          row centred. So: a 42px band starting 22px down, inset by the SAME
          `clamp(20px, 4vw, 56px)` gutter.

          The gutter is written out rather than referenced: `--gutter` is
          declared on `.lp`, which no auth page is inside, and an undefined
          custom property here would silently collapse the inset to 0.

          `main` is `position: fixed`, so this `absolute` is measured from the
          VIEWPORT — the centred `max-w-[1500px]` container below is not its
          containing block and must not be, since the landing nav is full
          width. */}
      {brand && (
        <div
          className="absolute z-10 flex h-[42px] items-center"
          style={{ top: 22, left: "clamp(20px, 4vw, 56px)" }}
        >
          {brand}
        </div>
      )}
      <div className="mx-auto flex h-full max-w-[1500px] items-stretch gap-10 p-6 md:p-10">
        <div className="flex-[4] overflow-y-auto">
          <div className="flex min-h-full items-center justify-center">{children}</div>
        </div>
        <div className="hidden flex-[5] md:block">
          <AuthBannerPanel src={bannerSrc} />
        </div>
      </div>
    </main>
  );
}

/**
 * The right pane: the landing page's framework banner with a glass slab riding
 * it. Both halves are the framework section's, not lookalikes — the image is
 * the SAME file (`features/marketing/components/framework-section.tsx` ›
 * FrameworkSection, sized by `.lp-fw-banner-img` in
 * `features/marketing/marketing.css`) and the glass is the SAME component that
 * section floats on it: `LiquidGlass`, the canonical glass primitive
 * (`shared/design/liquid-glass/liquid-glass.tsx`), at the landing card's
 * `radius={20}` and otherwise stock. So a visitor arriving from the landing
 * page meets a composition they scrolled past.
 *
 * ⚠ NOTHING is copied out of `marketing.css` — there was nothing to copy. The
 * glass is a React component, and `.lp-fw-glass`/`.lp-fw-glass-card` are only
 * the section's own centring + a 544px width cap. This pane sizes its slab
 * with percentage insets and NO transform (a transform on a `backdrop-filter`
 * element is a rendering coin flip), plus a px floor so a short viewport can't
 * squash it to a sliver. The slab is empty on purpose: the tab windows are the
 * landing page's payload, and the form column is this page's.
 *
 * The 32px radius and the layered float shadow are inherited from the crystal
 * panel this replaced (deleted 2026-08-14) — the pane's geometry and elevation
 * are unchanged, only what fills it. Auth + onboarding are the design system's
 * standing exemption (docs/DESIGN-SYSTEM.md), so a hex here is this surface's
 * house style, not a token that was skipped.
 */
function AuthBannerPanel({ src }: { src: string }) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-[32px] bg-[#060A0F]"
      style={{
        boxShadow:
          "0 6px 16px rgba(8,10,15,0.28), " +
          "0 28px 64px rgba(8,10,15,0.34), " +
          "0 1px 0 rgba(255,255,255,0.6)",
      }}
    >
      {/* Decorative — the form column carries the meaning. Plain <img>, never
          next/image: this file is also compiled by the desktop SPA's Vite
          build, which has no Next runtime to serve an optimized image. The
          framework section and the hero banner make the same call. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover object-center"
      />

      {/* Centred by its own insets — 32% top + 36% height leaves 32% below. */}
      <LiquidGlass
        radius={20}
        className="absolute inset-x-[8%] top-[32%] h-[36%] min-h-[220px]"
      />
    </div>
  );
}
