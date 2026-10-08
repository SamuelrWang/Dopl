// THE SELF-UPDATING RUNTIME (Samuel, 2026-10-01). A bundled CLI pinned to a Dopl release goes stale the
// day its vendor ships a model it does not know ("API Error: 400 … version 2.1.251 or newer is
// required"), so each runtime that declares an update source (`<adapter>/update-source.js`) also tracks
// its vendor's newest published build:
//   at start, and every CHECK_INTERVAL_MS after (unref'd, never awaited by anything on the launch path)
//   → registry metadata → newer than what launches run, not rejected → download (sha512) → unpack into
//   staging → every Mach-O signed by the vendor's team → `--version` answers → THE BUILD'S OWN PROTOCOL
//   DESCRIPTION covers the adapter's `requiredShape` (safety + core tiers, `sdk-shape.js`) → rename into
//   `<userData>/runtimes/<id>/<version>/` → repoint `active.json` (last good kept).
// ⚠ SHAPE, NOT VERSION, IS THE COMPATIBILITY GATE (2026-10-08). A version range is a guess about the
//   protocol; the candidate's own schema is the protocol. A runtime whose source cannot describe a build
//   (`probeShape` absent) is never auto-updated — it runs its bundle, the one build its adapter shipped with.
//   A build missing a required item is added to `rejected` as `<version>#shape:<requirement hash>`: never
//   re-downloaded by a Dopl with the same requirement, checked afresh by one whose requirement changed.
//   A probe that FAILS (timeout, crash) is not a verdict: the check fails, the staging is discarded, and the
//   next check tries again.
// Any failure discards the staging directory and keeps what launches run now.
//
// ⚠ BUNDLED IS THE FLOOR, NOT A PEER. `activeFor` answers a download only when it is STRICTLY newer than
//   the bundled build, so a Dopl release carrying a newer CLI wins over an older download with no
//   cleanup step; every caller falls back to its bundle on `null`.
// ⚠ ONLY NEW LAUNCHES MOVE. A running child keeps the file it was spawned from. `prune` runs at start only
//   (no child of this process exists yet), keeps the active and last good builds, and spares every version
//   a running process on this Mac executes from (`ps`): a child that outlived a crashed Dopl, or another
//   Dopl on the same userData. When `ps` cannot answer, nothing is pruned.
// ⚠ NOTHING DOWNLOADED IS LOADED INTO THIS PROCESS. Only the executable is exec'd, always driven by the
//   bundled adapter code; whether that pairing holds is the shape gate above, and a build that then
//   fails its first handshake is `reject`ed back to the last good one (or the bundle).
// ⚠ macOS ONLY: the proof is `codesign`. A source answering no `pkg` (any other platform) is never
//   checked and always runs its bundle.

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { compareVersions } = require('../../min-version');
const registry = require('./registry');
const verify = require('./verify');
const { createStore } = require('./store');
const { diag } = require('../../diag');

const START_DELAY_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const TAR = '/usr/bin/tar';
const PS = '/bin/ps';

