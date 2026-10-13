// WHICH SURFACE AN EVENT RAISES ON, AND THE GUARANTEE THAT IT IS EXACTLY ONE (2026-10-09, KB
// dopl-development "Notification Spec Samuel 2026-10-09" › Build order step 2).
//
// ⚠ "BOTH" NEVER MEANS TWICE. Samuel's spec marks 9 events for Mac + popup, but A is an OS banner
// raised here in main and B is a toast owned by a renderer module global (`src/shared/ui/toast.tsx`),
// so firing both notifies one fact twice at one desk. `both` resolves AT RAISE TIME to the ONE
// surface the operator can see: Dopl in front → the in-app toast (a banner would be noise over
// what he is reading); Dopl elsewhere → the OS banner (a toast would land on a window nobody is
// reading). `runtime-credentials.js:83` did exactly this for one event before the spec named it.
//
// ⚠ FAIL TOWARD THE BANNER. Unreadable focus reads as NOT focused, because an unseen toast is a
// silenced notification and a banner over a focused app is merely noise. So does an unseen window
// (`hasVisibleWindow`) and a renderer that never acks (`deliverToast`).
//
// ⚠ IT CAN ONLY RAISE WHAT THE GATE ALLOWS. Every call runs the operator's preference first
// (`notification-prefs.js › allowsIn`), so this module can never introduce a banner the
// Notifications tab says is off. It raises nothing for an event it cannot name.
//
// ⚠ THE TOAST IS A SINGLE SLOT (`toast.tsx` holds one `currentToast`), so a push REPLACES whatever
// is on screen. That is why every push carries `kind: 'incoming'`: the renderer owns the yielding
// rule (`incoming-toasts.tsx` queues them, one visible life each), and this module does not get to
// assume it won the slot.

const prefs = require('./notification-prefs');
const { diag } = require('./diag');

/** The one IPC channel main uses to raise a toast in every renderer. */
const TOAST_EVENT = 'notifications:toast';

/**
 * Is Dopl the app in front? ⚠ Answers FALSE when it cannot tell (no electron, no windows, a
 * throwing getter), which routes `both` to the OS banner — the louder, recoverable direction.
 */
function isAppFocused() {
  try {
    const { BrowserWindow } = require('electron');
    return Boolean(BrowserWindow.getFocusedWindow());
  } catch (_err) {
    return false;
  }
}

/**
 * Every renderer window, or an empty list when there is no window layer to ask.
 * ⚠ NO INJECTED HOST. This module is called from passive notice sites (`trigger.js › sendFyi`,
 * the listener's own arms) that are handed no app host, and threading one through every one of
 * them would be a dependency for nothing: the window list is a property of the process, not of
 * a caller.
 */
function allWindows() {
  try {
    const { BrowserWindow } = require('electron');
    return BrowserWindow.getAllWindows() || [];
  } catch (_err) {
    return [];
  }
}

/**
 * Is there a window the operator can actually SEE? ⚠ NOT `isAppFocused`'s question: with
 * `openAsHidden` the shell window EXISTS while invisible, so a toast pushed into it is a SILENCED
 * notification. FALSE when it cannot tell (no `isVisible` either), which routes to the banner.
 */
function hasVisibleWindow() {
  // `allWindows` already answers [] for a missing or throwing window layer.
  return allWindows().some((w) => {
    try { return typeof w.isVisible === 'function' && w.isVisible() === true; } catch (_e) { return false; }
  });
}

/**
 * Sends a toast to every renderer. Best-effort per window: one dead webContents must not stop
 * the others, and a failure here is never allowed to propagate into a caller's decision path.
 * ⚠ ITS COUNT IS "SENT", WHICH IS NOT "SEEN" — go through `deliverToast`, never this directly.
 */
function pushToast(payload) {
  let delivered = 0;
  for (const win of allWindows()) {
    try {
      win.webContents.send(TOAST_EVENT, payload);
      delivered += 1;
    } catch (err) {
      diag('notification route: toast push failed —', (err && err.message) || 'error');
    }
  }
  return delivered;
}

// ⚠ SENT IS NOT DELIVERED, AND READING IT AS DELIVERED LOST THE RESUME OFFER ON EVERY COLD START.
// `webContents.send` does not throw into a window whose renderer has not mounted its listener yet,
// and the shell window is created HIDDEN with `sessionEngine.init()` → `session-park.js ›
// offerResume` in the SAME `whenReady` tick — long before React mounts `IncomingToasts`. So
// `sent === 1` held, the `sent === 0` fallback never ran, and the offer was gone until next launch.
// A toast is therefore HELD until the renderer says it can show one, and the banner takes it when
// that word does not arrive. `rendererReady` is process-wide: the ack says "a toast layer is
// mounted somewhere", which is the only fact `pushToast` can act on anyway.

