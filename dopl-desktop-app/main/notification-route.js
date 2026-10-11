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
      // ⚠ A toast with no window to land in is a DROPPED notification: fall back to the banner
      // rather than lose the fact (the "popup only" case with the app closed, which the spec did
      // not contemplate). A window that exists but has not acked HOLDS it, same banner on timeout.
      if (deliverToast(payload, () => macBanner(spec)) === 'none') {
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

// ─── THE ACTIONABLE HALF ─────────────────────────────────────────────────────────────────────
//
// Three events carry ONE BUTTON THAT ANSWERS THEM (`notify-action.js`): `peer_ask` launches an
// agent, `draft_reply` sends a drafted post, `approval` allows a held tool. Samuel's spec marks
// all three "Mac + popup", and the naive reading — swap the banner for a toast while Dopl is in
// front — is REFUSED here for two reasons found in the code:
//
//   1. A TOAST AUTO-DISMISSES (`toast.tsx`, one slot, ~4s) and dismiss decides nothing. So a
//      missed toast is a refused tool, and a 4-second window to answer an approval is a
//      downgrade from a banner that persists, not an addition.
//   2. `session-windowless.js:293` treats a FALSY notification as "the TRUE no-surface case" and
//      DENIES the held tool immediately. A focused path that returned nothing would silently
//      auto-deny every gated tool while the operator sat in Dopl.
//
// So (Samuel, 2026-10-09):
//   `approval`            → THE BANNER, ALWAYS, focused or not. It is the only ask surface there
//                           is (no in-app tool-gate UI exists) and its return feeds that
//                           auto-deny contract.
//   `peer_ask`/`draft_reply` → banner when away; when focused, a toast whose button only ever
//                           NAVIGATES to the surface that already answers it (the thread's send
//                           box, the launch control). The decision never moves into the toast,
//                           which is also `notify-action.js`'s own rule: the body click
//                           navigates, it never decides.

/**
 * Pending closures a focused toast can ask main to run, keyed by an opaque handle.
 *
 * ⚠ TWO KINDS, AND THE DISTINCTION IS THE WHOLE SAFETY ARGUMENT.
 *   'open'   — NAVIGATION. Opens a surface the operator already has. A stale or forged handle is
 *              harmless by construction, which is why `peer_ask` and `draft_reply` may use it
 *              while their decisions ("Launch agent", "Send") stay on the banner.
 *   'resume' — RESUMES THE OPERATOR'S OWN PARKED SESSION (`session_resume`). This one DOES act,
 *              and may because it is not a consent decision: it starts the operator's own agent
 *              exactly as the New Agent button does, no auto-deny contract sits behind it, and
 *              ignoring it leaves the session parked — precisely today's behaviour, so a missed
 *              toast decides nothing. NOT a precedent for "Send" or "Allow" in a toast: those
 *              answer somebody else's pending request, and a 4-second window to answer one is
 *              the thing the spec refused.
 */
const pendingOpens = new Map();
let nextOpenId = 1;
// A toast the operator never pressed is not a leak worth keeping: drop the closure after this.
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

function sweepOpens(now) {
  const ttlOf = (e) => (e.sticky === true ? STICKY_OPEN_TTL_MS : OPEN_TTL_MS);
  for (const [id, e] of pendingOpens) if (now - e.at > ttlOf(e)) pendingOpens.delete(id);
}

/**
 * Runs the `onOpen` a focused toast was raised with. ⚠ NAVIGATION ONLY — it can open a channel
 * the operator already has and nothing else, so a stale or forged id is harmless by construction.
 * One-shot: the entry is dropped first, so a double press cannot run it twice.
 * @returns {boolean} whether an entry was found.
 */
function openFromToast(openId) {
  // The renderer's "my toast layer is mounted" ack rides this op — see `TOAST_READY_ID`.
  if (openId === TOAST_READY_ID) {
    noteRendererReady();
    return true;
  }
  sweepOpens(Date.now());
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
    // test/notification-route.test.mjs pins the lock and this contract together.
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

    if (spec.bannerAlways === true || surface !== 'both' || !isAppFocused()) return banner();

    // Focused: a toast that navigates. No `onAffirm` crosses, by construction.
    const id = 'open-' + String(nextOpenId++);
    sweepOpens(Date.now());
    pendingOpens.set(id, { fn: spec.onOpen, at: Date.now() });
    // No window took it, so there is no popup — fall back to the banner rather than ask nobody.
    // A window that has not acked yet gets it HELD, with the same banner as the timeout fallback.
    const went = deliverToast({
      eventId: eventId,
      title: spec.title,
      body: spec.body,
      openId: id,
      actionLabel: 'Open',
      kind: 'incoming',
    }, () => { pendingOpens.delete(id); banner(); });
    if (went === 'none') { pendingOpens.delete(id); return banner(); }
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
    const id = 'resume-' + String(nextOpenId++);
    sweepOpens(Date.now());
    // ⚠ `sticky` HERE TOO, not only in the payload: the sweep's 120s default would otherwise drop
    // this closure while the 24h toast still showed its button.
    pendingOpens.set(id, { fn: spec.onResume, at: Date.now(), sticky: true });
    const went = deliverToast({
      eventId: 'session_resume',
      title: spec.title,
      body: spec.body,
      openId: id,
      actionLabel: 'Resume',
      // The renderer keeps this one on screen until it is answered or dismissed.
      sticky: true,
      kind: 'incoming',
    }, () => { pendingOpens.delete(id); toBanner(); });
    if (went === 'none') { pendingOpens.delete(id); return toBanner(); }
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
  raiseActionable,
  openFromToast,
};
