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

module.exports = { latest, download, REGISTRY };
