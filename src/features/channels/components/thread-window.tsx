"use client";

/**
 * THE POP-OUT THREAD WINDOW'S SURFACE — ONE thread, and nothing else (Samuel,
 * 2026-08-19).
 *
 * ⚠ WHAT THIS REPLACES: the pop-out shipped 2026-08-18 landing on the FULL
 * channels page, so a window opened to read one exchange arrived carrying the app
 * sidebar, the tree and the info panel. This is the transcript, the composer and
 * the thread's title — nothing else.
 *
 * ⚠ NOT A SECOND TRANSCRIPT. It mounts `message-pane.tsx` with `chrome="window"`,
 * so there is one implementation of "read a thread and reply to it"; this file
 * adds only which reads to issue and what the window is called.
 *
 * ⚠ REALTIME IS REGISTERED HERE, AND IT HAS TO BE (INVARIANTS §7). `useChannelsLive`
 * is the SAME hook the three-column core takes, so this window holds one
 * `useRefetchGate` across its reads and writes; the doorbell reaches it because a
 * pop-out is a REGISTERED app window (`main/ui-sync.js › sendToWindows`, Phase 10).
 *   ⚠ F-222 still applies: the feed watches ONE workspace and `dopl:sync-watch`
 *   is last-writer-wins across windows, so switching workspaces in the MAIN
 *   window leaves this one unwatched.
 *
 * ⚠ THE THREAD IS DERIVED FROM THE CHANNEL'S THREAD LIST, never assumed: an id not
 * in the bounded list renders the empty state, there being no channel view here to
 * fall back to. ⚠ ROUTER-FREE, like the rest of this tree — the SPA page owns the
 * params and hands them down as plain props.
 */

import { useEffect, useMemo, useState } from "react";
import { MessageSquareOff } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { TranscriptSkeleton } from "@/shared/ui/skeleton";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CONSENT_INBOX_POLL_MS } from "../constants";
import { useChannelMessages } from "../hooks/use-channel-messages";
import { useChannelMembers } from "../hooks/use-channel-members";
import { useChannelThreads } from "../hooks/use-channel-threads";
import { useChannelAgentSessions } from "../hooks/use-channel-agent-sessions";
import { liveAgentsFromKey, liveAgentsKey } from "../lib/live-agents";
import { agentColorVar } from "@/shared/lib/agent-colors";
import { useConsentInbox } from "../hooks/use-consent-inbox";
import { useChannelPreferenceWrites } from "../hooks/use-channel-preference-writes";
import { ChannelsMessagePane, type ScrollTarget } from "./message-pane";
import { useMessageJump } from "./use-message-jump";
import { useChannelsLive } from "./live";
import { indexMembers } from "./view-model";
import { threadRows } from "./view-model-rows";
import { useInlineConsent } from "./use-inline-consent";
import { PEER_SESSIONS_POLL_MS } from "./use-agents-panel";
import { PeerActivityRow, peerWorkingOn } from "./peer-activity";
import { AgentActivityRows, ownAgentsWorking } from "./agent-activity";
import { useDesktopSessions } from "./use-desktop-sessions";

/** The window's name, as one function so the fallback and the loaded title are one
 *  rule. ⚠ The em-dash spelling is the product's ("Dopl — <thread>"), and
 *  `main/popout-window.js` carries the bare "Dopl" as the PRE-PAINT title. */
export function threadWindowTitle(threadTitle: string | null): string {
  return threadTitle ? `Dopl — ${threadTitle}` : "Dopl";
}

/**
 * Name the WINDOW, from the renderer. ⚠ MAIN CANNOT DO THIS: it creates the window
 * from `(segment, channelId, threadId)` and has no thread title, which lives behind
 * an authenticated read the renderer is already making. Electron's default
 * `page-title-updated` handling copies `document.title` onto the window, so writing
 * the document title IS setting the window title. Harmless in a browser tab.
 */
function useWindowTitle(threadTitle: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = threadWindowTitle(threadTitle);
    // Restore on unmount: a shared document in dev (one Vite page, hash routing),
    // and a window that navigates away must not keep the old name.
    return () => {
      document.title = previous;
    };
  }, [threadTitle]);
}

