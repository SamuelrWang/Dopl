"use strict";
/**
 * ONE SESSION, AS A LINE — shared by `read_sessions` and by the `sessions`
 * block an `await` now returns with its messages.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * TWO RULES GOVERN EVERYTHING IN HERE, AND BOTH ARE ABOUT NOT ASSERTING THINGS.
 *
 *  1. **A ROW IS A REPORT, NOT AN OBSERVATION.** `channel_sessions` is a
 *     PROJECTION the operator's desktop PUSHES, on state change and never on a
 *     timer. Nothing on the server watches the machine. So a row whose
 *     `updatedAt` has gone quiet does not mean the agent is quiet — it means
 *     NOBODY HAS SAID ANYTHING, which is a different fact and includes the case
 *     the whole desktop died. {@link formatSessionLine} therefore stops saying
 *     "working" past {@link SESSION_STALE_WINDOW_MS} and starts saying "last
 *     reported working". ⚠ A crashed desktop used to read as `working` FOREVER.
 *  2. **`null` IS UNKNOWN, NEVER ZERO.** Every telemetry field is nullable and
 *     an absent one is simply not rendered. There is no `?? 0` in this file and
 *     there must not be: printing `0 tokens` for a desktop that reported no
 *     number is a measurement nobody took, stated as fact, in the surface an
 *     orchestrator uses to decide whether to keep an agent alive.
 *
 * ⚠ **AND SINCE 2026-08-23 THE FIRST RULE HAS A SECOND WITNESS** (F-294). A quiet
 * row alone cannot tell "idle but alive" from "the desktop is gone", so the hedge
 * said the more alarming of the two about an agent that was merely between turns.
 * `agent_presence` DOES beat on a timer, unconditionally, and the caller's OWN
 * presence freshness now rides in as {@link SessionRenderOpts.operatorOnline}: a
 * quiet row under a LIVE heartbeat renders "quiet Xm" (unchanged), and only a
 * quiet row under a quiet machine keeps "may be offline". ⚠ Absent = UNKNOWN and
 * keeps the old hedge — an older server sends no such key, and this must not read
 * a missing fact as evidence of life.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_TELEMETRY_NOTE = exports.SESSION_STALE_WINDOW_MS = void 0;
exports.sessionIsStale = sessionIsStale;
exports.shortModelLabel = shortModelLabel;
exports.formatSessionLine = formatSessionLine;
exports.sessionLegend = sessionLegend;
exports.sessionBlockLines = sessionBlockLines;
const channel_shared_1 = require("./channel-shared");
// ⚠ THE HANDLE — its own file since 2026-08-31 (the §2 cap, and a different
// reason to change). See `channel-session-handle.ts`'s header.
const channel_session_handle_1 = require("./channel-session-handle");
// ⚠ THE HEALTH CLAUSES — their own file since 2026-09-01, same cap and a
// different reason to change. 🔒 **READ ITS HEADER BEFORE TOUCHING `stale`
// ANYWHERE IN THIS FILE**: the desktop reports a field of that name which is a
// DIFFERENT FACT from {@link sessionIsStale}'s, and the two are kept apart by
// vocabulary alone (that module says WEDGED; this one says stale).
const channel_session_health_1 = require("./channel-session-health");
// ⚠ THE COARSE UNITS moved DOWN into their own module in the same change — the
// health clauses need the same three and importing them back out of this file
// would be an import cycle. See `channel-session-units.ts`'s header.
const channel_session_units_1 = require("./channel-session-units");
/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed)";
const NO_TITLE = "(untitled)";
/**
 * ⚠ `state` is spliced into SERVER NARRATION, not a code span, so it must pass
 * a MEMBERSHIP test — a state carrying a newline could open a second
 * `_dopl_status` block. Its only other guards are the column's
 * `CHECK (state IN (…))` (in a migration NOT applied to the live database) and
 * an unchecked cast in `collab-dto.ts`, so this is the layer that actually
 * holds. Membership, not neutralization: the set is closed and 3 long, so
 * anything outside it is not a state we can render.
 */
