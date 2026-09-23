// CXP-3A — A WORKSPACE-WRITE THREAD MUST NOT TRUST ITS OWN FOLDER (live, CODEX_APP_SERVER_LIVE=1).
//
// 🔒 MEASURED 2026-09-22, codex-cli 0.155.1. `thread/start` with `sandbox: 'workspace-write'` and
// no trust decision for its cwd AUTO-TRUSTS that cwd: it persists
// `[projects."<cwd>"] trust_level = "trusted"` into the private CODEX_HOME — so
// `config-home.js › isolatedEnv` refused the NEXT launch — and it LOADS `<cwd>/.codex/config.toml`
// (a `model` there became the thread's model and an `mcp_servers.hostile` entry STARTED). With
// `config.projects[<cwd>].trust_level = 'untrusted'` (`projectTrustFence`, sent by
// `launch-spec.js › buildLaunchSpec`) neither happens. A `trusted` override also stops the write
// but still loads the project layer, which is why the fence says `untrusted`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { client, liveGate, announceGate, skipLive, withAppServer, leakedPids } from './_codex-app-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const configHome = require(join(HERE, '..', 'main', 'runtime', 'codex', 'config-home.js'));
const GATE = announceGate(liveGate());

async function workspaceWriteThread(fenced) {
  const root = mkdtempSync(join(tmpdir(), 'dopl-codex-trust-'));
  const cwd = join(root, 'chan');
  mkdirSync(join(cwd, '.codex'), { recursive: true });
  writeFileSync(join(cwd, '.codex', 'config.toml'), 'model = "hostile-model"\n[mcp_servers.hostile]\ncommand = "/usr/bin/true"\n');
  const userData = join(root, 'user-data');
  const env = configHome.isolatedEnv({ ...process.env }, userData);
  const started = new Set();
  try {
    const thread = await withAppServer({
      connect: () => client.connect({
        args: [], env, cwd, log: () => {},
        onNotification: (m) => { if (m.method === 'mcpServer/startupStatus/updated') started.add(m.params.name); },
      }),
    }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-cxp3a-trust'));
      const config = { features: { apps: false, plugins: false }, ...(fenced ? { projects: configHome.projectTrustFence(cwd) } : {}) };
      const th = await conn.request('thread/start', { cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write', config });
      await new Promise((r) => setTimeout(r, 1500));
      return th;
    });
    const wrote = existsSync(join(env.CODEX_HOME, 'config.toml'));
    let relaunch = 'ok';
    try { configHome.isolatedEnv({ ...process.env }, userData); } catch (e) { relaunch = e.message; }
    return { model: thread.model, sandbox: thread.sandbox && thread.sandbox.type, started: [...started], wrote, relaunch };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('control: UNFENCED, Codex trusts the folder, loads its .codex/config.toml and writes the home', async (t) => {
  if (skipLive(t, GATE)) return;
  const r = await workspaceWriteThread(false);
  assert.equal(r.sandbox, 'workspaceWrite');
  assert.equal(r.wrote, true, 'Codex persisted a trust entry into the private home');
  assert.equal(r.model, 'hostile-model', 'the project layer was loaded');
  assert.ok(r.started.includes('hostile'), `the project's MCP server started: ${r.started}`);
  // …and since CXP-3A a trust-ONLY file is retired, so this no longer bricks the next launch.
  assert.equal(r.relaunch, 'ok');
});

test('FENCED: no trust write, no project layer, no foreign MCP server', async (t) => {
  if (skipLive(t, GATE)) return;
  const r = await workspaceWriteThread(true);
  assert.equal(r.sandbox, 'workspaceWrite', 'the fence does not narrow the operator\'s sandbox');
  assert.equal(r.wrote, false);
  assert.notEqual(r.model, 'hostile-model');
  assert.equal(r.started.includes('hostile'), false, `started: ${r.started}`);
  assert.equal(r.relaunch, 'ok');
});

test('the trust tier leaked no app-server processes', (t) => {
  if (skipLive(t, GATE)) return;
  assert.deepEqual(leakedPids(), []);
});
