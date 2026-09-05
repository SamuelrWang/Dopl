// Session settings — the loop-safety caps, and nothing else any more.
//
// ONE home for the turn / idle-TTL / cost caps, so the launch paths
// (channel-listener.js / trigger.js) and the session engine all read the SAME source of truth.
// ⚠ THIS MODULE WRITES EXACTLY ONE KEY — `sessionTurnCap`, through `setTurnCap`. The idle-TTL
// and cost caps stay read-only; see the block above the keys for why the three setters went and
// why this one came back.
//
// ⚠ THE TWO WINDOW SWITCHES LIVED HERE AND ARE DELETED (2026-08-20). `getWindowMode()` was the
// master switch over the operator's own session windows and `getPreConsentWindow()` gated the
// pre-consent window; both were made to answer hard-OFF on Samuel's live-test ruling, and both
// were kept ONE WAVE LONGER THAN THE MACHINERY THEY GUARDED — deliberately, so that if the
// deletion had missed something it would stay disarmed rather than come back reachable. It did
// not, so they go: there is no window factory, no pre-consent registry, no requester route and
// no renderer left for either of them to refuse.
//
// ⚠ `sessionWindowMode` AND `preConsentWindowMode` ARE RETIRED STORE KEYS — never read, never
// written. A machine that ran an older build may still carry `sessionWindowMode: true` on disk;
// nothing reads it, and re-introducing a reader would resurrect the sender-side session pop-up
// for exactly the installs that used to have it. **Do not add one.** (F-228 is the record.)
// ⚠ `claudeSessions` JOINED THEM ON 2026-08-20 — the `claude -p` lane's resumable-session map,
// orphaned when that lane was deleted (`session-spawner.js`'s header carries the story). It is
// in `test/removed-vocabulary.test.mjs`'s RETIRED_STORE_KEYS with the other two.
//
// Kept electron-store-only (no electron UI, no fs beyond the store) so it stays a thin,
// dependency-light module the engine can require without pulling BrowserWindow.

const Store = require('electron-store');

const store = new Store();

// ⚠ THE THREE SETTERS ARE DELETED, AND WHAT REMAINS ARE COMPILE-TIME DEFAULTS (2026-08-20,
// Samuel's ruling). `setTurnCap` / `setIdleTtlMs` / `setCostCapUsd` had ZERO callers: the tray's
// "Sessions" submenu was the only surface that ever wrote them and it went with window mode
// (F-228). So the three store keys — `sessionTurnCap`, `sessionIdleTtlMs`, `sessionCostCapUsd`
// — became WRITE-NEVER, the getters always returned the compiled defaults, and this module was
// presenting as a settings store while being a constants file with a store in front of it.
//
// ⚠ THE READS STAY, AND THEY ARE NOT DEAD WEIGHT. An operator (or a support session) can still
// hand-edit the store, and the getters' fail-safe coercion is what stops a hand-edited NaN or a
// non-positive cap reaching the engine. Keeping the read path is what makes the value
// recoverable without a build; what is gone is the pretence that the app writes it.
//
// ⚠ A COST-CAP SETTINGS ROW IS A FUTURE BUILD IF SAMUEL WANTS ONE — noted here rather than
// left as an absence, because "there is no way to set this" reads like an oversight and it is
// a decision. The seam is a setter beside each getter and one row on the Settings tab.
//
// ⚠ AND THE TURN CAP TOOK THAT SEAM, EXACTLY AS DESCRIBED (2026-09-05, task 9b; Samuel's #1098
// via #1101 item 4b, ruled (a) in #1177). `setTurnCap` is below, beside its getter. This is NOT a
// reversal of the 2026-08-20 deletion and the block above is not stale: the three setters died
// because their ONLY writer (the tray's "Sessions" submenu) died with window mode, which is a
// statement about dead code and never a prohibition — the paragraph above names the revival seam,
// which is not what a prohibition does. The other two keys keep their absent setters, because
// nothing has ordered a control for them.
// ⚠ THE WRITE GOES HERE AND NOT IN `channel-prefs.js`, whose `orchestrator*` keys are also
// machine-global despite that file's name. `getTurnCap` is the documented authority every launch
// path reads, and splitting the write away from the read is how the two-copies bug the block
// above records comes back.

