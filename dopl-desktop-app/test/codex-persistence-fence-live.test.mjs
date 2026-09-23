// C26 — CODEX PERSISTENCE / SCHEDULING, MEASURED ON A REAL `codex app-server` (2026-09-22, 0.155.1).
//
// ⚠ THE MODEL IS A SCRIPTED STAND-IN; EVERYTHING ELSE IS REAL (the `codex-parity-fences-live`
// technique): a stub Responses provider FORCES each call, so what is measured is the app-server's
// own tool registry, goal loop, memory pipeline, hook engine and `notify`, fed the thread config
// Dopl's REAL assembly builds (`launch-spec.js › buildLaunchSpec` + `catalog.js`) — at zero quota.
// Every fence is proven BOTH ways: the control (Dopl's spec minus that one key) shows the surface
// live, and Dopl's spec shows it gone. Unit pins: `codex-launch-fences.test.mjs`.
//
//   1  goals       — a forced `create_goal` self-continues the thread; fenced: unsupported, one turn
//   2  clock.sleep — a timed wake on code-mode models; fenced: unsupported
//   3  memories    — a hidden memory-writing agent + `$CODEX_HOME/memories`; fenced: neither
//   4  hooks       — a planted, trusted user hook fires; fenced: it does not
//   5  notify      — a home-layer program runs after the turn; Dopl's thread `[]` silences it
//   6  the whole offered surface carries no persistence-shaped verb, on both tool paths

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { client, liveGate, announceGate, skipLive, withAppServer, leakedPids } from './_codex-app-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const launchSpec = require(join(CODEX, 'launch-spec.js'));
const catalog = require(join(CODEX, 'catalog.js'));
const configHome = require(join(CODEX, 'config-home.js'));
const serverRequests = require(join(CODEX, 'server-requests.js'));
const resolveBin = require(join(CODEX, 'resolve-bin.js'));

const GATE = announceGate(liveGate());
const CH = '11111111-1111-4111-8111-111111111111';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function listen(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, body));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({
    port: server.address().port, close: () => new Promise((d) => server.close(d)),
  })));
}

// THE SCRIPTED MODEL: `rounds[i](body)` answers the i-th Responses request; past the end it stops.
async function scriptedModel(rounds) {
  const requests = [];
  const srv = await listen((req, res, body) => {
    if (!req.url.endsWith('/responses')) { res.writeHead(404); res.end('{}'); return; }
    const b = JSON.parse(body);
    requests.push(b);
    const fn = rounds[requests.length - 1];
    const items = (fn && fn(b)) || [{ type: 'message', role: 'assistant', id: 'mf', content: [{ type: 'output_text', text: 'done' }] }];
    const id = `resp_${requests.length}`;
    const ev = (type, obj) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    ev('response.created', { response: { id } });
    for (const item of items) ev('response.output_item.done', { item });
    ev('response.completed', { response: { id, usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } });
    res.end();
  });
  return { ...srv, requests };
}

// Dopl's own server, one tool — so `tool_search` exists on gpt-5.5 exactly as in a real launch.
async function standInDopl() {
  const srv = await listen((req, res, body) => {
    let m = null; try { m = JSON.parse(body); } catch (_) { /* GET */ }
    if (!m || m.id === undefined) { res.writeHead(202); res.end(); return; }
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'dopl-standin' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    };
    if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dopl-standin', version: '0' } });
    if (m.method === 'tools/list') return reply({ tools: [{ name: mcp.CHANNEL_TOOL, description: 'Read or post in a Dopl channel.', inputSchema: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } }] });
    return reply({});
  });
  return { ...srv, url: `http://127.0.0.1:${srv.port}/api/mcp` };
}

/** Dopl's real `thread/start` for `full`, with `drop` (a dotted `config` key) removed for a control. */
function doplThreadStart(drop) {
  const ts = JSON.parse(JSON.stringify(launchSpec.buildLaunchSpec({
    session: { profile: 'full', channelId: CH, state: { toolMode: 'on-request' }, workspaceId: 'ws', model: '', containerToken: { token: 't' } },
    dispatch: () => {},
  }).threadStart));
  if (drop) { const [a, b] = drop.split('.'); if (b) delete ts.config[a][b]; else delete ts.config[a]; }
  return ts;
}

