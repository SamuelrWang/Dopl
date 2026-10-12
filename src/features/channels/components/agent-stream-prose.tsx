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
 * ⚠ 2. **THE ROSTER ARRIVES FROM THE HOST NOW, AND AN @-HANDLE IN THIS LANE TINTS**
 * (Samuel, 2026-10-12: *"@-mention slugs currently render in plain black text. Make them blue"*
 * — ruling 2a, *give both agent hosts a real roster*).
 *
 * ⚠ **THE OLD ANSWER WAS "EMPTY INDEX", AND THE REASON IT GAVE WAS SOUND — WHICH IS WHY THE FIX
 * IS A ROSTER AND NOT A TINT.** A tint asserts that the roster RESOLVED SOMEBODY (F-266: the
 * server's stamp and the transcript's highlight must never disagree about who a message tagged),
 * so painting every `@word` blue here would have been this surface claiming a resolution nobody
 * made. Both hosts now ASK — the web panel passes the index its surface already derived
 * (`surface-agent-view.tsx`), and the window reads the roster it used to skip — so the tint means
 * exactly what it means in the transcript.
 * ⚠ **IT ARRIVES THROUGH A CONTEXT, NOT SIX PROPS.** {@link StreamProse} is called from five
 * faces across four files (this stream's own turns, the inbound box, the directed box and the
 * sent box); threading an index through each of them is five chances for one lane to go quietly
 * untinted. {@link StreamRoster} is set ONCE around the list by `agent-stream.tsx`, off the
 * `roster` prop the addressee pills already take, so the two cannot disagree about who is in the
 * room. ⚠ **AND THE DEFAULT IS STILL THE EMPTY INDEX**: a host with no roster in hand renders
 * exactly what it rendered before this wave — no tint, and no error.
 * ⚠ **AN UNRESOLVED HANDLE STAYS PLAIN**, by that same rule: an ended agent, a typo and a handle
 * belonging to nobody here all render as their own characters, which is the honest signal that
 * they address nobody.
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

import { createContext, useContext } from "react";
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

/**
 * **THE ROSTER EVERY FACE IN ONE STREAM FACES ITS @-HANDLES AGAINST** (2026-10-12).
 *
 * ⚠ **ONE PROVIDER PER STREAM, SET BY `agent-stream.tsx` FROM THE `roster` PROP IT ALREADY TAKES**
 * for the addressee pills. A second source would let the pills and the tints disagree about who is
 * in the room, which is the same class of split F-266 closed between the server's stamp and the
 * transcript's tint.
 * ⚠ **THE DEFAULT IS {@link NO_AUTHORS}**, so a face rendered outside a provider — a test, a
 * preview lane, a host with no roster — resolves nothing and renders plain characters.
 */
const StreamRosterContext = createContext<AuthorIndex>(NO_AUTHORS);

/** Wrap one stream's rows. ⚠ `null` / `undefined` is "this host has no roster", which is the
 *  empty index: identical to the pre-2026-10-12 behaviour, deliberately. */
export function StreamRoster({
  index,
  children,
}: {
  index?: AuthorIndex | null;
  children: React.ReactNode;
}) {
  return (
    <StreamRosterContext.Provider value={index ?? NO_AUTHORS}>
      {children}
    </StreamRosterContext.Provider>
  );
}

/** The stream's own body type — `text-caption` on `text-primary`, the size every
 *  message face in this column already uses. */
const STREAM_PROSE_TEXT = "text-caption text-text-primary";

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
  /* ⚠ READ FROM THE CONTEXT, NOT A PROP — {@link StreamRoster} carries why. The default is the
     shared empty index, so this is a no-op for a host that supplies none. */
  const index = useContext(StreamRosterContext);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <MessageMarkdown
        text={text}
        index={index}
        /* ⚠ `mentionsMe` STAYS `false` AND MUST (rule 3): it is the SERVER-STAMPED
           `metadata.mentionedUserIds` fact, and a narration frame never touched the server. A
           roster resolves WHERE a handle points; only the stamp may claim it tagged the viewer. */
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

/**
 * THE CUT, CONFESSED, UNDER THE FACE THAT SHOWS IT (2026-08-31, Samuel's cutoff
 * report — INVARIANTS §9: a clipped read says so).
 *
 * ⚠ WHY THE FACES NEED THIS WHEN THE LOG LANE HAS ITS OWN CLIP ROW. The message
 * faces (`agent-stream.tsx › OperatorTurn` / `› AgentTurn` /
 * `agent-stream-directed.tsx › DirectedBox`) render their text whole with no
 * clamp — main already bounded it at `PROSE_CAP` — so a line main CUT at that cap
 * reaches the operator as prose that simply stops mid-sentence, with the
 * arithmetic on every layer agreeing it fits. `StreamItem.truncated` is main's
 * own confession that it shortened the line, and for prose the tail exists
 * nowhere: this note is the only honest thing a face can add.
 *
 * ⚠ MUTED AND BELOW THE FACE, not inside it — it is a fact ABOUT the message,
 * not part of what the agent said, and the same `text-micro text-text-muted`
 * the log lane's clip row wears keeps one voice for "you are not seeing all
 * of it" across the column.
 *
 * ⚠ IT LIVES HERE because every face that needs the note is a caller of
 * {@link StreamProse}: the note exists precisely for text rendered WHOLE with no
 * clamp (rule 4 above).
 */
export function TruncatedNote({ alignEnd }: { alignEnd?: boolean }) {
  return (
    <div className={cn("flex", alignEnd && "justify-end")}>
      <span className="text-micro text-text-muted">
        Clipped — the message was longer than the panel keeps.
      </span>
    </div>
  );
}
