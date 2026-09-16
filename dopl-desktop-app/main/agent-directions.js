// THE PRIVATE DIRECT LANE — this machine's half (Samuel's ruling, 2026-08-31).
//
// An operator's own EXTERNAL agent files a `channel_agent_directions` row; this machine
// claims it, delivers the body into the named agent's PRIVATE TURN, and writes that turn's
// final text back as the reply. **The server delivers nothing and cannot** — agents live in
// this process — so the table is a MAILBOX, not a command, exactly as the launch lane's is.
//
// ── WHAT IS DIFFERENT FROM `launch-directives.js`, WHICH THIS OTHERWISE CLONES ────────────
//   1. **IT STARTS NO PROCESS.** A launch creates a `Bash`-holding child; a direction speaks
//      to one that already exists, inside its existing profile, posture, working folder and
//      hard-deny floor. Nothing here widens containment and nothing here could.
//   2. **IT INJECTS TEXT ANOTHER AGENT WROTE INTO A RUNNING TURN**, which is the threat this
//      lane has and the launch lane does not. The answer is `session-seed.js ›
//      frameDirectedTurn`: the body is FENCED AS DATA with its own preamble and never carries
//      operator authority. That ruling is load-bearing and is stated in that file.
//   3. **IT REPORTS AN ANSWER BACK.** `session-directed.js` owns the capture and the rule
//      bounding it — one turn's final text, nothing else from the private lane, ever.
//   4. **`agentId` IS REQUIRED AND THERE IS NO FALLBACK.** Resolving to "the oldest agent on
//      the thread" would steer one the orchestrator did not address, silently.
//
// ⚠ **THE CONSENT IS THE SAME SHAPE AND IS ITS OWN TOGGLE.** `channel-prefs.js ›
// getOrchestratorDirect`, machine-local, default OFF, read at DECISION TIME and never cached.
// It is a SECOND toggle rather than a reuse of the launch one because the two capabilities are
// different: launching buys COMPUTE, directing reaches a running agent's PRIVATE lane. An
// operator who wants one may not want the other, and a single flag cannot say so.
// ⚠ **OFF MEANS REFUSED, AND IT USED TO MEAN SILENT** (Samuel's ruling, 2026-09-16). The
// original rule here read: *"OFF MEANS SILENT. No claim, no decide, no diag per row — the row
// expires and the orchestrator sees that. A refusal from a machine that has not opted in would
// itself admit the machine is listening."* **That argument is retired, and the reason it was
// wrong on THIS lane is the whole of why it cost fifteen days.**
//
// Concealment is worth something only where a STRANGER can probe. Nobody can probe here:
// `operator_user_id` is `ctx.userId` and is never a parameter — no schema in
// `schema-direction.ts` has such a field and none may ever get one
// (`service-directions.ts`'s header states it as the whole authorization story) — so **the only
// party who can file a direction against this machine is the operator themselves.** There was
// never a third party to hide from. What the silence actually concealed was the operator's own
// misconfiguration, from the operator.
//
// ⚠ **THE COST IS ON RECORD: 38 of 38 directions filed between 2026-08-31 and 2026-09-15
// expired unclaimed**, because the consent this lane reads had no UI and so was never written
// (`DIRECTION-DROP-TRACE.md`). Every one of them read `pending, claimed=no` to its sender and
// named no cause. A lane that drops silently is how that ran for fifteen days without anyone
// being able to see it.
//
// SO: a direction arriving at a machine whose operator has not armed the lane is CLAIMED and
// REFUSED `blocked`, which the MCP surface renders as the operator having declined and points
// at the switch. ⚠ Refusing costs the sender one round trip instead of a ten-minute expiry, and
// `blocked` carries `retry=no` — correct, since asking again changes nothing until a human
// flips the control.

const { apiFetch } = require('./api');
const realtime = require('./realtime');
const channelPrefs = require('./channel-prefs');
const wire = require('./agent-direction-wire');
const directionRate = require('./direction-rate'); // 2026-08-31: the per-target inbound rate bound (F-374's loop, now same-machine)
const { diag } = require('./diag');

