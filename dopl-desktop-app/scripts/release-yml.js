/**
 * The two pure decisions inside `scripts/release.sh`, extracted so they can be
 * tested without a build, a network, or a 200 MB artifact.
 *
 * Both exist because of F-193, and each one is a failure that already shipped:
 *
 *  1. `patchDmgEntry` — stapling REWRITES THE DMG. `latest-mac.yml` is generated
 *     from the pre-staple artifacts, so the moment `stapler staple` runs, the
 *     feed's DMG `sha512`/`size` describe bytes that no longer exist. Both real
 *     releases shipped a feed that lied about the DMG. The patch is deliberately
 *     LINE-BASED rather than a YAML parse-and-reserialize: the ZIP entry and the
 *     top-level `path`/`sha512` (which is the ZIP's, and is the one the
 *     auto-updater actually installs from) must come out BYTE-IDENTICAL, and a
 *     reserializer cannot promise that. We rewrite two lines and copy the rest.
 *
 *  2. `assertAssets` — both real failures were SILENT PARTIAL UPLOADS. 1.10.0
 *     uploaded everything but the DMG; 1.10.1 uploaded everything but the zip
 *     and the feed, so `releases/latest/download/latest-mac.yml` 404'd and every
 *     auto-updater saw nothing new. Neither run reported an error. The only
 *     defense is to re-read the release afterwards and assert the names are
 *     there — which is what this does, plus the `state`/`size` check that
 *     catches an asset row that exists but never finished.
 *
 * CommonJS on purpose: `eslint.config.js` lints `scripts/**\/*.js` as CJS, and a
 * `.mjs` here would match no block in that config and therefore no `max-lines`
 * cap — the exact hole that config's own comment records having found once.
 *
 * CLI (what release.sh calls):
 *   node scripts/release-yml.js patch-dmg <latest-mac.yml> <path/to.dmg>
 *   node scripts/release-yml.js assert-assets <assets.json|-> <name>...
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DMG_RE = /\.dmg$/i;
const SHA512_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// ── The `files:` block, as line ranges ───────────────────────────────────────
//
// Returns one record per `- url:` entry with the half-open line range it owns.
// An entry ends at the next `- url:` or at the first column-0 line (the next
// top-level key), which is what keeps `path:` / `sha512:` / `releaseDate:` out
// of every entry's range and therefore out of reach of the patch.
function fileEntries(lines) {
  const filesIdx = lines.findIndex((l) => /^files:\s*$/.test(l));
  if (filesIdx === -1) {
    throw new Error('latest-mac.yml has no `files:` block — this is not an electron-builder feed.');
  }
  const entries = [];
  let cur = null;
  const close = (end) => {
    if (cur) {
      cur.end = end;
      entries.push(cur);
      cur = null;
    }
  };
  for (let i = filesIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*)-\s+url:\s*(\S.*?)\s*$/.exec(line);
    if (m) {
      close(i);
      cur = { indent: m[1], url: m[2], start: i, end: -1 };
      continue;
    }
    if (/^\S/.test(line)) {
      // A top-level key: the `files:` block is over.
      close(i);
      break;
    }
    if (!cur && line.trim() !== '') {
      throw new Error(`latest-mac.yml line ${i + 1} sits inside \`files:\` but under no entry.`);
    }
  }
  close(lines.length);
  return entries;
}

/**
 * Rewrite ONLY the `sha512` and `size` of the feed's single `.dmg` entry.
 *
 * `url` is required and must match what the feed already names, because a
 * mismatch means the yml and the DMG on disk came from different builds — the
 * `--skip-build` resume path makes that a real possibility, and patching the
 * hash of the wrong file into a feed is worse than not patching at all.
 *
 * Returns `{ text, changed }`. `changed: false` is the honest answer for a
 * re-run over an already-patched feed; the caller reports it and moves on.
 */
