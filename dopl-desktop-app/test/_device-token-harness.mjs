// SHARED HARNESS for the device-token suites — the REAL `main/mcp-device-token-lifecycle.js`,
// `main/mcp-device-token.js` and `main/mcp-config.js`, each loaded whole from source over a
// strict stub map (`helpers/module-sandbox.mjs › loadWithStubs`: an unlisted require throws).
//
// ⚠ WHY NOT SLICES. Until cleanup D04 (2026-10-11) seven suites cut these function bodies out
// of mcp-config.js by name and evaluated them, or regex-matched them. A slice tests a copy wired
// by the test; this tests the shipped module, its module state (the memo, the single-flight, the
// fresh-mint flag) and the ONE store instance the three modules share.
//
// What is faked, and only this: electron (`app.getPath`, `safeStorage`), electron-store (an
// in-memory Map), `fs.rmSync`, `os.hostname`, `./auth`, `./api`, `./diag`, `./config`, and the
// CLI / spawner / skill seams of mcp-config. `./deadline`, `./ipc-guards` and `path` are REAL;
// `./deadline` only has its `timers` seam closed over a hand-driven clock (see fakeTimers).

import { join } from "node:path";
import { loadWithStubs, real } from "./helpers/module-sandbox.mjs";

export const TOKEN_PATH = "/api/auth/mcp-device-token";
export const MCP_URL = "http://localhost:3001/api/mcp";
export const USER_DATA = "/fake/userData";
export const SPAWN_JSON = join(USER_DATA, "mcp-spawn.json");
export const DAY = 24 * 60 * 60 * 1000;

// ⚠ A HAND-DRIVEN CLOCK (2026-09-16). `withDeadline` unref()s its timer; under Node 22's
// `node --test` that let the loop drain before a hung-request deadline fired. The REAL
// `withDeadline` runs; only its `timers` seam is injected, so the bound fires when a case says so.
export function fakeTimers() {
  const armed = [];
  return {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false, unreffed: false, unref() { this.unreffed = true; } };
      armed.push(t);
      return t;
    },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    armed,
    fire: () => { for (const t of armed) if (!t.cleared) { t.cleared = true; t.fn(); } },
  };
}

class FakeStore {
  constructor() { this.data = new Map(); FakeStore.last = this; }
  get(k) { return this.data.get(k); }
  set(k, v) { this.data.set(k, v); }
  delete(k) { this.data.delete(k); }
}

/**
 * opts:
 *   record      a device-token record seeded into the store before anything runs (or null)
 *   encryption  safeStorage.isEncryptionAvailable() (default true)
 *   hostname    os.hostname() (default "This-Host"); a function is called per read (may throw)
 *   signedIn    auth.ensureSignedIn() answer (default true); a function is called per check
 *   fetch       (path, opts) => response | Promise, the apiFetch fake (default: throws)
 *   rmThrows    fs.rmSync throws EPERM
 *   storeDeleteThrows  store.delete throws
 * mcp-config only:
 *   bin         spawner.getClaudeBinPath() (default "/bin/claude"; "" = no external CLI)
 *   probe       mcp-cli-add.probeMcpEntry() answer
 *   removeOk / addOk
 */
