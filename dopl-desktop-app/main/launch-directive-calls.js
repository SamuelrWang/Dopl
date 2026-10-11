// THE DIRECTIVE ENDPOINTS — the two authenticated calls this machine makes about a
// `channel_launch_directives` row, and nothing about what it does with one.
//
// ⚠ **SPLIT OUT OF `launch-directives.js` ON 2026-08-31**, at the §1 cap and on a REASON rather
// than the count that forced it. That file sat at EXACTLY 500 — the state its own neighbours'
// headers name as the point a file stops being CORRECTABLE — so the runtime-adapter port could
// not add a five-line comment to it. This file changes when the SERVER's contract moves: the
// routes, the claim envelope, which HTTP status means "another machine won". `launch-directives.js`
// changes when the LOCAL policy does: what is armed, what is polled, what a directive is allowed
// to spawn, and every §6 argument about why the consent is machine-local.
//
// ⚠ BOTH RIDE `api.js`, which carries the shared 401 repair (`api-repair.js` — a second copy of
// that repair produced the 1.8.x Channels outage) and the app-version stamp. Never a raw fetch.
//
// ⚠ NEITHER CALL DECIDES ANYTHING, and that is the seam being honest rather than a coincidence.
// `claim` answers a narrowed row or `null`; `decide` writes a terminal status and answers nothing
// at all. Every refusal word, every §6 gate and every spawn argument stayed on the other side.

const { apiFetch } = require('./api');
const wire = require('./launch-directive-wire');
const { diag } = require('./diag');

// ⚠ THE SAME BOUND THE WATCHER USES, DECLARED HERE BECAUSE THIS IS WHERE THE CALL IS MADE. It is
// deliberately NOT imported back from `launch-directives.js`: that would make the module this one
// split out of a dependency of the split, which is how a cycle gets built one honest line at a time.
const HTTP_TIMEOUT_MS = 15000;

async function post(workspaceId, path, body) {
  try {
    const res = await apiFetch(path, {
      method: 'POST', workspaceId, body, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
    });
    if (!res || !res.ok) return { ok: false, status: (res && res.status) || 0 };
    let parsed = null;
    try { parsed = await res.json(); } catch (_err) { parsed = null; }
    return { ok: true, body: parsed || {} };
  } catch (err) {
    return { ok: false, status: 0, error: (err && err.message) || 'network error' };
  }
}

/**
 * THE CAS. Returns the claimed directive, or null.
 *
 * ⚠ NULL IS THE ORDINARY ANSWER AND CARRIES NO ALARM. Another of this operator's machines won
 * the race; the row expired; the orchestrator withdrew it. None of those is a failure of this
 * machine and none of them produces a decision — the winner will write one.
 * ⚠ AND A CLAIM THAT FAILS ON THE NETWORK IS ALSO A NO-OP, deliberately: an unclaimed directive
 * is still `pending`, so it expires visibly. Retrying would be this machine competing with itself.
 */
async function claim(d) {
  const res = await post(d.workspaceId, wire.ROUTES.claim, wire.claimBody(d.id));
  if (!res.ok) {
    // ⚠ **409 IS THE DESIGNED OUTCOME FOR EVERY MACHINE BUT ONE, NOT AN ERROR** (F-286).
    // `service-launch.ts › claimLaunchDirective` throws `LaunchDirectiveNotClaimableError` when
    // the CAS matches no row — taken, decided, or expired — which `http-mapping.ts` maps to 409.
    // So on the ORDINARY multi-machine path (header step 4) the loser lands here, and telling it
    // "the row stays pending" asserts the opposite of the truth: the row is CLAIMED and another
    // machine is launching it. 404 is the same kind of answer. Only network faults and 5xx leave
    // the row genuinely pending.
    if (res.status === 409 || res.status === 404) {
      diag('launch-directive: claim lost', String(d.id).slice(0, 8),
        `— HTTP ${res.status}, another machine won or the row is gone (a normal no-op)`);
      return null;
    }
    diag('launch-directive: claim failed', String(d.id).slice(0, 8),
      res.status ? `HTTP ${res.status}` : res.error || 'network', '— the row stays pending and expires');
    return null;
  }
  // ⚠ THREE ENVELOPE SHAPES ACCEPTED, DELIBERATELY. The route answers `{ directive }` today (the
  // suite pins that against `claim/route.ts`); the generosity predates it landing and is kept,
  // because `{directive}`, `{ok, directive}` and the bare row all mean the same thing — the
  // discriminator is whether a claimable ROW came back, not which envelope carried it. ⚠ IT
  // WIDENS NOTHING: authorization already happened server-side, and `directiveFrom` narrows.
  const body = res.body || {};
  const granted = body.directive || (body.ok === undefined && body.id ? body : null);
  if (!granted || body.ok === false) {
    diag('launch-directive: claim lost', String(d.id).slice(0, 8),
      '—', String(body.reason || 'another machine won'), '(a normal no-op)');
    return null;
  }
  // ⚠ RE-NARROWED FROM THE CLAIM'S OWN ANSWER, not carried over from the realtime frame. The
  // frame is a prompt; the CLAIMED row is what was granted, and if they disagree the
  // authenticated one wins.
  return wire.directiveFrom(granted, d.workspaceId);
}

