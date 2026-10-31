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
const { createGoogleHome } = require('./service');
const { discoverDevices } = require('./discovery');

const POLL_MS = 3000;
const REDISCOVER_MS = 30 * 1000;
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
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { throw new Error(`No bridge config at ${file}.`); }
  const c = JSON.parse(raw);
  if (!c.apiUrl || !c.token) throw new Error(`${file} needs apiUrl and token.`);
  return { apiUrl: String(c.apiUrl).replace(/\/+$/, ''), token: c.token };
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

/**
 * One pass: report in, cast what is pending, ack each outcome. A failed cast is acked as failed, so the
 * log says so, and the row never comes back. An error from the server propagates to {@link run}.
 */
async function pass({ client, home, device, identity, log }) {
  const { messages } = await client.poll(identity());
  for (const m of messages) {
    let ack;
    try {
      await home.notify({ text: m.text, device });
      ack = { id: m.id, ok: true };
      log(`Cast: "${m.text}"`);
    } catch (err) {
      const error = String((err && err.message) || err).slice(0, 500);
      ack = { id: m.id, ok: false, error };
      log(`Cast failed: ${error}`);
    }
    await client.ack(ack);
  }
}

/** Keeps going through any failure, until `stop()` says otherwise, and says each distinct problem once. */
async function run({ client, home, device, log, sleep, stop, now = Date.now }) {
  let speaker = null;
  let reported = false;
  let lastScan = -Infinity;
  let lastProblem = null;
  const identity = () => (speaker && !reported ? { name: speaker.name, model: speaker.model } : {});
  while (!stop()) {
    try {
      if (!speaker && now() - lastScan >= REDISCOVER_MS) {
        lastScan = now();
        const { devices } = await home.status();
        const pool = devices.filter((d) => !d.group);
        speaker = (device ? pool.find((d) => [d.id, d.name].some((x) => x.toLowerCase() === device.toLowerCase())) : pool.length === 1 ? pool[0] : null) || null;
        log(speaker
          ? `Speaker: ${speaker.name} (${speaker.model})`
          : `No single speaker yet. Found: ${pool.map((d) => d.name).join(', ') || 'none'}. Same Wi-Fi? Several? Pass --device.`);
      }
      const sendsIdentity = Boolean(speaker && !reported);
      await pass({ client, home, device, identity, log });
      if (sendsIdentity) reported = true;
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

/** The speaker pulls the audio from this process over HTTP, so it has to outlive the speech. */
const speechMs = (text) => Math.max(8000, text.length * 90);

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
  let stopping = false;
  const stop = () => { stopping = true; home.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  log('Bridge running. Ctrl-C stops it, and the speaker reads offline a minute later.');
  await run({ client, home, device, log, sleep: (ms) => new Promise((r) => { setTimeout(r, ms); }), stop: () => stopping });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`google-home-bridge: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  });
}

module.exports = { createClient, pass, run, readConfig, speechMs, POLL_MS };
