// THE PERSISTED "WORKSPACES THIS MACHINE HAS ROWS IN" RECORD — `session-state-push.js`'s memory
// of where it has written, kept beside the listener's cursors in electron-store.
//
// ⚠ MOVED OUT OF `session-state-push.js` ON 2026-09-14 (F-698), at the 500-line cap and on a real
// seam: this is what the writer REMEMBERS across runs, where that file is what it SENDS. Same
// factory shape as `session-state-push-wire.js › makeWireFilter` and for the same reason — the
// writer's suites evaluate its block with an injected `store` and `diag`, so the record takes both
// as arguments and the harness hands in the REAL module.
//
// ⚠ KEYED BY OPERATOR (`{ userId: [workspaceId, …] }`), because a ROW is. A machine-wide list
// would make the next operator to sign in clear a workspace they may not be a member of, and
// would forget that the PREVIOUS operator still has rows there — the one thing this remembers.
// Empty entries are dropped, so it is bounded by accounts that signed in on this Mac.
//
// FOR ONE CASE: a run that starts with no sessions in a workspace a previous run left rows in.
// Without it those rows stand claiming `working` for a process that is gone.

function makeReportedRecord(store, diag, key) {
  function reportedRecord() {
    let raw = null;
    try { raw = store.get(key); } catch (_err) { return {}; }
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function reportedWorkspaces(userId) {
    const list = reportedRecord()[String(userId || '')];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];
  }

  function rememberWorkspace(userId, workspaceId, hasRows) {
    const record = reportedRecord();
    const next = new Set(reportedWorkspaces(userId));
    if (hasRows) next.add(workspaceId);
    else next.delete(workspaceId);
    if (next.size > 0) record[String(userId)] = [...next];
    else delete record[String(userId)];
    try { store.set(key, record); } catch (err) {
      diag('session-state push: could not persist the reported-workspace set —', err && err.message);
    }
  }

  return { reportedWorkspaces, rememberWorkspace };
}

module.exports = { makeReportedRecord };