// electron-store keys — `sessionIdleTtlMs` / `sessionCostCapUsd` are READ-ONLY (see above);
// `sessionTurnCap` is written by `setTurnCap` and by nothing else in this app.
const TURN_CAP_KEY = 'sessionTurnCap'; // number; unset -> DEFAULT_TURN_CAP
const IDLE_TTL_KEY = 'sessionIdleTtlMs'; // number ms; unset -> DEFAULT_IDLE_TTL_MS
const COST_CAP_KEY = 'sessionCostCapUsd'; // number USD; unset / <=0 -> no cap

// ⚠ ONE STATEMENT OF EACH DEFAULT, IMPORTED RATHER THAN RETYPED (2026-08-20). These were
// SECOND copies: `session-state.js` declares `DEFAULT_TURN_CAP = 24`, `DEFAULT_IDLE_MS`
// (15 min) and `DEFAULT_COST_CAP_USD = 0` for the reducer's own fail-closed coercion, and this
// file declared the same three numbers again for the getters' fallback. Nothing pinned them
// together, and the drift would have been invisible: `session-engine.js` reads THESE and hands
// them to `applyOpts`, so a divergent pair would simply mean session-state's "documented
// defaults" never applied. `session-state.js` is a pure module with no requires of its own, so
// importing from it here cannot cycle.
// ⚠ `MAX_SESSION_WINDOWS` sat with them and is deleted: it was the WINDOW budget, and the
// ceiling that survives is `session-windowless.js › MAX_CONCURRENT_SESSIONS`, which is about
// running sessions rather than open windows.
const {
  defaultTurnCap,
  UNLIMITED_TURN_CAP,
  DEFAULT_IDLE_MS: DEFAULT_IDLE_TTL_MS,
  DEFAULT_COST_CAP_USD,
} = require('./session-state');

