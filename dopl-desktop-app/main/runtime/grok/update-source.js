// How the shared runtime updater (`../updates/index.js`) gets and keeps Grok: xAI's own release channel, not
// npm. `https://x.ai/cli/stable` answers the version as plain text (`1.0.52`, 2026-10-13); the build is
// `https://x.ai/cli/grok-<version>-macos-<aarch64|x86_64>` (172 237 072 bytes for 1.0.52 aarch64).
// Electron-free at load.
//
// ⚠ ON DEMAND (`onDemand`): Grok is NEVER bundled (`packaging.js`) and NEVER fetched unasked — the build
//   downloads only when the operator signs in to Grok (`login.js`); after that it updates like any runtime.
// ⚠ xAI PUBLISHES NO CHECKSUM (no manifest; its `install.sh` verifies nothing). THE PROOF IS xAI's SIGNATURE:
//   the shared updater requires xAI's Developer ID team on the binary (`teamId`, `codesign -dv` on 1.0.52).
//   Dopl RECORDS the sha256 + size of every build it installs (`<root>/grok.sha256.json` + a diag line), and
//   checks the `x-goog-hash` md5 the response carries — a TRANSPORT check only (same origin as the file).
// ⚠ COMPATIBILITY = THE CANDIDATE'S OWN `initialize` ANSWER (`shape.js`) against this adapter's
//   `requiredShape`, checked by the shared updater — never a version range.

const fs = require('fs');
const path = require('path');
const resolveBin = require('./resolve-bin');

const CHANNEL_URL = 'https://x.ai/cli/stable';
const META_TIMEOUT_MS = 15000;
const HOSTS = ['x.ai'];
// `darwin-arm64` → the artifact suffix.
const ARTIFACT = { 'darwin-arm64': 'macos-aarch64', 'darwin-x64': 'macos-x86_64' };
const PLATFORM = `${process.platform}-${process.arch}`;
// No published size: a ceiling well above the measured 172 MB.
const MAX_SIZE = 512 * 1024 * 1024;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const RECORD_FILE = 'grok.sha256.json';
// Never fetched unasked (see the header).
const ON_DEMAND = true;

/** An `https:` URL on xAI's release host, with no credentials or port. */
function isReleaseUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS.includes(u.hostname.toLowerCase());
}

/** The channel's text → `{ version, url }` for this Mac. Pure. */
function releaseFrom(text, platform) {
  const version = String(text || '').trim();
  const suffix = ARTIFACT[platform || PLATFORM];
  if (!VERSION_RE.test(version)) throw new Error('the Grok channel did not name a version');
  if (!suffix) throw new Error('xAI publishes no Grok build for this Mac');
  return { version, url: `https://x.ai/cli/grok-${version}-${suffix}` };
}

/** The newest channel build for this Mac (`updates/index.js › check`). */
async function latest(fetchImpl) {
  const res = await fetchImpl(CHANNEL_URL, { signal: AbortSignal.timeout(META_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`the Grok channel answered ${res.status}`);
  return releaseFrom(await res.text());
}

/** `x-goog-hash: crc32c=…,md5=…` → the md5 (base64), or null. */
function md5Header(value) {
  const m = /(?:^|,)\s*md5=([A-Za-z0-9+/=]+)/.exec(String(value || ''));
  return m ? m[1] : null;
}

/** Download the build into `<staging>/package/grok`, record its digest; → the root. */
async function fetchInto(meta, staging, fetchImpl) {
  if (!meta || !isReleaseUrl(meta.url)) throw new Error('the Grok build is not on xAI\'s release host');
  const root = path.join(staging, 'package');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const bin = path.join(root, resolveBin.BIN_NAME);
  const got = await require('../updates/registry').downloadMeasured(meta.url, bin, { maxSize: MAX_SIZE }, fetchImpl);
  const transport = md5Header(got.headers && got.headers['x-goog-hash']);
  if (transport && transport !== got.md5) {
    fs.rmSync(bin, { force: true });
    throw new Error('the Grok download does not match the md5 its own response stated');
  }
  fs.chmodSync(bin, 0o755);
  const record = { version: meta.version, url: meta.url, sha256: got.sha256, size: got.size, transportMd5: transport ? 'matched' : 'absent' };
  fs.writeFileSync(path.join(root, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try { require('../../diag').diag('runtime-updates: grok', meta.version, 'sha256', got.sha256, 'size', got.size); } catch (_) { /* recorded on disk anyway */ }
  return root;
}

module.exports = {
  id: 'grok',
  // The channel name; null off macOS (the proof is `codesign`), which the updater never checks.
  pkg: process.platform === 'darwin' && ARTIFACT[PLATFORM] ? 'stable' : null,
  tag: 'stable',
  onDemand: ON_DEMAND,
  latest,
  fetchInto,
  versionOf: (v) => String(v || ''),
  // Never bundled.
  bundledVersion: () => null,
  binary: (root) => path.join(root, resolveBin.BIN_NAME),
  // X.AI Corporation's Developer ID team (`codesign -dv` on grok 1.0.52, 2026-10-13).
  teamId: '5Y6N3AJ54S',
  probeShape: async (bin) => (await require('./shape').describeBuild(bin)).shape,
  onSwitch: () => resolveBin.forget(),
  CHANNEL_URL, isReleaseUrl, releaseFrom, md5Header, RECORD_FILE, MAX_SIZE,
};