/** One scripted turn; `o.after(conn, threadId, notes)` runs once the first turn completes. */
async function turn(o) {
  const model = await scriptedModel(o.rounds || []);
  const dopl = await standInDopl();
  const home = mkdtempSync(join(tmpdir(), 'dopl-codex-c26-'));
  writeFileSync(join(home, 'config.toml'), [
    'model_provider = "stub"', `model = "${o.model || 'gpt-5.5'}"`, ...(o.homeToml || []), '[model_providers.stub]', 'name = "stub"',
    `base_url = "http://127.0.0.1:${model.port}/v1"`, 'wire_api = "responses"',
    'requires_openai_auth = false', 'stream_max_retries = 0', 'request_max_retries = 0', '',
  ].join('\n'));
  const cwd = join(home, 'cwd');
  mkdirSync(cwd, { recursive: true });
  if (o.plant) o.plant(home);
  const env = { ...process.env, CODEX_HOME: home, CODEX_SQLITE_HOME: home, [mcp.BEARER_ENV]: 'c26', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' };
  const args = catalog.catalogArgs(await catalog.writeDelegationFreeCatalog(home, { bin: resolveBin.resolveCodexBin().path, env }));
  const ts = o.threadStart;
  ts.config.projects = configHome.projectTrustFence(cwd);
  if (ts.config.mcp_servers) ts.config.mcp_servers.dopl.url = dopl.url;
  const notes = [];
  let extra = null;
  try {
    let finish = null;
    const finished = new Promise((r) => { finish = r; });
    await withAppServer({
      timeoutMs: 60000,
      connect: () => client.connect({
        args, env, cwd, log: () => {},
        onNotification: (m) => { notes.push(m.method); if (m.method === 'turn/completed') finish(); },
        onServerRequest: (m) => serverRequests.answer(m, async () => 'deny'),
      }),
    }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-c26'));
      const started = await conn.request('thread/start', Object.assign({}, ts, { cwd }));
      await conn.request('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'hello' }] });
      await finished;
      extra = o.after ? await o.after(conn, started.thread.id, notes, cwd) : null;
    });
    return { requests: model.requests, notes, extra, memories: existsSync(join(home, 'memories')), turns: notes.filter((n) => n === 'turn/started').length };
  } finally {
    await model.close();
    await dopl.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const fc = (name, args, ns) => [{ type: 'function_call', id: 'fc_p', call_id: 'c_p', ...(ns ? { namespace: ns } : {}), name, arguments: JSON.stringify(args) }];
const exec = (js) => [{ type: 'custom_tool_call', id: 'ct_p', call_id: 'c_p', name: 'exec', input: js }];
const outputOf = (run) => JSON.stringify((run.requests[1].input || []).filter((i) => /_output$/.test(i.type)).map((i) => i.output));
const settle = (ms) => async () => { await wait(ms); return null; };
const GOAL = { objective: 'C26-GOAL-MARKER', token_budget: 100000 };
const ALL_TOOLS_JS = 'text(JSON.stringify(ALL_TOOLS.map((t) => t.name).sort()));';
const PERSISTENCE_RE = /goal|sleep|memor|automation|schedul|cron|remind|queue|notify|hook|wake|heartbeat|trigger/i;

describe('1 — goals: the app-server continues a goal thread BY ITSELF; the fence removes the verb', () => {
  test('control (Dopl minus `goals`): a forced create_goal starts turns Dopl never sent', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({
      threadStart: doplThreadStart('features.goals'), rounds: [() => fc('create_goal', GOAL)],
      // Bounded: stop watching after the third self-started turn (it ran ~500 in 8s unbounded).
      after: async (_c, _id, notes) => { for (let i = 0; i < 100 && notes.filter((n) => n === 'turn/started').length < 3; i++) await wait(100); return null; },
    });
    assert.ok(run.turns >= 3, `turns started: ${run.turns} (Dopl sent ONE turn/start)`);
    assert.ok(run.requests.some((b) => JSON.stringify(b.input || []).includes('Continue working toward the active thread goal')));
  });

  test('Dopl (gpt-5.5): no goal tool offered, a forced create_goal is unsupported, ONE turn', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ threadStart: doplThreadStart(), rounds: [() => fc('create_goal', GOAL)], after: settle(2500) });
    const names = (run.requests[0].tools || []).map((x) => x.name || x.type);
    assert.equal(names.some((n) => /goal/.test(n)), false, `offered: ${names}`);
    assert.match(outputOf(run), /unsupported call: create_goal/);
    assert.equal(run.turns, 1);
    assert.equal(run.requests.length, 2);
  });

  test('Dopl (code mode, gpt-6-astra): no goal verb in ALL_TOOLS, and `tools.create_goal` does not exist', async (t) => {
    if (skipLive(t, GATE)) return;
    const js = 'try { await tools.create_goal({ objective: "C26" }); text("CALLED"); } catch (e) { text("ERR " + (e && e.message)); }';
    const run = await turn({ model: 'gpt-6-astra', threadStart: doplThreadStart(), rounds: [() => exec(js)], after: settle(2500) });
    assert.match(outputOf(run), /ERR tools\.create_goal is not a function/);
    assert.equal(run.turns, 1);
  });
});

