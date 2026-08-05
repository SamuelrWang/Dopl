"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FlushGrid } from "@/shared/design";

// Top-level routes that are NOT a workspace slug. Anything else is a
// workspace route, where the new-design AppShell (app) group layout owns
// all chrome and this legacy shell renders nothing. `canvas` here is the
// top-level /canvas legacy redirect, not the workspace Canvas tab.
const NON_WORKSPACE_ROOTS = new Set([
  "admin",
  "auth",
  // The post-retirement billing + account surface (`/billing/{segment}`). The
  // segment is the SECOND path part here, not the first, so without this entry
  // `isAppShellRoute` reads "billing" as a workspace slug and dresses the page
  // as app chrome. Same reason `get-started` is listed below.
  "billing",
  "canvas",
  "design",
  // The post-auth download page. It draws its own full-viewport surface (like
  // login), but it must be listed here or `isAppShellRoute` reads it as a
  // workspace slug and paints the app's dark rail colour behind it.
  "get-started",
  "invite",
  "join",
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
 * Legacy chrome shell. After the new-design rollout it only dresses
 * non-workspace pages (login, pricing, /workspaces, /settings, admin,
 * invite, oauth, legal) with the dark centered-column look; the marketing
 * landing passes through with no chrome at all. Every workspace
 * route is dressed by the (app) group AppShell layout and bypasses this
 * component entirely.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isPricing = pathname === "/pricing";
  const isNoChrome = isLanding || isPricing;
  const segments = pathname.split("/").filter(Boolean);
  const isAppShellRoute =
    segments.length >= 1 && !NON_WORKSPACE_ROOTS.has(segments[0]);

  // Body background: landing manages its own; app-shell routes get
  // the new dark rail color; legacy routes keep the flat dark frame.
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

  // Legacy non-workspace pages: centered content column on the dark frame.
  return (
    <>
      <FlushGrid />
      <main className="relative z-[2] container mx-auto px-4 py-8">
        {children}
      </main>
    </>
  );
}
