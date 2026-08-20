"use client";

import type { ReactNode } from "react";
import { LiquidGlass } from "@/shared/design";

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
}: {
  children: ReactNode;
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
}) {
  return (
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
 * Right pane: same banner image as
 * `features/marketing/components/ontology-section.tsx` › OntologySection,
 * under the same `LiquidGlass` primitive at the landing card's `radius={20}`.
 *
 * ⚠ Nothing copied from `marketing.css` — the glass is a React component and
 * `.lp-ont-glass*` are only that section's centring + 544px cap. Slab sized by
 * percentage insets with NO transform (a transform on a `backdrop-filter`
 * element is a rendering coin flip), plus a px floor for short viewports.
 *
 * Hexes are fine here: auth + onboarding are the design system's standing
 * exemption (docs/DESIGN-SYSTEM.md).
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
      {/* Decorative (empty alt) — form column carries the meaning. ⚠ Plain
          <img>, never next/image: Vite compiles this file too and has no Next
          runtime to serve an optimized image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover object-center"
      />

      {/* ⚠ Geometry is INLINE STYLE, not utility classes, and must stay that
          way: Tailwind's scan does not reliably emit this file's arbitrary
          values for every route chain (measured 2026-08-17 — `top-[32%]` /
          `min-h-[220px]` absent from every built stylesheet), and when the
          classes are missing the glass drops into static flow below the
          full-height image and the panel's overflow clips it to nothing. */}
      <LiquidGlass
        radius={20}
        style={{
          position: "absolute",
          left: "8%",
          right: "8%",
          top: "32%",
          height: "36%",
          minHeight: 220,
        }}
      >
        {/* Portal target — a PAGE may project content onto the glass (the
            get-started install animation does) while the layout, and therefore
            the banner + glass, persists across auth-group navigations. Empty on
            every other surface, including the desktop SPA. */}
        <div id={AUTH_GLASS_SLOT_ID} style={{ width: "100%", height: "100%" }} />
      </LiquidGlass>
    </div>
  );
}

/** Where `GlassSlot` portals land — one AuthSplitLayout per document, so a
 *  static id is safe. */
export const AUTH_GLASS_SLOT_ID = "auth-glass-slot";
