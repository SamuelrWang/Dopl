"use client";

/**
 * The Threads tab's artifacts face: this channel's folded runs as rows, each openable read-only.
 * No writes here — folding happens over messages in the transcript (`op="artifact"`).
 */

import { useMemo, useState } from "react";
import { Layers, TriangleAlert } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { IdentityFace } from "@/shared/ui/identity-face";
import { QUIET_PILL } from "@/shared/ui/small-action-button";
import { useChannelArtifacts } from "../hooks/use-channel-artifacts";
import { artifactSpanLabel } from "./artifact-card";
import { ArtifactDetail } from "./artifact-detail";
import { ROW_CARD_ROW } from "./bits";
import { bodyContextOf, TextOnlyLinks } from "./message-markdown";
import { MessageMarkdownInline } from "./message-markdown-inline";
import type { BodyContext } from "./message-markdown-context";
import { RecencyWells, type RecencyWellItem } from "./recency-wells";
import { useTaskFaces, type TaskFaceOf } from "./task-faces";
import type { AgentFeeds } from "./agent-face";
import type { AuthorIndex } from "./view-model";
import type { ChannelFoldedArtifact, TaskActor } from "../types";

/** This face's own wells key — never shared with `dopl.threads.wells`. */
const ARTIFACT_WELLS_STORAGE_KEY = "dopl.artifacts.wells";

/** Fold time (epoch ms) from `createdAt`, an artifact's only date; `null` (absent/unparseable) lands in Recent. */
function artifactFoldedAt(folded: ChannelFoldedArtifact): number | null {
  if (!folded.artifact.createdAt) return null;
  const ts = new Date(folded.artifact.createdAt).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Clip note: asserts neither direction — a page at the ceiling counts as clipped (INVARIANTS §9). */
export const ARTIFACTS_CLIPPED_NOTE = "Showing the most recent artifacts";

export const ARTIFACTS_EMPTY_NOTE = "No artifacts yet";

/** A failed read, kept distinct from "asked, nothing there" (INVARIANTS §9). */
export const ARTIFACTS_UNREAD_NOTE = "Could not load artifacts";

/** Who folded it: the agent that made it, else the member who did. */
function folderOf({ artifact }: ChannelFoldedArtifact): TaskActor {
  return artifact.createdByAgent
    ? { kind: "agent", userId: artifact.createdBy, agentId: artifact.createdByAgent }
    : { kind: "person", userId: artifact.createdBy };
}

/** Dissolved and member-less artifacts are dropped server-side (`service-artifacts-list.ts › listChannelArtifacts`). */
export function ArtifactsTab({
  channelId,
  workspaceId,
  index,
  feeds,
  onJumpToMessage,
}: {
  channelId: string;
  workspaceId: string;
  /** The transcript's roster index, so authors read the same ("You") here. */
  index: AuthorIndex;
  feeds: AgentFeeds;
  /** Moves the transcript to an opened artifact's message; absent draws no jump. */
  onJumpToMessage?: (threadId: string | null, messageId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { artifacts, truncated, loading, error } = useChannelArtifacts(channelId, workspaceId);
  const faceOf = useTaskFaces(index, feeds);
  // Walks the roster: built once for every summary on the face.
  const summaryCtx = useMemo(() => bodyContextOf({ index, mentionsMe: false }), [index]);
  const open = artifacts.find((a) => a.artifact.id === openId) ?? null;
  const empty = artifacts.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
      {open ? (
        <ArtifactDetail
          folded={open}
          channelId={channelId}
          workspaceId={workspaceId}
          index={index}
          faceOf={faceOf}
          summaryCtx={summaryCtx}
          onBack={() => setOpenId(null)}
          onJumpToMessage={onJumpToMessage}
        />
      ) : loading && empty ? (
        <p role="status" aria-busy="true" className="sr-only">
          Loading artifacts
        </p>
      ) : error && empty ? (
        // Only with nothing on screen: a failed refetch keeps the previous list.
        <EmptyState variant="well" icon={TriangleAlert} title={ARTIFACTS_UNREAD_NOTE} />
      ) : empty ? (
        <EmptyState variant="well" icon={Layers} title={ARTIFACTS_EMPTY_NOTE} />
      ) : (
        <div className="flex flex-col gap-2">
          <RecencyWells
            storageKey={ARTIFACT_WELLS_STORAGE_KEY}
            variant="card"
            items={artifacts.map(
              (folded): RecencyWellItem => ({
                key: folded.artifact.id,
                at: artifactFoldedAt(folded),
                node: (
                  <ArtifactRow
                    folded={folded}
                    faceOf={faceOf}
                    summaryCtx={summaryCtx}
                    onOpen={() => setOpenId(folded.artifact.id)}
                  />
                ),
              })
            )}
          />
          {truncated && (
            <p className="px-0.5 text-caption text-text-muted">{ARTIFACTS_CLIPPED_NOTE}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One artifact: name and folder, a one-line summary, then its span, age and Open. */
function ArtifactRow({
  folded,
  faceOf,
  summaryCtx,
  onOpen,
}: {
  folded: ChannelFoldedArtifact;
  faceOf: TaskFaceOf;
  summaryCtx: BodyContext;
  onOpen: () => void;
}) {
  const { artifact, count, firstSeq, lastSeq } = folded;
  const folder = faceOf(folderOf(folded));
  return (
    <div
      className={cn(
        ROW_CARD_ROW,
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 py-2.5"
      )}
    >
      <span className="truncate text-body font-medium text-text-primary">{artifact.name}</span>
      <IdentityFace size={22} {...folder} label={`Folded by ${folder.name}`} />
      {artifact.summary !== "" && (
        <p className="col-span-2 truncate text-caption text-text-secondary">
          <TextOnlyLinks>
            <MessageMarkdownInline text={artifact.summary} ctx={summaryCtx} />
          </TextOnlyLinks>
        </p>
      )}
      <span className="flex min-w-0 items-center gap-1.25 text-label text-text-muted">
        <span className="min-w-0 truncate">{artifactSpanLabel(count, firstSeq, lastSeq)}</span>
        <span aria-hidden="true">·</span>
        <span className="flex-none">{formatRelativeTime(artifact.createdAt)}</span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${artifact.name}`}
        className={cn(QUIET_PILL, "justify-self-end")}
      >
        Open
      </button>
    </div>
  );
}
