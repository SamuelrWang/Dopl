"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FlushGrid } from "@/shared/design";

// ⚠ Top-level routes that are NOT a workspace slug. Anything absent from this
// set is treated as a workspace route, where the (app) group AppShell owns all
// chrome and this legacy shell renders nothing.
//
// ⚠ `/c/{workspaceId}` — the guest web channel (2026-08-25) — is DELIBERATELY
// ABSENT, not an oversight. Listing it would dress the page in the centred
// `FlushGrid` container, which is wrong for a full-viewport surface; the guest
// page draws its own root and overrides the `#2c3640` body paint itself, so the
// bare app-shell-classed render this set's ABSENCE produces is what it wants.
const NON_WORKSPACE_ROOTS = new Set([
  "admin",
  "auth",
  // `/billing/{segment}` — segment is the SECOND path part, so without this
  // entry `isAppShellRoute` reads "billing" as a workspace slug and dresses the
  // page as app chrome.
  "billing",
  "design",
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
  "terms",
  "settings",
  "workspaces",
]);

/**
 * Legacy chrome shell — dresses only non-workspace pages (login, pricing,
 * /workspaces, /settings, admin, invite, oauth, legal) in the dark
 * centered-column look. Marketing landing passes through bare; every workspace
 * route is dressed by the (app) group AppShell and bypasses this entirely.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isPricing = pathname === "/pricing";
  const isNoChrome = isLanding || isPricing;
  const segments = pathname.split("/").filter(Boolean);
  const isAppShellRoute =
    segments.length >= 1 && !NON_WORKSPACE_ROOTS.has(segments[0]);

  useEffect(() => {
    if (isNoChrome) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.add("landing-active");
      document.body.style.backgroundColor = "#000";
    } else if (isAppShellRoute) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.remove("landing-active");
      document.body.style.backgroundColor = "#2c3640";
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
  }, [isNoChrome, isAppShellRoute]);

  if (isNoChrome || isAppShellRoute) {
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
