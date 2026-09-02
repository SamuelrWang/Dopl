"use strict";
/**
 * `dopl_channel` — THE TWO ACCOUNT-WIDE READS: `op="read"` with no `channel`
 * (T21) and `op="read_sessions"` with no `channel` (T22).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── WHAT "ACCOUNT-WIDE" MEANS HERE, AND HOW IT DIFFERS FROM `await` ────────
 *
 * ⚠ **THREE SCOPES EXIST ON THIS TOOL AND THEY ARE NOT THE SAME. Do not
 * "unify" them:**
 *   - `op="read"`  with a `channel`  → ONE room.
 *   - `op="await"` with no `channel` → ONE WORKSPACE (the one this call
 *     resolved). The hold re-proves a membership set per tick and that proof is
 *     workspace-scoped; widening it is a different change with a different
 *     fence.
 *   - `op="read"`  with no `channel` → THE WHOLE ACCOUNT, every workspace and
 *     every home-channel container. It can afford to, because a PAGE has no
 *     per-tick access invariant to preserve — it reads once, against a
 *     membership set proved once.
 *
 * ⚠ **THE SESSION READ MOVED WITH IT.** `op="read_sessions"` with no `channel`
 * used to mean "every session of mine in the ACTIVE WORKSPACE" and now means
 * "every session of mine, anywhere". That is a widening of a read that was
 * already own-scoped (`user_id` is the fence, server-side), and it is what makes
 * the op usable at all from a home channel — a container is never the active
 * workspace unless it was explicitly addressed. Every row still names its room.
 *
 * 🔒 **BOTH GO THROUGH `account-scope.ts`, WHICH APPLIES THE CONTAINER LOCK.**
 * The routes behind them are `withUserAuth` and answer for the whole account;
 * calling `client.getAccountStatus()` / `client.readAccountMessages()` from here
 * would hand a locked session its operator's other rooms.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opReadAccount = opReadAccount;
exports.opReadSessionsAccount = opReadSessionsAccount;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const account_scope_1 = require("./account-scope");
const channel_render_1 = require("./channel-render");
const channel_session_render_1 = require("./channel-session-render");
const channel_session_handle_1 = require("./channel-session-handle");
/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed channel)";
/**
 * THE SCOPE SENTENCE, stated on every account-wide result.
 *
 * ⚠ **NEVER OMITTED ON A FULL PAGE.** An agent that sees traffic will otherwise
 * assume it is seeing ALL traffic — and here the mistake is bigger than on a
 * workspace page, because "everything" now plausibly means the whole product.
 * A PUBLIC channel nobody invited the caller into is NOT included: the fence is
 * MEMBERSHIP, the same narrowing the workspace-wide hold makes and for the same
 * reason.
 */
function accountScopeNote(channelCount) {
    if (channelCount === 0) {
        return `⚠ THIS READ COVERED NOTHING: you are not a member of any channel in any workspace and you have no home channels, so no cursor can ever advance. Open a room with dopl_channel(op="open", …) or dopl_home(op="create_channel", name="…") first.`;
    }
    return `Scope: every channel you are a MEMBER of, in every workspace AND every home channel (${channelCount}). ⚠ A PUBLIC channel you never joined is NOT included, so silence here is evidence YOUR rooms are quiet and not that the product is.`;
}
/**
 * `op="read"` WITH NO `channel` — new messages past one cursor, everywhere.
 *
 * ⚠ **ONE CURSOR IS LEGAL BECAUSE `seq` IS A TABLE-WIDE IDENTITY** — see
 * `src/features/channels/server/repository-account.ts ›
 * listAccountMessagesAfter`. That is a stronger fact than the workspace-wide
 * await's copy states, and it is the whole reason this op can exist.
 */
