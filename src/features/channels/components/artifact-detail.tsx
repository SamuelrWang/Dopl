"use client";

import { ChevronLeft, TriangleAlert } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp, formatRelativeTime } from "@/shared/lib/format-time";
import { IdentityStack, type IdentityStackFace } from "@/shared/ui/avatar-stack";
import { Breadcrumb } from "@/shared/ui/breadcrumb";
import { EmptyState } from "@/shared/ui/empty-state";
import { IdentityFace } from "@/shared/ui/identity-face";
import { useChannelArtifact } from "../hooks/use-channel-artifacts";
import { authorAgentIdOf } from "../lib/agent-post-stamp";
import { mentionedUserIdsOf } from "../lib/mentions";
import { actorKey } from "../lib/task-model";
import { artifactSpanLabel } from "./artifact-card";
import { ROW_CARD_ROW } from "./bits";
import { MessageMarkdown, TextOnlyLinks } from "./message-markdown";
import { MessageMarkdownInline } from "./message-markdown-inline";
import type { BodyContext } from "./message-markdown-context";
import type { TaskFace, TaskFaceOf } from "./task-faces";
import { labelFor, personFor, threadIdOf, type AuthorIndex } from "./view-model";
import type { ChannelFoldedArtifact, ChannelMessage, TaskActor } from "../types";

/** The members read failed: the run is unknown, not empty (INVARIANTS §9). */
export const ARTIFACT_MESSAGES_UNREAD_NOTE = "Could not load this artifact's messages";

/** The member ceiling cut the run's newest messages (`repository-artifacts.ts › ARTIFACT_MEMBER_LIMIT`). */
export const ARTIFACT_MESSAGES_CLIPPED_NOTE = "Later messages are not shown";

const AUTHOR_FACES = 4;

interface Author {
  key: string;
  face: TaskFace;
}

/** A member's author: an agent as its owner's photo in its ring with its runtime badge, a person
 *  under the transcript's own label ("You" for the viewer). */
function authorOf(message: ChannelMessage, index: AuthorIndex, faceOf: TaskFaceOf): Author {
  const agentId = message.authorKind === "agent" ? authorAgentIdOf(message) : null;
  if (agentId && message.authorUserId) {
    const actor: TaskActor = { kind: "agent", userId: message.authorUserId, agentId };
    return { key: actorKey(actor), face: faceOf(actor) };
  }
  return {
    key: message.authorUserId ? actorKey({ kind: "person", userId: message.authorUserId }) : message.id,
    face: { name: labelFor(message, index), photo: personFor(message, index).avatarUrl },
  };
}

/** Each author once, in the order they first spoke, as stack faces. */
function stackFaces(authors: readonly Author[]): IdentityStackFace[] {
  const seen = new Set<string>();
  const out: IdentityStackFace[] = [];
  for (const { key, face } of authors) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, ...face });
  }
  return out;
}

function ArtifactMessage({
  message,
  face,
  index,
  onJump,
}: {
  message: ChannelMessage;
  face: TaskFace;
  index: AuthorIndex;
  onJump?: () => void;
}) {
  const number = `#${message.channelSeq ?? message.seq}`;
  return (
    <li
      data-artifact-member={message.seq}
      className={cn(ROW_CARD_ROW, "grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 py-3 first:pt-0")}
    >
      <IdentityFace size={24} {...face} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-caption font-semibold text-text-primary">{face.name}</span>
          <span className="flex-none text-label text-text-muted">
            {formatChannelTimestamp(message.createdAt)}
          </span>
          {onJump ? (
            <button
              type="button"
              onClick={onJump}
              aria-label={`Show ${number} in the transcript`}
              title="Show in the transcript"
              className="ml-auto flex-none text-label text-text-muted transition-colors hover:text-text-primary"
            >
              {number}
            </button>
          ) : (
            <span className="ml-auto flex-none text-label text-text-muted">{number}</span>
          )}
        </p>
        <div className="flex min-w-0 flex-col gap-1.5">
          <MessageMarkdown
            text={message.body}
            index={index}
            mentionsMe={mentionedUserIdsOf(message.metadata).includes(index.currentUserId)}
            cites={message.cites}
            blockClassName="wrap-anywhere min-w-0 max-w-prose"
            textClassName="text-body leading-normal text-text-primary"
          />
        </div>
      </div>
    </li>
  );
}

