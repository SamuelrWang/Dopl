// The first turn waits for Dopl's MCP server — measured on a real `codex app-server` against a Dopl stand-in
// whose handshake is slow. The model is the stub provider (zero quota); the launch is the REAL
// `launch-spec.js › buildLaunchSpec` + `› start`. Gated by `CODEX_APP_SERVER_LIVE=1`; fake-conn unit
// cases are `codex-mcp-ready.test.mjs`.
//
//   control  a turn started at once (the old pump) is built without Dopl: the first request cannot find it
//   fix      the same slow server through `start()`: the first request carries Dopl
//   failed   an unreachable server: the turn still runs, and one line says Dopl's tools did not connect
//   close    a close during the wait ends the stream and the child, and no request reaches the model

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { client, liveGate, announceGate, skipLive, withAppServer, terminateConn, leakedPids } from './_codex-app-server.mjs';
import { CH, CHANNEL_TOOL_DEF, STUB_MODEL, listen, scriptedModel, stubHome } from './_codex-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const launchSpec = require(join(CODEX, 'launch-spec.js'));
const configHome = require(join(CODEX, 'config-home.js'));
const { normalize } = require(join(CODEX, 'normalize.js'));

const GATE = announceGate(liveGate());
const SLOW_MS = 2000;
const BUDGET_MS = 60000;
const UNREACHABLE = 'http://127.0.0.1:1/api/mcp';

/** Dopl's MCP endpoint whose `initialize` answers after `delayMs`; `readyAt` is when `tools/list` answered. */
async function slowDopl(delayMs) {
  const at = { readyAt: null };
  const srv = await listen((req, res, body) => {
    let m = null; try { m = JSON.parse(body); } catch (_) { /* GET has no body */ }
    if (!m || m.id === undefined) { res.writeHead(202); res.end(); return; }
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'dopl-slow' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    };
    if (m.method === 'initialize') {
      setTimeout(() => reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dopl-slow', version: '0' } }), delayMs);
      return;
    }
    if (m.method === 'tools/list') { if (at.readyAt == null) at.readyAt = Date.now(); reply({ tools: [CHANNEL_TOOL_DEF] }); return; }
    reply({});
  });
  return { ...srv, at, url: `http://127.0.0.1:${srv.port}/api/mcp` };
}

/** The stub provider as process config (`start()`'s private home refuses a config.toml). */
function providerArgs(port) {
  return [
    'model_provider="stub"', 'model_providers.stub.name="stub"',
    `model_providers.stub.base_url="http://127.0.0.1:${port}/v1"`, 'model_providers.stub.wire_api="responses"',
    'model_providers.stub.requires_openai_auth=false', 'model_providers.stub.stream_max_retries=0',
    'model_providers.stub.request_max_retries=0',
  ].flatMap((kv) => ['-c', kv]);
}

/** Is Dopl visible in a Responses request's catalog (a `tool_search` source, or a tool at all)? */
function doplVisible(body) {
  const search = (body.tools || []).find((x) => x.type === 'tool_search');
  const sources = search ? [...search.description.matchAll(/^- ([^:\n]+)/gm)].map((m) => m[1]) : [];
  return sources.includes(mcp.SERVER_KEY) || JSON.stringify(body.tools || []).includes(mcp.CHANNEL_TOOL);
}

function pushQueue() {
  const items = [];
  let wake = null;
  return {
    push(m) { items.push(m); if (wake) { const w = wake; wake = null; w(); } },
    [Symbol.asyncIterator]() {
      return { next: async () => { while (!items.length) await new Promise((r) => { wake = r; }); return { value: items.shift(), done: false }; } };
    },
  };
}

/** Dopl's real launch spec with the stand-in URL, the stub provider and a fresh cwd. */
function doplSpec({ modelPort, url, prompts, cwd, lines }) {
  const spec = launchSpec.buildLaunchSpec({
    session: {
      key: 'live:codex:mcp-ready', profile: 'full', channelId: CH, state: {}, workspaceId: 'ws',
      model: STUB_MODEL.searchPath, containerToken: { token: 'mcp-ready-bearer' }, pushIterator: prompts,
    },
    dispatch: () => {},
  });
  assert.ok(spec.threadStart.config.mcp_servers, 'a token wires the Dopl server');
  if (url === null) delete spec.threadStart.config.mcp_servers;
  else spec.threadStart.config.mcp_servers[mcp.SERVER_KEY].url = url;
  spec.threadStart.config.projects = configHome.projectTrustFence(cwd);
  spec.cwd = cwd;
  spec.args = providerArgs(modelPort);
  // The client's stderr lines share this sink; only the adapter's own line is kept.
  spec.log = (...parts) => { const line = parts.join(' '); if (line.startsWith('codex: dopl mcp')) lines.push(line); };
  return spec;
}

