// CODEX PARITY FENCES, MEASURED ON A REAL `codex app-server` (2026-09-22, codex-cli 0.155.1).
//
// ⚠ THE MODEL IS A SCRIPTED STAND-IN; EVERYTHING ELSE IS REAL. A stub Responses provider plays the
// model deterministically (the `codex-mcp-discovery.test.mjs` technique), so what is measured is
// the app-server's own policy engine, sandbox, tool catalog, skills loader and sub-agent runtime,
// fed the config Dopl's REAL assembly builds (`launch-spec.js › buildLaunchSpec`, `catalog.js`,
// `skills-fence.js`) — at zero quota. Unit pins are in `codex-parity-fences.test.mjs`.
//
//   1  `never` → granular: nothing but the channel call behaves differently, and it now REACHES the gate
//   2  a code-mode model cannot spawn a native sub-agent
//   3  no personal skill is listed, and a `$mention` does not inject one

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { client, liveGate, announceGate, skipLive, skipTurn, withAppServer, leakedPids } from './_codex-app-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const launchSpec = require(join(CODEX, 'launch-spec.js'));
const policy = require(join(CODEX, 'policy.js'));
const catalog = require(join(CODEX, 'catalog.js'));
const skillsFence = require(join(CODEX, 'skills-fence.js'));
const serverRequests = require(join(CODEX, 'server-requests.js'));
const resolveBin = require(join(CODEX, 'resolve-bin.js'));
const profiles = require(join(HERE, '..', 'main', 'session-profiles.js'));

const GATE = announceGate(liveGate());
const BUDGET_MS = 60000;
const CH = '11111111-1111-4111-8111-111111111111';

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

async function standInDopl() {
  const calls = [];
  const srv = await listen((req, res, body) => {
    let m = null; try { m = JSON.parse(body); } catch (_) { /* GET */ }
    if (!m || m.id === undefined) { res.writeHead(202); res.end(); return; }
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'dopl-standin' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    };
    if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dopl-standin', version: '0' } });
    if (m.method === 'tools/list') {
      return reply({ tools: [{ name: mcp.CHANNEL_TOOL, description: 'Read or post in a Dopl channel.', inputSchema: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } }] });
    }
    if (m.method === 'tools/call') { calls.push(m.params); return reply({ content: [{ type: 'text', text: 'STANDIN-OK' }], isError: false }); }
    return reply({});
  });
  return { ...srv, calls, url: `http://127.0.0.1:${srv.port}/api/mcp` };
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

