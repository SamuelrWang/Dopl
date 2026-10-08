// THE COMPOSER'S DICTATION ENGINE ON THE DESKTOP (2026-10-08).
//
// ⚠ WHY THIS EXISTS: the web tree's `webkitSpeechRecognition` can never work in Electron. It posts
// audio to Google's speech API with the Chromium build's key and Electron ships none, so every
// attempt 403s and the composer said "Dictation unavailable" on every click
// (`src/features/channels/components/use-dictation.ts`, the "network" fault). This module runs
// Apple's ON-DEVICE recognizer instead, through a small signed helper
// (`native/dictation/main.swift` → Contents/Resources/dictation/dopl-dictation): free, no key,
// and the audio never leaves the Mac.
//
// THE WIRE (renderer ⇄ main), via `renderer/app-preload.js › dictation`:
//   dictation:probe  (locale)  → { state:'ready', locale } | { state:'unavailable', code }
//   dictation:start  (locale)  → { ok:true, id } | { ok:false, code }
//   dictation:stop   (id)      → { ok }
//   'dictation:event' push     → { id, type:'start'|'partial'|'final'|'error'|'end', text?, code? }
// CODES, never copy: the words live in ONE place, the web tree's `dictation/faults.ts`.
//
// ⚠ THE PROBE IS A REAL CAPABILITY CHECK, not a presence check: it asks the helper for the
// Speech Recognition and Microphone authorization states, whether a microphone exists, and whether
// an on-device model is installed for the locale. A "ready" answer means a click can work; every
// other answer names why not.
//
// ⚠ ONE SESSION AT A TIME, app-wide: there is one microphone. A new start stops the old one, a
// window that goes away takes its session with it, and quitting kills any helper still running.
// A hard cap (`MAX_SESSION_MS`) backs up the renderer's own 60s cap.

const { app, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { isAppWindowSender } = require('./ipc-guards');
const { diag } = require('./diag');

// ─── BEGIN DICTATION-PURE (unit-tested via source extraction) ────────────────
// No electron/require refs below.

/** Backstop for the renderer's own 60s cap: a helper is never left capturing past this. */
const MAX_SESSION_MS = 120000;
/** How long a probe may take before it reads as a failed helper. */
const PROBE_TIMEOUT_MS = 5000;
/** After "stop", how long the helper gets to flush its final result before it is killed. */
const STOP_GRACE_MS = 4000;

const EVENT_TYPES = new Set(['start', 'partial', 'final', 'error', 'end']);

/** A BCP-47-ish tag, or '' (the helper then uses the system's own recognizer). The value reaches a
 *  child process argv, so anything else is dropped rather than passed through. */
function cleanLocale(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$/.test(s) ? s : '';
}

/**
 * The helper's probe line → the renderer's answer. ORDER IS THE PRECEDENCE: the first thing that
 * would stop a click from working is the one reported, because it is the one the operator must
 * fix first.
 *
 * `notDetermined` is READY: the OS asks on the first start, and refusing to try would mean the
 * prompt could never appear.
 */
function availabilityFromProbe(probe, platform) {
  if (platform !== 'darwin') return { state: 'unavailable', code: 'unsupported-os' };
  if (!probe || probe.type !== 'probe') return { state: 'unavailable', code: 'helper-failed' };
  if (probe.speech === 'denied') return { state: 'unavailable', code: 'speech-denied' };
  if (probe.speech === 'restricted') return { state: 'unavailable', code: 'speech-restricted' };
  if (probe.mic === 'denied') return { state: 'unavailable', code: 'mic-denied' };
  if (probe.mic === 'restricted') return { state: 'unavailable', code: 'mic-restricted' };
  if (probe.hasMic !== true) return { state: 'unavailable', code: 'no-mic' };
  if (probe.recognizer !== true) return { state: 'unavailable', code: 'locale-unsupported' };
  if (probe.onDevice !== true) return { state: 'unavailable', code: 'on-device-unavailable' };
  return { state: 'ready', locale: typeof probe.locale === 'string' ? probe.locale : '' };
}

/** One stdout line → a wire event, or null for anything that is not one (stray output is
 *  ignored, never forwarded). Text is capped: a transcript line is a sentence, not a file. */
function parseHelperLine(line) {
  let obj;
  try {
    obj = JSON.parse(String(line || ''));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || !EVENT_TYPES.has(obj.type)) return null;
  const out = { type: obj.type };
  if (typeof obj.text === 'string') out.text = obj.text.slice(0, 4000);
  if (typeof obj.code === 'string') out.code = obj.code.slice(0, 64);
  return out;
}

/** The last probe line in a helper's stdout, parsed, or null. */
function parseProbeOutput(stdout) {
  const lines = String(stdout || '').split('\n').reverse();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === 'probe') return obj;
    } catch {
      // not a JSON line
    }
  }
  return null;
}

// ─── END DICTATION-PURE ──────────────────────────────────────────────────────

