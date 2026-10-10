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
    const n = new Notification({ title: spec.title, body: spec.body || undefined, silent: true });
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

/** Pending `onOpen` closures a focused toast can ask main to run. Navigation only. */
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

module.exports = {
  TOAST_EVENT,
  TOAST_RAISED,
  isAppFocused,
  pushToast,
  raise,
  raiseActionable,
  openFromToast,
};