/** One scripted turn. `o.threadStart` is sent as-is (with the stand-in's URL spliced in). */
async function turn(o) {
  const model = await scriptedModel(o.rounds || []);
  const dopl = await standInDopl();
  const home = mkdtempSync(join(tmpdir(), 'dopl-codex-parity-'));
  writeFileSync(join(home, 'config.toml'), [
    'model_provider = "stub"', `model = "${o.model || 'gpt-5.5'}"`, '[model_providers.stub]', 'name = "stub"',
    `base_url = "http://127.0.0.1:${model.port}/v1"`, 'wire_api = "responses"',
    'requires_openai_auth = false', 'stream_max_retries = 0', 'request_max_retries = 0', '',
  ].join('\n'));
  const cwd = o.cwd || join(home, 'cwd');
  mkdirSync(cwd, { recursive: true });
  const env = { ...process.env, CODEX_HOME: home, [mcp.BEARER_ENV]: 'parity-bearer', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot', ...(o.env || {}) };
  const args = o.catalog ? catalog.catalogArgs(catalog.writeDelegationFreeCatalog(home, { bin: resolveBin.resolveCodexBin().path, env })) : [];
  const items = []; const serverReqs = []; const asked = [];
  let started = null; let loaded = null;
  const ts = JSON.parse(JSON.stringify(o.threadStart));
  if (ts.config && ts.config.mcp_servers) ts.config.mcp_servers.dopl.url = dopl.url;
  try {
    let finish = null;
    const finished = new Promise((r) => { finish = r; });
    await withAppServer({
      timeoutMs: BUDGET_MS,
      connect: () => client.connect({
        args, env, cwd, log: () => {},
        onNotification: (m) => {
          if (m.method === 'item/completed' && m.params && m.params.item) items.push(m.params.item);
          if (m.method === 'turn/completed') finish();
        },
        onServerRequest: (m) => {
          serverReqs.push(m.method);
          return serverRequests.answer(m, async (name, input) => { asked.push({ name, input }); return o.decide ? o.decide(name, input) : 'deny'; });
        },
      }),
    }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-parity'));
      started = await conn.request('thread/start', Object.assign({}, ts, { cwd }));
      await conn.request('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: o.text || 'hello' }] });
      await finished;
      loaded = await conn.request('thread/loaded/list', {});
    });
    return { requests: model.requests, calls: dopl.calls, items, serverReqs, asked, started, loaded, cwd, sent: ts };
  } finally {
    await model.close();
    await dopl.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

const fullSpec = (toolMode) => launchSpec.buildLaunchSpec({
  session: { profile: 'full', channelId: CH, state: { toolMode }, workspaceId: 'ws', model: '', containerToken: { token: 't' } },
  dispatch: () => {}, emitQuiet: () => {},
}).threadStart;
const outputs = (run) => {
  const last = run.requests[run.requests.length - 1];
  return Object.fromEntries((last.input || []).filter((i) => /_output$/.test(i.type) && i.call_id).map((i) => [i.call_id, JSON.stringify(i.output)]));
};
const fc = (id, name, args, ns) => [{ type: 'function_call', id: `fc_${id}`, call_id: `c_${id}`, ...(ns ? { namespace: ns } : {}), name, arguments: JSON.stringify(args) }];

describe('1 — the operator\'s `never` is sent as a narrower granular, and nothing but the channel call changes', () => {
  // A path OUTSIDE every writable root: not the cwd, not $TMPDIR, not /tmp.
  const outside = join(homedir(), 'Library', 'Caches', `dopl-codex-parity-${process.pid}`);
  const post = { op: 'send', channel: CH, thread: 'task-1', kind: 'message', body: 'NEVER-MARKER' };
  const rounds = [
    () => fc(0, 'exec_command', { cmd: 'echo PLAIN > plain.txt && echo ok' }),
    () => fc(1, 'exec_command', { cmd: `mkdir -p ${outside} && echo x > ${outside}/esc.txt`, sandbox_permissions: 'require_escalated', justification: 'probe' }),
    () => [{ type: 'custom_tool_call', id: 'ct2', call_id: 'c_2', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: patched.txt\n+hi\n*** End Patch\n' }],
    () => [{ type: 'custom_tool_call', id: 'ct3', call_id: 'c_3', name: 'apply_patch', input: `*** Begin Patch\n*** Add File: ${outside}/outside.txt\n+hi\n*** End Patch\n` }],
    () => fc(4, 'exec_command', { cmd: 'curl -sS -m 4 -o /dev/null https://example.com; echo " rc=$?"' }),
    () => [{ type: 'tool_search_call', id: 'ts', call_id: 'ts_c', status: 'completed', execution: 'client', arguments: { query: 'dopl channel', limit: 8 } }],
    (b) => {
      const ns = b.input.find((i) => i.type === 'tool_search_output').tools.find((x) => x.type === 'namespace');
      return [{ type: 'function_call', id: 'fc7', call_id: 'c_7', namespace: ns.name, name: mcp.CHANNEL_TOOL, arguments: JSON.stringify(post) }];
    },
  ];
  const gate = (messageMode) => (name, input) => (profiles.grantDecision({
    runtime: 'codex', profile: 'full', toolMode: 'never', messageMode, channelId: CH, allowForTask: [], toolName: name, input,
  }) === 'allow' ? 'allow' : 'deny');

  test('1a/1b: same shell/file/escalation/network outcomes as native `never`; the post reaches Dopl\'s gate and runs ONCE', async (t) => {
    if (skipLive(t, GATE)) return;
    try {
      const control = await turn({ rounds, threadStart: { ...fullSpec('on-request'), approvalPolicy: 'never' } });
      const ts = fullSpec('never');
      const run = await turn({ rounds, threadStart: ts, decide: gate('auto_outbound') });

      // 1b: the echo IS the intent — the granular object, on the sandbox Dopl asked for.
      assert.deepEqual(run.started.approvalPolicy, policy.NEVER_NATIVE);
      launchSpec.assertPolicyTook(run.sent, run.started);
      assert.equal(run.started.sandbox.type, 'workspaceWrite');
      assert.equal(run.started.sandbox.networkAccess, false);
      assert.equal(control.started.approvalPolicy, 'never');

      // Nothing else asked: the ONLY request is Dopl's elicitation, and the gate got the call's args.
      assert.deepEqual(control.serverReqs, [], 'native never raises nothing');
      assert.deepEqual(run.serverReqs, ['mcpServer/elicitation/request']);
      assert.deepEqual(run.asked, [{ name: mcp.CHANNEL_TOOL, input: post }]);
      assert.equal(run.calls.length, 1, 'allowed by Axis B with no human card, and run once');
      assert.equal(control.calls.length, 0);
      assert.match(JSON.stringify(control.items.find((i) => i.type === 'mcpToolCall').error), /approval policy is never/);

      const [c, r] = [outputs(control), outputs(run)];
      for (const out of [c, r]) {
        assert.match(out.c_0, /ok/, 'in-sandbox shell ran');
        assert.match(out.c_1, /reject command/, 'escalation rejected without asking');
        assert.match(out.c_2, /Success/, 'in-workspace patch applied');
        assert.match(out.c_3, /rejected/, 'out-of-root patch rejected without asking');
        assert.doesNotMatch(out.c_4, / rc=0/, 'no network under workspace-write');
      }
      assert.equal(existsSync(join(outside, 'esc.txt')) || existsSync(join(outside, 'outside.txt')), false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  test('1a: under `ask` the same post is a GATE (a human card), and a decline means it never runs', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ rounds, threadStart: fullSpec('never'), decide: gate('ask') });
    assert.deepEqual(run.asked.map((a) => a.name), [mcp.CHANNEL_TOOL]);
    assert.equal(run.calls.length, 0);
    rmSync(join(homedir(), 'Library', 'Caches', `dopl-codex-parity-${process.pid}`), { recursive: true, force: true });
  });
});

describe('2 — native delegation cannot run, on a code-mode model too', () => {
  const spawn = (ns) => [() => fc('s', 'spawn_agent', { task_name: 'child_task', message: 'CHILD-MARKER' }, ns)];
  const offered = (run) => {
    const b = run.requests[0];
    const extra = (b.input || []).filter((i) => i.type === 'additional_tools').flatMap((i) => i.tools);
    return (b.tools || []).map((x) => x.name || x.type).concat(extra.map((x) => x.name));
  };

  test('2d: gpt-6-astra (code_mode_only, multi_agent_version v2) — the fence removes `collaboration` and a forced spawn starts NO child', async (t) => {
    if (skipLive(t, GATE)) return;
    const ts = fullSpec('on-request');
    // Control: Dopl's features flag ALONE — measured insufficient on a code-mode model.
    const control = await turn({ model: 'gpt-6-astra', rounds: spawn('collaboration'), threadStart: ts });
    assert.ok(offered(control).includes('collaboration'), `control: ${offered(control)}`);
    assert.ok(control.items.some((i) => i.type === 'subAgentActivity'), 'control: the spawn started a child');
    assert.equal(control.loaded.data.length, 2, 'control: two loaded threads');

    const run = await turn({ model: 'gpt-6-astra', rounds: spawn('collaboration'), threadStart: ts, catalog: true });
    assert.equal(offered(run).includes('collaboration'), false, `offered: ${offered(run)}`);
    assert.equal(JSON.stringify(run.requests[0]).includes('spawn_agent'), false, 'no delegation instructions either');
    assert.match(outputs(run).c_s, /unsupported call/);
    assert.equal(run.items.some((i) => i.type === 'subAgentActivity'), false);
    assert.equal(run.loaded.data.length, 1, 'one thread — no sub-agent');
    assert.equal(run.requests.length, 2, 'no child model request');
  });

  test('2a: gpt-5.5 — no delegation tool offered, and a forced spawn is unsupported', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await turn({ model: 'gpt-5.5', rounds: spawn(), threadStart: fullSpec('on-request'), catalog: true });
    assert.equal(offered(run).some((n) => /spawn_agent|collaboration/.test(n)), false);
    assert.match(outputs(run).c_s, /unsupported call/);
    assert.equal(run.loaded.data.length, 1);
  });
});

describe('3 — no personal skill reaches the prompt, listed or mentioned', () => {
  const MENTION = 'please use $probe-skill now';
  const withSkill = () => {
    const home = mkdtempSync(join(tmpdir(), 'dopl-codex-parity-home-'));
    mkdirSync(join(home, '.agents', 'skills', 'probe-skill'), { recursive: true });
    writeFileSync(join(home, '.agents', 'skills', 'probe-skill', 'SKILL.md'), '---\nname: probe-skill\ndescription: PROBE-SKILL-DESCRIPTION\n---\nPROBE-SKILL-BODY-7f3a\n');
    return home;
  };

  test('3b: a skill in $HOME/.agents/skills — listed and injected without the fence, absent with it', async (t) => {
    if (skipLive(t, GATE)) return;
    const home = withSkill();
    try {
      const base = fullSpec('on-request');
      const bare = JSON.parse(JSON.stringify(base)); delete bare.config.skills;
      const control = await turn({ threadStart: bare, env: { HOME: home }, text: MENTION });
      const c = JSON.stringify(control.requests[0]);
      assert.ok(c.includes('PROBE-SKILL-DESCRIPTION') && c.includes('PROBE-SKILL-BODY-7f3a'), 'control: listed and injected');
      assert.ok(c.includes('skills/.system'), 'control: the bundled root is listed too');

      const fenced = JSON.parse(JSON.stringify(base));
      const cwd = mkdtempSync(join(tmpdir(), 'dopl-codex-parity-cwd-'));
      fenced.config.skills = skillsFence.skillsFence({ home, cwd });
      const run = await turn({ threadStart: fenced, env: { HOME: home }, text: MENTION, cwd });
      const r = JSON.stringify(run.requests[0]);
      for (const s of ['PROBE-SKILL-DESCRIPTION', 'PROBE-SKILL-BODY-7f3a', '<skills_instructions>', 'skills/.system']) {
        assert.equal(r.includes(s), false, `fenced prompt still carries ${s}`);
      }
      rmSync(cwd, { recursive: true, force: true });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('3b: the OPERATOR\'s real ~/.agents/skills (when present) — none listed, a $mention injects nothing', async (t) => {
    if (skipLive(t, GATE)) return;
    const root = join(homedir(), '.agents', 'skills');
    const names = existsSync(root) ? require('node:fs').readdirSync(root).filter((n) => existsSync(join(root, n, 'SKILL.md'))) : [];
    if (!names.length) { t.diagnostic(`SKIPPED, NOT PASSED — no skills under ${root}`); t.skip('no operator skills'); return; }
    const name = names[0];
    const body = readFileSync(join(root, name, 'SKILL.md'), 'utf8').split('\n').find((l) => l.length > 40 && !/^(name|description):/.test(l)) || '';
    const run = await turn({ threadStart: fullSpec('on-request'), text: `please use $${name} now` });
    const r = JSON.stringify(run.requests[0]);
    assert.equal(r.includes('<skills_instructions>'), false);
    assert.equal(r.includes(root), false, 'the operator root is not named');
    if (body) assert.equal(r.includes(JSON.stringify(body).slice(1, 60)), false, `$${name} injected its body`);
  });
});

// 💰 TIER 2 — ONE REAL TURN (`CODEX_LIVE_TURN=1`), at the live-tier model rule (gpt-6-luna, low).
// A real code-mode model, Dopl's real first-turn framing, the operator's `never`, the delegation
// catalog on argv and the skills fence: the agent must post ONE marker through Dopl's gate.
describe('TIER 2 — a real model on `never` posts through the gate, with the fences on', () => {
  test('never + fences: a fresh agent posts exactly one marker, auto-allowed by Axis B', { timeout: 240000 }, async (t) => {
    if (skipLive(t, GATE) || skipTurn(t)) return;
    const configHome = require(join(CODEX, 'config-home.js'));
    const framing = require(join(HERE, '..', 'main', 'prompt-framing.js'));
    const runtime = require(join(HERE, '..', 'main', 'runtime'));
    const { LIVE_THREAD, LIVE_TURN, LIVE_MODEL } = await import('./_codex-app-server.mjs');
    const dopl = await standInDopl();
    const root = mkdtempSync(join(tmpdir(), 'dopl-codex-parity-turn-'));
    const cwd = join(root, 'cwd');
    mkdirSync(cwd, { recursive: true });
    const env = configHome.isolatedEnv({ ...process.env, [mcp.BEARER_ENV]: 'parity-bearer', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' }, join(root, 'user-data'));
    const MARKER = `PARITY-${Date.now().toString(36)}`;
    const items = []; const asked = [];
    try {
      const ts = JSON.parse(JSON.stringify(fullSpec('never')));
      ts.config.mcp_servers.dopl.url = dopl.url;
      const text = framing.buildFencedTurn({
        side: 'responder', nonce: 'parity',
        message: `Post exactly one message to this channel whose body is ${MARKER}, then stop. Do not retry.`,
        context: { channelId: CH, workspaceId: '22222222-2222-4222-8222-222222222222', channelName: 'codex-testing', authorName: 'Samuel', profile: 'full', mcpDiscovery: runtime.capability.mcpDiscovery(runtime.descriptorFor('codex')) },
      });
      let finish = null;
      const finished = new Promise((r) => { finish = r; });
      const bin = resolveBin.resolveCodexBin().path;
      await withAppServer({
        timeoutMs: 230000,
        // ⚠ THE PICKER'S `model/list` RUNS FIRST IN THIS HOME, as it does in the app — it is what
        // writes Codex's own `models_cache.json`, the catalog's source.
        connect: () => client.connect({
          args: [], env, cwd, log: () => {},
          onNotification: () => {}, onServerRequest: async () => ({}),
        }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-parity'));
        await conn.request('model/list', {});
      });
      assert.ok(catalog.readCache(env.CODEX_HOME), 'model/list wrote the cache the catalog reads');
      const args = catalog.catalogArgs(catalog.writeDelegationFreeCatalog(env.CODEX_HOME, { bin, env }));
      await withAppServer({
        timeoutMs: 230000,
        connect: () => client.connect({
          args, env, cwd, log: () => {},
          onNotification: (m) => {
            if (m.params && m.params.item && m.method === 'item/completed') items.push(m.params.item);
            if (/^turn\/(completed|failed|aborted)$/.test(m.method)) finish(m);
          },
          onServerRequest: (m) => serverRequests.answer(m, async (name, input) => {
            asked.push({ name, input });
            return profiles.grantDecision({ runtime: 'codex', profile: 'full', toolMode: 'never', messageMode: 'auto_outbound', channelId: CH, allowForTask: [], toolName: name, input }) === 'allow' ? 'allow' : 'deny';
          }),
        }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-parity'));
        const th = await conn.request('thread/start', Object.assign({}, ts, LIVE_THREAD, { cwd }));
        launchSpec.assertPolicyTook(ts, th);
        assert.equal(th.model, LIVE_MODEL);
        await conn.request('turn/start', { threadId: th.thread.id, input: [{ type: 'text', text }], ...LIVE_TURN });
        const done = await finished;
        assert.equal(done.params.turn.status, 'completed', JSON.stringify(done.params.turn.error || {}));
      });
      const said = items.filter((i) => i.type === 'agentMessage').map((i) => i.text).join(' | ');
      const posts = dopl.calls.filter((c) => c.name === mcp.CHANNEL_TOOL && c.arguments && c.arguments.op === 'send');
      assert.equal(posts.length, 1, `exactly one post executed: ${JSON.stringify(dopl.calls)} — agent said: ${said}`);
      // The stand-in's schema declares only `op`, so which field the model puts the text in is its own pick.
      assert.ok(JSON.stringify(posts[0].arguments).includes(MARKER), JSON.stringify(posts[0].arguments));
      assert.ok(asked.some((a) => a.name === mcp.CHANNEL_TOOL && a.input.op === 'send'), 'the post reached the held approval');
      assert.equal(items.some((i) => i.type === 'subAgentActivity'), false, 'no native sub-agent');
    } finally {
      await dopl.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});

test('the parity tier leaked no app-server processes', (t) => {
  if (skipLive(t, GATE)) return;
  assert.deepEqual(leakedPids(), []);
});