/** Packaged: Contents/Resources/dictation/. Dev (`electron .`): the build script's output. */
function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'dictation', 'dopl-dictation')
    : path.join(__dirname, '..', 'native', 'build', 'dopl-dictation');
}

function helperExists() {
  try {
    fs.accessSync(helperPath(), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function probe(locale) {
  if (process.platform !== 'darwin') return Promise.resolve(availabilityFromProbe(null, process.platform));
  if (!helperExists()) return Promise.resolve({ state: 'unavailable', code: 'helper-missing' });
  const args = ['probe'];
  const loc = cleanLocale(locale);
  if (loc) args.push('--locale', loc);
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      resolve(answer);
    };
    let child;
    try {
      child = spawn(helperPath(), args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      diag('dictation: probe spawn failed —', (err && err.message) || String(err));
      finish({ state: 'unavailable', code: 'helper-failed' });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      finish({ state: 'unavailable', code: 'helper-failed' });
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      diag('dictation: probe error —', (err && err.message) || String(err));
      finish({ state: 'unavailable', code: 'helper-failed' });
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish(availabilityFromProbe(parseProbeOutput(out), process.platform));
    });
  });
}

/** The one live session: { id, child, sender, ended, timers }. */
let current = null;

function send(session, event) {
  try {
    if (session.sender && !session.sender.isDestroyed()) {
      session.sender.send('dictation:event', { id: session.id, ...event });
    }
  } catch (err) {
    diag('dictation: event send failed —', (err && err.message) || String(err));
  }
}

function finishSession(session) {
  if (session.ended) return;
  session.ended = true;
  for (const t of session.timers) clearTimeout(t);
  send(session, { type: 'end' });
  if (current === session) current = null;
}

function kill(session) {
  try { session.child.kill('SIGKILL'); } catch { /* already gone */ }
}

function stopSession(session) {
  if (!session || session.ended) return;
  try {
    session.child.stdin.write('stop\n');
    session.child.stdin.end();
  } catch {
    // stdin already closed: the kill below is the fallback
  }
  session.timers.push(setTimeout(() => kill(session), STOP_GRACE_MS));
}

function start(sender, locale) {
  if (process.platform !== 'darwin') return { ok: false, code: 'unsupported-os' };
  if (!helperExists()) return { ok: false, code: 'helper-missing' };
  if (current) stopSession(current);

  const args = ['listen'];
  const loc = cleanLocale(locale);
  if (loc) args.push('--locale', loc);
  let child;
  try {
    child = spawn(helperPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    diag('dictation: listen spawn failed —', (err && err.message) || String(err));
    return { ok: false, code: 'helper-failed' };
  }
  // ⚠ A helper that exits before reading stdin turns the 'stop' write into EPIPE; unhandled, that
  // is an 'error' event that takes the main process down.
  child.stdin.on('error', () => {});
  const session = { id: crypto.randomUUID(), child, sender, ended: false, timers: [], faulted: false };
  current = session;

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const event = parseHelperLine(line);
    if (!event || session.ended) return;
    if (event.type === 'end') {
      finishSession(session);
      return;
    }
    if (event.type === 'error') session.faulted = true;
    send(session, event);
  });
  child.stderr.on('data', () => {}); // the OS logs here; never forwarded
  child.on('error', (err) => {
    diag('dictation: helper error —', (err && err.message) || String(err));
    if (!session.faulted) send(session, { type: 'error', code: 'helper-failed' });
    finishSession(session);
  });
  child.on('close', (code) => {
    // A helper that died without saying why still owes the renderer an honest ending.
    if (code && !session.faulted && !session.ended) send(session, { type: 'error', code: 'helper-failed' });
    finishSession(session);
  });
  session.timers.push(setTimeout(() => stopSession(session), MAX_SESSION_MS));
  // The window going away takes its microphone with it.
  try {
    sender.once('destroyed', () => {
      stopSession(session);
      kill(session);
    });
  } catch {
    // a sender without events (tests); the cap and quit hook still apply
  }
  return { ok: true, id: session.id };
}

function register(opts = {}) {
  const getSenderIds = typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  const appWindowOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('dictation: refused', name, '— sender is not an app window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  ipcMain.handle('dictation:probe', appWindowOnly('dictation:probe', { state: 'unavailable', code: 'refused' }, (_event, locale) => {
    return probe(locale);
  }));

  ipcMain.handle('dictation:start', appWindowOnly('dictation:start', { ok: false, code: 'refused' }, (event, locale) => {
    return start(event.sender, locale);
  }));

  ipcMain.handle('dictation:stop', appWindowOnly('dictation:stop', { ok: false }, (event, id) => {
    if (!current || current.id !== id || current.sender !== event.sender) return { ok: false };
    stopSession(current);
    return { ok: true };
  }));

  app.on('will-quit', () => {
    if (current) kill(current);
  });
}

module.exports = {
  register,
  availabilityFromProbe,
  parseHelperLine,
  parseProbeOutput,
  cleanLocale,
};
