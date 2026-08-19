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
import ThreadWindowPage from "#/pages/thread-window";

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
 * RETIRED (2026-08-07), then DELETED (2026-08-11): `canvas`, `canvas2`,
 * `configuration`, `workflows` and `workflows/:slug` are gone from this table
 * AND their page components are gone from the tree. There is nothing left to
 * restore behind those five paths, and their rows must stay absent all the
 * same — a re-added row would now resolve to nothing. Adding any page back
 * means a row here, a `NavSection` + `NAV` row in
 * `src/shared/layout/app-shell/app-sidebar-core.tsx`, and the hand copy in
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
  // ⚠ THE NOTIFICATION'S LANDING ROUTE (wiring plan Phase 9). A clicked request
  // notification focuses the app and navigates HERE, naming the channel the
  // request was made in; the page threads `:channelId` into the channels core's
  // initial selection. Both rows are `channels` since the CUTOVER (Phase 12,
  // 2026-08-18) — until then the pair lived behind a temporary `channels-v2`
  // path beside a `channels` row that had no detail view. The hand copy in
  // `dopl-desktop-app/main/deep-link-target.js › WORKSPACE_PAGES` carries
  // `channels: true` for exactly this row (INVARIANTS §11), and
  // `main/shell-mode.js › CHANNELS_PAGE` is the one string main navigates to.
  { path: "channels/:channelId", label: "Channel", element: <ChannelsPage /> },
  { path: "members", label: "Members", element: <MembersPage /> },
  { path: "settings", label: "Settings", element: <SettingsPage /> },
];

/** The workspace index redirect target — every "go home" funnel lands here. */
export const WORKSPACE_HOME_PATH = "overview";

/**
 * THE POP-OUT THREAD WINDOW'S PAGE SEGMENT (Samuel, 2026-08-19) — one string, so
 * the SPA and `dopl-desktop-app/main/popout-window.js › THREAD_WINDOW_PAGE` name
 * one route. `test/popout-window.test.mjs` reads this export and fails on drift;
 * main cannot import TypeScript, so the copy over there is a hand copy like
 * `deep-link-target.js`'s page table.
 */
export const THREAD_WINDOW_PATH = "thread-window";

export const routes: RouteObject[] = [
  {
    // Runs BEFORE a workspace exists — deliberately outside
    // /:workspaceSegment. Static segment outranks the param route.
    path: "/onboarding",
    element: <OnboardingPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    // ⚠ WORKSPACE-SCOPED BUT OUTSIDE `AppShellLayout`, WHICH IS THE POINT. The
    // pop-out window shows ONE thread — no app sidebar, no channels tree, no
    // info panel — and a layout route cannot be opted out of from inside it, so
    // this is a sibling of `/:workspaceSegment` rather than a child. The channel
    // rides the path and the thread rides `?thread=`, exactly as the pop-out's
    // old landing did.
    //
    // ⚠ IT IS **NOT** IN `WORKSPACE_PAGES` AND MUST NOT BE ADDED TO IT, and it
    // is not in `main/deep-link-target.js › ROOT_ROUTES` either, unlike
    // `/onboarding`. Both absences are the same decision: a `dopl://` link must
    // not be able to open a bare thread window — a pop-out is created by MAIN,
    // at a window main built and registered. An unknown page inside a real
    // workspace opens that workspace's home page, which is where such a link
    // lands. The deep-link drift test reads the `WORKSPACE_PAGES` block only, so
    // a row HERE keeps it green by construction.
    path: `/:workspaceSegment/${THREAD_WINDOW_PATH}/:channelId`,
    element: <ThreadWindowPage />,
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
