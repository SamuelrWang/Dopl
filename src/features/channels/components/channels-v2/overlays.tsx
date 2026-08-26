"use client";

/**
 * THE CHANNELS PAGE'S WORKSPACE-SCOPED OVERLAYS — the agent panel and the two
 * create dialogs.
 *
 * ⚠ ITS OWN FILE since 2026-08-20, on the seam F-226 named for this exact file
 * when `channels-v2-core.tsx` crossed the 500-line cap a second time. They are a
 * coherent group and they are the ONE group in that tree with no reads of its
 * own: everything here is handed down, so lifting it moves markup and changes
 * no data flow.
 *
 * ⚠ THEY MOUNT OUTSIDE THE CHANNEL BRANCH, which is the property worth keeping
 * whole in one place. A workspace with NO channel at all is exactly when "create
 * one" has to work, so these cannot live inside the `channel ? …` arm that
 * renders the three columns.
 */

import type { ChannelConsentRequest, ChannelMessage } from "../../types";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { Channel } from "../../types";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { ChannelsV2CreateDialogs } from "./channel-manage";

export function ChannelsV2Overlays({
  openAgent,
  agentSessions,
  messages,
  pendingPosts,
  onPostPending,
  postBusy,
  currentUserId,
  workspaceId,
  workspaceSlug,
  createOpen,
  directOpen,
  onCloseAgent,
  onRefreshSessions,
  onCreateOpenChange,
  onDirectOpenChange,
  onCreated,
}: {
  openAgent: string | null;
  agentSessions: readonly DesktopSessionSummary[] | null;
  /** The OPEN channel's transcript — the agent panel's Sent lane reads it. */
  messages: readonly ChannelMessage[];
  /** The viewer's PENDING outbound drafts — the Sent lane's held cards decide
   *  them in place (Samuel, 2026-08-25). Handed down like everything here. */
  pendingPosts: readonly ChannelConsentRequest[];
  onPostPending: (requestId: string) => void;
  postBusy: boolean;
  currentUserId: string;
  workspaceId: string;
  workspaceSlug: string;
  createOpen: boolean;
  directOpen: boolean;
  onCloseAgent: () => void;
  onRefreshSessions: () => void;
  onCreateOpenChange: (open: boolean) => void;
  onDirectOpenChange: (open: boolean) => void;
  onCreated: (created: Channel) => void;
}) {
  return (
    <>
      {/* ⚠ The Sent lane reads the OPEN CHANNEL's transcript, so the panel takes
          `messages` rather than fetching: one read, and the panel cannot show a
          message the transcript beside it does not have. */}
      <ChannelsV2AgentPanel
        openAgent={openAgent}
        sessions={agentSessions}
        messages={messages}
        pendingPosts={pendingPosts}
        onPostPending={onPostPending}
        postBusy={postBusy}
        currentUserId={currentUserId}
        workspaceSlug={workspaceSlug}
        onClose={onCloseAgent}
        onRefreshSessions={onRefreshSessions}
      />

      <ChannelsV2CreateDialogs
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
        createOpen={createOpen}
        directOpen={directOpen}
        onCreateOpenChange={onCreateOpenChange}
        onDirectOpenChange={onDirectOpenChange}
        onCreated={onCreated}
      />
    </>
  );
}
