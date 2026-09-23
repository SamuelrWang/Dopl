// No skill catalogue (`~/.agents/skills`, bundled `.system`, project roots) reaches a Dopl-launched Codex
// agent; Claude strips `Skill` too (shared-channel privacy, F-268). `include_instructions=false` drops the
// listing, `bundled.enabled=false` the bundled set, and only per-SKILL.md `{path}`/`{name}` `enabled:false`
// entries stop a `$mention` (a root path does nothing, so roots are enumerated at launch).
// `features.skip_host_skill_discovery` does nothing (measured). Residual: a skill added after launch.

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

/** Every root Codex reads skills from, as a superset: every ancestor of cwd, not only the project's. */
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
  // Past the cap, later skills are unfenced; say so rather than truncate silently (CX-31).
  if (files.length >= MAX_SKILLS && opts && typeof opts.log === 'function') {
    opts.log('codex: skills fence hit its cap of', MAX_SKILLS, 'SKILL.md files — any beyond it are not fenced');
  }
  const paths = new Set();
  const names = new Set();
  for (const f of files) {
    paths.add(f);
    // Both spellings: Codex may compare the canonical path (`/var` → `/private/var` on macOS).
    try { paths.add(fs.realpathSync(f)); } catch (_) { /* a dangling link lists nothing */ }
    const n = skillName(f);
    if (n) names.add(n);
  }
  // Separate entries, deliberately: Codex ignores one carrying both a path and a name selector.
  const config = Array.from(paths).sort().map((p) => ({ path: p, enabled: false }))
    .concat(Array.from(names).sort().map((n) => ({ name: n, enabled: false })));
  return { include_instructions: false, bundled: { enabled: false }, config };
}

module.exports = { skillsFence, skillRoots, ancestors };
