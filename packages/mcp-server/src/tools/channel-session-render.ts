/**
 * Session vocabulary and the one-line session form, shared by `op="status"`, `channel-session-table.ts`
 * and `status-render.ts`. A row is a report the desktop pushes on change, not an observation: past the
 * stale window it is hedged, and `null` telemetry is unknown, never zero.
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */

import type {
  ChannelSessionState,
  ChannelSessionStateOwn,
  SessionDetailKey,
} from "@dopl/client";
import { inlineOr } from "./channel-shared";
import { NO_NAME } from "./narration";
import { addressableHandle } from "./channel-session-handle";
import {
  sessionHealthClauses,
  sessionProgressClauses,
} from "./channel-session-health";
import { ageMs, coarseAge, compactCount } from "./channel-session-units";

// Helpers are exported for `channel-session-table.ts`, so the session vocabulary has one definition.

/** Peer-influenced display text, neutralized — never an empty span. */
export const NO_TITLE = "(untitled)";


/** `state` is spliced into server narration, so it must pass membership (a newline could forge a block). */
export const SESSION_STATES: ReadonlySet<string> = new Set([
  "working",
  "idle",
  "ended",
]);
export const UNKNOWN_STATE = "(unrecognized state)";

/**
 * Past this, a row stops asserting a live state. Deliberate duplicate of
 * `src/features/channels/constants.ts › PRESENCE_ONLINE_WINDOW_MS`, pinned by `channel-session-staleness.test.ts`.
 */
export const SESSION_STALE_WINDOW_MS = 120_000;

/** Situation key → phrase for a model (the web's `agents-model.ts › agentDetailLabel` wording differs on purpose). */
const DETAIL_PHRASES: Record<SessionDetailKey, string> = {
  thinking: "thinking",
  tool: "running a tool",
  posting: "sending a message",
  permission: "BLOCKED on its operator's approval",
  awaiting_peer: "waiting for a peer's reply",
  awaiting_inbound: "holding an inbound reply",
};

export function detailPhrase(detail: SessionDetailKey | null | undefined): string | null {
  if (!detail) return null;
  return DETAIL_PHRASES[detail] ?? null;
}

/** An absent or unparseable `updatedAt` reads as stale. */
export function sessionIsStale(
  session: Pick<ChannelSessionState, "updatedAt">,
  now: number = Date.now(),
  windowMs: number = SESSION_STALE_WINDOW_MS
): boolean {
  const age = ageMs(session.updatedAt, now);
  if (age === null) return true;
  return age >= windowMs;
}

