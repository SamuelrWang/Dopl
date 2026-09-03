// THE LAUNCH-DIRECTIVE WATCHER — an ORCHESTRATOR asks, this machine decides, and the local
// toggle is the decision (2026-08-22, Samuel's launch-over-MCP ruling).
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────────────────
//
// An agent holding this operator's own Dopl credential writes a row into
// `channel_launch_directives` saying "start an agent on this channel with this goal". This
// module watches for those rows, CLAIMS one, spawns the session through the ordinary funnel, and
// writes back what happened. It is the only path by which anything other than a human click
// starts a session on this Mac.
//
// ⚠ AND **LAUNCHING** IS OFF UNLESS THE OPERATOR TURNED IT ON, PER MACHINE. `channel-prefs.js ›
// getOrchestratorLaunch` defaults FALSE and is reachable from exactly one `appWindowOnly` IPC
// pair — no route, no MCP op, no column. **THE TOGGLE IS THE CONSENT**, and Samuel ruled it as
// the replacement for "the click IS that human" on this lane: there is no click at directive
// time, so the operator's standing local decision has to be the human, and a consent a program
// can grant itself is not one.
//
// ── ⚠ THE MAILBOX CARRIES THREE VERBS SINCE 2026-09-01, AND ONLY ONE IS BEHIND THAT TOGGLE ──
// Samuel's external end/rename ruling. `end_agent` / `rename_agent` existed only INSIDE a spawned
// session (`agent-self-ops.js`), so an EXTERNAL agent holding this operator's credential could
// start agents and never stop, label or re-posture them. They ride this lane as non-launch KINDS
// (`end`, `rename`, and `set_agent_mode` since the 2026-09-01 agent-efficiency wave), dispatched
// to `directive-agent-ops.js`, which routes to the SAME paths the in-process verbs use. **`end`
// and `rename` ARE NOT GATED BY THE LAUNCH TOGGLE and `set_agent_mode` IS** — that module's
// header carries the argument (a STOP verb and a DISPLAY verb widen nothing; a POSTURE grants,
// and the toggle gates LOCAL COMPUTE BEING SPENT) and names it as the assumption most worth
// overruling. TWO LINES HERE implement it: the `KINDS_NEEDING_LAUNCH_CONSENT` test in `handle`,
// and `refresh` binding realtime on `armed`. ⚠ THE §6 THREAT MODEL BELOW IS UNCHANGED AND STILL
// GOVERNS EVERY GATED KIND — the two free ones cannot spawn, widen a profile or reach a
// credential, which is precisely why they sit outside it.
//
// ── ⚠ THE §6 THREAT THIS SHAPE IS BUILT AROUND ───────────────────────────────────────────
//
// A spawned session runs on this Mac as this user, under the channel's tool profile — which
// under `bypass` pre-approves `Bash` — and this operator's device token is on disk. So the agent
// this lane creates can read the credential that would let it write MORE directives. That is not
// hypothetical containment theatre; it is the ordinary shape of the thing.
//
// EVERYTHING BELOW FOLLOWS FROM IT:
//   • THE ARMING SWITCH IS NOT ON THE SERVER. If it were, an agent holding the operator's own
//     credential could arm every machine the operator owns, and the lane would be
//     self-authorizing. It is a local `electron-store` boolean, by ruling.
//   • THE DIRECTIVE SUPPLIES **GOAL**, **MODEL** AND **WHICH TEMPLATE**, AND NOTHING ELSE. Not
//     the permission axes, not the tool profile, not the working folder. Those come from the
//     operator's own durable per-channel record and from main's own watched-channel DTO — the
//     same two sources the Launch button reads. **A directive-driven agent is exactly as
//     contained as a button-driven one**, and nothing an orchestrator writes can widen it.
//     ⚠ **A TEMPLATE WIDENS PROMPT CONTENT ONLY. It never supplies, influences, or relaxes a
//     containment input — tool profile, permission axes, working folder and delivery lane are
//     still the machine's, resolved from the machine's own state.** INVARIANTS §5A's sentence,
//     enforced by `spawn`'s ORDER: the profile is computed from `watchedChannel` BEFORE any
//     template text exists. ⚠ AND THE DIRECTIVE CARRIES AN **ID**, NEVER CONTENT — resolved here
//     under THIS OPERATOR's credential, so one they cannot see is refused (`no-template`).
//   • THE ROW IS NOT THE AUTHORIZATION. The realtime frame is a prompt, not a permit: this
//     module CLAIMS over an authenticated route before it acts on a single field. See below.
//
// ── ⚠ THE REALTIME FILTER IS WORKSPACE-WIDE, AND RLS IS NOT THE SAME FENCE ───────────────
//
// The binding is `workspace_id=eq.<id>` (`realtime.js › addChannel`), matching the
// `channel_messages` one beside it. RLS makes the SELECT owner-only, so a frame for a
// colleague's directive should not reach this client — but "should not" is a policy on a table
// this desktop does not own, evaluated by a service this desktop does not run, and the frame
// filter itself does not encode the operator at all. So `operatorUserId` is re-checked LOCALLY
// against the live identity before anything happens, and the claim re-checks it server-side
// anyway. Two fences, because the cost of the outer one being wrong is another member's
// orchestrator steering this machine.
// ⚠ AND THE POLLED HALF NEEDS THE SAME FIELD — F-284: the server DTO omitted it, so every row
// `pollWorkspace` fetched failed this re-check. `service-launch.ts › toDirective` carries it now.
//
// ── HOW A DIRECTIVE IS ACTED ON ──────────────────────────────────────────────────────────
//
//   1. ARRIVE   a realtime INSERT frame, or the 60s backstop poll when push is down.
//   2. IGNORE   toggle off -> silently, with no server write at all. ⚠ THE SILENCE IS THE
//               DESIGN: the row expires server-side, which the orchestrator SEES, and that beats
//               a refusal — a refusal from a machine that has not opted in is an admission that
//               the machine is listening.
//   3. MINE?    `operatorUserId` against the live identity. Not mine -> silent, as above.
//   4. CLAIM    a CAS on the server row. ⚠ LOSING IS A NORMAL NO-OP, NOT AN ERROR: the operator
//               may have four machines watching the same workspace and exactly one of them
//               should launch. Whoever loses stops, quietly.
//   5. RESOLVE  the TEMPLATE, if one was named — this operator's credential, this machine's call.
//               404 -> `no-template`; timeout/5xx -> `busy`; a NULLED id beside a live NAME is a
//               DELETION and refuses without asking (E-4).
//   6. LAUNCH   through `session-engine.launchRequesterSession`, the same funnel the button uses.
//               WITH a goal it RUNS; without one it registers a spawn-idle shell (see `spawn`).
//   7. DECIDE   `launched` + the agent id, or `refused` + one of the seven words. Exactly one of
//               them, always — see `launch-directive-wire.js › decideBody`.
//
// ⚠ IDEMPOTENCE IS BELT AND BRACES. The server CAS is the real guarantee; `decided` below is the
// local belt — a realtime frame and a backstop poll can deliver the same row within milliseconds
// of each other, and the claim is a network round-trip wide.
//
// The wire shapes and the route paths live in `launch-directive-wire.js`, which states which of
// them are the OTHER lane's contract and which are this tree's own vocabulary.

