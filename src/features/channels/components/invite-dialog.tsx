"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Info, UserMinus } from "lucide-react";
// Deep import, not the `settings-modal` barrel: the barrel also re-exports
// SettingsModal, whose section tree reaches `next/navigation`. This dialog is
// bundled by the desktop SPA, where a `next/*` module anywhere in the graph
// fails the build (apps/desktop-ui/CONVENTIONS.md § Sharing code).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SearchField } from "@/shared/ui/search-field";
import { Avatar } from "@/shared/ui/avatar";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { toast } from "@/shared/ui/toast";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceMemberView } from "@/features/members/types";
import type { ChannelMember } from "../types";
import {
  addChannelMember,
  ChannelApiError,
  removeChannelMember,
} from "../client/api";

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
 * The two rules a channel runs on, stated where a person changes its roster.
 *
 * This dialog is the only place someone CHANGES how a channel routes, and it is
 * where the addressing rule and the thread rule are stated in the channels tree
 * (INVARIANTS §5 names this file as one of the web's two statements of it).
 *
 * ⚠ **NO LONGER COUNT-KEYED, AND THAT IS THE FIX.** Phase 3 (2026-08-18) made
 * addressing explicit at EVERY member count — the implicit 1:1 trigger and the
 * server-side DM auto-address were retired together — but this note kept the
 * old shape: copy reading "In a channel of 3 or more…" behind a
 * `memberCount < GROUP_CHANNEL_MIN_MEMBERS - 1` gate. **Both halves taught the
 * retired rule.** A two-person channel is precisely where the interface most
 * strongly implies an implicit recipient, so gating the note there hid it from
 * the person most likely to be wrong about it.
 *
 * ⚠ **THE CALL, STATED: it shows ALWAYS, and takes no props.** The alternatives
 * were "never" (the composer already says it) and "always". Never is wrong:
 * `channels-v2/composer-request-panel.tsx`'s "No agent addressed — this thread
 * reaches nobody." speaks at SEND time inside the New-agent-thread panel — it
 * reports a
 * draft's state, and it never explains the thread rule (channel-visible reads,
 * pair-only writes) at all, which is this note's second sentence and is stated
 * nowhere else on this surface. Unconditional also removes the note's own
 * flash-on-load problem: there is no roster length to wait for, so nothing
 * appears a beat after the dialog opens.
 *
 * Pure and exported so it renders (and asserts) without the dialog's query
 * provider.
 */
export function GroupChannelRoutingNote() {
  return (
    <div className="flex gap-1.5 rounded-[10px] border border-border-subtle bg-bg-inset px-3 py-2 text-caption text-text-secondary">
      <Info size={13} className="mt-0.5 shrink-0 text-text-muted" />
      <p>
        A message reaches an agent only when you address it to someone. That is
        true at every channel size, a two-person channel included — unaddressed
        messages reach nobody. Threads stay between two people: everyone in the
        channel can read one, only its two participants can post into it.
      </p>
    </div>
  );
}

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
  /**
   * The member the ⊖ button is asking about. `remove()` is a real membership
   * DELETE and this row used to fire it on a single click with no dialog —
   * including on the CURRENT USER's own row, which is removable by design
   * (`removeMember`'s `isSelf` branch skips the manage check). On a private
   * channel that is unrecoverable by the person who clicked it: `listChannels`
   * shows public channels plus your own, and `addMember` only lets you self-join
   * a PUBLIC one. Confirm first, in both directions.
   */
  const [pendingRemove, setPendingRemove] = useState<ChannelMember | null>(null);

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

        <GroupChannelRoutingNote />

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
                  <AvatarWithPresence
                    person={{
                      userId: m.userId,
                      email: m.email,
                      displayName: m.displayName,
                      avatarUrl: m.avatarUrl,
                    }}
                    online={m.agentOnline}
                    size="xs"
                    title={m.agentOnline ? "Agent listening" : "Agent offline"}
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                    {m.displayName || m.email || m.userId}
                  </span>
                  <span className="shrink-0 text-micro text-text-muted">
                    {m.agentOnline ? "listening" : "offline"}
                  </span>
                  <span className="shrink-0 text-micro font-medium uppercase tracking-wide text-text-muted">
                    {m.role}
                  </span>
                  {removable && (
                    <button
                      type="button"
                      disabled={busyId === m.userId}
                      onClick={() => setPendingRemove(m)}
                      aria-label={
                        m.userId === currentUserId
                          ? "Leave channel"
                          : "Remove member"
                      }
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

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="auth-btn-3d-light flex h-10 items-center justify-center gap-1.5 rounded-[9px] px-4 text-body font-medium text-text-primary"
          >
            <Check size={14} />
            Done
          </button>
        </div>
      </div>

      {/* SELF-REMOVAL STAYS ON THIS ROW rather than routing to the pane's
          "Leave channel" dialog: that would mean closing this modal to open
          another one, and this list is where the user is already looking. It
          borrows that dialog's VERB and VOICE instead, so the two surfaces
          never disagree about what leaving costs. Copy hedges on visibility
          because this dialog is given a channel id, not a `visibility` — the
          "if it's private" clause is true either way, where naming the wrong
          one would not be. (ConfirmDialog nests inside a ModalShell by
          precedent — see the settings modal's danger zone.) */}
      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(o) => !o && setPendingRemove(null)}
        title={
          pendingRemove?.userId === currentUserId
            ? "Leave this channel?"
            : "Remove from channel?"
        }
        description={
          pendingRemove?.userId === currentUserId
            ? "You'll lose access to this channel and its messages. If it's private you can't rejoin on your own — another member would have to invite you back."
            : `${pendingRemove?.displayName || pendingRemove?.email || "This member"} will lose access to this channel and its messages. If it's private they can't rejoin on their own — someone would have to invite them back.`
        }
        confirmLabel={
          pendingRemove?.userId === currentUserId ? "Leave" : "Remove"
        }
        destructive
        // Deliberately does NOT clear `pendingRemove` first: ConfirmDialog
        // holds its own busy state for the duration of this promise and closes
        // itself on resolve, so clearing early would swap the spinner for a
        // vanished dialog. `remove()` toasts its own errors and never throws,
        // so the dialog always closes exactly once.
        onConfirm={async () => {
          if (pendingRemove) await remove(pendingRemove.userId);
          setPendingRemove(null);
        }}
      />
    </ModalShell>
  );
}
