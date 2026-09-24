// The first turn waits for Dopl's MCP server: a turn started while it is still `starting` is built without
// Dopl's tools, so the agent's first `tool_search` finds nothing.

const mcp = require('./mcp');

const STARTUP_METHOD = 'mcpServer/startupStatus/updated';
const LIST_METHOD = 'mcpServerStatus/list';
// Codex reports `failed` itself at `startup_timeout_sec`; this bound covers a server that never reports.
const READY_WAIT_MS = (mcp.STARTUP_TIMEOUT_SEC + 1) * 1000;
const SETTLED = Object.freeze(['ready', 'failed', 'cancelled']);
// `mcpServerStatus/list`'s `runtimeStatus` in the notification's words; anything else is still starting.
const LISTED = Object.freeze({
  connected: 'ready', failed: 'failed', cancelled: 'cancelled', authenticationRequired: 'failed',
});

/** Is Dopl's server in the thread config this launch sends? (Absent when there was no token.) */
function doplConfigured(threadStart) {
  const servers = threadStart && threadStart.config && threadStart.config.mcp_servers;
  return !!(servers && typeof servers === 'object' && servers[mcp.SERVER_KEY]);
}

/**
 * `observe(msg)` sees every notification from connect on; `wait(conn, threadId)` resolves once with
 * `{ status, failureReason, error, waitedMs, source }`; `release(status)` ends a pending wait early.
 * `status` is a startup state, or `timeout` / `none` / a release reason.
 */
function makeReadyWait(configured, opts) {
  const waitMs = (opts && opts.waitMs) || READY_WAIT_MS;
  let seen = null;
  let pending = null;
  let released = null;

  const settledSeen = () => !!(seen && SETTLED.indexOf(seen.status) !== -1);

  function finish(status, source) {
    if (!pending) return;
    const p = pending; pending = null;
    clearTimeout(p.timer);
    const s = seen || {};
    p.resolve({
      status,
      failureReason: s.failureReason || null,
      error: s.error || null,
      waitedMs: Date.now() - p.at,
      source,
    });
  }

  function note(status, detail, source) {
    if (typeof status !== 'string' || !status) return;
    // A late `starting` never overwrites a settled answer.
    if (settledSeen() && SETTLED.indexOf(status) === -1) return;
    seen = { status, failureReason: detail.failureReason || null, error: detail.error || null };
    if (settledSeen()) finish(status, source);
  }

  function observe(msg) {
    if (!msg || msg.method !== STARTUP_METHOD) return;
    const p = (msg.params && typeof msg.params === 'object') ? msg.params : {};
    if (p.name !== mcp.SERVER_KEY) return;
    note(p.status, p, 'notification');
  }

  function askList(conn, threadId) {
    Promise.resolve()
      .then(() => conn.request(LIST_METHOD, { threadId: threadId || null, detail: 'toolsAndAuthOnly' }))
      .then((res) => {
        const rows = res && Array.isArray(res.data) ? res.data : [];
        const row = rows.find((r) => r && r.name === mcp.SERVER_KEY);
        if (!row) return;
        note(LISTED[row.runtimeStatus], {
          failureReason: row.runtimeStatus === 'authenticationRequired' ? 'reauthenticationRequired' : null,
          error: row.toolsError || null,
        }, 'list');
      })
      .catch(() => { /* the notification or the bound still settles the wait */ });
  }

  function wait(conn, threadId) {
    const at = Date.now();
    const now = (status, source) => Promise.resolve({
      status, failureReason: (seen && seen.failureReason) || null, error: (seen && seen.error) || null,
      waitedMs: 0, source,
    });
    if (released) return now(released, 'released');
    if (!configured) return now('none', 'none');
    if (settledSeen()) return now(seen.status, 'already');
    if (pending) return pending.promise;
    let resolve = null;
    const promise = new Promise((r) => { resolve = r; });
    const timer = setTimeout(() => finish(settledSeen() ? seen.status : 'timeout', 'bound'), waitMs);
    if (typeof timer.unref === 'function') timer.unref();
    pending = { resolve, promise, timer, at };
    // No status yet (a CLI that sent none, or a resume): ask once.
    if (!seen) askList(conn, threadId);
    return promise;
  }

  function release(status) {
    released = released || status || 'released';
    finish(released, 'released');
  }

  return { observe, wait, release, isWaiting: () => !!pending };
}

/** The outcomes that leave the turn without Dopl's tools, and so earn a line in the lane. */
function missedTools(outcome) {
  const s = outcome && outcome.status;
  return s === 'failed' || s === 'cancelled' || s === 'timeout';
}

module.exports = {
  makeReadyWait, doplConfigured, missedTools,
  READY_WAIT_MS, STARTUP_METHOD, LIST_METHOD,
};