const HTTP_TIMEOUT_MS = 15000;
const POLL_MS = 60000;
const MAX_REMEMBERED = 256;

let armed = false;
let deps = { getUserId: null, direct: null, workspaces: null };
let pollTimer = null;
const decided = new Set();
const inflight = new Set();
let pollUnavailable = false;

/** The standing consent, read at decision time. ⚠ An unreadable store is not a grant. */
function enabled() {
  try {
    return channelPrefs.getOrchestratorDirect() === true;
  } catch (_err) {
    return false;
  }
}

/** Re-arm the realtime binding after a toggle flip. ⚠ The ONLY thing that touches realtime. */
function refresh() {
  try {
    realtime.setDirections(armed && enabled(), deliver);
  } catch (err) {
    diag('agent-directions: realtime arm failed —', err && err.message);
  }
}

/**
 * ARM THE LANE.
 *
 * ⚠ `direct` IS THE DELIVERY FUNNEL AND IS MANDATORY — `session-reopen.js › messageByTask`,
 * the SAME op the operator's own composer uses. It is passed in rather than required here for
 * the launch lane's reason (the funnel cannot require this module back), and reusing it rather
 * than writing a second dispatch is the whole of ruling R1: one resolution, one `steer`, one
 * private-turn open, one set of lifecycle bugs.
 */
function start(opts) {
  const o = opts || {};
  deps = {
    getUserId: typeof o.getUserId === 'function' ? o.getUserId : null,
    direct: typeof o.direct === 'function' ? o.direct : null,
    workspaces: typeof o.workspaces === 'function' ? o.workspaces : null,
  };
  if (!deps.direct || !deps.getUserId) {
    diag('agent-directions: NOT armed — no delivery funnel or no identity');
    return;
  }
  armed = true;
  refresh();
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      void poll();
    }, POLL_MS);
    if (typeof pollTimer.unref === 'function') pollTimer.unref();
  }
  diag(
    'agent-directions: armed —',
    enabled() ? 'lane ENABLED by this operator' : 'lane off (default)'
  );
}

function stop() {
  armed = false;
  pollUnavailable = false; // a new run may reach a newer server
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  decided.clear();
  inflight.clear();
  try {
    realtime.setDirections(false, null);
  } catch (_err) {
    /* best effort */
  }
}

/** Realtime entry. Fire-and-forget; `onDirection` already try/catches it. */
function deliver(workspaceId, row) {
  void handle(row, workspaceId);
}

function remember(id) {
  if (decided.size >= MAX_REMEMBERED) decided.delete(decided.values().next().value);
  decided.add(id);
}

/** Never throws. `status: 0` means network/abort. */
async function post(workspaceId, path, payload) {
  try {
    const res = await apiFetch(path, {
      method: 'POST',
      workspaceId,
      body: payload,
      timeoutMs: HTTP_TIMEOUT_MS,
      noStore: true,
    });
    if (!res || !res.ok) return { ok: false, status: (res && res.status) || 0 };
    let parsed = null;
    try {
      parsed = await res.json();
    } catch (_err) {
      parsed = null;
    }
    return { ok: true, body: parsed || {} };
  } catch (err) {
    return { ok: false, status: 0, error: (err && err.message) || 'network error' };
  }
}

