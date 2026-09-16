"use client";

/**
 * Channels — the threads panel's ARTIFACTS FACE: this channel's folded runs as
 * named cards, each openable read-only (Samuel, 2026-09-16: *"list shows this
 * channel's artifacts (named cards, openable — clicking one opens the folded run,
 * read-only)"*).
 *
 * ⚠ **IT IS THE OTHER FACE OF THE THREADS TAB, NOT A SIXTH TAB.** The tab row is
 * on a measured width budget for four options (`info-panel.tsx`), and an artifact
 * is a thread formed after the fact — the two lists answer the same question
 * ("what runs happened here") from opposite ends, so they share one slot and one
 * toggle. `threads-tab.tsx` owns the toggle control; this file owns the face.
 *
 * ⚠ **NO WRITES ON THIS SURFACE, AND NOT BECAUSE NOBODY GOT TO THEM.** Folding is
 * a decision made over messages in the transcript (`op="artifact"`), so there is
 * nothing here to create FROM — which is also why the New thread button hides
 * behind this face rather than sitting over a list it cannot add to. Dissolve is
 * creator-only and destructive-looking; neither belongs in a browse list.
 *
 * ⚠ **THE CARD IS `artifact-card.tsx`, THE SAME ONE THE TRANSCRIPT DRAWS.** An
 * artifact that read one way inline and another way here would be two answers about
 * one row; what differs is only WHERE the members come from — the transcript can
 * show just the page's, this face reads the whole run.
 */

import { useState } from "react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import {
  useChannelArtifact,
  useChannelArtifacts,
} from "../hooks/use-channel-artifacts";
import { CARD_BUTTON, PANEL_CARD } from "./bits";
import { ArtifactCard, artifactSpanLabel } from "./artifact-card";
import { labelFor, type AuthorIndex } from "./view-model";
import type { ArtifactMember } from "./view-model-artifacts";
import type { ChannelFoldedArtifact, ChannelMessage } from "../types";

/**
 * THE LIST'S CLIP WORDING — the family's fourth, beside `threads-tab.tsx ›
 * THREADS_CLIPPED_NOTE`, and its own for the same reason that one is: the REMEDY
 * differs. This face has no page argument and no deeper read, so it may state only
 * what IS on screen — the newest cards, and that the order is when they were made.
 *
 * ⚠ IT MAY NOT ASSERT IN EITHER DIRECTION (INVARIANTS §9): not "that is all of
 * them", because a page AT the ceiling is indistinguishable from one over it.
 */
export const ARTIFACTS_CLIPPED_NOTE =
  "Showing the most recently created artifacts, up to this list's limit. Nothing here was deleted; anything not listed is simply below the cut.";

/** Nothing folded here yet. ⚠ Says how one is MADE, because there is no control
 *  on this face that makes one — see the file's docblock. */
export const ARTIFACTS_EMPTY_NOTE =
  "No artifacts in this channel yet. An artifact is made by folding messages in the transcript.";

/**
 * ⚠ A DISSOLVED CARD IS ABSENT, AND SO IS ONE THAT FOLDED NOTHING — the SERVER's
 * rule (`service-artifacts-list.ts › listChannelArtifacts`, which carries why). Named
 * here because it explains a face that never renders a member-less card; it is
 * NOT re-applied below, because a second copy of a rule is a second thing to drift.
 */
export function ArtifactsTab({
  channelId,
  workspaceId,
  index,
}: {
  channelId: string;
  workspaceId: string;
  /** The roster index the transcript uses — so a folded message's author reads
   *  "You" here exactly as it does one row up. */
  index: AuthorIndex;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const { artifacts, truncated, loading } = useChannelArtifacts(
    channelId,
    workspaceId
  );

  const open = artifacts.find((a) => a.artifact.id === openId) ?? null;

  return (
    /* ⚠ NO TOP PADDING, DELIBERATELY: the toggle row above this body owns the
       face's top gap (`threads-tab.tsx`), and a `pt-4` here would stack with it. */
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
          {/* ⚠ THE CLIP NOTE SITS ABOVE THE ROWS, never in a footer a skimmer
              drops — the same placement `threads-tab.tsx` argues for. */}
          {truncated && (
            <p className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-secondary">
              {ARTIFACTS_CLIPPED_NOTE}
            </p>
          )}
          {loading && artifacts.length === 0 ? (
            <p role="status" aria-busy="true" className="sr-only">
              Loading artifacts
            </p>
          ) : artifacts.length === 0 ? (
            <p className="px-1 pt-4 text-center text-caption text-text-muted">
              {ARTIFACTS_EMPTY_NOTE}
            </p>
          ) : (
            /* ⚠ A FLAT COLUMN, NOT `RecencyWells`. The Threads tab buckets by last
               ACTIVITY because a thread keeps moving; an artifact is a record of a
               run that already happened and never moves again, so recency wells
               would file a card by the day somebody folded it and call that news. */
            <div className="flex flex-col gap-2">
              {artifacts.map((folded) => (
                <ArtifactListCard
                  key={folded.artifact.id}
                  folded={folded}
                  onOpen={() => setOpenId(folded.artifact.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ONE ROW IN THE LIST — name, summary, and the span the card carries.
 *
 * ⚠ THE ACTION IS THE LAST ROW, RIGHT-ALIGNED, in the same corner the thread card
 * and the agent card put theirs (Samuel, 2026-08-24). ⚠ THE SPAN IS THE SHARED
 * DERIVATION (`artifact-card.tsx › artifactSpanLabel`), never re-spelled: the list
 * and the opened card must print one artifact's numbers identically.
 */
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

/**
 * THE OPENED CARD — the folded run, READ-ONLY.
 *
 * ⚠ **READ-ONLY IS A PROPERTY OF WHAT IS RENDERED, NOT A FLAG PASSED DOWN.**
 * `ArtifactCard` takes no handler and mounts no control but its own Show more, so
 * there is nothing here that could write; a `readOnly` prop would imply the other
 * mode exists.
 *
 * ⚠ THE MEMBER CEILING IS THE SERVER'S AND IS SAID OUT LOUD — a clipped run that
 * renders like a whole one is the bug (INVARIANTS §9). It is a DIFFERENT bound from
 * the list's, so it gets its own sentence rather than the list's note.
 */
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
  const { messages, truncated, loading } = useChannelArtifact(
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
    </div>
  );
}

/**
 * THE WIRE'S MESSAGES → THE CARD'S MEMBERS.
 *
 * ⚠ **IT IS THE TRANSCRIPT'S OWN TWO DERIVATIONS, ASKED RATHER THAN RE-WRITTEN** —
 * `view-model.ts › labelFor` for the author ("You" for the viewer) and
 * `format-time.ts › formatChannelTimestamp` for the stamp. A local spelling of
 * either is how the same message comes to read differently in two places.
 * ⚠ The server already returns them in seq order (`listMessagesByArtifact`), so
 * this does not re-sort: a second ordering is a second thing to disagree.
 */
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
