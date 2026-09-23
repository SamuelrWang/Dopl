"use client";

/**
 * The right panel's Threads tab: every thread of the channel in recency wells. The server's activity
 * order is never re-sorted (the read is clipped against it), and a clipped page says so (INVARIANTS §5/§9).
 */

import type { ReactNode } from "react";
import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { CARD_BUTTON, PANEL_CARD, TAB_ACTION, TAB_ACTION_LIGHT } from "./bits";
import { FadeSwap } from "./fade-swap";
import { RecencyWells, type RecencyWellItem } from "./recency-wells";
import { shortName, threadParties, type AuthorIndex } from "./view-model";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ChannelThread } from "../types";

/** This tab's own wells key — never shared with `dopl.agents.wells` or `dopl.artifacts.wells`. */
export const THREAD_WELLS_STORAGE_KEY = "dopl.threads.wells";

/**
 * Last message time (epoch ms), from `lastActivityAt` — never `updatedAt`, which only `set_mode` writes.
 * `null` (absent or unparseable) means not derived, and lands in the open Recent well.
 */
export function threadActivityAt(thread: ChannelThread): number | null {
  if (!thread.lastActivityAt) return null;
  const ts = new Date(thread.lastActivityAt).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Clip note: asserts neither absence nor another page — a page at the ceiling counts as clipped (INVARIANTS §9). */
export const THREADS_CLIPPED_NOTE =
  "Showing the most recently active threads, up to this list's limit. Nothing here was closed or archived; anything not listed is simply below the cut.";

/** Face-toggle labels name where the press goes, not where you are. */
export const ARTIFACTS_FACE_LABEL = "Artifacts";
export const THREADS_FACE_LABEL = "Threads";

export function ThreadsTab({
  threads,
  truncated,
  loading,
  index,
  openThreadId,
  onOpenThread,
  onNewThread,
  artifactsFace,
  onToggleFace,
  artifacts,
}: {
  threads: ChannelThread[];
  truncated: boolean;
  loading: boolean;
  index: AuthorIndex;
  openThreadId: string | null;
  onOpenThread: (id: string) => void;
  /** Opens the new-thread dialog (`new-thread-dialog.tsx › NewThreadDialog`); absent draws no button. */
  onNewThread?: () => void;
  /** Show the artifacts face; owned by `info-panel.tsx` because its tab label flips too. */
  artifactsFace?: boolean;
  /** Absent ⇒ no toggle (capability off). */
  onToggleFace?: () => void;
  /** The artifacts body, injected so its reads run only when shown (INVARIANTS §5). */
  artifacts?: ReactNode;
}) {
  // Nothing is creatable from the artifacts face, so its button hides (the callback stays wired).
  const showNewThread = onNewThread !== undefined && artifactsFace !== true;
  const toggle = onToggleFace !== undefined && (
    <button
      type="button"
      onClick={onToggleFace}
      // `TAB_ACTION`'s light twin, so the pair can't drift; one button, not a selected state.
      className={TAB_ACTION_LIGHT}
    >
      {artifactsFace ? THREADS_FACE_LABEL : ARTIFACTS_FACE_LABEL}
    </button>
  );

  if (artifactsFace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Top gap lives on this row (`ArtifactsTab` has no `pt`); the spacer keeps the toggle where it sits on the thread face. */}
        <div className="flex items-center px-3.5 pb-3 pt-4">
          <span className="flex-1" />
          {toggle}
        </div>
        {/* Keyed on the face only; the toggle row stays outside the fade. */}
        <FadeSwap viewKey="artifacts" className="flex min-h-0 flex-1 flex-col">
          {artifacts}
        </FadeSwap>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {(toggle || showNewThread) && (
        <div className="mb-3 flex items-center gap-2">
          <span className="flex-1" />
          {toggle}
          {showNewThread && (
            <button type="button" onClick={onNewThread} className={TAB_ACTION}>
              New thread
            </button>
          )}
        </div>
      )}
      <FadeSwap viewKey="threads">
      {truncated && (
        <p className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-secondary">
          {THREADS_CLIPPED_NOTE}
        </p>
      )}
      {loading && threads.length === 0 ? (
        <p role="status" aria-busy="true" className="sr-only">
          Loading threads
        </p>
      ) : (
        /* Empty wells still draw once loaded; while loading, nothing is measured (§11). */
        <RecencyWells
          storageKey={THREAD_WELLS_STORAGE_KEY}
          items={threads.map(
            (thread): RecencyWellItem => ({
              key: thread.id,
              at: threadActivityAt(thread),
              node: (
                <ThreadCard
                  thread={thread}
                  index={index}
                  viewing={thread.id === openThreadId}
                  onOpen={() => onOpenThread(thread.id)}
                />
              ),
            })
          )}
        />
      )}
      {!loading && threads.length === 0 && (
        <p className="px-1 pt-4 text-center text-caption text-text-muted">
          No threads in this channel yet.
        </p>
      )}
      </FadeSwap>
    </div>
  );
}

/** One thread card; every card opens (threads never close). */
function ThreadCard({
  thread,
  index,
  viewing,
  onOpen,
}: {
  thread: ChannelThread;
  index: AuthorIndex;
  viewing: boolean;
  onOpen: () => void;
}) {
  const parties = threadParties(thread, index);

  return (
    <div className={cn(PANEL_CARD, viewing && "border-border-highlight")}>
      <span className="min-w-0 truncate text-body font-semibold text-text-primary">
        {thread.title}
      </span>

      {parties.length > 0 && (
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 -space-x-1.5">
            {parties.map((p) => (
              <Avatar
                key={p.userId}
                person={p}
                size="xs"
                className="h-[22px] w-[22px] text-micro"
              />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
            {parties.map((p) => shortName(p, index.currentUserId)).join(" · ")}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          Updated {formatRelativeTime(thread.lastActivityAt)}
        </span>
        <button
          type="button"
          aria-current={viewing ? "true" : undefined}
          onClick={onOpen}
          className={CARD_BUTTON}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>
    </div>
  );
}
