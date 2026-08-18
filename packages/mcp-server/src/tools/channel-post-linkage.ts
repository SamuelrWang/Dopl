/**
 * THE SELF-VERIFICATION LINE FOR A POST — did this land as a continuation of an
 * existing thread, or as a NEW request on the other side? ⚠ `channel-` filename
 * prefix required by the parity split-scan (parity.test.ts).
 *
 * ⚠ PEER-CONTROLLED TEXT HERE: thread TITLES. `mine` is "threads I created OR am
 * the target of", and one I am merely the target of was opened AND TITLED by the
 * peer — so an unthreaded post pulls up to five peer-typed titles into the
 * confirmation of my own write. Neutralized, and framed by
 * `UNTRUSTED_THREAD_HEADER` on the one branch that renders them.
 */

import type { ChannelMessage, DoplClient } from "@dopl/client";
import { inlineOr, metaString, neutralizeInline } from "./channel-shared";
import { UNTRUSTED_THREAD_HEADER } from "./channel-render";
// ⚠ THE one predicate for "is this id a real thread" — shared with the read
// render so the two lanes cannot disagree about what a `task-…` id is.
import { isFirstClassThreadId } from "./channel-render-threads";

/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";

/** Thread ids listed in the not-threaded warning before it truncates. */
const OPEN_THREAD_WARN_MAX = 5;

/**
 * ⚠ `closedThreadNote()` USED TO LIVE HERE — the line a post spent
 * `threadClosed` on. It went with thread closing (wiring plan Phase 4,
 * 2026-08-18) and so did the server field behind it.
 *
 * Two rules it carried are worth not relearning. **WARNING, NOT A FAILURE**: the
 * post LANDED, and wording that reads as an error gets an agent to retry a
 * write that already succeeded. **Never claim a silence nothing enforces**: its
 * copy was scoped to the passive lane alone, because an updated desktop skipped
 * the passive wake off a status cache up to ~5 min stale while an older build
 * still woke, and an ADDRESSED post delivered either way.
 */

/**
 * ⚠ Answer is read back off the STORED message, not off the request:
 * `metadata.taskId` is what the receiving desktop routes on, so this reports
 * what actually LANDED rather than what was asked for.
 *
 * ⚠ The id alone is NOT proof of a real thread. A first-class id validates
 * against `channel_tasks`; a legacy `task-<uuid>-<seq>` id names no row and
 * survives the write only as the caller's OWN exchange in THIS channel.
 * `taskTitle` is the unfakeable half — server-stamped from the thread row,
 * caller copies stripped. A note that names a title is backed by a real row; a
 * bare id is the tell that it is not.
 *
 * Three shapes, descending urgency:
 *   1. asked for a thread and got none — the tag-drop signature;
 *   2. no thread but the caller has some — reads as a NEW request;
 *   3. threaded — name it so the sender can check.
 * No threads + unthreaded post says nothing; threads belonging only to OTHER
 * pairs says so without offering them.
 */
