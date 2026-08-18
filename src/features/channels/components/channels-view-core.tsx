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
import { GoPublicDialog, needsGoPublicConfirm } from "./go-public-dialog";
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
 * Channels page root — two-pane master/detail: searchable channel list left,
 * selected channel's thread + composer right, plus the human-in-the-loop
 * surfaces (consent inbox, per-teammate trust, agent tool profiles, presence).
 * All client-fetched via `useApiQuery`; MCP / agent / desktop writes surface
 * through the realtime hooks — ⚠ refetch, NEVER merge.
 *
 * ⚠ The writes live in three hooks, not here: `use-thread-writes` (send / open /
 * close / reopen), `use-channel-preference-writes` (tool profile, trust,
 * consent), `use-channel-lifecycle-writes` (archive / visibility / delete /
 * join / leave). All three are on `useApiMutation` and patch the query cache
 * directly, so this file holds NO optimistic lens of its own.
 *
 * ⚠ All three also take `gate`. `useRefetchGate` owns one counter and every
 * mutation's `settleWith` feeds it, so the coordinator covers the whole feature;
 * a write that throws still releases the deferred refetch.
 *
 * ⚠ Next-free by construction so the desktop SPA can bundle it — the only router
 * dependency (the first-run explainer's step links) arrives as the `Link` prop.
 * `./channels-view` is the web app's `next/link` binding.
 *
 * ⚠ In the bundled SPA the realtime hooks below are deliberate NO-OPS
 * (`shared-channel-registry.ts` short-circuits when `window.dopl` is present),
 * so surfaces refresh on the consent poll, each mutation's settle-time
 * invalidations, and TanStack's focus revalidation instead.
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
  const [goPublicOpen, setGoPublicOpen] = useState(false);
  // ⚠ Double-fire guards ONLY — the optimistic half is a cache patch, so nothing
  // here mirrors a server value.
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

  // Explicit pick that still exists wins, else the first row.
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
  // ⚠ THE READ STILL REPORTS `stale` and this page no longer reads it. It fed
  // the composer's request mode — a roster kept on screen by `keepPreviousData`
  // through a channel switch would have become the posted `toUserId` — and
  // request mode is retired here (wiring plan Phase 3). The hook keeps the flag
  // because it is a property of the READ, and the v2 composer resolves its
  // addressees from the same roster; whoever wires that gate next needs it
  // still to exist. Do not delete it from `use-channel-members.ts`.
  const { members, refetch: refetchMembers } = useChannelMembers(
    selected?.id ?? null,
    workspaceId
  );
  const {
    threads,
    loading: threadsLoading,
    refetch: refetchThreads,
  } = useChannelThreads(selected?.id ?? null, workspaceId);
  // ⚠ Poll BACKSTOP scoped to THIS page, not the sidebar badge — for a downed
  // realtime socket only (consent INSERTs do arrive over realtime). Pauses while
  // the tab is hidden. See CONSENT_INBOX_POLL_MS.
  const { inbound, outbound } = useConsentInbox(
    workspaceId,
    undefined,
    CONSENT_INBOX_POLL_MS
  );
  const { trustedIds } = useTrustRules(workspaceId);

  // Pending consent for the SELECTED channel plus the set of every channel with
  // something pending. A decided request leaves the inbox cache at once, so
  // nothing is filtered here.
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
  // `gate` is handed to each mutation's `settleWith`, so a write that throws
  // still releases the deferred refetch.
  const refetchRef = useRef<() => void>(() => {});
  refetchRef.current = () => {
    void refetchChannels();
    void refetchMessages();
    void refetchMembers();
    // create/close_thread post a message, so the signal that refreshes messages
    // also refreshes the thread overlay. `set_thread_mode` posts none and is
    // eventually consistent.
    void refetchThreads();
  };
  const { signal, gate } = useRefetchGate(() => refetchRef.current());
  useChannelsRealtime(workspaceId, signal);
  // Presence is high-churn (~30s per listener) and never clobbers a send, so it
  // bypasses the coordinator — but refetches the ROSTER only, on a trailing
  // debounce. ⚠ The channel list is deliberately NOT refetched: that read does a
  // workspace-wide presence scan plus a per-channel member fan-out and adds only
  // `onlineMemberCount`, which nothing renders.
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
    // Freshness window is 90s, so coalescing a burst loses nothing.
    if (presenceTimerRef.current) return;
    presenceTimerRef.current = setTimeout(() => {
      presenceTimerRef.current = null;
      membersRefetchRef.current();
    }, PRESENCE_REFETCH_DEBOUNCE_MS);
  });

  // Author display for a pending row, so an optimistic message does not render
  // as "Member" for a round trip and then rename itself.
  const me = members.find((m) => m.userId === currentUserId) ?? null;
  // ⚠ `openThread` is NOT destructured any more. This page's REQUEST mode is
  // retired (wiring plan Phase 3 — the plain composer is human chat), so the
  // single-target create has no caller HERE. `openThreadConfig` itself stays:
  // it is the web half of `create_thread`, which the desktop and MCP lanes
  // still post, and Phase 5's surfaces are its next callers.
  const { send, threadOp } = useThreadWrites({
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
      // ⚠ Captured at SUBMIT — a channel switch mid-flight must not move this
      // write into another channel's cache.
      channelId: selected.id,
      clientMsgId: newClientMsgId(),
      body,
      intent: opts?.intent,
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

  /**
   * ⚠ WIDENING TAKES A HUMAN: private→public opens the confirm dialog and the
   * write runs from there; public→private narrows the audience and goes straight
   * through. The decision lives in `go-public-dialog.tsx`, beside the copy.
   */
  function handleToggleVisibility() {
    if (!selected) return;
    if (needsGoPublicConfirm(selected.visibility)) {
      setGoPublicOpen(true);
      return;
    }
    lifecycle.toggleVisibility();
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
      // Rollback + toast are the mutation's; this only clears the guard.
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
    } finally {
      setConsentBusyIds((s) => withoutId(s, id));
    }
  }

  // ⚠ A row with no profile resolves the way the DESKTOP resolves it
  // (`UNRESOLVED_TOOL_PROFILE`) — the settings popover renders this as a
  // containment claim, so the web must never pick a wider answer.
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
          currentUserId={currentUserId}
          consentRequests={channelConsent}
          trustedIds={trustedIds}
          trustBusyIds={trustBusyIds}
          consentBusyIds={consentBusyIds}
          onSend={handleSend}
          onCloseThread={handleCloseThread}
          onReopenThread={handleReopenThread}
          onInvite={() => setInviteOpen(true)}
          onSetToolProfile={handleSetToolProfile}
          toolProfileBusy={prefs.toolProfile.pending}
          onToggleTrust={handleToggleTrust}
          onDecideConsent={handleDecideConsent}
          onToggleArchive={lifecycle.toggleArchive}
          onToggleVisibility={handleToggleVisibility}
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
        <GoPublicDialog
          open={goPublicOpen}
          onOpenChange={setGoPublicOpen}
          displayName={selected.name}
          onConfirm={lifecycle.toggleVisibility}
        />
      )}

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
