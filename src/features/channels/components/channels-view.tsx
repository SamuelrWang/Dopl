"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createRefetchCoordinator } from "@/shared/realtime/refetch-coordinator";
import { toast } from "@/shared/ui/toast";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  addChannelMember,
  addTrustRule,
  ChannelApiError,
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
import { useConsentInbox } from "../hooks/use-consent-inbox";
import { useTrustRules } from "../hooks/use-trust-rules";
import { useChannelsRealtime, usePresenceRealtime } from "../client/realtime";
import { ChannelsListPane, type ChannelTab } from "./channels-list-pane";
import { ChannelThread } from "./channel-thread";
import { ChannelsSkeleton } from "./channels-skeleton";
import { ChannelsOnboarding } from "./channels-onboarding";
import { CreateChannelDialog } from "./create-channel-dialog";
import { InviteDialog } from "./invite-dialog";
import type { SendOptions } from "./message-composer";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
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
 */
export function ChannelsView({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
}: Props) {
  const [tab, setTab] = useState<ChannelTab>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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
  // Poll fallback scoped to THIS page (not the sidebar badge) so a pending
  // request appears within a few seconds even when Realtime drops the consent
  // INSERT; pauses automatically while the tab is hidden (TanStack default).
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
  // which nothing renders (the header derives "N listening" from the roster).
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
        { body, toUserId: opts?.toUserId, summary: opts?.summary },
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

  const handleLeave = () =>
    selected &&
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
        consentChannelIds={consentChannelIds}
      />

      {channelForThread ? (
        <ChannelThread
          key={channelForThread.id}
          channel={channelForThread}
          messages={messages}
          loading={messagesLoading}
          notifyScope={effectiveNotifyScope}
          members={members}
          currentUserId={currentUserId}
          consentRequests={channelConsent}
          trustedIds={effectiveTrustedIds}
          trustBusyIds={trustBusyIds}
          consentBusyIds={consentBusyIds}
          onSend={handleSend}
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
        <ChannelsOnboarding
          workspaceSlug={workspaceSlug}
          canCreate={canCreate}
          onCreate={() => setCreateOpen(true)}
        />
      )}

      <CreateChannelDialog
        workspaceId={workspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(channel) => {
          setTab("active");
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