/**
 * THE POLL BACKSTOP — for workspaces whose push is unhealthy, AND for every workspace when the
 * lane is OFF.
 *
 * ⚠ **WHEN THE LANE IS OFF THIS IS THE ONLY WAY A ROW IS EVER SEEN, WHICH IS WHY THE REFUSAL
 * RIDES HERE AND NOT ON REALTIME.** `refresh()` binds `realtime.setDirections(armed &&
 * enabled())`, so an un-armed machine has NO `postgres_changes` binding on
 * `channel_agent_directions` at all — it cannot be woken by an INSERT and therefore cannot
 * refuse one. Arming the binding to refuse would break the invariant
 * `realtime-mailboxes.js` states in as many words — *"a machine that never opts in names no
 * table on the wire"* — so it is NOT armed, and the HTTP backstop (a route this machine already
 * calls, naming no table) carries the refusal instead.
 *
 * ⚠ THE PRICE IS LATENCY AND IT IS THE RIGHT TRADE: up to `POLL_MS` to answer, against a
 * ten-minute silent expiry. A sender holding with `wait_ms` usually still collects it.
 *
 * ⚠ **AN OFF LANE POLLS EVERY WORKSPACE, NOT ONLY THE UNHEALTHY ONES.** `isWorkspaceHealthy`
 * answers whether PUSH is working, which is irrelevant when nothing is subscribed — skipping a
 * "healthy" workspace while off would skip the only pass that will ever see its rows.
 */
async function poll() {
  if (!armed || pollUnavailable) return;
  const off = !enabled();
  const list = (deps.workspaces && deps.workspaces()) || [];
  for (const wsId of list) {
    if (!off && realtime.isWorkspaceHealthy(wsId)) continue;
    await pollWorkspace(wsId);
  }
}

async function pollWorkspace(wsId) {
  try {
    const res = await apiFetch(wire.ROUTES.pending, {
      method: 'GET',
      workspaceId: wsId,
      timeoutMs: HTTP_TIMEOUT_MS,
      noStore: true,
    });
    if (res && res.status === 404) {
      // ⚠ AN OLDER DEPLOYMENT, not a gap to file (INVARIANTS §13). One line, once.
      pollUnavailable = true;
      diag('agent-directions: no backstop route on this deployment — push only');
      return;
    }
    if (!res || !res.ok) return;
    let parsed = null;
    try {
      parsed = await res.json();
    } catch (_err) {
      parsed = null;
    }
    const rows = (parsed && (parsed.directions || parsed.rows)) || [];
    if (!Array.isArray(rows)) return;
    for (const row of rows) await handle(row, wsId);
  } catch (_err) {
    /* best-effort by construction */
  }
}

/**
 * THE ONE FUNNEL. Gate order, and gates 1-4 are SILENT by design.
 *
 * ⚠ **THE OPERATOR'S CONSENT IS NO LONGER GATE 1 — IT IS A DECISION AFTER THE CLAIM**
 * (Samuel, 2026-09-16). It sat here, and a machine that had not armed the lane returned before
 * touching the row, so the sender got a ten-minute expiry naming no cause. It now sits beside
 * the rate bound below, for the identical reason that one is placed there: **AFTER the claim so
 * the caller gets an ANSWER rather than an expiry, and BEFORE any delivery so no turn is
 * started.** The file header carries why the old silence was wrong on this lane specifically.
 *
 * ⚠ **`armed` STAYS A SILENT RETURN AND IS A DIFFERENT FACT.** It means this MODULE is not
 * running — no identity, no delivery funnel, `stop()` called — so there is nothing to answer
 * *with* and no credential to answer *through*. An un-armed module refusing rows would be a
 * process claiming it can speak for a machine that is not listening.
 *
 * 🔒 **GATE 3 IS THE LOCAL OWNER RE-CHECK AND IT IS NOT REDUNDANT.** The realtime filter is
 * `workspace_id=eq.<id>` — WORKSPACE-WIDE, not operator-scoped — so a raw frame for another
 * member's direction reaches this handler under a subscription rather than under a per-row
 * auth answer. The server's SELECT policy and the claim CAS both fence on `operator_user_id`
 * as well; this is the belt that keeps a foreign row from ever reaching the claim at all.
 * ⚠ **IT IS LOAD-BEARING TWICE OVER NOW THAT AN OFF LANE ACTS**: it is what stops this machine
 * refusing another member's direction on their behalf.
 */