const SESSION_STATES = new Set([
    "working",
    "idle",
    "ended",
]);
const UNKNOWN_STATE = "(unrecognized state)";
/**
 * PAST THIS, A ROW STOPS ASSERTING A LIVE STATE.
 *
 * ⚠ A DELIBERATE DUPLICATE of `src/features/channels/constants.ts ›
 * PRESENCE_ONLINE_WINDOW_MS`, pinned by `channel-session-staleness.test.ts`
 * against that file's TEXT — this package cannot import across the tree
 * boundary, and the precedent for the duplicate-plus-pin is
 * `channel-addressing.ts › GROUP_CHANNEL_MIN_MEMBERS`.
 *
 * ⚠ **IT IS THE PRESENCE WINDOW ON PURPOSE, AND THE REUSE IS THE POINT**: a
 * second staleness number would let one surface call a member's machine offline
 * while another still reports their agent as busily working. The web's peer
 * cards already reuse it (`components/channels-v2/agents-model.ts ›
 * peerRowStale`), and this is the third reader of the same rule.
 *
 * ⚠ **WHAT IT IS NOT: A HEARTBEAT.** `updatedAt` moves on a projection CHANGE,
 * so a genuinely-alive agent that has been idle for ten minutes crosses this
 * line. That is why the treatment is a HEDGE ("last reported idle") and never a
 * removal or a claim that the agent stopped — the same conclusion the web's
 * cards reached when a wall-clock filter made live agents vanish mid-run.
 */
exports.SESSION_STALE_WINDOW_MS = 90_000;
/**
 * THE SIX SITUATION KEYS, AS PHRASES AN AGENT CAN ACT ON.
 *
 * ⚠ **THE KEY CROSSES THE WIRE, THE SENTENCE IS WRITTEN HERE** — the same split
 * the web makes (`components/channels-v2/agents-model.ts › agentDetailLabel`),
 * and for the same reason: `main/session-detail.js` owns "which of six
 * situations is this" because that is a fact about the engine and must have one
 * answer; what a reader is told is copy, and copy must not need a desktop
 * release to change. ⚠ The two copies are deliberately DIFFERENT WORDS — the web
 * writes for an operator glancing at a card ("Waiting on you"), this writes for
 * a model deciding whether to keep waiting ("blocked on its operator's
 * approval"). Same key, two audiences; do not "unify" them.
 *
 * ⚠ AN UNKNOWN KEY RENDERS NOTHING, NEVER THE RAW KEY. The server already
 * narrows anything off this list to `null`, so this is the second of two
 * fail-closed layers rather than the only one — and it is what keeps a future
 * seventh key from appearing verbatim in narration.
 */
const DETAIL_PHRASES = {
    thinking: "thinking",
    tool: "running a tool",
    posting: "sending a message",
    // ⚠ The one key that is about the OPERATOR, not the agent — and the one an
    // orchestrator must not read as progress. It is stopped until a human clicks.
    permission: "BLOCKED on its operator's approval",
    awaiting_peer: "waiting for a peer's reply",
    awaiting_inbound: "holding an inbound reply",
};
function detailPhrase(detail) {
    if (!detail)
        return null;
    return DETAIL_PHRASES[detail] ?? null;
}
/**
 * IS THIS ROW STILL SPEAKING FOR ITSELF?
 *
 * ⚠ AN ABSENT OR UNPARSEABLE `updatedAt` READS AS STALE — the fail-safe
 * direction, and the same one `peerRowStale` picks. A row that cannot say when
 * it was written may not assert a present tense.
 */
function sessionIsStale(session, now = Date.now(), windowMs = exports.SESSION_STALE_WINDOW_MS) {
    const age = (0, channel_session_units_1.ageMs)(session.updatedAt, now);
    if (age === null)
        return true;
    return age >= windowMs;
}
/**
 * THE CHARACTERS `neutralizeInline` WOULD TURN INTO A SPACE — its
 * markdown-structure class, plus whitespace itself.
 *
 * ⚠ **A DELIBERATE RESTATEMENT of `narration.ts › neutralizeInline`'s class**, and
 * `channel-session-liveness.test.ts` holds the two against each other character
 * by character rather than trusting this comment. It is stated a second time
 * because the two do OPPOSITE things with the same set: the neutralizer blanks
 * them so text cannot pose as structure, and {@link shortModelLabel} joins them
 * so ONE id cannot pose as TWO names (F-293). A class that grew in one place and
 * not the other would re-open exactly that.
 */