/** One launch through `start()`: push `hello`, collect frames to the first `turn/completed` (or `close`). */
async function launched(t, { url, delayMs = SLOW_MS, closeAfterLaunchMs = null }) {
  const model = await scriptedModel(null);
  const dopl = await slowDopl(delayMs);
  const cwd = mkdtempSync(join(tmpdir(), 'dopl-codex-mcp-ready-'));
  const prompts = pushQueue();
  const lines = [];
  const spec = doplSpec({ modelPort: model.port, url: url === undefined ? dopl.url : url, prompts, cwd, lines });
  let conn = null;
  const realConnect = client.connect;
  client.connect = (o) => { conn = realConnect(o); return conn; };
  const t0 = Date.now();
  const handle = launchSpec.start(spec);
  t.after(async () => {
    client.connect = realConnect;
    handle.close();
    if (conn) await terminateConn(conn);
    await model.close();
    await dopl.close();
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  prompts.push({ message: { content: 'hello' } });
  const events = [];
  let ended = false;
  let turnStartedAt = null;
  const budget = setTimeout(() => handle.close(), BUDGET_MS);
  try {
    for (;;) {
      const { value, done } = await handle.next();
      if (done) break;
      if (value && value.method === 'turn/started' && turnStartedAt == null) turnStartedAt = Date.now() - t0;
      // The wait begins as the thread handle lands; close inside it.
      if (value && value.method === 'dopl/threadStarted' && closeAfterLaunchMs != null) setTimeout(() => handle.close(), closeAfterLaunchMs);
      events.push(...normalize(value, {}));
      if (value && value.method === 'turn/completed') { ended = true; break; }
    }
  } finally { clearTimeout(budget); }
  return {
    requests: model.requests, events, lines, ended, conn,
    readyAtMs: dopl.at.readyAt == null ? null : dopl.at.readyAt - t0, turnStartedAt,
    lane: events.filter((e) => e.type === 'assistant').map((e) => e.payload.text),
  };
}

describe('live: the first Codex turn waits for Dopl\'s MCP server', () => {
  test('control: a turn started at once is built before a slow Dopl is ready — Dopl is not in the first request', async (t) => {
    if (skipLive(t, GATE)) return;
    const model = await scriptedModel(null);
    const dopl = await slowDopl(SLOW_MS);
    const home = stubHome({ port: model.port });
    const env = { ...process.env, CODEX_HOME: home, [mcp.BEARER_ENV]: 'b', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' };
    const entry = mcp.buildDoplServerEntry(null);
    entry.url = dopl.url;
    try {
      let finish = null;
      const finished = new Promise((r) => { finish = r; });
      await withAppServer({
        timeoutMs: BUDGET_MS,
        connect: () => client.connect({ args: [], env, cwd: home, log: () => {}, onNotification: (m) => { if (m.method === 'turn/completed') finish(); } }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-mcp-ready'));
        const th = await conn.request('thread/start', { cwd: home, approvalPolicy: 'untrusted', sandbox: 'read-only', config: { mcp_servers: { dopl: entry } } });
        await conn.request('turn/start', { threadId: th.thread.id, input: [{ type: 'text', text: 'hello' }] });
        await finished;
      });
      assert.equal(doplVisible(model.requests[0]), false,
        'if Codex now waits for its MCP servers before a turn, `mcp-ready.js` is redundant — delete it');
    } finally {
      await model.close();
      await dopl.close();
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test('fix: through `start()`, the first request carries Dopl, and the turn started after `ready`', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await launched(t, {});
    assert.equal(run.ended, true, 'the turn completed');
    assert.equal(doplVisible(run.requests[0]), true, 'the first request could not find Dopl');
    assert.deepEqual(run.lane.filter((l) => /did not connect/.test(l)), []);
    assert.equal(run.lines.length, 1);
    const m = /^codex: dopl mcp ready \((notification|list|already)\) first turn waited (\d+)ms$/.exec(run.lines[0]);
    assert.ok(m, run.lines[0]);
    assert.ok(run.readyAtMs != null && run.turnStartedAt >= run.readyAtMs, `turn at ${run.turnStartedAt}ms, Dopl ready at ${run.readyAtMs}ms`);
    t.diagnostic(`slow Dopl ready at ${run.readyAtMs}ms after start(); first turn waited ${m[2]}ms; turn/started at ${run.turnStartedAt}ms`);
  });

  test('failed: an unreachable Dopl — the turn still runs, and ONE line says the tools did not connect', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await launched(t, { url: UNREACHABLE });
    assert.equal(run.ended, true, 'the turn ran without Dopl');
    assert.equal(run.requests.length >= 1, true);
    assert.deepEqual(run.lane.filter((l) => /did not connect/.test(l)),
      ["Dopl's tools did not connect (the connection failed), so this turn runs without them."]);
    assert.equal(run.events.filter((e) => e.type === 'auth_hold').length, 0);
    assert.match(run.lines[0], /^codex: dopl mcp failed \((notification|list|already)\) first turn waited \d+ms/);
    t.diagnostic(run.lines[0].slice(0, 160));
  });

  test('close during the wait: the stream ends, the child exits, no request reaches the model', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await launched(t, { delayMs: 8000, closeAfterLaunchMs: 300 });
    assert.equal(run.ended, false);
    assert.equal(run.requests.length, 0, 'a turn was started after close');
    assert.match(run.lines[0] || '', /closed \(released\)/);
    assert.ok(run.conn, 'the child was started');
    await terminateConn(run.conn);
    assert.equal(run.conn.child.exitCode !== null || run.conn.child.signalCode !== null, true, 'the child is gone');
  });

  test('the mcp-ready tier leaked no app-server processes', (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(leakedPids(), []);
  });
});
