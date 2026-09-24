// THE IN-APP CODEX SIGN-IN AGAINST THE REAL BUNDLED CLI — opt-in (`CODEX_APP_SERVER_LIVE=1`), and it
// NEVER COMPLETES A LOGIN: the browser is a recorder, the flow is left to time out, and the test proves
// the real app-server handed back an OpenAI URL, the login was cancelled, the child is dead, the login
// port is free and no credential was installed. Everything lives under a temp user-data root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { client, liveGate, announceGate, skipLive } from './_codex-app-server.mjs';

const require = createRequire(import.meta.url);
const login = require('../main/runtime/codex/login.js');

const GATE = announceGate(liveGate());
// The app-server's ChatGPT login callback port (measured on 0.155.1: `redirect_uri` is localhost:1455).
const LOGIN_PORT = 1455;

const portFree = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };

test('the real app-server returns an OpenAI auth URL, and a timed-out flow leaves nothing running', { timeout: 60000 }, async (t) => {
  if (skipLive(t, GATE)) return;
  if (!(await portFree(LOGIN_PORT))) {
    t.diagnostic(`port ${LOGIN_PORT} is busy on this machine — the browser flow cannot be measured here`);
    t.skip(`port ${LOGIN_PORT} busy`);
    return;
  }
  const root = mkdtempSync(join(tmpdir(), 'dopl-codex-signin-live-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const opened = [];
  const pids = [];
  const outcome = await login.signIn({
    electron: false,
    connect: (opts) => { const c = client.connect(opts); pids.push(c.child.pid); return c; },
    diag: () => {},
    version: () => '0.0.0-live',
    openExternal: async (url) => { opened.push(url); },
    showCode: () => () => {},
    onQuit: () => () => {},
    userDataRoot: root,
    timeoutMs: 8000,
  });
  assert.deepEqual(outcome, { ok: false, reason: 'timeout' });
  assert.equal(opened.length, 1, 'the browser flow started (no device-code fallback)');
  assert.equal(login.isOpenAiUrl(opened[0]), true);
  assert.equal(new URL(opened[0]).host, 'auth.openai.com');
  assert.equal(pids.length, 1);
  for (let i = 0; i < 40 && alive(pids[0]); i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(alive(pids[0]), false, 'the login app-server is gone');
  assert.equal(await portFree(LOGIN_PORT), true, 'no login server is left listening');
  assert.equal(existsSync(join(root, 'codex-login-home-v1')), false);
  assert.equal(existsSync(join(root, 'codex-runtime-home-v1', 'auth.json')), false, 'no credential installed');
});
