#!/usr/bin/env node
// `node dopl-desktop-app/main/google-home/bridge.js`: the local half of the `google_home` Device SDK
// adapter. Cast is LAN-only, so this runs on a computer on the speaker's network, pulls the device's
// queue from Dopl (`/api/device-bridge/*`) and casts each message. Not loaded by the desktop app.
//
//   --say "text"     speak once through Cast and exit. Touches no server: the go/no-go for the speaker.
//   --discover       print the speakers found and exit. Plays nothing.
//   --device "name"  which speaker, when the network has several.
//
// The device token lives in ~/.dopl/google-home-bridge.json (`{ apiUrl, token }`, mode 600), outside
// the repo. The server keeps only its sha256. Everything with an effect goes through `deps`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const { createGoogleHome, matches } = require('./service');
const { discoverDevices } = require('./discovery');

const POLL_MS = 3000;
const REDISCOVER_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const CONFIG_PATH = process.env.DOPL_BRIDGE_CONFIG || path.join(os.homedir(), '.dopl', 'google-home-bridge.json');
const DEPS_DIR = process.env.DOPL_BRIDGE_DEPS || path.join(os.homedir(), '.dopl', 'google-home-bridge-deps');
// Same version as dopl-desktop-app/package-lock.json. Pure JS: installed with scripts off.
const BONJOUR = 'bonjour-service@1.4.4';

/** The mDNS module: the desktop app's own install when it has one, else a private copy in {@link DEPS_DIR}. */
function loadBonjour() {
  try {
    return require('bonjour-service');
  } catch (_) { /* not installed in this checkout */ }
  const local = createRequire(path.join(DEPS_DIR, 'package.json'));
  try {
    return local('bonjour-service');
  } catch (_) {
    process.stdout.write(`Installing ${BONJOUR} into ${DEPS_DIR} (first run only)\n`);
    fs.mkdirSync(DEPS_DIR, { recursive: true });
    execFileSync('npm', ['install', '--prefix', DEPS_DIR, '--no-audit', '--no-fund', '--ignore-scripts', BONJOUR], { stdio: 'ignore' });
    return local('bonjour-service');
  }
}

function browserFactory() {
  const { Bonjour } = loadBonjour();
  const bonjour = new Bonjour();
  return { find: (onUp) => bonjour.find({ type: 'googlecast' }, onUp), destroy: () => bonjour.destroy() };
}

const realDiscover = () => discoverDevices({ browserFactory });

function readConfig(file = CONFIG_PATH) {
  let raw;
  let mode;
  try {
    mode = fs.statSync(file).mode;
    raw = fs.readFileSync(file, 'utf8');
  } catch (_) {
    throw new Error(`No bridge config at ${file}.`);
  }
  if (mode & 0o077) throw new Error(`${file} holds a token and is readable by others. Run: chmod 600 "${file}"`);
  let c;
  try { c = JSON.parse(raw); } catch (_) { throw new Error(`${file} is not valid JSON.`); }
  if (!c.apiUrl || !c.token) throw new Error(`${file} needs apiUrl and token.`);
  const apiUrl = String(c.apiUrl).replace(/\/+$/, '');
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:|$))/.test(apiUrl)) throw new Error(`${file}: apiUrl must be https, so the token is never sent in the clear.`);
  return { apiUrl, token: c.token };
}

class BridgeHttpError extends Error {
  constructor(status) { super(`Dopl answered ${status}`); this.status = status; }
}

