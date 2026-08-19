import { useParams, useSearchParams } from "react-router";
import { ChannelsV2ThreadWindow } from "@/features/channels/components/channels-v2/thread-window";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/thread-window/:channelId?thread=` — THE POP-OUT THREAD
 * WINDOW'S PAGE (Samuel, 2026-08-19).
 *
 * ⚠ IT IS DELIBERATELY OUTSIDE `AppShellLayout`, and that is the whole point of
 * the route existing at all. The pop-out landed on the channels page until now,
 * so a window opened to read ONE thread arrived with the app sidebar, the
 * channels tree and the info panel — every surface the operator already had open
 * behind it. A layout route cannot be opted out of from inside, so the
 * thread-only surface needs a row of its own, as `/onboarding` does.
 *
 * ⚠ AND IT IS NOT DEEP-LINKABLE, ON PURPOSE. `main/deep-link-target.js ›
 * ROOT_ROUTES` carries `onboarding` precisely so a `dopl://` link can reach it;
 * this route is deliberately absent from that table AND from `WORKSPACE_PAGES`,
 * so `dopl://open/{segment}/thread-window/{id}` resolves as an unknown page
 * inside a real workspace and opens that workspace's home page. **A pop-out is
 * created by MAIN, at a window it made itself** (`main/popout-window.js`); a
 * grammar that could mint bare thread windows from an arbitrary caller's URL
 * would be a new surface, not a shortcut. `test/deep-link-target.test.mjs` pins
 * the degradation.
 *
 * ⚠ ONLY A SEAM, like `pages/channels/index.tsx`: it resolves the workspace and
 * hands over. `useWorkspaceAccess` reads `useWorkspaceRoute`, which is
 * `useParams` plus one cached `POST /api/boot` and needs no layout context — so
 * this page pays the same single read the shell does, and no more.
 *
 * The shell's own `root`/`body`/`surface` classes are reused for the window
 * chrome (the gray page ground the `.page-float` card floats on), MINUS the
 * sidebar that normally sits inside `surface`. Forking those three rules locally
 * would be a second statement of the app's ground.
 */
export default function ThreadWindowPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  const { channelId } = useParams<{ channelId: string }>();
  const [search] = useSearchParams();
  const threadId = search.get("thread");

  // 401 in a window with no shell around it is still a dead session, and the
  // signed-out screen is the only honest thing to show.
  if (isUnauthorized(error)) return <Frame><SignedOutScreen /></Frame>;
  if (error) {
    return (
      <Frame>
        <PageError error={error} onRetry={refetch} />
      </Frame>
    );
  }
  if (isPending || !access || !channelId) {
    return (
      <Frame>
        <PageLoading label="Loading thread" />
      </Frame>
    );
  }

  return (
    <Frame>
      <ChannelsV2ThreadWindow
        workspaceId={access.workspaceId}
        channelId={channelId}
        threadId={threadId}
        currentUserId={access.currentUserId}
      />
    </Frame>
  );
}

/** The window ground: the app shell's surface stack with no sidebar in it. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={shell.root}>
      <div className={shell.body}>
        <div className={shell.surface}>{children}</div>
      </div>
    </div>
  );
}
