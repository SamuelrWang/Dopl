"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRefetchGate } from "@/shared/hooks/use-api-mutation";
import type { LinkLike } from "@/shared/ui/link-like";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  CONSENT_INBOX_POLL_MS,
  PRESENCE_REFETCH_DEBOUNCE_MS,
  UNRESOLVED_TOOL_PROFILE,
} from "../constants";
import type { AgentToolProfile } from "../types";
import { useChannels } from "../hooks/use-channels";
import { useChannelMessages } from "../hooks/use-channel-messages";
import { useChannelMembers } from "../hooks/use-channel-members";
import { useChannelThreads } from "../hooks/use-channel-threads";
import { useConsentInbox } from "../hooks/use-consent-inbox";
import { useTrustRules } from "../hooks/use-trust-rules";
import { useThreadWrites } from "../hooks/use-thread-writes";
import { useChannelPreferenceWrites } from "../hooks/use-channel-preference-writes";
import { useChannelLifecycleWrites } from "../hooks/use-channel-lifecycle-writes";
import { newClientMsgId } from "../lib/optimistic-cache";
import { useChannelsRealtime, usePresenceRealtime } from "../client/realtime";
import { ChannelsListPane, type ChannelTab } from "./channels-list-pane";
import { ChannelPane } from "./channel-pane";
import { ChannelsSkeleton } from "./channels-skeleton";
import { ChannelsOnboardingCore } from "./channels-onboarding-core";
import { CreateChannelDialog } from "./create-channel-dialog";
import { DirectMessageDialog } from "./direct-message-dialog";
import { InviteDialog } from "./invite-dialog";
import type { SendOptions } from "./message-composer";

export interface ChannelsViewCoreProps {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  /** Router-agnostic link — `next/link` in the web app, react-router in the SPA.
   *  Only the first-run explainer's step cards need it. */
  Link: LinkLike;
}

/** Stable empty set — a fresh `new Set()` per render would defeat memos. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return new Set(set).add(id);
}

function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(id);
  return next;
}

/**
 * Channels page root — a two-pane `.page-float` master/detail surface: the
 * searchable channel list on the left, the selected channel's thread +
 * composer on the right. Layers the v1.2 human-in-the-loop surfaces on top of
 * the base thread: the consent inbox (inbound approvals + outbound reviews),
 * per-teammate trust, agent tool profiles, and live presence. All client-
 * fetched via `useApiQuery`; MCP / agent / desktop writes surface live through
 * the realtime hooks (refetch, never merge).
 *
 * THE WRITES DO NOT LIVE HERE ANY MORE — three hooks own them, which is what
 * took this file back under the §2 cap it had been sitting over:
 * `use-thread-writes` (send / open / close / reopen — the flagship optimistic
 * path), `use-channel-preference-writes` (tool profile, trust, consent — the
 * writes that used to carry hand-rolled override records), and
 * `use-channel-lifecycle-writes` (archive / visibility / delete / join /
 * leave). ALL THREE are on `useApiMutation` and patch the query cache
 * directly, so this file holds no optimistic lens of its own: what it renders
 * is what the cache says, one frame after the click.
 *
 * ALL THREE ALSO TAKE `gate`, and that is the whole of audit C-27's fix: the
 * refetch coordinator used to cover the send and the thread ops only, so every
 * other write raced the realtime doorbell and survived on override maps
 * instead. `useRefetchGate` owns one counter and every mutation's `settleWith`
 * feeds it, so the coordinator now covers the feature rather than a third of
 * it — and a write that throws still releases the deferred refetch.
 *
 * Next-free by construction so the desktop SPA can bundle it
 * (apps/desktop-ui/src/pages/channels/index.tsx): the only router dependency —
 * the first-run explainer's step links — arrives as the `Link` prop.
 * `./channels-view` is the web app's `next/link` binding.
 *
 * IN THE BUNDLED SPA the four realtime hooks below are deliberate no-ops
 * (`shared-channel-registry.ts` short-circuits when `window.dopl` is present),
 * so every surface still loads from its own `useApiQuery` and then refreshes
 * on the consent poll, on each mutation's own settle-time invalidations, and
 * on TanStack's focus revalidation — until Phase 3 pushes change events over
 * the bridge. Nothing here changes for that; the hooks stay wired as the web
 * page wires them.
 */
