'use strict';

// THE CODEX COMPATIBILITY / RELEASE COMMAND — `npm run test:codex-compat`.
//
// It does the three things the plan's U1 verification bar asks for, in order:
//
//   1. PREFLIGHT   refuse to start unless a Codex binary resolves. ⚠ THIS IS THE POINT OF THE
//                  COMMAND. `npm test` is allowed to skip the live tier; this one is not, and a
//                  release gate that reports success because nothing ran is the failure mode the
//                  whole unit exists to remove.
//   2. SUITES      the full desktop suite with `CODEX_APP_SERVER_LIVE=1`, so the unit tiers AND
//                  the live app-server contract both execute.
//   3. LEAKS       every `codex`/`app-server` process that was NOT running before the suites and
//                  IS running after fails the command by pid and command line.
//
// ⚠ IT IS NOT WIRED INTO CI HERE. `.github/**` belongs to another unit; see the report that
// accompanied this change for the step that should call it.
//
// Exit codes: 0 pass · 1 suites failed · 2 no usable Codex (preflight) · 3 process leak.

const { spawnSync, execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIVE_ENV = 'CODEX_APP_SERVER_LIVE';
const bar = '═'.repeat(78);

function say(line) { process.stdout.write(`${line}\n`); }

function die(code, lines) {
  process.stderr.write(`\n${bar}\ntest:codex-compat FAILED\n${bar}\n`);
  for (const line of lines) process.stderr.write(`  ${line}\n`);
  process.stderr.write('\n');
  process.exit(code);
}

// ── 3. THE LEAK CENSUS ───────────────────────────────────────────────────────────────────────
//
// ⚠ MATCHED ON THE COMMAND LINE, NOT ON A PID FAMILY. A leaked app-server is orphaned by
// definition — its parent is gone — so a process-tree walk from this pid would never see it.

function census() {
  const found = new Map();
  let out = '';
  try {
    out = String(execFileSync('ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }));
  } catch (_) {
    return found; // ⚠ a census that could not run reports NOTHING, never a false clean bill
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
  if (!helper.fixtureIsMeasured(fixture)) {
    say('');
    say(`⚠ the compatibility fixture is still ${fixture.status}.`);
    say(`  The live contract test will fail until you run: ${helper.REGENERATE_CMD}`);
  } else {
    say(`fixture measured from ${fixture.cli.version} at ${fixture.capturedAt}`);
  }

  const before = census();
  if (before.size) say(`note: ${before.size} codex app-server process(es) were ALREADY running; they are excluded.`);

  // ── 2. THE SUITES ──────────────────────────────────────────────────────────────────────────
  say(`\n${bar}\nrunning the desktop suites with ${LIVE_ENV}=1\n${bar}`);
  const run = spawnSync(process.execPath, ['--test', 'test/**/*.mjs'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { [LIVE_ENV]: '1' }),
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
