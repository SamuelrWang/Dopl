// THE ACTIONABLE HALF OF THE NOTIFICATION ROUTE — the handle map a toast answers through, and
// the raise path for events that carry an affirmative button.
//
// ⚠ SPLIT OUT OF `notification-route.js` ON 2026-10-12, at the 500-line cap, when the plain
// mention toast grew a click target (Samuel's ruling on the in-app pop-up). The seam is the one
// that file's own header already drew: everything from "THE ACTIONABLE HALF" down. Nothing here
// changed shape in the move — `notification-route.js` re-exports every name, so no caller and no
// `require` anywhere else in the tree is touched.
//
// ⚠ IT IS A FACTORY, AND THAT IS WHAT KEEPS THE SPLIT ACYCLIC. This half needs three things from
// the surface half (`isAppFocused`, `deliverToast`, `noteRendererReady`); the surface half needs
// the handle map from this one. Requiring each other would be a cycle whose resolution order
// decides whether `pendingOpens` exists yet. So the dependency runs ONE WAY — route builds this,
// passing the three seams in — and there is exactly one instance, because route creates it once.

const prefs = require('./notification-prefs');
const { diag } = require('./diag');

/**
 * Pending closures a toast can ask main to run, keyed by an opaque handle.
 *
 * ⚠ TWO KINDS, AND THE DISTINCTION IS THE WHOLE SAFETY ARGUMENT.
 *   'open'   — NAVIGATION. Opens a surface the operator already has. A stale or forged handle is
 *              harmless by construction, which is why `peer_ask` and `draft_reply` may use it
 *              while their decisions ("Launch agent", "Send") stay on the banner — and why the
 *              PLAIN mention toast may use it too (2026-10-12): its click only ever lands the
 *              reader on the message the banner would have landed them on.
 *   'resume' — RESUMES THE OPERATOR'S OWN PARKED SESSION (`session_resume`). This one DOES act,
 *              and may because it is not a consent decision: it starts the operator's own agent
 *              exactly as the New Agent button does, no auto-deny contract sits behind it, and
 *              ignoring it leaves the session parked — precisely today's behaviour, so a missed
 *              toast decides nothing. NOT a precedent for "Send" or "Allow" in a toast: those
 *              answer somebody else's pending request, and a 4-second window to answer one is
 *              the thing the spec refused.
 */
const OPEN_TTL_MS = 120000;
// ⚠ A STICKY TOAST OUTLIVES THAT BY A DAY (`incoming-toasts.tsx › STICKY_MS` = 24h). Sweeping its
// closure at 120s left "Resume" on screen as a DEAD BUTTON, with the renderer's `.catch(()=>{})`
// hiding the miss. So a sticky entry gets a ceiling the toast cannot outlive — still a ceiling,
// because an unbounded map is a shape this tree has been bitten by.
const STICKY_OPEN_TTL_MS = 25 * 60 * 60 * 1000;
/** Truthy, and NOT a Notification: what a toast-raised actionable event answers. */
const TOAST_RAISED = { surface: 'popup' };
/**
 * Truthy, and NOT a Notification: the operator MUTED this event, so no surface was raised.
 * ⚠ DISTINCT FROM `null` ("no surface exists at all") — `trigger.js › handleTrigger` reads that
 * difference to decide whether a peer's ask may be consumed.
 */
const MUTED = { surface: 'none', muted: true };

/**
 * @param {{isAppFocused: () => boolean,
 *          deliverToast: (payload: object, fallback: () => void) => 'delivered'|'queued'|'none',
 *          noteRendererReady: () => void,
 *          toastReadyId: string,
 *          now?: () => number}} seams from `notification-route.js`.
 *   ⚠ `now` IS A CLOCK SEAM, defaulted to the real one and held in a CLOSURE — never `this`, and
 *   never a patched global. The TTL sweep is the only thing standing between a mention burst and
 *   an unbounded map, so a test has to be able to run time forward and SEE it reclaim.
 */
