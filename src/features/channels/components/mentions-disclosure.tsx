"use client";

/**
 * Channels — THE TAGS ROW AND WHAT IT OPENS, as one component.
 *
 * ⚠ EXTRACTED BECAUSE A SECOND SURFACE NEEDED IT AND COPIED NOTHING
 * (2026-09-15, Samuel: the home space's Info tab had no Tags section at all).
 * The two Info tabs collapsed into one body with a ruled branch in wave 1A
 * (2026-09-17, `ChannelSurfaceCapabilities.mentionsLayout`); this row is the
 * DISCLOSURE face and `mentions-list.tsx` is the list under both. The parity gap
 * was never that the home tab rendered the section differently — it was that the
 * surface FETCHED the mentions and the injected tab threw them away.
 *
 * ⚠ **SO THE ROW IS DECLARED ONCE, HERE, RATHER THAN TWICE.** Pasting the
 * disclosure into the second tab would have shipped two spellings of one
 * control: the unread arithmetic, the chevron, the badge's colour rule and the
 * open-state default would each have had two homes and drifted on the first
 * change. That is the failure `view-model-rows.ts` and `agent-post-stamp.ts`
 * both carry warnings about, in this same feature.
 *
 * ⚠ **THE BADGE IS CLIENT-SIDE ARITHMETIC over the rows on hand** — never a
 * second server derivation of the same set (wiring plan Phase 6, decision 3).
 * It counts UNREAD, so a fully-read inbox reads `0` with rows still inside; that
 * is the design, not an empty list.
 *
 * ⚠ **IT STARTS COLLAPSED AND THAT IS DELIBERATE.** The panel is 380px and the
 * page is capped at 50 rows; an always-open list would push the roster and the
 * activity strip off the tab. The count is the affordance.
 *
 * ⚠ **THE LABEL IS "Mentions" (Samuel, 2026-09-15), AND IT USED TO BE "Tags".**
 * "Tags" was the REFERENCE DESIGN's word and it shipped for that reason; it was
 * overruled the day the home-space section was wired, on the ground that the row
 * is read by people who are looking for the thing they were @-mentioned in. **It
 * is a deliberate rename, not drift** — recorded here because the old word is
 * still the one in `mentions-list.tsx`'s BODY copy ("No messages tag you in this
 * channel yet"), which is correct English about the act and was left alone.
 *
 * ⚠ **THE INTERNAL VOCABULARY DID NOT MOVE WITH IT.** `channel_mention_reads`,
 * `metadata.mentionedUserIds`, `useChannelMentions`, `MENTIONS_CLIPPED_NOTE` —
 * all unchanged. A label is not a schema, and renaming storage to chase a word on
 * a button is how a rename becomes a migration.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Tag } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MentionsList } from "./mentions-list";
import type { AuthorIndex } from "./view-model";
import type { ChannelMention } from "../types";

/**
 * Everything the Tags row needs, as ONE object.
 *
 * ⚠ IT TRAVELS AS A BUNDLE because the surface already owns every field
 * (`surface-info-panel.tsx`): the page, its clip flag, its loading flag, the
 * author index, and the two handlers that know about the CENTRE PANE. A tab
 * cannot mint the handlers — `onOpen` marks read, lands the pane on the right
 * transcript and then fires the NONCED scroll signal, and only the surface has
 * the selection state that last step needs.
 */
export interface MentionsBundle {
  /** MY mentions in this channel, in the server's `seq DESC` order. ⚠ Never re-sorted. */
  mentions: ChannelMention[];
  truncated: boolean;
  loading: boolean;
  index: AuthorIndex;
  onOpen: (mention: ChannelMention) => void;
  onMarkAllRead: () => void;
}

export function MentionsDisclosure({
  channelName,
  bundle,
}: {
  channelName: string;
  bundle: MentionsBundle;
}) {
  // The open state is this row's own business and nobody else's.
  const [open, setOpen] = useState(false);
  const unreadCount = bundle.mentions.filter((m) => !m.read).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left transition-colors hover:bg-surface-raised-1"
      >
        <Tag size={14} className="shrink-0 text-text-muted" />
        <span className="text-small text-text-secondary">Mentions</span>
        <span className="flex-1" />
        <span
          className={cn(
            "text-body",
            unreadCount > 0 ? "font-semibold text-link" : "text-text-primary"
          )}
        >
          {unreadCount}
        </span>
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-text-disabled" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-text-disabled" />
        )}
      </button>
      {open && (
        <MentionsList
          mentions={bundle.mentions}
          truncated={bundle.truncated}
          loading={bundle.loading}
          channelName={channelName}
          index={bundle.index}
          onOpenMention={bundle.onOpen}
          onMarkAllRead={bundle.onMarkAllRead}
          // ⚠ THE ROWS HANG UNDER THIS ROW'S LABEL — `px-2` + a 14px glyph +
          // `gap-2`. **The number used to live in the list**, which is why /home's
          // top-level Mentions section inherited a disclosure's indent
          // (`mentions-list.tsx › MentionsListInset`, Samuel 2026-09-17).
          inset="nested"
        />
      )}
    </>
  );
}
