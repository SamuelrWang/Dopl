// THE REGISTRY HALF of the runtime updater (`./index.js`): which build of a package a dist-tag names
// today, and that build's tarball, hashed as it lands. Electron-free; `fetchImpl` is injected.
//
// ⚠ THE INTEGRITY CHECK PROVES "WHAT THE REGISTRY PUBLISHED", NOT "WHAT THE VENDOR BUILT": the hash and
// the tarball come from the same origin. The vendor proof is the code signature (`verify.js`), and
// nothing here is trusted without it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REGISTRY = 'https://registry.npmjs.org';
const META_TIMEOUT_MS = 15000;
// A ~70 MB tarball on a slow link; the whole update runs in the background, so generous is free.
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/** `{ version, tarball, integrity }` for `pkg` at dist-tag `tag`. Throws on any other answer. */
async function latest(pkg, tag, fetchImpl) {
  const url = `${REGISTRY}/${pkg.replace('/', '%2f')}/${encodeURIComponent(tag)}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(META_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`the registry answered ${res.status} for ${pkg}@${tag}`);
  const doc = await res.json();
  const dist = (doc && doc.dist) || {};
  // ⚠ The tarball must be on the registry itself: the integrity below is only as good as its origin.
  if (typeof doc.version !== 'string' || typeof dist.tarball !== 'string' || !dist.tarball.startsWith(`${REGISTRY}/`)
    || typeof dist.integrity !== 'string' || !dist.integrity.startsWith('sha512-')) {
    throw new Error(`the registry's answer for ${pkg}@${tag} is not usable`);
  }
  return { version: doc.version, tarball: dist.tarball, integrity: dist.integrity };
}

/** Stream `meta.tarball` to `dest`, hashing every byte; a mismatch deletes the file and throws. */
async function download(meta, dest, fetchImpl) {
  const res = await fetchImpl(meta.tarball, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`the registry answered ${res.status} for ${meta.tarball}`);
  const hash = crypto.createHash('sha512');
  await pipeline(
    Readable.fromWeb(res.body),
    async function* digest(source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(dest, { mode: 0o600 }),
  );
  if (`sha512-${hash.digest('base64')}` !== meta.integrity) {
    fs.rmSync(dest, { force: true });
    throw new Error(`${meta.tarball} does not match the registry's sha512`);
  }
}

/**
 * A SOURCE-SUPPLIED artifact (a runtime whose vendor publishes outside npm, `<adapter>/update-source.js ›
 * fetchInto`): stream `url` to `dest`, counting and hashing every byte, and delete it unless BOTH the size
 * and the `algorithm` digest (hex) match what the vendor's manifest stated. Same caveat as above: the
 * digest and the file share an origin, so the vendor proof is still the code signature (`verify.js`).
 */
async function downloadVerified(url, dest, expect, fetchImpl) {
  const e = expect || {};
  if (typeof e.hex !== 'string' || !/^[0-9a-f]{64,128}$/.test(e.hex) || !Number.isInteger(e.size) || e.size <= 0) {
    throw new Error('the manifest states no usable digest and size');
  }
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
  const hash = crypto.createHash(e.algorithm || 'sha256');
  let size = 0;
  await pipeline(
    Readable.fromWeb(res.body),
    async function* digest(source) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > e.size) throw new Error('the download is larger than the manifest states');
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(dest, { mode: 0o600 }),
  ).catch((err) => { fs.rmSync(dest, { force: true }); throw err; });
  const hex = hash.digest('hex');
  if (size !== e.size || hex !== e.hex) {
    fs.rmSync(dest, { force: true });
    throw new Error(`the download does not match the manifest (size ${size} vs ${e.size}, ${e.algorithm || 'sha256'} mismatch: ${hex !== e.hex})`);
  }
}

/**
 * A SOURCE-SUPPLIED artifact whose vendor publishes NO digest (`<adapter>/update-source.js › fetchInto`):
 * stream `url` to `dest` under a size ceiling, hashing every byte → `{ sha256, md5, size, headers }` for the
 * source to RECORD and to check against any transport digest the response carried. Nothing here is a vendor
 * proof — with no published digest the code signature (`verify.js`) is the only one.
 */
async function downloadMeasured(url, dest, limits, fetchImpl) {
  const maxSize = limits && Number.isInteger(limits.maxSize) && limits.maxSize > 0 ? limits.maxSize : 0;
  if (!maxSize) throw new Error('no size ceiling for an unmanifested download');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
  const sha = crypto.createHash('sha256');
  const md5 = crypto.createHash('md5');
  let size = 0;
  await pipeline(
    Readable.fromWeb(res.body),
    async function* digest(source) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxSize) throw new Error('the download is larger than any build Dopl accepts');
        sha.update(chunk);
        md5.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(dest, { mode: 0o600 }),
  ).catch((err) => { fs.rmSync(dest, { force: true }); throw err; });
  const header = (name) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null);
  return { sha256: sha.digest('hex'), md5: md5.digest('base64'), size, headers: { 'x-goog-hash': header('x-goog-hash') } };
}

module.exports = { latest, download, downloadVerified, downloadMeasured, REGISTRY };
