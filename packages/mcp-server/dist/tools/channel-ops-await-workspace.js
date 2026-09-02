"use strict";
/**
 * `dopl_channel` op="await" WITH NO `channel` — the WORKSPACE-WIDE hold.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ **A SIBLING OF `channel-ops-await.ts`, NOT A BRANCH INSIDE IT.** The two
 * share every CLOCK (`channel-await-budget.ts`) and every rule about what a hold
 * may CLAIM (`channel-wake-guidance.ts`), and they deliberately do not share a
 * function: the per-channel op's whole result vocabulary is written around ONE
 * named channel — its re-arm call, its not-found, its stop rule all splice
 * `ref` — and threading an `undefined` ref through that would produce sentences
 * with a hole in them at exactly the moment an agent is deciding what to do next.
 *
 * ⚠ **ONE CURSOR IS LEGAL HERE BECAUSE `seq` IS WORKSPACE-GLOBAL AND GAPPY** —
 * the same property that makes a per-channel seq RANGE meaningless as a message
 * count. Ordering by it interleaves channels in true arrival order, so advancing
 * to the highest seq on a page means everything below it has been seen in EVERY
 * channel on the page.
 *
 * ⚠ **IT WATCHES CHANNELS THE CALLER IS A MEMBER OF, AND SAYS SO.** A PUBLIC
 * channel they never joined is NOT watched — narrower than `op="read"`, on
 * purpose (the argument is in
 * `src/features/channels/server/repository-await-workspace.ts ›
 * listMemberChannelRefs`). The result states the scope rather than leaving an
 * agent to infer it from an absence, because "no messages" and "that room was
 * never being watched" are different facts and only one of them is a reason to
 * keep waiting.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceRearmStopRule = workspaceRearmStopRule;
exports.opAwaitWorkspace = opAwaitWorkspace;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
// ⚠ `groupByChannel` MOVED to `channel-render.ts` on 2026-09-01, when the
// ACCOUNT-wide read needed the same grouping. It was private here; a second copy
// would be a second opinion about which channel ref a per-message remedy points
// at. See that function's docblock.
const channel_render_1 = require("./channel-render");
const channel_framing_1 = require("./channel-framing");
const channel_await_budget_1 = require("./channel-await-budget");
// ⚠ The re-arm text branches on the caller's runtime here too, for the same
// reason it does per-channel: an unstamped caller may not be promised a wake.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
const channel_session_table_1 = require("./channel-session-table");
/**
 * A thrown inner-poll failure reduced to one short NEUTRALIZED line.
 * ⚠ Same reasoning as `channel-ops-await.ts › describeFailure`: no framing
 * covers this line, and "our own server's error" says nothing about its CONTENT.
 */
function describeFailure(e) {
    let raw;
    if (e instanceof Error)
        raw = e.message;
    else if (typeof e === "string")
        raw = e;
    else {
        try {
            raw = JSON.stringify(e) ?? String(e);
        }
        catch {
            raw = String(e);
        }
    }
    return (0, channel_shared_1.neutralizeInline)(raw) ?? "`no detail reported`";
}
/**
 * The re-arm stop rule for a WORKSPACE hold.
 *
 * ⚠ **IT IS DELIBERATELY DIFFERENT FROM THE PER-CHANNEL ONE, AND THE DIFFERENCE
 * IS THE WHOLE POINT.** `channel-ops-await.ts › rearmStopRule` says to judge
 * liveness ONLY on the member you addressed, because in a busy channel other
 * members' traffic is not evidence your exchange is alive. A workspace hold
 * makes that trap strictly worse — EVERY channel's traffic now wakes you — so
 * the rule has to be restated here rather than reused, and it has to name the
 * new failure: an orchestrator re-arming forever because the workspace is busy
 * while the one agent it is waiting on died an hour ago.
 * ⚠ It also states the ABSENCE of a finished state, for the same reason every
 * other stop rule does (INVARIANTS §10): an agent trained on a surface that had
 * one waits for it forever.
 */
function workspaceRearmStopRule() {
    return `A WORKSPACE hold wakes on ANY message in ANY channel you belong to, so a wake is not by itself news about the thing you are waiting on. Before re-arming, ask which exchange you are actually blocked on and check THAT one — dopl_channel(op="read", channel=<that channel>, since=<your cursor>) — rather than treating workspace activity as a sign of life. Keep re-arming while something has come from the member or agent you are waiting on in roughly the last 30 minutes; STOP and report to your operator when nothing has for ~30+ minutes. There is no finished STATE to wait for — a thread never closes — so that silence is the only stop signal there is. ⚠ In a busy workspace this hold will almost never time out, which means the timeout can no longer be your "nothing is happening" signal; you have to look.`;
}
/** The scope sentence, stated on every result. ⚠ Never omitted on a full page:
 *  an agent that sees traffic will otherwise assume it is seeing ALL traffic. */
