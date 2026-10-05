// THE VENDOR PROOF for a downloaded runtime (`./index.js`): every Mach-O in the unpacked package carries a
// strict, valid Developer ID signature from the runtime's own Apple team, and the CLI answers `--version`.
// `run(file, args)` resolves `{ code, stdout }` and is injected, so the suite stubs `codesign` and the CLI.
//
// ⚠ THE TEAM ID IS PINNED PER RUNTIME (`<adapter>/update-source.js › teamId`), NEVER READ OFF THE BUNDLE: a
// packaged Dopl re-signs its bundled CLIs under Dopl's own identity, so the bundle's team is ours, not the
// vendor's. A download is the vendor's own signed build, exactly as the vendor ships it standalone.

const fs = require('node:fs');
const path = require('node:path');

const CODESIGN = '/usr/bin/codesign';
// The first exec of a freshly written binary is scanned by macOS (Gatekeeper / XProtect) before it runs, which
// on a ~200 MB CLI and a busy Mac can outlast any short timeout; so one retry, longer, before a good build is
// refused. The second run also finds the scan done.
const VERSION_TIMEOUTS_MS = [30000, 120000];
// Thin and fat Mach-O, both byte orders.
const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/** Developer ID Application leaf, Apple-anchored, issued to `teamId` — the `codesign -R` text form. */
function requirement(teamId) {
  return 'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists'
    + ' and certificate leaf[field.1.2.840.113635.100.6.1.13] exists'
    + ` and certificate leaf[subject.OU] = "${teamId}"`;
}

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && MACHO_MAGIC.has(head.readUInt32BE(0));
  } finally {
    fs.closeSync(fd);
  }
}

/** Every Mach-O under `root`; a symlink is refused outright (it could point anywhere once unpacked). */
function machOFiles(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`the package carries a symlink: ${path.basename(p)}`);
    if (entry.isDirectory()) out.push(...machOFiles(p));
    else if (entry.isFile() && isMachO(p)) out.push(p);
  }
  return out;
}

/** Throws unless every Mach-O under `root` (and at least `bin`) satisfies the team's requirement. */
async function signatures(root, bin, teamId, run) {
  const files = machOFiles(root);
  if (!files.includes(bin)) throw new Error('the package does not carry the expected executable');
  for (const file of files) {
    const r = await run(CODESIGN, ['--verify', '--strict', `-R=${requirement(teamId)}`, file]);
    if (r.code !== 0) throw new Error(`${path.relative(root, file)} is not signed by team ${teamId}`);
  }
}

/** Throws unless `bin --version` exits 0 and prints a version. Not compared to the package's: a CLI may
 *  number itself apart from the package that carries it (the Claude SDK's 0.3.N carries CLI 2.1.N). */
async function answersVersion(bin, run) {
  for (const timeout of VERSION_TIMEOUTS_MS) {
    const r = await run(bin, ['--version'], { timeout });
    if (r.code === 0 && /\d+\.\d+\.\d+/.test(String(r.stdout || ''))) return;
  }
  throw new Error('the downloaded CLI did not answer --version');
}

module.exports = { signatures, answersVersion, requirement, machOFiles, VERSION_TIMEOUTS_MS };