const MODEL_LABEL_BREAKERS = /[`*_#>[\]{}|\s]+/g;
const MODEL_LABEL_EDGE = /^[`*_#>[\]{}|\s]+|[`*_#>[\]{}|\s]+$/g;
/**
 * A model id, shortened for a glance.
 *
 * ⚠ COSMETIC ONLY, and it never invents a name: it drops a leading vendor
 * prefix and a trailing dated build stamp, both of which are noise in a line an
 * orchestrator skims. If the strip would leave nothing, the ORIGINAL is
 * rendered — an id this build has never seen renders AS ITSELF rather than as a
 * blank, which is the same rule the web's model chip follows (a newer desktop
 * may run a model this build has not heard of, and a blank would report that as
 * "no model").
 * ⚠ Still passed through `inlineOr` by the caller — it is a value in a line WE
 * wrote, and the desktop is not a trusted formatter.
 *
 * ⚠ **AND THE RESULT IS ONE TOKEN, ALWAYS — F-293, A LIVE DEFECT.** The bundled
 * CLI ships explicit long-context ids spelled with a bracket suffix
 * (`claude-opus-5[1m]`, `claude-sonnet-4-6[1m]`; `main/session-model.js ›
 * contextWindowFor` reads that suffix as the window), and `narration.ts ›
 * neutralizeInline` turns `[` and `]` into SPACES because they are markdown
 * structure. So the model clause rendered `` `opus-5 1m` `` — a bare `1m` sitting
 * in the one segment {@link SESSION_TELEMETRY_NOTE} promises holds bare NAMES,
 * one clause away from `started 12m ago` and `stale, 10m ago`. A relative time is
 * exactly what `coarseAge` emits, so an operator reads a time shard as a template
 * or a model. **Whatever the neutralizer would blank into a space is joined with
 * a HYPHEN here instead**, so no desktop-supplied id can ever split the model slot
 * into two bare names.
 */
function shortModelLabel(model) {
    const stripped = model
        .replace(/^claude-/i, "")
        .replace(/-\d{8}$/, "")
        .trim();
    const base = stripped.length > 0 ? stripped : model;
    // ⚠ EDGES FIRST, so `opus-5[1m]` becomes `opus-5-1m` and not `opus-5-1m-`. A
    // label that is ALL breakers survives as itself and fails the ordinary way, in
    // `inlineOr` — the same rule the empty-strip fallback above follows: this
    // function never blanks a name, because a blank reports "no model".
    const single = base
        .replace(MODEL_LABEL_EDGE, "")
        .replace(MODEL_LABEL_BREAKERS, "-");
    return single.length > 0 ? single : base;
}
/** `62% of 200000` — or `null` when either half is unknown.
 *  ⚠ NEVER divides by an absent or zero window. */
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
/**
 * THE OPERATOR-ONLY HALF, as clauses — empty array when the row carries none.
 *
 * ⚠ Reached ONLY from an own-scoped render. The type is the gate: a peer row is
 * a `ChannelSessionState`, which has none of these fields, so a peer surface
 * that tried to call this would not compile.
 * ⚠ EVERY CLAUSE IS CONDITIONAL. An older desktop reports nothing and its line
 * is exactly the line it rendered before this wave — no "unknown · unknown ·
 * unknown" filler, which would be four words saying one thing.
 */
function telemetryClauses(s, now) {
    const out = [];
    // ⚠ FIRST, AND IMMEDIATELY BEFORE THE MODEL — `Code Auditor · opus-5`. WHAT an
    // agent was configured to be, then WHAT it runs on: those two answer "which of
    // my six agents is this" together, and splitting them across the tokens and
    // the tool clause is how a skimming orchestrator reads a template name as a
    // tool name.
    // ⚠ NEUTRALIZED, and operator-only is not the reason to skip it — this is
    // operator-authored free text up to 120 chars being spliced into a line WE
    // wrote, and a forged line in your own result is still a forged line.
    // ⚠ ABSENT RENDERS NOTHING. A session launched blank is the common case, and
    // "(no template)" on five of six lines is filler saying one thing five times.
    if (s.templateName) {
        out.push((0, channel_shared_1.inlineOr)(s.templateName, "(unnamed template)"));
    }
    if (s.model)
        out.push((0, channel_shared_1.inlineOr)(shortModelLabel(s.model), "(unnamed model)"));
    const ctx = contextClause(s);
    if (ctx)
        out.push(ctx);
    if (s.tokensSpent !== null && s.tokensSpent !== undefined) {
        out.push(`${(0, channel_session_units_1.compactCount)(s.tokensSpent)} tokens`);
    }
    // ⚠ TURNS AND THE SPEND DELTA RIDE HERE, IMMEDIATELY AFTER THE LIFETIME
    // TOTAL, because a reader comparing "41k tokens" with "+8.7k since it last
    // posted" is doing ONE piece of arithmetic — see
    // `channel-session-health.ts › sessionProgressClauses`.
    out.push(...(0, channel_session_health_1.sessionProgressClauses)(s));
    if (s.toolLabel)
        out.push(`tool ${(0, channel_shared_1.inlineOr)(s.toolLabel, "(unnamed tool)")}`);
    const started = (0, channel_session_units_1.ageMs)(s.startedAt, now);
    if (started !== null)
        out.push(`started ${(0, channel_session_units_1.coarseAge)(started)} ago`);
    // ⚠ LAST, AND THE POSITION IS LOAD-BEARING. Two of these three are things an
    // orchestrator must ACT on (calls being denied, a session its own machine
    // calls wedged), and the end of a `·`-joined line is the position a partial
    // scan still reaches. ⚠ The `stale` rendered in here is the MACHINE's wedged
    // flag and NOT {@link sessionIsStale}'s row-freshness fact — that module says
    // WEDGED and this one says stale, deliberately, and neither word may migrate.
    out.push(...(0, channel_session_health_1.sessionHealthClauses)(s, now));
    return out;
}
/**
 * IS A QUIET ROW MERELY QUIET?
 *
 * ⚠ Two conditions, and BOTH are required. The row must be past the window
 * (otherwise it still speaks for itself), and the caller's machine must be
 * heartbeating NOW. ⚠ **AN UNREADABLE `updatedAt` IS EXCLUDED ON PURPOSE** — the
 * fail-safe direction {@link sessionIsStale} already picks. Presence licenses us
 * to say "this report is still current"; it does not license us to date a report
 * whose own stamp we cannot read.
 */
function rowIsQuietNotGone(age, stale, operatorOnline) {
    return stale && age !== null && operatorOnline === true;
}
/**
 * ONE session row, all peer-influenced text neutralized.
 *
 * `telemetry` decides whether the operator-only clauses are rendered at all —
 * ⚠ and it is a SEPARATE decision from the type, deliberately: a caller with an
 * own-scoped row may still want the short line (the `await` block keeps it
 * compact when there are many sessions). Passing `undefined` renders coarse.
 */
function formatSessionLine(s, opts = {}) {
    const now = opts.now ?? Date.now();
    const where = s.channelName ? ` · in ${(0, channel_shared_1.inlineOr)(s.channelName, NO_NAME)}` : "";
    const on = s.threadTitle
        ? ` · thread ${(0, channel_shared_1.inlineOr)(s.threadTitle, NO_TITLE)}`
        : s.threadId
            ? ` · thread ${(0, channel_shared_1.inlineOr)(s.threadId, NO_TITLE)}`
            : " · no thread";
    const state = SESSION_STATES.has(s.state) ? s.state : UNKNOWN_STATE;
    // ⚠ THE HEDGE, and it replaces the state clause rather than annotating it.
    // "working · stale" still reads as "working" to a skimming model; "last
    // reported working" cannot.
    //
    // ⚠ **AND THE MIDDLE BRANCH IS THE OPPOSITE TRADE, ON PURPOSE** (F-294). When
    // presence says the machine is heartbeating, the state clause is KEPT and only
    // annotated — because here we WANT it read as the state. The push is
    // change-driven, so a live machine that has said nothing has nothing to say:
    // "unchanged" is the honest word and "may be offline" was a lie the surface
    // told about every idle-but-alive agent within ~2 minutes. It still stops short
    // of a fresh observation ("quiet", not "as of now"), because a push that FAILED
    // also leaves a live machine looking quiet.
    const age = (0, channel_session_units_1.ageMs)(s.updatedAt, now);
    const stale = sessionIsStale(s, now);
    const quiet = rowIsQuietNotGone(age, stale, opts.operatorOnline);
    const head = quiet
        ? `${state} · quiet ${(0, channel_session_units_1.coarseAge)(age)} — your desktop is online, so this is UNCHANGED, not unknown`
        : stale
            ? `last reported ${state} · stale${age === null ? "" : `, ${(0, channel_session_units_1.coarseAge)(age)} ago`} — its desktop may be offline`
            : state;
    // ⚠ NOT neutralized, and it does not need to be: this is OUR OWN copy, chosen
    // from a closed map by a key the server already narrowed. Nothing the desktop
    // wrote reaches the line — which is the whole reason `detail` is a key.
    const phrase = detailPhrase(s.detail);
    const detail = phrase ? ` · ${phrase}` : "";
    const extra = opts.telemetry && "model" in s
        ? telemetryClauses(s, now)
        : [];
    const tail = extra.length > 0 ? ` · ${extra.join(" · ")}` : "";
    // ⚠ THE HANDLE RIDES IN THE HEAD, NOT THE TAIL (2026-08-31). Everything after
    // the em dash is STATE, and a caller skimming for "which of these can I talk
    // to" reads the bold head; an address in the telemetry tail is the clause a
    // model drops first. ⚠ A row whose name is NOT an agent id prints NOTHING
    // extra rather than a plausible-looking handle — see {@link addressableHandle}.
    const at = opts.handle ? (0, channel_session_handle_1.addressableHandle)(s.name) : null;
    const address = at ? ` (\`${at}\`)` : "";
    return `- **${(0, channel_shared_1.inlineOr)(s.name, NO_NAME)}**${address} — ${head}${detail}${on}${where}${tail}`;
}
/**
 * THE LEGEND under a set of session lines. One sentence per thing a reader
 * could get wrong, and no more.
 *
 * ⚠ IT NAMES THE STALE CASE EXPLICITLY. A model that sees "last reported
 * working" without being told what that means will round it back to "working" —
 * the reading this whole file exists to prevent.
 *
 * ⚠ **AND SINCE F-294 THERE ARE TWO QUIET-ROW READINGS, SO THE LEGEND BRANCHES
 * ON THE SAME FACT THE LINES DID.** Explaining "may be offline" over a page whose
 * lines all say "quiet" teaches the wrong caveat, which is worse than none.
 */
function sessionLegend(anyStale, operatorOnline) {
    const base = 'Each line is one agent SESSION on your machine and its state: **working** (running tools now), **idle** (between turns, or waiting), **ended** (finished).';
    if (!anyStale)
        return base;
    if (operatorOnline === true) {
        // ⚠ The trailing clause covers the one row that can still take the other
        // branch under a live heartbeat: an `updatedAt` this server could not parse.
        return `${base} A line reading **quiet Xm** is ALIVE, not unknown: your desktop is still heartbeating, and this projection only moves when a session's state does — so nothing has been reported because nothing CHANGED. It is not fresh evidence either; it is the last report, still standing. (A line that instead reads **last reported <state>** carries a stamp that could not be read — treat that one as UNKNOWN.)`;
    }
    return `${base} A line reading **last reported <state>** is NOT a live state: nothing has been reported for that session in a while, and its desktop may be asleep, signed out, or gone. Treat it as UNKNOWN — do not wait on it as if it were still working, and do not report it as stopped either.`;
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
    const anyStale = sessions.some((s) => sessionIsStale(s, now));
    const lines = [``, `### Your agents — ${sessions.length}`];
    for (const s of sessions) {
        // ⚠ `handle: true` — own-scoped by construction (`ChannelSessionStateOwn`,
        // and the await route reads the caller's own rows). See
        // {@link SessionRenderOpts.handle} for why it is not the telemetry flag.
        lines.push(formatSessionLine(s, { telemetry: true, handle: true, now, operatorOnline }));
    }
    if (anyStale) {
        // ⚠ Same branch the lines above took, for the reason `sessionLegend` states:
        // a caveat about a form the page does not contain teaches the wrong lesson.
        lines.push(operatorOnline === true
            ? `A line reading **quiet Xm** is ALIVE — your desktop is still heartbeating and this projection only moves when a session's state does, so nothing was reported because nothing CHANGED. Do not read it as a fresh observation, and do not read it as stopped.`
            : `A line reading **last reported <state>** is NOT a live state — nothing has been reported for that session in a while and its desktop may be gone. Treat it as UNKNOWN: do not wait on it as if it were working, and do not report it as stopped.`);
    }
    return lines;
}
/**
 * TELEMETRY IS THE CALLER'S OWN, AND THE RESULT SAYS SO ONCE.
 * ⚠ Stated because an orchestrator that sees model/tokens on its own lines will
 * otherwise assume it can see a PEER'S, ask for them, and be silently answered
 * with a coarse row it reads as "that agent is running no model".
 */
exports.SESSION_TELEMETRY_NOTE = "Template, model, context, tokens, current tool and start time are reported for YOUR OWN sessions only — a peer's agent is visible to you as a handle and a state, never as a template or a cost. Where a line carries two bare names, the first is the agent TEMPLATE it was launched from and the second is the model; the MODEL is always ONE unbroken token, so a name containing a space is a template and never a model. A template name is what the session was launched as and is never updated afterwards, so it may name a template that has since been renamed or deleted. A field that is absent was NOT REPORTED by the machine running that session; it is not a zero, and no template named is not a template hidden.";
