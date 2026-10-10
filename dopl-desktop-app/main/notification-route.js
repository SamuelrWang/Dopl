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
 * Sends a toast to every renderer. Best-effort per window: one dead webContents must not stop
 * the others, and a failure here is never allowed to propagate into a caller's decision path.
 * @param {{getWindows: () => Array}} host
 */
function pushToast(host, payload) {
  let delivered = 0;
  const windows = (host && typeof host.getWindows === 'function' && host.getWindows()) || [];
  for (const win of windows) {
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
function macBanner(host, spec) {
  try {
    const { Notification } = require('electron');
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: spec.title, body: spec.body || undefined, silent: true });
    n.on('click', () => {
      try {
        if (typeof spec.onClick === 'function') spec.onClick();
        else if (host && typeof host.showWindow === 'function') host.showWindow();
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
 * @param {{getWindows?: () => Array, showWindow?: () => void}} host
 * @param {string} eventId a registry id (`notification-prefs.js › EVENT_IDS`)
 * @param {{title: string, body?: string, onClick?: () => void}} spec
 * @returns {'mac'|'popup'|'none'} where it actually went. 'none' = muted, unknown, or no surface.
 */
function raise(host, eventId, spec) {
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
      const sent = pushToast(host, { eventId: eventId, title: spec.title, kind: 'incoming' });
      // ⚠ A toast with no window to land in is a DROPPED notification. Fall back to the banner
      // rather than lose the fact: this is the "popup only" case with the app closed, which the
      // spec did not contemplate because it was written about a running app.
      if (sent === 0) return macBanner(host, spec) ? 'mac' : 'none';
      return 'popup';
    }
    return macBanner(host, spec) ? 'mac' : 'none';
  } catch (err) {
    diag('notification route: raise failed —', (err && err.message) || 'error');
    return 'none';
  }
}

module.exports = { TOAST_EVENT, isAppFocused, pushToast, raise };
