"use client";

/**
 * The right panel's Threads tab: every thread of the channel in recency wells. The server's activity
 * order is never re-sorted (the read is clipped against it), and a clipped page says so (INVARIANTS §5/§9).
 */

import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { IdentityStack, type IdentityStackFace } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { useRuntimeLogo } from "@/shared/ui/runtime-logo";
import { QUIET_PILL } from "@/shared/ui/small-action-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { ROW_CARD_ROW, TAB_ACTION, TAB_ACTION_LIGHT } from "./bits";
import { agentIdentity, type AgentFeeds } from "./agent-face";
import { FadeSwap } from "./fade-swap";
import { RecencyWells, type RecencyWellItem } from "./recency-wells";
import { runningCount, threadCardAgents } from "./thread-card-agents";
import { shortName, threadParties, type AuthorIndex } from "./view-model";
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
export const THREADS_CLIPPED_NOTE = "Showing the most recently active threads";

/** Face-toggle labels name where the press goes, not where you are. */
export const ARTIFACTS_FACE_LABEL = "Artifacts";
export const THREADS_FACE_LABEL = "Threads";

/** At most this many faces on a row before the stack counts the rest. */
const ROW_FACES = 4;

export function ThreadsTab({
  threads,
  truncated,
  loading,
  index,
  feeds,
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
  /** Who the agents on each thread are; the row's faces and running count read it. */
  feeds: AgentFeeds;
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
  const logoFor = useRuntimeLogo();
  // Nothing is creatable from the artifacts face, so its button hides (the callback stays wired).
  const showNewThread = onNewThread !== undefined && artifactsFace !== true;
  const toggle = onToggleFace !== undefined && (
    <button type="button" onClick={onToggleFace} className={TAB_ACTION_LIGHT}>
      {artifactsFace ? THREADS_FACE_LABEL : ARTIFACTS_FACE_LABEL}
    </button>
  );

  if (artifactsFace) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* The top gap lives on this row (`ArtifactsTab` has none), so the toggle holds its place. */}
        <div className="flex items-center px-3.5 pb-3 pt-4">
          <span className="flex-1" />
          {toggle}
        </div>
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
        {loading && threads.length === 0 ? (
          <p role="status" aria-busy="true" className="sr-only">
            Loading threads
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Empty wells still draw once loaded; while loading, nothing is measured (§11). */}
            <RecencyWells
              storageKey={THREAD_WELLS_STORAGE_KEY}
              variant="card"
              items={threads.map(
                (thread): RecencyWellItem => ({
                  key: thread.id,
                  at: threadActivityAt(thread),
                  node: (
                    <ThreadRow
                      thread={thread}
                      index={index}
                      feeds={feeds}
                      logoFor={logoFor}
                      viewing={thread.id === openThreadId}
                      onOpen={() => onOpenThread(thread.id)}
                    />
                  ),
                })
              )}
            />
            {threads.length === 0 && (
              <EmptyState variant="well" icon={MessagesSquare} title="No threads yet" />
            )}
            {truncated && (
              <p className="px-0.5 text-caption text-text-muted">{THREADS_CLIPPED_NOTE}</p>
            )}
          </div>
        )}
      </FadeSwap>
    </div>
  );
}

/** One thread: title over its parties and last activity; the people and agents on it, then Open. */
function ThreadRow({
  thread,
  index,
  feeds,
  logoFor,
  viewing,
  onOpen,
}: {
  thread: ChannelThread;
  index: AuthorIndex;
  feeds: AgentFeeds;
  logoFor: (runtime: string | null | undefined) => string | null;
  viewing: boolean;
  onOpen: () => void;
}) {
  const parties = threadParties(thread, index);
  const agents = threadCardAgents(feeds, thread.channelId, thread.id, index) ?? [];
  const running = runningCount(agents);
  const faces: IdentityStackFace[] = [
    ...parties.map((p) => ({
      key: `person:${p.userId}`,
      photo: p.avatarUrl,
      name: p.displayName ?? p.email,
    })),
    ...agents.map((a) => ({
      key: a.key,
      ...agentIdentity(a, logoFor),
      online: a.liveness.tone === "working",
    })),
  ];
  const partyNames = parties.map((p) => shortName(p, index.currentUserId));
  const names = [...partyNames, ...agents.map((a) => a.name)];

  return (
    <div
      className={cn(
        ROW_CARD_ROW,
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 py-2.5"
      )}
    >
      <span className="truncate text-body font-medium text-text-primary">{thread.title}</span>
      <IdentityStack
        faces={faces}
        size={22}
        max={ROW_FACES}
        label={names.length > 0 ? `With ${names.join(", ")}` : undefined}
      />
      <span className="flex min-w-0 items-center gap-1.25 text-label text-text-muted">
        {partyNames.length > 0 && (
          <>
            <span className="min-w-0 truncate">{partyNames.join(" · ")}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span className="flex-none">{formatRelativeTime(thread.lastActivityAt)}</span>
      </span>
      <span className="flex items-center justify-end gap-1.5">
        {running > 0 && (
          <StatusPill dot tone="live">
            {running} running
          </StatusPill>
        )}
        <button
          type="button"
          aria-current={viewing ? "true" : undefined}
          onClick={onOpen}
          className={cn(QUIET_PILL, viewing && "border-border-default text-text-primary")}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </span>
    </div>
  );
}
