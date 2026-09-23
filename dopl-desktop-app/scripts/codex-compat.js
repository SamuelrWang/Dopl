'use strict';

// `npm run test:codex-compat`, the Codex release gate: refuses to start unless a Codex binary resolves (a
// gate that passes because nothing ran is what it exists to prevent), runs the desktop suite with the live
// tiers armed (cheapest model, low effort), then fails on any leaked app-server. Not wired into CI.
// Exit codes: 0 pass · 1 suites failed · 2 no usable Codex (preflight) · 3 process leak.

const { spawnSync, execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIVE_ENV = 'CODEX_APP_SERVER_LIVE';
const TURN_ENV = 'CODEX_LIVE_TURN';
const bar = '═'.repeat(78);

function say(line) { process.stdout.write(`${line}\n`); }

function die(code, lines) {
  process.stderr.write(`\n${bar}\ntest:codex-compat FAILED\n${bar}\n`);
  for (const line of lines) process.stderr.write(`  ${line}\n`);
  process.stderr.write('\n');
  process.exit(code);
}

// Matched on the command line, not a pid family: a leaked app-server is orphaned, so no tree walk finds it.
function census() {
  const found = new Map();
  let out = '';
  try {
    out = String(execFileSync('ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }));
  } catch (_) {
    return found; // `ps` failed: an empty census, so the leak check cannot fire
  }
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[2];
    if (!/\bcodex\b/.test(command)) continue;
    if (!/app-server/.test(command)) continue;
    found.set(Number(m[1]), command.slice(0, 160));
  }
  return found;
}

async function main() {
  say(`\n${bar}\ntest:codex-compat — the Codex app-server compatibility gate\n${bar}`);

  // ── 1. PREFLIGHT ───────────────────────────────────────────────────────────────────────────
  const helper = await import(path.join(ROOT, 'test', '_codex-app-server.mjs'));
  let gate;
  try {
    gate = helper.liveOrThrow(Object.assign({}, process.env, { [LIVE_ENV]: '1' }));
  } catch (err) {
    die(2, [
      (err && err.message) || String(err),
      '',
      'This command REQUIRES a Codex CLI — it exists to prove the live protocol contract.',
      'Install the Codex CLI (or point DOPL_CODEX_BIN at it) and re-run.',
      'For a machine without Codex, `npm test` is the right command; its live tier skips loudly.',
    ]);
  }
  say(`preflight ok — ${gate.bin.path} (${gate.bin.source})`);

  const fixture = helper.readFixture();
  if (fixture.status !== 'MEASURED') {
    say('');
    say(`⚠ the compatibility fixture is still ${fixture.status}.`);
    say(`  The live contract test will fail until you run: ${helper.REGENERATE_CMD}`);
  } else {
    say(`fixture measured from ${fixture.cli.version} at ${fixture.capturedAt}`);
  }

  const before = census();
  if (before.size) say(`note: ${before.size} codex app-server process(es) were ALREADY running; they are excluded.`);

  // ── 2. THE SUITES ──────────────────────────────────────────────────────────────────────────
  say(`\n${bar}\nrunning the desktop suites with ${LIVE_ENV}=1 ${TURN_ENV}=1\n${bar}`);
  const run = spawnSync(process.execPath, ['--test', 'test/**/*.test.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { [LIVE_ENV]: '1', [TURN_ENV]: '1' }),
  });

  // ── 3. LEAKS ───────────────────────────────────────────────────────────────────────────────
  const after = census();
  const leaked = [];
  for (const [pid, command] of after) if (!before.has(pid)) leaked.push({ pid, command });

  if (run.status !== 0) {
    die(1, [
      `the desktop suites exited ${run.status}.`,
      leaked.length ? `⚠ AND ${leaked.length} app-server process(es) leaked — see below.` : '',
      ...leaked.map((l) => `leaked pid ${l.pid}: ${l.command}`),
    ].filter(Boolean));
  }
  if (leaked.length) {
    die(3, [
      `${leaked.length} codex app-server process(es) outlived the suites.`,
      'An orphan app-server holds a session\'s channel access with nothing pointing at it to stop it.',
      ...leaked.map((l) => `leaked pid ${l.pid}: ${l.command}`),
    ]);
  }

  say(`\n${bar}\ntest:codex-compat PASSED — suites green, live tier armed, no leaked app-server.\n${bar}\n`);
}

main().catch((err) => die(1, [(err && err.message) || String(err)]));
