"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FlushGrid } from "@/shared/design";

// ⚠ Top-level routes this shell dresses. Anything absent renders bare on the
// app frame colour — the shape of pages that draw their own app-shell surface
// (`/c/{workspaceId}` below, `/playground`, which reuses `app-shell.module.css`).
//
// ⚠ `/c/{workspaceId}` — the guest web channel (2026-08-25) — is DELIBERATELY
// ABSENT, not an oversight. Listing it would dress the page in the centred
// `FlushGrid` container, which is wrong for a full-viewport surface; the guest
// page draws its own root and overrides the frame body paint itself, so the
// bare app-shell-classed render this set's ABSENCE produces is what it wants.
const NON_WORKSPACE_ROOTS = new Set([
  "admin",
  "auth",
  // `/billing/{segment}` — segment is the SECOND path part, so without this
  // entry `isAppShellRoute` reads "billing" as a workspace slug and dresses the
  // page as app chrome.
  "billing",
  "design",
  "docs",
  // Post-auth download page. Draws its own full-viewport surface, but must be
  // listed or `isAppShellRoute` paints the app's dark rail behind it.
  "get-started",
  "invite",
  "join",
  // `/link/{token}` — the home-channel claim page, like `invite`/`join` above.
  "link",
  "login",
  "oauth",
  "onboarding",
  "pricing",
  "privacy",
  "services-agreement",
  "settings",
  "workspaces",
]);

/** The legal pages: white, bare, never the frame colour. `/terms` is not here —
 *  it is a `next.config.ts › redirects` 308 to `/services-agreement`. */
export const LEGAL_ROUTES: ReadonlySet<string> = new Set(["/services-agreement", "/privacy"]);

/** The developer docs (`/docs/**`) wear the legal pages' white body too (2026-10-20). */
export function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

/**
 * Legacy chrome shell — dresses only non-workspace pages (login, pricing,
 * /workspaces, /settings, admin, invite, oauth) in the dark centered-column
 * look. Marketing landing passes through bare; any other top-level route
 * renders bare on the app frame (see `NON_WORKSPACE_ROOTS`).
 *
 * ⚠ THE LEGAL PAGES ARE WHITE, AND NOTHING DARK IS PAINTED UNDER THEM
 * (Samuel, 2026-10-14): `LEGAL_ROUTES` get `legal-active` (white, declared in
 * `features/marketing/legal/legal.css`), never `mosaic-bg`, no inline frame
 * colour, and no `FlushGrid`/`<main>` wrapper. Keep in sync with the
 * pre-hydration script in `src/app/layout.tsx`, which does the same before
 * first paint.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isPricing = pathname === "/pricing";
  const isNoChrome = isLanding || isPricing;
  const isLegal = LEGAL_ROUTES.has(pathname) || isDocsPath(pathname);
  const segments = pathname.split("/").filter(Boolean);
  const isAppShellRoute =
    segments.length >= 1 && !NON_WORKSPACE_ROOTS.has(segments[0]);

  useEffect(() => {
    if (isLegal) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.remove("landing-active");
      document.body.classList.add("legal-active");
      document.body.style.backgroundColor = "";
      return () => {
        document.body.classList.remove("legal-active");
        document.body.classList.add("mosaic-bg");
      };
    }
    if (isNoChrome) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.add("landing-active");
      document.body.style.backgroundColor = "#000";
    } else if (isAppShellRoute) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.remove("landing-active");
      // ⚠ THE FRAME TOKEN, NOT A HEX (drift ledger ASK-31, settled by Samuel
      // 2026-08-30: home-frame wins, one token). This was a literal `#2c3640` —
      // a third near-identical dark slab, one hex off the frame the app-shell
      // actually paints. An inline style may hold a `var()`; it resolves against
      // `:root`, where `--home-frame` is declared.
      document.body.style.backgroundColor = "var(--home-frame)";
    } else {
      document.body.classList.add("mosaic-bg");
      document.body.classList.remove("landing-active");
      document.body.style.backgroundColor = "";
    }
    return () => {
      document.body.classList.remove("landing-active");
      document.body.classList.add("mosaic-bg");
      document.body.style.backgroundColor = "";
    };
  }, [isLegal, isNoChrome, isAppShellRoute]);

  if (isLegal || isNoChrome || isAppShellRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <FlushGrid />
      <main className="relative z-[2] container mx-auto px-4 py-8">
        {children}
      </main>
    </>
  );
}
