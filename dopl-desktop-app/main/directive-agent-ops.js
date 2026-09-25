// The NON-LAUNCH directive kinds — end, rename, set_agent_mode — dispatched from
// `launch-directives.js › handle`. It implements no verb: each routes to the existing one
// (`agent-self-ops.js › endVerdict` + `session-engine.js › controlByTask`, `agent-identity-commit.js
// › commitRename`, `session-engine.js › setModeByTask`), so there is one stop path and one rename write.
// `end` and `rename` are NOT behind the launch toggle: a stop and a display-only rename widen nothing
// and spend no compute (the toggle gates compute). That is one `if` in `handle` if Samuel overrules it.
// The own-operator bound is free: `handle` re-checked the operator, and the registry holds only this
// machine's own sessions. Self-end cannot arise (the caller is an external session).

const { diag } = require('./diag');
const agentOps = require('./agent-self-ops');
const wire = require('./launch-directive-wire');

/**
 * End the agent a directive names → `{ done: true }` or `{ refused }`. The verdict table is
 * `endVerdict`'s, handed `''` as the caller id. `no-session` is the ordinary answer (it already
 * finished), and a `bad-agent-id` verdict maps to it rather than minting an unreachable word.
 */
function endAgent(d) {
  let rows = [];
  try {
    const engine = require('./session-engine');
    rows = typeof engine.listLiveSessions === 'function' ? engine.listLiveSessions() : [];
  } catch (_err) { rows = []; }

  const v = agentOps.endVerdict('', d.targetAgentId, rows);
  if (!v.ok) {
    diag('directive-agent-ops: end', String(d.targetAgentId || '(none)'),
      '— no live session (' + String(v.reason) + '), which is usually an agent that already finished');
    return { refused: 'no-session' };
  }

  let res = { ok: false };
  try {
    // Addressed from the RESOLVED registry row, never re-derived from wire fields.
    res = require('./session-engine').controlByTask({
      channelId: String(v.row.channelId || ''),
      taskId: String(v.row.taskId || ''),
      agentId: String(v.row.agentId || ''),
      action: 'end',
    }) || { ok: false };
  } catch (_err) { res = { ok: false }; }

  if (!res.ok) {
    diag('directive-agent-ops: end', String(v.row.agentId || ''),
      'REFUSED by the engine (' + String(res.reason || 'no-session') + ') — it settled mid-flight');
    return { refused: 'no-session' };
  }
  diag('directive-agent-ops: end', String(v.row.agentId || ''), 'ok');
  return { done: true };
}

/**
 * Rename the agent a directive names. Needs no live session (names are keyed by the instance id and
 * outlive parks and resumes). No self fallback: no usable target refuses. `bad-name` is the
 * sanitizer's REFUSAL (it never strips); `''` clears.
 */
function renameAgent(d) {
  if (!d.targetAgentId) {
    diag('directive-agent-ops: rename — directive carried no usable agent id');
    return { refused: 'no-session' };
  }
  // null means "not a rename": acting on it would wipe a name nobody asked to wipe.
  if (typeof d.targetName !== 'string') {
    diag('directive-agent-ops: rename', d.targetAgentId, '— directive carried no name at all');
    return { refused: 'bad-name' };
  }
  let res = { ok: false, reason: 'bad-name' };
  try {
    // Through the commit wrapper, which also refreshes the summary other members read.
    res = require('./agent-identity-commit').commitRename(d.targetAgentId, d.targetName);
  } catch (err) {
    diag('directive-agent-ops: rename', d.targetAgentId, '— store write threw:',
      (err && err.message) || String(err));
    return { refused: 'busy' };
  }
  if (!res.ok) {
    diag('directive-agent-ops: rename', d.targetAgentId, 'REFUSED by the sanitizer');
    return { refused: 'bad-name' };
  }
  diag('directive-agent-ops: rename', d.targetAgentId,
    res.name === null ? 'cleared' : 'set to "' + res.name + '"');
  return { done: true };
}

