// Builds `native/build/dopl-dictation` — the on-device speech helper (native/dictation/main.swift)
// — as a universal (arm64 + x86_64) Mach-O.
//
// Runs as electron-builder's `beforePack` hook, so every `build` / `dist` / `release` ships a
// fresh helper; also runnable by hand: `node scripts/build-dictation-helper.js`.
//
// ⚠ IT FAILS THE BUILD when it cannot compile. A release without the helper would ship a mic
// button that can only ever answer "Dictation unavailable"; a broken build is the louder, better
// outcome. (At runtime a MISSING helper is still handled honestly — `main/dictation.js` reports
// `helper-missing` — but a packaged app should never reach that state.)
//
// SIGNING: nothing here. The binary lands in Contents/Resources/dictation/ via `extraResources`,
// and electron-builder's signer walks the whole bundle, signing every Mach-O it finds with
// hardened runtime + `entitlementsInherit` (which carries `device.audio-input`). The notarize
// hook (`scripts/notarize.js`) then submits the bundle as before.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'native', 'dictation', 'main.swift');
const PLIST = path.join(ROOT, 'native', 'dictation', 'Info.plist');
const OUT_DIR = path.join(ROOT, 'native', 'build');
const OUT = path.join(OUT_DIR, 'dopl-dictation');
// Electron 43 itself requires macOS 12; the helper asks for nothing newer (punctuation is
// `#available`-gated to 13).
const MIN_MACOS = '12.0';
const ARCHES = ['arm64', 'x86_64'];

function build() {
  if (process.platform !== 'darwin') {
    console.log('[dictation-helper] not macOS — skipped (no engine on this platform yet)');
    return null;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const slices = ARCHES.map((arch) => {
    const out = path.join(OUT_DIR, `dopl-dictation-${arch}`);
    execFileSync(
      'xcrun',
      [
        'swiftc', '-O', '-target', `${arch}-apple-macos${MIN_MACOS}`, SRC, '-o', out,
        // The usage strings, embedded: see native/dictation/Info.plist's header.
        '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', PLIST,
      ],
      { stdio: 'inherit' }
    );
    return out;
  });
  execFileSync('xcrun', ['lipo', '-create', ...slices, '-output', OUT], { stdio: 'inherit' });
  for (const s of slices) fs.rmSync(s, { force: true });
  fs.chmodSync(OUT, 0o755);
  console.log('[dictation-helper] built', path.relative(ROOT, OUT));
  return OUT;
}

// electron-builder hook signature: (context) => Promise<void>.
module.exports = async function beforePack() {
  build();
};
module.exports.build = build;

if (require.main === module) build();