function patchDmgEntry(text, entry) {
  const { url, sha512, size } = entry || {};
  if (typeof text !== 'string') throw new Error('patchDmgEntry: text must be a string.');
  if (!url || !DMG_RE.test(url)) {
    throw new Error(`patchDmgEntry: url must name a .dmg (got ${JSON.stringify(url)}).`);
  }
  if (typeof sha512 !== 'string' || !SHA512_RE.test(sha512)) {
    throw new Error('patchDmgEntry: sha512 must be a base64 digest.');
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`patchDmgEntry: size must be a positive integer (got ${String(size)}).`);
  }

  const lines = text.split('\n');
  const dmgs = fileEntries(lines).filter((e) => DMG_RE.test(e.url));
  if (dmgs.length === 0) {
    throw new Error(
      'latest-mac.yml has NO .dmg entry — electron-builder did not emit one, so the ' +
        'feed cannot be repaired by patching. Check `build.mac.target` includes "dmg" and rebuild.'
    );
  }
  if (dmgs.length > 1) {
    throw new Error(
      `latest-mac.yml has ${dmgs.length} .dmg entries (${dmgs.map((e) => e.url).join(', ')}); ` +
        'this patcher rewrites exactly one. Clean dist/ and rebuild.'
    );
  }
  const dmg = dmgs[0];
  if (dmg.url !== url) {
    throw new Error(
      `latest-mac.yml names DMG "${dmg.url}" but the stapled file is "${url}" — the feed and ` +
        'the artifact are from different builds. Clean dist/ and rebuild rather than patching.'
    );
  }

  let sawSha = false;
  let sawSize = false;
  let changed = false;
  for (let i = dmg.start; i < dmg.end; i++) {
    const shaM = /^(\s*sha512:\s*)(.*)$/.exec(lines[i]);
    if (shaM && !sawSha) {
      sawSha = true;
      if (shaM[2] !== sha512) changed = true;
      lines[i] = shaM[1] + sha512;
      continue;
    }
    const sizeM = /^(\s*size:\s*)(.*)$/.exec(lines[i]);
    if (sizeM && !sawSize) {
      sawSize = true;
      if (sizeM[2] !== String(size)) changed = true;
      lines[i] = sizeM[1] + String(size);
    }
  }
  if (!sawSha || !sawSize) {
    throw new Error(
      `latest-mac.yml's DMG entry is missing ${!sawSha ? 'sha512' : 'size'} — unexpected feed shape.`
    );
  }
  return { text: lines.join('\n'), changed };
}

/** Streaming so a 200 MB DMG is never held in memory. */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    const s = fs.createReadStream(file);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('base64')));
  });
}

/**
 * Assert every expected asset name is present on the release AND finished.
 *
 * Accepts either `gh release view --json assets` output (`{assets:[...]}`) or a
 * bare array. EXTRA assets are not an error — only absence is, since absence is
 * the failure that shipped twice. `state`/`size` are checked only when the row
 * carries them: a row that exists with `state: "starter"` or `size: 0` is an
 * upload that began and never landed, which reads as success to `gh` and as a
 * 404 to everyone else.
 */
function assertAssets(json, expected) {
  const assets = Array.isArray(json) ? json : (json && json.assets) || null;
  if (!Array.isArray(assets)) {
    throw new Error('assertAssets: expected `{assets:[...]}` or an array of assets.');
  }
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new Error('assertAssets: expected a non-empty list of asset names.');
  }
  const byName = new Map(assets.map((a) => [a && a.name, a]));
  const missing = expected.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    throw new Error(
      `RELEASE IS MISSING ${missing.length} ASSET(S): ${missing.join(', ')}\n` +
        `  present: ${assets.map((a) => a.name).join(', ') || '(none)'}\n` +
        '  remedy: re-run `gh release upload <tag> --clobber <files>` for the missing names.'
    );
  }
  const unfinished = expected.filter((n) => {
    const a = byName.get(n);
    if (a.state !== undefined && a.state !== 'uploaded') return true;
    return a.size !== undefined && !(Number(a.size) > 0);
  });
  if (unfinished.length > 0) {
    throw new Error(
      `RELEASE ASSET(S) PRESENT BUT NOT UPLOADED: ${unfinished.join(', ')}\n` +
        '  remedy: delete those assets and re-upload — a half-landed asset serves a 404.'
    );
  }
  return { ok: true, names: expected.slice(), extra: assets.map((a) => a.name).filter((n) => !expected.includes(n)) };
}

module.exports = { patchDmgEntry, assertAssets, fileEntries, hashFile };

// ── CLI ──────────────────────────────────────────────────────────────────────
// Kept at the bottom and behind a require.main guard so the test can import the
// pure halves without running anything.
async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'patch-dmg') {
    const [, ymlPath, dmgPath] = argv;
    if (!ymlPath || !dmgPath) throw new Error('usage: release-yml.js patch-dmg <yml> <dmg>');
    const size = fs.statSync(dmgPath).size;
    const sha512 = await hashFile(dmgPath);
    const before = fs.readFileSync(ymlPath, 'utf8');
    const { text, changed } = patchDmgEntry(before, { url: path.basename(dmgPath), sha512, size });
    if (changed) fs.writeFileSync(ymlPath, text);
    console.log(
      changed
        ? `  • yml DMG entry PATCHED  sha512=${sha512.slice(0, 12)}…  size=${size}`
        : `  • yml DMG entry already correct  sha512=${sha512.slice(0, 12)}…  size=${size}`
    );
    return;
  }
  if (cmd === 'assert-assets') {
    const [, src, ...names] = argv;
    if (!src || names.length === 0) {
      throw new Error('usage: release-yml.js assert-assets <assets.json|-> <name>...');
    }
    const raw = src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8');
    const res = assertAssets(JSON.parse(raw), names);
    console.log(`  • all ${res.names.length} assets present and uploaded`);
    if (res.extra.length > 0) console.log(`  • (also on the release: ${res.extra.join(', ')})`);
    return;
  }
  throw new Error(`unknown command ${JSON.stringify(cmd)} — expected patch-dmg | assert-assets`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  });
}