function create(seams) {
  const pendingOpens = new Map();
  const now = (seams && seams.now) || Date.now;
  let nextOpenId = 1;

  function sweepOpens(at) {
    const ttlOf = (e) => (e.sticky === true ? STICKY_OPEN_TTL_MS : OPEN_TTL_MS);
    for (const [id, e] of pendingOpens) if (at - e.at > ttlOf(e)) pendingOpens.delete(id);
  }

  /**
   * Parks a NAVIGATION closure and answers its opaque handle. ⚠ THE ONE WAY AN ENTRY IS MADE, so
   * every caller gets the same sweep and the same id space — the plain mention toast, the
   * actionable toast and the resume offer alike.
   * @returns {string|null} null when there is no closure to park, so a caller never ships a
   *   handle whose press would find nothing (the `{ ok: true }` lie `openFromToast` refuses).
   */
  function registerOpen(fn, opts) {
    // ⚠ AN ABSENT CLOSURE IS STILL PARKED, and that is deliberate (pinned by "an Open that cannot
    // open anything answers FALSE, not {ok:true}"): the actionable toast ships its handle either
    // way, and pressing it must answer FALSE rather than a success nobody delivered. A caller
    // that must not ship a dead handle — the PLAIN mention toast — checks before calling.
    const prefix = (opts && opts.prefix) || 'open';
    const id = prefix + '-' + String(nextOpenId++);
    // ⚠ SWEPT ON EVERY REGISTER, which is what BOUNDS this map. A plain mention toast parks a
    // handle whether or not anybody presses it (2026-10-12), so the arrival rate is now the
    // MENTION rate rather than the ask rate. Nothing else reclaims an unpressed entry: the
    // renderer sends no "dismissed" signal, and inventing one would be a second mechanism for a
    // problem the TTL already answers. So the ceiling is "what arrives inside one TTL", and this
    // line is the whole reason it is a ceiling at all.
    const at = now();
    sweepOpens(at);
    pendingOpens.set(id, { fn: fn, at: at, sticky: !!(opts && opts.sticky) });
    return id;
  }

  /** Drops a parked closure — the fallback path when the toast never reached a window. */
  function dropOpen(id) {
    if (id) pendingOpens.delete(id);
  }

  /**
   * Runs the closure a toast was raised with. ⚠ NAVIGATION ONLY for the 'open' kind — it can open
   * a channel the operator already has and nothing else, so a stale or forged id is harmless by
   * construction. One-shot: the entry is dropped first, so a double press cannot run it twice,
   * which is also why a click arriving after the toast's own dismiss is a no-op.
   * @returns {boolean} whether an entry was found.
   */
  function openFromToast(openId) {
    // The renderer's "my toast layer is mounted" ack rides this op — see `TOAST_READY_ID`.
    if (openId === seams.toastReadyId) {
      seams.noteRendererReady();
      return true;
    }
    sweepOpens(now());
    const entry = pendingOpens.get(openId);
    if (!entry) return false;
    pendingOpens.delete(openId);
    // ⚠ AN "Open" THAT CANNOT OPEN ANYTHING IS NOT `{ ok: true }`. A handle whose closure was never
    // given (or was lost to a shape change) used to answer success, so a button that did nothing
    // reported that it had worked. A closure that RUNS and throws still counts: it was there.
    if (typeof entry.fn !== 'function') return false;
    try {
      entry.fn();
    } catch (err) {
      diag('notification route: toast open failed —', (err && err.message) || 'error');
    }
    return true;
  }

  /**
   * Raises an event that carries an affirmative button.
   *
   * @param {string} eventId a registry id
   * @param {{title: string, body: string, actionText: string, onAffirm?: () => void,
   *          onOpen?: () => void, bannerAlways?: boolean}} spec
   * @returns {object|null} the Notification when a banner was raised, `TOAST_RAISED` when a toast
   *   was, `MUTED` when the operator silenced the event, `null` ONLY when no surface exists.
   *   ⚠ CALLERS MAY TEST THIS FOR TRUTHINESS AND ONE OF THEM DENIES A TOOL ON FALSY — never return
   *   null merely because Dopl is focused, and never because a switch is off.
   */
  function raiseActionable(eventId, spec) {
    try {
      if (!spec || !spec.title) return null;
      const surface = prefs.SURFACE[eventId];
      if (!surface) return null;
      // ⚠ `approval` is LOCKED ON in the registry, so this can never mute the tool gate. If a
      // future edit unlocks it, muting it would start auto-denying held tools — which is why
      // test/notification-route-actions.test.mjs pins the lock and this contract together.
      // ⚠ AND MUTED IS NOT `null`. Null made a muted `peer_ask` indistinguishable from a platform
      // that can raise nothing, and `handleTrigger` must tell them apart: a mute silences the
      // surface and nothing else, a true no-surface means the ask is seen by nobody. Truthy either
      // way, so no caller can read a mute as "no surface exists".
      if (!prefs.allowsIn(prefs.getPrefs(), eventId)) return MUTED;

      const banner = () => require('./notify-action').buildActionNotification({
        title: spec.title,
        body: spec.body,
        actionText: spec.actionText,
        onAffirm: spec.onAffirm,
        onOpen: spec.onOpen,
      });

      if (spec.bannerAlways === true || surface !== 'both' || !seams.isAppFocused()) return banner();

      // Focused: a toast that navigates. No `onAffirm` crosses, by construction.
      const id = registerOpen(spec.onOpen);
      // No window took it, so there is no popup — fall back to the banner rather than ask nobody.
      // A window that has not acked yet gets it HELD, with the same banner as the timeout fallback.
      const went = seams.deliverToast({
        eventId: eventId,
        title: spec.title,
        body: spec.body,
        openId: id,
        actionLabel: 'Open',
        kind: 'incoming',
      }, () => { dropOpen(id); banner(); });
      if (went === 'none') { dropOpen(id); return banner(); }
      return TOAST_RAISED;
    } catch (err) {
      diag('notification route: actionable raise failed —', (err && err.message) || 'error');
      // ⚠ Last resort is the BANNER, never null: a caller may read null as "no surface exists".
      try {
        return require('./notify-action').buildActionNotification({
          title: spec && spec.title, body: spec && spec.body, actionText: spec && spec.actionText,
          onAffirm: spec && spec.onAffirm, onOpen: spec && spec.onOpen,
        });
      } catch (_) {
        return null;
      }
    }
  }

  /** How many closures are parked. ⚠ The growth guard reads this; nothing in `main/` does. */
  function pendingCount() {
    return pendingOpens.size;
  }

  return { registerOpen, dropOpen, openFromToast, raiseActionable, pendingCount };
}

module.exports = { create, TOAST_RAISED, MUTED, OPEN_TTL_MS, STICKY_OPEN_TTL_MS };
