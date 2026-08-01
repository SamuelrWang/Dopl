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
  to_agent_ids:
    'the server does not accept `toAgents` / does not stamp `metadata.to_agent_ids` (multi-address not deployed)',
  intent:
    'the server does not accept `intent` / does not stamp `metadata.intent` (chat-vs-request not deployed)',
  engagement:
    'the agent roster DTO carries no `engagedAt` / `engagedBy` (agent engagement not deployed)',
  engagement_stamped:
    'NOT A DEPLOY GAP — A CREDENTIAL ONE, and it is the one thing this harness cannot fake its ' +
    'way around. A human-authored post naming an agent was made and the roster was re-read: ' +
    '`engagedAt` is still null. ENGAGEMENT REQUIRES A HUMAN CREDENTIAL, not a human claim — ' +
    '`recordAgentEngagement` (src/features/channels/server/service-writes-agents.ts) returns ' +
    'before it reads anything when `ctx.source === "agent"`, and `buildChannelContext` derives ' +
    'that from the credential (`auth.agentTokenId ? "agent" : "user"`), which EVERY Bearer token ' +
    'sets. This harness holds a device token by design (never a cookie session), so no post it ' +
    'can make will ever engage an agent. The engaged lane therefore cannot be armed from here ' +
    'at all, and a check that needs it says so instead of passing against an unengaged room',
  thread_participants: 'the thread read returns no `participants` array (breakout rooms not deployed)',
  handshake_derivation:
    'a `thread-open-<channelId>-<seq>` key seeded NO participants (server-side handshake derivation not deployed)',
  mcp_agent_address_render:
    'the deployed MCP renderer prints no `· to agents` tag (pre-BLOCKER-3 read/await render)',
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
function readOf(d, names) {
  return [
    `routed=${d.routed === '' ? "''" : d.routed}`,
    `classify=${d.classify === null ? '(not reached)' : d.classify}`,
    `fed=[${d.fed.map((id) => names(id)).join(',')}]`,
    `woke=[${d.woke.map((id) => names(id)).join(',')}]`,
    `addressed=[${d.addressed.map((id) => names(id)).join(',')}]`,
    `isChat=${d.isChat}`,
    `mayEngage=${d.mayEngage}`,
    `teamAgents=${d.teamAgents}`,
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
    roster: ctx.roster,
    participants: undefined,
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