export function ChannelsViewCore({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  Link,
}: ChannelsViewCoreProps) {
  const [tab, setTab] = useState<ChannelTab>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Double-fire guards, and only that: the OPTIMISTIC half of these two writes
  // is a cache patch now, so nothing here mirrors a server value.
  const [trustBusyIds, setTrustBusyIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const [consentBusyIds, setConsentBusyIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS);

  const canCreate = meetsMinRole(role, "member");

  const { channels, loading, refetch: refetchChannels } = useChannels(
    workspaceId,
    tab === "archived"
  );

  const displayChannels = useMemo(
    () =>
      tab === "archived" ? channels.filter((c) => c.archivedAt !== null) : channels,
    [channels, tab]
  );

  // Derived effective selection: an explicit pick that still exists wins, else
  // the first row — so the thread always shows something real.
  const effectiveId = useMemo(() => {
    if (selectedId && displayChannels.some((c) => c.id === selectedId)) {
      return selectedId;
    }
    return displayChannels[0]?.id ?? null;
  }, [selectedId, displayChannels]);

  const selected = displayChannels.find((c) => c.id === effectiveId) ?? null;

  const {
    messages,
    loading: messagesLoading,
    refetch: refetchMessages,
  } = useChannelMessages(selected?.id ?? null, workspaceId);
  // `membersStale` is this read's `isPlaceholderData`: through a channel switch
  // `keepPreviousData` keeps the PREVIOUS channel's roster on screen, and the
  // composer's request mode turns that roster into the `toUserId` it posts. It
  // rides down to the composer so a request cannot address the last channel's
  // peer (400 `ChannelAddresseeNotMemberError`, after the optimistic paint).
  const {
    members,
    stale: membersStale,
    refetch: refetchMembers,
  } = useChannelMembers(selected?.id ?? null, workspaceId);
  const {
    threads,
    loading: threadsLoading,
    refetch: refetchThreads,
  } = useChannelThreads(selected?.id ?? null, workspaceId);
  // Poll BACKSTOP scoped to THIS page (not the sidebar badge), for the case
  // where the realtime socket itself is down — consent INSERTs are delivered
  // over realtime (see CONSENT_INBOX_POLL_MS). Pauses automatically while the
  // tab is hidden (TanStack default).
  const { inbound, outbound } = useConsentInbox(
    workspaceId,
    undefined,
    CONSENT_INBOX_POLL_MS
  );
  const { trustedIds } = useTrustRules(workspaceId);

  // Pending consent for the SELECTED channel (banner) + a set of every channel
  // with something pending (list-row indicator + "seen from the list"). A
  // decided request leaves the inbox cache at once, so nothing is filtered here.
  const pending = useMemo(
    () => [...inbound, ...outbound],
    [inbound, outbound]
  );
  const channelConsent = useMemo(
    () => pending.filter((r) => r.channelId === selected?.id),
    [pending, selected?.id]
  );
  const consentChannelIds = useMemo(
    () => new Set(pending.map((r) => r.channelId)),
    [pending]
  );

  // Realtime → coalesced refetch, deferred while a local write is in flight.
  // `useRefetchGate` owns the coordinator AND the in-flight counter every
  // caller used to keep by hand; `gate` is handed to each mutation's
  // `settleWith`, so a write that throws still releases the deferred refetch.
  const refetchRef = useRef<() => void>(() => {});
  refetchRef.current = () => {
    void refetchChannels();
    void refetchMessages();
    void refetchMembers();
    // A `create_thread` / `close_thread` posts a message, so the same realtime
    // signal that refreshes messages also refreshes the authoritative thread
    // status/title overlay (`set_thread_mode` posts none, so it is eventually
    // consistent).
    void refetchThreads();
  };
  const { signal, gate } = useRefetchGate(() => refetchRef.current());
  useChannelsRealtime(workspaceId, signal);
  // Presence is high-churn (a heartbeat per listener per ~30s) and never
  // clobbers a send, so it bypasses the coordinator — but it only refetches the
  // ROSTER, on a trailing debounce. The channel list is deliberately NOT
  // refetched here: that read does a workspace-wide presence scan plus a
  // per-channel member fan-out, and the only thing it adds is `onlineMemberCount`,
  // which nothing renders (the header derives "N online" from the roster).
  const membersRefetchRef = useRef<() => void>(() => {});
  membersRefetchRef.current = () => void refetchMembers();
  const presenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (presenceTimerRef.current) clearTimeout(presenceTimerRef.current);
    },
    []
  );
  usePresenceRealtime(workspaceId, () => {
    // Already scheduled: the freshness window is 90s, so coalescing a burst
    // into one refetch loses nothing.
    if (presenceTimerRef.current) return;
    presenceTimerRef.current = setTimeout(() => {
      presenceTimerRef.current = null;
      membersRefetchRef.current();
    }, PRESENCE_REFETCH_DEBOUNCE_MS);
  });

  // Author display for a pending row, so an optimistic message does not render
  // as "Member" for one round trip and then rename itself.
  const me = members.find((m) => m.userId === currentUserId) ?? null;
  const { send, openThread, threadOp } = useThreadWrites({
    workspaceId,
    currentUserId,
    currentUserName: me?.displayName ?? null,
    currentUserAvatarUrl: me?.avatarUrl ?? null,
    gate,
  });
  const prefs = useChannelPreferenceWrites({ workspaceId, currentUserId, gate });
  const lifecycle = useChannelLifecycleWrites({
    channel: selected,
    workspaceId,
    currentUserId,
    gate,
    onDeselect: () => setSelectedId(null),
  });

  async function handleSend(body: string, opts?: SendOptions) {
    if (!selected) return;
    await send.mutateAsync({
      // Captured HERE, at submit: a channel switch mid-flight must not move
      // this write into another channel's cache.
      channelId: selected.id,
      clientMsgId: newClientMsgId(),
      body,
      intent: opts?.intent,
    });
  }

  /**
   * The composer's REQUEST mode: open a titled thread addressed to one member.
   * The `clientMsgId` is the thread's idempotency key — a resend after a failed
   * open returns the already-created thread instead of double-creating it (and
   * double-spawning the responder's window).
   */
  async function handleCreateThread(input: {
    title: string;
    body: string;
    toUserId: string;
  }) {
    if (!selected) return;
    await openThread.mutateAsync({
      channelId: selected.id,
      clientMsgId: newClientMsgId(),
      ...input,
    });
  }

  async function handleCloseThread(
    threadId: string,
    outcome: "completed" | "failed",
    summary?: string
  ) {
    if (!selected) return;
    await threadOp.mutateAsync({
      channelId: selected.id,
      threadId,
      op: "close",
      outcome,
      summary,
    });
  }

  async function handleReopenThread(threadId: string) {
    if (!selected) return;
    await threadOp.mutateAsync({
      channelId: selected.id,
      threadId,
      op: "reopen",
    });
  }

  function handleSetToolProfile(profile: AgentToolProfile) {
    if (!selected) return;
    prefs.toolProfile.mutate({ channelId: selected.id, profile });
  }

  async function handleToggleTrust(userId: string, trusted: boolean) {
    if (trustBusyIds.has(userId)) return;
    setTrustBusyIds((s) => withId(s, userId));
    try {
      await prefs.trust.mutateAsync({ userId, trusted });
    } catch {
      // The rollback + the toast are the mutation's; this only clears the guard.
    } finally {
      setTrustBusyIds((s) => withoutId(s, userId));
    }
  }

  async function handleDecideConsent(id: string, decision: "allow" | "deny") {
    if (consentBusyIds.has(id)) return;
    setConsentBusyIds((s) => withId(s, id));
    try {
      await prefs.consent.mutateAsync({ id, decision });
    } catch {
      // Same: the card comes back with the cache rollback.
    } finally {
      setConsentBusyIds((s) => withoutId(s, id));
    }
  }

  // A row with no profile resolves the way the DESKTOP resolves it — see
  // `UNRESOLVED_TOOL_PROFILE`. The settings popover renders this value as a
  // containment claim, so the web may not pick a wider answer than the machine.
  const channelForThread = selected
    ? {
        ...selected,
        myAgentToolProfile: selected.myAgentToolProfile ?? UNRESOLVED_TOOL_PROFILE,
      }
    : null;

  if (loading && channels.length === 0) {
    return <ChannelsSkeleton />;
  }

  return (
    <div className="page-float flex antialiased">
      <ChannelsListPane
        channels={displayChannels}
        tab={tab}
        onTabChange={(next) => {
          setTab(next);
          setSelectedId(null);
        }}
        query={query}
        onQueryChange={setQuery}
        selectedId={effectiveId}
        onSelect={setSelectedId}
        canCreate={canCreate}
        onCreate={() => setCreateOpen(true)}
        onCreateDirect={() => setDirectOpen(true)}
        consentChannelIds={consentChannelIds}
      />

      {channelForThread ? (
        <ChannelPane
          key={channelForThread.id}
          channel={channelForThread}
          messages={messages}
          threads={threads}
          threadsLoading={threadsLoading}
          loading={messagesLoading}
          members={members}
          membersStale={membersStale}
          currentUserId={currentUserId}
          consentRequests={channelConsent}
          trustedIds={trustedIds}
          trustBusyIds={trustBusyIds}
          consentBusyIds={consentBusyIds}
          onSend={handleSend}
          onCreateThread={handleCreateThread}
          onCloseThread={handleCloseThread}
          onReopenThread={handleReopenThread}
          onInvite={() => setInviteOpen(true)}
          onSetToolProfile={handleSetToolProfile}
          toolProfileBusy={prefs.toolProfile.pending}
          onToggleTrust={handleToggleTrust}
          onDecideConsent={handleDecideConsent}
          onToggleArchive={lifecycle.toggleArchive}
          onToggleVisibility={lifecycle.toggleVisibility}
          onDelete={lifecycle.remove}
          onJoin={lifecycle.join}
          onLeave={lifecycle.leave}
        />
      ) : tab === "archived" ? (
        <div className="flex min-w-0 flex-1 items-center justify-center px-10 text-caption text-text-muted">
          No archived channels.
        </div>
      ) : (
        <ChannelsOnboardingCore
          workspaceSlug={workspaceSlug}
          canCreate={canCreate}
          onCreate={() => setCreateOpen(true)}
          Link={Link}
        />
      )}

      <CreateChannelDialog
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(channel) => {
          setTab("active");
          setSelectedId(channel.id);
          void refetchChannels();
        }}
      />

      <DirectMessageDialog
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
        open={directOpen}
        onOpenChange={setDirectOpen}
        onCreated={(channel) => {
          setSelectedId(channel.id);
          void refetchChannels();
        }}
      />

      {selected && (
        <InviteDialog
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          channelId={selected.id}
          currentUserId={currentUserId}
          canManage={selected.role === "owner" || meetsMinRole(role, "admin")}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onChanged={() => {
            void refetchChannels();
            void refetchMembers();
          }}
        />
      )}
    </div>
  );
}
