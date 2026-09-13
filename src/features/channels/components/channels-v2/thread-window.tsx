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
 * ⚠ REALTIME IS REGISTERED HERE, AND IT HAS TO BE (INVARIANTS §7). `useChannelsV2Live`
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

import { useEffect, useMemo } from "react";
import { MessageSquareOff } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { TranscriptSkeleton } from "@/shared/ui/skeleton";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CONSENT_INBOX_POLL_MS } from "../../constants";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { useChannelMembers } from "../../hooks/use-channel-members";
import { useChannelThreads } from "../../hooks/use-channel-threads";
import { useChannelAgentSessions } from "../../hooks/use-channel-agent-sessions";
import { liveAgentsFromKey, liveAgentsKey } from "../../lib/live-agents";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { ChannelsV2MessagePane } from "./message-pane";
import { useChannelsV2Live } from "./live";
import { indexMembers } from "./view-model";
import { threadRows } from "./view-model-rows";
import { useInlineConsent } from "./use-inline-consent";
import { PEER_SESSIONS_POLL_MS } from "./use-agents-panel";
import { PeerActivityRow, peerWorkingOn } from "./peer-activity";
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

export function ChannelsV2ThreadWindow({
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
  const { gate } = useChannelsV2Live({
    workspaceId,
    refetchAll: () => {
      void refetchMessages();
      void refetchMembers();
      void refetchThreads();
    },
    refetchMembers: () => void refetchMembers(),
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
      <ChannelsV2MessagePane
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
        scrollTarget={null}
        // ⚠ THE SAME POLL THIS WINDOW ALREADY MAKES for the peer-activity row, UNIONED with this
        // machine's own feed (2026-09-13 — see `liveAgents` above), so the pop-out's composer
        // offers the same @-chips the main pane does (2026-09-02, slice B10).
        // ⚠ **THIS SURFACE'S RECIPIENT LINE IS EXACT AGAIN AS OF 2026-09-07 (items 10 and 11).**
        // It used to state one arm fewer, reading a THREAD and never the channel row that carried
        // `defaultResponderAgentName`. The replacement setting is PER MEMBER and lives on the
        // roster this window already loads (`useChannelMembers`), so there is nothing to hand
        // over — and had it stayed a prop, the omission would now OVERSTATE.
        liveAgents={liveAgents}
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