/**
 * The reserved `openId` the renderer sends once `IncomingToasts` is mounted. ⚠ IT RIDES THE
 * EXISTING NAVIGATION OP (`notifications:openFromToast`), already an opaque handle from the toast
 * layer to here. A forged ack only flushes held toasts into the window that asked for them.
 */
const TOAST_READY_ID = 'toast-ready';
/** How long a held toast waits for that ack before the banner takes it instead. */
const ACK_WAIT_MS = 4000;
/** Toasts held for a renderer that has not acked: `{ payload, fallback, timer }`. */
const waitingToasts = new Set();
let rendererReady = false;

function runFallback(held) {
  try {
    if (typeof held.fallback === 'function') held.fallback();
  } catch (err) {
    diag('notification route: toast fallback failed —', (err && err.message) || 'error');
  }
}

/** The renderer's toast layer is mounted: flush everything held for it. */
function noteRendererReady() {
  rendererReady = true;
  for (const held of [...waitingToasts]) {
    waitingToasts.delete(held);
    if (held.timer) clearTimeout(held.timer);
    if (pushToast(held.payload) === 0) runFallback(held);
  }
}

/**
 * Pushes a toast, or HOLDS it until the renderer acks.
 * @param {object} payload
 * @param {() => void} fallback raised when no renderer takes it within `ACK_WAIT_MS`.
 * @returns {'delivered'|'queued'|'none'} 'none' = no window layer at all, so the caller falls
 *   back NOW rather than wait on a renderer that does not exist.
 */
function deliverToast(payload, fallback) {
  // A later window starts unmounted, whatever an old one once acked.
  if (allWindows().length === 0) { rendererReady = false; return 'none'; }
  if (rendererReady) return pushToast(payload) > 0 ? 'delivered' : 'none';
  const held = { payload: payload, fallback: fallback, timer: null };
  waitingToasts.add(held);
  held.timer = setTimeout(() => {
    if (!waitingToasts.delete(held)) return;
    diag('notification route: no renderer ack —', payload.eventId || '?', '→ the banner takes it');
    runFallback(held);
  }, ACK_WAIT_MS);
  // ⚠ UNREF'd: a held toast must never keep the app — or a test process — alive.
  if (held.timer && typeof held.timer.unref === 'function') held.timer.unref();
  return 'queued';
}

/**
 * Raises an OS banner. Click reveals the app, because every event in the spec is something the
 * operator acts on INSIDE Dopl.
 */
function macBanner(spec) {
  try {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return false;
    // ⚠ SILENT BY DEFAULT, and a sound is the SITE's decision, never the router's. Only a site
    // that passes `silent: false` makes one — today just `decision_failed`, where the sound and
    // the dock bounce are deliberate ("you believe you answered and you did not"). That is the
    // difference between the sound step 5 removes, which nobody chose, and this one, which
    // somebody did.
    const loud = spec.silent === false;
    const n = new Notification({ title: spec.title, body: spec.body || undefined, silent: !loud });
    n.on('click', () => {
      try {
        if (typeof spec.onClick === 'function') spec.onClick();
        else {
          // No handler given: the least surprising thing a click can do is bring Dopl forward.
          const win = allWindows()[0];
          if (win && typeof win.show === 'function') win.show();
        }
      } catch (err) {
        diag('notification route: click handler failed —', (err && err.message) || 'error');
      }
    });
    n.show();
    // A notice is easy to miss when Dopl runs hidden in the tray; `attention` bounces the dock
    // for the few events that must not be missed. Best-effort, macOS only, never throws.
    if (spec.attention === true) {
      try { require('./notify-action').requestAttention(); } catch (_) { /* best-effort */ }
    }
    return true;
  } catch (err) {
    diag('notification route: banner failed —', (err && err.message) || 'error');
    return false;
  }
}

/**
 * THE ONE ENTRY POINT. Raises `eventId` on the surface the spec gives it, after the operator's
 * preference, and on EXACTLY ONE surface.
 *
 * @param {string} eventId a registry id (`notification-prefs.js › EVENT_IDS`)
 * @param {{title: string, body?: string, onClick?: () => void}} spec
 * @returns {'mac'|'popup'|'none'} where it actually went. 'none' = muted, unknown, or no surface.
 */
