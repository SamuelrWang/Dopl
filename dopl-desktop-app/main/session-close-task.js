// The channel-task status flip a session performs when the operator closes the thread.
//
// SPLIT NOTE (§2 refactor, Q6): extracted verbatim from session-engine.js — the engine sat
// at 499/500 and Q6 needed room for the credential preflight + the in-window sign-in hold.
// This is the ONLY thing the engine used `api.js` for, so the engine now holds no HTTP
// dependency at all; the effect case still reads `closeTask(s, outcome, summary)` and the
// behaviour (PATCH op:"close", diag on failure, no-op without a task id) is unchanged.
//
// The lifecycle ECHO (task_finished / task_failed into the channel) is a separate act and
// still belongs to the engine's runLifecycle -> session-window.onEnded.

const { apiFetch } = require('./api');
const { diag } = require('./diag');

// The DB status flip for a first-class task (op:"close"). No-op when there is no task id.
async function closeTask(s, outcome, summary) {
  if (!s || !s.taskId) return;
  try {
    const res = await apiFetch(`/api/channels/${s.channelId}/tasks/${encodeURIComponent(s.taskId)}`, {
      method: 'PATCH',
      workspaceId: s.workspaceId,
      body: { op: 'close', outcome, summary },
      timeoutMs: 15000,
    });
    diag('session-engine: close_task', res.ok ? 'ok' : `failed ${res.status}`);
  } catch (err) { diag('session-engine: close_task error', err && err.message); }
}

module.exports = { closeTask };
