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
import IdentitiesPage from "#/pages/identities";
import OntologyDetailPage from "#/pages/ontology/detail";
import SettingsPage from "#/pages/settings";
import ChannelsPage from "#/pages/channels";
import BootPage from "#/pages/boot";
import HomePage from "#/pages/home";
import { HOME_PATH } from "#/components/app-shell/account-rail";
import OnboardingPage from "#/pages/onboarding";
import ThreadWindowPage from "#/pages/thread-window";
import AgentWindowPage from "#/pages/agent-window";

/**
 * The route table — the one place a page is registered. A row without an `element` renders the
 * shared placeholder; `:param` rows are detail routes the nav skips. Adding a page also means a
 * `NAV` row in `src/shared/layout/app-shell/app-sidebar-core.tsx` and the hand copy in
 * `dopl-desktop-app/main/deep-link-target.js`.
 */

export interface PageRoute {
  /** Path relative to `/:workspaceSegment`. */
  path: string;
  /** Nav label + placeholder title. */
  label: string;
  /** The ported page. Omitted → placeholder. */
  element?: React.ReactNode;
}

/**
 * Page order is a product statement (channels lead, ontology is substrate). The sidebar renders
 * `app-sidebar-core.tsx › NAV`, which carries the same order BY HAND — reorder both together.
 * `deep-link-target.js › WORKSPACE_PAGES` is keyed by page (value = "has a `:param` child"), so a
 * reorder needs no edit there; adding or removing a page does.
 */
export const WORKSPACE_PAGES: PageRoute[] = [
  { path: "overview", label: "Overview", element: <OverviewPage /> },
  { path: "channels", label: "Channels", element: <ChannelsPage /> },
  // A clicked request notification lands here (`main/shell-mode.js › CHANNELS_PAGE`); main's
  // `WORKSPACE_PAGES` carries `channels: true` for this row (INVARIANTS §11).
  { path: "channels/:channelId", label: "Channel", element: <ChannelsPage /> },
  // No `identities/:identityId` row: an identity is edited in a modal, so main's copy says
  // `identities: false`. The old `agents` segment redirects (`RENAMED_PAGES`).
  { path: "identities", label: "Identities", element: <IdentitiesPage /> },
  { path: "knowledge", label: "Knowledge", element: <KnowledgePage /> },
  { path: "knowledge/:kbSlug", label: "Knowledge base", element: <KnowledgeDetailPage /> },
  { path: "skills", label: "Skills", element: <SkillsPage /> },
  { path: "skills/:skillSlug", label: "Skill", element: <SkillDetailRedirect /> },
  { path: "ontology", label: "Ontology", element: <OntologyPage /> },
  { path: "ontology/:ontologySlug", label: "Ontology", element: <OntologyDetailPage /> },
  { path: "chats", label: "Chats", element: <ChatsPage /> },
  { path: "members", label: "Members", element: <MembersPage /> },
  { path: "settings", label: "Settings", element: <SettingsPage /> },
];

/**
 * Renamed page segments, old → new: the old path redirects so bookmarks still land. Not in
 * `WORKSPACE_PAGES` (it is not a page, and the deep-link drift test reads that table). Main's copy:
 * `deep-link-target.js › RENAMED_PAGES`, pinned equal in `routes.test.tsx`.
 */
export const RENAMED_PAGES: Readonly<Record<string, string>> = { agents: "identities" };

/** The workspace index redirect target — every "go home" funnel lands here. */
export const WORKSPACE_HOME_PATH = "overview";

/** The pop-out thread window's segment; `main/popout-window.js › THREAD_WINDOW_PAGE` is a hand copy
 *  pinned by `test/popout-window.test.mjs`. */
export const THREAD_WINDOW_PATH = "thread-window";

/** The agent window's segment; `main/agent-window.js › AGENT_WINDOW_PAGE` is a hand copy pinned by
 *  `test/agent-window.test.mjs`. */
export const AGENT_WINDOW_PATH = "agent-window";

export const routes: RouteObject[] = [
  {
    // Runs before a workspace exists. A static segment outranks the param route.
    path: "/onboarding",
    element: <OnboardingPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // The account surface: no workspace, so it mounts its own frame, not `AppShellLayout`.
    // Main's copy: `deep-link-target.js › ROOT_ROUTES`.
    path: HOME_PATH,
    element: <HomePage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // Workspace-scoped but outside `AppShellLayout` (one thread, no app chrome). The thread
    // window and the agent window below are in neither `WORKSPACE_PAGES` nor main's `ROOT_ROUTES`
    // on purpose: a `dopl://` link must not open a bare window — main creates and registers them.
    path: `/:workspaceSegment/${THREAD_WINDOW_PATH}/:channelId`,
    element: <ThreadWindowPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // The agent window (F-212): same shape as the thread window; the agent rides `?thread=`.
    path: `/:workspaceSegment/${AGENT_WINDOW_PATH}/:channelId`,
    element: <AgentWindowPage />,
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
      ...Object.entries(RENAMED_PAGES).map(([from, to]) => ({
        path: from,
        element: <Navigate to={`../${to}`} replace />,
      })),
    ],
  },
  {
    // No workspace in the URL: boot resolves signed-out / onboarding / the default workspace.
    path: "/",
    element: <BootPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: "*",
    element: <PlaceholderPage title="Not found" note="No route matches this URL." />,
  },
];
