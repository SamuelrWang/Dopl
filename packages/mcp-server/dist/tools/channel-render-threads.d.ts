/**
 * THREAD LINKAGE, RENDERED — the tag on a message line, the legend that expands
 * it, and the one predicate that decides whether an id is a THREAD at all.
 *
 * Everything here parses an id out of jsonb and decides what KIND of grouping it
 * names; the rest of `channel-render.ts` renders typed rows. ⚠ One-way —
 * nothing here imports `channel-render.ts`. ⚠ `channel-` filename prefix
 * required by the parity split-scan (`tool-group-files.ts`).
 *
 * ⚠ SECURITY RULE inherited verbatim from `channel-render.ts`: every id spliced
 * here goes through `inlineOr` first, because both splice sites (line head,
 * legend) sit OUTSIDE the untrusted-body framing and the route's `metadata` is a
 * bare record with no charset or newline rule. Today's write path stores either
 * a uuid or a fixed `task-<channel>-<seq>` shape, so this is DEFENCE IN DEPTH
 * for rows written before that gate — a channel carries dozens — and for the
 * render's own rule that it be safe on whatever jsonb hands it.
 */
import type { ChannelMessage } from "@dopl/client";
/** Tell for an id that neutralized to nothing — empty backticks read as a glitch. */
export declare const UNREADABLE_ID = "(unreadable id)";
/**
 * THE CLIPPED-THREAD-LIST NOTICE — worded ONCE, for the one read that can see
 * the clip.
 *
 * `list_threads` is bounded server-side (`features/channels/constants.ts ›
 * CHANNEL_THREAD_LIST_LIMIT`) and a page coming back AT the ceiling counts as
 * clipped, because at is indistinguishable from over (INVARIANTS §9). Nothing
 * ever leaves the list, so this ceiling is reachable by ordinary use rather than
 * by abuse — and a bounded page that renders exactly like an exhausted one is
 * how an agent concludes an exchange does not exist.
 *
 * ⚠ IT MAY NOT OFFER ANOTHER READ AS THE REMEDY. There is no paging argument on
 * this op and `get_thread` needs the id this page did not show, so no read on
 * this connection fills the gap: say so, and say what the list IS bounded to
 * (the most recently active), which is the fact that makes the clip safe to act
 * on.
 *
 * ⚠ It may not let the clip pass as an absence: "no such thread" is an
 * assertion this read never established.
 */
export declare function threadsClippedNote(ref: string): string;
/**
 * The thread a message belongs to. `metadata.taskId` is the STORAGE key for the
 * domain's `thread` and is what decides continuation-vs-new on the receiving
 * side — the body cannot tell them apart.
 */
export declare function threadIdOf(m: ChannelMessage): string | undefined;
/** True when this id names a real, shared `channel_tasks` thread. */
export declare function isFirstClassThreadId(id: string): boolean;
/**
 * A SHORT, STABLE stand-in for an id — the half that distinguishes it.
 *
 * ⚠ NOT a blind `slice(0, 8)`: every synthetic id in one channel begins `task-`
 * + the SAME channel uuid, so the first eight chars of two different ad-hoc
 * exchanges are byte-identical. The distinguishing half is the trailing SEQ,
 * which is also the seq of the message that OPENED the exchange.
 *
 * ⚠ `seq 345`, not `#345` — `neutralizeInline` at the splice site strips `#`
 * with the rest of the markdown punctuation, so a `#` renders as a bare number.
 */
export declare function shortRef(id: string): string;
/**
 * Same short stand-in for the TAIL OF A SESSION SLOT KEY
 * (`<channel>:<agent-or-thread>`). ⚠ Needs a different word from `shortRef`:
 * that renders a legacy tail as `seq 345`, which borrows THREAD vocabulary for
 * a session and names an identity that does not exist (345 is the seq that
 * opened the PAIR exchange). `pair 345` names the desktop's PAIR slot. Other
 * tails are agent/thread uuids and pass through unchanged.
 */
export declare function sessionSlotRef(tail: string): string;
/**
 * Thread clause of a message line. Three shapes:
 *  - UUID → `· thread <tag>`;
 *  - anything else → `· ad-hoc <tag>` (⚠ NOT a thread — no row behind it; a
 *    fabricated non-UUID tag lands here too, correctly, and the legend still
 *    prints it verbatim so nothing is hidden);
 *  - no tag → `· no thread`, but only when the listing uses tags at all.
 */
export declare function threadTagOf(m: ChannelMessage, anyTagged: boolean): string;
/**
 * Expands the short tags into full ids so a reader can act on one. Scales with
 * distinct exchanges, not messages. Null when nothing is tagged.
 *
 * ⚠ TWO LINES, NOT ONE — they promise different things. The threads line says
 * "continue one with thread=<id>", meaning a shared, titled exchange both
 * members see. The ad-hoc line cannot: a `task-…` id names no row.
 *
 * ⚠ But it must NOT tell the reader not to pass one. The receiving desktop's
 * prompt (`main/prompt-framing.js` THREAD_TAG) tells a session to keep its
 * `thread` argument on every post, and for a legacy exchange that argument IS
 * this id — "do not pass one" forks the exchange. Passing one buys the grouping
 * and nothing more; passing SOMEONE ELSE'S is harmless because the post path
 * silently strips a legacy id that is not the poster's.
 *
 * Title is peer-typed (200 chars, interior newlines) and this legend is SERVER
 * NARRATION outside the untrusted-body framing → neutralized; a title that
 * neutralizes to nothing renders as no title.
 */
export declare function threadLegend(messages: ChannelMessage[], ref: string): string | null;