const { apiFetch } = require('./api');
const realtime = require('./realtime');
const channelPrefs = require('./channel-prefs');
const wire = require('./launch-directive-wire');
const { diag } = require('./diag');
// ⚠ `channel-runtime`, `session-model` AND `launch-posture` LEFT THIS LIST ON 2026-09-01 WITH
// `spawn` — they are the SESSION's inputs (which runtime, which model, which posture), and this
// module no longer builds a session. `channel-prefs` stays because the WATCHER still reads the
// machine-wide consent toggle off it.

const HTTP_TIMEOUT_MS = 15000;

// ⚠ THE BACKSTOP IS FOR THE BREAKER, NOT FOR CORRECTNESS. When realtime is healthy this poll
// does nothing at all — it checks `isWorkspaceHealthy` first and returns. It exists because a
// directive is a REQUEST somebody is waiting on, and `realtime.js`'s breaker holds a long
// cooldown by design: without this, arming the lane and then flapping the WS would leave an
// orchestrator waiting for the row's whole expiry window with no signal.
// ⚠ 60s IS DELIBERATELY SLOW. The push path is the normal one and is near-instant; polling this
// degraded one faster would spend steady-state request budget on an already-broken case.
// `unref`'d, so it never holds a quit open.
const POLL_MS = 60000;

