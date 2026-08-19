"use client";

/**
 * Channels v2 — THE COMPOSER'S @-MENTION PICKER, and the pure functions behind
 * it. Split out of `composer.tsx` when the popover stopped being decoration.
 *
 * ⚠ THIS RESOLVES F-210, WHICH HAD TWO HALVES AND ONE SEAM. The popover
 * rendered candidates and highlighted the first, and nothing clicked, arrowed
 * or Tabbed one into the draft — an inert control on a wired surface. And it
 * suggested on a SUBSTRING of the display label while the resolver
 * (`lib/mentions.ts`) is lowercase EXACT equality against a handle set, so it
 * could offer a person the message would not tag: `@Tay` suggested "Diana
 * Taylor" and `@Taylor` resolved to nobody.
 *
 * ⚠ THE SUBSTRING FILTER STAYS, AND THAT IS THE POINT. A picker SUGGESTS and a
 * human CONFIRMS; widening the resolver instead would tag `@dan` at everybody
 * whose name contains "dan", and a mention decides whose inbox a message lands
 * in. What was actually wrong is that there was nothing to confirm WITH — so
 * the confirmation now inserts `lib/mentions.ts › insertableHandle`, a token
 * the resolver accepts BY CONSTRUCTION. The two rules no longer have to be
 * kept in step; the insert is derived from the resolver's own index.
 *
 * ⚠ A CANDIDATE WITH NO INSERTABLE HANDLE IS NOT OFFERED. Ambiguity fails
 * closed in the parser (rule 5), so a member every one of whose handles is
 * contested has no token that would reach them — listing them would be the
 * inert control all over again, one row deep.
 */

import { Avatar } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { memberLabel } from "../../lib/channel-display";
import { buildMentionIndex, insertableHandle } from "../../lib/mentions";
import { memberPerson } from "./view-model";
import type { ChannelMember } from "../../types";

/** The trailing `@token` of a draft, or null when the caret is not in one. ⚠
 *  The SAME shape {@link insertMentionHandle} rewrites — one regex would be
 *  better still, but the two differ in what they capture. Change both. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  return match ? match[1].toLowerCase() : null;
}

/** Replace the trailing `@token` with the picked handle, plus the space that
 *  ENDS the token — which also closes the popover, because `mentionQuery` then
 *  answers null. */
export function insertMentionHandle(draft: string, handle: string): string {
  return draft.replace(
    /(^|\s)@[^\s@]*$/,
    (_match, lead: string) => `${lead}@${handle} `
  );
}

/** One offered row: the member to SHOW and the handle to INSERT. They are
 *  different strings and conflating them is the whole of F-210. */
export interface MentionSuggestion {
  member: ChannelMember;
  handle: string;
}

/** How many rows the popover offers. A picker is a shortlist; past this the
 *  reader is faster typing the name. */
const MAX_SUGGESTIONS = 5;

/**
 * The rows for a query. ⚠ The index is built from the WHOLE roster, never from
 * the filtered slice: ambiguity is a property of the room, and deciding it
 * against five visible rows would offer `@diana` as unambiguous while a second
 * Diana sat off-screen.
 */
export function mentionSuggestions(
  members: readonly ChannelMember[],
  query: string
): MentionSuggestion[] {
  const index = buildMentionIndex(members);
  const out: MentionSuggestion[] = [];
  for (const member of members) {
    if (!memberLabel(member).toLowerCase().includes(query)) continue;
    const handle = insertableHandle(member, index);
    if (handle === null) continue;
    out.push({ member, handle });
    if (out.length === MAX_SUGGESTIONS) break;
  }
  return out;
}

/** What the popover says when the token matches nobody. ⚠ It renders rather
 *  than vanishing: a popover that disappears mid-word is indistinguishable from
 *  one that never opened, and the reader is left typing at a control that has
 *  silently given up. */
export const MENTION_NO_MATCHES = "No matches";

/** Roster-resolved @-mention candidates for the token being typed. */
export function MentionPopover({
  suggestions,
  active,
  onPick,
}: {
  suggestions: MentionSuggestion[];
  /** Index of the highlighted row — the one Enter/Tab inserts. */
  active: number;
  onPick: (suggestion: MentionSuggestion) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Mention a member"
      className="bento absolute bottom-[calc(100%-4px)] left-4 z-10 w-[220px] p-1.5"
    >
      <p className="px-2 pb-1 pt-0.5 text-label font-semibold uppercase tracking-wide text-text-muted">
        Members
      </p>
      {suggestions.length === 0 ? (
        <p className="px-2 py-1 text-caption text-text-muted">
          {MENTION_NO_MATCHES}
        </p>
      ) : (
        suggestions.map((suggestion, i) => (
          <button
            key={suggestion.member.userId}
            type="button"
            role="option"
            aria-selected={i === active}
            // ⚠ `onMouseDown` + `preventDefault`, not `onClick`: a click steals
            // focus from the textarea first, and the caret position is what the
            // insert rewrites against.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(suggestion);
            }}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-small",
              i === active
                ? "bg-surface-raised-3 font-medium text-text-primary"
                : "text-text-secondary hover:bg-surface-raised-1"
            )}
          >
            <Avatar
              person={memberPerson(suggestion.member)}
              size="xs"
              className="h-[20px] w-[20px] text-micro"
            />
            <span className="truncate">{memberLabel(suggestion.member)}</span>
          </button>
        ))
      )}
    </div>
  );
}
