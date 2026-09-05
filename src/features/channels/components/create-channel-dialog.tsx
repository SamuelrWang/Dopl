"use client";

import { useEffect, useState } from "react";
import { Check, Folder, FolderOpen } from "lucide-react";
// Deep import, not the `settings-modal` barrel: the barrel also re-exports
// SettingsModal, whose section tree reaches `next/navigation`. This dialog is
// bundled by the desktop SPA, where a `next/*` module anywhere in the graph
// fails the build (apps/desktop-ui/CONVENTIONS.md § Sharing code).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SearchField } from "@/shared/ui/search-field";
import { Avatar } from "@/shared/ui/avatar";
import { toast } from "@/shared/ui/toast";
import { useApiQuery } from "@/shared/hooks/use-api-query";
// The Next-free half of `use-auth-user`: this dialog only needs "who is
// logged in", not the sign-out navigation that pulls in `next/navigation`.
import { useAuthUserState } from "@/shared/auth/use-auth-user-core";
import {
  getDesktopChannelFolders,
  type ChannelFolderAnswer,
  type DoplChannelsBridge,
} from "@/shared/lib/desktop";
import type { WorkspaceMemberView } from "@/features/members/types";
import type { Channel, ChannelVisibility } from "../types";
import { addChannelMember, ChannelApiError, createChannel } from "../client/api";

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: Channel) => void;
}

const selectWsMembers = (body: { members: WorkspaceMemberView[] }) =>
  body.members ?? [];

/**
 * Create-channel dialog. Phase 1 collects name, optional topic, a visibility
 * choice (private = members only, public = the whole workspace) and an
 * optional set of members to add on creation. On "Create" the channel is made
 * first (so its id exists), the selected members are added best-effort, and
 * `onCreated` fires.
 *
 * Phase 2 — the "Set agent folder" step — appears ONLY inside the desktop
 * shell (feature-detected on the `window.dopl.channels` bridge). It reuses the
 * existing per-channel folder IPC keyed by the freshly created channel id. In
 * a plain browser there is no bridge, so phase 2 is skipped and the dialog
 * closes on create.
 */
