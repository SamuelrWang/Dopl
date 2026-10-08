// THE DISK HALF of the runtime updater (`./index.js`). Per runtime, under `<base>/<runtimeId>/`:
//   `<version>/`      one verified package, exactly as unpacked
//   `active.json`     `{ version, previous, rejected }` — what new launches run, the last good one, and
//                     builds that failed a handshake and must not be fetched again
//   `.staging-*/`     an install in flight; never read, removed when it ends and at every prune
// Electron-free: `base` is handed in.
//
// ⚠ EVERY SWITCH IS A RENAME. A package lands in a staging directory on the same volume and is renamed
// into `<version>/` only after it verified; `active.json` is written beside itself and renamed over. A
// crash at any point leaves either the old pointer or the new one, never half of either.

const fs = require('node:fs');
const path = require('node:path');

const RECORD = 'active.json';
const STAGING_PREFIX = '.staging-';
const EMPTY = Object.freeze({ version: null, previous: null, rejected: [] });

const strOrNull = (v) => (typeof v === 'string' && v ? v : null);

function createStore(base) {
  const runtimeDir = (id) => path.join(base, id);
  const versionDir = (id, version) => path.join(runtimeDir(id), version);

  /** The pointer; a missing or unreadable one is EMPTY (launches run the bundle). */
  function read(id) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(runtimeDir(id), RECORD), 'utf8'));
      return {
        version: strOrNull(raw.version),
        previous: strOrNull(raw.previous),
        rejected: Array.isArray(raw.rejected) ? raw.rejected.filter((v) => typeof v === 'string') : [],
        // A candidate whose live safety probe was inconclusive: `{ version, attempts }` (2026-10-08).
        attention: raw.attention && strOrNull(raw.attention.version) && Number.isInteger(raw.attention.attempts)
          ? { version: raw.attention.version, attempts: raw.attention.attempts } : null,
      };
    } catch (_) {
      return { ...EMPTY, rejected: [] };
    }
  }

  function write(id, record) {
    const file = path.join(runtimeDir(id), RECORD);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }

  /** A fresh staging directory for one install; the caller removes it. */
  function stage(id) {
    fs.mkdirSync(runtimeDir(id), { recursive: true, mode: 0o700 });
    return fs.mkdtempSync(path.join(runtimeDir(id), STAGING_PREFIX));
  }

  /** Rename a verified package root into `<version>/`; a leftover of the same version is replaced. */
  function commit(id, version, pkgRoot) {
    const target = versionDir(id, version);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(pkgRoot, target);
  }

  /** Remove every version but the active and last-good ones and those in `keep` (a running process's), and
   *  every staging leftover. Call at app start only: a running child's package must never be removed under
   *  it, and `keep` is how one that outlived its Dopl (or another Dopl on this userData) is spared. */
  function prune(id, keep) {
    const { version, previous } = read(id);
    const spared = new Set(keep || []);
    let entries = [];
    try { entries = fs.readdirSync(runtimeDir(id), { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === version || entry.name === previous || spared.has(entry.name)) continue;
      fs.rmSync(path.join(runtimeDir(id), entry.name), { recursive: true, force: true });
    }
  }

  return { read, write, stage, commit, prune, versionDir, runtimeDir };
}

module.exports = { createStore };
