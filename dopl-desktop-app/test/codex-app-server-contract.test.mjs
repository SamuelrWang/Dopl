// THE CODEX APP-SERVER COMPATIBILITY SUITE — U1's contract, in two tiers.
//
// 🔒 ⚠ **TIER 1 (ALWAYS RUNS) MEASURES DOPL. TIER 2 (OPT-IN) MEASURES CODEX.** They are not
// interchangeable and this file never lets one stand in for the other. Tier 1 proves Dopl's own
// logic — the fixture's provenance, the method list, the version floor — using inputs that are
// labelled HYPOTHETICAL at every use. Tier 2 is
// the only thing here that touches a real `codex`, and it is the only thing allowed to say what
// the protocol IS.
//
// 🔒 ⚠ **NOTHING IN TIER 1 IS A CLAIM ABOUT THE WIRE.** The plan's whole cause of death was 94
// tests green against synthetic fixtures (`docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`,
// research table, `Tests` row). A hypothetical input here is a function argument, never a
// transcript: it exercises a branch of Dopl's own code and asserts nothing about what OpenAI
// sends. The checked-in fixture is MEASURED from a real CLI (`npm run codex:schema`), and tier 1
// asserts it carries that provenance.
//
// ⚠ **OPT-IN, THE `RLS_REDTEAM_LIVE=1` WAY** (repo `CLAUDE.md`, gate 11): `CODEX_APP_SERVER_LIVE=1`.
// Mandatory in `npm run test:codex-compat`, which refuses to report success when the tier skipped.
//
//   ordinary unit run   npm test                                   (tier 2 skips, loudly)
//   with a Codex CLI    CODEX_APP_SERVER_LIVE=1 npm test           (tier 2 runs)
//   the release gate    npm run test:codex-compat                  (tier 2 is required)
//   regenerate fixture  npm run codex:schema

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  client, LIVE_ENV, REGENERATE_CMD,
  liveGate, liveOrThrow, announceGate, skipLive, skipTurn, TURN_ENV,
  readFixture,
  withAppServer, handshake, spawnSilentServer, leakedPids,
} from './_codex-app-server.mjs';

const GATE = announceGate(liveGate());
const FIXTURE = readFixture();

// ⚠ EVERY OBJECT BELOW IS A FUNCTION ARGUMENT, NOT A TRANSCRIPT.
const hypothetical = (value) => value;

// ══ TIER 1 — THE GATE'S OWN LOGIC, AND THE FIXTURE'S PROVENANCE ═════════════════════════════

describe('the fixture cannot lie about where it came from', () => {
  test('the fixture is MEASURED: its CLI version, its timestamp and its generator', () => {
    assert.equal(FIXTURE.status, 'MEASURED', `regenerate it with ${REGENERATE_CMD}`);
    assert.ok(FIXTURE.cli.version, 'a measured fixture names the CLI version it came from');
    assert.ok(FIXTURE.capturedAt, 'a measured fixture names when it was captured');
    assert.match(FIXTURE.generatedBy, /codex-app-server-schema\.js$/);
    assert.ok(FIXTURE.handshake.initialize, 'a measured fixture holds an initialize shape');
    // 🔒 A MEASURED FIXTURE MUST NAME ITS BINARY, because a binary inside another application
    // bundle is excluded by the plan's Scope Boundaries and a reviewer has to be able to see that
    // from the fixture alone.
    assert.ok(FIXTURE.cli.path, 'a measured fixture names the file it measured');
  });

  test('the fixture declares every method Dopl sends, or it is not a supported CLI', () => {
    const declared = FIXTURE.handshake.declaredMethods;
    assert.ok(declared, 'the CLI must enumerate its methods — `generate-json-schema` is the source');
    const have = new Set(declared.names);
    const absent = client.REQUIRED_METHODS.filter((m) => !have.has(m));
    assert.deepEqual(absent, [], `this CLI does not offer ${absent.join(', ')}`);
  });

  test('the fixture states the one command that regenerates it', () => {
    assert.equal(FIXTURE.regenerate, REGENERATE_CMD);
  });

  test('`doplRequires` has not drifted from the gate it mirrors', () => {
    // ⚠ NOT A PROTOCOL CLAIM — it is Dopl's own requirement, and the fixture carries a copy so a
    // reviewer reading the fixture alone sees what the suite will demand of their CLI.
    assert.deepEqual(FIXTURE.doplRequires.methods, client.REQUIRED_METHODS.slice());
  });
});

describe('the version gate', () => {
  test('a version below the pinned floor is refused as too old; the floor itself passes', () => {
    assert.ok(client.SUPPORTED_CLI.min, 'the floor is pinned to a measured CLI');
    const old = client.versionGate('codex-cli 0.31.0');
    assert.equal(old.ok, false);
    assert.equal(old.verdict, 'too-old');
    assert.equal(client.versionGate(`codex-cli ${client.SUPPORTED_CLI.min}`).verdict, 'supported');
  });

  test('an unreadable version is refused, never waved through', () => {
    assert.equal(client.versionGate(hypothetical('codex-cli nightly')).verdict, 'unreadable');
    assert.equal(client.versionGate(null).ok, false);
  });

  test('a version string is parsed out of whatever the CLI prints around it', () => {
    assert.deepEqual(client.parseVersion('codex-cli 0.31.2'), [0, 31, 2]);
    assert.deepEqual(client.parseVersion('1.4'), [1, 4, 0]);
    assert.equal(client.parseVersion('no numbers here'), null);
  });
});

// ══ THE TIMEOUT PATH — a real child, bounded, killed ════════════════════════════════════════