export function CreateChannelDialog({
  workspaceId,
  workspaceSlug,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const user = useAuthUserState();
  const selfId = user?.id ?? null;

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<ChannelVisibility>("private");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [memberQuery, setMemberQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 2 (desktop-only folder step) state.
  const [phase, setPhase] = useState<"form" | "folder">("form");
  const [createdChannel, setCreatedChannel] = useState<Channel | null>(null);
  const [folderBridge, setFolderBridge] = useState<DoplChannelsBridge | null>(
    null
  );
  /** ⚠ THE PAIR, NOT A LABEL (2026-09-05, task 15). This held `string | null` and
   *  printed "Sandbox (default)" over the null — a place that does not exist. Main
   *  now answers the EFFECTIVE directory plus whether it is a per-channel pick. */
  const [folderAnswer, setFolderAnswer] = useState<ChannelFolderAnswer | null>(
    null
  );
  const [folderBusy, setFolderBusy] = useState(false);

  // Feature-detect the desktop bridge after mount so SSR and first client
  // render agree (window-only).
  useEffect(() => {
    setFolderBridge(getDesktopChannelFolders());
  }, []);

  const wsMembersPath = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`;
  const { data: wsMembers } = useApiQuery<
    { members: WorkspaceMemberView[] },
    WorkspaceMemberView[]
  >(open ? wsMembersPath : null, { select: selectWsMembers });

  const mq = memberQuery.trim().toLowerCase();
  // Hold the member rows until `selfId` resolves: with a null selfId the
  // `m.userId !== selfId` self-exclusion can't fire, so the caller would briefly
  // see (and could select) their own row before it vanishes. The ws-members
  // query only runs while the dialog is open and takes a network round trip, so
  // selfId (from the cached auth user) is effectively always ready first — this
  // guard adds no perceptible delay, just removes the self-flicker.
  const addableMembers =
    selfId === null
      ? []
      : (wsMembers ?? []).filter(
          (m) =>
            m.status === "active" &&
            m.userId !== selfId &&
            (mq === "" ||
              (m.displayName ?? "").toLowerCase().includes(mq) ||
              (m.email ?? "").toLowerCase().includes(mq))
        );

  function reset() {
    setName("");
    setTopic("");
    setVisibility("private");
    setSelectedIds(new Set());
    setMemberQuery("");
    setError(null);
    setSubmitting(false);
    setPhase("form");
    setCreatedChannel(null);
    setFolderAnswer(null);
    setFolderBusy(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  function toggleMember(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function submit() {
    const trimmed = name.trim();
    if (trimmed === "" || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const channel = await createChannel(
        { name: trimmed, topic: topic.trim() || undefined, visibility },
        workspaceId
      );

      // Add the picked members best-effort — the channel already exists, so a
      // single member failure shouldn't discard the whole creation.
      const ids = [...selectedIds];
      if (ids.length > 0) {
        const results = await Promise.allSettled(
          ids.map((id) => addChannelMember(channel.id, id, workspaceId))
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast({
            title: `Channel created, but couldn't add ${failed} member${
              failed === 1 ? "" : "s"
            }.`,
          });
        }
      }

      onCreated(channel);

      if (folderBridge) {
        // Desktop: keep the popup open for the optional folder step.
        setCreatedChannel(channel);
        // ⚠ ASK, rather than starting from a null this file would have to name. A
        // fresh channel already HAS an effective folder — the desktop default — and
        // main is the only thing that knows which one it is.
        setFolderAnswer(null);
        void folderBridge
          .getFolderLabel(channel.id)
          .then(setFolderAnswer)
          .catch(() => setFolderAnswer(null));
        setPhase("folder");
      } else {
        // Plain browser: nothing more to do.
        close();
      }
    } catch (err) {
      setError(
        err instanceof ChannelApiError ? err.message : "Couldn't create the channel"
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseFolder() {
    if (!folderBridge || !createdChannel || folderBusy) return;
    setFolderBusy(true);
    try {
      const next = await folderBridge.chooseFolder(createdChannel.id);
      setFolderAnswer(next);
    } catch {
      // Cancelled / failed picker — keep the current answer.
    } finally {
      setFolderBusy(false);
    }
  }

  async function resetFolder() {
    if (!folderBridge || !createdChannel || folderBusy) return;
    setFolderBusy(true);
    try {
      // ⚠ ADOPT THE REPLY. The reset lands on a REAL default and main names it;
      // blanking the state here is what forced the invented label downstream.
      setFolderAnswer(await folderBridge.clearFolder(createdChannel.id));
    } catch {
      // Keep the current answer if the reset failed.
    } finally {
      setFolderBusy(false);
    }
  }

  const hasCustomFolder = folderAnswer?.custom ?? false;

  return (
    <ModalShell open={open} onClose={close} label="New channel" size="narrow">
      {phase === "form" ? (
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h2 className="text-title font-semibold text-text-primary">
              New channel
            </h2>
            <p className="text-caption text-text-secondary">
              A shared thread for your team and their agents.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              maxLength={120}
              autoFocus
              placeholder="e.g. Release planning"
              className="concave-field h-9 rounded-[9px] px-3 text-body text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Topic{" "}
              <span className="font-normal normal-case text-text-muted">
                (optional)
              </span>
            </span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={2000}
              placeholder="What is this channel about?"
              className="concave-field h-9 rounded-[9px] px-3 text-body text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Visibility
            </span>
            <SegmentedControl
              options={[
                { key: "private" as const, label: "Private" },
                { key: "public" as const, label: "Public" },
              ]}
              value={visibility}
              onChange={setVisibility}
            />
            <p className="text-caption text-text-muted">
              {visibility === "private"
                ? "Only people you add can see and post."
                : "Any workspace member can see and join."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Members{" "}
              <span className="font-normal normal-case text-text-muted">
                (optional)
              </span>
            </span>
            <SearchField
              value={memberQuery}
              onChange={setMemberQuery}
              placeholder="Search members"
            />
            <div className="flex max-h-[180px] flex-col overflow-y-auto rounded-[10px] border border-border-strong">
              {addableMembers.length === 0 ? (
                <p className="px-3 py-4 text-center text-caption text-text-muted">
                  {mq ? "No members match." : "No other members to add."}
                </p>
              ) : (
                addableMembers.map((m) => {
                  const selected = selectedIds.has(m.userId);
                  return (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => toggleMember(m.userId)}
                      aria-pressed={selected}
                      className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-surface-raised-1"
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
                      <span
                        aria-hidden
                        className={
                          selected
                            ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-text-primary text-bg-elevated"
                            : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-text-muted"
                        }
                      >
                        {selected && <Check size={12} />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            {selectedIds.size > 0 && (
              <p className="text-caption text-text-muted">
                {selectedIds.size} to add on create.
              </p>
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
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || name.trim() === ""}
              className="auth-btn-3d h-10 rounded-[9px] px-4 text-body font-medium text-white disabled:opacity-40"
            >
              {submitting ? "Creating…" : "Create channel"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h2 className="text-title font-semibold text-text-primary">
              Set agent folder
            </h2>
            <p className="text-caption text-text-secondary">
              Where this channel&apos;s agent runs on your Mac. Context, not a
              sandbox. You can change this anytime.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
              Folder
            </span>
            <div className="truncate rounded-[9px] border border-border-subtle bg-bg-inset px-3 py-2 text-body text-text-secondary">
              {/* ⚠ THE EFFECTIVE FOLDER, whatever it is, and NOTHING INVENTED while
                  the answer is outstanding — an empty box for one frame is honest
                  where "Sandbox (default)" never was (INVARIANTS §11). */}
              {folderAnswer?.label ?? ""}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void chooseFolder()}
                disabled={folderBusy}
                className="btn-light flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-small font-medium text-text-primary disabled:opacity-40"
              >
                {hasCustomFolder ? (
                  <FolderOpen size={14} />
                ) : (
                  <Folder size={14} />
                )}
                {folderBusy ? "Opening picker…" : "Choose folder…"}
              </button>
              {hasCustomFolder && (
                <button
                  type="button"
                  onClick={() => void resetFolder()}
                  disabled={folderBusy}
                  className="text-small font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
                >
                  Use default
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="auth-btn-3d h-10 rounded-[9px] px-4 text-body font-medium text-white"
            >
              {hasCustomFolder ? "Done" : "Skip"}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
