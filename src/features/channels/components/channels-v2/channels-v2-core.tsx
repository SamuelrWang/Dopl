"use client";

import { useMemo, useState } from "react";
import type { LinkLike } from "@/shared/ui/link-like";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { CONSENT_INBOX_POLL_MS } from "../../constants";
import { useChannels } from "../../hooks/use-channels";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { useChannelMembers } from "../../hooks/use-channel-members";
import { useChannelThreads } from "../../hooks/use-channel-threads";
import { useChannelMentions } from "../../hooks/use-channel-mentions";
import { useMentionWrites } from "../../hooks/use-mention-writes";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { channelDisplayName } from "../../lib/channel-display";
import { ChannelsSkeleton } from "../channels-skeleton";
import { ChannelsOnboardingCore } from "../channels-onboarding-core";
import {
  ChannelsV2CreateDialogs,
  ChannelsV2ManageActions,
} from "./channel-manage";
import { ChannelsV2Sidebar } from "./sidebar";
import { ChannelsV2MessagePane, type ScrollTarget } from "./message-pane";
import { ChannelsV2InfoPanel } from "./info-panel";
import { ChannelsV2InboxPane } from "./inbox-pane";
import { ChannelsV2AgentPanel } from "./agent-panel";
import { PopOutThreadButton } from "./pop-out";
import { useChannelsV2Live } from "./live";
import { useDesktopSessions } from "./agents-model";
import type { Channel, ChannelMention } from "../../types";
// Kept on one line each: this file sits a handful of lines inside the 500-line cap.
import { splitChannels } from "./view-model";
import { useChannelsV2Derivations } from "./derivations";

export interface ChannelsV2CoreProps {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  /**
   * Router-agnostic link — `next/link` on the web, react-router in the SPA.
   * ⚠ ONE consumer, and it is the reason the prop exists at all: the first-run
   * explainer's step cards (`channels-onboarding-core.tsx`). Nothing else in
   * this tree routes, and nothing else may take it.
   */
  Link: LinkLike;
  /**
   * The channel a CALLER named, as an initial selection — the desktop's
   * `/channels/:channelId` route hands its param down (wiring plan Phase 9,
   * renamed off `channels-v2` at the Phase 12 cutover). A plain prop,
   * deliberately: this tree is router-free, so the SPA page owns the param read
   * and this owns nothing but the selection.
   */
  initialChannelId?: string | null;
  /**
   * The thread a CALLER named, as an initial selection inside `initialChannelId`,
   * read off `?thread=` by the SPA page (wiring plan Phase 10, 2026-08-18).
   * ⚠ IT WAS THE POP-OUT WINDOW'S LANDING UNTIL 2026-08-19 — the pop-out has a
   * thread-ONLY route of its own now (`pages/thread-window/`) and never lands here.
   *
   * ⚠ A SELECTION, NOT A ROUTE. A thread is not a page: it is which transcript
   * the channels page has open, so this rides the `channels/:channelId` row the
   * cutover built and adds no route and no deep-link grammar. It is
   * also DERIVED-CHECKED below like every other pick — a thread id not in this
   * channel's list falls back to the channel view rather than an empty thread.
   */
  initialThreadId?: string | null;
}

