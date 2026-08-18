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
import { inlineOr, metaString, neutralizeInline } from "./channel-shared";

/** Tell for an id that neutralized to nothing — empty backticks read as a glitch. */
export const UNREADABLE_ID = "(unreadable id)";

/**
 * THE CLIPPED-THREAD-LIST NOTICE — worded ONCE, for the one read that can see
 * the clip.
 *
 * `list_threads` is bounded server-side (`features/channels/constants.ts ›
 * CHANNEL_THREAD_LIST_LIMIT`) and a page coming back AT the ceiling counts as
 * clipped, because at is indistinguishable from over (INVARIANTS §9). Threads
 * are never closed and never leave the list, so this ceiling is reachable by
 * ordinary use rather than by abuse — and a bounded page that renders exactly
 * like an exhausted one is how an agent concludes an exchange does not exist.
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
export function threadsClippedNote(ref: string): string {
  return `_CLIPPED — **${ref}** holds more threads than one listing returns, so these are the MOST RECENTLY ACTIVE ones and older exchanges are missing. This op takes no page argument, so no read here fills the gap: if the thread you want is not above, do NOT conclude it does not exist — ask your operator for its id, or open a new one._`;
}

/** How many leading characters of a thread id stand in for it inline. */
const THREAD_TAG_LEN = 8;

/** Distinct exchanges named in a listing's legend before it truncates. */
const THREAD_LEGEND_MAX = 6;

/**
 * A FIRST-CLASS thread id — a `channel_tasks` uuid, the only shape naming a real
 * thread. ⚠ Must stay the same test the rest of the product gates on:
 * `resolvePostMetadata` validates and 403-gates ONLY inside `isUuid`, and the
 * desktop's `targeting.firstClassTaskId` lets nothing else select the thread
 * lane. Anything failing it has no row: no title, no status, no parties, and
 * nothing to close, reopen or join.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * SYNTHETIC id a receiving desktop mints for an untagged request:
 * `task-<channel uuid>-<seq>`, deterministic from (channel, seq)
 * (`main/trigger.js › taskIdFor`, mirrored in `main/legacy-threads.js`). ⚠ Must
 * NOT render like a real thread id — it groups an untagged request with its
 * reply on one machine's card and nothing more.
 */
const SYNTHETIC_THREAD_RE =
  /^task-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-(\d{1,15})$/;

/**
 * The thread a message belongs to. `metadata.taskId` is the STORAGE key for the
 * domain's `thread` and is what decides continuation-vs-new on the receiving
 * side — the body cannot tell them apart.
 */
export function threadIdOf(m: ChannelMessage): string | undefined {
  return metaString(m, "taskId");
}

/** True when this id names a real, shared `channel_tasks` thread. */
export function isFirstClassThreadId(id: string): boolean {
  return UUID_RE.test(id);
}

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
export function shortRef(id: string): string {
  const synthetic = SYNTHETIC_THREAD_RE.exec(id);
  return synthetic ? `seq ${synthetic[1]}` : id.slice(0, THREAD_TAG_LEN);
}

/**
 * Same short stand-in for the TAIL OF A SESSION SLOT KEY
 * (`<channel>:<agent-or-thread>`). ⚠ Needs a different word from `shortRef`:
 * that renders a legacy tail as `seq 345`, which borrows THREAD vocabulary for
 * a session and names an identity that does not exist (345 is the seq that
 * opened the PAIR exchange). `pair 345` names the desktop's PAIR slot. Other
 * tails are agent/thread uuids and pass through unchanged.
 */
export function sessionSlotRef(tail: string): string {
  const synthetic = SYNTHETIC_THREAD_RE.exec(tail);
  return synthetic ? `pair ${synthetic[1]}` : shortRef(tail);
}