// The local dedupe ledger. ⚠ BOUNDED, oldest evicted first by insertion order — the idiom
// `session-windowless.js › MAX_NOTIFIED_DENIALS` and `trigger-outcomes.js › MAX_REMEMBERED_ENDS`
// use. An unbounded Set keyed by a server-minted id leaks for the life of the process, and an
// eviction costs at worst one extra CAS the server refuses.
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

/**
 * THE STANDING CONSENT **FOR THE LAUNCH KIND**, read at DECISION TIME and never cached. The
 * operator may turn the lane off while a directive is in flight, and the next one must see that
 * immediately.
 *
 * ⚠ **IT GATES `wire.KINDS_NEEDING_LAUNCH_CONSENT` AND NOTHING ELSE SINCE 2026-09-01** (Samuel's
 * external end/rename ruling; `set_agent_mode` joined the gated side on the agent-efficiency
 * wave). It used to gate the whole watcher, correct while the mailbox carried one verb; it now
 * carries four, two of which widen nothing — `directive-agent-ops.js`'s header says why gating
 * those here would leave an operator able to have agents started for them and unable to stop them.
 * ⚠ **THE TOGGLE-OFF PATH IS THEREFORE NO LONGER "THE WATCHER IS ASLEEP".** `refresh` binds
 * realtime whenever the watcher is armed, so an unarmed-for-launch machine still SEES directives
 * and still answers `no-bridge` to a launch. That is a widening of what this process READS (its
 * own operator's own rows, over an authenticated subscription it already holds for
 * `channel_messages`) and of nothing it DOES: `handle` refuses every launch just as before.
 */
function launchEnabled() {
  try { return channelPrefs.getOrchestratorLaunch() === true; } catch (_err) { return false; }
}

// ⚠ **THE TWO AUTHENTICATED CALLS MOVED TO `main/launch-directive-calls.js` ON 2026-08-31**, at
// the §1 cap and on a real seam: they change when the SERVER's contract moves (the routes, the
// claim envelope, which status means "another machine won"), where everything left in this file
// changes when the LOCAL policy does. `post` is no longer re-exported — it had no caller outside
// the two verbs built on it, and re-exporting a raw POST from the module that owns the §6 argument
// would be handing the next reader a door beside the gate.
const calls = require('./launch-directive-calls');
const { claim, decide } = calls;

// ── The launch ───────────────────────────────────────────────────────────────────────────

// ⚠ **`spawn` AND ITS CONTAINMENT ARGUMENT MOVED TO `main/launch-directive-spawn.js` ON
// 2026-09-01 (T24)**, at the §1 cap this file was sitting exactly on and on a real seam: this
// module decides whether to ACT on a row, that one builds the session. The §6 threat model
// above still governs both, and the field-by-field statement of where every containment input
// comes from lives with the code that reads them. Required lazily at the call site for the
// reason every other lazy require here has: it reaches `channel-prefs.js`, which opens an
// electron-store on load, and this module is required at arm time.

// ── The one entry point every source funnels into ────────────────────────────────────────

/**
 * ⚠ SILENT ON EVERY REFUSAL THAT IS NOT A DECISION. Toggle off, not mine, already handled,
 * not pending — none of these writes to the server, and none of them logs per occurrence. The
 * row expires and the orchestrator reads that; this machine says nothing about a request it was
 * never entitled to answer.
 */