/**
 * Move a running agent's posture through `setModeByTask` with `pinned: true` (C2, ruling R4): the
 * engine validates in the SESSION's words, clamps to the channel's value for its runtime and floors
 * windowless messages, so a narrower ask sticks and nothing widens. Per agent, never per thread.
 * Nothing this build can apply (no axis, or a tool word the runtime lacks) is `no-bridge`, never a
 * `done` for a no-op. The echo is the engine's post-dispatch value; an untouched axis stays absent.
 */
function setAgentMode(d) {
  if (!d.targetAgentId) {
    diag('directive-agent-ops: set_agent_mode — directive carried no usable agent id');
    return { refused: 'no-session' };
  }
  if (!d.targetToolMode && !d.targetMessageMode) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId,
      '— no axis this build recognises; nothing applied');
    return { refused: 'no-bridge' };
  }

  let rows = [];
  try {
    const engine = require('./session-engine');
    rows = typeof engine.listLiveSessions === 'function' ? engine.listLiveSessions() : [];
  } catch (_err) { rows = []; }
  const row = rows.find((r) => r && String(r.agentId || '') === d.targetAgentId) || null;
  if (!row) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId, '— no live session');
    return { refused: 'no-session' };
  }
  const target = {
    channelId: String(row.channelId || ''),
    taskId: String(row.taskId || ''),
    agentId: String(row.agentId || ''),
  };

  // A level becomes the session runtime's tool mode (a containment value is spawn-time and does not
  // move live); a word that runtime does not offer is not applied (R3).
  const runtimeId = row.runtimeId || null;
  const tools = d.targetToolMode
    ? require('./runtime/permission-level').toolWordFor(require('./runtime').descriptorFor(runtimeId), d.targetToolMode)
    : '';
  if (d.targetToolMode && !tools) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId, '— tool mode', d.targetToolMode,
      'is not a level or a', runtimeId || 'default-runtime', 'word; the tool axis is left alone');
  }
  const messages = d.targetMessageMode;
  if (!tools && !messages) return { refused: 'no-bridge' };

  const out = { done: true };
  let applied = 0;
  try {
    const engine = require('./session-engine');
    for (const [axis, mode] of [['tools', tools], ['messages', messages]]) {
      if (!mode) continue;
      const r = engine.setModeByTask(Object.assign({ axis, mode, pinned: true }, target));
      if (!(r && r.ok)) continue;
      applied += 1;
      const now = axis === 'tools' ? r.tools : r.messages;
      out[axis === 'tools' ? 'appliedTools' : 'appliedMessages'] = typeof now === 'string' && now ? now : mode;
      if (r.clamped) {
        diag('directive-agent-ops: set_agent_mode', d.targetAgentId, 'CLAMPED to the channel posture —',
          axis, 'asked', mode, 'applied', String(now || '-'));
      }
    }
  } catch (err) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId, '— engine threw:',
      (err && err.message) || String(err));
    return { refused: 'busy' };
  }
  // The one race: the session settled between the lookup and the dispatch.
  if (!applied) {
    diag('directive-agent-ops: set_agent_mode', d.targetAgentId,
      'REFUSED by the engine — it settled mid-flight');
    return { refused: 'no-session' };
  }
  diag('directive-agent-ops: set_agent_mode', d.targetAgentId, 'ok —',
    (out.appliedTools || '-') + '/' + (out.appliedMessages || '-'));
  return out;
}

/** Dispatch a claimed non-launch directive; an unknown kind is still answered (a claimed row must be decided). */
function apply(d) {
  if (d.kind === wire.KIND_END) return endAgent(d);
  if (d.kind === wire.KIND_RENAME) return renameAgent(d);
  if (d.kind === wire.KIND_SET_MODE) return setAgentMode(d);
  diag('directive-agent-ops: unknown kind', String(d.kind || '(none)'), '— refusing rather than leaving it undecided');
  return { refused: 'no-bridge' };
}

module.exports = { apply, endAgent, renameAgent, setAgentMode };
