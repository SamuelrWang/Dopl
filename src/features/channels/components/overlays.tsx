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
 * 🔒 **THE AGENT PANE IS `surface-agent-view.tsx`, NOT A SECOND WIRING OF
 * `agent-panel.tsx` (wave 1A, 2026-09-17 — parity audit 08 § F1).** This file
 * hand-forwarded the panel's twelve props from `channels-core.tsx`, and the copy
 * had already drifted: it passed **no `color`**, so the per-member agent colour
 * the server assigns — a SHIPPED ruling since 2026-09-13
 * (`docs/specs/agent-colors.md`) — was rendered on /home, on the guest lane and on
 * the web's single column, and never once on the workspace channels page.
 * `SurfaceAgentView` derives every one of those props from `ChannelSurfaceData`,
 * which this page already mounts, so the drift is not fixable-in-place: it is
 * DELETED by there being one wiring. ⚠ **THE MOUNT POSITION IS UNCHANGED** — the
 * view still renders here, outside the `channel ? …` arm, which is the half of
 * this file that genuinely differs in kind from `channel-surface-standalone.tsx`'s.
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
  /**
   * THE SURFACE'S ONE READ, mounted by `channels-core.tsx` (INVARIANTS §7).
   * ⚠ IT REPLACED NINE HAND-FORWARDED PROPS — `agentSessions`, `messages`,
   * `pendingPosts`, `onPostPending`, `onAnswerEscalation`, `answerBusy`,
   * `postBusy`, `onRefreshSessions` and the panel's missing `color` — every one
   * of which `surface-agent-view.tsx` reads off this object.
   */
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
      {/* ⚠ NO `full`: the workspace page has no single-column layout, so the
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