/** The two calls the server takes. Never logs the token. */
function createClient({ apiUrl, token, fetchImpl = fetch }) {
  const post = async (route, body) => {
    const res = await fetchImpl(`${apiUrl}/api/device-bridge/${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new BridgeHttpError(res.status);
    return res.json();
  };
  return { poll: (identity) => post('poll', identity), ack: (ack) => post('ack', ack) };
}

const HINTS = {
  401: 'The device token was refused. It was revoked, or the config is wrong.',
  404: 'Dopl has no bridge routes here yet: the server code is not deployed.',
};

/** The speaker pulls the audio from this process and a new cast cuts off the last, so both wait this long. */
const speechMs = (text) => Math.max(8000, text.length * 90);

const newPassState = () => ({ unacked: new Map(), busyUntil: 0 });

async function cast({ home, device, log, state, now }, m) {
  try {
    await home.notify({ text: m.text, device });
    state.busyUntil = now() + speechMs(m.text);
    log(`Cast: "${m.text}"`);
    return { id: m.id, ok: true };
  } catch (err) {
    const error = String((err && err.message) || err).slice(0, 500);
    log(`Cast failed: ${error}`);
    return { id: m.id, ok: false, error };
  }
}

/**
 * One pass: report in, cast what is pending and ack each outcome. An ack the server did not take is
 * kept in `state` and sent again without casting again. A row that stops being pending is forgotten;
 * a 404 on ack means the same. Any other server error propagates to {@link run}.
 */
async function pass({ client, home, device, identity, log, state = newPassState(), now = Date.now }) {
  const { messages } = await client.poll(identity);
  for (const id of state.unacked.keys()) {
    if (!messages.some((m) => m.id === id)) state.unacked.delete(id);
  }
  for (const m of messages) {
    if (!state.unacked.has(m.id)) {
      if (now() < state.busyUntil) continue;
      state.unacked.set(m.id, await cast({ home, device, log, state, now }, m));
    }
    try {
      await client.ack(state.unacked.get(m.id));
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    state.unacked.delete(m.id);
  }
}

/** Keeps going through any failure, until `stop()` says otherwise, and says each distinct problem once. */
async function run({ client, home, device, log, sleep, stop, now = Date.now }) {
  const state = newPassState();
  let speaker = null;
  let reported = false;
  let lastScan = -Infinity;
  let lastProblem = null;
  while (!stop()) {
    try {
      if (!speaker && now() - lastScan >= REDISCOVER_MS) {
        lastScan = now();
        const { devices } = await home.status();
        const pool = devices.filter((d) => !d.group);
        speaker = (device ? devices.find((d) => matches(d, device)) : pool.length === 1 && pool[0]) || null;
        log(speaker
          ? `Speaker: ${speaker.name} (${speaker.model})`
          : `No single speaker yet. Found: ${pool.map((d) => d.name).join(', ') || 'none'}. Same Wi-Fi? Several? Pass --device.`);
      }
      const identity = speaker && !reported ? { name: speaker.name, model: speaker.model } : {};
      await pass({ client, home, device, identity, log, state, now });
      if (speaker) reported = true;
      if (lastProblem) log('Connected to Dopl again.');
      lastProblem = null;
    } catch (err) {
      const problem = HINTS[err && err.status] || String((err && err.message) || err);
      if (problem !== lastProblem) log(problem);
      lastProblem = problem;
    }
    await sleep(POLL_MS);
  }
}

const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

async function main(argv) {
  const log = (line) => process.stdout.write(`${line}\n`);
  const device = flag(argv, '--device');
  const home = createGoogleHome({ discover: realDiscover });
  if (argv.includes('--discover')) {
    log(JSON.stringify(await home.status(), null, 2));
    home.close();
    return;
  }
  const say = flag(argv, '--say');
  if (say !== undefined) {
    const r = await home.notify({ text: say, device });
    log(`Sent to ${r.device.name}: ${r.status}. Listen for it; Cast cannot confirm that it played.`);
    await new Promise((resolve) => { setTimeout(resolve, speechMs(say)); });
    home.close();
    return;
  }
  const client = createClient(readConfig());
  const stop = () => { home.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  log('Bridge running. Ctrl-C stops it, and the speaker reads offline a minute later.');
  await run({ client, home, device, log, sleep: (ms) => new Promise((r) => { setTimeout(r, ms); }), stop: () => false });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`google-home-bridge: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  });
}

module.exports = { createClient, pass, run, readConfig };
