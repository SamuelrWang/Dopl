"use client";

/**
 * THE WORK STREAM'S PROSE, RENDERED AS MARKDOWN (Samuel's ruling, 2026-08-31).
 *
 * The stream's message faces printed their own asterisks and backticks: an agent
 * that answered with a bolded heading and a fenced snippet reached the operator
 * as one undifferentiated block of characters. The transcript has solved this
 * since 2026-08-21 and the ruling is **R1 — reuse that renderer, do not fork it**.
 *
 * ⚠ IT IS A THIN ADAPTER OVER `message-markdown.tsx`, ON PURPOSE, AND IT IS THE
 * ONLY THING IN IT. No second lexer, no second link policy, no second HTML rule:
 * the untrusted-body discipline that file states (tokens to React elements, never
 * an HTML string) is the whole reason a second renderer must never exist. What
 * this file owns is the two things that ARE different here — the CONTAINER, and
 * the roster.
 *
 * ⚠ 1. THE CONTAINER IS OURS BECAUSE THE RENDERER HAS NONE. `MessageMarkdown`
 * renders a FRAGMENT (its rule 4) so the transcript's own flex column can anchor
 * each block. This stream has no such column at the row level, so the blocks
 * would otherwise land as loose siblings inside a `<li>` with no rhythm between
 * them. The wrapper supplies the rhythm and nothing else.
 *
 * ⚠ 2. THE ROSTER IS EMPTY, AND THAT IS A MEASUREMENT RATHER THAN A SHORTCUT.
 * Neither agent host holds one — `agent-panel.tsx` already builds
 * `indexMembers([], currentUserId)` for the escalation derivation and says why,
 * and `agent-window.tsx`'s diet is messages plus consent — so an index threaded
 * through two hosts would carry an empty `byId` at both ends and tint exactly
 * nothing. **An empty index is what those hosts would pass**, so it is built here
 * once instead, and an @-handle in this lane renders as its own characters. That
 * is also the correct claim: a tint asserts the roster resolved somebody, and
 * this surface did not ask.
 *
 * ⚠ 3. `mentionsMe` IS `false` AND MUST STAY SO. It is the SERVER-STAMPED
 * `metadata.mentionedUserIds` fact, and a narration frame has no metadata and
 * never touched the server. Passing `true` would paint the "this tags YOU"
 * highlight from a claim nobody made.
 *
 * ⚠ 4. **NO CLAMP LIVES HERE, AND THE LOG LANE IS DELIBERATELY NOT A CALLER.**
 * `agent-stream-log.tsx` bounds its rows by SLICING the string (`COLLAPSED_CHARS`
 * closed, `EXPANDED_CHARS` open) and then `line-clamp-2` on top. Both are wrong over
 * markdown — a slice cuts a fence or a link mid-token and renders the wreckage,
 * and `line-clamp` is a `-webkit-box` rule that does not clamp a container of
 * sibling blocks — so the bulk lane keeps plain text and keeps its clip. The
 * faces this file serves have no clamp at all, and do not need one: main already
 * bounds every prose frame at `session-narration.js › PROSE_CAP`, which is held
 * equal to the log lane's `EXPANDED_CHARS` by that constant's own note. ⚠ Read
 * the two symbols rather than a number — they moved together on 2026-08-31 and
 * are meant to keep doing so.
 *
 * ⚠ 5. **WHAT THE OPERATOR ACTUALLY GETS TODAY IS INLINE MARKDOWN — F-376.**
 * `session-narration.js › line` — and `› prose`, the dedicated prose helper added
 * the same day — collapse `/\s+/` to single spaces on EVERY frame, so a list, a
 * heading and a fenced block have lost the
 * newlines they are made of before this component ever sees them. `**bold**`,
 * `` `code` ``, emphasis and links survive and now render; block structure
 * cannot, and no change on this side can recover it. Filed against main rather
 * than worked around here: re-inserting newlines would be this file guessing at
 * text it did not receive.
 */

import { cn } from "@/shared/lib/utils";
import { MessageMarkdown } from "./message-markdown";
import { indexMembers } from "./view-model";
import type { AuthorIndex } from "./view-model";

/**
 * ⚠ ONE INSTANCE, NOT A FRESH INDEX PER RENDER — `view-model.ts › NO_AGENTS`'s
 * rule, one level up: `MessageMarkdown` builds its handle maps from this on every
 * render, and a new identity each time would rebuild them for no reader.
 * ⚠ THE EMPTY `currentUserId` IS LOAD-BEARING, not a placeholder: it is compared
 * against a resolved mention's user id, and no id is ever `""`, so the viewer
 * highlight cannot fire here even if `mentionsMe` were somehow true.
 */
const NO_AUTHORS: AuthorIndex = indexMembers([], "");

/** The stream's own body type — `text-caption` on `text-primary`, the size every
 *  message face in this column already uses. */
export const STREAM_PROSE_TEXT = "text-caption text-text-primary";

export function StreamProse({
  text,
  className,
  textClassName = STREAM_PROSE_TEXT,
}: {
  text: string;
  /** The caller's own container geometry — width caps, alignment, padding. */
  className?: string;
  /** The body's size + colour. ⚠ Overridden only where the face's ground differs
   *  (`message-markdown.tsx`'s rule 5: a heading and a code fence set their own
   *  and receive neither). */
  textClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <MessageMarkdown
        text={text}
        index={NO_AUTHORS}
        mentionsMe={false}
        // ⚠ THE GEOMETRY EVERY TOP-LEVEL BLOCK WEARS. `wrap-anywhere` is the one
        // rule this column cannot do without: a posted body is somebody's real
        // words and an unbroken URL must wrap rather than escape 380px. No width
        // cap — the transcript's 92% anchors an own-message bubble against a
        // full-width column, and there is no such column here.
        blockClassName="wrap-anywhere min-w-0"
        textClassName={textClassName}
      />
    </div>
  );
}
