import Link from "next/link";
import { AuthSplitLayout } from "@/shared/layout/auth-split";

/**
 * Shared chrome for the auth entry routes (`/authenticate` the page, `/login` +
 * `/signup` the redirectors into it — `shared/auth/auth-routes.ts`).
 *
 * ⚠ THE LAYOUT IS THE FIX FOR THE SWITCH FLASH — that is why the split shell
 * lives HERE and not inside `LoginScreen`. App Router persists a layout across
 * navigations between its children, so moving between `/login` and `/signup`
 * keeps the banner <img> and its LiquidGlass mounted and only swaps the form
 * column. When the shell lived inside each page, every switch remounted the
 * whole split and the banner's dark slab painted while the JPEG re-decoded —
 * the "flash". Moving the shell back into the pages reintroduces that bug.
 *
 * (The in-form mode switch doesn't even navigate any more — it swaps in place,
 * `features/auth/components/login-form.tsx` — but this layout still carries
 * back/forward, deep links and modifier-clicks, which DO navigate.)
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthSplitLayout brand={<WebBrand />}>{children}</AuthSplitLayout>;
}

/** Brand lockup, auth page upper-left. ⚠ Must stay in sync with
 *  `.lp-brand`/`.lp-brand-mark`/`.lp-brand-word` in
 *  `features/marketing/marketing.css`: 26px mark, 6px radius, 11px gap,
 *  Playfair italic wordmark, `--ink` (#0d0d0d) word.
 *
 *  ⚠ Geometry values are INLINE STYLES on purpose. The gap and sizes were
 *  Tailwind arbitrary-value classes (`gap-[11px]`, `h-[26px]`…) and shipped
 *  without applying — the lockup rendered bunched together and ~8px high
 *  versus the landing nav. Inline styles cannot be dropped by the scanner;
 *  the brand must sit pixel-identical to the landing page's so the two pages
 *  read as one surface when navigating between them. */
function WebBrand() {
  return (
    <Link
      href="/"
      aria-label="Dopl"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 11,
        color: "#0d0d0d",
        textDecoration: "none",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicons/android-chrome-512x512.png"
        alt="Dopl"
        width={26}
        height={26}
        className="auth-logo-3d"
        style={{ display: "block", height: 26, width: 26, borderRadius: 6 }}
      />
      <span
        style={{
          fontFamily: "var(--font-playfair), Georgia, serif",
          fontStyle: "italic",
          fontSize: 21,
          fontWeight: 500,
        }}
      >
        Dopl
      </span>
    </Link>
  );
}