describe('2 — clock.sleep: a timed wake on code-mode models, fenced', () => {
  const nap = [() => fc('sleep', { duration_ms: 300 }, 'clock')];
  test('control (Dopl minus `sleep_tool`): the call sleeps', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ model: 'gpt-6-astra', threadStart: doplThreadStart('features.sleep_tool'), rounds: nap });
    assert.match(outputOf(run), /Sleep completed/);
  });
  test('Dopl: no `clock` namespace offered, and a forced call is unsupported', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ model: 'gpt-6-astra', threadStart: doplThreadStart(), rounds: nap });
    const ns = (run.requests[0].input || []).filter((i) => i.type === 'additional_tools').flatMap((i) => i.tools).map((x) => x.name);
    assert.equal(ns.includes('clock'), false, `namespaces: ${ns}`);
    assert.match(outputOf(run), /unsupported call/);
  });
});

describe('3 — memories: cross-session state in the SHARED private home, fenced', () => {
  test('control (Dopl minus `memories`, flag ON): a hidden memory agent runs and writes $CODEX_HOME/memories', async (t) => {
    if (skipLive(t, GATE)) return;
    const td = doplThreadStart(); td.config.features.memories = true;
    const run = await turn({ threadStart: td, after: settle(2500) });
    assert.equal(run.memories, true);
    assert.ok(run.requests.some((b) => JSON.stringify(b.input || []).includes('Memory Writing Agent')), 'a second, unprompted agent request');
  });
  test('Dopl: one model request, no memories folder', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ threadStart: doplThreadStart(), after: settle(2500) });
    assert.equal(run.memories, false);
    assert.equal(run.requests.length, 1);
  });
});

