// THE SESSION'S PERMISSION FENCE — what a renderer in this app may ask the OS for.
//
// ⚠ IT EXISTS BECAUSE ELECTRON'S DEFAULT IS "YES TO EVERYTHING". With no
// `setPermissionRequestHandler` installed, Electron approves every permission a page requests —
// geolocation, camera, display capture, MIDI, HID, serial, USB — for whatever document happens to
// be loaded. `spa-window.js › policeNavigation` means that document is only ever ours, so this was
// never REACHABLE by a foreign page; it was still an unfenced default sitting behind one gate
// instead of two, which INVARIANTS §11 does not accept anywhere else in this tree.
//
// ⚠ THE MICROPHONE IS WHY IT LANDED NOW (Samuel, 2026-09-08 — the composer's dictation glyph).
// The composer's `use-dictation.ts` drives `webkitSpeechRecognition`, which opens a capture
// stream; that ask reaches this handler. ⚠ **AND ALLOWING IT DOES NOT MAKE DICTATION WORK IN
// ELECTRON** — the capture succeeds and the RECOGNITION SERVICE is what fails, because
// `webkitSpeechRecognition` posts to Google's speech endpoint with the Chromium build's API key
// and Electron ships none. That is a property of the runtime, not of this fence; it is recorded
// here so nobody reads this file as the fix and stops looking.
//
// THE SHAPE: an explicit allowlist, checked against the app's OWN document, and `false` for
// everything else — including for our own document. A permission is added here WITH the feature
// that needs it, never in advance.

const spaWindow = require('./spa-window');

// ─── BEGIN MEDIA-PERMISSION-PURE (unit-tested via source extraction) ─────────
// No electron/require refs below.

// The two the app actually uses.
//
// ⚠ `media` IS THE REQUEST-SIDE NAME AND `audioCapture` IS THE CHECK-SIDE NAME for the same
// capability — Electron routes `getUserMedia` through `setPermissionRequestHandler('media')` and
// a `navigator.permissions.query({name:'microphone'})` through
// `setPermissionCheckHandler('audioCapture')`. Both are here or the feature works on one path and
// reports "denied" on the other.
// ⚠ `clipboard-sanitized-write` IS NOT DECORATION AND MUST NOT BE TIDIED OUT: every Copy→Check
// affordance in the product goes through `shared/hooks/use-copy-to-clipboard.ts ›
// navigator.clipboard.writeText`, and Electron consults this same pair of handlers for it. A
// media-only allowlist silently breaks every copy button in the app.
// ⚠ `videoCapture`, `display-capture`, `geolocation`, `notifications`, `midi*`, `hid`, `serial`,
// `usb`, `window-management`, `clipboard-read` and `unknown` are all DELIBERATELY ABSENT. The app
// has no feature behind any of them.
const ALLOWED_PERMISSIONS = new Set(['media', 'audioCapture', 'clipboard-sanitized-write']);

/**
 * May this document have this permission?
 *
 * @param permission  Electron's permission name, from either handler.
 * @param requestingUrl  The asking document's URL — `webContents.getURL()` or
 *   `details.requestingUrl`. Compared with the SAME predicate that polices navigation, so "our own
 *   document" has exactly one definition in this app and a dev build's Vite origin is covered by
 *   the same sentence that covers a packaged build's `file:` page.
 * @param devUrl  The resolved `DOPL_UI_DEV_URL` ('' in production).
 * @param indexHref  `pathToFileURL` of the one bundled document.
 * @param mediaTypes  For `media` only: what `getUserMedia` asked for.
 *
 * ⚠ AUDIO ONLY. A `media` request naming `video` is refused even from our own page: the app has no
 * camera feature, and `{audio:true, video:true}` is one ask that would otherwise carry the camera
 * in on the microphone's ticket.
 * ⚠ AN ABSENT/EMPTY `mediaTypes` IS REFUSED, not waved through. Electron omits it on some paths,
 * and "we could not tell what was asked for" must never resolve to yes.
 * ⚠ FAIL-CLOSED ON A URL WE CANNOT PLACE: `isAllowedNavigation` refuses anything it cannot parse.
 */
function isAllowedPermission(permission, requestingUrl, devUrl, indexHref, mediaTypes) {
  if (!ALLOWED_PERMISSIONS.has(String(permission || ''))) return false;
  if (!isOwnDocument(requestingUrl, devUrl, indexHref)) return false;
  if (permission === 'media') {
    const types = Array.isArray(mediaTypes) ? mediaTypes : [];
    if (types.length === 0) return false;
    return types.every((t) => t === 'audio');
  }
  return true;
}

// ⚠ INJECTED, NOT IMPORTED, so this slice stays pure and the test drives the real predicate.
// `installPermissionFence` binds it to `spa-window.js › isAllowedNavigation` below — one
// definition of "our own document" for navigation and for permissions both.
let isOwnDocument = () => false;

function setOwnDocumentPredicate(fn) {
  isOwnDocument = fn;
}

// ─── END MEDIA-PERMISSION-PURE ───────────────────────────────────────────────

setOwnDocumentPredicate(spaWindow.isAllowedNavigation);

/**
 * Install the fence on one Electron session. Called once, on `app.whenReady()`, for the DEFAULT
 * session — every window in this app shares it, so there is no per-window wiring to forget.
 *
 * ⚠ BOTH HANDLERS, ALWAYS. The REQUEST handler answers the prompt-shaped asks (`getUserMedia`);
 * the CHECK handler answers the synchronous `navigator.permissions.query` a page makes before it
 * asks. Installing one leaves the other on Electron's allow-everything default.
 */
function installPermissionFence(session) {
  if (!session) return;
  const indexHref = require('node:url').pathToFileURL(spaWindow.INDEX_HTML).href;
  const verdict = (permission, url, mediaTypes) =>
    isAllowedPermission(permission, url, spaWindow.devUrl(), indexHref, mediaTypes);

  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
    callback(verdict(permission, url, details && details.mediaTypes));
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    // ⚠ THE CHECK HANDLER IS HANDED AN ORIGIN, NOT A URL, and a `file:` document's origin is the
    // opaque string "null" — which `isAllowedNavigation` correctly refuses. `details.requestingUrl`
    // is the full URL on every path that has one, so it is preferred and the origin is the
    // fallback for the dev (http) case.
    // ⚠ TWO SPELLINGS OF ONE FIELD: the REQUEST handler is handed `mediaTypes` (an array), the
    // CHECK handler `mediaType` (one string, and 'unknown' where Chromium could not say). Reading
    // only the array made every `media` check fall to the empty-list refusal.
    const url = (details && details.requestingUrl) || requestingOrigin || '';
    const types =
      (details && details.mediaTypes) ||
      (details && details.mediaType ? [details.mediaType] : undefined);
    return verdict(permission, url, types);
  });
}

module.exports = {
  installPermissionFence,
  isAllowedPermission,
  ALLOWED_PERMISSIONS,
};
