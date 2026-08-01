/**
 * THE SELF-VERIFICATION LINE FOR A POST — did this land as a continuation of an
 * existing thread, or as a NEW request on the other side?
 *
 * Split out of `channel-ops-write.ts` at the §2 500-line cap when agent
 * addressing landed, along the seam that file had already drawn twice: every
 * other line of a post's result already lives in its own module
 * (`channel-addressing.ts` owns the unaddressed note, `channel-wake-guidance.ts`
 * the wake claims). This is the third, and the largest. The `channel-` filename
 * prefix is required by the parity split-scan (parity.test.ts).
 *
 * PEER-CONTROLLED TEXT HERE: thread TITLES. `mine` is "threads I created OR am
 * the target of", and a thread I am merely the target of was opened AND TITLED
 * by the peer — so an unthreaded post can pull up to five peer-typed titles into
 * the confirmation of my own write, a surface the agent never chose to read.
 * Neutralized, and framed by `UNTRUSTED_THREAD_HEADER` on the one branch that
 * renders them.
 */

import type { ChannelMessage, DoplClient } from "@dopl/client";
import { inlineOr, metaString, neutralizeInline } from "./channel-shared";
import { UNTRUSTED_THREAD_HEADER } from "./channel-render";

/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";

/** Open thread ids listed in the not-threaded warning before it truncates. */
const OPEN_THREAD_WARN_MAX = 5;