export async function threadLinkageNote(
  client: DoplClient,
  channelId: string,
  /** ALREADY neutralized by the caller — splice it, do not re-wrap it. */
  safeChannelName: string,
  message: ChannelMessage,
  askedThread: string | undefined,
): Promise<string | null> {
  const landedThread = metaString(message, "taskId");

  if (landedThread) {
    // ⚠ Title is server-STAMPED, not server-AUTHORED — a member typed it (200
    // chars, newlines allowed) and this line is unframed narration. One inline
    // code span, so it can only read as the thread's name, never as structure.
    const title = metaString(message, "taskTitle");
    const safeTitle = title ? neutralizeInline(title) : null;
    // ⚠ ID needs the span as much as the title: route `metadata` is
    // `z.record(z.unknown())` with no charset rule, and older rows predate the
    // `isLegacyThreadParticipant` write gate. Same field, same treatment as the
    // read side's legend renders from a PEER's message — one rule.
    const safeLanded = inlineOr(landedThread, NO_ID);
    // `askedThread` stays raw: caller's own argument from THIS call, never
    // round-tripped through storage, and verbatim is what makes a mismatch legible.
    const mismatch =
      askedThread && askedThread !== landedThread
        ? ` NOTE: you asked for thread \`${askedThread}\` — it resolved to a different one.`
        : "";
    // ⚠ AN AD-HOC ID IS NOT A THREAD — a non-UUID tag names no `channel_tasks`
    // row, so never call it one. (A missing title alone is ambiguous: a real
    // thread the server could not name looks identical.)
    //
    // ⚠ TWO WAYS TO LAND HERE NEEDING OPPOSITE ADVICE. The desktop prompt
    // (`main/prompt-framing.js` THREAD_TAG) orders a session to keep its
    // `thread` argument on EVERY post, and for a legacy exchange that argument
    // IS this `task-<channel>-<seq>` id — so "open a real thread" reads as "drop
    // the tag", and dropping it FORKS the exchange. Split on who chose the id:
    // caller passed it (and the legacy participation check let it through) →
    // grouping works, keep it. Caller passed nothing → the receiving machine
    // minted it, and a real thread is the upgrade.
    if (!isFirstClassThreadId(landedThread)) {
      const what = `GROUPED into the ad-hoc exchange ${safeLanded}, which is NOT a thread. That id is the label a receiving machine mints for an untagged request so a reply groups with it on that machine's card; there is no thread row behind it, so it has no title, no status, and nothing to close or join. The post landed and is attributed.`;
      if (askedThread === landedThread) {
        return `${what} You passed that id and it survived, so the grouping worked: KEEP passing thread=${safeLanded} on every post in this exchange. Drop it and your next post arrives as a brand-new request, which forks the exchange.`;
      }
      if (askedThread) return `${what}${mismatch}`;
      return `${what} You passed no thread, so the receiving side grouped this for you. If this work needs a real thread, open one with dopl_channel(op="create_thread", channel="${channelId}", title="...", body="...", to="...").`;
    }
    const named = safeTitle
      ? `${safeTitle} (thread ${safeLanded})`
      : `thread ${safeLanded}`;
    // ⚠ WHO CHOSE THIS THREAD must be stated: a post that NAMED a thread and one
    // the server INHERITED one for otherwise render byte-identically (both
    // converge on the same `metadata.taskId`, and `mismatch` fires only when
    // `askedThread` is present AND differs). The server is the only party that
    // knows. State the RULE too, not just the fact: `resolveInheritableTask`
    // attaches the ONE thread between these two members and returns null
    // when `candidates.length !== 1`, so opening a second thread makes
    // inheritance stop — which reads as a regression unless the rule is known.
    const inherited =
      !askedThread
        ? ` You named no thread — the server attached this to your one exchange with that member. Pass thread=${safeLanded} explicitly to keep it there: once a SECOND thread exists between you, nothing is inherited and an untagged post reads as a new request.`
        : "";
    return `THREADED into ${named} — the other side reads this as a continuation of that exchange.${mismatch}${inherited}`;
  }

  if (askedThread) {
    // Reached when the SERVER DROPPED the tag. A first-class id that failed
    // lookup or the thread gate 404s/403s earlier; a non-uuid id is deleted by
    // `isLegacyThreadParticipant` unless it is exactly
    // `task-<this channel's id>-<digits>` and the caller is a party
    // (`service-writes-metadata.ts`). Typo, another pair's legacy id, a legacy
    // id from a DIFFERENT channel, and a whitespace-only `thread` all land here
    // — one remedy fits all: re-post with an id the caller can write into.
    return `NOT THREADED — you passed thread="${askedThread}" but the stored message carries no thread, so this reads as a NEW request on the other side. Re-post with a thread id from dopl_channel(op="list_threads", channel="${channelId}").`;
  }

  // ⚠ Best-effort — a listing failure must not turn a SUCCESSFUL post into an
  // error the agent might retry.
  //
  // ⚠ Reads the same bounded, ACTIVITY-ORDERED page every thread listing reads
  // (`repository-tasks.ts › listTasksByChannel`). A clip is not reported on
  // THIS surface and must not be: this is an advisory note under a post that
  // already succeeded, the threads it can suggest are the most recently active
  // ones, and it never says a thread does not exist — it says this post is not
  // in one, which is true whatever the page held.
  // ⚠ NO `status === "open"` FILTER any more (wiring plan Phase 4,
  // 2026-08-18). Threads do not close, so the only rows it could exclude are
  // legacy ones settled before the removal — and those are still readable,
  // still postable, and still the caller's own exchange. `channel_tasks.status`
  // is legacy and unread (INVARIANTS §5); this was one of its readers.
  let all;
  try {
    const page = await client.listChannelThreads(channelId);
    all = page.threads;
  } catch {
    return null;
  }
  if (all.length === 0) return null;

  // ⚠ RECOMMEND ONLY WHAT THE CALLER CAN WRITE INTO. Thread READS are
  // channel-transparent (`listChannelTasks` unfiltered) but thread WRITES are
  // pair-only — `resolvePostMetadata` 403s a post into a thread the caller is
  // neither creator nor target of. Suggesting another pair's thread costs a
  // burned operator approval and two agent turns per unthreaded post.
  //
  // Caller id comes free off the message just posted: the route stamps
  // `author_user_id = ctx.userId`, the SAME id the participation gate compares
  // against — no round-trip, and no way to disagree with the gate.
  const me = message.authorUserId;
  const mine = me
    ? all.filter((t) => t.createdBy === me || t.targetUserId === me)
    : [];
  if (mine.length === 0) {
    // ⚠ COUNT only, never another pair's title — nothing peer-authored renders
    // on this branch beyond the channel name, so it needs no header.
    return `NOT THREADED — this reads as a NEW request on the other side, not a continuation. **${safeChannelName}** has ${all.length} thread${all.length === 1 ? "" : "s"}, but ${all.length === 1 ? "it belongs" : "they belong"} to other members — a thread accepts posts only from its creator or the member it is addressed to, so re-posting into one would be refused. Leave this standalone, or open your own with dopl_channel(op="create_thread", channel="${channelId}", title="...", body="...", to="...").`;
  }
  // Same peer-typed title, same unframed narration line — neutralize.
  const shown = mine.slice(0, OPEN_THREAD_WARN_MAX).map((t) => {
    const named = neutralizeInline(t.title);
    return named ? `\`${t.id}\` (${named})` : `\`${t.id}\``;
  });
  const more =
    mine.length > shown.length ? `; +${mine.length - shown.length} more` : "";
  // ⚠ Only branch that renders peer TEXT, so only branch that is framed —
  // header FIRST, above the titles it frames.
  return `${UNTRUSTED_THREAD_HEADER}\n\nNOT THREADED — this reads as a NEW request on the other side, not a continuation, and you have ${mine.length} thread${mine.length === 1 ? "" : "s"} in **${safeChannelName}** you can post into: ${shown.join("; ")}${more}. If this belongs to one, re-post it with thread="<that id>".`;
}
