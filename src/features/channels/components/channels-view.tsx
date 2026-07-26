"use client";

import { useMemo, useRef, useState } from "react";
import { Hash } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { toast } from "@/shared/ui/toast";
import { createRefetchCoordinator } from "@/shared/realtime/refetch-coordinator";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import {
  addChannelMember,
  ChannelApiError,
  deleteChannel as apiDeleteChannel,
  postMessage,
  removeChannelMember,
  updateChannel as apiUpdateChannel,
} from "../client/api";
import { useChannels } from "../hooks/use-channels";
import { useChannelMessages } from "../hooks/use-channel-messages";
import { useChannelsRealtime } from "../client/realtime";
import { ChannelsListPane, type ChannelTab } from "./channels-list-pane";
import { ChannelThread } from "./channel-thread";
import { ChannelsSkeleton } from "./channels-skeleton";
import { CreateChannelDialog } from "./create-channel-dialog";
import { InviteDialog } from "./invite-dialog";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
}

/**
 * Channels page root — a two-pane `.page-float` master/detail surface:
 * the searchable channel list on the left, the selected channel's thread
 * + composer on the right. Client-fetched via `useApiQuery`; MCP/agent
 * writes (and other tabs) surface live through `useChannelsRealtime`, which
 * refetches through the coordinator so an in-flight send isn't clobbered.
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

  const canCreate = meetsMinRole(role, "member");

  const { channels, loading, refetch: refetchChannels } = useChannels(
    workspaceId,
    tab === "archived"
  );

  const displayChannels = useMemo(
    () =>
      tab === "archived"
        ? channels.filter((c) => c.archivedAt !== null)
        : channels,
    [channels, tab]
  );

  // Derived effective selection: an explicit pick that still exists wins,
  // else the first row — so the thread always shows something real.
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

  // Realtime → coalesced refetch, deferred while a local send is in flight.
  const busyRef = useRef(0);
  const refetchRef = useRef<() => void>(() => {});
  refetchRef.current = () => {
    void refetchChannels();
    void refetchMessages();
  };
  const coordinatorRef = useRef(
    createRefetchCoordinator(() => refetchRef.current())
  );
  useChannelsRealtime(workspaceId, () =>
    coordinatorRef.current.request(busyRef.current > 0)
  );

  async function withChannelError(fn: () => Promise<void>, fallback: string) {
    try {
      await fn();
      void refetchChannels();
    } catch (err) {
      toast({ title: err instanceof ChannelApiError ? err.message : fallback });
    }
  }

  async function handleSend(body: string) {
    if (!selected) return;
    busyRef.current += 1;
    try {
      await postMessage(selected.id, { body }, workspaceId);
      await refetchMessages();
      void refetchChannels();
    } catch (err) {
      toast({
        title: err instanceof ChannelApiError ? err.message : "Couldn't send",
      });
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
    }, "Couldn't join the channel");

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
      />

      {selected ? (
        <ChannelThread
          key={selected.id}
          channel={selected}
          messages={messages}
          loading={messagesLoading}
          onSend={handleSend}
          onInvite={() => setInviteOpen(true)}
          onToggleArchive={handleToggleArchive}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDelete}
          onJoin={handleJoin}
          onLeave={handleLeave}
        />
      ) : (
        <EmptyState
          icon={Hash}
          title={
            tab === "archived" ? "No archived channels" : "No channel selected"
          }
          description={
            canCreate && tab === "active"
              ? "Create a channel to start a shared thread for your team and their agents."
              : undefined
          }
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
          onChanged={() => void refetchChannels()}
        />
      )}
    </div>
  );
}