describe('a handshake that times out kills the child and hangs nothing', () => {
  test('the bounded helper rejects, and the silent child is dead afterwards', async () => {
    // ⚠ THE CHILD SAYS NOTHING. It is a `node` that holds stdin open — a timeout fixture, not a
    // protocol fixture, so it invents no wire shape.
    let pid = null;
    await assert.rejects(
      withAppServer({ timeoutMs: 250, connect: () => { const c = spawnSilentServer(); pid = c.child.pid; return c; } }, (conn) => conn.request('initialize', {})),
      /did not answer within 250ms/,
    );
    assert.ok(pid, 'the fixture child started');
    let stillThere = true;
    try { process.kill(pid, 0); } catch (_) { stillThere = false; }
    assert.equal(stillThere, false, 'the child must be dead once the bounded call returned');
  });

  test('a throw inside the bounded call still kills the child', async () => {
    let pid = null;
    await assert.rejects(
      withAppServer({ timeoutMs: 5000, connect: () => { const c = spawnSilentServer(); pid = c.child.pid; return c; } }, () => { throw new Error('boom'); }),
      /boom/,
    );
    let stillThere = true;
    try { process.kill(pid, 0); } catch (_) { stillThere = false; }
    assert.equal(stillThere, false);
  });

  test('the helper leaked nothing', () => {
    assert.deepEqual(leakedPids(), []);
  });
});

// ══ THE SKIP ITSELF IS TESTED ═══════════════════════════════════════════════════════════════

describe('a skipped live tier cannot read as a passing one', () => {
  test('an unset flag is not armed, and the reason names the flag', () => {
    const gate = liveGate({});
    assert.equal(gate.armed, false);
    assert.match(gate.reason, new RegExp(LIVE_ENV));
  });

  test('a real-turn arm skips, loudly, unless CODEX_LIVE_TURN=1', () => {
    const seen = [];
    const t = { diagnostic: (m) => seen.push(m), skip: (m) => seen.push(m) };
    const saved = process.env[TURN_ENV];
    try {
      delete process.env[TURN_ENV];
      assert.equal(skipTurn(t), true);
      assert.match(seen[0], /SKIPPED, NOT PASSED/);
      process.env[TURN_ENV] = '1';
      assert.equal(skipTurn(t), false);
    } finally {
      if (saved === undefined) delete process.env[TURN_ENV];
      else process.env[TURN_ENV] = saved;
    }
  });

  test('ARMED WITH NO BINARY is a refusal the release command can see', () => {
    const noBinary = () => ({ ok: false, reason: 'no codex on this machine' });
    const gate = liveGate({ [LIVE_ENV]: '1' }, noBinary);
    assert.equal(gate.armed, false);
    assert.match(gate.reason, new RegExp(`${LIVE_ENV}=1 was set but no Codex binary resolved`));
    assert.throws(() => liveOrThrow({ [LIVE_ENV]: '1' }, noBinary), /no Codex binary resolved/);
  });
});

// ══ TIER 2 — THE LIVE app-server. THE ONLY TIER THAT MAY SAY WHAT THE PROTOCOL IS ═══════════

describe('live Codex app-server contract', () => {
  test('initialize answers, and the catalog declares exactly one default', async (t) => {
    if (skipLive(t, GATE)) return;
    const result = await handshake({
      timeoutMs: 30000,
      extra: (conn) => conn.request('model/list', {}),
    });
    assert.ok(result.initialize && typeof result.initialize === 'object', 'initialize returned an object');
    const rows = (result.extra && Array.isArray(result.extra.data)) ? result.extra.data : [];
    const defaults = rows.filter((row) => row && row.isDefault === true).map((row) => row.id);
    assert.equal(defaults.length, 1, `model/list must declare exactly one default — got ${JSON.stringify(defaults)}`);
  });

  test('an UNKNOWN METHOD is refused by the server', async (t) => {
    if (skipLive(t, GATE)) return;
    const seen = await handshake({
      timeoutMs: 30000,
      extra: (conn) => conn.request('dopl/thisMethodDoesNotExist', {}).then(
        () => ({ refused: false }),
        (err) => ({ refused: true, code: err && err.code }),
      ),
    });
    assert.equal(seen.extra.refused, true, 'the app-server must refuse a method it does not have');
  });

  test('EXTRA unknown params in initialize are ignored, not treated as empty', async (t) => {
    if (skipLive(t, GATE)) return;
    const result = await withAppServer({ timeoutMs: 30000 }, (conn) => conn.request(
      'initialize',
      Object.assign(client.initializeParams('0.0.0-test'), { doplUnknownField: { nested: true } }),
    ));
    assert.ok(result && typeof result === 'object', 'an unknown extra param must not break initialize');
  });

  test('the checked-in fixture matches this CLI — otherwise REGENERATE it', async (t) => {
    if (skipLive(t, GATE)) return;
    const liveVersion = String(execFileSync(GATE.bin.path, ['--version'], {
      encoding: 'utf8', timeout: 10000,
    })).trim();
    assert.equal(
      FIXTURE.cli.version,
      liveVersion,
      `the fixture describes ${FIXTURE.cli.version}, but this release machine runs ${liveVersion}; regenerate it with ${REGENERATE_CMD}`,
    );
    const live = await handshake({ timeoutMs: 30000 });
    assert.ok(live.initialize);
    assert.ok(FIXTURE.cli.version, 'the measured fixture names a version');
  });

  test('the live tier leaked no app-server processes', (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(leakedPids(), []);
  });
});