/** One artifact opened in place: breadcrumb, header, then its messages read-only, in seq order. */
export function ArtifactDetail({
  folded,
  channelId,
  workspaceId,
  index,
  faceOf,
  summaryCtx,
  onBack,
  onJumpToMessage,
}: {
  folded: ChannelFoldedArtifact;
  channelId: string;
  workspaceId: string;
  index: AuthorIndex;
  faceOf: TaskFaceOf;
  /** The list's inline context for the summary, built once per tab. */
  summaryCtx: BodyContext;
  onBack: () => void;
  /** Moves the transcript to a member; absent prints each number as text. */
  onJumpToMessage?: (threadId: string | null, messageId: string) => void;
}) {
  const { artifact, count, firstSeq, lastSeq } = folded;
  const { messages, truncated, loading, error } = useChannelArtifact(
    channelId,
    artifact.id,
    workspaceId
  );
  const authors = messages.map((m) => authorOf(m, index, faceOf));
  const faces = stackFaces(authors);

  return (
    <article aria-label={artifact.name} className="flex min-w-0 max-w-2xl flex-col gap-5">
      <Breadcrumb
        items={[
          {
            key: "artifacts",
            label: "Artifacts",
            icon: <ChevronLeft size={13} aria-hidden="true" />,
            onSelect: onBack,
            ariaLabel: "Back to artifacts",
          },
          { key: artifact.id, label: artifact.name },
        ]}
      />

      <header className="flex flex-col gap-2">
        <h3 className="wrap-anywhere text-title font-semibold leading-[1.3] text-text-primary">
          {artifact.name}
        </h3>
        {artifact.summary !== "" && (
          // A summary is the folder's own words over runs the reader has not opened: no anchors.
          <p className="wrap-anywhere text-caption leading-normal text-text-secondary">
            <TextOnlyLinks>
              <MessageMarkdownInline text={artifact.summary} ctx={summaryCtx} />
            </TextOnlyLinks>
          </p>
        )}
        <div className="flex min-w-0 items-center gap-2 border-t border-border-default pt-2.5 text-caption text-text-muted">
          <IdentityStack
            faces={faces}
            size={22}
            max={AUTHOR_FACES}
            label={faces.length > 0 ? `By ${faces.map((f) => f.name).join(", ")}` : undefined}
          />
          <span className="min-w-0 truncate">{artifactSpanLabel(count, firstSeq, lastSeq)}</span>
          <span className="ml-auto flex-none">{formatRelativeTime(artifact.createdAt)}</span>
        </div>
      </header>

      {loading && messages.length === 0 && (
        <p role="status" aria-busy="true" className="sr-only">
          Loading artifact
        </p>
      )}
      {error && messages.length === 0 && (
        <EmptyState variant="well" icon={TriangleAlert} title={ARTIFACT_MESSAGES_UNREAD_NOTE} />
      )}
      {messages.length > 0 && (
        <ol aria-label="Messages" className="m-0 flex list-none flex-col p-0">
          {messages.map((message, i) => (
            <ArtifactMessage
              key={message.id}
              message={message}
              face={authors[i].face}
              index={index}
              onJump={
                onJumpToMessage && (() => onJumpToMessage(threadIdOf(message), message.id))
              }
            />
          ))}
        </ol>
      )}
      {truncated && <p className="text-caption text-text-muted">{ARTIFACT_MESSAGES_CLIPPED_NOTE}</p>}
    </article>
  );
}