function raise(eventId, spec) {
  try {
    const surface = prefs.SURFACE[eventId];
    // An id this build cannot name has no surface to pick. ⚠ Note this is the OPPOSITE default
    // from `allowsIn`, and deliberately so: that one fails ON so a mute can never be silently
    // ignored, this one fails SILENT because inventing a surface for an unknown event would
    // raise a notification nobody specified. Both refuse to guess.
    if (!surface) return 'none';
    if (!prefs.allowsIn(prefs.getPrefs(), eventId)) return 'none';
    if (!spec || !spec.title) return 'none';

    const target = surface === 'both' ? (isAppFocused() ? 'popup' : 'mac') : surface;
    if (target === 'popup') {
      // ⚠ THE BODY RIDES ALONG. Dropping it made a mention toast say only the channel name, cost
      // `decision_failed` its recovery sentence, and left POPUP-ONLY `tool_blocked` with no
      // reachable surface for its body at all. The renderer draws the full card face when there
      // is a body and the title-only one when there is not.
      const payload = { eventId: eventId, title: spec.title, kind: 'incoming' };
      if (spec.body) payload.body = spec.body;
      // 🔒 ⚠ THE CLICK TARGET RIDES ALONG TOO (2026-10-12, Samuel's ruling on #4358 opt 1: the
      // whole in-app pop-up is clickable and jumps to the message). Until then this line dropped
      // `spec.onClick` on the floor, so while Dopl was IN FRONT a mention toast was a DEAD CARD:
      // the banner's navigation existed and the toast's did not. Same bug, other surface.
      //
      // ⚠ `openId` WITHOUT `actionLabel`, AND THAT IS THE WHOLE RULING IN ONE LINE. The renderer
      // already keys both the 4s life and the plain face on `openId && actionLabel`
      // (`incoming-toasts.tsx › lifeOf`, `› show`), so omitting the label keeps PLAIN_MS and the
      // single slot BY CONSTRUCTION rather than by a new branch: no button, no 15s hold, a burst
      // of mentions still 4s each.
      //
      // ⚠ IT IS THE SAME HANDLE MAP THE ACTIONABLE TOAST USES, kind 'open', deliberately — that
      // map's header argues 'open' is navigation-only and a stale or forged handle is harmless by
      // construction, which is exactly this case. A second registry for "the plain one" would be
      // a second mechanism for a solved problem, and a second thing to sweep.
      // ⚠ ONLY WHEN THERE IS SOMETHING TO RUN. `registerOpen` parks an absent closure on purpose
      // for the actionable toast (its press must answer FALSE, not a silent success), but a PLAIN
      // card has no button to explain itself — a handle with nothing behind it would just be a
      // clickable card that does nothing, which is the bug this fixes.
      const openId = typeof spec.onClick === 'function' ? actions.registerOpen(spec.onClick) : null;
      if (openId) payload.openId = openId;
      // ⚠ A toast with no window to land in is a DROPPED notification: fall back to the banner
      // rather than lose the fact (the "popup only" case with the app closed, which the spec did
      // not contemplate). A window that exists but has not acked HOLDS it, same banner on timeout.
      // ⚠ THE HANDLE IS DROPPED ON EVERY PATH THAT DOES NOT SHOW THIS TOAST, so a banner fallback
      // never leaves a closure parked for a card nobody will ever see.
      if (deliverToast(payload, () => { actions.dropOpen(openId); macBanner(spec); }) === 'none') {
        actions.dropOpen(openId);
        return macBanner(spec) ? 'mac' : 'none';
      }
      return 'popup';
    }
    return macBanner(spec) ? 'mac' : 'none';
  } catch (err) {
    diag('notification route: raise failed —', (err && err.message) || 'error');
    return 'none';
  }
}

// ─── THE ACTIONABLE HALF LIVES IN `notification-route-actions.js` ───────────────────────────
//
// ⚠ MOVED 2026-10-12, at the 500-line cap, when the plain mention toast grew a click target. The
// seam is the one this header already drew. Everything it exported is RE-EXPORTED below, so no
// caller changed: `trigger.js`, `consent.js`, `session-windowless.js` and the IPC op all still
// name `notification-route`. ⚠ IT IS BUILT HERE, ONCE — the handle map is per-instance, and two
// instances would be two maps with the renderer able to reach only one of them.
const actions = require('./notification-route-actions').create({
  isAppFocused: () => isAppFocused(),
  deliverToast: (payload, fallback) => deliverToast(payload, fallback),
  noteRendererReady: () => noteRendererReady(),
  toastReadyId: TOAST_READY_ID,
});
const { TOAST_RAISED, MUTED } = require('./notification-route-actions');

// ─── COALESCING ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ FOR EVENTS THAT ARRIVE IN BURSTS. `agent_started` is the one that needs it: a fan-out where
// one agent launches several would otherwise raise one banner per spawn, and ten banners for one
// intention is worse than none. Samuel's ruling is "coalesced burst → one notification".
//
// It DEBOUNCES rather than throttles: the first arrival opens a short window, every arrival
// inside it only increments a count, and ONE notice is raised at the end naming the total. The
// delay is the cost — a second or so before "an agent started" appears — which is the right
// trade for an informational event and would NOT be for an ask (nothing actionable coalesces).

