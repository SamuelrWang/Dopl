"use strict";
/**
 * THE `dopl_status` TABLE — one terse block for an orchestrator's check-in.
 *
 * ⚠ **THE BUDGET IS THE FEATURE.** This replaces ~10 tool calls, and it is worth
 * having only if the answer fits in a glance: **ONE line per channel**, one per
 * live session, one per item waiting on the caller. Ten quiet channels are ~14
 * lines including the header and the legend. A paragraph added here is a
 * paragraph on every check-in of every run — the verbosity this whole wave
 * exists to delete. `status-render.test.ts` pins the budget.
 *
 * ⚠ **NULL IS UNKNOWN, NEVER ZERO** — the same rule
 * `channel-session-render.ts`'s header states, applied to a count. `unread:
 * null` means NO CURSOR WAS GIVEN, and it renders as "no cursor", never as "0
 * new". A number nobody asked for is a measurement nobody took.
 *
 * ⚠ **EVERY MEMBER-TYPED STRING GOES THROUGH THE ONE NEUTRALIZER.** Channel
 * names, author names and message previews are all VALUES spliced into lines WE
 * wrote (INVARIANTS §10), and the preview is a fragment of somebody's message
 * body. The framing header is emitted FIRST, above the content it frames.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusLines = statusLines;
const narration_js_1 = require("./narration.js");
const channel_render_js_1 = require("./channel-render.js");
const channel_session_render_js_1 = require("./channel-session-render.js");
const channel_session_handle_js_1 = require("./channel-session-handle.js");
/** Peer-influenced display text that neutralized to nothing. */
const NO_NAME = "(unnamed)";
const NO_ONE = "(unresolved author)";
const NO_TEXT = "(empty)";
/**
 * ⚠ THE LEGEND IS TWO LINES AND MUST STAY TWO. It answers the only two questions
 * a reader of this table has that the rows cannot answer for themselves: what to
 * do with the two ids, and what a cursor is for. Everything else an agent needs
 * about a session line is in {@link SESSION_HANDLE_NOTE}, printed once.
 */
const STATUS_LEGEND = [
    "`workspace=` is the handle every other tool takes for that room — a standard workspace OR a home-channel container, and a container is reachable NO OTHER WAY. `channel=` is what dopl_channel takes.",
    '"new" counts messages past the `since` you passed, EXCLUDING your own. Read them with dopl_channel(op="read", since=<your cursor>) — with no `channel`, that reads across every room below at once.',
];
/** One channel's own line: what it is, where it is, and whether it moved. */
function channelLine(channel) {
    const name = (0, narration_js_1.inlineOr)(channel.channelName, NO_NAME);
    const moved = channel.unread === null
        ? "no cursor"
        : `${channel.unread} new`;
    const head = channel.lastSeq === null ? "empty" : `seq ${channel.lastSeq}`;
    return `- **${name}** — ${moved} · ${head} · workspace=\`${channel.workspaceId}\` · channel=\`${channel.channelSlug}\``;
}
/**
 * One item addressed to the caller and unanswered.
 *
 * ⚠ **"UNANSWERED" MEANS "YOU HAVE POSTED NOTHING LATER IN THAT ROOM", and the
 * line says so** — there is no reply edge on a message, so this is the only
 * evidence the server has. It over-reports rather than under-reports (the
 * service's own docblock argues the direction), and a reader told it is exact
 * would treat a stale card as a live request.
 */
function waitingLine(item) {
    const who = (0, narration_js_1.inlineOr)(item.authorName ?? item.authorUserId ?? "", NO_ONE);
    const mark = item.isEscalation ? "ESCALATION" : "to you";
    const thread = item.threadId
        ? ` · thread \`${(0, narration_js_1.inlineOr)(item.threadId, NO_TEXT)}\``
        : "";
    return `  ⚠ ${mark} #${item.seq} from ${who}${thread} — ${(0, narration_js_1.inlineOr)(item.preview, NO_TEXT)}`;
}
/** What a clipped read could not see, as one line — or nothing. */
function clipLine(status) {
    const clips = status.truncated;
    const parts = [];
    if (clips.channels)
        parts.push("the channel list");
    if (clips.unread)
        parts.push("the unread counts (they are a FLOOR, not a total)");
    if (clips.waiting)
        parts.push("the waiting list");
    if (parts.length === 0)
        return null;
    return `⚠ CLIPPED — ${parts.join(", ")} hit a ceiling, so this page is not the whole picture. Narrow with a per-channel read rather than treating an absence here as a fact.`;
}
/**
 * THE WHOLE ANSWER, as lines.
 *
 * ⚠ `now` is taken ONCE for the page. Calling `Date.now()` per session line lets
 * two rows pushed in the same instant land on either side of the staleness
 * window and render in different tenses, which reads as a fact about them —
 * `channel-ops-read.ts › opReadSessions` states the same rule.
 */
function statusLines(status, now = Date.now()) {
    const channels = status.channels;
    if (channels.length === 0) {
        return [
            "No channels. You are not a member of any channel in any workspace, and you have no home channels — so there is nothing to check in on and no cursor to advance.",
            'Open a room with dopl_channel(op="open", …), or a home channel with dopl_home(op="create_channel", name="…").',
        ];
    }
    const sessionCount = channels.reduce((n, c) => n + c.sessions.length, 0);
    const waitingCount = channels.reduce((n, c) => n + c.waiting.length, 0);
    const cursor = status.since === null ? "no cursor given" : `since seq ${status.since}`;
    const lines = [
        `## Status — ${channels.length} channel${channels.length === 1 ? "" : "s"} · ${sessionCount} live session${sessionCount === 1 ? "" : "s"} · ${waitingCount} waiting on you · ${cursor}`,
        "",
        // ⚠ Framing FIRST — the names and previews below are member-typed, and a
        // caveat under them is read after the injected line it warns about.
        channel_render_js_1.UNTRUSTED_LISTING_HEADER,
        "",
        ...STATUS_LEGEND,
        "",
    ];
    for (const channel of channels) {
        lines.push(channelLine(channel));
        for (const session of channel.sessions) {
            // ⚠ THE PROJECTION RENDERER, REUSED VERBATIM. A second session line would
            // be a second opinion about what "stale" means and about which fields a
            // peer may read — see `channel-session-render.ts`. `handle: true` is an
            // AUDIENCE decision and is safe here because the server read is
            // own-scoped; `telemetry: true` for the same reason.
            lines.push(`  ${(0, channel_session_render_js_1.formatSessionLine)(session, {
                telemetry: true,
                handle: true,
                now,
                operatorOnline: status.operatorOnline,
            }).replace(/^- /, "")}`);
        }
        for (const item of channel.waiting)
            lines.push(waitingLine(item));
    }
    const clip = clipLine(status);
    if (clip)
        lines.push("", clip);
    if (sessionCount > 0)
        lines.push("", channel_session_handle_js_1.SESSION_HANDLE_NOTE);
    return lines;
}
