"use strict";
/**
 * Session vocabulary and the one-line session form, shared by `op="status"`, `channel-session-table.ts`
 * and `status-render.ts`. A row is a report the desktop pushes on change, not an observation: past the
 * stale window it is hedged, and `null` telemetry is unknown, never zero.
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_STALE_WINDOW_MS = exports.UNKNOWN_STATE = exports.SESSION_STATES = exports.NO_TITLE = void 0;
exports.detailPhrase = detailPhrase;
exports.sessionIsStale = sessionIsStale;
exports.shortModelLabel = shortModelLabel;
exports.rowIsQuietNotGone = rowIsQuietNotGone;
exports.formatSessionLine = formatSessionLine;
exports.sessionLegend = sessionLegend;
const channel_shared_1 = require("./channel-shared");
const narration_1 = require("./narration");
const channel_session_handle_1 = require("./channel-session-handle");
const channel_session_health_1 = require("./channel-session-health");
const channel_session_units_1 = require("./channel-session-units");
// Helpers are exported for `channel-session-table.ts`, so the session vocabulary has one definition.
/** Peer-influenced display text, neutralized — never an empty span. */
exports.NO_TITLE = "(untitled)";
/** `state` is spliced into server narration, so it must pass membership (a newline could forge a block). */
exports.SESSION_STATES = new Set([
    "working",
    "idle",
    "ended",
]);
exports.UNKNOWN_STATE = "(unrecognized state)";
/**
 * Past this, a row stops asserting a live state. Deliberate duplicate of
 * `src/features/channels/constants.ts › PRESENCE_ONLINE_WINDOW_MS`, pinned by `channel-session-staleness.test.ts`.
 */
