// How the shared runtime updater (`../updates/index.js`) gets and keeps Muse: Meta's own release channel,
// not npm. `https://api.meta.ai/muse-code/channels/muse-stable` names the version and its release manifest;
// the manifest names each platform build with its sha256 and size (measured 2026-10-13, fixtures in
// `test/fixtures/muse/`). Electron-free at load.
//
// ⚠ ON DEMAND (`onDemand`): Muse is NEVER bundled (Meta's terms forbid redistribution, `packaging.js`) and
//   NEVER fetched unasked — the ~360 MB build downloads only when the operator signs in to Muse
//   (`login.js`); after that it updates like any runtime.
// ⚠ COMPATIBILITY = THE CANDIDATE'S OWN PROTOCOL DESCRIPTION (`muse schema`, `shape.js`) against this
//   adapter's `requiredShape`, checked by the shared updater — never a version range.
// ⚠ THE PROOF IS META'S SIGNATURE: the digest and the file share an origin, so the shared updater also
//   requires Meta's Developer ID team on the binary (`teamId`, `codesign -dv` on the channel build).

const fs = require('fs');
const path = require('path');
const resolveBin = require('./resolve-bin');

const CHANNEL_URL = 'https://api.meta.ai/muse-code/channels/muse-stable';
const META_TIMEOUT_MS = 15000;
// The manifest and the artifacts are served from these hosts only (https, no port, no credentials).
const HOSTS = ['api.meta.ai', 'lookaside.facebook.com'];
// `darwin-arm64` → the manifest's artifact key.
const ARTIFACT = { 'darwin-arm64': 'aarch64_macos', 'darwin-x64': 'x86_macos' };
const PLATFORM = `${process.platform}-${process.arch}`;
// Never fetched unasked (see the header).
const ON_DEMAND = true;

/** An `https:` URL on one of Meta's release hosts, with no credentials or port. */
function isReleaseUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS.includes(u.hostname.toLowerCase());
}

async function getJson(url, fetchImpl) {
  if (!isReleaseUrl(url)) throw new Error('the Muse channel pointed outside Meta\'s release hosts');
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(META_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`the Muse channel answered ${res.status}`);
  return res.json();
}

/** The channel answer + its release manifest → `{ version, url, sha256, size }` for this Mac. Pure. */
function releaseFrom(channel, manifest, platform) {
  const key = ARTIFACT[platform || PLATFORM];
  const art = manifest && manifest.artifacts && key ? manifest.artifacts[key] : null;
  if (!channel || typeof channel.version !== 'string' || !manifest || manifest.version !== channel.version) {
    throw new Error('the Muse channel and its manifest disagree on the version');
  }
  if (manifest.checksum_algorithm !== 'sha256' || !art || !isReleaseUrl(art.url)
    || typeof art.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(art.checksum) || !Number.isInteger(art.size)) {
    throw new Error('the Muse manifest carries no usable build for this Mac');
  }
  return { version: channel.version, url: art.url, sha256: art.checksum, size: art.size, fingerprint: manifest.msp_schema_fingerprint || null };
}

/** The newest channel build for this Mac (`updates/index.js › check`). */
async function latest(fetchImpl) {
  const channel = await getJson(CHANNEL_URL, fetchImpl);
  if (channel.state && channel.state !== 'public') throw new Error(`the Muse channel is ${channel.state}`);
  const manifest = await getJson(channel.manifest_url, fetchImpl);
  return releaseFrom(channel, manifest);
}

/** Download the build into `<staging>/package/muse`, size + sha256 checked as it lands; → the root. */
async function fetchInto(meta, staging, fetchImpl) {
  const root = path.join(staging, 'package');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const bin = path.join(root, resolveBin.BIN_NAME);
  await require('../updates/registry').downloadVerified(meta.url, bin, { algorithm: 'sha256', hex: meta.sha256, size: meta.size }, fetchImpl);
  fs.chmodSync(bin, 0o755);
  return root;
}

module.exports = {
  id: 'muse',
  // The channel name; null off macOS (the proof is `codesign`), which the updater never checks.
  pkg: process.platform === 'darwin' && ARTIFACT[PLATFORM] ? 'muse-stable' : null,
  tag: 'muse-stable',
  onDemand: ON_DEMAND,
  latest,
  fetchInto,
  versionOf: (v) => String(v || ''),
  // Never bundled.
  bundledVersion: () => null,
  binary: (root) => path.join(root, resolveBin.BIN_NAME),
  // Meta Platforms' Developer ID team (`codesign -dv` on muse-bin-1.4.7-R6101.1, 2026-10-13).
  teamId: 'V9WTTPBFK9',
  probeShape: async (bin, run) => (await require('./shape').describeBuild(bin, run)).shape,
  onSwitch: () => resolveBin.forget(),
  CHANNEL_URL, isReleaseUrl, releaseFrom,
};