/** Open burst windows, keyed by event id. */
const bursts = new Map();
const COALESCE_MS = 1500;

/**
 * Raises `eventId` ONCE for a burst.
 * @param {string} eventId a registry id
 * @param {(count: number) => {title: string, body?: string, onClick?: () => void}} build called
 *   at the END of the window with how many arrived, so the copy can say "2 agents started".
 * @param {number} [windowMs]
 * @returns {'opened'|'coalesced'} whether this call opened the window or joined one.
 */
function raiseCoalesced(eventId, build, windowMs) {
  const open = bursts.get(eventId);
  if (open) {
    open.count += 1;
    return 'coalesced';
  }
  const entry = { count: 1, timer: null };
  bursts.set(eventId, entry);
  entry.timer = setTimeout(() => {
    bursts.delete(eventId);
    try {
      // The gate is read HERE, at the end of the window, not when the burst opened: the operator
      // may have flipped the switch while it was filling, and the later answer is the true one.
      raise(eventId, build(entry.count));
    } catch (err) {
      diag('notification route: coalesced raise failed —', (err && err.message) || 'error');
    }
  }, typeof windowMs === 'number' ? windowMs : COALESCE_MS);
  // ⚠ UNREF'd: a pending burst must never hold the app open on quit, nor a test process.
  if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
  return 'opened';
}

/**
 * Raises `session_resume`: the startup offer to resume a session that was interrupted.
 *
 * Popup-only per Samuel's spec, with a button that RESUMES — see the `pendingOpens` header for
 * why this one may act when "Send" and "Allow" may not. ⚠ LONG-LIVED: the toast must sit until
 * it is pressed or dismissed, not expire in four seconds, because it is raised ONCE at startup
 * and a missed one loses the offer until the next launch.
 *
 * ⚠ IT NEEDS A WINDOW THE OPERATOR CAN SEE, not merely a window. This was the ONE raise path that
 * never consulted focus while its own comment claimed it detected the hidden case: with
 * `openAsHidden` the window exists and is invisible, so it pushed into an unseen window on every
 * cold start. An invisible (or absent) window layer sends this to the banner, the route's rule.
 *
 * @param {{title: string, body?: string, onResume: () => void}} spec
 * @returns {'popup'|'mac'|'none'}
 */
function raiseResumeOffer(spec) {
  try {
    if (!spec || !spec.title || typeof spec.onResume !== 'function') return 'none';
    if (!prefs.allowsIn(prefs.getPrefs(), 'session_resume')) return 'none';
    const toBanner = () =>
      (macBanner({ title: spec.title, body: spec.body, onClick: spec.onResume }) ? 'mac' : 'none');
    // Starting hidden in the tray must not lose the offer, and must not pretend it was shown.
    if (!hasVisibleWindow()) return toBanner();
    // ⚠ `sticky` HERE TOO, not only in the payload: the sweep's 120s default would otherwise drop
    // this closure while the 24h toast still showed its button.
    const id = actions.registerOpen(spec.onResume, { prefix: 'resume', sticky: true });
    const went = deliverToast({
      eventId: 'session_resume',
      title: spec.title,
      body: spec.body,
      openId: id,
      actionLabel: 'Resume',
      // The renderer keeps this one on screen until it is answered or dismissed.
      sticky: true,
      kind: 'incoming',
    }, () => { actions.dropOpen(id); toBanner(); });
    if (went === 'none') { actions.dropOpen(id); return toBanner(); }
    return 'popup';
  } catch (err) {
    diag('notification route: resume offer failed —', (err && err.message) || 'error');
    return 'none';
  }
}

module.exports = {
  TOAST_EVENT,
  TOAST_RAISED,
  TOAST_READY_ID,
  MUTED,
  ACK_WAIT_MS,
  COALESCE_MS,
  raiseCoalesced,
  raiseResumeOffer,
  isAppFocused,
  hasVisibleWindow,
  pushToast,
  noteRendererReady,
  raise,
  // Re-exported from the actionable half (`TOAST_RAISED` / `MUTED` are named above, where they
  // always were) — see its header for why the split is a factory and why there is one instance.
  raiseActionable: (eventId, spec) => actions.raiseActionable(eventId, spec),
  openFromToast: (openId) => actions.openFromToast(openId),
  /** Parked-closure count. ⚠ The growth guard reads this; nothing in `main/` does. */
  pendingOpenCount: () => actions.pendingCount(),
};