/** `{ code, stdout }`, never rejects: a spawn error is a non-zero code. */
function runFile(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: (opts && opts.timeout) || 60000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

function defaultDeps() {
  return {
    // Lazy: the registry is required by electron-free harnesses that never resolve a path.
    baseDir: () => path.join(require('electron').app.getPath('userData'), 'runtimes'),
    fetchImpl: (...args) => fetch(...args),
    run: runFile,
    // Every running process's executable path (`comm` is the full exec path on macOS), or null when `ps`
    // cannot answer — which prunes nothing.
    runningExecutables: async () => {
      const r = await runFile(PS, ['-axww', '-o', 'comm='], { timeout: 15000 });
      return r.code === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : null;
    },
    // A switch re-reads the roster; lazy, `model-catalog` reaches the registry that requires this file.
    invalidate: (id) => {
      require('../model-catalog').invalidate(id, 'runtime-updated');
      require('../sdk-shape').forgetShape(id);
    },
    // The adapter's own declaration, read live (one source); lazy, the registry requires this file.
    requiredShape: (id) => {
      const d = require('../index').descriptorFor(id);
      return (d && d.requiredShape) || null;
    },
  };
}
let deps = defaultDeps();
let store = null;
// id → `{ path, version }` | null: what `active.json` names and is on disk. `activeFor` runs on every
// launch and roster-key look, so the disk is read once per switch, not per call.
const onDisk = new Map();
const sources = new Map();
const inflight = new Map();
// id → the last check's outcome word: what `runtime-copy.js` may truthfully tell an operator to do next.
const outcomes = new Map();
let timer = null;
// The start-time prune; every check waits for it, so a prune never races an install's staging directory.
let pruning = Promise.resolve();

function diskStore() {
  if (!store) store = createStore(deps.baseDir());
  return store;
}

const newer = (a, b) => !b || compareVersions(a, b) === 1;

function readActive(source) {
  try {
    const { version } = diskStore().read(source.id);
    const bin = version ? source.binary(diskStore().versionDir(source.id, version)) : null;
    return bin && fs.existsSync(bin) ? { path: bin, version } : null;
  } catch (_) {
    return null; // no userData (harness) or an unreadable tree: the bundle
  }
}

/** The verified download NEW launches of this runtime run, `{ path, version }`, or null for the bundle. */
function activeFor(source) {
  if (!source.pkg) return null;
  if (!onDisk.has(source.id)) onDisk.set(source.id, readActive(source));
  const active = onDisk.get(source.id);
  return active && newer(active.version, source.bundledVersion()) ? active : null;
}

// A resolver may hand back the canonical path (`codex/resolve-bin.js › inspectCandidate`).
function samePath(a, b) {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch (_) { return a === b; }
}

function switched(source) {
  onDisk.delete(source.id);
  if (typeof source.onSwitch === 'function') source.onSwitch();
  deps.invalidate(source.id);
}

async function install(source, meta, version) {
  const s = diskStore();
  const staging = s.stage(source.id);
  try {
    const tgz = path.join(staging, 'package.tgz');
    await registry.download(meta, tgz, deps.fetchImpl);
    // bsdtar refuses absolute and `..` member paths by default; npm packs everything under `package/`.
    const untar = await deps.run(TAR, ['-xzf', tgz, '-C', staging]);
    if (untar.code !== 0) throw new Error('the package did not unpack');
    const root = path.join(staging, 'package');
    const bin = source.binary(root);
    await verify.signatures(root, bin, source.teamId, deps.run);
    await verify.answersVersion(bin, deps.run);
    await shapeGate(source, bin);
    s.commit(source.id, version, root);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** A candidate refused by the SHAPE gate. The verdict is a property of the build AND of what this Dopl
 *  requires (cross-review M4), so it is recorded as `<version>#shape:<hash of requiredShape>`: the same Dopl
 *  never downloads it again, and a Dopl whose requirement changed checks it afresh. */
class ShapeRefused extends Error {}

/** A stable short hash of a runtime's `requiredShape` (key order normalized), or '' when none. */
function requirementHash(required) {
  if (!required) return '';
  const norm = (v) => (Array.isArray(v) ? v.map(norm)
    : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {}) : v);
  return require('crypto').createHash('sha256').update(JSON.stringify(norm(required))).digest('hex').slice(0, 12);
}
const shapeRejection = (version, required) => `${version}#shape:${requirementHash(required)}`;

/** Throw unless the candidate's own protocol description covers the adapter's safety + core tiers. A probe
 *  error propagates as an ordinary failure (retried next check) — it is not evidence of a gap. */
async function shapeGate(source, bin) {
  const sdkShape = require('../sdk-shape');
  const required = deps.requiredShape(source.id);
  if (!required) throw new Error('the adapter no longer declares a required protocol');
  const observed = await source.probeShape(bin, deps.run);
  const verdict = sdkShape.checkShape(required, observed);
  if (verdict.refuse) {
    throw new ShapeRefused(`missing ${verdict.missing.safety.concat(verdict.missing.core).join(', ')}`);
  }
  if (verdict.missing.cosmetic.length) {
    diag(`runtime-updates: ${source.id} candidate lacks cosmetic items`, verdict.missing.cosmetic.join(', '));
  }
}

/** One check for one runtime → the outcome word (also the diag line). Never rejects. */
async function check(source) {
  if (!source.pkg) return 'unsupported';
  // No way to read a candidate's protocol = no way to vouch for it: the bundle stays.
  if (typeof source.probeShape !== 'function' || !deps.requiredShape(source.id)) return 'unsupported';
  let version = null;
  try {
    const meta = await registry.latest(source.pkg, source.tag, deps.fetchImpl);
    version = source.versionOf(meta.version);
    const s = diskStore();
    const record = s.read(source.id);
    const downloaded = (activeFor(source) || {}).version || null;
    if (!newer(version, downloaded || source.bundledVersion())) return 'current';
    // A handshake rejection is the build's alone; a shape refusal counts only against THIS requirement.
    if (record.rejected.includes(version) || record.rejected.includes(shapeRejection(version, deps.requiredShape(source.id)))) {
      return 'rejected';
    }
    await install(source, meta, version);
    s.write(source.id, { version, previous: downloaded, rejected: record.rejected });
    switched(source);
    diag(`runtime-updates: ${source.id} now ${version}`);
    return 'updated';
  } catch (err) {
    if (err instanceof ShapeRefused && version) {
      const s = diskStore();
      const record = s.read(source.id);
      s.write(source.id, Object.assign({}, record, {
        rejected: record.rejected.concat(shapeRejection(version, deps.requiredShape(source.id))),
      }));
      diag(`runtime-updates: ${source.id} ${version} refused by the protocol check`, err.message);
      return 'incompatible-shape';
    }
    diag(`runtime-updates: ${source.id} check failed`, err && err.message);
    return 'failed';
  }
}

/** Check now (the outdated-runtime error path); joins a check already running for this runtime. */
function checkNow(runtimeId) {
  const source = sources.get(runtimeId);
  if (!source) return Promise.resolve('unsupported');
  if (!inflight.has(runtimeId)) {
    const run = pruning.then(() => check(source)).then((outcome) => {
      outcomes.set(runtimeId, outcome);
      return outcome;
    });
    inflight.set(runtimeId, run.finally(() => inflight.delete(runtimeId)));
  }
  return inflight.get(runtimeId);
}

/** The last finished check's outcome word for this runtime, or null when none has finished. */
function lastOutcome(runtimeId) {
  return outcomes.get(runtimeId) || null;
}

/** The version directories of this runtime that a running process executes from. */
function versionsInUse(source, running) {
  const roots = new Set([diskStore().runtimeDir(source.id)]);
  try { roots.add(fs.realpathSync(diskStore().runtimeDir(source.id))); } catch (_) { /* not there yet */ }
  const inUse = new Set();
  for (const exe of running) {
    for (const root of roots) {
      if (!exe.startsWith(root + path.sep)) continue;
      const version = exe.slice(root.length + 1).split(path.sep)[0];
      if (version) inUse.add(version);
    }
  }
  return inUse;
}

/** Prune every registered runtime, sparing what a running process executes from; never rejects. */
async function pruneIdle(list) {
  let running = null;
  try { running = await deps.runningExecutables(); } catch (_) { running = null; }
  if (!Array.isArray(running)) {
    diag('runtime-updates: prune skipped (no process list)');
    return;
  }
  for (const source of list) {
    try {
      const inUse = versionsInUse(source, running);
      if (inUse.size) diag(`runtime-updates: ${source.id} prune spares ${[...inUse].join(', ')} (running)`);
      diskStore().prune(source.id, inUse);
    } catch (err) {
      diag('runtime-updates: prune failed', err && err.message);
    }
  }
}

/**
 * The download at `binPath` failed its first handshake: never run or fetch that build again, and point
 * new launches back at the last good one (the bundle when there is none). A path that is not the
 * active download is ignored, so callers may report every failure.
 */
function reject(source, binPath) {
  const active = activeFor(source);
  if (!active || !binPath || !samePath(active.path, binPath)) return false;
  const s = diskStore();
  const record = s.read(source.id);
  s.write(source.id, { version: record.previous, previous: null, rejected: record.rejected.concat(active.version) });
  diag(`runtime-updates: ${source.id} ${active.version} rejected`);
  switched(source);
  return true;
}

/** Register the sources, prune the builds nothing runs (app start), and schedule the checks. Returns the
 *  prune (tests); nothing on the app's path awaits it. */
function start(list) {
  const registered = [];
  for (const source of list) {
    if (!source.pkg) continue;
    sources.set(source.id, source);
    registered.push(source);
  }
  if (registered.length) pruning = pruneIdle(registered);
  if (timer || !sources.size) return pruning;
  const sweep = () => { for (const id of sources.keys()) checkNow(id); };
  setTimeout(sweep, START_DELAY_MS).unref();
  timer = setInterval(sweep, CHECK_INTERVAL_MS);
  timer.unref();
  return pruning;
}

/** Tests: swap the dependencies and drop every registration. */
function inject(overrides) {
  deps = Object.assign(defaultDeps(), overrides || {});
  store = null;
  onDisk.clear();
  sources.clear();
  inflight.clear();
  outcomes.clear();
  pruning = Promise.resolve();
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { activeFor, check, checkNow, lastOutcome, reject, start, inject };
