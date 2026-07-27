// Channels v1.2 — agent presence heartbeat.
//
// While the app is running AND signed in, POST /api/channels/presence every ~30s
// so the web app can show the operator's responding agent as "listening / online"
// (derived server-side as last_seen_at > now()-90s). This is a Node/HTTP
// heartbeat (NOT browser Realtime Presence — the desktop has no browser client).
//
// One heartbeat per workspace the listener is watching; the workspace set is
// pushed in from the listener's reconcile (setWorkspaces) so we do not duplicate
// its /api/workspaces call. Stops posting when signed out. Endpoint 404 (feature
// not deployed) → back off for a while and retry, so we never spin against a
// not-yet-shipped route. Cookie auth via the shared api helper; no tokens logged.

const { apiFetch } = require('./api');
const auth = require('./auth');
const { diag } = require('./diag');

const HEARTBEAT_MS = 30 * 1000;
const UNAVAILABLE_BACKOFF_MS = 5 * 60 * 1000; // when the endpoint 404s
const HTTP_TIMEOUT_MS = 12000;

let timer = null;
let workspaceIds = [];
let unavailableUntil = 0;
// L: one beat sends a serial request per workspace, each with a 12s timeout. A
// slow network makes a beat outlast the 30s tick, so ticks pile up and the same
// workspaces get hammered by overlapping loops. Skip a tick while one is in
// flight — a heartbeat has no value in duplicate.
let beating = false;

function setWorkspaces(ids) {
  workspaceIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
}

async function beat() {
  if (beating) {
    diag('presence: beat still in flight — skipping tick');
    return;
  }
  beating = true;
  try {
    await beatOnce();
  } finally {
    beating = false;
  }
}

async function beatOnce() {
  if (!auth.isSignedIn()) return; // stop on sign-out (no-op tick)
  if (Date.now() < unavailableUntil) return; // backing off a 404'd endpoint
  if (!workspaceIds.length) return; // nothing to heartbeat for yet
  for (const wsId of workspaceIds) {
    let res;
    try {
      res = await apiFetch('/api/channels/presence', {
        method: 'POST',
        workspaceId: wsId,
        body: { status: 'listening' },
        timeoutMs: HTTP_TIMEOUT_MS,
        noStore: true,
      });
    } catch (err) {
      diag('presence: beat error', err && err.message);
      continue;
    }
    if (res.status === 404) {
      unavailableUntil = Date.now() + UNAVAILABLE_BACKOFF_MS;
      diag('presence: endpoint 404 (not deployed) — backing off 5m');
      return;
    }
    if (res.status === 401) {
      diag('presence: 401 (session stale) — skipping this cycle');
      return;
    }
    if (!res.ok) diag('presence: beat failed', res.status, 'ws', String(wsId).slice(0, 8));
  }
}

function start() {
  if (timer) return;
  beat().catch(() => {});
  timer = setInterval(() => beat().catch(() => {}), HEARTBEAT_MS);
  if (timer.unref) timer.unref();
  diag('presence: started (30s heartbeat)');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  diag('presence: stopped');
}

module.exports = { start, stop, setWorkspaces };
