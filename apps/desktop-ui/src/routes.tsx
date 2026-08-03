import { Navigate, type RouteObject } from "react-router";
import { AppLayout } from "#/components/app-layout";
import { PlaceholderPage } from "#/components/placeholder-page";
import { RouteErrorBoundary } from "#/components/page-states";

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
  { path: "overview", label: "Overview" },
  { path: "canvas", label: "Canvas" },
  { path: "ontology", label: "Ontology" },
  { path: "knowledge", label: "Knowledge" },
  { path: "knowledge/:kbSlug", label: "Knowledge base" },
  { path: "skills", label: "Skills" },
  { path: "skills/:skillSlug", label: "Skill" },
  { path: "workflows", label: "Workflows" },
  { path: "workflows/:workflowSlug", label: "Workflow" },
  { path: "chats", label: "Chats" },
  { path: "channels", label: "Channels" },
  { path: "members", label: "Members" },
  { path: "settings", label: "Settings" },
  { path: "configuration", label: "Configuration" },
];

/** The web app's `/[workspaceSlug]` server redirect target. */
export const WORKSPACE_HOME_PATH = "canvas";

export const routes: RouteObject[] = [
  {
    path: "/:workspaceSegment",
    element: <AppLayout />,
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
    element: (
      <PlaceholderPage
        title="Dopl"
        note="Workspace resolution is not ported yet — open a /:workspaceSegment route."
      />
    ),
  },
  {
    path: "*",
    element: <PlaceholderPage title="Not found" note="No route matches this URL." />,
  },
];
