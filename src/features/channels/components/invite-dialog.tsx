"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, UserMinus } from "lucide-react";
import { ModalShell } from "@/shared/layout/settings-modal";
import { SearchField } from "@/shared/ui/search-field";
import { Avatar } from "@/shared/ui/avatar";
import { toast } from "@/shared/ui/toast";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceMemberView } from "@/features/members/types";
import type { ChannelMember } from "../types";
import {
  addChannelMember,
  ChannelApiError,
  removeChannelMember,
} from "../client/api";
import { PresenceDot } from "./address-picker";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  channelId: string;
  currentUserId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refetch the channels list so member counts stay honest. */
  onChanged: () => void;
}

const selectWsMembers = (body: { members: WorkspaceMemberView[] }) =>
  body.members ?? [];
const selectChannelMembers = (body: { members: ChannelMember[] }) =>
  body.members ?? [];

/**
 * Add / remove channel members. The picker sources ACTIVE workspace
 * members (the same list the Members page renders) minus those already in
 * the channel — in-workspace invites only, v1.
 */
export function InviteDialog({
  workspaceId,
  workspaceSlug,
  channelId,
  currentUserId,
  canManage,
  open,
  onOpenChange,
  onChanged,
}: Props) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const membersPath = `/api/channels/${encodeURIComponent(channelId)}/members`;
  const wsMembersPath = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`;

  const { data: channelMembers } = useApiQuery<
    { members: ChannelMember[] },
    ChannelMember[]
  >(open ? membersPath : null, {
    workspaceId,
    select: selectChannelMembers,
  });
  const { data: wsMembers } = useApiQuery<
    { members: WorkspaceMemberView[] },
    WorkspaceMemberView[]
  >(open ? wsMembersPath : null, { select: selectWsMembers });

  const memberIds = useMemo(
    () => new Set((channelMembers ?? []).map((m) => m.userId)),
    [channelMembers]
  );

  const q = query.trim().toLowerCase();
  const addable = (wsMembers ?? []).filter(
    (m) =>
      m.status === "active" &&
      !memberIds.has(m.userId) &&
      (q === "" ||
        (m.displayName ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q))
  );

  function refresh() {
    void qc.invalidateQueries({ queryKey: [membersPath] });
    onChanged();
  }

  async function add(userId: string) {
    setBusyId(userId);
    try {
      await addChannelMember(channelId, userId, workspaceId);
      refresh();
    } catch (err) {
      toast({
        title: err instanceof ChannelApiError ? err.message : "Couldn't add member",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(userId: string) {
    setBusyId(userId);
    try {
      await removeChannelMember(channelId, userId, workspaceId);
      refresh();
    } catch (err) {
      toast({
        title: err instanceof ChannelApiError ? err.message : "Couldn't remove member",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      label="Channel members"
      size="narrow"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h2 className="text-title font-semibold text-text-primary">
            Channel members
          </h2>
          <p className="text-caption text-text-secondary">
            Add workspace members to this channel.
          </p>
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search members"
        />

        <div className="flex max-h-[240px] flex-col overflow-y-auto rounded-[10px] border border-border-strong">
          {addable.length === 0 ? (
            <p className="px-3 py-4 text-center text-caption text-text-muted">
              {q ? "No members match." : "Everyone is already in this channel."}
            </p>
          ) : (
            addable.map((m) => (
              <button
                key={m.userId}
                type="button"
                disabled={busyId === m.userId}
                onClick={() => void add(m.userId)}
                className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-raised-1 disabled:opacity-60"
              >
                <Avatar person={m} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-text-primary">
                    {m.displayName || m.email || m.userId}
                  </span>
                  {m.displayName && m.email && (
                    <span className="block truncate text-caption text-text-muted">
                      {m.email}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-text-secondary">
                  Add
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            In this channel · {channelMembers?.length ?? 0}
          </span>
          <ul className="flex flex-col divide-y divide-border-subtle rounded-[10px] border border-border-strong">
            {(channelMembers ?? []).map((m) => {
              const removable =
                m.userId === currentUserId || (canManage && m.role !== "owner");
              return (
                <li key={m.userId} className="flex items-center gap-2.5 px-3 py-2">
                  <Avatar
                    person={{
                      userId: m.userId,
                      email: m.email,
                      displayName: m.displayName,
                      avatarUrl: m.avatarUrl,
                    }}
                    size="xs"
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                    {m.displayName || m.email || m.userId}
                  </span>
                  <span
                    className="flex shrink-0 items-center gap-1 text-micro text-text-muted"
                    title={m.agentOnline ? "Agent listening" : "Agent offline"}
                  >
                    <PresenceDot online={m.agentOnline} />
                    {m.agentOnline ? "listening" : "offline"}
                  </span>
                  <span className="shrink-0 text-micro font-medium uppercase tracking-wide text-text-muted">
                    {m.role}
                  </span>
                  {removable && (
                    <button
                      type="button"
                      disabled={busyId === m.userId}
                      onClick={() => void remove(m.userId)}
                      aria-label="Remove member"
                      title={m.userId === currentUserId ? "Leave" : "Remove"}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:text-danger disabled:opacity-60"
                    >
                      <UserMinus size={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="flex h-10 items-center justify-center gap-1.5 rounded-[9px] text-body font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
        >
          <Check size={14} />
          Done
        </button>
      </div>
    </ModalShell>
  );
}
