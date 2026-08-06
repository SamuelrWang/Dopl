"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.closedThreadNote = closedThreadNote;
exports.threadLinkageNote = threadLinkageNote;
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
// THE one predicate for "is this id a real thread" — shared with the read
// render so the two lanes cannot disagree about what a `task-…` id is (F4).
const channel_render_threads_1 = require("./channel-render-threads");
/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";
/** Open thread ids listed in the not-threaded warning before it truncates. */
const OPEN_THREAD_WARN_MAX = 5;
/**
 * F6 — THE POST LANDED IN A CLOSED THREAD, and until now nothing said so.
 *
 * The write path gated on thread MEMBERSHIP and never on thread STATUS, so a
 * thread closed at #355 accepted five further posts with no refusal and no
 * notice; the closer believed the exchange was over and the poster believed it
 * was still live. The server now reads the row's status on the post path and
 * hands the fact back (`threadClosed` on the post response); this is the
 * sentence that spends it.
 *
 * IT IS A WARNING, NOT A FAILURE, and the wording has to carry that or the agent
 * will retry a post that already landed. The post IS stored, it IS attributed,
 * and it IS inside the thread's card.
 *
 * WHAT A CLOSE ACTUALLY CHANGES IS THE PASSIVE LANE, and the copy is scoped to
 * exactly that. The first cut here said a closed thread "has stopped ROUTING:
 * nobody's session is being woken by it", which is more than any layer enforces:
 * an updated desktop skips the passive thread-lane wake for a closed thread (off
 * a status cache that lags by up to ~5 minutes), an older build still wakes on
 * it, an explicitly ADDRESSED post delivers either way, and the server accepts
 * the post regardless of status. So the sentence tells the agent the useful,
 * true thing — stop expecting an UNPROMPTED reply in there — instead of claiming
 * a silence nothing guarantees.
 *
 * REOPEN IS NAMED AS A HUMAN ACTION, deliberately. There is no `reopen` op on
 * this tool — the route exists (`PATCH /tasks/[id] {op:"reopen"}`) and the web
 * drives it, and the MCP surface deliberately has no counterpart — so telling an
 * agent to "reopen it" full stop would send it hunting for an op that does not
 * exist. Opening a NEW thread is the action it can actually take.
 *
 * F-145 — THE ADDRESSING CLAUSE TAUGHT A PARAM THAT NO LONGER EXISTS. Until now
 * this sentence read `to_agent="<handle>" starts that agent, to="<member>"
 * triggers their machine`, which survived the rollback's §1 deletion of named
 * agents and shipped on EVERY post into a closed thread. It contradicted the
 * tool's own law (`channel-description.ts`: "There is no way to address an agent
 * by name") and it was ACTIONABLE: the MCP SDK parses arguments with a
 * NON-STRICT object, so a `to_agent` an agent learned here was accepted and
 * silently dropped, and the post landed unaddressed while the result narrated
 * success. That is the exact invisible delivery the route's `z.never()` params
 * exist to refuse. The copy now names the one address there is, and the
 * class is closed at the schema (`server.ts` registers every tool with a
 * `z.strictObject`, so an unknown key is a -32602 that names the field).
 */
function closedThreadNote(channelId) {
    return `THAT THREAD IS CLOSED, and the post landed anyway (it is stored, attributed, and on the thread's card). Closing records the OUTCOME and stops the thread's PASSIVE routing: peers' sessions stop being woken by activity in it, so an unaddressed post here can sit unread. It does NOT stop the thread accepting posts, and addressing a PERSON still reaches them: to="<member>" triggers that member's machine, and their side decides what runs. There is no way to address an agent by name. If this was a final word after the close echo, you are done. If it is new work, open a new thread with dopl_channel(op="create_thread", channel="${channelId}", title="...", body="...", to="..."), or ask a human to reopen the closed one (reopening is a web action; this tool has no reopen op).`;
}
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
 * is validated against `channel_tasks`; a legacy `task-<uuid>-<seq>` id names no
 * row at all, and since F-083 it survives the write only when it is the caller's
 * OWN exchange in THIS channel. `taskTitle` is the half that cannot be faked:
 * the server stamps it from the thread row and strips any caller copy. So a
 * THREADED note that names a title is backed by a real row, and one that can
 * only show a bare id is the tell that it is not.
 *
 * Three shapes, in descending urgency:
 *   1. asked for a thread and got none  — the 1.7.14 tag-drop signature;
 *   2. no thread, but the caller has open ones — will read as a NEW request;
 *   3. threaded — name the thread so the sender can check it is the right one.
 * A channel with no open threads and an unthreaded post says nothing at all;
 * one whose only open threads belong to OTHER pairs says so without offering
 * them (Q13).
 */