function scopeNote(channelCount) {
    if (channelCount === 0) {
        return `⚠ THIS HOLD WATCHED NOTHING: you are not a member of any channel in this workspace, so no message can ever end it. Do not re-arm — join or open a channel first (dopl_channel(op="list") to see what exists, op="open" to create one).`;
    }
    return `Scope: every channel you are a MEMBER of (${channelCount}). ⚠ A PUBLIC channel you have not joined is NOT watched by this hold, so silence here is not evidence the workspace is quiet — it is evidence YOUR rooms are. Join a channel to watch it, or hold on it by name with dopl_channel(op="await", channel=<slug>, since=…).`;
}
/**
 * LONG-HOLD workspace await. One call holds for `awaitHoldMs(timeoutMs,
 * runtime)` by re-issuing the ~50s inner long-poll on the same `since` cursor.
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out, FAILED-MID-HOLD, CUT SHORT — the same four the per-channel op has,
 * for the same reasons.
 * ⚠ NO not-found branch, because there is no ref to resolve: a caller with no
 * memberships gets a page with `channelCount: 0` and a result that says so.
 */
async function opAwaitWorkspace(client, since, timeoutMs, selfUserId = null, runtime = null, selfSessionId = null) {
    // ⚠ Same two rules as the per-channel lane: explicit ask honoured exactly,
    // default sized to the caller's runtime (`channel-await-budget.ts ›
    // awaitHoldMs`). ⚠ `runtime` REACHES THIS OP AT ALL ONLY SINCE T03 — it was
    // never threaded from `channel.ts`, so the workspace hold both ran the
    // desktop-length default for external callers AND wrote external-flavoured
    // re-arm guidance to desktop sessions.
    const holdMs = (0, channel_await_budget_1.awaitHoldMs)(timeoutMs, runtime);
    const startedAt = Date.now();
    const deadline = startedAt + holdMs;
    let messages = [];
    let channelCount = 0;
    let sessions;
    // ⚠ MOVES WITH `sessions` AND ONLY WITH IT (2026-08-23, F-294) — the caller's
    // own `agent_presence` freshness, which is what lets a quiet row render as
    // "quiet Xm" rather than as an accusation that the desktop died. The route
    // emits both keys or neither; pairing a fresh row set with a liveness answer
    // carried over from an earlier poll is the one way to make it lie.
    let operatorOnline;
    let pollError = null;
    // ⚠ Advances ONLY past this session's own rows — see the per-channel op.
    let cursor = since;
    for (let poll = 0; poll < channel_await_budget_1.AWAIT_MAX_POLLS; poll++) {
        const remaining = deadline - Date.now();
        if (poll > 0 && remaining < channel_await_budget_1.AWAIT_MIN_POLL_MS)
            break;
        let result;
        try {
            result = await client.awaitWorkspaceMessages({
                since: cursor,
                // ⚠ Floored at 1ms, not 0 — the route's query schema requires a POSITIVE
                // timeout, so a `timeout_ms=0` caller would 400 instead of getting its check.
                timeoutMs: Math.max(1, Math.min(channel_await_budget_1.AWAIT_POLL_MS, remaining)),
                // 🔒 NO `excludeAuthor`, EVER — session-scoped suppression only (F-405).
                // The argument is in `channel-ops-await.ts` in full. An orchestrator
                // posting into many rooms must not pop its own hold on its own echoes;
                // that is real, and it is why the suppression stays. What it may NOT do
                // is decide by ACCOUNT, which across a whole workspace hides most of
                // what an orchestrator is waiting for — and hides ALL of it from an
                // unstamped external client, the population that reported the outage.
            });
        }
        catch (e) {
            // ⚠ Poll 0 still throws — nothing is established yet, so the error IS the
            // honest answer. Later, a transient failure must not destroy the hold.
            if (poll === 0)
                throw e;
            pollError = e;
            break;
        }
        channelCount = result.channelCount;
        if (result.sessions !== undefined) {
            sessions = result.sessions;
            operatorOnline = result.operatorOnline;
        }
        if (result.messages.length > 0) {
            // ⚠ Our own lines dropped from the page in hand — see the per-channel op
            // for why this is not a SQL predicate, and why an unstamped caller now
            // drops nothing at all rather than falling back to the account.
            const fresh = selfSessionId === null
                ? result.messages
                : result.messages.filter((m) => (0, channel_render_1.sessionIdOf)(m) !== selfSessionId);
            if (fresh.length > 0) {
                messages = fresh;
                break;
            }
            // ⚠ Own echoes only: advance past them rather than re-fetching them every
            // tick, which would spin the budget away and trip the CUT SHORT branch.
            // Skips nothing anyone else wrote — every foreign row returns above first.
            cursor = result.messages[result.messages.length - 1].seq;
            continue;
        }
    }
    if (messages.length === 0) {
        const elapsedMs = Date.now() - startedAt;
        const timedOut = `No new messages in ANY channel you belong to since seq ${cursor} — the wait timed out after about ${Math.round(elapsedMs / 1000)}s with nothing arriving.`;
        // ⚠ Say what BROKE before diagnosing a platform clamp, or a transient blip is
        // misread as "the wait is not holding" and a live exchange is abandoned.
        if (pollError !== null) {
            return (0, respond_1.ok)([
                `The workspace wait ended early, after about ${Math.round(elapsedMs / 1000)}s: an inner poll failed — ${describeFailure(pollError)}.`,
                `Nothing was missed, so re-arm NOW, before you end your turn — dopl_channel(op="await", since=${cursor}).`,
                `If the very next hold fails the same way, stop re-arming and report it to your operator.`,
                workspaceRearmStopRule(),
                ...(0, channel_session_table_1.sessionBlockLines)(sessions, undefined, operatorOnline),
            ].join("\n"));
        }
        if (elapsedMs < Math.min(channel_await_budget_1.AWAIT_SHORT_HOLD_MS, holdMs / 2)) {
            return (0, respond_1.ok)([
                timedOut,
                `That hold was CUT SHORT — it asked for about ${Math.round(holdMs / 1000)}s and returned in ${Math.round(elapsedMs / 1000)}s, which usually means the platform is clamping the call (or the server is erroring instantly). A hold this short can never stay pending long enough to wake you.`,
                `Do NOT immediately re-arm — you would loop on short calls that never wake anything. Report this to your operator and check channels with dopl_channel(op="read") instead.`,
            ].join("\n"));
        }
        // ⚠ The TIMEOUT is the compressed result (T03) — see
        // `channel-wake-guidance.ts › workspaceAwaitTimedOutLines`. `scopeNote`
        // STAYS: it is a fact about what was watched, not doctrine, and "no
        // messages" versus "that room was never being watched" are different
        // answers. The full `workspaceRearmStopRule` is still taught where it is
        // new information — on the holds that RETURN and that FAIL.
        return (0, respond_1.ok)([
            timedOut,
            scopeNote(channelCount),
            ...(0, channel_wake_guidance_1.workspaceAwaitTimedOutLines)(cursor, runtime),
            ...(0, channel_session_table_1.sessionBlockLines)(sessions, undefined, operatorOnline),
        ].join("\n"));
    }
    const groups = (0, channel_render_1.groupByChannel)(messages);
    // ⚠ Banner moved to CHANNEL_DESCRIPTION's SECURITY paragraph (T11).
    const lines = [
        `## Workspace — ${messages.length} new message${messages.length === 1 ? "" : "s"} since seq ${cursor}, across ${groups.length} channel${groups.length === 1 ? "" : "s"}\n`,
        // ⚠ Framing FIRST — counterparty-written bodies, so the caveat must be read
        // BEFORE them, not as a footnote underneath. ⚠ IT IS NOT DUPLICATED BY THE
        // TOOL DESCRIPTION, and removing it on that belief is exactly how it was
        // lost once (2026-09-02): a description is read at connect time, a body is
        // read now, and only the second one can carry an injected line.
        `${channel_framing_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    for (const g of groups) {
        // ⚠ The channel heading names the room AND gives the `ref` to use in a
        // follow-up call, because the message lines below carry per-message remedies
        // that assume it.
        lines.push(`\n### ${g.label} — \`${g.ref}\``);
        lines.push(...(0, channel_render_1.formatMessages)(g.messages, g.ref, selfUserId));
    }
    // ⚠ THE CURSOR IS THE MAX OVER THE WHOLE PAGE, not the last line of the last
    // group. Grouping reordered the page relative to seq, so "the last message
    // shown" is no longer the highest seq — taking it would advance the cursor
    // past messages in another group and lose them permanently, because a cursor
    // only moves forward.
    const lastSeq = messages.reduce((max, m) => (m.seq > max ? m.seq : max), messages[0].seq);
    lines.push(``, scopeNote(channelCount));
    lines.push(`Highest seq shown: ${lastSeq}. Re-arm with dopl_channel(op="await", since=${lastSeq}) — and read the "· to ..." and "· thread ..." tags on each line first: a workspace hold is even less targeted than a channel one, so most of what wakes you is context, not a request.`);
    lines.push(workspaceRearmStopRule());
    lines.push(...(0, channel_session_table_1.sessionBlockLines)(sessions, undefined, operatorOnline));
    return (0, respond_1.ok)(lines.join("\n"));
}
