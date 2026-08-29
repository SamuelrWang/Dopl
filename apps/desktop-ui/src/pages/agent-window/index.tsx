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
  // ⚠ WHICH INSTANCE (2026-08-22). `(channel, thread)` names a GROUP of this
  // operator's agents since multiplayer, so the pair alone lands on whichever the
  // feed lists first. Read here NOW, ahead of main emitting it, so the window
  // becomes exact with no second change on this side; absent, it degrades to the
  // pair exactly as it did before.
  const agentId = search.get("agent");

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
        agentId={agentId}
        currentUserId={access.currentUserId}
      />
    </Frame>
  );
}

/**
 * The window ground.
 *
 * ⚠ `shell.windowSurface`, NOT `shell.surface` (Samuel, 2026-08-27). `.surface` carries the main
 * window's 8px radius and its margin on all four sides, which inside a pop-out painted a rounded
 * panel floating on `.root`'s gray — a second background and a second set of corners inside an OS
 * window that already has its own. The pop-out's viewport IS the panel.
 *
 * ⚠ `shell.root` STAYS, and it is not the layer that was showing: it supplies the fixed inset,
 * the font stack, the box-sizing reset and the overflow clip. It paints the shell gray, which
 * `windowSurface` now covers edge to edge.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={shell.root}>
      <div className={shell.body}>
        <div className={shell.windowSurface}>{children}</div>
      </div>
    </div>
  );
}
