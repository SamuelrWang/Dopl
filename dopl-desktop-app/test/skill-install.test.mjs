// THE SKILL INSTALLER — `main/skill-install.js`, and the one property that is
// worth a suite: **it never overwrites something the operator changed.**
//
// WHY THIS FILE EXISTS. The previous generation of this idea shipped without
// it: `dopl mcp config --write` read the bundled SKILL.md and wrote it over
// `~/.claude/skills/dopl/SKILL.md` with no version check, no diff and no
// backup, so an operator who fixed a typo lost it on the next run, silently
// (docs/M5-M6-M10-AUDIT-FINDINGS.md). The finding names the missing check; this
// file is that check, asserted from both directions — an untouched copy IS
// upgraded, an edited one is NOT.
//
// ⚠ IT LIVES IN THE CLAUDE ADAPTER (`main/runtime/claude/skill-install.js`),
// because `~/.claude/skills` is one runtime's convention and core may not name
// one — see `test/core-vocabulary.test.mjs`.
//
// ⚠ IT DRIVES THE REAL MODULE AGAINST A REAL TEMPORARY HOME. `installSkill` is
// not exported and must not be: what the sign-in lane calls is
// `ensureDoplSkills`, and a suite that reached past it into a private helper
// would stop covering the thing that actually runs. `os.homedir` is the one
// seam, monkey-patched per case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, '..', 'main', 'runtime', 'claude');

/** A throwaway HOME, so nothing here can reach the operator's own skills. */
function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dopl-skill-'));
  const realHomedir = os.homedir;
  os.homedir = () => home;
  try {
    return fn(home);
  } finally {
    os.homedir = realHomedir;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** ⚠ Fresh module per case — `diag` and the module cache both hold state. */
function loadInstaller() {
  delete require.cache[require.resolve(path.join(MAIN, 'skill-install.js'))];
  return require(path.join(MAIN, 'skill-install.js'));
}

const SKILL = 'dopl-channels-wait';

test('installs the bundled skill and its script into a fresh home', () => {
  withHome((home) => {
    loadInstaller().ensureDoplSkills();
    const dir = path.join(home, '.claude', 'skills', SKILL);
    assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), 'SKILL.md was not written');
    assert.ok(
      fs.existsSync(path.join(dir, 'dopl-channel-wait.sh')),
      'the hold script must ship WITH the skill — a session on a machine that never cloned the repo has nowhere else to run one from',
    );
    // ⚠ The script has to be runnable and SKILL.md must not be.
    assert.equal(fs.statSync(path.join(dir, 'dopl-channel-wait.sh')).mode & 0o111, 0o111);
    assert.equal(fs.statSync(path.join(dir, 'SKILL.md')).mode & 0o111, 0);
    const sidecar = JSON.parse(fs.readFileSync(path.join(dir, '.dopl-installed.json'), 'utf8'));
    assert.ok(sidecar.version, 'the sidecar must record the version it wrote');
    assert.ok(sidecar.files['SKILL.md'], 'the sidecar must record a hash per file');
  });
});

test('a second run writes nothing — same version, no churn', () => {
  withHome((home) => {
    const installer = loadInstaller();
    installer.ensureDoplSkills();
    const file = path.join(home, '.claude', 'skills', SKILL, 'SKILL.md');
    const before = fs.statSync(file).mtimeMs;
    // ⚠ mtime is the only observable "did it write", and it is coarse — so the
    // file is stamped into the past rather than the clock being trusted.
    fs.utimesSync(file, new Date(0), new Date(0));
    installer.ensureDoplSkills();
    assert.equal(fs.statSync(file).mtimeMs, 0, 'a same-version run must not rewrite the file');
    assert.ok(before >= 0);
  });
});

test('AN OPERATOR EDIT IS NEVER CLOBBERED — the whole point of the sidecar', () => {
  withHome((home) => {
    const installer = loadInstaller();
    installer.ensureDoplSkills();
    const file = path.join(home, '.claude', 'skills', SKILL, 'SKILL.md');
    const mine = '# my own notes, please keep them\n';
    fs.writeFileSync(file, mine);
    // Pretend a newer build shipped: the sidecar says an older version, so the
    // installer WOULD upgrade — except the hash no longer matches.
    const sidecarPath = path.join(home, '.claude', 'skills', SKILL, '.dopl-installed.json');
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    sidecar.version = '0.0.1';
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));

    installer.ensureDoplSkills();
    assert.equal(fs.readFileSync(file, 'utf8'), mine, 'the operator edit was overwritten');
  });
});

test('an UNTOUCHED copy at an older version IS upgraded', () => {
  withHome((home) => {
    const installer = loadInstaller();
    installer.ensureDoplSkills();
    const dir = path.join(home, '.claude', 'skills', SKILL);
    const sidecarPath = path.join(dir, '.dopl-installed.json');
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    const shipped = sidecar.version;
    sidecar.version = '0.0.1';
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));

    installer.ensureDoplSkills();
    const after = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    // ⚠ THE OTHER DIRECTION, and it matters as much: an installer that refused
    // every upgrade would pass the case above and never ship a fix.
    assert.equal(after.version, shipped, 'an untouched older copy must be upgraded');
  });
});

test('a skills directory this app did not write is left alone entirely', () => {
  withHome((home) => {
    const dir = path.join(home, '.claude', 'skills', SKILL);
    fs.mkdirSync(dir, { recursive: true });
    const theirs = '---\nname: dopl-channels-wait\n---\nsomeone else authored this\n';
    fs.writeFileSync(path.join(dir, 'SKILL.md'), theirs);

    loadInstaller().ensureDoplSkills();
    assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), theirs);
    assert.ok(
      !fs.existsSync(path.join(dir, '.dopl-installed.json')),
      'no sidecar means not ours — the installer must not adopt it by writing one',
    );
  });
});

test('an unwritable home is a no-op, never a throw', () => {
  withHome((home) => {
    // ⚠ This runs on the SIGN-IN lane (`mcp-config.js › ensureMcpConfigInner`).
    // A read-only home must cost a diag line, never the CLI-entry ensure that
    // follows it.
    fs.chmodSync(home, 0o500);
    try {
      assert.doesNotThrow(() => loadInstaller().ensureDoplSkills());
    } finally {
      fs.chmodSync(home, 0o700);
    }
  });
});
