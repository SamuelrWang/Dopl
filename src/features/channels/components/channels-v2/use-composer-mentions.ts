"use client";

/**
 * THE COMPOSER'S @-PICKER, AS STATE — the token under the caret, the shortlist it offers, which
 * row Enter takes, and the two ways a handle gets into the draft.
 *
 * ⚠ SPLIT OUT OF `composer.tsx` ON 2026-08-27, at the 500-line cap. **The seam is §1's
 * reason-to-change**: that file is about SENDING, this is the PICKER, which moved twice in one
 * day while nothing about sending changed. `use-agent-launch.ts` took the same seam. ⚠ **THE
 * THIRD SIBLING, `use-thread-request.ts`, IS DELETED (2026-09-08)** — thread creation is a popup
 * owning its own state (`new-thread-dialog.tsx`).
 *
 * ⚠ IT OWNS NO DRAFT. The text belongs to the composer — it is what gets SENT — so this takes a
 * setter and never a second copy. Two states holding one string is how a picker inserts into a
 * draft the textarea has already moved past.
 */

import { useMemo, useState, type KeyboardEvent } from "react";
import {
  insertMentionHandle,
  mentionQuery,
  mentionSuggestions,
  type MentionSuggestion,
} from "./composer-mentions";
import { liveAgentCandidates, type LiveAgentSession } from "../../lib/draft-recipients";
import type { ChannelMember } from "../../types";

export function useComposerMentions({
  draft,
  setDraft,
  members,
  sessions,
  currentUserId,
}: {
  draft: string;
  setDraft: (next: (prev: string) => string) => void;
  members: ChannelMember[];
  /**
   * **THE CHANNEL'S LIVE AGENTS** (2026-09-02, slice B10) — the peer projection
   * as it arrives, reduced by `lib/draft-recipients.ts › liveAgentCandidates` so
   * this hook holds no second reading of `channel_sessions.name`. It used to be
   * THIS MACHINE's map, which made tagging a desktop-only affordance.
   */
  sessions: readonly LiveAgentSession[];
  currentUserId: string;
}) {
  // ⚠ `query === null` = the caret is not in a token, so there is no popover at all; an empty
  // ARRAY is a token that matches nobody, which the popover STATES rather than vanishing on
  // (F-210 — a popover that disappears mid-word is one that never opened).
  const query = mentionQuery(draft);
  const suggestions = useMemo(
    () =>
      query === null
        ? []
        : mentionSuggestions({
            members,
            // ⚠ ONE DERIVATION with the SERVER's resolver — `liveAgentHandles` builds its index
            // from the same projection and the same two fields, so a row the picker offers is a
            // token `to=` would resolve.
            agents: liveAgentCandidates(sessions),
            currentUserId,
            query,
          }),
    [members, sessions, currentUserId, query]
  );
  // ⚠ CLAMPED AT READ rather than reset in an effect: the list re-filters on every keystroke, and
  // a stale index would insert whoever happened to land in that slot.
  const [highlight, setHighlight] = useState(0);
  const active = Math.min(highlight, Math.max(suggestions.length - 1, 0));

  return {
    query,
    suggestions,
    active,
    setHighlight,
    /** ⚠ THE HANDLE, NEVER THE LABEL — it came from the resolver's own index, so what lands in
     *  the draft resolves to this member by construction rather than by two rules agreeing. */
    pick: (suggestion: MentionSuggestion) => {
      setDraft((prev) => insertMentionHandle(prev, suggestion.handle));
      setHighlight(0);
    },
    /**
     * THE `@` GLYPH'S ACT (Samuel, 2026-08-27) — it was inert, a dead control beside working ones.
     *
     * ⚠ IT OPENS THE PICKER BY WRITING THE TOKEN: the popover is a pure function of the DRAFT
     * (`mentionQuery`), so there is no second "open" path to keep in step. ⚠ A SPACE FIRST unless
     * the draft already ends in one, or the `@` welds onto the previous word and `mentionQuery`
     * answers null.
     */
    openFromButton: () => {
      setDraft((prev) => (prev === "" || prev.endsWith(" ") ? `${prev}@` : `${prev} @`));
      setHighlight(0);
    },
    /**
     * **THE FIELD'S KEY HANDLING, WHICH IS MOSTLY THE PICKER'S** (moved here
     * 2026-09-02, slice B10, at the composer's 500-line cap — §1).
     *
     * ⚠ **THE SEAM IS §1's REASON-TO-CHANGE.** Four of the five branches are
     * about the shortlist and moved when the picker did; what is left for the
     * composer is what Enter does with no candidate highlighted, which arrives
     * as `onSend`.
     *
     * ⚠ **THE IME GUARD COVERS THE WHOLE HANDLER, NOT JUST SEND.** A
     * composition's own Enter CONFIRMS a candidate and its arrows MOVE through
     * one; stealing either posts a half-typed word.
     */
    keyDown: (e: KeyboardEvent<HTMLTextAreaElement>, onSend: () => void) => {
      if (e.nativeEvent.isComposing) return;
      if (suggestions.length > 0) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          // Wraps, so the list has no dead end in either direction.
          setHighlight((active + step + suggestions.length) % suggestions.length);
          return;
        }
        // ⚠ THE PICKER OUTRANKS SEND while it is open — Enter with a highlighted
        // candidate confirms it rather than posting the half-typed `@dia`.
        if (e.key === "Enter" || e.key === "Tab") {
          if (e.key === "Enter" && e.shiftKey) return;
          e.preventDefault();
          setDraft((prev) => insertMentionHandle(prev, suggestions[active].handle));
          setHighlight(0);
          return;
        }
      }
      // Enter sends, Shift+Enter breaks the line.
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      onSend();
    },
  };
}
