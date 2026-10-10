// WHICH SURFACE AN EVENT RAISES ON, AND THE GUARANTEE THAT IT IS EXACTLY ONE (2026-10-09, KB
// dopl-development "Notification Spec Samuel 2026-10-09" › Build order step 2).
//
// ⚠ "BOTH" NEVER MEANS TWICE. Samuel's spec marks 9 events for Mac + popup, but A is an OS
// banner raised here in main and B is a toast owned by a renderer module global
// (`src/shared/ui/toast.tsx`). Firing both would notify the same fact twice at the same desk.
// So `both` is resolved AT RAISE TIME to the ONE surface the operator can actually see:
//   Dopl in front  → the in-app toast. A banner would be noise over the thing he is looking at.
//   Dopl elsewhere → the OS banner. A toast would land on a window nobody is reading.
// `runtime-credentials.js:83` has done exactly this for one event since before the spec; this
// module generalizes that, and it is the pattern the spec names.
//
// ⚠ FAIL TOWARD THE BANNER. If focus cannot be read we treat Dopl as NOT focused, because an
// unseen toast is a silenced notification and a banner over a focused app is merely noise. Same
// direction as every other default in this feature.
//
// ⚠ IT CAN ONLY RAISE WHAT THE GATE ALLOWS. Every call runs the operator's preference first
// (`notification-prefs.js › allowsIn`), so this module can never introduce a banner the
// Notifications tab says is off. It raises nothing for an event it cannot name.
//
// ⚠ THE TOAST IS A SINGLE SLOT (`toast.tsx` holds one `currentToast`). A pushed toast REPLACES
// whatever is on screen, including a result the operator's own click just produced. That is why
// `push` carries `kind: 'incoming'`: the renderer decides whether to yield, and this module does
// not get to assume it won.

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
 * Sends a toast to every renderer. Best-effort per window: one dead webContents must not stop
 * the others, and a failure here is never allowed to propagate into a caller's decision path.
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
      const sent = pushToast({ eventId: eventId, title: spec.title, kind: 'incoming' });
      // ⚠ A toast with no window to land in is a DROPPED notification. Fall back to the banner
      // rather than lose the fact: this is the "popup only" case with the app closed, which the
      // spec did not contemplate because it was written about a running app.
      if (sent === 0) return macBanner(spec) ? 'mac' : 'none';
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
 *              and it is allowed to because it is not a consent decision: it starts the
 *              operator's own agent, exactly as the New Agent button does, there is no
 *              auto-deny contract behind it, and ignoring it leaves the session parked — which
 *              is precisely today's behaviour, so a missed toast decides nothing.
 *              It is NOT a precedent for putting "Send" or "Allow" in a toast: those answer
 *              somebody else's pending request, and a 4-second window to answer one is the
 *              thing the spec refused.
 */
const pendingOpens = new Map();
let nextOpenId = 1;
// A toast the operator never pressed is not a leak worth keeping: drop the closure after this.
const OPEN_TTL_MS = 120000;
/** Truthy, and NOT a Notification: what a toast-raised actionable event answers. */
const TOAST_RAISED = { surface: 'popup' };

function sweepOpens(now) {
  for (const [id, e] of pendingOpens) if (now - e.at > OPEN_TTL_MS) pendingOpens.delete(id);
}

/**
 * Runs the `onOpen` a focused toast was raised with. ⚠ NAVIGATION ONLY — it can open a channel
 * the operator already has and nothing else, so a stale or forged id is harmless by construction.
 * One-shot: the entry is dropped first, so a double press cannot run it twice.
 * @returns {boolean} whether an entry was found.
 */
function openFromToast(openId) {
  sweepOpens(Date.now());
  const entry = pendingOpens.get(openId);
  if (!entry) return false;
  pendingOpens.delete(openId);
  try {
    if (typeof entry.fn === 'function') entry.fn();
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
 * @returns {object|null} the Notification when a banner was raised, a truthy sentinel when a
 *   toast was, `null` when nothing could be raised. ⚠ CALLERS MAY TEST THIS FOR TRUTHINESS AND
 *   ONE OF THEM DENIES A TOOL ON FALSY — never return null merely because Dopl is focused.
 */
function raiseActionable(eventId, spec) {
  try {
    if (!spec || !spec.title) return null;
    const surface = prefs.SURFACE[eventId];
    if (!surface) return null;
    // ⚠ `approval` is LOCKED ON in the registry, so this can never mute the tool gate. If a
    // future edit unlocks it, muting it would start auto-denying held tools — which is why
    // test/notification-route.test.mjs pins the lock and this contract together.
    if (!prefs.allowsIn(prefs.getPrefs(), eventId)) return null;

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
    const sent = pushToast({
      eventId: eventId,
      title: spec.title,
      body: spec.body,
      openId: id,
      actionLabel: 'Open',
      kind: 'incoming',
    });
    // No window took it, so there is no popup — fall back to the banner rather than ask nobody.
    if (sent === 0) {
      pendingOpens.delete(id);
      return banner();
    }
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
 * and a missed one loses the offer until the next launch. Falls back to the banner when there is
 * no window to toast into (app starting hidden in the tray), which is the route's usual rule.
 *
 * @param {{title: string, body?: string, onResume: () => void}} spec
 * @returns {'popup'|'mac'|'none'}
 */
function raiseResumeOffer(spec) {
  try {
    if (!spec || !spec.title || typeof spec.onResume !== 'function') return 'none';
    if (!prefs.allowsIn(prefs.getPrefs(), 'session_resume')) return 'none';
    const id = 'resume-' + String(nextOpenId++);
    sweepOpens(Date.now());
    pendingOpens.set(id, { fn: spec.onResume, at: Date.now() });
    const sent = pushToast({
      eventId: 'session_resume',
      title: spec.title,
      body: spec.body,
      openId: id,
      actionLabel: 'Resume',
      // The renderer keeps this one on screen until it is answered or dismissed.
      sticky: true,
      kind: 'incoming',
    });
    if (sent === 0) {
      pendingOpens.delete(id);
      return macBanner({ title: spec.title, body: spec.body, onClick: spec.onResume }) ? 'mac' : 'none';
    }
    return 'popup';
  } catch (err) {
    diag('notification route: resume offer failed —', (err && err.message) || 'error');
    return 'none';
  }
}

module.exports = {
  TOAST_EVENT,
  TOAST_RAISED,
  COALESCE_MS,
  raiseCoalesced,
  raiseResumeOffer,
  isAppFocused,
  pushToast,
  raise,
  raiseActionable,
  openFromToast,
};
