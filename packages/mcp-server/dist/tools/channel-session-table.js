"use strict";
/**
 * THE SESSION TABLE — `read_sessions` and the `sessions` block on an `await`,
 * rendered as a grid (T13, 2026-09-02).
 *
 * ⚠ SPLIT OUT OF `channel-session-render.ts` AT THE 500-LINE CAP (§1), along the
 * seam that was already there: that file answers "what STATE is this session in"
 * and owns the vocabulary, the staleness window and the legend; this one answers
 * "how does a PAGE of them render". Every predicate below is imported from
 * there, so there is still exactly one definition of stale, of a model label and
 * of a coarse age.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) and the removed-vocabulary source scan (channel-law.test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_TABLE_HEAD = void 0;
exports.sessionRow = sessionRow;
exports.sessionBlockLines = sessionBlockLines;
const channel_shared_1 = require("./channel-shared");
const channel_session_handle_1 = require("./channel-session-handle");
// ⚠ THE UNITS COME FROM THE LEAF, NOT THROUGH `channel-session-render.ts`. Both
// files need them and the render module already imports them from here; routing
// this one through it would make the leaf reachable two ways and invite a cycle.
const channel_session_units_1 = require("./channel-session-units");
const channel_session_render_1 = require("./channel-session-render");
// ── THE TABLE (T13, 2026-09-02) ─────────────────────────────────────────────
//
// ⚠ WHY A TABLE AT ALL. `read_sessions` is the op an orchestrator calls to
// answer ONE question — "which of my agents is stuck" — across N rows at once.
// The prose line above answers it per row in a sentence, which is the right
// shape for ONE row and the wrong shape for six: the reader has to parse six
// sentences to compare one field. A table puts the comparison in a column.
//
// ⚠ IT IS THE SAME FACTS, NOT FEWER. Every rule the prose line obeys is
// obeyed here, and the two hard ones are worth restating because a grid makes
// them easy to lose:
//   • A STALE ROW STILL MAY NOT ASSERT A PRESENT TENSE. The state cell reads
//     `last reported working`, hedge FIRST — `working (stale)` skims as
//     `working`, which is the reading this file exists to prevent.
//   • `—` IS "NOT REPORTED", NEVER ZERO. A grid begs to be filled, and a `0`
//     in a tokens cell for a desktop that reported no number is a measurement
//     nobody took. Absent renders the dash, and the legend says what it means.
//
// ⚠ POSTURE AND CHAIN ARE NOT COLUMNS HERE, and their absence is a DEPENDENCY
// rather than a decision. T13 lists them; `ChannelSessionState` /
// `ChannelSessionTelemetry` do not carry them, and neither does the projection
// the desktop pushes. They arrive with T24 (launch_agent resolving and
// returning a posture) and T25. A column that is `—` on every row for every
// caller is filler that reads as "no posture", so the columns land when the
// data does — add them here, in `SESSION_TABLE_HEAD` and in {@link sessionRow},
// together.
//
// ⚠ NOTHING NEEDS ESCAPING FOR THE `|` DELIMITER, and it is worth knowing WHY
// rather than adding a second escape: every peer/operator-supplied value in a
// row goes through `inlineOr` → `neutralizeInline`, whose structure class
// already contains `|` and blanks it. Our own literals are a closed state set,
// a closed detail map, and digits. So no cell can forge a column.
/** Header + alignment row for {@link sessionRow}. ⚠ Column order is the row's. */
exports.SESSION_TABLE_HEAD = [
    `| handle | state | thread | channel | template | model | tool | idle |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
];
/** A cell with nothing in it. ⚠ NOT REPORTED — see the legend, and never a zero. */
const NOT_REPORTED = "—";
/**
 * ONE session as a TABLE ROW — the grid form of {@link formatSessionLine},
 * carrying the same facts under the same rules.
 *
 * ⚠ SHARED BY BOTH SURFACES ON PURPOSE. `read_sessions` and the `sessions`
 * block on an `await` render rows from this one function, so the two can never
 * describe the same session differently —
 * `channel-session-liveness.test.ts` holds them byte-for-byte against each
 * other, and that guard is the reason the shared renderer exists.
 */
function sessionRow(s, opts = {}) {
    const now = opts.now ?? Date.now();
    const state = channel_session_render_1.SESSION_STATES.has(s.state) ? s.state : channel_session_render_1.UNKNOWN_STATE;
    const age = (0, channel_session_units_1.ageMs)(s.updatedAt, now);
    const stale = (0, channel_session_render_1.sessionIsStale)(s, now);
    const quiet = (0, channel_session_render_1.rowIsQuietNotGone)(age, stale, opts.operatorOnline);
    // ⚠ Same three branches, same order and same reasoning as the prose head —
    // see {@link formatSessionLine}. The AGE moved out into its own column, so
    // the cell carries the tense and the number is read off `idle`.
    const stateCell = quiet
        ? `${state} (unchanged)`
        : stale
            ? `last reported ${state}`
            : state;
    const phrase = (0, channel_session_render_1.detailPhrase)(s.detail);
    const stateFull = phrase ? `${stateCell} · ${phrase}` : stateCell;
    // ⚠ The HANDLE is the addressable form or nothing — a row whose name is not
    // an agent id prints its name rather than a plausible-looking handle.
    const at = opts.handle ? (0, channel_session_handle_1.addressableHandle)(s.name) : null;
    const handle = at ? `\`${at}\`` : (0, channel_shared_1.inlineOr)(s.name, channel_session_render_1.NO_NAME);
    const thread = s.threadTitle
        ? (0, channel_shared_1.inlineOr)(s.threadTitle, channel_session_render_1.NO_TITLE)
        : s.threadId
            ? (0, channel_shared_1.inlineOr)(s.threadId, channel_session_render_1.NO_TITLE)
            : NOT_REPORTED;
    const channel = s.channelName
        ? (0, channel_shared_1.inlineOr)(s.channelName, channel_session_render_1.NO_NAME)
        : NOT_REPORTED;
    // ⚠ TELEMETRY IS OPERATOR-ONLY and the type is the gate, exactly as in
    // `telemetryClauses`: a peer row has none of these fields, so it dashes.
    const own = opts.telemetry && "model" in s ? s : null;
    const template = own?.templateName
        ? (0, channel_shared_1.inlineOr)(own.templateName, "(unnamed template)")
        : NOT_REPORTED;
    const model = own?.model
        ? (0, channel_shared_1.inlineOr)((0, channel_session_render_1.shortModelLabel)(own.model), "(unnamed model)")
        : NOT_REPORTED;
    const tool = own?.toolLabel
        ? (0, channel_shared_1.inlineOr)(own.toolLabel, "(unnamed tool)")
        : NOT_REPORTED;
    // ⚠ AN UNREADABLE OR ABSENT STAMP DASHES rather than printing `0` — the same
    // fail-safe `ageMs` and `sessionIsStale` already take.
    const idle = age === null ? NOT_REPORTED : (0, channel_session_units_1.coarseAge)(age);
    return `| ${handle} | ${stateFull} | ${thread} | ${channel} | ${template} | ${model} | ${tool} | ${idle} |`;
}
/**
 * THE SESSION BLOCK AN `await` RETURNS WITH ITS RESULT — the caller's own agents
 * as of the moment the hold came back.
 *
 * ⚠ **`undefined` AND `[]` ARE DIFFERENT ANSWERS AND MUST RENDER DIFFERENTLY.**
 * `undefined` = the server did not report (an older deployment, or the read
 * failed) — say nothing at all, because a heading with no rows under it reads as
 * "you have none". `[]` = the server looked and this machine is reporting
 * nothing, which IS worth one line: it is the shape a crashed or signed-out
 * desktop produces, and an orchestrator waiting on an agent needs to see it.
 *
 * ⚠ **IT IS A BLOCK UNDER THE MESSAGES, NEVER INTERLEAVED WITH THEM.** The
 * messages above it are counterparty-authored under their own framing header;
 * splicing server narration between them would let a body's last line be read as
 * the start of this section.
 *
 * ⚠ COMPACT ON PURPOSE. This rides on EVERY returned hold, including every
 * timeout, so it is one line per session and one legend — never the full
 * `read_sessions` preamble.
 */
