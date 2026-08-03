import { NavLink, Outlet, useParams } from "react-router";
import { WORKSPACE_PAGES } from "#/routes";

/**
 * The workspace shell — the SPA's layout route, standing in for
 * `src/app/[workspaceSlug]/(app)/layout.tsx`.
 *
 * SCAFFOLD ONLY. The real shell (AppShell → TourProvider → MyAccessProvider →
 * children + JoinRequestNotices + ConnectAgentBanner + WelcomePopup, plus the
 * rail/sidebar/switcher) is a port of its own — see
 * docs/migration-research/web-pages.md §2, which also lists the five props the
 * layout derives from `GET /api/workspaces/{segment}` and the canonical-segment
 * rewrite it must reimplement client-side (§1.5). This version renders a nav
 * over the route table and nothing else, so pages can be ported and verified
 * before the shell exists.
 */
export function AppLayout() {
  const { workspaceSegment = "" } = useParams();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <nav className="flex w-[var(--shell-sidebar-w)] shrink-0 flex-col gap-0.5 overflow-y-auto px-2 py-3">
        <p className="text-label text-text-muted px-2 pb-2 uppercase tracking-wide font-semibold">
          {workspaceSegment}
        </p>
        {WORKSPACE_PAGES.filter((page) => !page.path.includes(":")).map((page) => (
          <NavLink
            key={page.path}
            to={`/${workspaceSegment}/${page.path}`}
            className={({ isActive }) =>
              `text-small rounded-md px-2 py-1 ${
                isActive ? "concave-sel text-text-primary" : "text-text-secondary"
              }`
            }
          >
            {page.label}
          </NavLink>
        ))}
      </nav>
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
