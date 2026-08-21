import { useParams, useSearchParams } from "react-router";
import { ChannelsV2AgentWindow } from "@/features/channels/components/channels-v2/agent-window";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/agent-window/:channelId?thread=` — THE AGENT WINDOW'S PAGE
 * (2026-08-20, F-212's closure).
 *
 * ⚠ THE SEAM IS `pages/thread-window/index.tsx`'s, deliberately verbatim: resolve the
 * workspace, hand over, and own nothing else. Both windows are the same KIND of surface —
 * a second app window on this bundle, outside `AppShellLayout` — and the day one of them
 * grows a different auth or error shape is the day two windows disagree about what a 401
 * looks like.
 *
 * ⚠ WHY IT IS OUTSIDE THE APP SHELL. This window shows ONE agent. It has no sidebar, no
 * channels tree and no info panel, and a layout route cannot be opted out of from inside
 * it — the same argument that gave the pop-out its own top-level row.
 *
 * ⚠ AND IT IS NOT DEEP-LINKABLE, ON PURPOSE. Absent from both `WORKSPACE_PAGES` and
 * `main/deep-link-target.js › ROOT_ROUTES`, so `dopl://open/{segment}/agent-window/{id}`
 * resolves as an unknown page inside a real workspace and opens that workspace's home
 * page. An agent window is created by MAIN, at a window it built and registered; a grammar
 * that could mint one from an arbitrary caller's URL would be a new surface, not a
 * shortcut.
 *
 * ⚠ `?thread=` IS THE AGENT'S OWN HALF OF ITS KEY. An agent is addressed as
 * (channel, thread) everywhere in this tree — never by `sessionId`, which a park+resume
 * re-mints — so the pair in this URL is the same pair `sessions.pause`, `sessions.end`,
 * `sessions.message` and the reopen path all take.
 */
export default function AgentWindowPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  const { channelId } = useParams<{ channelId: string }>();
  const [search] = useSearchParams();
  const taskId = search.get("thread");

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
        <PageLoading label="Loading agent" />
      </Frame>
    );
  }

  return (
    <Frame>
      <ChannelsV2AgentWindow
        workspaceId={access.workspaceId}
        channelId={channelId}
        taskId={taskId ?? ""}
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
