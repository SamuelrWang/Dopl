"use client";

/**
 * Channels — the Tags row's disclosure: a MENTIONS INBOX.
 *
 * ⚠ TWO SURFACES RENDER IT SINCE 2026-09-15: the workspace channels page and a
 * HOME channel's Info tab, through the one disclosure in
 * `mentions-disclosure.tsx`. Nothing here knows which host it is in.
 *
 * WIRED (Phase 6). Rows are `GET /api/channels/[id]/mentions` — the messages of
 * this channel whose SERVER-STAMPED `metadata.mentionedUserIds` names the
 * viewer (`lib/mentions.ts` is the one parser behind that stamp and behind the
 * transcript's tint). Read-state is `channel_mention_reads`, a row per read,
 * because the inbox marks items read OUT OF ORDER and a cursor cannot say that.
 *
 * ⚠ THE BADGE IS CLIENT-SIDE ARITHMETIC over these rows and lives in
 * `info-tab.tsx` beside the label it decorates — never a second server
 * derivation of the same set (wiring plan Phase 6, decision 3).
 *
 * ⚠ A CLICK IS THREE THINGS: mark read, land the center pane on the right
 * transcript, scroll to the row. The scroll signal is NONCED
 * (`message-pane.tsx › ScrollTarget`) so re-clicking the same mention
 * re-scrolls.
 *
 * ⚠ THE ROW'S LABEL IS "Mentions" SINCE 2026-09-15 (Samuel's ruling; it read
 * "Tags", the reference design's word). The label lives in
 * `mentions-disclosure.tsx`, which is also where that history is recorded. THIS
 * file's body copy still says "tag you", which is the act and is correct English;
 * the content is every message that @-tags the viewer. An accordion inside the Info tab, not a
 * popover — the panel is 380px (2026-08-25) and a floating card would cover the rows it
 * answers to.
 */

