// THE SKILLS FENCE — no skill catalogue, personal or bundled, reaches a Dopl-launched Codex agent.
//
// 🔒 ⚠ **THE CLAUDE LANE STRIPS THE OPERATOR'S PERSONAL SKILL CATALOGUE ON PURPOSE** (`runtime/
// claude/tools.js › FULL_BUILTIN_BOUND`, `Skill` removed): an agent in a SHARED channel could
// repeat it to other members (the F-268 privacy class), it is ~8k characters of context on every
// turn, and it breaks prompt-cache identity across machines. An isolated CODEX_HOME did not do
// the same here: MEASURED 2026-09-22 (codex-cli 0.155.1) Codex lists skills from
//   `~/.agents/skills`                       — the operator's own (Samuel's ce-* etc.)
//   `$CODEX_HOME/skills/.system`             — Codex's bundled five, installed into the private home
//   `<cwd>/.codex/skills`
//   `<dir>/.agents/skills` for every dir from the project root (the `.git` marker) down to cwd
// — independent of the project-trust fence — ~23k characters of prompt with Samuel's set, and a
// `$skill-name` mention in the turn text INJECTED that skill's whole body into the model input.
//
// ⚠ THREE LEVERS, EACH MEASURED, BECAUSE ONE IS NOT ENOUGH:
//   `skills.include_instructions = false`   the listing section leaves the prompt — but a
//                                           `$mention` STILL injected the body.
//   `skills.bundled.enabled = false`        the bundled `.system` root leaves. They are dropped,
//                                           not kept: `skill-installer` / `skill-creator` /
//                                           `plugin-creator` WRITE persistent skills or plugins,
//                                           and Claude's lane has no skills at all.
//   `skills.config = [{ path|name, enabled = false }]`  per SKILL.md — the only selector that
//                                           stopped a `$mention`. A ROOT directory path does
//                                           nothing, so the roots above are ENUMERATED at launch.
// ⚠ `features.skip_host_skill_discovery` WAS MEASURED AND DOES NOTHING on this build (it is
// "under development"). A HOME override was NOT used: HOME reaches the agent's shell, its login
// rc files, git config and the shell snapshot — a much wider change than a skills fence.
// ⚠ RESIDUAL, STATED: a skill written into one of these roots AFTER launch is not in this list.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_DEPTH = 4;
const MAX_SKILLS = 1000;
const NAME_RE = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m;

function ancestors(dir) {
  const out = [];
  if (typeof dir !== 'string' || !dir) return out;
  let d = path.resolve(dir);
  for (;;) {
    out.push(d);
    const up = path.dirname(d);
    if (up === d) return out;
    d = up;
  }
}

/** Every root Codex reads skills from, as a SUPERSET: every ancestor of cwd is scanned, not only the project's. */
function skillRoots(opts) {
  const o = opts || {};
  const home = o.home || os.homedir();
  const roots = [path.join(home, '.agents', 'skills'), '/etc/codex/skills'];
  if (o.codexHome) roots.push(path.join(o.codexHome, 'skills'));
  for (const a of ancestors(o.cwd)) {
    roots.push(path.join(a, '.agents', 'skills'), path.join(a, '.codex', 'skills'));
  }
  return Array.from(new Set(roots));
}

function findSkillFiles(root, depth, out) {
  if (out.length >= MAX_SKILLS || depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.name === 'SKILL.md') { out.push(full); continue; }
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (_) { isDir = false; } }
    if (isDir) findSkillFiles(full, depth + 1, out);
    if (out.length >= MAX_SKILLS) return;
  }
}

function skillName(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4096);
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
    const n = m && NAME_RE.exec(m[1]);
    return n ? n[1].trim() : '';
  } catch (_) {
    return '';
  }
}

/** The `thread/start.config.skills` value. */
function skillsFence(opts) {
  const files = [];
  for (const root of skillRoots(opts)) findSkillFiles(root, 0, files);
  const paths = new Set();
  const names = new Set();
  for (const f of files) {
    paths.add(f);
    // Both spellings: Codex may compare the canonical path (`/var` → `/private/var` on macOS).
    try { paths.add(fs.realpathSync(f)); } catch (_) { /* a dangling link lists nothing */ }
    const n = skillName(f);
    if (n) names.add(n);
  }
  // ⚠ SEPARATE ENTRIES: Codex ignores an entry carrying both a path and a name selector.
  const config = Array.from(paths).sort().map((p) => ({ path: p, enabled: false }))
    .concat(Array.from(names).sort().map((n) => ({ name: n, enabled: false })));
  return { include_instructions: false, bundled: { enabled: false }, config };
}

module.exports = { skillsFence, skillRoots, ancestors, MAX_SKILLS };