exports.SESSION_STALE_WINDOW_MS = 120_000;
/** Situation key → phrase for a model (the web's `agents-model.ts › agentDetailLabel` wording differs on purpose). */
const DETAIL_PHRASES = {
    thinking: "thinking",
    tool: "running a tool",
    posting: "sending a message",
    permission: "BLOCKED on its operator's approval",
    awaiting_peer: "waiting for a peer's reply",
    awaiting_inbound: "holding an inbound reply",
};
function detailPhrase(detail) {
    if (!detail)
        return null;
    return DETAIL_PHRASES[detail] ?? null;
}
/** An absent or unparseable `updatedAt` reads as stale. */
function sessionIsStale(session, now = Date.now(), windowMs = exports.SESSION_STALE_WINDOW_MS) {
    const age = (0, channel_session_units_1.ageMs)(session.updatedAt, now);
    if (age === null)
        return true;
    return age >= windowMs;
}
/** Must mirror `narration.ts › neutralizeInline`'s blanked class (held by `channel-session-liveness.test.ts`). */
const MODEL_LABEL_BREAKERS = /[`*_#>[\]{}|\s]+/g;
const MODEL_LABEL_EDGE = /^[`*_#>[\]{}|\s]+|[`*_#>[\]{}|\s]+$/g;
/**
 * A model id for a glance: only a trailing `-YYYYMMDD` stamp is dropped (no vendor-prefix strip), and
 * characters `neutralizeInline` would blank are joined with `-` so one id never renders as two names (F-293).
 */
function shortModelLabel(model) {
    const stripped = model.replace(/-\d{8}$/, "").trim();
    const base = stripped.length > 0 ? stripped : model;
    // Edges first, so `opus-5[1m]` becomes `opus-5-1m` and not `opus-5-1m-`; never blanks a name.
    const single = base
        .replace(MODEL_LABEL_EDGE, "")
        .replace(MODEL_LABEL_BREAKERS, "-");
    return single.length > 0 ? single : base;
}
/** `62% of 200000`; `null` when usage is unknown, and never divides by an absent or zero window. */
function contextClause(s) {
    const used = s.contextUsed;
    const window = s.contextWindow;
    if (used === null || used === undefined)
        return null;
    if (window === null || window === undefined || window <= 0) {
        return `context ${used} tokens (window not reported)`;
    }
    return `context ${Math.round((used / window) * 100)}% of ${window}`;
}
/** Operator-only clauses, each conditional; the `ChannelSessionStateOwn` type is the audience gate. */
function telemetryClauses(s, now) {
    const out = [];
    if (s.identityName) {
        out.push((0, channel_shared_1.inlineOr)(s.identityName, "(unnamed identity)"));
    }
    if (s.model)
        out.push((0, channel_shared_1.inlineOr)(shortModelLabel(s.model), "(unnamed model)"));
    const ctx = contextClause(s);
    if (ctx)
        out.push(ctx);
    if (s.tokensSpent !== null && s.tokensSpent !== undefined) {
        out.push(`${(0, channel_session_units_1.compactCount)(s.tokensSpent)} tokens`);
    }
    out.push(...(0, channel_session_health_1.sessionProgressClauses)(s));
    if (s.toolLabel)
        out.push(`tool ${(0, channel_shared_1.inlineOr)(s.toolLabel, "(unnamed tool)")}`);
    const started = (0, channel_session_units_1.ageMs)(s.startedAt, now);
    if (started !== null)
        out.push(`started ${(0, channel_session_units_1.coarseAge)(started)} ago`);
    // Last, where a partial scan still reaches. Its `stale` is the machine's wedged flag, not {@link sessionIsStale}.
    out.push(...(0, channel_session_health_1.sessionHealthClauses)(s, now));
    return out;
}
/** A stale row under a live operator heartbeat is quiet, not gone (F-294); an unreadable `updatedAt` never is. */
function rowIsQuietNotGone(age, stale, operatorOnline) {
    return stale && age !== null && operatorOnline === true;
}
/** One session row, all peer-influenced text neutralized; `telemetry` adds the operator-only clauses. */
function formatSessionLine(s, opts = {}) {
    const now = opts.now ?? Date.now();
    const where = s.channelName ? ` · in ${(0, channel_shared_1.inlineOr)(s.channelName, narration_1.NO_NAME)}` : "";
    const on = s.threadTitle
        ? ` · thread ${(0, channel_shared_1.inlineOr)(s.threadTitle, exports.NO_TITLE)}`
        : s.threadId
            ? ` · thread ${(0, channel_shared_1.inlineOr)(s.threadId, exports.NO_TITLE)}`
            : " · no thread";
    const state = exports.SESSION_STATES.has(s.state) ? s.state : exports.UNKNOWN_STATE;
    // The stale hedge replaces the state clause so `last reported working` cannot be skimmed as `working`.
    const age = (0, channel_session_units_1.ageMs)(s.updatedAt, now);
    const stale = sessionIsStale(s, now);
    const quiet = rowIsQuietNotGone(age, stale, opts.operatorOnline);
    const head = quiet
        ? `${state} · quiet ${(0, channel_session_units_1.coarseAge)(age)} — your desktop is online, so this is UNCHANGED, not unknown`
        : stale
            ? `last reported ${state} · stale${age === null ? "" : `, ${(0, channel_session_units_1.coarseAge)(age)} ago`} — its desktop may be offline`
            : state;
    // Not neutralized: our own copy from a closed map, keyed by a value the server already narrowed.
    const phrase = detailPhrase(s.detail);
    const detail = phrase ? ` · ${phrase}` : "";
    const extra = opts.telemetry && "model" in s
        ? telemetryClauses(s, now)
        : [];
    const tail = extra.length > 0 ? ` · ${extra.join(" · ")}` : "";
    const at = opts.handle ? (0, channel_session_handle_1.addressableHandle)(s.name) : null;
    const address = at ? ` (\`${at}\`)` : "";
    // The display name leads; `s.name` is the address and the fallback (F-708).
    const named = s.displayName?.trim() ? (0, channel_shared_1.inlineOr)(s.displayName, narration_1.NO_NAME) : null;
    const lead = opts.bullet === false ? "" : "- ";
    return `${lead}**${named ?? (0, channel_shared_1.inlineOr)(s.name, narration_1.NO_NAME)}**${address} — ${head}${detail}${on}${where}${tail}`;
}
/** The legend under a set of session lines; branches on the same quiet/stale fact the rows did (F-294). */
function sessionLegend(anyStale, operatorOnline) {
    const base = 'One row per agent SESSION on your machine: **working** (running tools now), **idle** (between turns, or waiting), **ended** (finished). `idle` is how long since that session last REPORTED, not how long it has been doing nothing, and `—` means the machine reported no value — never zero, and never "none".';
    if (!anyStale)
        return base;
    if (operatorOnline === true) {
        return `${base} A state reading **(unchanged)** is ALIVE, not unknown: your desktop is still heartbeating, and this projection only moves when a session's state does — so nothing has been reported because nothing CHANGED. It is not fresh evidence either; it is the last report, still standing. (A state that instead reads **last reported <state>** carries a stamp that could not be read — treat that one as UNKNOWN.)`;
    }
    return `${base} A state reading **last reported <state>** is NOT a live state: nothing has been reported for that session in a while, and its desktop may be asleep, signed out, or gone. Treat it as UNKNOWN — do not wait on it as if it were still working, and do not report it as stopped either.`;
}
