"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRefetchGate } from "@/shared/hooks/use-api-mutation";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { CONSENT_INBOX_POLL_MS, PRESENCE_REFETCH_DEBOUNCE_MS } from "../../constants";
import { useChannels } from "../../hooks/use-channels";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { useChannelMembers } from "../../hooks/use-channel-members";
import { useChannelThreads } from "../../hooks/use-channel-threads";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelsRealtime, usePresenceRealtime } from "../../client/realtime";
import { channelDisplayName } from "../../lib/channel-display";
import { ChannelsSkeleton } from "../channels-skeleton";
import { ChannelsV2Sidebar } from "./sidebar";
import { ChannelsV2MessagePane, type ScrollTarget } from "./message-pane";
import { ChannelsV2InfoPanel } from "./info-panel";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { INITIALLY_READ_MENTIONS, FIXTURE_MENTIONS, type FixtureMention } from "./fixtures-mentions";
import {
  channelRows,
  indexMembers,
  sidebarThreads,
  splitChannels,
  threadRows,
} from "./view-model";

export interface ChannelsV2CoreProps {
  workspaceId: string;
  currentUserId: string;
}

/**
 * Channels v2 root — the three-column shell (channel tree · transcript ·
 * channel info) over the REAL channels reads. READ-ONLY: no writes land from
 * this tree in Phase 2, and the shipping `channels-view-core.tsx` page is
 * untouched and still live.
 *
 * ⚠ NO NEW HOOK LAYER AND NO NEW FETCH PATHS. Every read below is the same hook
 * the shipping page composes — `use-channels`, `use-channel-messages`,
 * `use-channel-members`, `use-channel-threads`, `use-consent-inbox`. Where a
 * hook's shape did not fit (the sidebar's 24h window, the transcript's sides,
 * the thread parties) the adaptation is `view-model.ts`, at the COMPONENT
 * boundary, never a fork of the hook.
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
 * remote event mid-edit must not clobber an unsent local change. Nothing here
 * writes yet, so the gate is currently only ever idle; it is wired now because
 * Phase 3's composer hands its `settleWith` to the very same gate, and a
 * coordinator retrofitted after the first write is a coordinator that was
 * missing for exactly the window it was needed.
 *
 * ⚠ AN EVENT IS A DOORBELL, NEVER CONTENT — the signal triggers a filtered
 * refetch and no payload is ever merged, so RLS and the service filters stay
 * authoritative.
 */
export function ChannelsV2Core({ workspaceId, currentUserId }: ChannelsV2CoreProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(true);
  const [readMentions, setReadMentions] =
    useState<ReadonlySet<string>>(INITIALLY_READ_MENTIONS);
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);

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
  // ⚠ Poll BACKSTOP scoped to THIS page for a downed socket only — consent
  // INSERTs do arrive over realtime. Pauses while the tab is hidden.
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
    };
    membersRefetchRef.current = () => void refetchMembers();
  });
  const { signal } = useRefetchGate(() => refetchRef.current());
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
  const treeThreads = useMemo(() => sidebarThreads(threads), [threads]);

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
  // ⚠ The FIXTURE's message ids resolve to nothing until Phase 6 wires real
  // mentions; the plumbing is real and the target is not.
  const openMention = (mention: FixtureMention) => {
    setReadMentions((prev) => new Set(prev).add(mention.id));
    setRequestedThreadId(mention.threadId);
    setScrollTarget((prev) => ({
      messageId: mention.messageId,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
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
        }}
        onOpenThread={setRequestedThreadId}
        consentCount={requests.length}
      />

      {channel ? (
        <>
          <ChannelsV2MessagePane
            channelName={channelName}
            thread={openThread}
            rows={rows}
            index={index}
            members={members}
            loading={messagesLoading}
            scrollTarget={scrollTarget}
            infoOpen={infoOpen}
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
              readMentions={readMentions}
              onOpenMention={openMention}
              onMarkAllMentionsRead={() =>
                setReadMentions(new Set(FIXTURE_MENTIONS.map((m) => m.id)))
              }
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
