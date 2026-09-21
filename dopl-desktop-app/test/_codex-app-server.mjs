// BOUNDED `codex app-server` HANDSHAKES FOR TESTS — the helper U1 asks for.
//
// 🔒 ⚠ **A SKIP THAT READS AS A PASS IS THE FAILURE MODE THIS FILE IS DESIGNED AGAINST**
// (U1, `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`). The plan exists because a
// green suite meant nothing: 94 tests passed against synthetic fixtures while the adapter spoke a
// protocol the installed CLI rejects. A live tier that silently no-ops on every machine would
// reproduce that exactly, one layer up. So every skip here NAMES ITSELF — a banner on stdout at
// import time, a `t.diagnostic` per test, and a reason that says which of the two gates is shut.
//
// ⚠ **TWO GATES, AND THEY ARE DIFFERENT QUESTIONS.** `CODEX_APP_SERVER_LIVE=1` is "the operator
// asked for the live tier" (the `RLS_REDTEAM_LIVE=1` precedent, repo `CLAUDE.md` gate 11); a
// resolved binary is "this machine can answer". Arming without a binary is an ERROR, not a skip —
// the release command asks for live and must not be told a machine without Codex passed.
//
// 🔒 ⚠ **EVERY EXIT PATH KILLS THE CHILD.** Success, refusal, timeout and throw all run the same
// `finally`: close, wait for `exit`, `SIGKILL` on a grace timeout, and record the pid if it still
// answers `kill(pid, 0)`. An orphan `codex app-server` holds a session's channel access with
// nothing pointing at it to stop it, which is the two-children bug `client.js › connect` already
// guards on the app side.
//
// ⚠ **IT SPAWNS THROUGH `main/runtime/codex/client.js`, NEVER ITSELF.** That module is the only
// one in this tree allowed to touch a child process, and it spawns the path
// `main/runtime/codex/resolve-bin.js` resolved — so what a test measures is the binary the app
// would actually run. The one exception is `spawnSilentServer()` below, which starts a `node` that
// says NOTHING: it is a timeout fixture, not a protocol fixture, and it asserts nothing about
// Codex's wire.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
export const client = require(join(CODEX, 'client.js'));
export const resolveBin = require(join(CODEX, 'resolve-bin.js'));

export const LIVE_ENV = 'CODEX_APP_SERVER_LIVE';
export const FIXTURE_PATH = join(HERE, 'fixtures', 'codex-app-server.json');
export const REGENERATE_CMD = 'cd dopl-desktop-app && npm run codex:schema';
export const DEFAULT_TIMEOUT_MS = 20000;
const EXIT_GRACE_MS = 1500;
const EXIT_GIVE_UP_MS = 3500;

// ── THE GATES ────────────────────────────────────────────────────────────────────────────────

/**
 * May the live tier run here?
 *
 * `{ armed, reason, requested, bin }`. ⚠ `requested && !bin.ok` is `armed: false` with a reason
 * that says the operator ASKED and the machine could not — `liveOrThrow()` turns that into a
 * failure, because a release command that asked for live must never be told nothing ran.
 */
export function liveGate(env) {
  const e = env || process.env;
  const requested = String(e[LIVE_ENV] || '') === '1';
  const bin = resolveBin.resolveCodexBin();
  if (!requested) {
    return {
      armed: false,
      requested,
      bin,
      reason: `${LIVE_ENV} is not set to 1 — the live Codex app-server tier is opt-in for ordinary unit runs`
        + (bin.ok ? ` (a codex WAS found at ${bin.path}).` : ' (and no codex resolved on this machine either).'),
    };
  }
  if (!bin.ok) {
    return {
      armed: false,
      requested,
      bin,
      reason: `${LIVE_ENV}=1 was set but no Codex binary resolved — ${bin.reason}`,
    };
  }
  return { armed: true, requested, bin, reason: '' };
}

/** The banner. ⚠ Printed ONCE at import, so a skipped tier is visible in a scrolling run. */
let announced = false;
export function announceGate(gate) {
  if (announced) return gate;
  announced = true;
  const bar = '─'.repeat(78);
  if (gate.armed) {
    process.stdout.write(`\n${bar}\nCODEX LIVE CONTRACT TIER: ARMED — ${gate.bin.path} (${gate.bin.source})\n${bar}\n`);
  } else {
    process.stdout.write(
      `\n${bar}\nCODEX LIVE CONTRACT TIER: SKIPPED — NOTHING BELOW MEASURED A REAL app-server.\n`
      + `  reason: ${gate.reason}\n`
      + `  to run it: ${LIVE_ENV}=1 npm test   (needs a Codex CLI on this machine)\n${bar}\n`,
    );
  }
  return gate;
}