/**
 * Q7 — the SELF-VERIFICATION line for a post: did this land as a continuation
 * of an existing thread, or as a new request on the other side?
 *
 * Reported by the responder agent during live testing: it had no way to tell,
 * and neither did the requester (await/read rendered bodies only, so confirming
 * a thread tag meant raw SQL). The answer is read back off the STORED message,
 * not off the request: `metadata.taskId` is what the receiving desktop routes
 * on, so it reports what actually landed rather than what was asked for.
 *
 * FIX L3 — the id alone is NOT proof of a real thread. A first-class thread id
 * is validated against `channel_tasks`, but a legacy `task-<uuid>-<seq>` id is
 * still caller-settable with no participation check (F-083). `taskTitle` is the
 * half that cannot be faked: the server stamps it from the thread row and
 * strips any caller copy. So a THREADED note that names a title is backed by a
 * real row, and one that can only show a bare id is the tell that it is not.
 *
 * Three shapes, in descending urgency:
 *   1. asked for a thread and got none  — the 1.7.14 tag-drop signature;
 *   2. no thread, but the caller has open ones — will read as a NEW request;
 *   3. threaded — name the thread so the sender can check it is the right one.
 * A channel with no open threads and an unthreaded post says nothing at all;
 * one whose only open threads belong to OTHER pairs says so without offering
 * them (Q13).
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
    // FIX M2 — the title is server-STAMPED, not server-AUTHORED: whichever
    // member opened the thread typed it, up to 200 chars with newlines allowed,
    // and this confirmation line is our own narration with no untrusted framing
    // around it. Rendered as one inline code span (same discipline as the read
    // side's legend) so it can only read as the thread's name, never as
    // structure or as instructions from the tool.
    const title = metaString(message, "taskTitle");
    const safeTitle = title ? neutralizeInline(title) : null;
    // Q1-E — the ID needs the span as much as the title does. `landedThread` is
    // `metadata.taskId` read back off the STORED message, and a non-UUID taskId
    // is stored verbatim with no charset rule anywhere on the path
    // (service-writes-metadata.ts:236-245, `metadata` is z.record(z.unknown())).
    // This one is our own post so the bytes are ours, but a hand-built code span
    // is not a container either way, and the read side's legend renders exactly
    // this field from a PEER's message — same field, same treatment, one rule.
    const safeLanded = inlineOr(landedThread, NO_ID);
    const named = safeTitle
      ? `${safeTitle} (thread ${safeLanded})`
      : `thread ${safeLanded}`;
    // `askedThread` stays raw, deliberately: it is the caller's own argument
    // from THIS call, it never round-tripped through storage where a peer could
    // reach it, and quoting it back verbatim is what makes the mismatch legible.
    const mismatch =
      askedThread && askedThread !== landedThread
        ? ` NOTE: you asked for thread \`${askedThread}\` — it resolved to a different one.`
        : "";
    return `THREADED into ${named} — the other side reads this as a continuation of that exchange.${mismatch}`;
  }

  if (askedThread) {
    // The old comment here claimed "the route validates `thread` and 400s an
    // unresolvable one". FALSE for every NON-UUID id: `resolvePostMetadata`
    // runs its lookup + participation gate only inside `if (isUuid(taskId))`
    // (service-writes-metadata.ts:236-245), so a legacy `task-<uuid>-<seq>` id
    // — or a plain typo — is never checked and is stored VERBATIM, which means
    // it comes back as `landedThread` above and never reaches this branch at
    // all. What actually lands here is a tag the server dropped (e.g. a
    // whitespace-only `thread`, which the route treats as absent), so the
    // advice below — re-post with a real id — is right; the reason given for it
    // was not.
    return `NOT THREADED — you passed thread="${askedThread}" but the stored message carries no thread, so this reads as a NEW request on the other side. Re-post with a thread id from dopl_channel(op="list_threads", channel="${channelId}").`;
  }

  // Best-effort: the warning is worth one read, but a listing failure must not
  // turn a SUCCESSFUL post into an error the agent might retry.
  let open;
  try {
    open = (await client.listChannelThreads(channelId)).filter(
      (t) => t.status === "open",
    );
  } catch {
    return null;
  }
  if (open.length === 0) return null;

  // Q13 — RECOMMEND ONLY WHAT THE CALLER CAN ACTUALLY WRITE INTO. `open` is the
  // channel's threads, and thread reads are channel-transparent by design
  // (`listChannelTasks` is unfiltered) while thread WRITES are pair-only:
  // `resolvePostMetadata` 403s any post into a thread whose creator or target
  // the caller is not. So this line used to name other pairs' threads and then
  // instruct "re-post it with thread=<that id>" — an action the tool knew would
  // be refused, at the cost of a burned operator approval and two agent turns
  // per unthreaded post, plus every other pair's thread titles landing in the
  // caller's context as apparent suggestions. Invisible at N=2; constant at N=5.
  //
  // The caller's own id comes free: the message we just posted is theirs, and
  // the route stamps `author_user_id = ctx.userId` — the SAME id the
  // participation gate compares against. No extra round-trip, and no way for it
  // to disagree with the gate. (Whether `list_threads` should still SHOW others'
  // threads read-only is a product decision, P1 — untouched here.)
  const me = message.authorUserId;
  const mine = me
    ? open.filter((t) => t.createdBy === me || t.targetUserId === me)
    : [];
  if (mine.length === 0) {
    // Names a COUNT, never another pair's title — nothing peer-authored is
    // rendered on this branch beyond the channel name, so it needs no header.
    return `NOT THREADED — this reads as a NEW request on the other side, not a continuation. **${safeChannelName}** has ${open.length} open thread${open.length === 1 ? "" : "s"}, but ${open.length === 1 ? "it belongs" : "they belong"} to other members — a thread accepts posts only from its creator or the member it is addressed to, so re-posting into one would be refused. Leave this standalone, or open your own with dopl_channel(op="create_thread", channel="${channelId}", title="...", body="...", to="...").`;
  }
  // M2 again: same peer-typed title, same unframed narration line.
  const shown = mine.slice(0, OPEN_THREAD_WARN_MAX).map((t) => {
    const named = neutralizeInline(t.title);
    return named ? `\`${t.id}\` (${named})` : `\`${t.id}\``;
  });
  const more =
    mine.length > shown.length ? `; +${mine.length - shown.length} more` : "";
  // Q1 (write side) — THIS branch is framed, and the two above are not, because
  // this is the only one that renders peer TEXT. `mine` is "threads I created OR
  // am the target of", and a thread I am merely the target of was opened AND
  // TITLED by the peer. So a post that happens to be unthreaded pulls up to five
  // peer-typed titles into the confirmation of my own write — a surface the
  // agent never chose to read. Header FIRST, above the titles it frames.
  return `${UNTRUSTED_THREAD_HEADER}\n\nNOT THREADED — this reads as a NEW request on the other side, not a continuation, and you have ${mine.length} open thread${mine.length === 1 ? "" : "s"} in **${safeChannelName}** you can post into: ${shown.join("; ")}${more}. If this belongs to one, re-post it with thread="<that id>".`;
}