/**
 * Channels v2 root — the three-column shell (channel tree · transcript ·
 * channel info) over the REAL channels reads, plus a FOURTH center-column
 * destination — the Inbox (`inbox-pane.tsx`), behind the sidebar's Inbox nav
 * row. **THIS IS THE SHIPPING CHANNELS PAGE** since the cutover (wiring plan
 * Phase 12, 2026-08-18): `channels-view-core.tsx` and the two-pane surface
 * under it are DELETED, and `/:workspaceSegment/channels` mounts this tree.
 *
 * ⚠ NOT READ-ONLY ANY MORE (it was, through Phase 2). FIVE write families land
 * from this tree (INVARIANTS §7), all through the existing write layer, none a
 * new endpoint: the composer's send / request fan-out (Phase 3), the Tags
 * inbox's mark-read (Phase 6), the Inbox pane's consent decision (Phase 8),
 * the channel-management writes the CUTOVER added (create / invite / visibility
 * / archive / delete / leave / tool profile / trust), which arrived WHOLESALE
 * from the deleted page and live in `channel-manage.tsx`, and the header
 * bookmark's FAVOURITE (2026-08-19), which rides the same per-member preference
 * route as the tool profile. All five hold the same `useRefetchGate` gate the
 * reads register.
 *
 * ⚠ A FAVOURITE IS A SHORTCUT, NOT A MOVE (Slack semantics). The favourited
 * channel keeps its row in Channels or Direct messages and gains a second one in
 * Favorites; both select it. The sidebar's docblock owns the rest of the rule.
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
 * constraint the retired `channels-view-core.tsx` documented. The ONE router
 * dependency arrives as the `Link` prop and has exactly one consumer, the
 * first-run explainer (`channels-onboarding-core.tsx`), which the cutover
 * rehomed onto this surface's no-channels branch — Samuel's ruling was KEEP
 * for now, redesign later, and the old page was its only reachable entry.
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
 * remote event mid-edit must not clobber an unsent local change. All FOUR write
 * families above hand their `settleWith` to this ONE gate (the fourth, channel
 * management, arrived at the cutover) — which is the whole point: a coordinator
 * retrofitted after the first write is a coordinator that was missing for
 * exactly the window it was needed.
 *
 * ⚠ AN EVENT IS A DOORBELL, NEVER CONTENT — the signal triggers a filtered
 * refetch and no payload is ever merged, so RLS and the service filters stay
 * authoritative.
 */