function sessionBlockLines(sessions, now = Date.now(), 
// ⚠ THIRD, POSITIONAL AND OPTIONAL, so the five call sites that pass only the
// set keep compiling. See {@link SessionRenderOpts.operatorOnline}: absent is
// "not reported", which takes the offline-hedge branch.
operatorOnline) {
    if (sessions === undefined)
        return [];
    if (sessions.length === 0) {
        return [
            ``,
            `### Your agents — none reported`,
            `No sessions of YOURS are being reported in this workspace right now. That is not proof there are none: an asleep, signed-out, crashed or older-build machine reports nothing. If you are waiting on an agent you launched, this is the line that says you cannot see it.`,
        ];
    }
    const anyStale = sessions.some((s) => (0, channel_session_render_1.sessionIsStale)(s, now));
    // ⚠ THE SAME TABLE `read_sessions` RENDERS (T13). Two surfaces describing one
    // session in two shapes is the drift `channel-session-liveness.test.ts`
    // exists to catch, so the header and the rows come from one place.
    const lines = [``, `### Your agents — ${sessions.length}`, ...exports.SESSION_TABLE_HEAD];
    for (const s of sessions) {
        // ⚠ `handle: true` — own-scoped by construction (`ChannelSessionStateOwn`,
        // and the await route reads the caller's own rows). See
        // {@link SessionRenderOpts.handle} for why it is not the telemetry flag.
        lines.push(sessionRow(s, { telemetry: true, handle: true, now, operatorOnline }));
    }
    if (anyStale) {
        // ⚠ Same branch the rows above took, for the reason `sessionLegend` states:
        // a caveat about a form the page does not contain teaches the wrong lesson.
        lines.push(operatorOnline === true
            ? `A state reading **(unchanged)** is ALIVE — your desktop is still heartbeating and this projection only moves when a session's state does, so nothing was reported because nothing CHANGED. Do not read it as a fresh observation, and do not read it as stopped.`
            : `A state reading **last reported <state>** is NOT a live state — nothing has been reported for that session in a while and its desktop may be gone. Treat it as UNKNOWN: do not wait on it as if it were working, and do not report it as stopped.`);
    }
    return lines;
}
/**
 * ⚠ `SESSION_TELEMETRY_NOTE` USED TO LIVE HERE and rendered under EVERY
 * `read_sessions` page (~800 chars, on a call an orchestrator makes in a loop).
 * It was STANDING doctrine about the columns — the same on every page — so it
 * moved to `channel-doctrine.ts`'s READING "read_sessions" section, behind
 * `op="rooms" action="help"` and the `dopl://doctrine/channels` resource. The LEGEND above
 * stayed, because it decodes the cells THIS page actually contains and is
 * conditional on the page containing a hedged row.
 *
 * Its two promises are still promises and are pinned there: a MODEL is always
 * ONE unbroken token (which is what {@link shortModelLabel} exists to
 * guarantee), and an absent field was NOT REPORTED rather than zero.
 */
