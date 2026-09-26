#!/usr/bin/env node
/**
 * glasses-dev-seed — pair a pair of glasses through the REAL flow against a
 * running Dopl (local dev by default). Replaces the prototype's env shortcuts.
 *
 *   # claim the code the plugin/simulator is showing:
 *   node scripts/glasses-dev-seed.mjs --user-token-file <file> --code ABC234 [--channel <uuid>] [--name "Lens"]
 *
 *   # or pair a headless "device" end to end (start → claim → status) and save its token:
 *   node scripts/glasses-dev-seed.mjs --user-token-file <file> --out <device-token-file> [--channel <uuid>] [--hey-even <key-file>]
 *
 * <file> holds a Dopl user credential (a `dopl_at_…` MCP token or a Supabase
 * access JWT) for the account that will own the device; with --channel that
 * account must be a member of the channel. Secrets are only ever written to
 * files (mode 600), never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:3100" },
    "user-token-file": { type: "string" },
    code: { type: "string" },
    channel: { type: "string" },
    name: { type: "string" },
    out: { type: "string" },
    "hey-even": { type: "string" },
  },
});

function die(msg) {
  console.error(`glasses-dev-seed: ${msg}`);
  process.exit(1);
}
if (!a["user-token-file"]) die("--user-token-file is required");
if (!a.code && !a.out) die("pass --code (claim a shown code) or --out (pair a headless device)");
const userToken = readFileSync(a["user-token-file"], "utf8").trim();
const base = a.base.replace(/\/+$/, "");

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) die(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function saveSecret(file, value) {
  writeFileSync(file, value, { mode: 0o600 });
}

async function claim(code) {
  const { device } = await call("POST", "/api/glasses/pair/claim", {
    token: userToken,
    body: { code, ...(a.name ? { name: a.name } : {}), ...(a.channel ? { channel_id: a.channel } : {}) },
  });
  console.log("claimed:", JSON.stringify(device));
  return device;
}

if (a.code) {
  await claim(a.code);
} else {
  const start = await call("POST", "/api/glasses/device/pair/start");
  console.log(`pairing code ${start.code} (expires ${start.expires_at})`);
  const device = await claim(start.code);
  const q = `pair_id=${encodeURIComponent(start.pair_id)}&poll_secret=${encodeURIComponent(start.poll_secret)}`;
  const status = await call("GET", `/api/glasses/device/pair/status?${q}`);
  if (status.status !== "claimed" || !status.device_token) die(`unexpected status ${status.status}`);
  saveSecret(a.out, status.device_token);
  console.log(`device ${status.device_id} token saved to ${a.out}`);
  if (a["hey-even"]) {
    const { key, url } = await call("POST", `/api/glasses/devices/${device.id}/hey-even-key`, { token: userToken });
    saveSecret(a["hey-even"], key);
    console.log(`Hey Even key saved to ${a["hey-even"]}; url ${url}`);
  }
}
