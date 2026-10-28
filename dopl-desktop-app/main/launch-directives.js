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

// The backstop covers a breaker AND a dropped frame (a healthy socket cannot say THIS row arrived),
// so it polls every armed workspace. 60s keeps it inside `LAUNCH_DIRECTIVE_TTL_MS` (120s); `unref`'d.
const POLL_MS = 60000;

// The local dedupe ledger is bounded, oldest evicted first (an eviction costs one refused CAS).
const MAX_REMEMBERED = 256;

let armed = false;
let deps = { getUserId: null, launch: null, watchedChannel: null, channelForLaunch: null, workspaces: null };
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
const { claim, decide, HTTP_TIMEOUT_MS } = calls;

/**
 * ⚠ A NON-DECISION IS NOW LOGGED WITH ITS REASON, AND THE HEADER ABOVE USED TO PROMISE OTHERWISE.
 * It said the funnel was "SILENT on every non-decision … the row expires where the orchestrator
 * sees it". The second half is false and was the whole of #3201: nothing writes `expired` (239
 * prod rows, ZERO of them expired), the status is only ever computed at read time, and the MCP
 * launch op gives up on its 30s hold 90 seconds before a 120s TTL can elapse — so the launcher is
 * told `pending retry=no` about a row that is already dead and is never told again. Two rows died
 * that way (18b15b76 "Credit Card Fix", accdb17f "Tool Gate Probe"): `pending`, never claimed, no
 * trace on either side.
 *
 * This still does not WRITE on a non-decision, and must not: the claim is the authorisation, and a
 * machine that declined to act has no standing to write a verdict another machine may be about to
 * earn (§6). What it does now is SAY WHY, locally, with the row id — so the next person reading
 * this log can tell "the lane is off" from "another Mac won" from "the claim 500'd", which were
 * previously one silence. `lane-off`, the one code the OPERATOR can act on, also raises their
 * banner (via `tellOperator`); the rest, `claim-lost` included, are ordinary and stay quiet.
 */
function declined(d, code, detail) {
  diag('launch-directive: NOT acted on', String((d && d.id) || '?').slice(0, 8),
    '—', code, detail ? `(${detail})` : '');
}

/**
 * A directive dying for a reason that is the OPERATOR's to fix, as opposed to ordinary racing:
 * today only `lane-off` (they filed a launch and this Mac's arming switch is off, so nothing will
 * ever take it). Reuses `decision_failed` — locked on, sounds, bounces the dock, and its own registry note reads
 * "the operator believes they answered and they did not", which is this fact exactly.
 */
function tellOperator(title, body) {
  try { require('./notification-route').raise('decision_failed', { title, body, silent: false, attention: true }); }
  catch (err) { diag('launch-directive: operator notice failed —', (err && err.message) || 'error'); }
}

