// THE LAST-LIVE STORE — what a runtime's LIVE sources last answered (model roster, protocol shape),
// persisted per runtime so a cold boot has an answer before the first live read lands.
//
// ⚠ A CACHE, NEVER A SOURCE. Every value is keyed by the runtime's build key (`roster-key.js`) at write time and
// is only ever used when that key still matches (same binary, same account): a different key means
// a different build, and its last answer proves nothing about this one.
// ⚠ IT CAN NEVER BREAK A BOOT. The file is schema-versioned; a missing, unreadable, partial, corrupt
// or other-version file is IGNORED (treated as empty) and rewritten whole on the next save. Every
// fs error is swallowed into a diag line. Writes are atomic (tmp + rename) so a crash mid-write
// leaves the previous file, not half of one.
// ⚠ NO VENDOR NAMES, NO MODEL IDS. It stores whatever the shared layer hands it.

const fs = require('node:fs');
const path = require('node:path');

const FILE_SCHEMA = 1;
const FILE_NAME = 'runtime-live.json';

// `rates` (2026-10-08): learned per-model cost rates (`claude/cost-rates.js`), filed under one constant key.
const KINDS = Object.freeze(['roster', 'shape', 'rates']);

let deps = null;
let memo = null; // { schema, entries: { "<kind>:<runtimeId>": { key, value, savedAt } } }

function defaultDeps() {
  return {
    // Lazy: electron-free harnesses never resolve a path unless they save.
    file: () => path.join(require('electron').app.getPath('userData'), FILE_NAME),
    readFile: (f) => fs.readFileSync(f, 'utf8'),
    writeFile: (f, text) => {
      const tmp = `${f}.${process.pid}.tmp`;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, f);
    },
    diag: (...args) => { try { require('../diag').diag(...args); } catch (_) { /* never fails a read */ } },
  };
}

function d() { return deps || (deps = defaultDeps()); }

const empty = () => ({ schema: FILE_SCHEMA, entries: {} });

/** Parse a file's text, or null when it is anything but a whole file of THIS schema. */
function parse(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (_) { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema !== FILE_SCHEMA) return null;
  if (!raw.entries || typeof raw.entries !== 'object' || Array.isArray(raw.entries)) return null;
  const entries = {};
  for (const k of Object.keys(raw.entries)) {
    const e = raw.entries[k];
    // An entry with no key or no value is partial: dropped alone, the rest survive.
    if (!e || typeof e !== 'object' || typeof e.key !== 'string' || !e.key || e.value == null) continue;
    entries[k] = { key: e.key, value: e.value, savedAt: typeof e.savedAt === 'number' ? e.savedAt : 0 };
  }
  return { schema: FILE_SCHEMA, entries };
}

function load() {
  if (memo) return memo;
  let file;
  try { file = d().file(); } catch (err) {
    d().diag('live-store: no path, nothing persisted —', err && err.message);
    return (memo = empty());
  }
  let text = null;
  try { text = d().readFile(file); } catch (_) { /* no file yet: empty */ }
  const parsed = text == null ? empty() : parse(text);
  if (!parsed) d().diag('live-store: unreadable or other-schema file ignored, rebuilt on next save');
  return (memo = parsed || empty());
}

const slot = (kind, runtimeId) => `${kind}:${runtimeId}`;

function checkKind(kind) {
  if (KINDS.indexOf(kind) === -1) throw new Error(`live-store: unknown kind "${kind}"`);
}

/** The value last saved for `(kind, runtimeId)` under `key`, or null (no entry, or another key). */
function read(kind, runtimeId, key) {
  checkKind(kind);
  if (typeof key !== 'string' || !key) return null;
  const e = load().entries[slot(kind, runtimeId)];
  return e && e.key === key ? e.value : null;
}

// Writes are BATCHED (final review L6): a frequent saver (per-turn rates) must not rewrite the whole file on
// the main thread every time. The in-memory copy is current at once; the file follows within FLUSH_MS, and is
// flushed synchronously at process exit so nothing remembered is lost on quit.
const FLUSH_MS = 2000;
let pending = null;

function flush() {
  if (pending) { clearTimeout(pending); pending = null; }
  if (!memo) return true;
  try {
    d().writeFile(d().file(), JSON.stringify(memo));
    return true;
  } catch (err) {
    d().diag('live-store: save failed, kept in memory only —', err && err.message);
    return false;
  }
}

let exitHooked = false;
function scheduleFlush() {
  if (!exitHooked) { exitHooked = true; process.once('exit', flush); }
  if (pending) return;
  pending = setTimeout(flush, FLUSH_MS);
  if (pending && typeof pending.unref === 'function') pending.unref();
}

/** Remember `value` for `(kind, runtimeId)` under `key`. Never throws; false when not kept. The file is
 *  written within FLUSH_MS (or at exit); `opts.now` writes it at once and answers whether that worked. */
function save(kind, runtimeId, key, value, opts) {
  checkKind(kind);
  if (typeof key !== 'string' || !key || value == null) return false;
  const state = load();
  state.entries[slot(kind, runtimeId)] = { key, value, savedAt: Date.now() };
  if (opts && opts.now) return flush();
  scheduleFlush();
  return true;
}

/** Tests only: swap the fs/path seams and drop the in-memory copy. */
function inject(next) {
  if (pending) { clearTimeout(pending); pending = null; }
  deps = next ? Object.assign(defaultDeps(), next) : null;
  memo = null;
}

module.exports = { FILE_SCHEMA, FILE_NAME, KINDS, FLUSH_MS, read, save, flush, inject, _parse: parse };
