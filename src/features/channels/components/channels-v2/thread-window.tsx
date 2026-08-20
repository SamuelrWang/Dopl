"use client";

/**
 * THE POP-OUT THREAD WINDOW'S SURFACE — ONE thread, and nothing else (Samuel,
 * 2026-08-19).
 *
 * ⚠ WHAT THIS REPLACES. The pop-out shipped on 2026-08-18 landing on the FULL
 * channels page (`/{segment}/channels/{channelId}?thread=`), so a window opened
 * to read one exchange arrived carrying the app sidebar, the channels tree and
 * the info panel — everything the operator already had in the window they popped
 * it out of. This surface is the transcript, the composer and the thread's title.
 * No app sidebar, no channels sidebar, no info panel, no nav.
 *
 * ⚠ NOT A SECOND TRANSCRIPT. It mounts `message-pane.tsx` with `chrome="window"`
 * — the same scroller, the same stick-to-bottom rules, the same composer — so
 * there is exactly one implementation of "read a thread and reply to it". The
 * only thing this file adds is which reads to issue and what the window is
 * called.
 *
 * ⚠ REALTIME IS REGISTERED HERE, AND IT HAS TO BE (INVARIANTS §7 — any new live
 * surface must). `useChannelsV2Live` is the SAME hook the three-column core
 * takes, so this window holds one `useRefetchGate` coordinator across its reads
 * and its composer's writes. The doorbell reaches it because a pop-out is a
 * REGISTERED app window and `main/ui-sync.js › sendToWindows` fans out over that
 * registry (Phase 10) — a window that renders a stale transcript with no error
 * anywhere is the failure mode INVARIANTS §11 names.
 *   ⚠ F-222 still applies: the feed watches ONE workspace and `dopl:sync-watch`
 *   is last-writer-wins across windows, so switching workspaces in the MAIN
 *   window leaves this one unwatched.
 *
 * ⚠ THE THREAD IS DERIVED FROM THE CHANNEL'S THREAD LIST, never assumed — the
 * same rule `channels-v2-core.tsx` keeps. A thread id that is not in the bounded
 * list (stale link, aged past the read's ceiling) renders the empty state; there
 * is no channel view here to fall back to, so it says so instead.
 *
 * ⚠ ROUTER-FREE, like every other file in this tree: the SPA page owns the
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
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { ChannelsV2MessagePane } from "./message-pane";
import { useChannelsV2Live } from "./live";
import { indexMembers } from "./view-model";
import { threadRows } from "./view-model-rows";
import { requestedThreadIds } from "./view-model-requested";
import { useInlineConsent } from "./use-inline-consent";

/**
 * The window's name, as one function so the fallback and the loaded title are
 * one rule. ⚠ The em-dash spelling is the product's ("Dopl — <thread>"), and
 * `main/popout-window.js` carries the bare "Dopl" as the PRE-PAINT title, so a
 * window that never finishes loading is still named.
 */
export function threadWindowTitle(threadTitle: string | null): string {
  return threadTitle ? `Dopl — ${threadTitle}` : "Dopl";
}

/**
 * Name the WINDOW, from the renderer.
 *
 * ⚠ MAIN CANNOT DO THIS. It creates the window from `(segment, channelId,
 * threadId)` and has no thread title — titles live behind an authenticated read
 * the renderer is already making. Electron's default `page-title-updated`
 * handling copies `document.title` onto the window, and `popout-window.js` does
 * not disable it, so writing the document title IS setting the window title.
 * Harmless in a browser tab, which is the other place this tree runs.
 */
function useWindowTitle(threadTitle: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = threadWindowTitle(threadTitle);
    // Restore on unmount: this is a shared document in dev (one Vite page, hash
    // routing), and a window that navigates away must not keep the old name.
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

  // The awaiting-strip's whole diet (Samuel, 2026-08-20): this window is a
  // decision surface like the in-page thread view — an undecided ask opened
  // here must be decidable here, not one window switch away. Channel-scoped
  // read, same poll the main page uses, same CAS'd consent mutation.
  const { requests } = useConsentInbox(
    workspaceId,
    channelId,
    CONSENT_INBOX_POLL_MS
  );
  const { consent } = useChannelPreferenceWrites({
    workspaceId,
    currentUserId,
    gate,
  });
  const { decideThread, outboundByThread, decideOutbound, consentBusy } =
    useInlineConsent({ messages, requests, consent });
  const requested = useMemo(
    () => requestedThreadIds(messages, requests),
    [messages, requests]
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
  // answer — until then this window knows nothing about the id it was handed.
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
        requested={requested}
        onDecideThread={decideThread}
        outboundAsk={thread ? (outboundByThread.get(thread.id) ?? null) : null}
        outboundBusy={consentBusy}
        onDecideOutbound={decideOutbound}
        scrollTarget={null}
        gate={gate}
      />
    </div>
  );
}
