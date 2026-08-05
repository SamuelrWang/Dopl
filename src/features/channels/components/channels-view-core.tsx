"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createRefetchCoordinator } from "@/shared/realtime/refetch-coordinator";
import { toast } from "@/shared/ui/toast";
import type { LinkLike } from "@/shared/ui/link-like";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  addChannelMember,
  addTrustRule,
  ChannelApiError,
  closeChannelThread,
  createChannelThread,
  reopenChannelThread,
  decideConsent,
  deleteChannel as apiDeleteChannel,
  postMessage,
  removeChannelMember,
  removeTrustRule,
  updateChannel as apiUpdateChannel,
  updateMyNotifyScope,
  updateMyToolProfile,
} from "../client/api";
import { CONSENT_INBOX_POLL_MS, PRESENCE_REFETCH_DEBOUNCE_MS } from "../constants";
import type { AgentToolProfile, NotifyScope } from "../types";
import { useChannels } from "../hooks/use-channels";
import { useChannelMessages } from "../hooks/use-channel-messages";
import { useChannelMembers } from "../hooks/use-channel-members";
import { useChannelThreads } from "../hooks/use-channel-threads";
import { useConsentInbox } from "../hooks/use-consent-inbox";
import { useTrustRules } from "../hooks/use-trust-rules";
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
 * Next-free by construction so the desktop SPA can bundle it
 * (apps/desktop-ui/src/pages/channels/index.tsx): the only router dependency —
 * the first-run explainer's step links — arrives as the `Link` prop.
 * `./channels-view` is the web app's `next/link` binding.
 *
 * IN THE BUNDLED SPA the four realtime hooks below are deliberate no-ops
 * (`shared-channel-registry.ts` short-circuits when `window.dopl` is present),
 * so every surface still loads from its own `useApiQuery` and then refreshes
 * on the consent poll, on the mutations' own awaited refetches, and on
 * TanStack's focus revalidation — until Phase 3 pushes change events over the
 * bridge. Nothing here changes for that; the hooks stay wired as the web page
 * wires them.
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
  // Optimistic per-channel preference overrides, applied over the server value
  // until the follow-up refetch (success) or a revert (failure).
  const [scopeOverride, setScopeOverride] = useState<Record<string, NotifyScope>>({});
  const [toolOverride, setToolOverride] = useState<Record<string, AgentToolProfile>>({});
  const [trustOverride, setTrustOverride] = useState<Record<string, boolean>>({});
  const [trustBusyIds, setTrustBusyIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  // Consent decisions in flight, and the ids already decided locally so the
  // card leaves immediately instead of sitting disabled for a round trip.
  const [consentBusyIds, setConsentBusyIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const [decidedConsentIds, setDecidedConsentIds] =
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
  const { members, refetch: refetchMembers } = useChannelMembers(
    selected?.id ?? null,
    workspaceId
  );
  const {
    threads,
    loading: threadsLoading,
    refetch: refetchThreads,
  } = useChannelThreads(selected?.id ?? null, workspaceId);
  // Poll BACKSTOP scoped to THIS page (not the sidebar badge), for the case
  // where the realtime socket itself is down — consent INSERTs are delivered
  // over realtime (see CONSENT_INBOX_POLL_MS). Pauses automatically while the
  // tab is hidden (TanStack default).
  const { inbound, outbound, refetch: refetchConsent } = useConsentInbox(
    workspaceId,
    undefined,
    CONSENT_INBOX_POLL_MS
  );
  const { trustedIds, refetch: refetchTrust } = useTrustRules(workspaceId);

  // Pending consent for the SELECTED channel (banner) + a set of every channel
  // with something pending (list-row indicator + "seen from the list").
  // Locally decided ids drop out at once; a failed write puts them back.
  const pending = useMemo(
    () =>
      [...inbound, ...outbound].filter((r) => !decidedConsentIds.has(r.id)),
    [inbound, outbound, decidedConsentIds]
  );
  const channelConsent = useMemo(
    () => pending.filter((r) => r.channelId === selected?.id),
    [pending, selected?.id]
  );
  const consentChannelIds = useMemo(
    () => new Set(pending.map((r) => r.channelId)),
    [pending]
  );

  // Realtime → coalesced refetch, deferred while a local send is in flight.
  const busyRef = useRef(0);
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
  const coordinatorRef = useRef(createRefetchCoordinator(() => refetchRef.current()));
  useChannelsRealtime(workspaceId, () =>
    coordinatorRef.current.request(busyRef.current > 0)
  );
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

  async function withChannelError(fn: () => Promise<void>, fallback: string) {
    try {
      await fn();
      void refetchChannels();
    } catch (err) {
      toast({ title: err instanceof ChannelApiError ? err.message : fallback });
    }
  }

  async function handleSend(body: string, opts?: SendOptions) {
    if (!selected) return;
    busyRef.current += 1;
    try {
      await postMessage(
        selected.id,
        {
          body,
          // Chat mode says so explicitly rather than leaving the server to
          // infer "no addressee, probably chat" from missing fields. It is the
          // WHOLE of what a chat send may carry: `toUserId` / `summary` /
          // `toAgents` are gone from `SendOptions` entirely rather than left
          // forwarded-but-unset (see `lib/composer-mode.ts` — that live wire is
          // how the bug returns).
          intent: opts?.intent,
        },
        workspaceId
      );
      await refetchMessages();
      void refetchChannels();
    } catch (err) {
      toast({ title: err instanceof ChannelApiError ? err.message : "Couldn't send" });
      throw err;
    } finally {
      busyRef.current -= 1;
      coordinatorRef.current.settle(busyRef.current > 0);
    }
  }

  async function runThreadMutation(fn: () => Promise<unknown>, failTitle: string) {
    busyRef.current += 1;
    try {
      await fn();
      await refetchMessages();
      void refetchThreads();
      void refetchChannels();
    } catch (err) {
      toast({
        title: err instanceof ChannelApiError ? err.message : failTitle,
      });
      throw err;
    } finally {
      busyRef.current -= 1;
      coordinatorRef.current.settle(busyRef.current > 0);
    }
  }

  /**
   * The composer's REQUEST mode: open a titled thread addressed to one member.
   * Goes through the same `runThreadMutation` envelope as close / reopen, so
   * the opening message, the thread overlay and the channel list all refetch
   * together and a failure surfaces as one toast rather than a half-drawn card.
   */
  async function handleCreateThread(input: {
    title: string;
    body: string;
    toUserId: string;
  }) {
    if (!selected) return;
    await runThreadMutation(
      () => createChannelThread(selected.id, input, workspaceId),
      "Couldn't open the thread"
    );
  }

  async function handleCloseThread(
    threadId: string,
    outcome: "completed" | "failed",
    summary?: string
  ) {
    if (!selected) return;
    await runThreadMutation(
      () =>
        closeChannelThread(
          selected.id,
          threadId,
          { outcome, summary },
          workspaceId
        ),
      "Couldn't close the thread"
    );
  }

  async function handleReopenThread(threadId: string) {
    if (!selected) return;
    await runThreadMutation(
      () => reopenChannelThread(selected.id, threadId, workspaceId),
      "Couldn't reopen the thread"
    );
  }

  const handleToggleArchive = () =>
    selected &&
    void withChannelError(
      () =>
        apiUpdateChannel(
          selected.id,
          { archived: selected.archivedAt === null },
          workspaceId
        ).then(() => undefined),
      "Couldn't update the channel"
    );

  const handleToggleVisibility = () =>
    selected &&
    void withChannelError(
      () =>
        apiUpdateChannel(
          selected.id,
          { visibility: selected.visibility === "public" ? "private" : "public" },
          workspaceId
        ).then(() => undefined),
      "Couldn't update the channel"
    );

  const handleDelete = () =>
    selected &&
    void withChannelError(async () => {
      await apiDeleteChannel(selected.id, workspaceId);
      setSelectedId(null);
    }, "Couldn't delete the channel");

  const handleJoin = () =>
    selected &&
    void withChannelError(async () => {
      await addChannelMember(selected.id, currentUserId, workspaceId);
      await refetchMessages();
      await refetchMembers();
    }, "Couldn't join the channel");

  async function handleSetNotifyScope(scope: NotifyScope) {
    if (!selected) return;
    const id = selected.id;
    setScopeOverride((m) => ({ ...m, [id]: scope }));
    try {
      await updateMyNotifyScope(id, scope, workspaceId);
      await refetchChannels();
    } catch (err) {
      toast({
        title:
          err instanceof ChannelApiError ? err.message : "Couldn't update notifications",
      });
    } finally {
      setScopeOverride((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  }

  async function handleSetToolProfile(profile: AgentToolProfile) {
    if (!selected) return;
    const id = selected.id;
    setToolOverride((m) => ({ ...m, [id]: profile }));
    try {
      await updateMyToolProfile(id, profile, workspaceId);
      await refetchChannels();
    } catch (err) {
      toast({
        title:
          err instanceof ChannelApiError ? err.message : "Couldn't update agent tools",
      });
    } finally {
      setToolOverride((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  }

  async function handleToggleTrust(userId: string, trusted: boolean) {
    if (trustBusyIds.has(userId)) return;
    setTrustOverride((m) => ({ ...m, [userId]: trusted }));
    setTrustBusyIds((s) => withId(s, userId));
    try {
      if (trusted) await addTrustRule(userId, workspaceId);
      else await removeTrustRule(userId, workspaceId);
      await refetchTrust();
    } catch (err) {
      toast({
        title: err instanceof ChannelApiError ? err.message : "Couldn't update trust",
      });
    } finally {
      // Dropping the override reveals the refetched server value on success and
      // reverts the toggle on failure.
      setTrustOverride((m) => {
        const next = { ...m };
        delete next[userId];
        return next;
      });
      setTrustBusyIds((s) => withoutId(s, userId));
    }
  }

  async function handleDecideConsent(id: string, decision: "allow" | "deny") {
    if (consentBusyIds.has(id)) return;
    setConsentBusyIds((s) => withId(s, id));
    setDecidedConsentIds((s) => withId(s, id));
    try {
      await decideConsent(id, decision, workspaceId);
      await refetchConsent();
    } catch (err) {
      toast({
        title: err instanceof ChannelApiError ? err.message : "Couldn't record decision",
      });
    } finally {
      // On success the refetched inbox no longer carries the row, so dropping
      // the override is a no-op; on failure it puts the card back.
      setDecidedConsentIds((s) => withoutId(s, id));
      setConsentBusyIds((s) => withoutId(s, id));
    }
  }

  // Trust reads through the same optimistic-override lens as the per-channel
  // preferences above, so a toggle flips instantly instead of after a round trip.
  const effectiveTrustedIds = useMemo(() => {
    const ids = Object.keys(trustOverride);
    if (ids.length === 0) return trustedIds;
    const next = new Set(trustedIds);
    for (const id of ids) {
      if (trustOverride[id]) next.add(id);
      else next.delete(id);
    }
    return next;
  }, [trustedIds, trustOverride]);

  const effectiveNotifyScope: NotifyScope = selected
    ? scopeOverride[selected.id] ?? selected.myNotifyScope ?? "all"
    : "all";

  const channelForThread = selected
    ? {
        ...selected,
        myAgentToolProfile:
          toolOverride[selected.id] ?? selected.myAgentToolProfile ?? "full",
      }
    : null;

  // Never leave a DM (Q2): dropping one of the pair's two membership rows
  // destroys it permanently, so the server refuses and the menu offers the
  // reversible "Delete conversation" instead. Guarded here too — nothing may
  // send the destructive request for a direct channel.
  const handleLeave = () =>
    selected &&
    !selected.isDirect &&
    void withChannelError(async () => {
      await removeChannelMember(selected.id, currentUserId, workspaceId);
      setSelectedId(null);
    }, "Couldn't leave the channel");

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
          notifyScope={effectiveNotifyScope}
          members={members}
          currentUserId={currentUserId}
          consentRequests={channelConsent}
          trustedIds={effectiveTrustedIds}
          trustBusyIds={trustBusyIds}
          consentBusyIds={consentBusyIds}
          onSend={handleSend}
          onCreateThread={handleCreateThread}
          onCloseThread={handleCloseThread}
          onReopenThread={handleReopenThread}
          onInvite={() => setInviteOpen(true)}
          onSetNotifyScope={handleSetNotifyScope}
          onSetToolProfile={handleSetToolProfile}
          onToggleTrust={handleToggleTrust}
          onDecideConsent={handleDecideConsent}
          onToggleArchive={handleToggleArchive}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDelete}
          onJoin={handleJoin}
          onLeave={handleLeave}
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
