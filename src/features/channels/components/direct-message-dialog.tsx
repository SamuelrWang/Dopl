"use client";

import { useState } from "react";
// Deep import, not the `settings-modal` barrel: the barrel also re-exports
// SettingsModal, whose section tree reaches `next/navigation`. This dialog is
// bundled by the desktop SPA, where a `next/*` module anywhere in the graph
// fails the build (apps/desktop-ui/CONVENTIONS.md § Sharing code).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { SearchField } from "@/shared/ui/search-field";
import { Avatar } from "@/shared/ui/avatar";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceMemberView } from "@/features/members/types";
import type { Channel } from "../types";
import { ChannelApiError, createChannel } from "../client/api";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: Channel) => void;
}

const selectWsMembers = (body: { members: WorkspaceMemberView[] }) =>
  body.members ?? [];

/**
 * New direct message dialog: pick one active workspace member (minus self) and
 * open a 1:1 channel with them. There is no name / topic / visibility — a
 * direct channel takes its identity from the peer. Dedup is server-side:
 * opening a DM to someone you already have one with returns that channel, so
 * `onCreated` always lands on the right thread.
 */
export function DirectMessageDialog({
  workspaceId,
  workspaceSlug,
  currentUserId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsMembersPath = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`;
  const { data: wsMembers } = useApiQuery<
    { members: WorkspaceMemberView[] },
    WorkspaceMemberView[]
  >(open ? wsMembersPath : null, { select: selectWsMembers });

  const q = query.trim().toLowerCase();
  const people = (wsMembers ?? []).filter(
    (m) =>
      m.status === "active" &&
      m.userId !== currentUserId &&
      (q === "" ||
        (m.displayName ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q))
  );

  function close() {
    onOpenChange(false);
    setQuery("");
    setBusyId(null);
    setError(null);
  }

  async function openDirect(memberUserId: string) {
    if (busyId) return;
    setBusyId(memberUserId);
    setError(null);
    try {
      const channel = await createChannel(
        { direct: true, memberUserId },
        workspaceId
      );
      onCreated(channel);
      close();
    } catch (err) {
      setError(
        err instanceof ChannelApiError
          ? err.message
          : "Couldn't open the direct message"
      );
      setBusyId(null);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={close}
      label="New direct message"
      size="narrow"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h2 className="text-title font-semibold text-text-primary">
            New direct message
          </h2>
          <p className="text-caption text-text-secondary">
            Start a private 1:1 thread with a teammate and their agent.
          </p>
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search members"
        />

        <div className="flex max-h-[280px] flex-col overflow-y-auto rounded-[10px] border border-border-strong">
          {people.length === 0 ? (
            <p className="px-3 py-4 text-center text-caption text-text-muted">
              {q ? "No members match." : "No other members yet."}
            </p>
          ) : (
            people.map((m) => (
              <button
                key={m.userId}
                type="button"
                disabled={busyId === m.userId}
                onClick={() => void openDirect(m.userId)}
                className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-raised-1 disabled:opacity-60"
              >
                <Avatar
                  person={{
                    userId: m.userId,
                    email: m.email,
                    displayName: m.displayName,
                    avatarUrl: m.avatarUrl,
                  }}
                  size="xs"
                />
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
                  {busyId === m.userId ? "Opening…" : "Message"}
                </span>
              </button>
            ))
          )}
        </div>

        {error && <p className="text-caption text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="auth-btn-3d-light h-10 rounded-[9px] px-4 text-body font-medium text-text-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