async function opReadAccount(client, directory, since, limit, selfUserId = null) {
    const page = await (0, account_scope_1.accountMessages)(client, directory, { since, limit });
    if (page.messages.length === 0) {
        return (0, respond_1.ok)([
            `No new messages anywhere since seq ${since}.`,
            accountScopeNote(page.channelCount),
            `Check again with dopl_channel(op="read", since=${since}) — or, to be WOKEN rather than to poll, hold with dopl_channel(op="await", since=${since}), which watches one workspace at a time.`,
        ].join("\n"));
    }
    const groups = (0, channel_render_1.groupByChannel)(page.messages);
    const lines = [
        `## Everywhere — ${page.messages.length} new message${page.messages.length === 1 ? "" : "s"} since seq ${since}, across ${groups.length} channel${groups.length === 1 ? "" : "s"}\n`,
        // ⚠ Framing FIRST — counterparty-written bodies below, so the caveat must be
        // read BEFORE them and not as a footnote underneath.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    for (const g of groups) {
        // ⚠ The heading names the room AND gives the ref the per-message remedies
        // below assume, plus the `workspace=` handle — without which a home
        // channel's rows name a room the reader cannot address.
        const workspaceId = g.messages[0].workspaceId;
        lines.push(`\n### ${g.label} — \`${g.ref}\` · workspace=\`${workspaceId}\``);
        lines.push(...(0, channel_render_1.formatMessages)(g.messages, g.ref, selfUserId));
    }
    // ⚠ THE CURSOR IS THE MAX OVER THE WHOLE PAGE, not the last line of the last
    // group. Grouping reordered the page relative to seq, so "the last message
    // shown" is no longer the highest seq — taking it would advance the cursor
    // past messages in another group and lose them permanently.
    const lastSeq = page.messages.reduce((max, m) => (m.seq > max ? m.seq : max), page.messages[0].seq);
    lines.push(``, accountScopeNote(page.channelCount));
    if (page.truncated) {
        // ⚠ A CLIP IS NOT AN ABSENCE (INVARIANTS §9), and the remedy here is real:
        // the cursor DID advance, so re-reading from it returns the next page.
        lines.push(`⚠ CLIPPED — this page hit its ceiling, so there is more past seq ${lastSeq}. Read again from it before you conclude you are caught up.`);
    }
    lines.push(`Highest seq shown: ${lastSeq}. Continue with dopl_channel(op="read", since=${lastSeq}) — and read the "· to ..." and "· thread ..." tags first: an account-wide page is the least targeted read there is, so most of it is context rather than a request.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * `op="read_sessions"` WITH NO `channel` — every session of the caller's,
 * grouped by the room it is working in.
 *
 * ⚠ **IT REUSES THE PROJECTION RENDERER VERBATIM** (`formatSessionLine`,
 * `sessionLegend`, and both notes). A second session line would be a second
 * opinion about what "stale" means and about which fields a peer may read — see
 * `channel-session-render.ts`'s header.
 */
async function opReadSessionsAccount(client, directory) {
    const status = await (0, account_scope_1.accountStatus)(client, directory, { view: "sessions" });
    const rooms = status.channels.filter((c) => c.sessions.length > 0);
    const total = rooms.reduce((n, c) => n + c.sessions.length, 0);
    if (total === 0) {
        return (0, respond_1.ok)(`No live sessions of yours are being reported in ANY of your channels right now — ${status.channels.length} room${status.channels.length === 1 ? "" : "s"} were checked, in every workspace and every home channel. This lists the agent sessions running on YOUR OWN machine, never another member's. If you expected one, it may simply not be running, or your desktop has not reported its state yet.`);
    }
    // ⚠ ONE `now` FOR THE WHOLE PAGE. Per-line `Date.now()` lets two rows pushed
    // in the same instant land on either side of the staleness window and render
    // in different tenses, which reads as a fact about them.
    const now = Date.now();
    const anyStale = rooms.some((room) => room.sessions.some((s) => (0, channel_session_render_1.sessionIsStale)(s, now)));
    const lines = [
        `## Your sessions — ${total} across ${rooms.length} channel${rooms.length === 1 ? "" : "s"}\n`,
        // ⚠ Framing FIRST — channel names below are counterparty-influenced.
        `${channel_render_1.UNTRUSTED_LISTING_HEADER}\n`,
    ];
    for (const room of sortedByName(rooms)) {
        lines.push(`\n### ${(0, channel_shared_1.inlineOr)(room.channelName, NO_NAME)} — \`${room.channelSlug}\` · workspace=\`${room.workspaceId}\``);
        for (const s of room.sessions) {
            // ⚠ `handle: true` + `telemetry: true` — this read is own-scoped by
            // construction (the server fences on `user_id`), which is the AUDIENCE
            // question `SessionRenderOpts.handle` asks.
            lines.push((0, channel_session_render_1.formatSessionLine)(s, {
                telemetry: true,
                handle: true,
                now,
                operatorOnline: status.operatorOnline,
            }));
        }
    }
    lines.push(`\n${(0, channel_session_render_1.sessionLegend)(anyStale, status.operatorOnline)} Each heading carries the \`workspace=\` handle for that room, which is what every other tool takes to reach it.`, `\n${channel_session_handle_1.SESSION_HANDLE_NOTE}`, `\n${channel_session_render_1.SESSION_TELEMETRY_NOTE}`);
    return (0, respond_1.ok)(lines.join("\n"));
}
/** ⚠ Sorted by NAME, not by session count: a stable order is what lets an
 *  orchestrator diff two check-ins by eye. */
function sortedByName(rooms) {
    return [...rooms].sort((a, b) => a.channelName.localeCompare(b.channelName));
}
