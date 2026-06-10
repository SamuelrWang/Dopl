"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { FlushGrid } from "@/shared/design";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { workspaceSegmentFromPath } from "@/shared/lib/url/workspace-segment";
import { useTheme } from "@/shared/hooks/use-theme";

const NO_SIDEBAR_PATHS = new Set(["/login", "/terms", "/privacy"]);

// Second path segments under /[workspaceSlug] that are app-shell pages
// (the (app) route group). Those routes paint their own chrome — the
// new-design AppShell layout — so this legacy shell renders nothing
// around them. Anything else as the 2nd segment is a canvas slug.
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

/**
 * Legacy chrome shell. After the new-design rollout it only dresses:
 *   - the canvas route (old sidebar + colorway, untouched for now),
 *   - non-workspace pages (login, pricing, /workspaces, /settings,
 *     admin, invite, oauth, legal),
 *   - the no-chrome routes (landing, docs) it always passed through.
 * Every named workspace sub-page lives in the (app) route group, which
 * mounts the new AppShell in its own layout — this component bypasses
 * those entirely. Delete the legacy branches when the canvas converts.
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Owns the <html> theme class (always dark since the light-mode
  // toggle was removed; the new-design pages carry their own palette).
  useTheme();
  const isLanding = pathname === "/";
  const isDocs = pathname.startsWith("/docs");
  const isNoChrome = isLanding || isDocs;
  const isNoSidebar = NO_SIDEBAR_PATHS.has(pathname);
  const segments = pathname.split("/").filter(Boolean);
  // New-design app-shell routes: /{ws}/{named sub-page}/** — the (app)
  // layout owns all chrome there.
  const isAppShellRoute =
    segments.length >= 2 &&
    !NON_WORKSPACE_ROOTS.has(segments[0]) &&
    WORKSPACE_SUBROUTES.has(segments[1]);
  // Canvas route = /[workspaceSlug]/[canvasSlug] (2nd segment isn't a known
  // sub-page). The canvas portals its own inset rounded panel, so the shell
  // renders a transparent passthrough there instead of a solid content panel.
  const isCanvas =
    segments.length === 2 &&
    !NON_WORKSPACE_ROOTS.has(segments[0]) &&
    !WORKSPACE_SUBROUTES.has(segments[1]);

  // Body background: landing/docs manage their own; app-shell routes get
  // the new dark rail color; legacy routes keep the mosaic grid.
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

  if (isNoChrome) {
    return <>{children}</>;
  }

  // The (app) route group owns its full-screen AppShell; render bare.
  if (isAppShellRoute) {
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

  // Workspace segment derived once at the shell level so the my-access
  // provider, the sidebar, and the canvas panels agree on which
  // workspace they're scoped to.
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
        // Legacy non-workspace pages float in an inset rounded panel on the
        // bare background, content scrolling inside it.
        <div className="relative z-[2] md:pl-64 h-screen pt-[60px] px-2 pb-2">
          <main className="h-full overflow-hidden rounded-2xl border border-border-subtle bg-[var(--bg-elevated)] shadow-[var(--shadow-panel)]">
            <div className="h-full overflow-y-auto">
              <div className="container mx-auto px-4 py-8">{children}</div>
            </div>
          </main>
        </div>
      )}
    </MyAccessProvider>
  );
}