async function handle(raw, workspaceId) {
  if (!armed) return;
  const d = wire.directiveFrom(raw, workspaceId);
  if (!d || d.status !== wire.STATUS_PENDING) return;
  // ⚠ **THE CONSENT GATE IS PER-KIND SINCE 2026-09-01, AND THE SET IS DATA**
  // (`wire.KINDS_NEEDING_LAUNCH_CONSENT`) rather than a `||` chain a fifth kind could be admitted
  // past by whichever reader nobody updated. A LAUNCH and a `set_agent_mode` both spend this
  // operator's compute on their hardware — Axis A at `bypass` PRE-APPROVES work tools, the one
  // thing the toggle exists for — and stay behind it silently, the row expiring where the
  // orchestrator reads it. An `end` STOPS and a `rename` RELABELS: see this file's header.
  if (wire.KINDS_NEEDING_LAUNCH_CONSENT.indexOf(d.kind) !== -1 && !launchEnabled()) return;
  const me = (deps.getUserId && deps.getUserId()) || null;
  // ⚠ THE LOCAL OWNER RE-CHECK. The realtime filter is workspace-wide — see the header.
  if (!me || d.operatorUserId !== me) return;
  if (decided.has(d.id) || inflight.has(d.id)) return;
  inflight.add(d.id);
  try {
    const claimed = await claim(d);
    if (!claimed) { remember(d.id); return; } // lost the race, or the row is gone
    // ⚠ REMEMBERED THE MOMENT IT IS OURS, BEFORE THE SPAWN. `launch` awaits `getSdk()`, which is
    // wide enough for the backstop poll to deliver the same row again — and the second pass
    // would find the row `claimed` rather than `pending` and stop, but only if the server got
    // there first. This does not depend on that.
    remember(claimed.id);
    // ⚠ DISPATCH ON THE **CLAIMED** ROW'S KIND, NEVER THE FRAME'S. `claim` re-narrows from the
    // CAS's own answer, which is the authenticated one; if the two disagree, the granted row is
    // what this machine was actually given. Same rule the goal, the model and the template
    // already follow.
    // ⚠ EVERY BRANCH ANSWERS. A claimed directive nobody decides is the one outcome the
    // orchestrator cannot act on — see `apply`'s fallthrough.
    const outcome = claimed.kind === wire.KIND_LAUNCH
      ? await require('./launch-directive-spawn').spawn(claimed, deps)
      : require('./directive-agent-ops').apply(claimed);
    await decide(claimed, outcome);
  } catch (err) {
    diag('launch-directive: handler threw —', (err && err.message) || String(err));
    // ⚠ NO DECISION IS WRITTEN ON A THROW, DELIBERATELY. This machine does not know whether the
    // spawn happened, and `refused` would be a claim it cannot support; letting the row expire
    // is the honest answer and is what `sweep` reasons about on the next start.
  } finally {
    inflight.delete(d.id);
  }
}

/** The realtime lane's entry (`main/realtime.js › onDirective`). */
function deliver(workspaceId, row) {
  void handle(row, workspaceId);
}

// ── The breaker-open backstop ────────────────────────────────────────────────────────────

// ⚠ THE READ EXISTS — F-273 IS CLOSED (measured 2026-08-23). `ROUTES.pending` resolves to
// `src/app/api/channels/launch-directives/route.ts › handleGet`, an authed collection GET over
// `service-launch.ts › listPendingLaunchDirectives` answering `{ directives }` and fenced on
// `operator_user_id`. This is a working recovery path, not a stub.
// ⚠ THE 404 SELF-DISABLE STAYS, AND NOT AS A LEFTOVER: it is the OLDER-DEPLOYMENT degradation
// (INVARIANTS §13 — an older peer is supported). Such a server still 404s, and standing down
// after the first is still right — one dead request per run instead of one per minute, visible
// in `listener.log`. Against it realtime is the only path and a missed directive expires, which
// the orchestrator already handles (a closed laptop produces it too).
let pollUnavailable = false;

async function pollWorkspace(wsId) {
  try {
    const res = await apiFetch(wire.ROUTES.pending, {
      method: 'GET', workspaceId: wsId, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
    });
    if (res && res.status === 404 && !pollUnavailable) {
      pollUnavailable = true;
      // ⚠ NOT A FILED GAP — an OLDER SERVER. Worded as the deployment fact it is, so an operator
      // reading `listener.log` is not sent to a finding that closed on 2026-08-22.
      diag('launch-directives: this server has no pending-directives read (it predates it) —',
        'the backstop is disabled for this run; realtime is the only path, and a miss expires');
    }
    if (!res || !res.ok) return;
    const body = await res.json().catch(() => null);
    const rows = (body && (body.directives || body.rows)) || [];
    if (!Array.isArray(rows)) return;
    for (const row of rows) await handle(row, wsId);
  } catch (_err) { /* the backstop is best-effort by construction */ }
}

