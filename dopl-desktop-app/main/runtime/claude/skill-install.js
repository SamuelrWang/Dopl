// Install the Dopl-authored Claude Code skills into the operator's own skills
// directory (`~/.claude/skills/<name>/`), from the copies bundled in this app.
//
// ⚠ **IT LIVES IN THE CLAUDE ADAPTER, AND THE SCAN IS WHY.** `~/.claude/skills`
// is one runtime's convention — Codex and Cursor have their own, or none — so a
// core module naming that path would be exactly the branch `test/core-vocabulary
// .test.mjs` exists to stop. The sign-in lane that calls it (`mcp-config.js`)
// is already on that scan's deferred census for the same reason: it drives the
// vendor's own CLI. When a second runtime grows a skills convention, this file
// gets a sibling under `main/runtime/<that one>/` rather than an `if`.
//
// WHY THE DESKTOP DOES THIS AT ALL. A skill is the only teaching surface that
// reaches a Claude Code session BEFORE it calls a tool — earlier than the MCP
// `instructions` block, and much earlier than any result. `dopl-channels-wait`
// has to be there before the session decides how to wait, because by the time
// it is re-reading a channel on a timer the lesson is already being paid for.
// This runs on the same signed-in lane that ensures the CLI's `dopl` MCP entry
// (`mcp-config.js › ensureMcpConfigInner`), because a skill that drives that
// server and the entry that registers it should arrive together.
//
// ⚠ **IT NEVER CLOBBERS AN EDIT, AND THAT IS THE WHOLE DESIGN.** An earlier
// generation of this idea (`dopl mcp config --write`, audited in
// docs/M5-M6-M10-AUDIT-FINDINGS.md) read the bundled file and wrote it over the
// target with no version check, no diff and no backup — so an operator who
// fixed a typo in their own skill lost it on the next launch, silently. Here,
// a `.dopl-installed.json` sidecar records the version AND the sha256 of every
// file this app wrote. On a later launch:
//   • no sidecar and no directory → install.
//   • sidecar version equals the bundled one → nothing to do, no writes.
//   • sidecar present, files still hash to what we wrote → upgrade.
//   • ANY file hashes differently → the operator edited it. Leave everything
//     alone and say so in diag. Their copy keeps working; ours does not
//     overwrite it.
//   • a directory with NO sidecar → not ours. Never touched.
//
// ⚠ **BEST-EFFORT, NEVER THROWS, NEVER BLOCKS SIGN-IN.** A read-only home, a
// missing `~/.claude`, a full disk: all of it is diag and return. Nothing in
// this app depends on the skill existing.
//
// ⚠ **THE SCRIPT SHIPS BESIDE THE SKILL, AND THAT IS DELIBERATE.** The skill
// tells a session to run a hold in a background task; a session on a machine
// that has never cloned the Dopl repo has nowhere to run one from. The repo's
// `scripts/dopl-channel-wait.sh` is the canonical source and this is a bundled
// copy of it, joined by `test/skill-assets-parity.test.mjs` — which reads BOTH
// files and fails from either side, the join `runtime-stamp-literals.test.mjs`
// established for the other constants this tree cannot import.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { diag } = require('../../diag');

/** The sidecar this installer writes beside the files it owns. */
const SIDECAR = '.dopl-installed.json';

/** Where the bundled copies live inside the app. */
function bundledSkillsDir() {
  return path.join(__dirname, 'skills');
}

/** The operator's own skills directory. ⚠ Theirs — we only ever add subdirs. */
function targetSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * The bundled version, read off SKILL.md's frontmatter rather than kept as a
 * second constant. ⚠ One number, in the file a reader is looking at.
 */
function bundledVersion(skillDir) {
  try {
    const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const m = md.match(/^version:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Every file this installer would write for one skill, as {name → contents}.
 * ⚠ FLAT ON PURPOSE — a skill is a SKILL.md plus a handful of siblings, and a
 * recursive copy here would be a general-purpose file writer aimed at the
 * operator's home directory.
 */
function bundledFiles(skillDir) {
  const out = new Map();
  for (const name of fs.readdirSync(skillDir)) {
    const full = path.join(skillDir, name);
    if (!fs.statSync(full).isFile()) continue;
    out.set(name, fs.readFileSync(full));
  }
  return out;
}

/**
 * Is the installed copy still exactly what we wrote?
 *
 * ⚠ Answers FALSE for anything it cannot prove: a missing sidecar, an
 * unreadable one, a file that is gone, a hash that does not match. "I cannot
 * tell" and "the operator edited it" get the same answer, and that answer is
 * the one that writes nothing.
 */
function isUntouched(dir, sidecar) {
  if (!sidecar || !sidecar.files) return false;
  for (const [name, hash] of Object.entries(sidecar.files)) {
    let actual;
    try {
      actual = sha256(fs.readFileSync(path.join(dir, name)));
    } catch (_) {
      return false;
    }
    if (actual !== hash) return false;
  }
  return true;
}

function readSidecar(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, SIDECAR), 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Install or upgrade ONE skill. Returns a short word for the diag line. */
function installSkill(name) {
  const source = path.join(bundledSkillsDir(), name);
  const target = path.join(targetSkillsDir(), name);
  const version = bundledVersion(source);
  if (!version) return 'no-version';

  const exists = fs.existsSync(target);
  const sidecar = exists ? readSidecar(target) : null;

  if (exists && !sidecar) return 'foreign';
  if (exists && sidecar && sidecar.version === version) return 'current';
  if (exists && !isUntouched(target, sidecar)) return 'edited';

  const files = bundledFiles(source);
  fs.mkdirSync(target, { recursive: true });
  const hashes = {};
  for (const [file, contents] of files) {
    const dest = path.join(target, file);
    fs.writeFileSync(dest, contents);
    // ⚠ The script has to be runnable; SKILL.md must not be. Executable only
    // for what the skill's own text tells a session to run.
    if (file.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    hashes[file] = sha256(contents);
  }
  fs.writeFileSync(
    path.join(target, SIDECAR),
    `${JSON.stringify({ version, files: hashes, writtenAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return exists ? 'upgraded' : 'installed';
}

/**
 * Install every bundled skill. ⚠ Best-effort per skill: one that fails must not
 * stop the next, and none of them may fail the sign-in lane that calls this.
 */
function ensureDoplSkills() {
  let names;
  try {
    names = fs.readdirSync(bundledSkillsDir());
  } catch (_) {
    diag('skill-install: no bundled skills directory');
    return;
  }
  for (const name of names) {
    try {
      if (!fs.statSync(path.join(bundledSkillsDir(), name)).isDirectory()) continue;
      diag('skill-install:', name, installSkill(name));
    } catch (err) {
      diag('skill-install:', name, 'error', err && err.message);
    }
  }
}

module.exports = { ensureDoplSkills, bundledSkillsDir, targetSkillsDir, SIDECAR };
