// THE ESCALATION-ANSWER DOOR — §2 SPLIT out of `session-dispatch.js` (2026-09-14, the 500-line
// cap). Byte-unchanged, and re-exported from `agent-handles.js` so the dispatch routing block
// reaches it through the ONE module its extraction harnesses already inject REAL: a new free
// var would have had to be plumbed into four of them, and a fake door is a fake wake.

// ── THE DOOR THE SERVER DELIBERATELY DOES NOT RESOLVE: AN ESCALATION ANSWER ────────────────────
// A human pressing an option on an ESCALATION CARD posts an ordinary message carrying reserved
// `metadata.escalationAnswer` — and the agent that ASKED the question is the one that must be
// told (Samuel, 2026-08-31).
//
// ⚠ IT IS RESOLVED HERE BECAUSE IT CANNOT BE RESOLVED THERE. `escalationAnswer.agentId` names the
// agent that asked, which belongs to whoever posted the escalation — usually not the author — so
// `service-wake-verdict.ts` would have to answer `[]` for it, and `[]` is authoritative. The
// machine is the only place the thread's live ids are known, so the union happens here.
//
// ⚠ IT IS STRICTLY LESS FORGEABLE THAN THE BODY DOORS, which is the argument for it existing. An
// `@` reads the BODY, which any member can type; this key is stripped from caller input
// unconditionally and re-stamped server-side only after the caller is proved to be a member that
// escalation asked, with the agent id DERIVED from the escalation's own post stamp
// (`server/service-writes-metadata-escalation.ts`). A member cannot aim it.
//
// ⚠ WHY THE ANSWER DOES NOT SIMPLY WRITE `@agent-<id>` IN THE BODY: the raw agent id is never
// user-visible chrome (INVARIANTS §11), and a PEER's machine cannot know the asking agent's
// display name — so the body token is the only form available to them and it is the forbidden one.
// ⚠ INTERSECTED WITH `liveIds` LIKE EVERY OTHER DOOR. An answer naming an agent that is not on
// this thread contributes nothing rather than reaching for one.
function escalationAnswerAgentIds(m, liveIds) {
  if (!liveIds || !liveIds.length) return [];
  const meta = m && m.metadata;
  const answer = meta && typeof meta === 'object' ? meta.escalationAnswer : null;
  if (!answer || typeof answer !== 'object') return [];
  const id = typeof answer.agentId === 'string' ? answer.agentId : '';
  if (!id || liveIds.indexOf(id) === -1) return [];
  return [id];
}

module.exports = { escalationAnswerAgentIds };