/** The one funnel. Every exit is coded; only a decision writes to the server. */
async function handle(raw, workspaceId) {
  if (!armed) return;
  const d = wire.directiveFrom(raw, workspaceId);
  if (!d) return;
  if (d.status !== wire.STATUS_PENDING) return; // already taken or decided: not ours to report
  if (wire.KINDS_NEEDING_LAUNCH_CONSENT.indexOf(d.kind) !== -1 && !launchEnabled()) {
    declined(d, 'lane-off', `kind ${d.kind} needs the launch toggle`);
    // ⚠ ONCE PER ROW, not once per delivery: realtime and the backstop poll both deliver it.
    if (!decided.has(d.id)) {
      remember(d.id);
      tellOperator('A launch could not start',
        'An agent asked this Mac to start one and the launch lane is off for it. Nothing will take the request, and it expires in two minutes.');
    }
    return;
  }
  // The realtime filter is workspace-wide, so the owner is re-checked here (the claim re-checks too).
  const me = (deps.getUserId && deps.getUserId()) || null;
  if (!me) { declined(d, 'no-identity', 'this machine has not resolved its operator yet'); return; }
  if (d.operatorUserId !== me) return; // another operator's row on a shared workspace: ordinary
  if (decided.has(d.id) || inflight.has(d.id)) return; // our own duplicate delivery: ordinary
  inflight.add(d.id);
  try {
    const claimed = await claim(d);
    if (!claimed) {
      // ⚠ TWO VERY DIFFERENT FACTS WEAR ONE `null` HERE, and `claim` has already logged which:
      // 409/404 is another machine winning (ordinary), while a network fault or 5xx leaves the row
      // genuinely pending with nobody coming. Only the second is the operator's.
      declined(d, 'claim-lost', 'see the claim line above for which');
      remember(d.id);
      return;
    }
    // Remembered the moment it is ours, BEFORE the spawn: the poll can deliver the same row meanwhile.
    // Dispatch on the CLAIMED row (the authenticated answer), never the frame; every branch decides.
    remember(claimed.id);
    const outcome = claimed.kind === wire.KIND_LAUNCH
      ? await require('./launch-directive-spawn').spawn(claimed, deps)
      : require('./directive-agent-ops').apply(claimed);
    const recorded = await decide(claimed, outcome);
    if (!recorded) await reportLostDecision(claimed, outcome);
  } catch (err) {
    // No decision on a throw: whether the spawn happened is unknown, so the row is left to expire.
    declined(d, 'handler-threw', (err && err.message) || String(err));
  } finally {
    inflight.delete(d.id);
  }
}

/**
 * THE ORPHAN. The decide write is lost after the spawn already happened, so the launcher's picture
 * ("nothing started") and this machine's ("an agent is running") disagree, and the row will read
 * `expired` forever. `decide` has exhausted its retries by the time we get here.
 *
 * An agent WITH an id is the dangerous half and gets a channel post naming it, because the fix is
 * to address that agent rather than relaunch the work — relaunching is how one task gets two
 * agents. A refusal that failed to record is only a lost wait, so it stays local.
 *
 * ⚠ THE POST IS THE SAME UNADDRESSED, NON-TRIGGERING SHAPE AS A DROP NOTICE (`postDropNotice`),
 * for the reason recorded there: an addressed agent-authored post would spawn a session on a
 * peer's machine. Never throws — the agent is already running and nothing here may unwind that.
 */
async function reportLostDecision(d, outcome) {
  const agentId = outcome && outcome.agentId;
  try {
    if (!agentId) {
      tellOperator('A launch answer was not saved',
        'This Mac declined an agent request and could not record the answer. The asker will see it expire instead.');
      return;
    }
    tellOperator('An agent is running unrecorded',
      `Agent ${agentId} started on this Mac, but the answer could not be saved. Whoever asked believes nothing started.`);
    const name = (outcome && outcome.appliedAgentName) || '';
    const text = `${name ? name + ' ' : ''}@agent-${agentId} IS RUNNING on this machine, but the launch answer could not be saved, so the request will read as expired. Address this agent rather than asking again: a second request starts a second agent on the same work.`;
    const posted = await require('./channel-post').postDropNotice(
      { channel: { id: d.channelId }, workspaceId: d.workspaceId },
      text,
      { clientMsgId: `lost-decision-${d.id}`, summary: `Agent ${agentId} is running but its launch was not recorded` },
    );
    diag('launch-directive: lost-decision notice', posted ? 'posted' : 'POST FAILED TOO', agentId);
  } catch (err) {
    diag('launch-directive: lost-decision report threw —', (err && err.message) || 'error');
  }
}

/** The realtime lane's entry (`realtime.js › onDirective`). */
function deliver(workspaceId, row) {
  void handle(row, workspaceId);
}

/** Workspaces logged as push-DOWN; the line is edge-triggered. */
const pollDegraded = new Set();