async function threadLinkageNote(client, channelId, 
/** ALREADY neutralized by the caller — splice it, do not re-wrap it. */
safeChannelName, message, askedThread) {
    const landedThread = (0, channel_shared_1.metaString)(message, "taskId");
    if (landedThread) {
        // FIX M2 — the title is server-STAMPED, not server-AUTHORED: whichever
        // member opened the thread typed it, up to 200 chars with newlines allowed,
        // and this confirmation line is our own narration with no untrusted framing
        // around it. Rendered as one inline code span (same discipline as the read
        // side's legend) so it can only read as the thread's name, never as
        // structure or as instructions from the tool.
        const title = (0, channel_shared_1.metaString)(message, "taskTitle");
        const safeTitle = title ? (0, channel_shared_1.neutralizeInline)(title) : null;
        // Q1-E — the ID needs the span as much as the title does. `landedThread` is
        // `metadata.taskId` read back off the STORED message, and the route's
        // `metadata` is `z.record(z.unknown())` with no charset rule of its own.
        //
        // NOT because the write path stores any non-UUID verbatim, which is what
        // this note used to say: since F-083 the non-uuid branch runs
        // `isLegacyThreadParticipant` and DELETES the tag unless it is exactly
        // `task-<this channel's id>-<digits>` and the caller is a party to the
        // message at that seq (`service-writes-metadata.ts`). So the span is
        // defence in depth for the pre-F-083 rows a channel still carries, and for
        // the rule that a hand-built code span is not a container whatever it is
        // handed — the read side's legend renders exactly this field from a PEER's
        // message, same field, same treatment, one rule.
        const safeLanded = (0, channel_shared_1.inlineOr)(landedThread, NO_ID);
        // `askedThread` stays raw, deliberately: it is the caller's own argument
        // from THIS call, it never round-tripped through storage where a peer could
        // reach it, and quoting it back verbatim is what makes the mismatch legible.
        const mismatch = askedThread && askedThread !== landedThread
            ? ` NOTE: you asked for thread \`${askedThread}\` — it resolved to a different one.`
            : "";
        // F4 — AN AD-HOC ID IS NOT A THREAD, and this line used to call it one. A
        // non-UUID tag names no `channel_tasks` row, so "THREADED into thread
        // <task-…>" told the sender its post had landed in a shared, titled exchange
        // when it had landed in one machine's local grouping label. L3's tell — an
        // id with NO title — was the only signal, and it is ambiguous (a real thread
        // the server could not name looks identical). The label settles it.
        //
        // TWO WAYS TO LAND HERE, AND THEY NEED OPPOSITE ADVICE. The desktop's own
        // prompt (`main/prompt-framing.js` THREAD_TAG) orders a session to keep its
        // `thread` argument on EVERY post, and for a legacy-tagged exchange that
        // argument is exactly this `task-<channel>-<seq>` id. Telling every such
        // post "if this work needs a real thread, open one" reads as "drop the tag",
        // and dropping it forks the exchange: the requester's card keeps grouping on
        // the legacy id while a fresh thread carries a different participant set. So
        // the branch splits on who chose the id. Passed it (`askedThread` came back
        // unchanged, which also means the server's legacy participation check let it
        // through): the grouping is working, keep it. Passed nothing: the receiving
        // machine minted it, and THAT is where opening a real thread is the upgrade.
        if (!(0, channel_render_threads_1.isFirstClassThreadId)(landedThread)) {
            const what = `GROUPED into the ad-hoc exchange ${safeLanded}, which is NOT a thread. That id is the label a receiving machine mints for an untagged request so a reply groups with it on that machine's card; there is no thread row behind it, so it has no title, no status, and nothing to close or join. The post landed and is attributed.`;
            if (askedThread === landedThread) {
                return `${what} You passed that id and it survived, so the grouping worked: KEEP passing thread=${safeLanded} on every post in this exchange. Drop it and your next post arrives as a brand-new request, which forks the exchange.`;
            }
            if (askedThread)
                return `${what}${mismatch}`;
            return `${what} You passed no thread, so the receiving side grouped this for you. If this work needs a real thread, open one with dopl_channel(op="create_thread", channel="${channelId}", title="...", body="...", to="...").`;
        }
        const named = safeTitle
            ? `${safeTitle} (thread ${safeLanded})`
            : `thread ${safeLanded}`;
        // WHO CHOSE THIS THREAD — and until 2026-08-06 this line refused to say.
        //
        // The ad-hoc branch above has always split on it ("You passed no thread, so the
        // receiving side grouped this for you"); the first-class branch never did, so a post
        // that NAMED a thread and a post the server INHERITED one for rendered byte-identical
        // text. `mismatch` is no help: it fires only when `askedThread` is present AND differs,
        // so an omitted argument and a correct one both produce the empty string.
        //
        // THAT AMBIGUITY IS NOT THEORETICAL. On 2026-08-06 two agents spent three turns arguing
        // about which had happened, each quoting this same sentence as evidence for the opposite
        // conclusion, and neither could settle it — the stored row cannot either, because both
        // paths converge on the same `metadata.taskId`. The server is the only party that knows,
        // so it is the one that has to say.
        //
        // THE INHERITANCE RULE IS WORTH STATING, not just the fact: `resolveInheritableTask`
        // attaches the ONE open thread between these two members and returns null when there are
        // several (`candidates.length === 1`). So an agent that opens a second thread will see
        // this stop happening, which reads as a regression unless it knows the rule.
        const inherited = !askedThread
            ? ` You named no thread — the server attached this to your one open exchange with that member. Pass thread=${safeLanded} explicitly to keep it there: once a SECOND thread is open between you, nothing is inherited and an untagged post reads as a new request.`
            : "";
        return `THREADED into ${named} — the other side reads this as a continuation of that exchange.${mismatch}${inherited}`;
    }
    if (askedThread) {
        // WHAT REACHES THIS BRANCH is a tag the SERVER DROPPED, and since F-083
        // that is a real set rather than the empty one an older note here implied.
        // A first-class id that failed lookup or the thread gate 404s/403s before
        // any of this. A non-uuid id is not stored blindly either: the else branch
        // runs `isLegacyThreadParticipant` and deletes anything that is not exactly
        // `task-<this channel's id>-<digits>` opened by, or addressed to, the
        // caller (`service-writes-metadata.ts`) — so a typo, another pair's legacy
        // id, or a legacy id from a DIFFERENT channel all land here silently, as
        // does a whitespace-only `thread` the route treats as absent. One remedy
        // fits all of them: re-post with an id the caller can actually write into.
        return `NOT THREADED — you passed thread="${askedThread}" but the stored message carries no thread, so this reads as a NEW request on the other side. Re-post with a thread id from dopl_channel(op="list_threads", channel="${channelId}").`;
    }
    // Best-effort: the warning is worth one read, but a listing failure must not
    // turn a SUCCESSFUL post into an error the agent might retry.
    let open;
    try {
        open = (await client.listChannelThreads(channelId)).filter((t) => t.status === "open");
    }
    catch {
        return null;
    }
    if (open.length === 0)
        return null;
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
        const named = (0, channel_shared_1.neutralizeInline)(t.title);
        return named ? `\`${t.id}\` (${named})` : `\`${t.id}\``;
    });
    const more = mine.length > shown.length ? `; +${mine.length - shown.length} more` : "";
    // Q1 (write side) — THIS branch is framed, and the two above are not, because
    // this is the only one that renders peer TEXT. `mine` is "threads I created OR
    // am the target of", and a thread I am merely the target of was opened AND
    // TITLED by the peer. So a post that happens to be unthreaded pulls up to five
    // peer-typed titles into the confirmation of my own write — a surface the
    // agent never chose to read. Header FIRST, above the titles it frames.
    return `${channel_render_1.UNTRUSTED_THREAD_HEADER}\n\nNOT THREADED — this reads as a NEW request on the other side, not a continuation, and you have ${mine.length} open thread${mine.length === 1 ? "" : "s"} in **${safeChannelName}** you can post into: ${shown.join("; ")}${more}. If this belongs to one, re-post it with thread="<that id>".`;
}
