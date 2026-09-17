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
 * ⚠ **`MENTIONS_CLIPPED_NOTE` STOOD HERE AND IS DELETED (Samuel, 2026-09-15):
 * *"delete both explainer lines"*.** It was two careful sentences about a bound
 * — that the page is the most recent N, and that nothing below the cut was
 * dismissed — and the list now SCROLLS, so the cut it explained is no longer
 * something the reader bumps into.
 *
 * ⚠ **THE BOUND ITSELF IS UNTOUCHED** (`CHANNEL_MENTION_LIST_LIMIT`, server-side)
 * and `truncated` still rides the wire. What went is the paragraph, not the fact;
 * a future surface that needs to say it should say it in its own words rather
 * than resurrect this one.
 */

/**
 * 🔒 **WHERE THE LIST HANGS UNDER ITS HOST — the LEFT INSET, AND IT IS THE HOST'S
 * FACT (Samuel, 2026-09-17, over /home's Info tab, verbatim):** *"For mentions,
 * each individual mention is starting further right, so it is not saying flush
 * with the rest of the things. It should be moved a little bit to the left to
 * start at the same place."*
 *
 * ⚠ **THE LIST CARRIED ONE NUMBER FOR BOTH HOSTS AND IT WAS THE DISCLOSURE'S.**
 * `pl-7` (28px) hangs the rows under `mentions-disclosure.tsx`'s own ROW LABEL —
 * that row's `px-2`, its 14px `Tag` glyph and its `gap-2`, which is exactly what a
 * disclosure's contents should line up with. **On /home the list is not inside a
 * disclosure**: it is a TOP-LEVEL CATEGORY under a `PanelHeading` (2026-09-15), so
 * those 28px indented it past every heading and every other section on the tab.
 * ⚠ **`flush` IS ARITHMETIC, NOT A GUESS**: `bits.tsx › PanelHeading` is `px-3.5`
 * and the activity strip and the roster below it are `px-3.5` too — 14px is the
 * tab's column edge — and a mention row carries its own `px-2` hover inset, so the
 * list needs 14 − 8 = 6px for the row's TEXT to start on that edge.
 * ⚠ **NO DEFAULT, BECAUSE THE TWO HOSTS DISAGREE.** A default is how the next host
 * silently inherits the other one's indent, which is the defect this prop exists
 * to end.
 */
export type MentionsListInset = "nested" | "flush";

const MENTIONS_INSET: Record<MentionsListInset, string> = {
  nested: "pl-7",
  flush: "pl-1.5",
};

export function MentionsList({
  mentions,
  loading,
  channelName,
  index,
  onOpenMention,
  inset,
}: {
  /** THE WHOLE bounded page, in the server's `seq DESC` order. ⚠ Never
   *  re-sorted here — the LIMIT clipped against that order. */
  mentions: ChannelMention[];
  /** ⚠ CARRIED, NOT RENDERED (2026-09-15): the clip is a real fact the read
   *  establishes and the prop stays on the wire, but the paragraph that stated it
   *  is deleted and the list scrolls instead. A surface that wants to say it again
   *  should say it in its own words. */
  truncated: boolean;
  loading: boolean;
  channelName: string;
  index: AuthorIndex;
  onOpenMention: (mention: ChannelMention) => void;
  /** ⚠ ACCEPTED AND UNUSED since 2026-09-15: the bulk button is deleted, and the
   *  prop stays so the two hosts keep one call shape. Its handler is still the
   *  surface's, still correct, and still wired for whatever asks next. */
  onMarkAllRead: () => void;
  /** Under a disclosure row, or on the panel's own column edge — see
   *  {@link MentionsListInset}. */
  inset: MentionsListInset;
}) {
  // ⚠ "Mark all read" STOOD HERE AND IS DELETED (Samuel, 2026-09-15, item 7). The
  // WRITE path is untouched — `use-mention-writes.ts › markRead` still fires on a
  // row's own click, which is how a mention becomes read now.

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
    /* ⚠ **THREE ROWS TALL, THEN IT SCROLLS** (Samuel, 2026-09-15). The cap stays
       SERVER-side at 50; this is the viewport, not the bound. `max-h` is measured
       in `rem` against the row's own two lines rather than given a pixel height,
       so it keeps its ~3 rows if the type scale is retuned — the same discipline
       `agent-color-dot.tsx` states for its `size-2`.
       ⚠ `overscroll-contain` so reaching the end does not start scrolling the Info
       panel behind it, which on a 380px column reads as the whole tab jumping. */
    <div
      className={cn(
        "flex max-h-[13.5rem] flex-col gap-1 overflow-y-auto overscroll-contain pb-2 pr-1 pt-0.5",
        // ⚠ THE LEFT INSET IS THE HOST'S — see {@link MentionsListInset}. It is the
        // only class here that differs between the two surfaces.
        MENTIONS_INSET[inset]
      )}
    >
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
        // ⚠ **NO BACKGROUND ON A MENTION ROW, READ OR UNREAD** (Samuel, 2026-09-15,
        // looking at it live: *"right now there is no background color around each
        // mention, I actually like this better"*). The blue unread tint and the
        // agent-coloured shade that briefly replaced it are BOTH gone; hover is the
        // only fill this row ever wears.
        // ⚠ UNREAD IS STILL SAID, just not in paint: the row keeps its screen-reader
        // word, and the agent's colour now rides the PILL, which is where a reader
        // looks for whose ask it is.
        "hover:bg-surface-raised-1"
      )}
    >
      {/* ⚠ **LINE 1 IS: WHO · WHERE · WHEN** (Samuel, 2026-09-15, round 3 + his live
          correction the same hour, which removed the unread dot that briefly led it).
          ⚠ **"You" IS GONE AND THE AGENT PILL TOOK ITS PLACE.** An agent posts under
          its OPERATOR's user id, so `shortName` correctly answered "You" for every
          agent row in the viewer's own channels — technically true and useless: it
          named the account, when the question the row answers is WHICH AGENT tagged
          me. The pill moved up from the last line into that slot.
          ⚠ **A HUMAN AUTHOR STILL GETS THEIR NAME.** The swap is keyed on
          `authorKind`, not on the word: a peer who tags you is a person, and
          replacing their name with a pill would lose the only thing identifying
          them. Only the self-authored/agent case changes.
          ⚠ **AND THE OLD LAST LINE IS DELETED, NOT HIDDEN** — its two contents both
          moved here, so keeping an empty third line would leave every row taller
          than its content. */}
      <span className="flex w-full items-center gap-1.5">
        {mention.authorKind === "agent" ? (
          <AgentPill color={mention.authorAgentColor}>{agentPillLabel(mention)}</AgentPill>
        ) : (
          <span className="truncate text-small font-semibold text-text-primary">
            {shortName(person, index.currentUserId)}
          </span>
        )}
        {/* ⚠ **RIGHT OF THE PILL** (item 3), not on a line of its own. */}
        <span className="truncate text-micro text-text-muted">in # {channelName}</span>
        <span className="ml-auto shrink-0 text-micro text-text-muted">
          {formatRelativeTime(mention.createdAt)}
        </span>
        <span className="sr-only">{unread ? "unread mention" : "read mention"}</span>
      </span>
      <span className="line-clamp-2 text-caption text-text-secondary">
        {mention.snippet}
      </span>
    </button>
  );
}