async function poll() {
  // ⚠ NO LONGER GATED ON THE LAUNCH TOGGLE (2026-09-01). The backstop's job is to deliver rows
  // the breaker made realtime miss, and two of the three kinds are answerable with the toggle
  // off — a poll that stood down would make the recovery path the one place an end silently
  // expires. `handle` still refuses every launch, per kind.
  if (!armed || pollUnavailable) return;
  const list = (deps.workspaces && deps.workspaces()) || [];
  for (const wsId of list) {
    // ⚠ ONLY WHILE PUSH IS DOWN FOR **THIS** WORKSPACE. A healthy sub already delivers these,
    // and polling beside it would double every claim attempt for no benefit.
    if (realtime.isWorkspaceHealthy(wsId)) continue;
    await pollWorkspace(wsId);
  }
}

// ── Arming ───────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ CRASH SAFETY — A CLAIMED-BUT-UNDECIDED DIRECTIVE IS LEFT TO LAZY-EXPIRE. THE CHOICE, STATED.
 *
 * The alternative was to re-read claimed rows on start and decide them. REJECTED, because this
 * process cannot tell the two cases apart: a directive claimed at 09:00:01 and crashed at
 * 09:00:02 may have spawned an agent that died with the process, or may have spawned nothing.
 * `refused` would be a claim this machine cannot support and `launched` would name an agent that
 * does not exist. **An expiry is the only honest terminal state for an outcome nobody observed**,
 * and the orchestrator already handles expiry — it is the toggle-off path's normal answer.
 * ⚠ AND IT COSTS NOTHING TO SAFETY. A claimed row is not `pending`, so no machine re-actions it;
 * the worst case is one orchestrator request that times out instead of being refused promptly.
 * ⚠ WHAT WOULD CHANGE THE ANSWER: a directive carrying the agent id it expected, or a session
 * record durable enough to answer "did this spawn survive". Neither exists, and inventing one for
 * this is a bigger change than the lane.
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
 * Re-read the toggle and tell realtime what to bind. ⚠ CALLED AFTER EVERY FLIP, because the
 * binding is decided at JOIN time and cannot be added to a live channel — `realtime.js ›
 * setDirectives` rejoins for exactly that reason. Idempotent, so a caller may assert its intent
 * whenever it likes.
 */
function refresh() {
  // ⚠ **BOUND WHENEVER ARMED, NOT WHENEVER THE LAUNCH TOGGLE IS ON (2026-09-01).** It read
  // `armed && enabled()` while the mailbox carried one verb, and that was the same condition.
  // It is not any more: with the toggle off this machine must still SEE `end` / `rename` rows,
  // or the two verbs that need no consent would be reachable only on machines that had granted
  // the consent they do not need — the exact inversion the ruling exists to remove.
  // ⚠ WHAT THIS WIDENS IS A **READ**, AND ONLY OF THIS OPERATOR'S OWN ROWS: one more
  // `postgres_changes` binding on a subscription this process already holds for
  // `channel_messages`, filtered to a workspace it is already signed into, over rows whose RLS
  // SELECT is `operator_user_id = auth.uid()`. It widens nothing this machine DOES — `handle`
  // refuses every launch exactly as before.
  try { realtime.setDirectives(armed, deliver); }
  catch (err) { diag('launch-directives: realtime arm failed —', err && err.message); }
}

function stop() {
  armed = false;
  pollUnavailable = false; // a new run may reach a newer server
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  decided.clear();
  inflight.clear();
  try { realtime.setDirectives(false, null); } catch (_err) { /* already down */ }
}

module.exports = {
  start,
  stop,
  refresh, // the toggle moved: rebind realtime
  deliver, // main/realtime.js's handler
  handle, // the one funnel — exported for the suite
  POLL_MS,
  MAX_REMEMBERED,
};