/** Must mirror `narration.ts › neutralizeInline`'s blanked class (held by `channel-session-liveness.test.ts`). */
const MODEL_LABEL_BREAKERS = /[`*_#>[\]{}|\s]+/g;
const MODEL_LABEL_EDGE = /^[`*_#>[\]{}|\s]+|[`*_#>[\]{}|\s]+$/g;

/**
 * A model id for a glance: only a trailing `-YYYYMMDD` stamp is dropped (no vendor-prefix strip), and
 * characters `neutralizeInline` would blank are joined with `-` so one id never renders as two names (F-293).
 */
export function shortModelLabel(model: string): string {
  const stripped = model.replace(/-\d{8}$/, "").trim();
  const base = stripped.length > 0 ? stripped : model;
  // Edges first, so `opus-5[1m]` becomes `opus-5-1m` and not `opus-5-1m-`; never blanks a name.
  const single = base
    .replace(MODEL_LABEL_EDGE, "")
    .replace(MODEL_LABEL_BREAKERS, "-");
  return single.length > 0 ? single : base;
}

/** `62% of 200000`; `null` when usage is unknown, and never divides by an absent or zero window. */
function contextClause(s: ChannelSessionStateOwn): string | null {
  const used = s.contextUsed;
  const window = s.contextWindow;
  if (used === null || used === undefined) return null;
  if (window === null || window === undefined || window <= 0) {
    return `context ${used} tokens (window not reported)`;
  }
  return `context ${Math.round((used / window) * 100)}% of ${window}`;
}

/** Operator-only clauses, each conditional; the `ChannelSessionStateOwn` type is the audience gate. */
function telemetryClauses(
  s: ChannelSessionStateOwn,
  now: number
): string[] {
  const out: string[] = [];
  if (s.identityName) {
    out.push(inlineOr(s.identityName, "(unnamed identity)"));
  }
  if (s.model) out.push(inlineOr(shortModelLabel(s.model), "(unnamed model)"));
  const ctx = contextClause(s);
  if (ctx) out.push(ctx);
  if (s.tokensSpent !== null && s.tokensSpent !== undefined) {
    out.push(`${compactCount(s.tokensSpent)} tokens`);
  }
  out.push(...sessionProgressClauses(s));
  if (s.toolLabel) out.push(`tool ${inlineOr(s.toolLabel, "(unnamed tool)")}`);
  const started = ageMs(s.startedAt, now);
  if (started !== null) out.push(`started ${coarseAge(started)} ago`);
  // Last, where a partial scan still reaches. Its `stale` is the machine's wedged flag, not {@link sessionIsStale}.
  out.push(...sessionHealthClauses(s, now));
  return out;
}

export interface SessionRenderOpts {
  telemetry?: boolean;
  now?: number;
  /** The caller's own machine's presence, not this session's; `undefined` (not reported) takes the `false` branch. */
  operatorOnline?: boolean;
  /** Own rows only: an agent id is a wake token (INVARIANTS §11), so this is not tied to `telemetry`. */
  handle?: boolean;
  /** Emit the leading `- ` bullet (default true). */
  bullet?: boolean;
}

/** A stale row under a live operator heartbeat is quiet, not gone (F-294); an unreadable `updatedAt` never is. */
export function rowIsQuietNotGone(
  age: number | null,
  stale: boolean,
  operatorOnline: boolean | undefined
): boolean {
  return stale && age !== null && operatorOnline === true;
}

/** One session row, all peer-influenced text neutralized; `telemetry` adds the operator-only clauses. */
export function formatSessionLine(
  s: ChannelSessionState | ChannelSessionStateOwn,
  opts: SessionRenderOpts = {}
): string {
  const now = opts.now ?? Date.now();
  const where = s.channelName ? ` · in ${inlineOr(s.channelName, NO_NAME)}` : "";
  const on = s.threadTitle
    ? ` · thread ${inlineOr(s.threadTitle, NO_TITLE)}`
    : s.threadId
      ? ` · thread ${inlineOr(s.threadId, NO_TITLE)}`
      : " · no thread";
  const state = SESSION_STATES.has(s.state) ? s.state : UNKNOWN_STATE;

  // The stale hedge replaces the state clause so `last reported working` cannot be skimmed as `working`.
  const age = ageMs(s.updatedAt, now);
  const stale = sessionIsStale(s, now);
  const quiet = rowIsQuietNotGone(age, stale, opts.operatorOnline);
  const head = quiet
    ? `${state} · quiet ${coarseAge(age as number)} — your desktop is online, so this is UNCHANGED, not unknown`
    : stale
      ? `last reported ${state} · stale${age === null ? "" : `, ${coarseAge(age)} ago`} — its desktop may be offline`
      : state;

  // Not neutralized: our own copy from a closed map, keyed by a value the server already narrowed.
  const phrase = detailPhrase(s.detail);
  const detail = phrase ? ` · ${phrase}` : "";

  const extra =
    opts.telemetry && "model" in s
      ? telemetryClauses(s as ChannelSessionStateOwn, now)
      : [];
  const tail = extra.length > 0 ? ` · ${extra.join(" · ")}` : "";

  const at = opts.handle ? addressableHandle(s.name) : null;
  const address = at ? ` (\`${at}\`)` : "";
  // The display name leads; `s.name` is the address and the fallback (F-708).
  const named = s.displayName?.trim() ? inlineOr(s.displayName, NO_NAME) : null;
  const lead = opts.bullet === false ? "" : "- ";
  return `${lead}**${named ?? inlineOr(s.name, NO_NAME)}**${address} — ${head}${detail}${on}${where}${tail}`;
}

/** The legend under a set of session lines; branches on the same quiet/stale fact the rows did (F-294). */
export function sessionLegend(
  anyStale: boolean,
  operatorOnline?: boolean
): string {
  const base =
    'One row per agent SESSION on your machine: **working** (running tools now), **idle** (between turns, or waiting), **ended** (finished). `idle` is how long since that session last REPORTED, not how long it has been doing nothing, and `—` means the machine reported no value — never zero, and never "none".';
  if (!anyStale) return base;
  if (operatorOnline === true) {
    return `${base} A state reading **(unchanged)** is ALIVE, not unknown: your desktop is still heartbeating, and this projection only moves when a session's state does — so nothing has been reported because nothing CHANGED. It is not fresh evidence either; it is the last report, still standing. (A state that instead reads **last reported <state>** carries a stamp that could not be read — treat that one as UNKNOWN.)`;
  }
  return `${base} A state reading **last reported <state>** is NOT a live state: nothing has been reported for that session in a while, and its desktop may be asleep, signed out, or gone. Treat it as UNKNOWN — do not wait on it as if it were still working, and do not report it as stopped either.`;
}