import type { AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { AgentPill } from "./agent-bits";
import { shortName, type AuthorIndex } from "./view-model";
import type { ChannelMention } from "../types";

/**
 * THE mentions-inbox clip wording. FOURTH surface in the family after
 * `ontology-clipped.ts › clippedNote`, `channel-render-threads.ts ›
 * threadsClippedNote` and `threads-tab.tsx › THREADS_CLIPPED_NOTE`; its own
 * because the REMEDY differs again — this pane has no page argument, and what
 * it can honestly offer is "the most recent" plus the assurance that nothing
 * was dismissed or removed, only pushed below the cut.
 *
 * ⚠ It may NOT let the clip pass as an absence: "nothing else tags you here" is
 * an assertion this read never established.
 *
 * ⚠ NOR MAY IT OVER-ASSERT THE CLIP. It used to say "there are more than one
 * page", which the read never established: a page AT the ceiling counts as
 * clipped (INVARIANTS §9) exactly because a full page and an exhausted one are
 * indistinguishable from here, so an inbox holding precisely the limit was
 * being told there was more. The wording now states what IS shown and stops.
 */
export const MENTIONS_CLIPPED_NOTE =
  "Showing your most recent tags in this channel, up to this list's limit. Nothing here was dismissed; anything not listed is simply below the cut.";

export function MentionsList({
  mentions,
  truncated,
  loading,
  channelName,
  index,
  onOpenMention,
  onMarkAllRead,
}: {
  /** THE WHOLE bounded page, in the server's `seq DESC` order. ⚠ Never
   *  re-sorted here — the LIMIT clipped against that order. */
  mentions: ChannelMention[];
  truncated: boolean;
  loading: boolean;
  channelName: string;
  index: AuthorIndex;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllRead: () => void;
}) {
  const unread = mentions.filter((m) => !m.read).length;

  if (loading && mentions.length === 0) {
    return (
      <p role="status" aria-busy="true" className="sr-only">
        Loading tags
      </p>
    );
  }

  if (mentions.length === 0) {
    return (
      <p className="px-2 pb-2 pt-1 text-caption text-text-muted">
        No messages tag you in this channel yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 pb-2 pl-7 pr-1 pt-0.5">
      {truncated && (
        <p className="rounded-[8px] border border-border-default bg-card-surface-subtle px-2 py-1.5 text-caption text-text-secondary">
          {MENTIONS_CLIPPED_NOTE}
        </p>
      )}
      {unread > 0 && (
        <button
          type="button"
          onClick={onMarkAllRead}
          className="self-end rounded-[6px] px-1.5 py-0.5 text-caption font-medium text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          Mark all read
        </button>
      )}
      {mentions.map((mention) => (
        <MentionItem
          key={mention.messageId}
          mention={mention}
          channelName={channelName}
          index={index}
          onOpen={() => onOpenMention(mention)}
        />
      ))}
    </div>
  );
}

/**
 * WHAT THE ROW'S BLACK PILL SAYS — the agent's name, else its id, else the noun.
 *
 * ⚠ **THE SAME LADDER AS THE TRANSCRIPT'S PILL** (`attribution-pill.tsx ›
 * attributionName`), deliberately: one agent, two surfaces, one answer. A rename
 * the operator made must not show up in the transcript and not in the inbox.
 *
 * ⚠ **`#<id>` KEEPS THE `#`** — Samuel's own way of saying an id out loud — and
 * the bare noun is the honest floor for a row that carries neither
 * (INVARIANTS §11: render what IS known, never a blank standing in for it).
 * ⚠ Exported for its test; it is wording, and wording is worth pinning.
 */
export function agentPillLabel(mention: ChannelMention): string {
  const named = mention.authorAgentName?.trim();
  if (named) return named;
  return mention.authorAgentId ? `#${mention.authorAgentId}` : "Agent";
}

/** An `AvatarPerson` for a mention's author: the roster when it has them, the
 *  projection's own hydrated fields when it does not (a departed member still
 *  owns the message that tagged you). */
function personFor(mention: ChannelMention, index: AuthorIndex): AvatarPerson {
  const member = mention.authorUserId
    ? index.byId.get(mention.authorUserId)
    : undefined;
  return {
    userId: mention.authorUserId ?? `unknown-${mention.messageId}`,
    email: member?.email ?? null,
    displayName: member?.displayName ?? mention.authorName,
    avatarUrl: member?.avatarUrl ?? mention.authorAvatarUrl,
  };
}

function MentionItem({
  mention,
  channelName,
  index,
  onOpen,
}: {
  mention: ChannelMention;
  channelName: string;
  index: AuthorIndex;
  onOpen: () => void;
}) {
  const unread = !mention.read;
  const person = personFor(mention, index);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-unread={unread || undefined}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[8px] px-2 py-1.5 text-left transition-colors",
        // Unread wears a soft link tint + dot; read rows are plain. The tint is
        // conditional so hover can own the background on read rows.
        unread ? "bg-link/5 hover:bg-link/10" : "hover:bg-surface-raised-1"
      )}
    >
      {/* ⚠ NO AVATAR (Samuel, 2026-09-15): *"drop the viewer's profile image from
          row line 1"*. Every row in this list is a message that tagged ONE person
          — the viewer — so a face on each was the same face fifty times, spending
          the row's scarcest axis on a constant. The NAME still identifies the
          author, and the transcript one click away carries the face. */}
      <span className="flex w-full items-center gap-1.5">
        {unread && (
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-link" />
        )}
        <span className="truncate text-small font-semibold text-text-primary">
          {shortName(person, index.currentUserId)}
        </span>
        <span className="ml-auto shrink-0 text-micro text-text-muted">
          {formatRelativeTime(mention.createdAt)}
        </span>
        <span className="sr-only">{unread ? "unread mention" : "read mention"}</span>
      </span>
      <span className="line-clamp-2 text-caption text-text-secondary">
        {mention.snippet}
      </span>
      {/* THE LAST LINE: the agent pill, and the channel name at its bottom-right.
          ⚠ MY READING OF THE BRIEF (Samuel: *"channel name on the row's LAST line,
          bottom-right of the agent pill"*) — one row, pill LEFT, channel name
          pushed RIGHT by `ml-auto`, which is what "bottom-right of" describes on a
          line that already starts with the pill. It is recorded here because the
          phrasing also admits a stacked reading, and a layout decision taken from
          an ambiguous sentence should say which way it went.
          ⚠ THE LINE RENDERS FOR A HUMAN AUTHOR TOO — with no pill, the channel
          name simply sits alone on the right, so every row keeps the same
          three-line shape and the list does not comb. */}
      <span className="flex w-full items-center gap-1.5">
        {mention.authorKind === "agent" && (
          // ⚠ THE AGENT'S NAME, NOT THE NOUN (Samuel, 2026-09-15). Falls back
          // through the operator's rename -> `#<id>` -> "Agent": the same ladder
          // `attribution-pill.tsx › attributionName` walks, for the same reason —
          // `null` is CANNOT SAY and a blank pill would be a claim about nothing.
          <AgentPill>{agentPillLabel(mention)}</AgentPill>
        )}
        <span className="ml-auto truncate text-micro text-text-muted">
          in # {channelName}
        </span>
      </span>
    </button>
  );
}
