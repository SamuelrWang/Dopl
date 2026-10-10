// NOTIFICATION PREFERENCES — THIS MAC'S RECORD, AND THE BANNER GATE THAT READS IT (2026-10-09,
// KB dopl-development "Notifications Audit 2026-10-08"). The profile popup's Notifications tab
// writes it over `notifications:get/setPrefs` (channel-dir-ipc.js); the passive banners
// (`trigger.js › sendFyi`, `task-notify.js › notifyTaskReply`) ask `allowsMessage` before
// showing anything.
//
// ⚠ LOCAL ELECTRON-STORE, NOT SERVER STATE, FOR NOW. The spec wants one server record per user
// (migration 20261117120000_notification_preferences.sql is written, not applied: Samuel's
// call). Until then the record lives here, which is also where every banner it governs is
// raised. When the server table lands this module's READ moves to the API; the gate's callers
// do not change.
//
// ⚠ IT CAN ONLY SILENCE A BANNER, NEVER RAISE ONE, AND NEVER CHANGE A VERDICT. A banner it
// suppresses still has its durable record (the Tags inbox, the thread itself); no route, consent
// row or spawn reads this file.
//
// ⚠ DEFAULT ON, AND EVERY FAILURE READS ON. An unreadable store must not quietly mute the
// operator: a banner nobody asked to silence is recoverable, a silenced one is not noticed.
//
// ⚠ `approval` IS ALWAYS ON. Every approval banner carries the ONE button that answers it
// (`notify-action.js`), so those call sites are not gated at all; the key is forced on here so
// the tab and the record can never disagree about it.

const Store = require('electron-store');

const store = new Store();
const KEY = 'notificationPrefs';

// ─── BEGIN NOTIFICATION-PREFS PURE (no store, no electron; sliced by the tests) ───
// Restated from src/features/notifications/registry.ts › NOTIFICATION_EVENT_IDS. Keep in sync.
const EVENT_IDS = ['mention', 'decision', 'direct_message', 'approval'];
const LOCKED_ON = ['approval'];

function defaultPrefs() {
  const events = {};
  for (const id of EVENT_IDS) events[id] = true;
  return { v: 1, events: events };
}

function normalizePrefs(raw) {
  const out = defaultPrefs();
  const events = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.events : undefined;
  if (events && typeof events === 'object' && !Array.isArray(events)) {
    for (const id of EVENT_IDS) {
      if (typeof events[id] === 'boolean') out.events[id] = events[id];
    }
  }
  for (const id of LOCKED_ON) out.events[id] = true;
  return out;
}

// WHICH EVENT A PASSIVE BANNER IS ABOUT, from SERVER-STAMPED facts only: a decision card
// (`metadata.escalation`, or a display carrying a `choice` block — `display/core/adapt.ts ›
// displayOf`), else a DIRECT channel (the server's own 1:1 flag), else a mention/reply.
function eventForMessage(m, entry) {
  const meta = m && m.metadata && typeof m.metadata === 'object' ? m.metadata : null;
  if (meta) {
    const esc = meta.escalation;
    if (esc && typeof esc === 'object' && !Array.isArray(esc)) return 'decision';
    const display = meta.display;
    const blocks = display && typeof display === 'object' ? display.blocks : null;
    if (Array.isArray(blocks) && blocks.some((b) => b && b.type === 'choice')) return 'decision';
  }
  if (entry && entry.channel && entry.channel.isDirect === true) return 'direct_message';
  return 'mention';
}

function allowsIn(prefs, eventId) {
  if (EVENT_IDS.indexOf(eventId) === -1) return true; // an event this build cannot name: notify
  return normalizePrefs(prefs).events[eventId] !== false;
}
// ─── END NOTIFICATION-PREFS PURE ───

function getPrefs() {
  try {
    return normalizePrefs(store.get(KEY));
  } catch (_err) {
    return defaultPrefs();
  }
}

/** Writes the normalized record; answers `{ ok, prefs }` with what the store now holds. */
function setPrefs(raw) {
  const next = normalizePrefs(raw);
  try {
    store.set(KEY, next);
  } catch (_err) {
    return { ok: false, prefs: getPrefs() };
  }
  return { ok: true, prefs: getPrefs() };
}

/** The gate: may a passive banner about this message show? Never throws, fails toward ON. */
function allowsMessage(m, entry) {
  try {
    return allowsIn(getPrefs(), eventForMessage(m, entry));
  } catch (_err) {
    return true;
  }
}

module.exports = {
  EVENT_IDS,
  defaultPrefs,
  normalizePrefs,
  eventForMessage,
  allowsIn,
  getPrefs,
  setPrefs,
  allowsMessage,
};