/**
 * THE TERMINAL WRITE, AND IT IS NOT BEST-EFFORT ANY MORE.
 *
 * ⚠ IT USED TO BE, AND THE COMMENT THAT SAID SO WAS WRONG IN THE WORST DIRECTION. It read "a lost
 * decision costs the orchestrator a wait, not a wrong action", which is true of a REFUSAL and
 * false of a LAUNCH: when the status is `launched` the agent is ALREADY RUNNING, holding this
 * channel's pre-approved access, and the row stays `claimed` and reads `expired` forever. The
 * launcher then believes nothing started while an agent works unwatched. That is not a wait; it is
 * two parties with opposite pictures of the same machine. Observed 2026-10-11T09:23:34Z:
 * `launch-directive 3edc3195 launched agent jqxz7mr9 — DECISION NOT RECORDED`, and jqxz7mr9 was
 * live for hours afterwards against a row that said nobody had decided anything.
 *
 * So: BOUNDED RETRY WITH BACKOFF, and an honest answer. ⚠ SAFE TO RETRY BY CONSTRUCTION — the
 * route CASes on `pending`/`claimed` (`service-launch.ts`: "a retried decide is a 409, never an
 * overwrite"), so a second attempt after a response we never saw cannot overwrite a landed one.
 * A 409 therefore means ALREADY DECIDED and is success, not a reason to try again.
 *
 * ⚠ 4xx IS NOT RETRIED. A rejected body will be rejected identically three times; only network
 * faults, timeouts and 5xx can improve. (429 is the exception the claim path does not have to
 * make, because this write is one per directive, not one per row seen.)
 *
 * @returns {Promise<boolean>} whether the decision is RECORDED — true also for a 409.
 */
async function decide(d, outcome) {
  const body = wire.decideBody(d.id, outcome);
  const label = String(d.id).slice(0, 8);
  const what = body.agentId ? `agent ${body.agentId}` : `(${body.refusalReason})`;
  for (let attempt = 1; attempt <= DECIDE_ATTEMPTS; attempt += 1) {
    const res = await post(d.workspaceId, wire.ROUTES.decide, body);
    if (res.ok) {
      diag('launch-directive', label, body.status, what, attempt > 1 ? `(recorded on attempt ${attempt})` : '');
      return true;
    }
    if (res.status === 409) {
      diag('launch-directive', label, body.status, what,
        '— already decided (HTTP 409); the record stands, nothing to retry');
      return true;
    }
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    if (permanent) {
      diag('launch-directive', label, 'decide REFUSED', `HTTP ${res.status}`, what,
        '— a 4xx will not improve on retry, so this is final');
      return false;
    }
    diag('launch-directive', label, 'decide failed',
      res.status ? `HTTP ${res.status}` : res.error || 'network', `attempt ${attempt}/${DECIDE_ATTEMPTS}`);
    if (attempt < DECIDE_ATTEMPTS) await sleep(DECIDE_BACKOFF_MS * 2 ** (attempt - 1));
  }
  diag('launch-directive', label, 'DECISION NOT RECORDED after', String(DECIDE_ATTEMPTS),
    'attempts —', what, 'and the row will read expired');
  return false;
}

/** Three tries over ~1.5s: long enough to cross a transport blip, short enough to stay inside the
 *  120s TTL with the spawn already paid for. Same shape as `channel-post.js › postWithRetry`. */
const DECIDE_ATTEMPTS = 3;
const DECIDE_BACKOFF_MS = 500;
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

module.exports = { post, claim, decide, HTTP_TIMEOUT_MS, DECIDE_ATTEMPTS, DECIDE_BACKOFF_MS };