async function handle(raw, workspaceId) {
  if (!armed) return; // 1. this module is running at all — see the docblock on why consent left
  const d = wire.directionFrom(raw, workspaceId);
  if (!d || d.status !== wire.STATUS_PENDING) return; // 2. narrow + pending only
  const me = (deps.getUserId && deps.getUserId()) || null;
  if (!me || d.operatorUserId !== me) return; // 3. LOCAL owner re-check
  if (decided.has(d.id) || inflight.has(d.id)) return; // 4. local dedupe
  inflight.add(d.id);
  try {
    const claimed = await claim(d);
    if (!claimed) {
      remember(d.id);
      return;
    }
    // ⚠ REMEMBERED BEFORE THE DELIVERY, deliberately: a crash mid-delivery must not let a
    // later frame re-deliver the same words into the same agent.
    remember(claimed.id);
    // ── ⚠ THE OPERATOR'S STANDING CONSENT, DECIDED RATHER THAN OBEYED IN SILENCE (2026-09-16) ──
    // Read HERE, at decision time and never cached, exactly as it was when it was gate 1 — an
    // operator may withdraw the grant while a row is in flight and the next one must see it.
    // ⚠ `blocked` IS THE EXISTING CLOSED-VOCABULARY WORD FOR "the operator declined"
    // (`channel-doctrine.ts`), so this mints no sixth word — which would have been a schema
    // change in both trees plus a column CHECK, for a fact one of the five already states.
    // ⚠ NOT `no-bridge`: the doctrine pins that one to the LAUNCH toggle, and two settings
    // answering with one word is how a reader comes to flip the wrong control.
    // ⚠ THE ROW IS CLAIMED FIRST AND THAT IS DELIBERATE — the claim CAS is what makes exactly
    // one machine answer when the operator runs two Macs, both of them un-armed.
    if (!enabled()) {
      diag('agent-direction: the direct lane is not armed on this machine — refusing',
        String(claimed.id).slice(0, 8), '(Settings › Agents › Direct agents)');
      await decide(claimed, { refused: 'blocked' });
      return;
    }
    // ── ⚠ THE INBOUND RATE BOUND (2026-08-31, Samuel's same-owner directions ruling; F-374) ──
    // AFTER the claim so the caller gets an ANSWER rather than a ten-minute expiry, and BEFORE
    // the delivery so no turn is started. `busy` is the existing word and its existing sentence
    // ("declined FOR NOW … ask again in a minute or two, once, and stop if it refuses the same
    // way twice") is exactly what a looping agent needs to read. `direction-rate.js` carries why
    // the bound is a RATE at the DELIVERY end and not a depth anywhere.
    if (!directionRate.admit(claimed.agentId)) {
      diag('agent-direction: over the inbound rate bound', String(claimed.agentId || '').slice(0, 8));
      await decide(claimed, { refused: 'busy' });
      return;
    }
    const outcome = await deliverTo(claimed);
    // ⚠ `null` MEANS THE DELIVERY IS STILL RUNNING and the ENGINE will report when the turn
    // ends — see `deliverTo`. Writing a terminal here would race the real answer.
    if (outcome) await decide(claimed, outcome);
  } catch (err) {
    diag('agent-direction: handler threw —', (err && err.message) || String(err));
    // NO decision written on a throw, deliberately: the row lazy-expires, which is the honest
    // terminal state for an outcome nobody observed.
  } finally {
    inflight.delete(d.id);
  }
}

/** THE CLAIM CAS. `null` = stand down; never retried. */
async function claim(d) {
  const res = await post(d.workspaceId, wire.ROUTES.claim, wire.claimBody(d.id));
  if (!res.ok) {
    if (res.status === 409 || res.status === 404) {
      diag('agent-direction: claim lost —', String(d.id).slice(0, 8));
    } else {
      diag('agent-direction: claim failed —', String(d.id).slice(0, 8), 'row stays pending');
    }
    return null;
  }
  const body = res.body || {};
  const granted = body.direction || (body.ok === undefined && body.id ? body : null);
  if (!granted || body.ok === false) {
    diag('agent-direction: claim lost —', String(d.id).slice(0, 8));
    return null;
  }
  return wire.directionFrom(granted, d.workspaceId);
}

