"use client";

/**
 * The Threads tab's artifacts face: this channel's folded runs as cards, each openable read-only.
 * No writes here — folding happens over messages in the transcript (`op="artifact"`).
 */

import { useState } from "react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import {
  useChannelArtifact,
  useChannelArtifacts,
} from "../hooks/use-channel-artifacts";
import { CARD_BUTTON, PANEL_CARD } from "./bits";
import { RecencyWells, type RecencyWellItem } from "./recency-wells";
import { ArtifactCard, artifactSpanLabel } from "./artifact-card";
import { labelFor, type AuthorIndex } from "./view-model";
import type { ArtifactMember } from "./view-model-artifacts";
import type { ChannelFoldedArtifact, ChannelMessage } from "../types";

/** This face's own wells key — never shared with `dopl.threads.wells`. */
export const ARTIFACT_WELLS_STORAGE_KEY = "dopl.artifacts.wells";

/** Fold time (epoch ms) from `createdAt`, an artifact's only date; `null` (absent/unparseable) lands in Recent. */
export function artifactFoldedAt(folded: ChannelFoldedArtifact): number | null {
  if (!folded.artifact.createdAt) return null;
  const ts = new Date(folded.artifact.createdAt).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/** Clip note: asserts neither direction — a page at the ceiling counts as clipped (INVARIANTS §9). */
export const ARTIFACTS_CLIPPED_NOTE =
  "Showing the most recently created artifacts, up to this list's limit. Nothing here was deleted; anything not listed is simply below the cut.";

/** Says how an artifact is made, since this face has no control that makes one. */
export const ARTIFACTS_EMPTY_NOTE =
  "No artifacts in this channel yet. An artifact is made by folding messages in the transcript.";

/** A failed read, kept distinct from "asked, nothing there" (INVARIANTS §9). */
export const ARTIFACTS_UNREAD_NOTE =
  "Could not load this channel's artifacts.";

/** Dissolved and member-less artifacts are dropped server-side (`service-artifacts-list.ts › listChannelArtifacts`). */
export function ArtifactsTab({
  channelId,
  workspaceId,
  index,
}: {
  channelId: string;
  workspaceId: string;
  /** The transcript's roster index, so authors read the same ("You") here. */
  index: AuthorIndex;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { artifacts, truncated, loading, error } = useChannelArtifacts(
    channelId,
    workspaceId
  );

  const open = artifacts.find((a) => a.artifact.id === openId) ?? null;

  return (
    /* No top padding: the toggle row in `threads-tab.tsx` owns the face's top gap. */
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6">
      {open ? (
        <OpenArtifact
          folded={open}
          channelId={channelId}
          workspaceId={workspaceId}
          index={index}
          onBack={() => setOpenId(null)}
        />
      ) : (
        <>
          {truncated && (
            <p className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-secondary">
              {ARTIFACTS_CLIPPED_NOTE}
            </p>
          )}
          {loading && artifacts.length === 0 ? (
            <p role="status" aria-busy="true" className="sr-only">
              Loading artifacts
            </p>
          ) : error && artifacts.length === 0 ? (
            /* Only with nothing on screen: a failed refetch keeps the previous list. */
            <p
              role="status"
              className="px-1 pt-4 text-center text-caption text-text-muted"
            >
              {ARTIFACTS_UNREAD_NOTE}
            </p>
          ) : artifacts.length === 0 ? (
            <p className="px-1 pt-4 text-center text-caption text-text-muted">
              {ARTIFACTS_EMPTY_NOTE}
            </p>
          ) : (
            <RecencyWells
              storageKey={ARTIFACT_WELLS_STORAGE_KEY}
              items={artifacts.map(
                (folded): RecencyWellItem => ({
                  key: folded.artifact.id,
                  at: artifactFoldedAt(folded),
                  node: (
                    <ArtifactListCard
                      folded={folded}
                      onOpen={() => setOpenId(folded.artifact.id)}
                    />
                  ),
                })
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

/** One list row; the span is `artifactSpanLabel`, shared with the opened card. */
function ArtifactListCard({
  folded,
  onOpen,
}: {
  folded: ChannelFoldedArtifact;
  onOpen: () => void;
}) {
  const { artifact, count, firstSeq, lastSeq } = folded;
  return (
    <div className={PANEL_CARD}>
      <span className="min-w-0 truncate text-body font-semibold text-text-primary">
        {artifact.name}
      </span>
      {artifact.summary !== "" && (
        <span className="wrap-anywhere line-clamp-2 text-caption text-text-secondary">
          {artifact.summary}
        </span>
      )}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {artifactSpanLabel(count, firstSeq, lastSeq)}
        </span>
        <button type="button" onClick={onOpen} className={CARD_BUTTON}>
          Open
        </button>
      </div>
    </div>
  );
}

/** The opened run, read-only by construction (`ArtifactCard` mounts no write control). */
function OpenArtifact({
  folded,
  channelId,
  workspaceId,
  index,
  onBack,
}: {
  folded: ChannelFoldedArtifact;
  channelId: string;
  workspaceId: string;
  index: AuthorIndex;
  onBack: () => void;
}) {
  const { artifact, count, firstSeq, lastSeq } = folded;
  const { messages, truncated, loading, error } = useChannelArtifact(
    channelId,
    artifact.id,
    workspaceId
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <button type="button" onClick={onBack} className={CARD_BUTTON}>
          Back
        </button>
      </div>
      {loading && messages.length === 0 && (
        <p role="status" aria-busy="true" className="sr-only">
          Loading artifact
        </p>
      )}
      <ArtifactCard
        id={artifact.id}
        name={artifact.name}
        summary={artifact.summary}
        count={count}
        firstSeq={firstSeq}
        lastSeq={lastSeq}
        members={members(messages, index)}
      />
      {truncated && (
        <p className="text-caption text-text-muted">
          This run is longer than one read returns; the newest members may not be
          shown.
        </p>
      )}
      {/* The card's list payload still draws; only the members read failed, so say so. */}
      {error && messages.length === 0 && (
        <p role="status" className="text-caption text-text-muted">
          {ARTIFACTS_UNREAD_NOTE}
        </p>
      )}
    </div>
  );
}

/** Wire messages → card members via the transcript's own `labelFor`/`formatChannelTimestamp`; server seq order kept. */
function members(
  messages: ChannelMessage[],
  index: AuthorIndex
): ArtifactMember[] {
  return messages.map((message) => ({
    id: message.id,
    seq: message.seq,
    authorLabel: labelFor(message, index),
    time: formatChannelTimestamp(message.createdAt),
    body: message.body,
  }));
}
