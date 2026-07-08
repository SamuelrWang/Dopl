"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { FlushGrid } from "@/shared/design";

// Top-level routes that are NOT a workspace slug. Anything else is a
// workspace route, where the new-design AppShell layouts ((app) group +
// canvas layout) own all chrome and this legacy shell renders nothing.
const NON_WORKSPACE_ROOTS = new Set([
  "admin",
  "auth",
  "canvas",
  "design",
  "docs",
  "invite",
  "login",
  "oauth",
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
 * landing and docs pass through with no chrome at all. Every workspace
 * route (named sub-pages AND the canvas) is dressed by its own AppShell
 * layout and bypasses this component entirely.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const isDocs = pathname.startsWith("/docs");
  const isPricing = pathname === "/pricing";
  const isNoChrome = isLanding || isDocs || isPricing;
  const segments = pathname.split("/").filter(Boolean);
  const isAppShellRoute =
    segments.length >= 1 && !NON_WORKSPACE_ROOTS.has(segments[0]);

  // Body background: landing/docs manage their own; app-shell routes get
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