/**
 * DELIVER into the named agent's private turn.
 *
 * ⚠ **IT CALLS THE SAME `messageByTask` THE OPERATOR'S OWN COMPOSER CALLS** — ruling R1, and
 * the repo's own discipline: no new reducer branch, no second wake path, no second way to
 * start a turn. What the `directed` argument changes inside that op is the FRAMING (fenced
 * data, not operator authority) and the CAPTURE; the resolution, the private-turn open and
 * the dispatch are byte-identical.
 *
 * ⚠ **A SUCCESSFUL DISPATCH RETURNS `null`, NOT AN OUTCOME.** The answer is a TURN, which
 * ends later; `session-engine.js` writes the terminal when the directed capture closes.
 * Returning a `delivered` here would report an answer before the agent had given one.
 */
async function deliverTo(d) {
  const res = await deps.direct({
    channelId: d.channelId,
    taskId: d.taskId,
    agentId: d.agentId,
    text: d.body,
    // ⚠ THE WHOLE OF WHAT MAKES THIS A DIRECTION RATHER THAN AN OPERATOR MESSAGE.
    // ⚠ `operatorUserId` RIDES THE DIRECTION so `messageByTask` can prove the TARGET SESSION
    // belongs to the same operator — the registry outlives a sign-out (2026-08-31 review).
    // ⚠ `senderAgentId` RIDES ALONG AS A CAPTION ONLY (F-376a, 2026-08-31) — the narration
    // entry needs it so the operator can tell WHICH of their agents spoke. It is beside
    // `operatorUserId` and is nothing like it: that one is compared and FENCES the delivery,
    // this one is printed. `session-directed.js › readDirected` deliberately does not check it.
    directed: { id: d.id, workspaceId: d.workspaceId, operatorUserId: d.operatorUserId,
      senderAgentId: d.senderAgentId || null },
  });
  if (res && res.ok) return null; // the engine reports when the turn ends
  return { refused: wire.refusalFor(res && res.reason) };
}

/** Write the terminal outcome. Best-effort, no retry, no throw. */
async function decide(d, outcome) {
  const payload = wire.decideBody(d.id, outcome);
  const res = await post(d.workspaceId, wire.ROUTES.decide, payload);
  diag(
    'agent-direction',
    String(d.id).slice(0, 8),
    payload.status,
    payload.refusalReason ? `(${payload.refusalReason})` : '',
    res.ok ? '' : '— DECISION NOT RECORDED, the orchestrator will see it expire'
  );
}

/**
 * THE ENGINE'S REPORT — a directed turn ended, here is its final text.
 *
 * ⚠ **CALLED FROM `session-engine.js`'s ONE DISPATCH FUNNEL**, not from this module's own
 * flow, because the answer arrives on a different timeline from the claim. It is the only
 * entry point that writes a `delivered`.
 * ⚠ `reply` MAY BE EMPTY and the key is then OMITTED — `null` on the wire means NOT
 * REPORTED, never "the agent said nothing" (`agent-direction-wire.js › decideBody`).
 */
async function reportDelivered(capture) {
  const c = capture || {};
  if (!c.id || !c.workspaceId) return;
  await decide(
    { id: c.id, workspaceId: c.workspaceId },
    { delivered: true, reply: c.reply }
  );
}

module.exports = {
  start,
  stop,
  refresh, // the toggle moved: rebind realtime
  deliver, // main/realtime.js's handler
  handle, // the one funnel — exported for the suite
  // ⚠ EXPORTED FOR THE SUITE ONLY, on `handle`'s terms. It matters more than a backstop
  // normally would: while the lane is OFF there is no realtime binding, so this sweep is the
  // ONLY thing that can ever see a row to refuse it (2026-09-16). A change that quietly made it
  // skip workspaces again would restore the silent drop with every other test still green.
  poll,
  reportDelivered, // session-engine.js's terminal write
  POLL_MS,
  MAX_REMEMBERED,
};
