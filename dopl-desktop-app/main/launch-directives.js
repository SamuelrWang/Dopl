// The launch-directive WATCHER: an agent holding this operator's credential writes a
// `channel_launch_directives` row; this module sees it (realtime + a backstop poll), re-checks the
// owner, CLAIMS it (CAS), acts through the ordinary funnel or `directive-agent-ops.js`, and decides.
// The only path by which anything but a human click starts a session on this Mac.
// §6: a spawned session can read the credential that files MORE directives, so the arming switch
// (`channel-prefs.js › getOrchestratorLaunch`) is a LOCAL boolean, never server-writable — THE TOGGLE
// IS THE CONSENT — and the row is not the authorisation: the claim is. A directive never supplies a
// containment input (profile, posture ceiling, folder); those come from this machine's own state.
// `launch` and `set_agent_mode` need the toggle; `end` / `rename` widen nothing and do not.
// Idempotence: the server CAS is the guarantee; `decided` / `inflight` are the local belt.

const { apiFetch } = require('./api');
const realtime = require('./realtime');
const channelPrefs = require('./channel-prefs');
const wire = require('./launch-directive-wire');
const { diag } = require('./diag');

const HTTP_TIMEOUT_MS = 15000;

// The backstop covers a breaker AND a dropped frame (a healthy socket cannot say THIS row arrived),
// so it polls every armed workspace. 60s keeps it inside `LAUNCH_DIRECTIVE_TTL_MS` (120s); `unref`'d.
const POLL_MS = 60000;

// The local dedupe ledger is bounded, oldest evicted first (an eviction costs one refused CAS).
const MAX_REMEMBERED = 256;

let armed = false;
let deps = { getUserId: null, launch: null, watchedChannel: null, workspaces: null };
let pollTimer = null;
const decided = new Set(); // directive ids this process has already acted on
const inflight = new Set(); // …and the ones it is acting on right now

function remember(id) {
  if (decided.size >= MAX_REMEMBERED) decided.delete(decided.values().next().value);
  decided.add(id);
}

/** The launch consent, read at decision time and never cached. */
function launchEnabled() {
  try { return channelPrefs.getOrchestratorLaunch() === true; } catch (_err) { return false; }
}

// The two authenticated calls (claim / decide) live in `launch-directive-calls.js`.
const calls = require('./launch-directive-calls');
const { claim, decide } = calls;

/**
 * The one funnel. SILENT on every non-decision — lane off, not mine, already handled, not pending:
 * no server write, no per-row log; the row expires where the orchestrator sees it.
 */
async function handle(raw, workspaceId) {
  if (!armed) return;
  const d = wire.directiveFrom(raw, workspaceId);
  if (!d || d.status !== wire.STATUS_PENDING) return;
  if (wire.KINDS_NEEDING_LAUNCH_CONSENT.indexOf(d.kind) !== -1 && !launchEnabled()) return;
  // The realtime filter is workspace-wide, so the owner is re-checked here (the claim re-checks too).
  const me = (deps.getUserId && deps.getUserId()) || null;
  if (!me || d.operatorUserId !== me) return;
  if (decided.has(d.id) || inflight.has(d.id)) return;
  inflight.add(d.id);
  try {
    const claimed = await claim(d);
    if (!claimed) { remember(d.id); return; } // lost the race, or the row is gone
    // Remembered the moment it is ours, BEFORE the spawn: the poll can deliver the same row meanwhile.
    // Dispatch on the CLAIMED row (the authenticated answer), never the frame; every branch decides.
    remember(claimed.id);
    const outcome = claimed.kind === wire.KIND_LAUNCH
      ? await require('./launch-directive-spawn').spawn(claimed, deps)
      : require('./directive-agent-ops').apply(claimed);
    await decide(claimed, outcome);
  } catch (err) {
    // No decision on a throw: whether the spawn happened is unknown, so the row is left to expire.
    diag('launch-directive: handler threw —', (err && err.message) || String(err));
  } finally {
    inflight.delete(d.id);
  }
}

/** The realtime lane's entry (`realtime.js › onDirective`). */
function deliver(workspaceId, row) {
  void handle(row, workspaceId);
}

/** Workspaces logged as push-DOWN; the line is edge-triggered. */
const pollDegraded = new Set();

async function pollWorkspace(wsId) {
  try {
    const res = await apiFetch(wire.ROUTES.pending, {
      method: 'GET', workspaceId: wsId, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
    });
    if (!res || !res.ok) return;
    const body = await res.json().catch(() => null);
    const rows = (body && (body.directives || body.rows)) || [];
    if (!Array.isArray(rows)) return;
    for (const row of rows) await handle(row, wsId);
  } catch (_err) { /* the backstop is best-effort by construction */ }
}

async function poll() {
  if (!armed) return;
  const list = (deps.workspaces && deps.workspaces()) || [];
  for (const wsId of list) {
    const healthy = isHealthy(wsId);
    if (!healthy && !pollDegraded.has(wsId)) {
      pollDegraded.add(wsId);
      diag('launch-directives: push is DOWN for', wsId, '— the backstop poll IS the lane now');
    } else if (healthy && pollDegraded.has(wsId)) {
      pollDegraded.delete(wsId);
      diag('launch-directives: push recovered for', wsId, '— the poll is a reconcile again');
    }
    await pollWorkspace(wsId);
  }
}

/** An unreadable health signal reads as down (only the log line depends on it). */
function isHealthy(wsId) {
  try { return realtime.isWorkspaceHealthy(wsId) === true; } catch (_err) { return false; }
}

/**
 * Arm the watcher. A claimed-but-undecided row from a crash is left to expire: this process cannot
 * tell whether that spawn happened, and expiry is the only honest terminal state.
 */
function start(opts) {
  const o = opts || {};
  deps = {
    getUserId: typeof o.getUserId === 'function' ? o.getUserId : null,
    launch: typeof o.launch === 'function' ? o.launch : null,
    watchedChannel: typeof o.watchedChannel === 'function' ? o.watchedChannel : null,
    workspaces: typeof o.workspaces === 'function' ? o.workspaces : null,
  };
  if (!deps.launch || !deps.getUserId) {
    diag('launch-directives: NOT armed — no launch funnel or no identity');
    return;
  }
  armed = true;
  refresh();
  if (!pollTimer) {
    pollTimer = setInterval(() => { void poll(); }, POLL_MS);
    if (typeof pollTimer.unref === 'function') pollTimer.unref();
  }
  diag('launch-directives: armed — LAUNCH lane',
    launchEnabled() ? 'ENABLED by this operator' : 'off (default; end/rename still answer)');
}

/**
 * Re-bind realtime: a `postgres_changes` binding is fixed at JOIN, so every toggle flip must call this
 * (`channel-dir-ipc.js` does). Bound whenever armed — end/rename rows need no consent.
 */
function refresh() {
  try { realtime.setDirectives(armed, deliver); }
  catch (err) { diag('launch-directives: realtime arm failed —', err && err.message); }
}

function stop() {
  armed = false;
  pollDegraded.clear();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  decided.clear();
  inflight.clear();
  try { realtime.setDirectives(false, null); } catch (_err) { /* already down */ }
}

module.exports = {
  start,
  stop,
  refresh,
  deliver,
  handle,
  poll, // exported so the suite can drive the backstop tick
  POLL_MS,
  MAX_REMEMBERED,
};
