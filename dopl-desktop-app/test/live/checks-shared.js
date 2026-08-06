'use strict';

// LIVE CONTRACT HARNESS — THE SHARED VOCABULARY OF A CHECK.
//
// SPLIT NOTE (§2, 2026-08-01): `checks.js` was 566 lines before the F1 milestone check and
// 650 after it, and §2 is explicit that an edit to an over-cap file splits it or shrinks it.
// The seam is the registrar/sibling pattern ENGINEERING.md §2 describes for the op-dispatched
// MCP tools: `checks.js` keeps the ORDERED LIST and the module surface `run.js` imports, each
// sibling holds the check BODIES for one lane, and everything two lanes both need lives here.
// No behavior moved — the functions are byte-for-byte the ones that ran before the split.
//
//   checks.js         the registrar: the numbered CHECKS list and the exports run.js reads.
//   checks-room.js    the MAIN ROOM lanes — chat vs request, addressing, multi-address, the
//                     operator's own message, the loop brake, and the milestone KIND (F1).
//   checks-thread.js  BREAKOUT ROOMS and what an agent can actually see — thread delivery,
//                     the handshake, and the MCP read/await render.

const PASS = 'PASS';
const FAIL = 'FAIL';
const SKIP = 'SKIP';

/** Every server capability a check can depend on, and the sentence that explains its absence. */
const CAP_WHY = {
  intent:
    'the server does not accept `intent` / does not stamp `metadata.intent` (chat-vs-request not deployed)',
  thread_participants: 'the thread read returns no `participants` array (threads not deployed)',
  // ── the session surface (F-142 / F-144 / F-147) ────────────────────────────────
  sessions_table:
    'the `read_sessions` op answered the PGRST205 degrade path — supabase/migrations/' +
    '20260805120000_channel_sessions.sql is NOT APPLIED on the target. The op returns empty ' +
    'BY DESIGN in that state (it degrades rather than 500ing), which is exactly why a check ' +
    'that reads a session back cannot tell "no sessions" from "no table" and must SKIP',
  session_writer:
    'POST /api/channels/sessions did not accept a state push (the F-147 writer is not deployed, ' +
    'or the channel_sessions table is missing — it answers 500 until the migration lands, ' +
    'logged once per workspace per run by design)',
  strict_args:
    'the MCP layer accepted a removed parameter instead of refusing it — the F-145 fix ' +
    'registers strict schemas via `registerTool`, and a non-strict SDK parse silently STRIPS ' +
    'unknown keys rather than erroring. A server that strips has not deployed that fix',
};

/** The wire half of a line: what the server actually stamped. */
function wireOf(m) {
  if (!m) return 'no message';
  const meta = (m && m.metadata) || {};
  const ids = Array.isArray(meta.to_agent_ids) ? meta.to_agent_ids : null;
  return [
    `seq=${m.seq}`,
    // THE FIELD F1 TURNED ON. It was never printed here, and it is the one every routing
    // decision below was silently gated on for the whole of the 2026-08-01 run.
    `kind=${m.kind}`,
    `authorKind=${m.authorKind}`,
    `author=${short(m.authorUserId)}`,
    `intent=${meta.intent === undefined ? '-' : String(meta.intent)}`,
    `to_user_id=${short(meta.to_user_id)}`,
    `to_agent_id=${short(meta.to_agent_id)}`,
    `to_agent_ids=${ids ? `[${ids.map(short).join(',')}]` : '-'}`,
    `author_agent_id=${short(meta.author_agent_id)}`,
    `taskId=${short(meta.taskId)}`,
  ].join(' ');
}

/** The desktop half: what the shipped modules concluded. */
function readOf(d) {
  return [
    `as=${short(d.myUserId)}`,
    `classify=${d.classify === null ? '(not reached)' : d.classify}`,
    `authorKind=${d.authorKind}`,
    `intent=${d.intent === undefined ? '-' : String(d.intent)}`,
    `to_user_id=${short(d.toUserId)}`,
  ].join(' ');
}

const short = (v) => (typeof v === 'string' && v ? v.slice(0, 8) : '-');
const result = (status, reason, extra) => ({ status, reason: reason || '', ...(extra || {}) });
const verdict = (fails, extra) => (fails.length ? result(FAIL, fails.join('; '), extra) : result(PASS, '', extra));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sorted = (a) => [...a].sort();

/** SKIP with the exact missing field named. */
function missing(ctx, cap) {
  return result(SKIP, `${CAP_WHY[cap]} — on ${ctx.api.baseUrl}`);
}

// ── helpers ───────────────────────────────────────────────────────────────────────

function base(ctx, m) {
  return {
    channel: ctx.channel,
    workspaceId: ctx.workspaceId,
    message: m,
    myUserId: ctx.me,
    peerUserId: ctx.peer,
  };
}

const count = (set) => (Array.isArray(set) ? set.length : 'n/a');
const describeSet = (set) =>
  Array.isArray(set)
    ? set.length
      ? set.map((p) => `${p.kind}:${short(p.agentId || p.userId)}`).join(' ')
      : '(empty)'
    : '(no participants field)';

module.exports = {
  CAP_WHY, PASS, FAIL, SKIP,
  wireOf, readOf, short, result, verdict, same, sorted, missing, base, count, describeSet,
};