export function deviceTokenWorld(opts = {}) {
  const o = { encryption: true, hostname: "This-Host", signedIn: true, ...opts };
  const calls = { fetches: [], diags: [], rms: [], writes: [], signedIn: 0, seq: [] };
  const timers = fakeTimers();
  const files = new Map();
  if (o.spawnFile != null) files.set(SPAWN_JSON, o.spawnFile);

  const safeStorage = {
    isEncryptionAvailable: () => o.encryption,
    encryptString: (s) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (buf) => {
      const s = buf.toString("utf8");
      if (!s.startsWith("enc:")) throw new Error("bad ciphertext");
      return s.slice(4);
    },
  };
  const electron = { app: { getPath: (k) => { if (k !== "userData") throw new Error(k); return USER_DATA; } }, safeStorage };

  const storeMod = loadWithStubs("mcp-device-token.js", { electron, "electron-store": FakeStore });
  const store = FakeStore.last;
  if (o.storeDeleteThrows) store.delete = () => { throw new Error("store locked"); };
  if (o.record) storeMod.saveDeviceToken(o.record);

  // Writers are PRESENT and recorded, so a writer reappearing in either module lands in
  // `calls.writes` and trips an assertion rather than a "not a function" that reads like a harness bug.
  const fs = {
    writeFileSync(p, body, wOpts) { calls.writes.push({ p, body, opts: wOpts }); files.set(p, String(body)); },
    chmodSync(p, mode) { calls.writes.push({ p, chmod: mode }); },
    rmSync(p, rmOpts) {
      calls.rms.push({ p, opts: rmOpts });
      calls.seq.push("rm");
      if (o.rmThrows) throw new Error("EPERM");
      files.delete(p);
    },
  };
  const diag = { diag: (...a) => calls.diags.push(a.map(String).join(" ")) };
  const deadline = real("./deadline");
  const deadlineStub = {
    DEADLINE: deadline.DEADLINE,
    withDeadline: (p, ms, onDeadline) => deadline.withDeadline(p, ms, onDeadline, timers),
  };
  const lifecycle = loadWithStubs("mcp-device-token-lifecycle.js", {
    fs,
    path: real("path"),
    os: { hostname: () => (typeof o.hostname === "function" ? o.hostname() : o.hostname) },
    electron,
    "./auth": {
      ensureSignedIn: async () => {
        calls.signedIn += 1;
        calls.seq.push("signedIn");
        return typeof o.signedIn === "function" ? o.signedIn() : o.signedIn;
      },
    },
    "./api": {
      apiFetch: (path, fopts) => {
        calls.fetches.push({ path, opts: fopts });
        calls.seq.push(`fetch:${fopts && fopts.method}`);
        if (!o.fetch) throw new Error("no fetch expected");
        return o.fetch(path, fopts);
      },
    },
    "./diag": diag,
    "./deadline": deadlineStub,
    "./config": { MCP_DEVICE_TOKEN_PATH: TOKEN_PATH },
    "./ipc-guards": real("./ipc-guards"),
    "./mcp-device-token": storeMod,
  });

  let config = null;
  const loadConfig = () => {
    if (config) return config;
    config = loadWithStubs("mcp-config.js", {
      fs,
      "./session-spawner": {
        getClaudeBinPath: async () => { calls.seq.push("bin"); return o.bin === undefined ? "/bin/claude" : o.bin; },
      },
      "./mcp-cli-add": {
        probeMcpEntry: async () => { calls.seq.push("probe"); return o.probe; },
        removeMcpEntry: async () => { calls.seq.push("remove"); return o.removeOk !== false; },
        addMcpEntry: async (_bin, token) => { calls.seq.push(`add:${token}`); return o.addOk !== false; },
      },
      "./diag": diag,
      "./runtime/claude/skill-install": { ensureDoplSkills: () => { calls.seq.push("skills"); } },
      "./config": { MCP_URL },
      "./mcp-device-token": storeMod,
      "./mcp-device-token-lifecycle": lifecycle,
    });
    return config;
  };

  return {
    lifecycle,
    get config() { return loadConfig(); },
    storeMod,
    store,
    files,
    calls,
    timers,
    log: () => calls.diags.join("\n"),
    stored: () => storeMod.loadDeviceToken(),
  };
}

/** A mint response the route returns (src/app/api/auth/mcp-device-token/route.ts). */
export const minted = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** A record that is still well inside the 7-day reuse margin. */
export const freshRecord = (extra = {}) => ({ token: "tok-cached", expiresAt: Date.now() + 30 * DAY, ...extra });
