"use client";

/**
 * THE CHANNELS PAGE'S WORKSPACE-SCOPED OVERLAYS — the agent view and the two
 * create dialogs.
 *
 * ⚠ ITS OWN FILE since 2026-08-20, on the seam F-226 named for this exact file
 * when `channels-core.tsx` crossed the 500-line cap a second time. They are a
 * coherent group and they are the ONE group in that tree with no reads of its
 * own: everything here is handed down, so lifting it moves markup and changes
 * no data flow.
 *
 * ⚠ THEY MOUNT OUTSIDE THE CHANNEL BRANCH, which is the property worth keeping
 * whole in one place. A workspace with NO channel at all is exactly when "create
 * one" has to work, so these cannot live inside the `channel ? …` arm that
 * renders the three columns.
 *
 * 🔒 THE AGENT PANE IS `surface-agent-view.tsx`, NOT A SECOND WIRING OF
 * `agent-panel.tsx` (wave 1A, 2026-09-17). This file hand-forwarded the panel's
 * props and the copy had drifted: it passed no `color`, so the per-member agent
 * colour shipped 2026-09-13 rendered everywhere except the workspace channels
 * page. One wiring deletes the class rather than patching the instance.
 * ⚠ THE MOUNT POSITION IS UNCHANGED — outside the `channel ? …` arm, which is
 * what genuinely differs from `channel-surface-standalone.tsx`.
 */

import type { ChannelSurfaceData } from "./channel-surface-data";
import type { Channel } from "../types";
import { SurfaceAgentView } from "./surface-agent-view";
import { ChannelsCreateDialogs } from "./channel-manage";

export function ChannelsOverlays({
  data,
  openAgent,
  currentUserId,
  workspaceId,
  workspaceSlug,
  createOpen,
  directOpen,
  onCloseAgent,
  onCreateOpenChange,
  onDirectOpenChange,
  onCreated,
}: {
  /** THE SURFACE'S ONE READ, mounted by `channels-core.tsx` (INVARIANTS §7). */
  data: ChannelSurfaceData;
  /** `agents-model.ts › agentKey` of the open agent, or `null` for closed. */
  openAgent: string | null;
  currentUserId: string;
  workspaceId: string;
  workspaceSlug: string;
  createOpen: boolean;
  directOpen: boolean;
  onCloseAgent: () => void;
  onCreateOpenChange: (open: boolean) => void;
  onDirectOpenChange: (open: boolean) => void;
  onCreated: (created: Channel) => void;
}) {
  return (
    <>
      {/* ⚠ No `full`: the workspace page has no single-column layout, so the
          view is the 380px overlay every desktop mount renders. */}
      <SurfaceAgentView
        data={data}
        openAgent={openAgent}
        onClose={onCloseAgent}
        currentUserId={currentUserId}
        workspaceSlug={workspaceSlug}
      />

      <ChannelsCreateDialogs
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
