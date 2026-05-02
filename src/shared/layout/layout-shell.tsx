"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { FlushGrid } from "@/shared/design";

const NO_SIDEBAR_PATHS = new Set(["/login", "/terms", "/privacy"]);

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/" || pathname === "/landing-v2";
  const isDocs = pathname.startsWith("/docs");
  // Community detail pages use their own full-screen layout
  const isCommunityDetail = pathname.startsWith("/community/") && !pathname.endsWith("/posts");
  // /browse needs more horizontal room + breathing space below the
  // fixed top nav so the smart-chat rail + grid don't run up against
  // the bars. Wider max-width than the default `container` class.
  // Matches /browse, /browse/entries, /browse/clusters.
  const isBrowse = pathname === "/browse" || pathname.startsWith("/browse/");
  // Full-bleed routes opt out of the centered container so panels can
  // sit flush against the workspace sidebar + page top bar (no padding
  // gap that lets the mosaic grid bleed through).
  const isFullBleed =
    /^\/[^/]+\/knowledge\/[^/]+\/?$/.test(pathname) ||
    /^\/[^/]+\/chat\/?$/.test(pathname) ||
    /^\/[^/]+\/overview\/?$/.test(pathname);
  const isNoChrome = isLanding || isCommunityDetail || isDocs;
  const isNoSidebar = NO_SIDEBAR_PATHS.has(pathname);

  // Toggle mosaic-bg on body: remove for landing, ensure present elsewhere
  useEffect(() => {
    if (isNoChrome) {
      document.body.classList.remove("mosaic-bg");
      document.body.classList.add("landing-active");
      document.body.style.backgroundColor = "#000";
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
  }, [isNoChrome]);

  if (isNoChrome) {
    return <>{children}</>;
  }

  if (isNoSidebar) {
    return (
      <>
        <FlushGrid />
        <main className="relative z-[2] container mx-auto px-4 py-8">
          {children}
        </main>
      </>
    );
  }

  // Sidebar is `fixed` so it doesn't constrain `<main>` to viewport
  // height. That matters for the canvas page: the canvas portals itself
  // to document.body at `fixed inset-0 z-[1]`, and a full-height
  // `<main>` with `pointer-events-auto` would sit on top of it and
  // swallow drag/click events even though it has no painted content.
  // With sidebar fixed-positioned, main returns to natural block flow:
  // it only takes up as much height as its (mostly empty) children
  // need, leaving the rest of the viewport free for the canvas to
  // receive pointer events.
  return (
    <>
      <FlushGrid />
      <Sidebar />
      <div className="relative z-[2] pointer-events-none md:pl-64">
        <main
          className={
            // /browse goes full-viewport-width: chat rail flushes to
            // the left edge, grid fills the rest. No mx-auto + no
            // max-width so wide monitors don't get empty side gutters.
            isBrowse
              ? "w-full pl-3 pr-3 pt-3 pb-3 pointer-events-auto"
              : isFullBleed
                ? "pointer-events-auto"
                : "container mx-auto px-4 py-8 pointer-events-auto"
          }
        >
          {children}
        </main>
      </div>
    </>
  );
}
