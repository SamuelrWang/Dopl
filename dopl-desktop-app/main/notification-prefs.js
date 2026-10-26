// NOTIFICATION PREFERENCES — THE OPERATOR'S ACCOUNT RECORD, AND THE BANNER GATE THAT READS IT
// (2026-10-09, KB dopl-development "Notifications Audit 2026-10-08"). The profile popup's
// Notifications tab writes it over `/api/user/notification-preferences`.
//
// ⚠ ONE CALL SITE ASKS `allowsMessage` DIRECTLY — `trigger.js › sendFyi`, which asks before it
// even builds the copy for a muted event. Everything else is gated INSIDE the route
// (`notification-route.js › raise` / `raiseActionable`, over `allowsIn`), so there is exactly one
// place a notice can be raised and exactly one place the switch is read. This header named
// `thread-notify.js › notifyThreadReply` as a second direct caller until 2026-10-10; it is not one,
// and `test/notification-prefs.test.mjs` now FORBIDS it from growing a copy of the gate back.
//
// ⚠ THE RECORD IS THE ACCOUNT'S, NOT THIS MAC'S (Samuel, 2026-10-09). One setting per user,
// honored by every computer they sign in on, served by the route above
// (`src/features/notifications/server/repository.ts`, table `notification_preferences`).
//
// ⚠ AND THERE IS NO LOCAL COPY — NOTHING WAS MIGRATED AND NOTHING FALLS BACK. This module used
// an electron-store key (`notificationPrefs`) for one afternoon, in a build that never shipped
// (the tab landed after v1.39.0; v1.40.0 is untagged and unpushed), so no installed app ever
// wrote one. A second copy on disk could only disagree with the account, so there is none.
//
// ⚠ THE GATE IS SYNCHRONOUS AND NEVER AWAITS. Both call sites are plain sync functions on the
// listener's drain path, where a round trip would stall the loop that is reading messages. So the
// account record is CACHED in memory and refreshed in the BACKGROUND: `allowsMessage` reads the
// cache and nothing else. A switch flipped on THIS machine pokes `refresh(true)` through
// `notifications:refreshPrefs` (channel-dir-ipc.js), so it lands on the next banner; one flipped
// on another computer lands within `TTL_MS`.
//
// ⚠ DEFAULT ON, AND EVERY FAILURE READS ON — no record yet, signed out, a 503 while the table is
// unapplied, a dead network. The cache simply stays empty and the gate answers the defaults. An
// unreadable record must not quietly mute the operator: a banner nobody asked to silence is
// recoverable, a silenced one is not noticed.
//
// ⚠ IT CAN ONLY SILENCE A BANNER, NEVER RAISE ONE, AND NEVER CHANGE A VERDICT. A banner it
// suppresses still has its durable record (the Tags inbox, the thread itself); no route, consent
// row or spawn reads this module.
//
// ⚠ `approval` IS ALWAYS ON. Every approval banner carries the ONE button that answers it
// (`notify-action.js`), so those call sites are not gated at all; the key is forced on at every
// read here so the tab, the server and the gate can never disagree about it.

const PREFS_PATH = '/api/user/notification-preferences';
// Bounds the BACKGROUND read only — no banner waits on it.
const REFRESH_TIMEOUT_MS = 5000;
// How stale the cache may get: a switch flipped on another computer lands within this.
const TTL_MS = 60000;
// One read per this window at most, so a signed-out or offline app does not fetch per banner.
const RETRY_FLOOR_MS = 10000;

