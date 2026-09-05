"use client";

/**
 * THE PER-CHANNEL SURFACE, PINNED TO ONE CHANNEL AND MOUNTABLE ANYWHERE — the
 * full channels-v2 experience (header, transcript, composer, the Info / Threads /
 * Agents / Settings column, the agent view) for a container the caller already
 * knows, with no channel tree beside it and no app shell around it.
 *
 * ⚠ IT IS A HOST, WHICH IS THE WHOLE REASON IT EXISTS. `channel-surface.tsx`
 * renders and does not fetch; the reads, the derivations and — the part that
 * cannot be forgotten — the ONE refetch coordinator are `channel-surface-data.ts`,
 * and a surface that mounts without registering it fails with NO ERROR SHAPE
 * (INVARIANTS §7: the transcript stops updating and nothing anywhere says so).
 * This file is the second host of that hook; `channels-v2-core.tsx` is the first.
 * **There is no third code path for the live loop.**
 *
 * ⚠ SELECTION IS LOCAL AND THREAD-ONLY. `use-channels-v2-selection.ts` carries
 * eight pieces of "which surface am I looking at"; here the channel is FIXED, so
 * the ones this surface moves are the open thread, the info toggle, the open
 * agent and the scroll signal. Nothing routes: the tree's channel pick, the
 * create dialogs have no host here. (The Inbox takeover is deleted outright —
 * 2026-08-25, Samuel; the outbound review is the work stream's card.)
 *
 * ⚠ NOTHING FROM THE APP SHELL. No workspace-access context, no router, no
 * layout provider — every fact arrives as a prop, exactly as it does on the
 * workspace page. The one ambient requirement is a TanStack `QueryClientProvider`,
 * which every read hook in this tree needs and which the app root already mounts.
 */

import { cn } from "@/shared/lib/utils";
import type { Role } from "@/features/workspaces/types";
import { ChannelSurface } from "./channel-surface";
import { SurfaceAgentView } from "./surface-agent-view";
import { useChannelSurfaceData } from "./channel-surface-data";
import { useChannelsV2Selection } from "./use-channels-v2-selection";
import type {
  ChannelSurfaceCapabilities,
  ChannelSurfaceSlots,
} from "./channel-surface";
import type { ChannelWebView } from "./use-channel-web-view";
import type { Channel } from "../../types";

export function StandaloneChannelSurface({
  workspaceId,
  workspaceSlug = "",
  channel,
  currentUserId,
  role = "member",
  initialThreadId = null,
  onDeleted,
  slots,
  capabilities,
  webView,
  className,
}: {
  workspaceId: string;
  /**
   * The workspace SEGMENT, for the pop-out's route and the agent window's.
   * Defaulted so a caller with no segment in hand still mounts — main degrades an
   * unusable one rather than refusing — but a desktop host that wants a working
   * pop-out has to pass the real slug.
   */
  workspaceSlug?: string;
  /** The container this surface is pinned to, already resolved by the caller. */
  channel: Channel;
  currentUserId: string;
  /**
   * The viewer's WORKSPACE role, which gates the manage half of the Settings tab
   * alongside the channel's own `role`. Defaults to the least-privileged answer:
   * a host that does not know cannot be the one to widen it.
   */
  role?: Role;
  initialThreadId?: string | null;
  /**
   * The Settings tab deleted this channel. ⚠ THE HOST HAS TO ACT ON IT: the
   * channel is a PROP here, so nothing below can stop rendering a row the server
   * no longer has. The workspace page answers this by clearing its selection;
   * a pinned host has to drop or replace the container itself.
   */
  onDeleted?: () => void;
  slots?: ChannelSurfaceSlots;
  capabilities?: ChannelSurfaceCapabilities;
  /**
   * THE **WEB** CHANNEL PAGE'S ONE-COLUMN LAYOUT (Samuel, 2026-09-04) — passed
   * only by `src/app/c/[workspaceId]/guest-channel.tsx`, which owns the state
   * because it lives in the URL. Absent is every desktop mount.
   *
   * ⚠ IT MOVES THE AGENT VIEW INSIDE THE SURFACE. On one column the agent
   * REPLACES the main area under the shared header, so the surface renders it;
   * the overlay below is the two-column answer and would cover that header.
   */
  webView?: ChannelWebView;
  className?: string;
}) {
  const sel = useChannelsV2Selection({
    initialChannelId: channel.id,
    initialThreadId,
  });
  const data = useChannelSurfaceData({
    workspaceId,
    channel,
    currentUserId,
    openThreadId: sel.requestedThreadId,
    // ⚠ THE SAME OBJECT THAT REACHES `ChannelSurface` BELOW. A capability that
    // hides a control while its read keeps firing is half a capability — the
    // guest lane's `selfManagement: false` has to reach the consent poll, not
    // only the Settings block it renders. (2026-08-26.)
    capabilities,
  });

  return (
    // `relative` is the agent view's containing block — it is absolutely
    // positioned against this surface, and without a positioned ancestor here it
    // escapes to whatever the host page happens to have.
    <div className={cn("relative flex min-h-0 flex-1", className)}>
      <ChannelSurface
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        channel={channel}
        currentUserId={currentUserId}
        role={role}
        data={data}
        selection={sel}
        onDeselect={onDeleted}
        slots={slots}
        capabilities={capabilities}
        webView={webView}
      />
      {/* THE AGENT VIEW AS A 380px OVERLAY — the two-column answer, and the
          `webView` docblock above says why the one-column layout renders its
          own instead of this one. */}
      {!webView && (
        <SurfaceAgentView
          data={data}
          openAgent={sel.openAgent}
          onClose={() => sel.setOpenAgent(null)}
          currentUserId={currentUserId}
          workspaceSlug={workspaceSlug}
        />
      )}
    </div>
  );
}
