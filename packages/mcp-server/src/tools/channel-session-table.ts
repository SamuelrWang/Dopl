/**
 * The session grid shared by `op="status"` and the sessions block on a hold (`op="read"` with
 * `wait_ms`). State predicates come from `channel-session-render.ts`, so stale, model label and age
 * have one definition. The `channel-` filename prefix is load-bearing for the parity scans.
 */

import type { ChannelSessionState, ChannelSessionStateOwn } from "@dopl/client";
import { inlineOr } from "./channel-shared";
import { addressableHandle } from "./channel-session-handle";
// Imported from the leaf, not through `channel-session-render.ts`, to avoid a cycle.
import { ageMs, coarseAge } from "./channel-session-units";
import {
  NO_TITLE,
  SESSION_STATES,
  UNKNOWN_STATE,
  detailPhrase,
  rowIsQuietNotGone,
  sessionIsStale,
  shortModelLabel,
  type SessionRenderOpts,
} from "./channel-session-render";
import { NO_NAME } from "./narration";

// No `|` escaping needed: every peer-supplied cell goes through `inlineOr` → `neutralizeInline`,
// which blanks `|`; our own literals are closed sets and digits.

/**
 * Header + alignment row for {@link sessionRow}; column order is the row's. `name` (what a person
 * calls it) and `handle` (what a caller addresses) are separate columns (F-708).
 */
export const SESSION_TABLE_HEAD: readonly string[] = [
  `| name | handle | state | thread | channel | identity | model | tool | idle |`,
  `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
];

/** Not reported, never a zero (the legend says so). */
const NOT_REPORTED = "—";

/** One session as a row; shared by every surface (`channel-session-liveness.test.ts` pins them equal). */
export function sessionRow(
  s: ChannelSessionState | ChannelSessionStateOwn,
  opts: SessionRenderOpts = {}
): string {
  const now = opts.now ?? Date.now();
  const state = SESSION_STATES.has(s.state) ? s.state : UNKNOWN_STATE;

  const age = ageMs(s.updatedAt, now);
  const stale = sessionIsStale(s, now);
  const quiet = rowIsQuietNotGone(age, stale, opts.operatorOnline);

  // A stale row may not assert a present tense: the hedge goes first (`last reported working`).
  const stateCell = quiet
    ? `${state} (unchanged)`
    : stale
      ? `last reported ${state}`
      : state;
  const phrase = detailPhrase(s.detail);
  const stateFull = phrase ? `${stateCell} · ${phrase}` : stateCell;

  // The handle is the addressable form or the name, never a plausible-looking handle.
  const at = opts.handle ? addressableHandle(s.name) : null;
  const handle = at ? `\`${at}\`` : inlineOr(s.name, NO_NAME);
  // A dash when unnamed, never the handle: repeating it would make an unnamed agent look named.
  const name = s.displayName?.trim()
    ? inlineOr(s.displayName, NO_NAME)
    : NOT_REPORTED;

  const thread = s.threadTitle
    ? inlineOr(s.threadTitle, NO_TITLE)
    : s.threadId
      ? inlineOr(s.threadId, NO_TITLE)
      : NOT_REPORTED;
  const channel = s.channelName
    ? inlineOr(s.channelName, NO_NAME)
    : NOT_REPORTED;

  // Telemetry is operator-only and the type is the gate: a peer row has none of these fields.
  const own = opts.telemetry && "model" in s ? (s as ChannelSessionStateOwn) : null;
  const identity = own?.identityName
    ? inlineOr(own.identityName, "(unnamed identity)")
    : NOT_REPORTED;
  const model = own?.model
    ? inlineOr(shortModelLabel(own.model), "(unnamed model)")
    : NOT_REPORTED;
  const tool = own?.toolLabel
    ? inlineOr(own.toolLabel, "(unnamed tool)")
    : NOT_REPORTED;

  const idle = age === null ? NOT_REPORTED : coarseAge(age);

  return `| ${name} | ${handle} | ${stateFull} | ${thread} | ${channel} | ${identity} | ${model} | ${tool} | ${idle} |`;
}

/**
 * The caller's own agents, appended under a hold's messages (never interleaved with them).
 * `undefined` (not reported) renders nothing; `[]` renders one line, since that is what a crashed
 * or signed-out desktop looks like.
 */
export function sessionBlockLines(
  sessions: readonly ChannelSessionStateOwn[] | undefined,
  now: number = Date.now(),
  // Absent is "not reported", which takes the offline-hedge branch.
  operatorOnline?: boolean
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
  const lines = [``, `### Your agents — ${sessions.length}`, ...SESSION_TABLE_HEAD];
  for (const s of sessions) {
    // `handle: true`: own-scoped by construction (`ChannelSessionStateOwn`).
    lines.push(
      sessionRow(s, { telemetry: true, handle: true, now, operatorOnline }),
    );
  }
  if (anyStale) {
    lines.push(
      operatorOnline === true
        ? `A state reading **(unchanged)** is ALIVE — your desktop is still heartbeating and this projection only moves when a session's state does, so nothing was reported because nothing CHANGED. Do not read it as a fresh observation, and do not read it as stopped.`
        : `A state reading **last reported <state>** is NOT a live state — nothing has been reported for that session in a while and its desktop may be gone. Treat it as UNKNOWN: do not wait on it as if it were working, and do not report it as stopped.`,
    );
  }
  return lines;
}
