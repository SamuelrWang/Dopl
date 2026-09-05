"use client";

/**
 * THE AGENT VIEW, WIRED TO A SURFACE — `agent-panel.tsx` plus the facts it
 * needs, all of which the surface's own read already holds.
 *
 * ⚠ EXTRACTED ON 2026-09-04 SO THE SECOND LAYOUT CAN MOUNT IT. It was inline in
 * `channel-surface-standalone.tsx`; the web's single-column layout renders the
 * agent view as the MAIN AREA rather than as an overlay to the right
 * (`channel-single-column.tsx`), and a second hand-copy of this wiring is how
 * the phone and the desktop come to show different things about one agent.
 * **Nothing inside changed in the move** — every ⚠ below is that file's.
 *
 * ⚠ IT FETCHES NOTHING. Every prop is read off `ChannelSurfaceData`, which the
 * HOST mounts once (INVARIANTS §7).
 */

import { ChannelsV2AgentPanel } from "./agent-panel";
import type { ChannelSurfaceData } from "./channel-surface-data";

export function SurfaceAgentView({
  data,
  openAgent,
  onClose,
  currentUserId,
  workspaceSlug,
  full = false,
}: {
  data: ChannelSurfaceData;
  /** `agents-model.ts › agentKey` of the open agent, or `null` for closed. */
  openAgent: string | null;
  onClose: () => void;
  currentUserId: string;
  workspaceSlug: string;
  /** Render as the main area instead of the 380px overlay — `agent-panel.tsx`. */
  full?: boolean;
}) {
  return (
    /* ⚠ The Sent lane reads the OPEN CHANNEL's transcript, so the panel takes
       `messages` rather than fetching: one read, and the panel cannot show a
       message the transcript beside it does not have. On the workspace page this
       same panel is `overlays.tsx`, beside the create dialogs it has no use for
       here. */
    <ChannelsV2AgentPanel
      openAgent={openAgent}
      sessions={data.agentSessions}
      messages={data.messages}
      // ⚠ THE POINT OF THE INLINE CARD, ON THIS HOST ESPECIALLY (Samuel,
      // 2026-08-25). A solo /home channel has no tree and never had the consent
      // Inbox beside it, so before the card a draft its agent held could not be
      // posted from ANYWHERE. The rows are the surface's own read — no second
      // fetch.
      pendingPosts={data.requests}
      onPostPending={(id) => data.decideOutbound(id, "allow")}
      // ANSWERING AN ESCALATION FROM THE AGENT PANE (2026-08-31). ⚠ THE SAME
      // MUTATION the transcript's own cards use — one write, one fence, one cache
      // patch. A second path here is how the two panes come to disagree about
      // whether a question was answered.
      onAnswerEscalation={data.answerEscalation}
      answerBusy={data.answerBusy}
      postBusy={data.consentBusy}
      currentUserId={currentUserId}
      workspaceSlug={workspaceSlug}
      full={full}
      onClose={onClose}
      onRefreshSessions={data.refreshAgents}
    />
  );
}