/**
 * Thread clause of a message line. Three shapes:
 *  - UUID → `· thread <tag>`;
 *  - anything else → `· ad-hoc <tag>` (⚠ NOT a thread — no row behind it; a
 *    fabricated non-UUID tag lands here too, correctly, and the legend still
 *    prints it verbatim so nothing is hidden);
 *  - no tag → `· no thread`, but only when the listing uses tags at all.
 */
export function threadTagOf(
  m: ChannelMessage,
  anyTagged: boolean,
): string {
  const id = threadIdOf(m);
  if (!id) return anyTagged ? ` · no thread` : "";
  const label = isFirstClassThreadId(id) ? "thread" : "ad-hoc";
  return ` · ${label} ${inlineOr(shortRef(id), UNREADABLE_ID)}`;
}

/**
 * Expands the short tags into full ids so a reader can act on one. Scales with
 * distinct exchanges, not messages. Null when nothing is tagged.
 *
 * ⚠ TWO LINES, NOT ONE — they promise different things. The threads line says
 * "continue one with thread=<id>", meaning a shared, titled, closable exchange.
 * The ad-hoc line cannot: a `task-…` id names no row.
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
export function threadLegend(
  messages: ChannelMessage[],
  ref: string,
): string | null {
  const titles = new Map<string, string | undefined>();
  for (const m of messages) {
    const id = threadIdOf(m);
    if (!id) continue;
    if (!titles.get(id)) titles.set(id, metaString(m, "taskTitle"));
  }
  if (titles.size === 0) return null;
  const entries = [...titles.entries()];
  const threads = entries.filter(([id]) => isFirstClassThreadId(id));
  const adHoc = entries.filter(([id]) => !isFirstClassThreadId(id));
  const lines: string[] = [];
  if (threads.length > 0) lines.push(legendThreads(threads, ref));
  if (adHoc.length > 0) lines.push(legendAdHoc(adHoc, ref));
  return lines.join("\n");
}

/** One legend entry: `<short> = <full id>` plus the title where there is one. */
function legendEntry([id, title]: [string, string | undefined]): string {
  const named = title ? neutralizeInline(title) : null;
  // ⚠ FULL id at full length lands here, and a hand-built code span is not a
  // container — one backtick in a peer-set `taskId` closes it and the rest
  // becomes legend text; a newline forges whole entries plus the tool-call
  // guidance under them. `inlineOr` strips before it wraps.
  return `${inlineOr(shortRef(id), UNREADABLE_ID)} = ${inlineOr(id, UNREADABLE_ID)}${named ? ` (${named})` : ""}`;
}

/** `+N more` when the legend truncated, else nothing. */
function moreNote(total: number, shown: number): string {
  return total > shown ? `; +${total - shown} more` : "";
}

function legendThreads(
  entries: [string, string | undefined][],
  ref: string,
): string {
  const shown = entries.slice(0, THREAD_LEGEND_MAX).map(legendEntry);
  return `Threads above: ${shown.join("; ")}${moreNote(entries.length, shown.length)}. Continue one with dopl_channel(op="post", channel="${ref}", thread="<the full id>") — a post with no thread reads as a NEW request on the other side.`;
}

function legendAdHoc(
  entries: [string, string | undefined][],
  ref: string,
): string {
  const shown = entries.slice(0, THREAD_LEGEND_MAX).map(legendEntry);
  return `Ad-hoc exchanges above: ${shown.join("; ")}${moreNote(entries.length, shown.length)}. These are NOT threads: a \`task-<channel>-<seq>\` id is the label a RECEIVING machine mints for an untagged request so the reply groups with it on that machine's card. There is no thread row behind one: no title, no status, no recorded parties, and nothing to close, reopen or join. Passing one as thread="<the full id>" keeps a reply grouped with its request, which is worth doing on every post in that exchange; it does not open a shared exchange, and an id that is not yours is dropped and the post lands untagged. If this work needs a real thread, open one with dopl_channel(op="create_thread", channel="${ref}", title="...", body="...", to="...").`;
}