/**
 * Skip one test loudly. Returns `true` when the caller should RETURN without asserting.
 * ⚠ `t.diagnostic` as well as `t.skip`, because a TAP `# SKIP` with no reason next to it is how a
 * skipped tier comes to be read as a passing one.
 */
export function skipLive(t, gate) {
  if (gate.armed) return false;
  t.diagnostic(`SKIPPED, NOT PASSED — ${gate.reason}`);
  t.skip(gate.reason);
  return true;
}

/** For the release command: arming without a machine that can answer is an ERROR. */
export function liveOrThrow(env) {
  const gate = liveGate(env);
  if (gate.requested && !gate.armed) throw new Error(gate.reason);
  return gate;
}

// ── THE FIXTURE ──────────────────────────────────────────────────────────────────────────────

export function readFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/** ⚠ `true` only for a fixture a real CLI produced. A placeholder is never measured truth. */
export function fixtureIsMeasured(fixture) {
  return (fixture || {}).status === 'MEASURED';
}

// ── CHILD-PROCESS DISCIPLINE ─────────────────────────────────────────────────────────────────

const LEAKED = [];

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

/** Pids this helper started that were still answering after their `finally` ran. */
export function leakedPids() {
  return LEAKED.filter((pid) => alive(pid));
}

async function terminate(conn) {
  const child = conn && conn.child;
  try { if (conn && typeof conn.close === 'function') conn.close(); } catch (_) { /* best effort */ }
  if (!child) return;
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise((done) => {
    const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, EXIT_GRACE_MS);
    const giveUp = setTimeout(done, EXIT_GIVE_UP_MS);
    child.once('exit', () => { clearTimeout(hard); clearTimeout(giveUp); done(); });
  });
  if (alive(child.pid)) LEAKED.push(child.pid);
}

/**
 * Run `fn(conn)` against a bounded app-server connection and tear the child down afterwards.
 *
 * `opts` — `{ timeoutMs, args, connect }`. `connect` defaults to the real
 * `client.connect`; the timeout fixture injects `spawnSilentServer` instead.
 *
 * ⚠ THE TIMEOUT REJECTS AND THE CHILD STILL DIES. `Promise.race` leaves `fn` running, so the
 * teardown in `finally` is what guarantees the process ends — not the rejection.
 */
export async function withAppServer(opts, fn) {
  const o = opts || {};
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  const open = typeof o.connect === 'function' ? o.connect : (a) => client.connect(a);
  const conn = open({ args: o.args || [] });
  let timer = null;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`codex app-server did not answer within ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(conn)), budget]);
  } finally {
    clearTimeout(timer);
    await terminate(conn);
  }
}

/**
 * The handshake, as one call: `initialize`, then whatever `extra(conn)` asks for.
 * Returns `{ initialize, facts, extra, ms }`. ⚠ `facts` is what `client.checkProtocol` consumes.
 */
export async function handshake(opts) {
  const o = opts || {};
  const started = Date.now();
  return withAppServer(o, async (conn) => {
    const initialize = await conn.request('initialize', client.initializeParams(o.version || '0.0.0-test'));
    const extra = typeof o.extra === 'function' ? await o.extra(conn, initialize) : null;
    return { initialize, extra, ms: Date.now() - started };
  });
}

/**
 * A child that ACCEPTS STDIN AND NEVER ANSWERS.
 *
 * ⚠ IT IS A TIMEOUT FIXTURE, NOT A PROTOCOL FIXTURE. It asserts nothing about Codex's wire — it
 * cannot, because it speaks none. Inventing a synthetic app-server that answers `initialize` is
 * exactly what this unit forbids; a process that says nothing invents nothing.
 */
export function spawnSilentServer() {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
  return {
    child,
    request: () => new Promise(() => {}),
    notify: () => {},
    close: () => {
      try { child.stdin.end(); } catch (_) { /* best effort */ }
      try { child.kill(); } catch (_) { /* best effort */ }
    },
    isClosed: () => child.exitCode !== null,
  };
}
