import { Navigate, type RouteObject } from "react-router";
import { AppShellLayout } from "#/components/app-shell";
import { PlaceholderPage } from "#/components/placeholder-page";
import { RouteErrorBoundary } from "#/components/page-states";
import OverviewPage from "#/pages/overview";
import SkillsPage from "#/pages/skills/index";
import SkillDetailRedirect from "#/pages/skills/detail";
import ChatsPage from "#/pages/chats";
import KnowledgePage from "#/pages/knowledge";
import KnowledgeDetailPage from "#/pages/knowledge/detail";
import MembersPage from "#/pages/members";
import OntologyPage from "#/pages/ontology";
import OntologyDetailPage from "#/pages/ontology/detail";
import SettingsPage from "#/pages/settings";
import ChannelsPage from "#/pages/channels";
import BootPage from "#/pages/boot";
import OnboardingPage from "#/pages/onboarding";

/**
 * THE ROUTE TABLE — the one place a page is registered.
 *
 * Mirrors the web app's `src/app/[workspaceSlug]/(app)/**` directories
 * (docs/migration-research/web-pages.md). Marketing, login, pricing and
 * onboarding are deliberately absent: they die with the website (Phase 4).
 *
 * TO ADD OR PORT A PAGE: add/edit ONE row below. Give it an `element` when a
 * real page component exists; leave it off and it renders the shared
 * placeholder. Do not create nested `<Routes>` trees, and do not register a
 * route anywhere else.
 *
 * Rows whose `path` contains a `:param` are detail routes — the layout's nav
 * skips them (it cannot invent an id).
 *
 * RETIRED (2026-08-07): `canvas`, `canvas2`, `workflows` and `workflows/:slug`
 * are gone from this table — those page components still exist under
 * `#/pages/**` but nothing imports or routes to them
 * (docs/RETIREMENT-UNWIRING-PLAN.md §3.1). Restoring one means restoring its
 * row here, its `NavSection` + `NAV` row in
 * `src/shared/layout/app-shell/app-sidebar-core.tsx`, and the hand copy in
 * `dopl-desktop-app/main/deep-link-target.js`. `configuration` was DELETED
 * (2026-08-11) — there is no page left to restore.
 */

export interface PageRoute {
  /** Path relative to `/:workspaceSegment`. */
  path: string;
  /** Nav label + placeholder title. */
  label: string;
  /** The ported page. Omitted → placeholder. */
  element?: React.ReactNode;
}

export const WORKSPACE_PAGES: PageRoute[] = [
  { path: "overview", label: "Overview", element: <OverviewPage /> },
  { path: "ontology", label: "Ontology", element: <OntologyPage /> },
  { path: "ontology/:clusterSlug", label: "Cluster", element: <OntologyDetailPage /> },
  { path: "knowledge", label: "Knowledge", element: <KnowledgePage /> },
  { path: "knowledge/:kbSlug", label: "Knowledge base", element: <KnowledgeDetailPage /> },
  { path: "skills", label: "Skills", element: <SkillsPage /> },
  { path: "skills/:skillSlug", label: "Skill", element: <SkillDetailRedirect /> },
  { path: "chats", label: "Chats", element: <ChatsPage /> },
  { path: "channels", label: "Channels", element: <ChannelsPage /> },
  { path: "members", label: "Members", element: <MembersPage /> },
  { path: "settings", label: "Settings", element: <SettingsPage /> },
];

/** The workspace index redirect target — every "go home" funnel lands here. */
export const WORKSPACE_HOME_PATH = "overview";

export const routes: RouteObject[] = [
  {
    // Runs BEFORE a workspace exists — deliberately outside
    // /:workspaceSegment. Static segment outranks the param route.
    path: "/onboarding",
    element: <OnboardingPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "/:workspaceSegment",
    element: <AppShellLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        index: true,
        element: <Navigate to={WORKSPACE_HOME_PATH} replace />,
      },
      ...WORKSPACE_PAGES.map(({ path, label, element }) => ({
        path,
        element: element ?? <PlaceholderPage title={label} />,
      })),
    ],
  },
  {
    // No workspace in the URL. The web app resolved the caller's default
    // workspace server-side (`src/app/page.tsx`); the SPA needs the
    // default-workspace endpoint from the gap register
    // (docs/migration-research/web-pages.md §16) before this can redirect.
    path: "/",
    // Boot: signed-out screen / onboarding / ensure-default → workspace.
    element: <BootPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "*",
    element: <PlaceholderPage title="Not found" note="No route matches this URL." />,
  },
];
