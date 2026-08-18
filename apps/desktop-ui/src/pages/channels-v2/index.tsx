import { useParams } from "react-router";
import { ChannelsV2Core } from "@/features/channels/components/channels-v2/channels-v2-core";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * /:workspaceSegment/channels-v2 — and `/channels-v2/:channelId`, the SAME page
 * with a channel named — the three-column channels surface on REAL reads,
 * behind a temporary route while the shipping `#/pages/channels` page stays
 * live.
 *
 * ⚠ THE `:channelId` ROW IS THE DESKTOP NOTIFICATION'S LANDING SPOT (wiring
 * plan Phase 9). Main focuses the window and pushes
 * `/{segment}/channels-v2/{channelId}` over the navigate bridge; this file is
 * the ONLY place that reads the param, because `ChannelsV2Core` is Next-free
 * AND router-free by construction (it is imported by the web tree too). The
 * param is an INITIAL selection handed down as a plain prop — never a router
 * dependency inside the shared tree.
 *
 * ⚠ ONLY A SEAM, exactly like `#/pages/channels`. The whole tree is REUSED by
 * import from `@/features/channels/components/channels-v2/`, already client-side
 * over `apiRequest`, which transports over the Electron IPC bridge unchanged.
 * This file resolves the workspace and hands over; it owns no state and no
 * fetching. Until 2026-08-18 it WAS the page — three columns of fixtures — and
 * every one of those files (`mock-data.ts`, `mock-threads.ts`, `mock-agents.ts`,
 * `mock-mentions.ts`, `sidebar.tsx`, `message-pane.tsx`, `info-panel.tsx`,
 * `bits.tsx`, `composer.tsx`, `agents-tab.tsx`, `agent-panel.tsx`,
 * `mentions-list.tsx`) went with the port (wiring plan, Phase 2). `MAPPING.md`
 * stays: it is the intent document the port is judged against, and it moves
 * into INVARIANTS/ENGINEERING when the route is retired (Phase 13).
 *
 * REALTIME IS LIVE HERE, over the ui-sync DOORBELL rather than a websocket in
 * this renderer (CSP `connect-src 'none'`) — see the `#/pages/channels`
 * docblock and INVARIANTS §7 for the capability check and the table list. The
 * v2 core registers `useChannelsRealtime` + `usePresenceRealtime` through the
 * refetch coordinator, which §7 requires of any new live surface.
 *
 * The TEMPORARY "Channels v2" nav row (`AppSidebarCore` NAV), the routes.tsx
 * row, the deep-link table row and this folder all leave together when v2
 * becomes `channels`.
 */
export default function ChannelsV2Page() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();
  // Absent on the index row, which is the "no channel named" case the core
  // already answers with its own first-row fallback.
  const { channelId } = useParams<{ channelId: string }>();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) {
    return <PageLoading label="Loading channels" variant="two-pane" />;
  }

  return (
    <ChannelsV2Core
      workspaceId={access.workspaceId}
      currentUserId={access.currentUserId}
      initialChannelId={channelId ?? null}
    />
  );
}
