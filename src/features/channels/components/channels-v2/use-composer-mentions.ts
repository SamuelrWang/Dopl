"use client";

/**
 * THE COMPOSER'S @-PICKER, AS STATE — the token under the caret, the shortlist it offers, which
 * row Enter takes, and the two ways a handle gets into the draft.
 *
 * ⚠ SPLIT OUT OF `composer.tsx` ON 2026-08-27, at the 500-line cap. **The seam is §1's
 * reason-to-change**, not the count that forced the question: that file is about SENDING — a
 * draft, a request, a launch — and this is the PICKER, which moved twice in one day (agents
 * joined the list, the `@` glyph learned to open it) while nothing about sending changed. Same
 * seam its siblings took: `use-thread-request.ts` holds the request form, `use-agent-launch.ts`
 * the launch panel.
 *
 * ⚠ IT OWNS NO DRAFT. The text belongs to the composer — it is what gets SENT — so this takes a
 * setter and never a second copy. Two states holding one string is how a picker inserts into a
 * draft the textarea has already moved past.
 */

import { useMemo, useState } from "react";
import {
  insertMentionHandle,
  mentionQuery,
  mentionSuggestions,
  type MentionSuggestion,
} from "./composer-mentions";
import type { ChannelMember } from "../../types";

export function useComposerMentions({
  draft,
  setDraft,
  members,
  agents,
  currentUserId,
}: {
  draft: string;
  setDraft: (next: (prev: string) => string) => void;
  members: ChannelMember[];
  /** THIS machine's own agents — the same map the transcript tints from. */
  agents: ReadonlyMap<string, { displayName: string | null }>;
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
            // ⚠ ONE DERIVATION with the transcript's tint, so the picker cannot offer a handle
            // the rendered body would not highlight.
            agents: [...agents.entries()].map(([agentId, identity]) => ({
              agentId,
              displayName: identity.displayName,
            })),
            currentUserId,
            query,
          }),
    [members, agents, currentUserId, query]
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
     * ⚠ IT OPENS THE PICKER BY WRITING THE TOKEN, which is the only honest wiring: the popover is
     * a pure function of the DRAFT (`mentionQuery`), so there is no second "open" path to keep in
     * step. ⚠ A SPACE FIRST unless the draft already ends in one, or the `@` welds onto the
     * previous word and `mentionQuery` — which requires a boundary — answers null.
     */
    openFromButton: () => {
      setDraft((prev) => (prev === "" || prev.endsWith(" ") ? `${prev}@` : `${prev} @`));
      setHighlight(0);
    },
  };
}
