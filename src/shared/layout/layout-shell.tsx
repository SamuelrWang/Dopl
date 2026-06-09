"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { FlushGrid } from "@/shared/design";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { workspaceSegmentFromPath } from "@/shared/lib/url/workspace-segment";
import { useTheme } from "@/shared/hooks/use-theme";

const NO_SIDEBAR_PATHS = new Set(["/login", "/terms", "/privacy"]);

// Second path segments under /[workspaceSlug] that are real sub-pages, not a
// canvas slug. Anything else as the 2nd segment is a canvas (which paints its
// own inset panel via its portal), so the shell skips the content-panel wrap.
const WORKSPACE_SUBROUTES = new Set([
  "chat",
  "knowledge",
  "members",
  "overview",
  "settings",
  "skills",
]);

// Top-level routes that are NOT a workspace slug. Without this, a 2-segment
// non-workspace path like /settings/profile would be mistaken for a canvas.
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
  "settings",
  "terms",
  "workspaces",
]);

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Owns the <html> theme class: applies the saved preference on app routes
  // and forces dark on marketing/auth/docs routes, re-running on navigation.
  useTheme();
  const isLanding = pathname === "/";
  const isDocs = pathname.startsWith("/docs");
  // Full-bleed routes opt out of the centered container so panels can
  // sit flush against the workspace sidebar + page top bar (no padding
  // gap that lets the mosaic grid bleed through).
  const isFullBleed =
    /^\/[^/]+\/knowledge\/[^/]+\/?$/.test(pathname) ||
    /^\/[^/]+\/chat\/?$/.test(pathname) ||
    /^\/[^/]+\/overview\/?$/.test(pathname) ||
    /^\/[^/]+\/members\/?$/.test(pathname) ||
    /^\/[^/]+\/skills\/[^/]+\/?$/.test(pathname);
  const isNoChrome = isLanding || isDocs;
  const isNoSidebar = NO_SIDEBAR_PATHS.has(pathname);
  // Canvas route = /[workspaceSlug]/[canvasSlug] (2nd segment isn't a known
  // sub-page). The canvas portals its own inset rounded panel, so the shell
  // renders a transparent passthrough there instead of a solid content panel.
  const segments = pathname.split("/").filter(Boolean);
  const isCanvas =
    segments.length === 2 &&
    !NON_WORKSPACE_ROOTS.has(segments[0]) &&
    !WORKSPACE_SUBROUTES.has(segments[1]);

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
  // Workspace segment derived once at the shell level so the
  // my-access provider, the sidebar, and any descendant page (KB
  // detail, skill detail, canvas panels) all agree on which workspace
  // they're scoped to. Audit A-008: hosting the access fetch here
  // dedups what was previously two parallel calls (one per nav
  // section) plus on-demand calls per detail page.
  const workspaceSegment = workspaceSegmentFromPath(pathname);

  return (
    <MyAccessProvider workspaceSegment={workspaceSegment}>
      <FlushGrid />
      <Sidebar />
      {isCanvas ? (
        // Canvas owns its own inset rounded panel via its portal (z-[1]); keep
        // the main transparent and pointer-transparent so the portaled canvas
        // receives marquee/drag events through the empty chrome layer.
        <div className="relative z-[2] pointer-events-none md:pl-64">
          <main className="pointer-events-auto">{children}</main>
        </div>
      ) : (
        // Standard pages float in an inset rounded panel on the bare
        // background. The panel is a FIXED-size card (same dimensions on every
        // page): top inset clears the 52px top bar (+ gap), gapped from the
        // sidebar and the right/bottom edges, and content scrolls inside it.
        <div className="relative z-[2] md:pl-64 h-screen pt-[60px] px-2 pb-2">
          <main className="h-full overflow-hidden rounded-2xl border border-border-subtle bg-[var(--bg-elevated)] shadow-[var(--shadow-panel)]">
            {isFullBleed ? (
              children
            ) : (
              <div className="h-full overflow-y-auto">
                <div className="container mx-auto px-4 py-8">{children}</div>
              </div>
            )}
          </main>
        </div>
      )}
    </MyAccessProvider>
  );
}
