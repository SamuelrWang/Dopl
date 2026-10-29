// OFF-SCOPE ADDRESSEES (2026-10-29, Thread Mention Reach Fix step 2; KB Audits/Thread Mention
// Reach Audit + Fix).
//
// ⚠ THE SERVER RESOLVES `to=` CHANNEL-WIDE; THIS MACHINE USED TO FEED THREAD-SCOPED, AND THE
// ADDRESSEE FELL BETWEEN THEM. `session-dispatch.js › feedLiveSession` builds its roster from
// `liveOnThread`, so an agent named in `to=` but working ANOTHER scope (the main room, or another
// thread) was intersected away in `serverAddressed` and never handed a turn. This answers the one
// question that closes the gap: which of the agents the server NAMED are live in this channel but
// NOT on the post's own scope.
//
// ⚠ ONLY THE SERVER'S ANSWER, NEVER A BODY PARSE. A non-array `recipientAgentIds` is "not resolved
// there" and widens nothing: the fallback stays thread-scoped (ruling 4), so prose can never reach
// across scopes. And only the ADDRESSED widen: CONTEXT (an unaddressed post) stays on its thread.
// ⚠ PURE. No electron, no registry handle: the caller passes both rosters.
function offScopeAddressees(m, onThread, inChannel) {
  const ids = m && m.recipientAgentIds;
  if (!Array.isArray(ids) || !ids.length || !Array.isArray(inChannel)) return [];
  const here = new Set((onThread || []).map((s) => String((s && s.key) || '')));
  const hereIds = new Set((onThread || []).map((s) => String((s && s.agentId) || '')));
  const want = new Set(ids.map((id) => String(id || '')).filter(Boolean));
  const out = [];
  for (const s of inChannel) {
    if (!s || s.settled) continue;
    const id = String(s.agentId || '');
    if (!want.has(id) || hereIds.has(id) || here.has(String(s.key || ''))) continue;
    if (out.some((o) => String(o.agentId || '') === id)) continue;
    out.push(s);
  }
  return out;
}

module.exports = { offScopeAddressees };
