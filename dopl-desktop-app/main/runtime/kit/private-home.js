// An app-owned, owner-only home directory for a vendor process, and the credential file inside it
// (docs/specs/runtime-scaffold.md §3 K8). Vendor-neutral and SECURITY-RELEVANT (INVARIANTS §11.0d): an
// adapter whose vendor reads ambient config from a home directory points that vendor at a home built
// here, so nothing of the operator's own home reaches the child. The adapter's `config-home.js` keeps the
// vendor parts — the env-var names, the home's NAME, which files count as ambient config, and the fence
// that refuses a launch when one is found. Moved verbatim from the first adapter's config-home.js
// (2026-10-13).
//
// 🔒 What this file guarantees: directories are `0700`, an installed credential is `0600` and MOVED in
// (never copied, never linked), and a SYMLINK where a credential should be is REMOVED, not followed — a
// link an older build made to the operator's own file must not be read through.

const fs = require('fs');
const os = require('os');
const path = require('path');

/** The app's userData dir. Electron is required LAZILY, at call time: plain-Node tests (and the
 *  electron-free registry load) use the bounded temp fallback. */
function appUserData() {
  try {
    const electron = require('electron');
    const value = electron && electron.app && electron.app.getPath('userData');
    if (value) return value;
  } catch (_) { /* plain-Node tests use the bounded temp fallback */ }
  return path.join(os.tmpdir(), `dopl-user-data-${typeof process.getuid === 'function' ? process.getuid() : 'local'}`);
}

/** `<userDataRoot or the app's userData>/<name>` — the app-owned home a launch runs against. */
function privateHome(name, userDataRoot) {
  return path.join(userDataRoot || appUserData(), name);
}

/** Create `dir` (and parents) owner-only, and re-assert `0700` on an existing one. */
function ownerOnlyDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) { /* best effort on non-POSIX filesystems */ }
}

/** A fresh, EMPTY owner-only directory: whatever was there is removed first. */
function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ownerOnlyDir(dir);
}

/** Remove a directory tree (idempotent). */
function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

const lstatOrNull = (file) => {
  try { return fs.lstatSync(file); } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
};

/** Does `dir` hold an entry whose NAME `matches`? An unreadable or absent dir holds none. */
function hasEntry(dir, matches) {
  try {
    return fs.readdirSync(dir).some(matches);
  } catch (_) {
    return false;
  }
}

/** Is `file` a REGULAR file? A symlink there is REMOVED and answers false — never followed. */
function ownedFile(file) {
  const st = lstatOrNull(file);
  if (st && st.isSymbolicLink()) {
    fs.unlinkSync(file);
    return false;
  }
  return !!st && st.isFile();
}

/** Remove one file (idempotent). */
function removeFile(file) {
  fs.rmSync(file, { force: true });
}

/** MOVE `src` to `dest` as an owner-only credential: `src` must be a regular file (else `missingMessage`
 *  is thrown), `dest`'s directory is made `0700`, the file `0600`, then renamed into place. */
function installFile(src, dest, missingMessage) {
  const st = lstatOrNull(src);
  if (!st || !st.isFile()) throw new Error(missingMessage);
  ownerOnlyDir(path.dirname(dest));
  fs.chmodSync(src, 0o600);
  fs.renameSync(src, dest);
}

module.exports = {
  appUserData, privateHome, ownerOnlyDir, freshDir, removeDir, lstatOrNull, hasEntry, ownedFile,
  removeFile, installFile,
};