// ─── BEGIN NOTIFICATION-PREFS PURE (no network, no electron; sliced by the tests) ───
// Restated from src/features/notifications/registry.ts › NOTIFICATION_EVENT_IDS. Keep in sync.
// ⚠ THE ORDER AND THE MEMBERS MUST MATCH THAT ARRAY EXACTLY — test/notification-prefs.test.mjs
// ("registry ids match the web registry") reads that file as text and deepEquals this list. An id
// there and missing HERE is worse than a test failure: `allowsIn` below fails toward ON for an id
// it cannot name, so the operator would see a switch, turn it off, and still get banners.
const EVENT_IDS = [
  'mention', 'decision', 'direct_message', 'approval', 'peer_ask',
  'draft_reply', 'agent_started', 'signed_out', 'credits_exhausted',
  'runtime_signin', 'decision_failed', 'tool_blocked', 'session_resume', 'shared_with_me',
  'agent_dropped',
];
// `approval` plus the four SAFETY events Samuel kept at #2775 ("always on, like approvals").
const LOCKED_ON = ['approval', 'signed_out', 'credits_exhausted', 'runtime_signin', 'decision_failed'];
// WHERE EACH EVENT RAISES, restated from the registry's `surface`. Same fence as EVENT_IDS: the
// parity test reads registry.ts and checks every id AND its surface against this map.
// 'both' does NOT mean twice — see notification-route.js, which picks the one surface the
// operator can actually see.
const SURFACE = {
  mention: 'both',
  decision: 'both',
  direct_message: 'mac',
  approval: 'both',
  peer_ask: 'both',
  draft_reply: 'both',
  agent_started: 'both',
  signed_out: 'both',
  credits_exhausted: 'both',
  runtime_signin: 'both',
  decision_failed: 'both',
  tool_blocked: 'popup',
  session_resume: 'popup',
  shared_with_me: 'popup',
  // The counterpart to `agent_started`: an agent that STOPPED without reporting. See the web
  // registry's note — it marks work stopping silently, but it is default ON and not locked,
  // because the channel post is the durable record and the banner is only the interruption.
  agent_dropped: 'both',
};
// ⚠ THE ONE EVENT THAT DEFAULTS OFF, mirroring the registry's `defaultOn: false`. Samuel ruled
// DMs out entirely (#2773), so silence is the answer he gave, not a record we failed to read.
// If this drifts from the web list the two surfaces disagree about a default, which is the same
// class of lie as a missing id.
const DEFAULT_OFF = ['direct_message'];

function defaultPrefs() {
  const events = {};
  for (const id of EVENT_IDS) events[id] = DEFAULT_OFF.indexOf(id) === -1;
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

// The account record as last read, and when. `null` = never read successfully, which the gate
// answers as the defaults (ON).
let cached = null;
let cachedAt = 0;
let nextTryAt = 0;
let inFlight = null;

async function fetchPrefs() {
  const res = await require('./api').apiFetch(PREFS_PATH, {
    method: 'GET',
    timeoutMs: REFRESH_TIMEOUT_MS,
    noStore: true,
  });
  // A 404 (older deployment) and a 503 (`NOT_AVAILABLE`, table not applied) are not errors worth
  // distinguishing here: both mean "no record to honor", which is every banner on.
  if (!res || !res.ok) throw new Error(res ? `HTTP ${res.status}` : 'no response');
  const body = await res.json();
  return normalizePrefs(body && body.prefs);
}

/**
 * Reads the account record into the cache. Fire-and-forget, deduped, NEVER throws and never
 * clears a good cache on failure.
 * @param {boolean} [force] ignore the retry floor (the operator just changed a switch here).
 * @returns {Promise<Object|null>} the record, or null when this attempt did not produce one.
 */
function refresh(force) {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (!force && now < nextTryAt) return Promise.resolve(null);
  nextTryAt = now + RETRY_FLOOR_MS;
  const run = fetchPrefs()
    .then((prefs) => {
      cached = prefs;
      cachedAt = Date.now();
      return prefs;
    })
    .catch((err) => {
      try {
        require('./diag').diag('notification prefs: not read —', (err && err.message) || 'error',
          '— every banner stays on');
      } catch (_) { /* best-effort */ }
      return null;
    });
  inFlight = run;
  // `run` already swallowed its own failure, so this only clears the de-dupe latch.
  void run.finally(() => { if (inFlight === run) inFlight = null; });
  return run;
}

/** The cached account record, or the defaults. Kicks a background read when stale. */
function getPrefs() {
  if (!cached || Date.now() - cachedAt > TTL_MS) void refresh();
  return cached || defaultPrefs();
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
  LOCKED_ON,
  SURFACE,
  defaultPrefs,
  normalizePrefs,
  eventForMessage,
  allowsIn,
  getPrefs,
  refresh,
  allowsMessage,
};
