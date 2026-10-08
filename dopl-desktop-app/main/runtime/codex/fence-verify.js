// THE FEATURE FENCE, VERIFIED (2026-10-08). Dopl turns Codex features OFF per thread (`tools.js ›
// FEATURE_FENCE`: apps, plugins, multi_agent, goals, sleep_tool, memories, hooks). `thread/start`
// accepts ANY config key and echoes none of them, so a feature the vendor RENAMED would leave Dopl
// setting a dead key while the renamed feature stays on — a fence failing OPEN, silently.
//
// The build answers for itself: `codex features list`, run against Dopl's private home with the same
// values passed as `-c features.<name>=<value>`, lists every feature it KNOWS with its EFFECTIVE state.
// A fence holds only when every feature Dopl turns off is (a) known to this build, (b) not `removed`
// (Dopl cannot tell what replaced it), and (c) effectively off. Anything else refuses the launch.
// ⚠ FAIL CLOSED: a listing that cannot be run or read refuses too, naming the cause.
// ⚠ ONE RUN PER (binary, fence): cached in memory by the binary's path + mtime + the fence's own
//   values, so a build switch or a changed fence re-verifies and nothing else does.

const fs = require('fs');
const { execFile } = require('child_process');

const LIST_TIMEOUT_MS = 15000;
// `<name> <stage words…> <true|false>` — the stage may be one word or two ("under development").
const ROW = /^([a-z0-9_]+)\s+(.+?)\s+(true|false)\s*$/;

const verified = new Map(); // cacheKey → true

/** `{ name: { stage, enabled } }` from `codex features list` stdout; `{}` when nothing parses. */
function parseFeatures(stdout) {
  const out = {};
  for (const line of String(stdout || '').split('\n')) {
    const m = ROW.exec(line.trim());
    if (m) out[m[1]] = { stage: m[2].trim(), enabled: m[3] === 'true' };
  }
  return out;
}

/** Problems (sentences) with a fence against a parsed listing; empty = it holds. Pure. */
function fenceProblems(features, listing) {
  const off = Object.keys(features || {}).filter((k) => features[k] === false);
  const problems = [];
  if (!Object.keys(listing || {}).length) return ['Codex listed no features Dopl could read'];
  for (const name of off) {
    const row = listing[name];
    if (!row) problems.push(`Codex no longer knows the feature "${name}" (renamed or gone)`);
    else if (/removed/i.test(row.stage)) problems.push(`Codex has removed the feature "${name}"`);
    else if (row.enabled) problems.push(`Codex kept the feature "${name}" on after Dopl turned it off`);
  }
  return problems;
}

function overrides(features) {
  const args = [];
  for (const k of Object.keys(features || {}).sort()) {
    if (typeof features[k] !== 'boolean' || !/^[a-z0-9_]+$/.test(k)) continue;
    args.push('-c', `features.${k}=${features[k]}`);
  }
  return args;
}

function cacheKeyFor(bin, features) {
  let stamp = '';
  try { stamp = String(fs.statSync(bin).mtimeMs); } catch (_) { stamp = ''; }
  return `${bin}|${stamp}|${JSON.stringify(Object.keys(features || {}).sort().map((k) => [k, features[k]]))}`;
}

function runList(bin, env, features) {
  return new Promise((resolve, reject) => {
    try {
      execFile(bin, ['features', 'list'].concat(overrides(features)), {
        env, encoding: 'utf8', timeout: LIST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
      }, (err, out) => (err ? reject(err) : resolve(out)));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Resolve when every feature this fence turns off is known, present and effectively off on `bin`;
 * REJECT (the launch is refused) otherwise, naming why. `deps.run` is the seam for tests.
 */
async function verifyFeatureFence(bin, env, features, deps) {
  const off = Object.keys(features || {}).filter((k) => features[k] === false);
  if (!off.length) return;
  if (!bin) throw new Error('Dopl could not find the Codex build to check its safety settings against — refusing the launch.');
  const key = cacheKeyFor(bin, features);
  if (verified.has(key)) return;
  let stdout;
  try {
    stdout = await ((deps && deps.run) || runList)(bin, env, features);
  } catch (err) {
    throw new Error(`Dopl could not check Codex's feature switches (${(err && err.message) || 'no answer'}), so it `
      + 'cannot confirm Codex\'s own sub-agents, apps and plugins are off — refusing the launch.');
  }
  const problems = fenceProblems(features, parseFeatures(stdout));
  if (problems.length) {
    throw new Error(`${problems.join('; ')} — Dopl cannot confirm its restrictions hold on this Codex build, `
      + 'so it will not start the session. An update to Dopl is needed for this build.');
  }
  verified.set(key, true);
}

/** Tests only. */
function forget() { verified.clear(); }

module.exports = { verifyFeatureFence, parseFeatures, fenceProblems, forget };