export function ChannelsV2Core({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  Link,
  initialChannelId = null,
  initialThreadId = null,
}: ChannelsV2CoreProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialChannelId);
  const [createOpen, setCreateOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(
    initialThreadId
  );
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
      // ⚠ The NAMED thread, not `null` (Phase 10). A notification names no thread,
      // so this stays the clear it always was; a pop-out landing names one, and
      // re-routing to a different channel must not silently drop it.
      setRequestedThreadId(initialThreadId);
      setInboxOpen(false);
    }
  }

  const { channels, loading, refetch: refetchChannels } = useChannels(
    workspaceId,
    false
  );

  // Explicit pick that still exists wins, else the first row — the same rule the
  // deleted `channels-view-core.tsx` used, so a deleted channel cannot strand the pane.
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
  // MY OWN AGENTS — the ONE read on this page that is not a server projection.
  // It is this machine's live session state over the Electron bridge
  // (`agents-model.ts`), so it is workspace-wide by nature and each consumer
  // slices it; `null` means "could not ask" (plain browser, or an older main)
  // and is deliberately carried as null all the way to the tab, which words the
  // two absences differently.
  // ⚠ `refresh` is the REFUSAL path only (`agents-model.ts ›
  // DesktopSessionsFeed`) — main answering `{ok:false}` is the one fact no
  // push announces. Not a poll.
  const { sessions: agentSessions, refresh: refreshAgents } =
    useDesktopSessions();

  // Realtime → coalesced refetch, deferred while a local write is in flight. The whole
  // wiring is `live.ts`, split out at the Phase 10 cap; what stays here is WHAT a doorbell
  // invalidates, which is the core's own business.
  // ⚠ `gate` is handed to every writer on this surface, and `live.ts` hands the SAME
  // coordinator to the subscriptions — one coordinator, both ends (INVARIANTS §7/§8).
  const { gate } = useChannelsV2Live({
    workspaceId,
    refetchAll: () => {
      void refetchChannels();
      void refetchMessages();
      void refetchMembers();
      void refetchThreads();
      // A new message can BE a new mention, and the doorbell that rings for it
      // is `channel_messages` — `channel_mention_reads` is deliberately not in
      // the publication (INVARIANTS §7; migration `20260818140000` states why),
      // so this refetch is the whole delivery path for a mention arriving.
      void refetchMentions();
    },
    refetchMembers: () => void refetchMembers(),
  });
  // ⚠ THE SAME gate the reads register — the mark-read write holds the realtime
  // doorbell open for its own life, or a coalesced refetch mid-flight reverts
  // the optimistic `read` flag under the click that set it.
  const { markRead } = useMentionWrites({ workspaceId, gate });
  // THE FAVOURITE TOGGLE (Samuel, 2026-08-19) — a FIFTH write family on this
  // surface, on the same gate as the other four, and the existing per-member
  // preference route rather than a new one (`PATCH /members`, `favorite`).
  const { favorite } = useChannelPreferenceWrites({
    workspaceId,
    currentUserId,
    gate,
  });

  const { index, openThread, requested, treeThreads, rows } =
    useChannelsV2Derivations({
      members,
      currentUserId,
      messages,
      threads,
      requests,
      openThreadId: requestedThreadId,
    });

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

  // A create lands the operator ON the new channel — the same rule the retired
  // page used, so a fresh room is never created into an unchanged view.
  const onCreated = (created: Channel) => {
    setSelectedId(created.id);
    setRequestedThreadId(null);
    setInboxOpen(false);
    void refetchChannels();
  };

  if (loading && channels.length === 0) return <ChannelsSkeleton />;

  const { direct, rooms } = splitChannels(channels);
  const canCreate = meetsMinRole(role, "member");

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
        canCreate={canCreate}
        onCreateChannel={() => setCreateOpen(true)}
        onCreateDirect={() => setDirectOpen(true)}
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
            // ⚠ THE DESIRED STATE IS COMPUTED HERE, from the row the header is
            // rendering — never a flip inside the mutation. Two fast clicks send
            // `true` then `false` and converge; a toggle verb would race.
            favorited={channel.myFavoritedAt !== null}
            onToggleFavorite={() =>
              favorite.mutate({
                channelId: channel.id,
                favorite: channel.myFavoritedAt === null,
              })
            }
            gate={gate}
            // THE POP-OUT (Phase 10). Rendered only with a thread open, and it
            // hides ITSELF outside the desktop shell (feature detection), so the
            // web tree gets no affordance for a window it cannot open.
            popOut={
              openThread ? (
                <PopOutThreadButton
                  workspaceSlug={workspaceSlug}
                  channelId={channel.id}
                  threadId={openThread.id}
                />
              ) : null
            }
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
              agentSessions={agentSessions}
              openAgent={openAgent}
              onOpenAgent={setOpenAgent}
              mentions={mentions}
              mentionsTruncated={mentionsTruncated}
              mentionsLoading={mentionsLoading}
              onOpenMention={openMention}
              onMarkAllMentionsRead={markAllMentionsRead}
              // THE SETTINGS TAB (Samuel, 2026-08-19). This cluster hung off the
              // pane HEADER until then; the header keeps only the info toggle.
              settings={
                <ChannelsV2ManageActions
                  channel={channel}
                  workspaceId={workspaceId}
                  workspaceSlug={workspaceSlug}
                  currentUserId={currentUserId}
                  role={role}
                  members={members}
                  gate={gate}
                  onDeselect={() => setSelectedId(null)}
                  onRosterChanged={() => {
                    void refetchChannels();
                    void refetchMembers();
                  }}
                />
              }
            />
          )}
        </>
      ) : (
        // THE FIRST-RUN EXPLAINER, rehomed here at the cutover. It says what
        // channels are for and what responding needs; Samuel's third-round
        // ruling was KEEP for now, redesign later, and the page that used to
        // render it is deleted.
        <ChannelsOnboardingCore
          workspaceSlug={workspaceSlug}
          canCreate={canCreate}
          onCreate={() => setCreateOpen(true)}
          Link={Link}
        />
      )}

      {/* ⚠ The Sent lane reads the OPEN CHANNEL's transcript, so the panel takes
          `messages` rather than fetching: one read, and the panel cannot show a
          message the transcript beside it does not have. */}
      <ChannelsV2AgentPanel
        openAgent={openAgent}
        sessions={agentSessions}
        messages={messages}
        currentUserId={currentUserId}
        onClose={() => setOpenAgent(null)}
        onRefreshSessions={refreshAgents}
      />

      {/* Workspace-scoped, so they mount OUTSIDE the channel branch above — a
          workspace with no channel at all is exactly when "create one" has to
          work. */}
      <ChannelsV2CreateDialogs
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
        createOpen={createOpen}
        directOpen={directOpen}
        onCreateOpenChange={setCreateOpen}
        onDirectOpenChange={setDirectOpen}
        onCreated={onCreated}
      />
    </div>
  );
}