// ── Loop-safety caps (read by the session engine) ────────────────────────────
// Each getter fails safe to its documented default on an absent / malformed value, so a
// hand-edited store can never hand the engine a NaN or a non-positive cap.
// ⚠ THE STORED SETTING IS THE AUTHORITY; THE ISSUER ONLY KEYS THE FALLBACK (2026-09-05, task 9a).
// `launchDepth` picks WHICH documented default applies when the operator has set nothing —
// `session-state.js › defaultTurnCap`, where both numbers are declared. It never post-processes
// the operator's value: a hand-set cap means that cap for every session, button-launched or not.
// An absent depth lands on the agent number by construction (see defaultTurnCap's fail-closed
// note), so a caller that forgets to pass one narrows itself rather than widening.
// ⚠ AND 0 MEANS UNLIMITED (2026-09-05, task 9b, Samuel's #1098). It used to mean nothing: the
// `n > 0` conjunct sent it to the default, so the one value an operator would type to say "stop
// stopping me" was indistinguishable from an unset key. It is now the explicit no-cap answer, and
// the engine's spelling of it is `UNLIMITED_TURN_CAP` (Infinity) — see session-state.js for why
// the state may not carry the 0 itself.
// ⚠ ONLY A 0 THE OPERATOR ACTUALLY SET COUNTS, which is why the raw value is read by TYPE before
// it is coerced. `Number('')`, `Number(null)` and `Number(false)` are all 0, and an empty or
// hand-mangled key must stay "unset -> the documented default" rather than silently unbounding
// every session on this machine. A negative or non-numeric value is junk and lands on the default
// too; nothing here can produce a cap of zero.
// ⚠ THE READ IS IN TWO HALVES NOW, AND THE SPLIT IS THE ANTI-DRIFT MEASURE (2026-09-05, task 9b,
// the control's backend). `readTurnCapSetting` answers WHAT THE OPERATOR SET — `null` for unset
// (and for junk, which is the same thing to every caller), `0` for unlimited, or a positive
// integer. `getTurnCap` answers WHAT A SESSION GETS: the same value with the issuer-keyed default
// filled in and the 0 spelled as the engine's `UNLIMITED_TURN_CAP`.
// ⚠ THE CONTROL NEEDS THE FIRST ONE AND CANNOT USE THE SECOND. A row that renders `getTurnCap`
// cannot tell UNSET from a hand-typed 24, and unset (the default applies, and which default
// depends on who launches) and 24 (that cap for every session on this machine) are different
// facts. A control that shows them as one thing lies. #1179 item 7 is the semantics it states.
// ⚠ AND THE COERCION IS WRITTEN ONCE. Re-deriving "what did they set" in the IPC layer, or in the
// setter, is the two-copies bug this file's header already records once — in a worse shape, since
// the two copies would be a reader and a writer of the same key.
function readTurnCapSetting() {
  const raw = store.get(TURN_CAP_KEY);
  const n = typeof raw === 'number' ? raw
    : typeof raw === 'string' && raw.trim() !== '' ? Number(raw)
      : NaN;
  if (n === 0) return 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getTurnCap(launchDepth) {
  const set = readTurnCapSetting();
  if (set === 0) return UNLIMITED_TURN_CAP;
  return set === null ? defaultTurnCap(launchDepth) : set;
}

// ⚠ THE ONE WRITER. It MIRRORS the read above rather than validating in its own vocabulary, so
// what goes in is what comes back out:
//   • `null` / `''` (and any all-whitespace string) DELETE the key — back to unset, which is the
//     issuer-keyed default. This is the only way back, so the control must be able to send it.
//   • `0` (or `'0'`) writes 0 — the explicit no-cap answer. Note it is written as a REAL 0 and
//     never as the engine's Infinity: `Infinity` does not survive a JSON store round-trip, and
//     `session-state.js` records why the state may not carry the 0 itself. Each side keeps its
//     own spelling and `getTurnCap` is the translation.
//   • a positive number floors, exactly as the read floors it.
//   • ANYTHING ELSE WRITES NOTHING. A junk value is not a request to unset — an unrecognised
//     write silently clearing the operator's cap is worse than a refused one, and the caller
//     learns which happened from the answer, not from a thrown error.
// ⚠ IT ANSWERS THE STORE'S OWN VALUE, RE-READ, never an echo of the argument. That is what lets
// the IPC pair above it report `{ok:false}` on a write that did not take, and an optimistic SPA
// stamp revert instead of showing a cap nothing is enforcing (`channel-dir-ipc.js`'s orchestrator
// pair carries the same rule and the same reason).
// ⚠ IT DOES NOT REACH LIVE SESSIONS, BY RULING (#1177). A running session re-reads nothing; the
// cap is read once at launch (`session-engine.js › readCaps`) and a mid-run mutation of the state
// would go around the reducer, which owns every transition. The control's label says "applies to
// new sessions" for that reason, and the proper reducer event is a build of its own.
// ⚠ AND THE ARGUMENT'S COERCION IS ITS OWN FUNCTION FOR ONE REASON: THE IPC BOUNDARY NEEDS THE
// SAME ANSWER. `channel-dir-ipc.js › settings:setTurnCap` has to decide whether the store ended up
// holding WHAT WAS ASKED FOR — that is the `{ok:false}` an optimistic control reverts on — and
// deciding it there means a second reading of what "asked for" means. It would disagree first on
// `false`, which `Number` turns into 0: the boundary would report a machine successfully unbounded
// while this module correctly wrote nothing. One statement, three callers.
//   null   → clear the key (unset)
//   int≥0  → write exactly this
//   undefined → NOT A REQUEST AT ALL. Junk, and distinct from `null`, which IS a request.
function normalizeTurnCapInput(value) {
  const v = typeof value === 'string' ? value.trim() : value;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function setTurnCap(value) {
  const want = normalizeTurnCapInput(value);
  if (want === null) store.delete(TURN_CAP_KEY);
  else if (want !== undefined) store.set(TURN_CAP_KEY, want);
  return readTurnCapSetting();
}

function getIdleTtlMs() {
  const n = Number(store.get(IDLE_TTL_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_IDLE_TTL_MS;
}

// 0 (or unset / non-positive) means NO cost cap. A positive value caps a session's
// cumulative cost; the engine ends the session (task stays open) when it is crossed.
function getCostCapUsd() {
  const n = Number(store.get(COST_CAP_KEY));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COST_CAP_USD;
}

module.exports = {
  getTurnCap,
  readTurnCapSetting, // what the OPERATOR set (null | 0 | positive) — the control's read
  setTurnCap, // …and the only writer of that key
  normalizeTurnCapInput, // …and what the boundary asks so it never re-reads the same rules
  getIdleTtlMs,
  getCostCapUsd,
};
