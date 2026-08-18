"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRefetchGate } from "@/shared/hooks/use-api-mutation";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CONSENT_INBOX_POLL_MS, PRESENCE_REFETCH_DEBOUNCE_MS } from "../../constants";
import { useChannels } from "../../hooks/use-channels";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { useChannelMembers } from "../../hooks/use-channel-members";
import { useChannelThreads } from "../../hooks/use-channel-threads";
import { useChannelMentions } from "../../hooks/use-channel-mentions";
import { useMentionWrites } from "../../hooks/use-mention-writes";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelsRealtime, usePresenceRealtime } from "../../client/realtime";
import { channelDisplayName } from "../../lib/channel-display";
import { ChannelsSkeleton } from "../channels-skeleton";
import { ChannelsV2Sidebar } from "./sidebar";
import { ChannelsV2MessagePane, type ScrollTarget } from "./message-pane";
import { ChannelsV2InfoPanel } from "./info-panel";
import { ChannelsV2InboxPane } from "./inbox-pane";
import { ChannelsV2AgentPanel } from "./agent-panel";
import type { ChannelMention } from "../../types";
import {
  channelRows,
  indexMembers,
  splitChannels,
  threadRows,
} from "./view-model";
import { requestedThreadIds, sidebarThreads } from "./view-model-requested";

export interface ChannelsV2CoreProps {
  workspaceId: string;
  currentUserId: string;
  /**
   * The channel a CALLER named, as an initial selection — the desktop's
   * `/channels-v2/:channelId` route hands its param down (wiring plan Phase 9).
   * A plain prop, deliberately: this tree is router-free, so the SPA page owns
   * the param read and this owns nothing but the selection.
   */
  initialChannelId?: string | null;
}

/**
 * Channels v2 root — the three-column shell (channel tree · transcript ·
 * channel info) over the REAL channels reads, plus a FOURTH center-column
 * destination — the Inbox (`inbox-pane.tsx`), behind the sidebar's Inbox nav
 * row. The shipping `channels-view-core.tsx` page stays untouched and live
 * until the cutover (wiring plan Phase 12).
 *
 * ⚠ NOT READ-ONLY ANY MORE (it was, through Phase 2). THREE writers land from
 * this tree, all through the existing write layer, none a new endpoint: the
 * composer's send / request fan-out (Phase 3), the Tags inbox's mark-read
 * (Phase 6), and the Inbox pane's consent decision (Phase 8). All hold the
 * same `useRefetchGate` gate the reads register.
 *
 * ⚠ NO PARALLEL HOOK LAYER AND NO AD-HOC FETCHES. Every read below is a feature
 * hook — `use-channels`, `use-channel-messages`, `use-channel-members`,
 * `use-channel-threads`, `use-consent-inbox`, and `use-channel-mentions`, the
 * one Phase 6 added because the Tags inbox is a genuinely new projection with
 * no existing read to adapt. Where a hook's shape did not fit (the sidebar's
 * 24h window, the transcript's sides, the thread parties) the adaptation is
 * `view-model.ts`, at the COMPONENT boundary, never a fork of the hook.
 *
 * ⚠ Next-free by construction so the desktop SPA can bundle it — the same
 * constraint `channels-view-core.tsx` documents. There is no `Link` prop
 * because nothing in this tree routes; the first-run explainer that needed one
 * is not part of the v2 surface.
 *
 * ⚠ REALTIME IS LIVE IN BOTH CLIENTS and this surface registers for it
 * (INVARIANTS §7 — any new live surface must). The SPA rides the ui-sync
 * DOORBELL rather than a websocket: `shared-channel-registry.ts ›
 * subscribeSharedWorkspaceTables` takes `› subscribeViaBridge` whenever the
 * preload exposes `onSyncEvent` + `syncWatch`, and `channels`,
 * `channel_members`, `channel_messages`, `channel_consent_requests` and
 * `agent_presence` are all in `dopl-desktop-app/main/ui-sync.js › SYNC_TABLES`.
 * The three docblocks that claimed otherwise were corrected 2026-08-18 (F-199).
 *
 * ⚠ The refetch rides `shared/realtime/refetch-coordinator.ts` through
 * `useRefetchGate`, which INVARIANTS §7 requires of every live surface — a
 * remote event mid-edit must not clobber an unsent local change. All three
 * writers hand their `settleWith` to this ONE gate — the composer (Phase 3),
 * the Tags inbox's mark-read (Phase 6) and the Inbox pane's consent decision
 * (Phase 8) — which is the whole point: a coordinator retrofitted after the
 * first write is a coordinator that was missing for exactly the window it was
 * needed.
 *
 * ⚠ AN EVENT IS A DOORBELL, NEVER CONTENT — the signal triggers a filtered
 * refetch and no payload is ever merged, so RLS and the service filters stay
 * authoritative.
 */
