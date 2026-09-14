// THE AGENT-WINDOW OPEN OP’S BODY — §2 SPLIT out of `session-ipc-ops.js` (2026-09-14, the
// 500-line cap), on `session-launch-op.js` / `session-delete-op.js`’s precedent: the IPC SURFACE
// (op name, `appWindowOnly` wrapper, the `channelId` UUID gate) STAYS at the registration site,
// and only what happens after it moves here. Byte-unchanged, refusal shapes included.
//
// ⚠ `asAgentId` IS IMPORTED FROM THE REGISTRAR, NEVER RESPELLED — that coercion is the third
// coordinate of every agent op and a second copy is how the two come to disagree. Lazily, so
// the cycle never runs at load: the registrar reaches this file the same way.

const { diag } = require('./diag');

function openAgentWindow(p) {
  const asAgentId = require('./session-ipc-ops').asAgentId;
  const { isSafeSegment } = require('./deep-link-target');
  // ⚠ A CHANNEL-LEVEL AGENT HAS NO THREAD (2026-08-21), so an EMPTY `taskId` is legitimate
  // here — but only when an agent id names the target instead. A payload naming neither is
  // asking for a window onto nothing and is refused in the same `{ok:false}` shape as
  // everything else. A NON-empty taskId still passes the ONE character rule.
  const agentId = asAgentId(p.agentId);
  const taskId = p.taskId == null ? '' : String(p.taskId);
  if (!isSafeSegment(p.segment)) return { ok: false };
  if (taskId ? !isSafeSegment(taskId) : !agentId) return { ok: false };
  try {
    if (require('./version-gate').isBlocked()) {
      diag('session ipc: refused sessions:openAgentWindow — the version floor is blocking');
      return { ok: false };
    }
  } catch (_err) { /* mid-wave / harness: no gate is not a block */ }
  return require('./agent-window').openAgentWindow({
    segment: p.segment,
    channelId: p.channelId,
    taskId,
    // ⚠ ONE WINDOW PER AGENT since 2026-08-21: without this, opening the second agent on a
    // thread silently FRONTED the first one's window.
    agentId,
  });
}

module.exports = { openAgentWindow };