// ⚠ THE BACKSTOP'S TIMING (2026-10-11, measured: KB codebase-cleanup sectors/D08 §Backlog). Done
// serially, one slow GET (15s timeout) delayed every later workspace: with 21 armed, the 9th GET
// started at 120s = `LAUNCH_DIRECTIVE_TTL_MS`, so a dropped frame there could expire unseen. So the
// GETs run at most POLL_CONCURRENCY at once; `handle()` still runs one row at a time, in workspace
// order then row order, exactly as before (a spawn is never raced against another spawn).
const POLL_CONCURRENCY = 4;

/** Workspaces whose last read FAULTED; the line is edge-triggered, like `pollDegraded`. */
const pollFaulted = new Set();

/**
 * One workspace's pending rows. A refusal or an unreadable body is [] — the backstop is
 * best-effort by construction — but a REJECTION is left to the caller: `worker()` is the one
 * place that turns a thrown read into [], so the slot it owns always settles (see there).
 */
async function fetchPending(wsId) {
  const res = await apiFetch(wire.ROUTES.pending, {
    method: 'GET', workspaceId: wsId, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
  });
  if (!res || !res.ok) return [];
  const body = await res.json().catch(() => null);
  const rows = (body && (body.directives || body.rows)) || [];
  return Array.isArray(rows) ? rows : [];
}

/**
 * One promise per workspace, in list order; at most `limit` GETs in flight at once.
 *
 * ⚠ **EVERY SLOT SETTLES, OR THE WHOLE LANE STOPS** (Review 26). `runPass` awaits the slots in
 * order and `poll()` is single-flight, so ONE unsettled slot is not one missed workspace: the pass
 * never finishes, `passInFlight` never clears, and every 60s tick from then on joins the dead pass.
 * The lane that is supposed to cover a realtime outage would go quiet permanently, with nothing in
 * the log and no error — and this is the lane that has to work when push does not. So the read is
 * wrapped HERE rather than inside `fetchPending`: one catch, at the only place that owns a slot,
 * and `void worker()` can never leave an unhandled rejection either.
 */
function fetchAllBounded(list, limit) {
  const slots = list.map(() => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; });
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      const wsId = list[i];
      let rows = [];
      try {
        rows = await fetchPending(wsId);
        if (pollFaulted.delete(wsId)) diag('launch-directives: backstop read recovered for', wsId);
      } catch (err) {
        // Edge-triggered, like the push-DOWN line: a workspace that is failing every minute
        // must not bury the log one line a tick.
        if (!pollFaulted.has(wsId)) {
          pollFaulted.add(wsId);
          diag('launch-directives: backstop read FAULTED for', wsId, '—', (err && err.message) || err);
        }
        rows = [];
      }
      slots[i].resolve(rows);
    }
  }
  for (let k = 0; k < Math.min(limit, list.length); k++) void worker();
  return slots.map((x) => x.p);
}

async function runPass() {
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
  }
  const pending = fetchAllBounded(list, POLL_CONCURRENCY);
  for (let i = 0; i < list.length; i++) {
    const rows = await pending[i];
    // As before: a throw stops THIS workspace's remaining rows, never the pass.
    try { for (const row of rows) await handle(row, list[i]); } catch (_err) { /* best-effort */ }
  }
}

// SINGLE-FLIGHT: a tick that lands while a pass is still running joins it instead of starting a
// second one (the interval is 60s; a slow pass used to overlap the next tick).
let passInFlight = null;

function poll() {
  if (!armed) return Promise.resolve();
  if (passInFlight) return passInFlight;
  const pass = runPass().finally(() => { if (passInFlight === pass) passInFlight = null; });
  passInFlight = pass;
  return pass;
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
    channelForLaunch: typeof o.channelForLaunch === 'function' ? o.channelForLaunch : null,
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
  pollFaulted.clear();
  passInFlight = null; // a stale pass never answers the next start's poll
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
  reportLostDecision, // exported so the suite can drive the orphan path without a real spawn
  POLL_MS,
  MAX_REMEMBERED,
};
