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
 */

import type {
  ChannelSessionState,
  ChannelSessionStateOwn,
  SessionDetailKey,
} from "@dopl/client";
import { inlineOr } from "./channel-shared";

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
const SESSION_STATES: ReadonlySet<string> = new Set([
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
export const SESSION_STALE_WINDOW_MS = 90_000;

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
const DETAIL_PHRASES: Record<SessionDetailKey, string> = {
  thinking: "thinking",
  tool: "running a tool",
  posting: "sending a message",
  // ⚠ The one key that is about the OPERATOR, not the agent — and the one an
  // orchestrator must not read as progress. It is stopped until a human clicks.
  permission: "BLOCKED on its operator's approval",
  awaiting_peer: "waiting for a peer's reply",
  awaiting_inbound: "holding an inbound reply",
};

function detailPhrase(detail: SessionDetailKey | null | undefined): string | null {
  if (!detail) return null;
  return DETAIL_PHRASES[detail] ?? null;
}

/** "6m" / "2h" / "3d" — coarse on purpose; nobody acts on seconds here. */
function coarseAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * How long ago `iso` was, or `null` when it is absent or unparseable.
 * ⚠ UNPARSEABLE IS `null`, NOT `0`. A stamp we cannot read is a stamp we know
 * nothing about, and rendering "0s ago" for one invents a report.
 */
function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, now - t);
}

/**
 * IS THIS ROW STILL SPEAKING FOR ITSELF?
 *
 * ⚠ AN ABSENT OR UNPARSEABLE `updatedAt` READS AS STALE — the fail-safe
 * direction, and the same one `peerRowStale` picks. A row that cannot say when
 * it was written may not assert a present tense.
 */
export function sessionIsStale(
  session: Pick<ChannelSessionState, "updatedAt">,
  now: number = Date.now(),
  windowMs: number = SESSION_STALE_WINDOW_MS
): boolean {
  const age = ageMs(session.updatedAt, now);
  if (age === null) return true;
  return age >= windowMs;
}

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
 */
export function shortModelLabel(model: string): string {
  const stripped = model
    .replace(/^claude-/i, "")
    .replace(/-\d{8}$/, "")
    .trim();
  return stripped.length > 0 ? stripped : model;
}

/** `62% of 200000` — or `null` when either half is unknown.
 *  ⚠ NEVER divides by an absent or zero window. */
function contextClause(s: ChannelSessionStateOwn): string | null {
  const used = s.contextUsed;
  const window = s.contextWindow;
  if (used === null || used === undefined) return null;
  if (window === null || window === undefined || window <= 0) {
    return `context ${used} tokens (window not reported)`;
  }
  return `context ${Math.round((used / window) * 100)}% of ${window}`;
}

/** `41k` / `912` — compact, and never for a null. */
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n / 100_000) / 10}M`;
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
function telemetryClauses(
  s: ChannelSessionStateOwn,
  now: number
): string[] {
  const out: string[] = [];
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
    out.push(inlineOr(s.templateName, "(unnamed template)"));
  }
  if (s.model) out.push(inlineOr(shortModelLabel(s.model), "(unnamed model)"));
  const ctx = contextClause(s);
  if (ctx) out.push(ctx);
  if (s.tokensSpent !== null && s.tokensSpent !== undefined) {
    out.push(`${compactCount(s.tokensSpent)} tokens`);
  }
  if (s.toolLabel) out.push(`tool ${inlineOr(s.toolLabel, "(unnamed tool)")}`);
  const started = ageMs(s.startedAt, now);
  if (started !== null) out.push(`started ${coarseAge(started)} ago`);
  return out;
}

/**
 * ONE session row, all peer-influenced text neutralized.
 *
 * `telemetry` decides whether the operator-only clauses are rendered at all —
 * ⚠ and it is a SEPARATE decision from the type, deliberately: a caller with an
 * own-scoped row may still want the short line (the `await` block keeps it
 * compact when there are many sessions). Passing `undefined` renders coarse.
 */
export function formatSessionLine(
  s: ChannelSessionState | ChannelSessionStateOwn,
  opts: { telemetry?: boolean; now?: number } = {}
): string {
  const now = opts.now ?? Date.now();
  const where = s.channelName ? ` · in ${inlineOr(s.channelName, NO_NAME)}` : "";
  const on = s.threadTitle
    ? ` · thread ${inlineOr(s.threadTitle, NO_TITLE)}`
    : s.threadId
      ? ` · thread ${inlineOr(s.threadId, NO_TITLE)}`
      : " · no thread";
  const state = SESSION_STATES.has(s.state) ? s.state : UNKNOWN_STATE;

  // ⚠ THE HEDGE, and it replaces the state clause rather than annotating it.
  // "working · stale" still reads as "working" to a skimming model; "last
  // reported working" cannot.
  const age = ageMs(s.updatedAt, now);
  const stale = sessionIsStale(s, now);
  const head = stale
    ? `last reported ${state} · stale${age === null ? "" : `, ${coarseAge(age)} ago`} — its desktop may be offline`
    : state;

  // ⚠ NOT neutralized, and it does not need to be: this is OUR OWN copy, chosen
  // from a closed map by a key the server already narrowed. Nothing the desktop
  // wrote reaches the line — which is the whole reason `detail` is a key.
  const phrase = detailPhrase(s.detail);
  const detail = phrase ? ` · ${phrase}` : "";

  const extra =
    opts.telemetry && "model" in s
      ? telemetryClauses(s as ChannelSessionStateOwn, now)
      : [];
  const tail = extra.length > 0 ? ` · ${extra.join(" · ")}` : "";

  return `- **${inlineOr(s.name, NO_NAME)}** — ${head}${detail}${on}${where}${tail}`;
}

/**
 * THE LEGEND under a set of session lines. One sentence per thing a reader
 * could get wrong, and no more.
 *
 * ⚠ IT NAMES THE STALE CASE EXPLICITLY. A model that sees "last reported
 * working" without being told what that means will round it back to "working" —
 * the reading this whole file exists to prevent.
 */
export function sessionLegend(anyStale: boolean): string {
  const base =
    'Each line is one agent SESSION on your machine and its state: **working** (running tools now), **idle** (between turns, or waiting), **ended** (finished).';
  if (!anyStale) return base;
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
export function sessionBlockLines(
  sessions: readonly ChannelSessionStateOwn[] | undefined,
  now: number = Date.now()
): string[] {
  if (sessions === undefined) return [];
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
    lines.push(formatSessionLine(s, { telemetry: true, now }));
  }
  if (anyStale) {
    lines.push(
      `A line reading **last reported <state>** is NOT a live state — nothing has been reported for that session in a while and its desktop may be gone. Treat it as UNKNOWN: do not wait on it as if it were working, and do not report it as stopped.`,
    );
  }
  return lines;
}

/**
 * TELEMETRY IS THE CALLER'S OWN, AND THE RESULT SAYS SO ONCE.
 * ⚠ Stated because an orchestrator that sees model/tokens on its own lines will
 * otherwise assume it can see a PEER'S, ask for them, and be silently answered
 * with a coarse row it reads as "that agent is running no model".
 */
export const SESSION_TELEMETRY_NOTE =
  "Template, model, context, tokens, current tool and start time are reported for YOUR OWN sessions only — a peer's agent is visible to you as a handle and a state, never as a template or a cost. Where a line carries two bare names, the first is the agent TEMPLATE it was launched from and the second is the model. A template name is what the session was launched as and is never updated afterwards, so it may name a template that has since been renamed or deleted. A field that is absent was NOT REPORTED by the machine running that session; it is not a zero, and no template named is not a template hidden.";