export function ChannelsThreadWindow({
  workspaceId,
  channelId,
  threadId,
  currentUserId,
}: {
  workspaceId: string;
  channelId: string;
  /** The `?thread=` selection main landed this window on; `null` names nothing. */
  threadId: string | null;
  currentUserId: string;
}) {
  const {
    messages,
    loading: messagesLoading,
    stale: messagesStale,
    refetch: refetchMessages,
  } = useChannelMessages(channelId, workspaceId);
  const { members, refetch: refetchMembers } = useChannelMembers(
    channelId,
    workspaceId
  );
  const {
    threads,
    loading: threadsLoading,
    refetch: refetchThreads,
  } = useChannelThreads(channelId, workspaceId);

  // ONE coordinator, both ends — the reads register the doorbell through it and
  // the composer's writes settle into it (INVARIANTS §7/§8).
  const { gate } = useChannelsLive({
    workspaceId,
    refetchAll: () => {
      void refetchMessages();
      void refetchMembers();
      void refetchThreads();
    },
    refetchMembers: () => void refetchMembers(),
    // No tasks read here, so a tasks-only doorbell has nothing to refetch.
    refetchTasks: () => {},
  });

  // The SEND BOX's whole diet: a draft this operator's agent is holding on the
  // popped-out thread must be sendable here, not one window switch away. Same
  // poll and same CAS'd mutation the main page uses.
  //
  // ⚠ `outbound` ONLY (Samuel, 2026-08-22) — the INBOUND lane is deleted.
  const { outbound: requests } = useConsentInbox(
    workspaceId,
    channelId,
    CONSENT_INBOX_POLL_MS
  );
  const { consent } = useChannelPreferenceWrites({ workspaceId, gate });
  const { outboundByThread, decideOutbound, consentBusy } = useInlineConsent({
    messages,
    requests,
    consent,
  });

  // EVERY member's session state for this channel — the peer-activity row above
  // the composer (2026-08-20). ⚠ THIS WINDOW NEEDS ITS OWN READ: the core's poll
  // is a different React tree in a different BrowserWindow, and a pop-out that
  // inherited nothing would render no indicator and report no reason (INVARIANTS
  // §11). `channel_sessions` is unpublished (§7), so it polls, on the SAME
  // exported interval the core uses.
  const { sessions: peerSessions } = useChannelAgentSessions(
    channelId,
    workspaceId,
    PEER_SESSIONS_POLL_MS
  );
  /**
   * ⚠ **THE POP-OUT'S @-PICKER GETS THE SAME UNION THE MAIN PANE DOES (2026-09-13)** —
   * the poll above PLUS this machine's own session feed, which is a PUSH subscription
   * and adds no read (`use-desktop-sessions.ts`; `null` in a plain browser, which this
   * window is not). Without the own half an agent launched seconds ago is un-taggable
   * here for a full `PEER_SESSIONS_POLL_MS`, which is the defect
   * `lib/live-agents.ts › liveAgentsKey` exists for — and a window that offered a
   * different set from the pane behind it would be the second answer INVARIANTS §5
   * forbids.
   */
  const { sessions: ownSessions } = useDesktopSessions();
  const liveAgentsContentKey = liveAgentsKey(peerSessions, ownSessions, channelId);
  const liveAgents = useMemo(
    () => liveAgentsFromKey(liveAgentsContentKey),
    [liveAgentsContentKey]
  );
  /**
   * **EACH LIVE AGENT'S PAINT, BY ID** — the working strip's fills, MIRRORED FROM
   * `channel-surface.tsx` (release review, 2026-10-11).
   *
   * ⚠ **IT IS THE SAME MEMO OVER THE SAME SET, and that identity is the point.** Both
   * hosts resolve from `liveAgents`, the peer ∪ own union this window already holds, so
   * one agent cannot be two hues depending on which window the operator is looking at.
   * `lib/agent-colors.ts › agentColorVar` stays the one place a key becomes a `var()`.
   * ⚠ **AN AGENT WITH NO COLOUR IS ABSENT RATHER THAN MAPPED TO A FALLBACK** — the
   * component owns what "no colour" looks like (`agent-bits.tsx › AGENT_PILL_FACE`'s
   * black), and two places choosing that face is how one agent comes to wear two greys.
   * ⚠ MEMOISED ON THE SET'S OWN IDENTITY: `liveAgents` is already derived from a stable
   * key above, so this rebuilds only when the live set really moves.
   */
  const workingColors = useMemo(() => {
    const out = new Map<string, string>();
    for (const agent of liveAgents) {
      if (agent.color) out.set(agent.name, agentColorVar(agent.color));
    }
    return out;
  }, [liveAgents]);
  const index = useMemo(
    () => indexMembers(members, currentUserId),
    [members, currentUserId]
  );
  const thread = threadId
    ? (threads.find((t) => t.id === threadId) ?? null)
    : null;
  const rows = useMemo(
    () =>
      thread
        ? threadRows(messages, thread.id, index, formatChannelTimestamp)
        : [],
    [messages, thread, index]
  );

  useWindowTitle(thread?.title ?? null);

  /**
   * 🔒 **THE CITATION JUMP, IN THE POP-OUT — ONE MECHANISM, A LOCAL SIGNAL**
   * (grammar B, 2026-10-12).
   *
   * ⚠ **THIS WINDOW USED TO HAND NO `onJumpToSeq` AT ALL**, so every citation in
   * it rendered as plain text by the absent-not-disabled rule — correct while
   * nothing could move the transcript, and a dead end once a pill became the only
   * way a reader reaches a cited message. Under grammar B that is the whole
   * affordance, and a pop-out is where one exchange is read most closely.
   *
   * ⚠ **THE RESOLVER AND THE LANDING ARE THE SHARED ONES** — `useMessageJump`
   * (which owns `citationScrollTargetId` and the `seq:<n>` miss sentinel) and
   * `message-pane.tsx`'s landing, including the page-back hunt. Only the SIGNAL is
   * local, and it has to be: the nonced `scrollTarget` lives in
   * `use-channels-selection.ts`, which belongs to the main surface's two columns
   * and is not mounted here. Same shape, same nonce discipline — asking twice
   * must ask twice.
   *
   * ⚠ **ABOVE THE EARLY RETURNS, DELIBERATELY.** Both branches below return before
   * the pane renders, and a hook called after them would be a conditional hook.
   */
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);
  const jumpToSeq = useMessageJump({
    rows,
    // A pop-out IS one exchange, so the thread never changes under the jump.
    openThreadId: thread?.id ?? null,
    channelId,
    jumpToMessage: (_threadId, messageId) =>
      setScrollTarget((prev) => ({ messageId, nonce: (prev?.nonce ?? 0) + 1 })),
  });

  // ⚠ The thread list has to have LANDED before "no such thread" is an honest
  // answer.
  if (threadsLoading) {
    return (
      <div className="page-float flex flex-col antialiased">
        <TranscriptSkeleton />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="page-float flex flex-col antialiased">
        <EmptyState
          icon={MessageSquareOff}
          title="That thread isn't here"
          description="It may have been deleted, or it is older than this channel's loaded history. Open the channel in the main window to find it."
        />
      </div>
    );
  }

  return (
    <div className="page-float flex antialiased">
      <ChannelsMessagePane
        chrome="window"
        channelId={channelId}
        workspaceId={workspaceId}
        channelName={thread.title}
        thread={thread}
        rows={rows}
        index={index}
        members={members}
        loading={messagesLoading}
        // The scroller's rule 1 (`use-stick-to-bottom.ts`). This window never switches
        // channels, so it is all but always false; passing it keeps ONE contract.
        stale={messagesStale}
        outboundAsk={thread ? (outboundByThread.get(thread.id) ?? null) : null}
        outboundBusy={consentBusy}
        onDecideOutbound={decideOutbound}
        scrollTarget={scrollTarget}
        onJumpToSeq={jumpToSeq}
        // ⚠ THE SAME POLL THIS WINDOW ALREADY MAKES for the peer-activity row, UNIONED with this
        // machine's own feed (2026-09-13 — see `liveAgents` above), so the pop-out's composer
        // offers the same @-chips the main pane does (2026-09-02, slice B10).
        // ⚠ **THIS SURFACE'S RECIPIENT LINE IS EXACT AGAIN AS OF 2026-09-07 (items 10 and 11).**
        // It used to state one arm fewer, reading a THREAD and never the channel row that carried
        // `defaultResponderAgentName`. The replacement setting is PER MEMBER and lives on the
        // roster this window already loads (`useChannelMembers`), so there is nothing to hand
        // over — and had it stayed a prop, the omission would now OVERSTATE.
        liveAgents={liveAgents}
        /**
         * 🔴 **MY OWN AGENTS MID-TURN — THE POP-OUT DREW NONE, AND THE PROP WAS SIMPLY
         * NEVER THREADED** (release review, 2026-10-11).
         *
         * ⚠ **NOT A PROVIDER PROBLEM.** `message-pane.tsx` has taken
         * `agentActivity?: ReactNode` and fed it to `ComposerRecipients`'s `working=` since
         * the strip landed, and `channel-surface.tsx` supplied it — this file omitted it, so
         * the one surface dedicated to ONE exchange was the surface that could not say an
         * agent was working on it. The window already holds both halves it needs: the
         * desktop feed (`ownSessions`, a PUSH subscription — no second read) and the colours
         * resolved above.
         * ⚠ **SCOPED TO THIS THREAD, NOT THE CHANNEL** — `ownAgentsWorking`'s third argument.
         * A pop-out is ONE exchange by construction (this file's header), so a channel-wide
         * strip here would report agents working somewhere the reader cannot see.
         * ⚠ **`null` SESSIONS RENDER NOTHING**: in a plain browser `useDesktopSessions`
         * answers "could not ask" and `ownAgentsWorking` returns `[]`, which the component
         * draws as nothing — never a placeholder (INVARIANTS §11).
         */
        agentActivity={
          <AgentActivityRows
            agents={ownAgentsWorking(ownSessions, channelId, thread.id)}
            colors={workingColors}
          />
        }
        peerActivity={
          <PeerActivityRow
            peers={peerWorkingOn(peerSessions, currentUserId, thread.id)}
            byUser={index.byId}
            currentUserId={currentUserId}
          />
        }
        gate={gate}
      />
    </div>
  );
}