export function ChannelsV2Core({
  workspaceId,
  currentUserId,
  initialChannelId = null,
}: ChannelsV2CoreProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialChannelId);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  // The Inbox nav row takes over the CENTER column — it is a nav destination,
  // not an overlay, and Phase 9's notification click needs somewhere to land.
  const [inboxOpen, setInboxOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);

  // A SECOND notification, with the page already mounted, changes the route but
  // not the component — the initial `useState` above would never see it. So the
  // named channel is re-applied whenever it CHANGES, and only then: a value the
  // caller keeps handing us unchanged must not fight the operator's own clicks.
  // Going back to the paramless row (`initialChannelId` → null) names nothing
  // and therefore selects nothing; the current pick stands.
  //
  // ⚠ ADJUSTED DURING RENDER, NOT IN AN EFFECT — React's own "adjusting state
  // when a prop changes" shape, and `react-hooks/set-state-in-effect` is an
  // ERROR here (measured 2026-08-18), not a preference. The effect version
  // paints the OLD channel first and the named one on a second pass, which on
  // this surface is a visible flash of the wrong transcript. React re-runs this
  // component before committing anything, so the extra pass costs no DOM.
  const [routedId, setRoutedId] = useState<string | null>(initialChannelId);
  if (initialChannelId !== routedId) {
    setRoutedId(initialChannelId);
    if (initialChannelId) {
      setSelectedId(initialChannelId);
      setRequestedThreadId(null);
      setInboxOpen(false);
    }
  }

  const { channels, loading, refetch: refetchChannels } = useChannels(
    workspaceId,
    false
  );

  // Explicit pick that still exists wins, else the first row — the same rule
  // `channels-view-core.tsx` uses, so a deleted channel cannot strand the pane.
  const effectiveId = useMemo(() => {
    if (selectedId && channels.some((c) => c.id === selectedId)) return selectedId;
    return channels[0]?.id ?? null;
  }, [selectedId, channels]);
  const channel = channels.find((c) => c.id === effectiveId) ?? null;

  const {
    messages,
    loading: messagesLoading,
    refetch: refetchMessages,
  } = useChannelMessages(channel?.id ?? null, workspaceId);
  const { members, refetch: refetchMembers } = useChannelMembers(
    channel?.id ?? null,
    workspaceId
  );
  const {
    threads,
    truncated: threadsTruncated,
    loading: threadsLoading,
    refetch: refetchThreads,
  } = useChannelThreads(channel?.id ?? null, workspaceId);
  // THE TAGS INBOX — my mentions in this channel, each row carrying my own
  // read-state. ⚠ The unread BADGE is arithmetic over these rows inside
  // `InfoTab`; nothing derives it a second time.
  const {
    mentions,
    truncated: mentionsTruncated,
    loading: mentionsLoading,
    refetch: refetchMentions,
  } = useChannelMentions(channel?.id ?? null, workspaceId);
  // ⚠ Poll BACKSTOP scoped to THIS page for a downed socket only — consent
  // INSERTs do arrive over realtime. Pauses while the tab is hidden.
  //
  // ⚠ WORKSPACE-WIDE ON PURPOSE, not scoped to the open channel: the sidebar's
  // Inbox badge counts every pending request, and the same rows are joined
  // against this channel's transcript below to derive the REQUESTED state. One
  // read, two consumers — a channel-scoped copy would make the badge lie.
  const { requests } = useConsentInbox(workspaceId, undefined, CONSENT_INBOX_POLL_MS);

  // Realtime → coalesced refetch, deferred while a local write is in flight.
  //
  // ⚠ The refs are written in an EFFECT, not during render — the same shape
  // `use-api-mutation.ts › useRefetchGate` uses for its own `runRef`. A ref
  // assigned in the render pass is a `react-hooks/refs` error and, worse, is
  // read by a subscription callback that may fire before the render commits.
  const refetchRef = useRef<() => void>(() => {});
  const membersRefetchRef = useRef<() => void>(() => {});
  useEffect(() => {
    refetchRef.current = () => {
      void refetchChannels();
      void refetchMessages();
      void refetchMembers();
      void refetchThreads();
      // A new message can BE a new mention, and the doorbell that rings for it
      // is `channel_messages` — `channel_mention_reads` is deliberately not in
      // the publication (INVARIANTS §7; migration `20260818140000` states why),
      // so this refetch is the whole delivery path for a mention arriving.
      void refetchMentions();
    };
    membersRefetchRef.current = () => void refetchMembers();
  });
  // ⚠ `gate` is handed to the composer's writes and `signal` to the realtime
  // subscriptions — the SAME coordinator on both ends, which is the whole point
  // (INVARIANTS §7/§8): a remote event mid-send must not clobber the local
  // optimistic patch.
  const { signal, gate } = useRefetchGate(() => refetchRef.current());
  // ⚠ THE SAME gate the reads register — the mark-read write holds the realtime
  // doorbell open for its own life, or a coalesced refetch mid-flight reverts
  // the optimistic `read` flag under the click that set it.
  const { markRead } = useMentionWrites({ workspaceId, gate });
  useChannelsRealtime(workspaceId, signal);
  // Presence is high-churn (~30s per listener) and never clobbers a send, so it
  // bypasses the coordinator — but refetches the ROSTER only, on a trailing
  // debounce. The 90s freshness window means coalescing a burst loses nothing.
  const presenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (presenceTimerRef.current) clearTimeout(presenceTimerRef.current);
    },
    []
  );
  usePresenceRealtime(workspaceId, () => {
    if (presenceTimerRef.current) return;
    presenceTimerRef.current = setTimeout(() => {
      presenceTimerRef.current = null;
      membersRefetchRef.current();
    }, PRESENCE_REFETCH_DEBOUNCE_MS);
  });

  const index = useMemo(
    () => indexMembers(members, currentUserId),
    [members, currentUserId]
  );
  // DERIVED, never stored: a thread id that is not in THIS channel's list is a
  // stale pick (channel switched, thread aged past the read's ceiling), and the
  // pane falls back to the channel view rather than rendering an empty thread.
  const openThread = requestedThreadId
    ? (threads.find((t) => t.id === requestedThreadId) ?? null)
    : null;
  // REQUESTED, derived from the viewer's OWN consent inbox joined to this
  // channel's transcript on the triggering seq (`view-model-requested.ts`). It
  // feeds three surfaces — the sidebar's admission rule, its Clock glyph, and
  // the card's `PendingChip` — from ONE derivation, so they cannot disagree.
  const requested = useMemo(
    () => requestedThreadIds(messages, requests),
    [messages, requests]
  );
  const treeThreads = useMemo(
    () => sidebarThreads(threads, requested),
    [threads, requested]
  );

  const rows = useMemo(
    () =>
      openThread
        ? threadRows(messages, openThread.id, index, formatChannelTimestamp)
        : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, threads, openThread, index]
  );

  const channelName = channel
    ? channelDisplayName(channel, members, currentUserId)
    : "";

  // The Tags inbox's click: mark read, land the center pane on the right
  // transcript, then signal the scroll. The scroll effect runs POST-render, so
  // the swapped transcript is in the DOM before it looks for the message row.
  //
  // ⚠ The mark-read is OPTIMISTIC (`use-mention-writes.ts`), which is what makes
  // the badge drop in the same frame as the navigation. The scroll target is
  // NONCED, so clicking the same mention twice re-scrolls.
  const openMention = (mention: ChannelMention) => {
    if (!mention.read && channel) {
      markRead.mutate({
        channelId: channel.id,
        messageIds: [mention.messageId],
      });
    }
    setRequestedThreadId(mention.threadId);
    setScrollTarget((prev) => ({
      messageId: mention.messageId,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  // ⚠ MARK-ALL SENDS THE IDS IT IS DISPLAYING, never a flag. The list is
  // bounded and says when it clipped, so "all" can only honestly mean the page
  // — and naming the ids makes that true by construction rather than by comment
  // (INVARIANTS §9). Already-read rows are filtered out so a no-op click sends
  // no request at all.
  const markAllMentionsRead = () => {
    const unread = mentions.filter((m) => !m.read).map((m) => m.messageId);
    if (unread.length === 0 || !channel) return;
    markRead.mutate({ channelId: channel.id, messageIds: unread });
  };

  if (loading && channels.length === 0) return <ChannelsSkeleton />;

  const { direct, rooms } = splitChannels(channels);

  return (
    // `relative` is the agent view's containing block: it is absolutely
    // positioned against this surface, and `.page-float`'s `overflow: hidden`
    // clips it to the page card's radius on the way in and out.
    <div className="page-float relative flex antialiased">
      <ChannelsV2Sidebar
        rooms={rooms}
        direct={direct}
        threads={treeThreads}
        members={members}
        currentUserId={currentUserId}
        selectedChannelId={channel?.id ?? null}
        openThreadId={openThread?.id ?? null}
        onSelectChannel={(id) => {
          setSelectedId(id);
          setRequestedThreadId(null);
          setInboxOpen(false);
        }}
        onOpenThread={(id) => {
          setRequestedThreadId(id);
          setInboxOpen(false);
        }}
        requestedThreads={requested}
        consentCount={requests.length}
        inboxOpen={inboxOpen}
        onOpenInbox={() => setInboxOpen(true)}
      />

      {inboxOpen ? (
        <ChannelsV2InboxPane
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          requests={requests}
          gate={gate}
        />
      ) : channel ? (
        <>
          <ChannelsV2MessagePane
            channelId={channel.id}
            workspaceId={workspaceId}
            channelName={channelName}
            thread={openThread}
            rows={rows}
            index={index}
            members={members}
            loading={messagesLoading}
            requested={requested}
            scrollTarget={scrollTarget}
            infoOpen={infoOpen}
            gate={gate}
            onToggleInfo={() => setInfoOpen((open) => !open)}
            onExitThread={() => setRequestedThreadId(null)}
            onOpenThread={setRequestedThreadId}
          />
          {infoOpen && (
            <ChannelsV2InfoPanel
              channel={channel}
              channelName={channelName}
              members={members}
              threads={threads}
              threadsTruncated={threadsTruncated}
              threadsLoading={threadsLoading}
              index={index}
              openThreadId={openThread?.id ?? null}
              onOpenThread={setRequestedThreadId}
              openAgent={openAgent}
              onOpenAgent={setOpenAgent}
              mentions={mentions}
              mentionsTruncated={mentionsTruncated}
              mentionsLoading={mentionsLoading}
              onOpenMention={openMention}
              onMarkAllMentionsRead={markAllMentionsRead}
            />
          )}
        </>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center px-10 text-caption text-text-muted">
          No channels yet.
        </div>
      )}

      <ChannelsV2AgentPanel
        openAgent={openAgent}
        onClose={() => setOpenAgent(null)}
      />
    </div>
  );
}