describe('4 — hooks: a planted user hook never fires under Dopl, trusted or not', () => {
  const marks = () => mkdtempSync(join(tmpdir(), 'dopl-codex-c26-hook-'));
  const plantIn = (dir) => (home) => writeFileSync(join(home, 'hooks.json'), JSON.stringify({ hooks: Object.fromEntries(
    ['SessionStart', 'UserPromptSubmit', 'Stop'].map((ev) => [ev, [{ hooks: [{ type: 'command', command: `touch ${join(dir, ev)}` }] }]])) }));
  // A second thread on the same server, with trust for every listed hook supplied at thread level.
  const trustedSecondThread = (ts) => async (conn, _id, notes, cwd) => {
    const listed = await conn.request('hooks/list', { cwds: [cwd] });
    const second = JSON.parse(JSON.stringify(ts));
    second.config.hooks = { state: Object.fromEntries(listed.data[0].hooks.map((h) => [h.key, { trusted_hash: h.currentHash }])) };
    const th = await conn.request('thread/start', Object.assign({}, second, { cwd }));
    await conn.request('turn/start', { threadId: th.thread.id, input: [{ type: 'text', text: 'again' }] });
    for (let i = 0; i < 60 && notes.filter((n) => n === 'turn/completed').length < 2; i++) await wait(100);
    return listed.data[0].hooks;
  };

  test('control (Dopl minus `hooks`): untrusted it is listed and silent; trusted it FIRES', async (t) => {
    if (skipLive(t, GATE)) return;
    const dir = marks();
    try {
      const ts = doplThreadStart('features.hooks');
      const run = await turn({ threadStart: ts, plant: plantIn(dir), after: trustedSecondThread(ts) });
      assert.ok(run.extra.length >= 3 && run.extra.every((h) => h.source === 'user' && h.trustStatus === 'untrusted'));
      assert.ok(readdirSync(dir).includes('Stop'), `fired: ${readdirSync(dir)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('Dopl: the same planted hook, trusted at thread level, fires NOTHING', async (t) => {
    if (skipLive(t, GATE)) return;
    const dir = marks();
    try {
      const ts = doplThreadStart();
      const run = await turn({ threadStart: ts, plant: plantIn(dir), after: trustedSecondThread(ts) });
      assert.ok(run.extra.length >= 3, 'the hooks were listed, so trust WAS supplied for each');
      assert.deepEqual(readdirSync(dir), []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('5 — notify: Dopl\'s thread-level `[]` silences a lower layer', () => {
  const withNotify = async (threadStart) => {
    const dir = mkdtempSync(join(tmpdir(), 'dopl-codex-c26-notify-'));
    try {
      await turn({ threadStart, homeToml: [`notify = ["/usr/bin/touch", "${join(dir, 'fired')}"]`], after: settle(2500) });
      return readdirSync(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  test('control (Dopl minus `notify`): the home-layer program runs after the turn', async (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(await withNotify(doplThreadStart('notify')), ['fired']);
  });
  test('Dopl: it does not run', async (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(await withNotify(doplThreadStart()), []);
  });
});

describe('6 — nothing persistence-shaped is offered, on either tool path', () => {
  test('gpt-5.5: top-level tools, and `tool_search` for every persistence word, find only Dopl\'s tool', async (t) => {
    if (skipLive(t, GATE)) return;
    // The first query is the positive control: the search works, and finds Dopl's own tool.
    const words = ['dopl channel', 'goal', 'schedule', 'automation', 'cron reminder', 'memory', 'sleep wake later', 'queue', 'hook notify'];
    const rounds = [() => words.map((q, i) => ({ type: 'tool_search_call', id: `ts${i}`, call_id: `ts_${i}`, status: 'completed', execution: 'client', arguments: { query: q, limit: 8 } }))];
    const run = await turn({ threadStart: doplThreadStart(), rounds });
    const top = (run.requests[0].tools || []).map((x) => x.name || x.type);
    assert.equal(top.some((n) => PERSISTENCE_RE.test(n)), false, `offered: ${top}`);
    const found = (run.requests[1].input || []).filter((i) => i.type === 'tool_search_output')
      .flatMap((o) => o.tools || []).flatMap((x) => (x.tools || [x]).map((y) => y.name));
    assert.ok(top.includes('tool_search') && found.includes(mcp.CHANNEL_TOOL), `search ran: ${top} / ${found}`);
    assert.equal(found.some((n) => PERSISTENCE_RE.test(n)), false, `search found: ${found}`);
  });

  test('code mode (gpt-6-astra): the namespaces and ALL_TOOLS carry no persistence verb', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ model: 'gpt-6-astra', threadStart: doplThreadStart(), rounds: [() => exec(ALL_TOOLS_JS)] });
    const extra = (run.requests[0].input || []).filter((i) => i.type === 'additional_tools').flatMap((i) => i.tools);
    const offered = extra.flatMap((ns) => [ns.name].concat((ns.tools || []).map((x) => x.name)));
    assert.equal(offered.some((n) => PERSISTENCE_RE.test(n)), false, `offered: ${offered}`);
    const all = JSON.parse(JSON.parse(outputOf(run))[0].map((o) => o.text).find((x) => x.startsWith('[')));
    assert.ok(all.includes('exec_command'), `ALL_TOOLS read: ${all}`);
    assert.equal(all.some((n) => PERSISTENCE_RE.test(n)), false, `ALL_TOOLS: ${all}`);
  });
});

test('the C26 tier leaked no app-server processes', (t) => {
  if (skipLive(t, GATE)) return;
  assert.deepEqual(leakedPids(), []);
});
