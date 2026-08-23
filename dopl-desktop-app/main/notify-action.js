// THE NATIVE NOTIFICATION WITH ONE AFFIRMATIVE ACTION — the shape, in one place.
//
// ⚠ EXTRACTED FROM `main/consent.js` ON 2026-08-22, when the INBOUND CONSENT LANE WAS RETIRED
// (Samuel's ruling). Two callers now build a banner of this shape and only ONE of them is about
// consent at all:
//   `consent.js › notifyOutbound`      the agent drafted a reply; the button SENDS it, by
//                                      deciding a server consent row.
//   `consent.js › notifyDecisionFailed` a decision that did not land; the click opens the app.
//   `trigger.js › notifyAsk`           a peer addressed this operator; the button LAUNCHES an
//                                      agent. There is no row, no decision and nothing to
//                                      approve — so it may not live in a file whose subject is
//                                      the consent row, or the next reader will look for one.
//
// THE SHAPE, and every part of it is a decision:
//   ONE action button. macOS shows the first `actions` entry and hides the rest behind a
//     hover-only "Options" affordance, so a second button is a button most operators never see.
//     Anything that needs a second verb uses the BODY CLICK.
//   THE BODY CLICK NAVIGATES, never decides. Clicking a banner is the ambiguous gesture — it is
//     what a person does to read the thing — so it may only ever open a surface.
//   DISMISS DECIDES NOTHING. `close` also fires on system auto-dismiss, on banner style and
//     under Focus mode, and none of those is a person saying no. There is deliberately no
//     `close` handler anywhere in this file.
//
// BEST-EFFORT THROUGHOUT: an unsupported / throwing Notification returns null rather than
// raising. A banner is never load-bearing — every one of these has a durable surface behind it.

const { app, BrowserWindow, Notification } = require('electron');

// A notification is easy to miss when Dopl runs hidden in the tray. When NO window is visible,
// bounce the dock so a new one still draws attention. macOS only, best-effort — never throws.
function requestAttention() {
  try {
    if (process.platform !== 'darwin' || !app.dock) return;
    const anyVisible = BrowserWindow.getAllWindows().some((w) => {
      try { return w.isVisible(); } catch (_) { return false; }
    });
    if (!anyVisible) app.dock.bounce('critical');
  } catch (_) { /* best-effort */ }
}

// One affirmative action button + Dismiss. The affirmative action runs `onAffirm`; clicking the
// BODY runs `onOpen`. Returns the Notification, or null when the platform has none.
function buildActionNotification({ title, body, actionText, onAffirm, onOpen }) {
  if (!Notification.isSupported()) return null;
  let notif;
  try {
    notif = new Notification({
      title,
      body,
      silent: false,
      actions: [{ type: 'button', text: actionText }],
      closeButtonText: 'Dismiss',
    });
  } catch (_) {
    return null; // notifications are best-effort
  }
  notif.on('action', () => { try { if (onAffirm) onAffirm(); } catch (_) { /* window gone */ } });
  notif.on('click', () => { try { if (onOpen) onOpen(); } catch (_) { /* window gone */ } });
  try {
    notif.show();
    requestAttention();
  } catch (_) { /* best-effort */ }
  return notif;
}

module.exports = { requestAttention, buildActionNotification };
