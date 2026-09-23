// CXP-3A — HOW A REAL `codex app-server` EXPOSES DOPL'S TOOLS, AND THAT AN AGENT CAN GET TO THEM.
//
// 🔒 ⚠ **MEASURED 2026-09-22, codex-cli 0.155.1.** Codex DEFERS EVERY MCP TOOL. The first
// Responses request of a thread carries NO `mcp__dopl` namespace and no `dopl_channel` at all;
// what it carries instead is ONE client-executed tool, `{ type: 'tool_search', execution:
// 'client' }`, whose description lists `dopl` as a source ("Searches over deferred tool metadata
// with BM25…"). The model calls it (`tool_search_call`, `arguments: { query, limit }`), the
// app-server answers it locally with a `tool_search_output` holding namespace `mcp__dopl` and the
// server's ENABLED tools (`defer_loading: true`), and only then can the model emit a
// `function_call { namespace: 'mcp__dopl', name: 'dopl_channel' }` — which surfaces as the
// `mcpToolCall` item and the `mcpServer/elicitation/request` `codex-mcp-surface.test.mjs` pins.
// ⚠ NOTHING DOPL CAN SET OPTS OUT: `[features] tool_search = false` and
// `tool_search_always_defer_mcp_tools = false` (in `config.toml` AND in `thread/start.config`)
// leave the catalog unchanged — `codex features list` reports both as REMOVED — and no
// `mcp_servers.<name>` key means "always load". Deferral follows the model catalog's
// `supports_search_tool` (an unknown model slug gets an eager `mcp__dopl` namespace instead),
// which Dopl does not own. Hence `descriptor.prose.toolSearchVerb = 'tool_search'` and a turn
// that ORDERS the search (`prompt-framing.js › grantLines`).
//
// ⚠ THE MODEL SIDE OF TIER 1 IS A SCRIPTED STAND-IN; THE CODEX SIDE IS ENTIRELY REAL. A stub
// Responses provider (`model_provider = "stub"`) plays the model deterministically — search,
// then call — so what is measured is the app-server's own catalog, search executor, namespace
// resolution, MCP call and approval request, at zero quota. Tier 2 (`CODEX_LIVE_TURN=1`) swaps
// in the operator's real model and Dopl's REAL first-turn framing, which is the only proof that
// the WORDING gets a model to search on its own.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { client, liveGate, announceGate, skipLive, withAppServer, leakedPids } from './_codex-app-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const tools = require(join(CODEX, 'tools.js'));
const configHome = require(join(CODEX, 'config-home.js'));
const serverRequests = require(join(CODEX, 'server-requests.js'));
const runtime = require(join(HERE, '..', 'main', 'runtime'));
const framing = require(join(HERE, '..', 'main', 'prompt-framing.js'));

const GATE = announceGate(liveGate());
const TURN_ENV = 'CODEX_LIVE_TURN';
const BUDGET_MS = 45000;
const TURN_BUDGET_MS = 180000;
const VERB = runtime.capability.mcpDiscoveryVerb(runtime.descriptorFor('codex'));

function skipTurn(t) {
  if (skipLive(t, GATE)) return true;
  if (String(process.env[TURN_ENV] || '') === '1') return false;
  const why = `${TURN_ENV} is not 1 — this arm SPENDS THE OPERATOR'S OpenAI QUOTA on a real turn`;
  t.diagnostic(`SKIPPED, NOT PASSED — ${why}`);
  t.skip(why);
  return true;
}

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

// The far side of Dopl's HTTP hop (see `codex-mcp-surface.test.mjs › standInDopl`): TWO tools, so
// a restricted profile's `enabled_tools` has something to hide.
async function standInDopl() {
  const calls = [];
  const srv = await listen((req, res, body) => {
    let m = null; try { m = JSON.parse(body); } catch (_) { /* GET */ }
    if (!m || m.id === undefined) { res.writeHead(202); res.end(); return; }
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'dopl-standin' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    };
    if (m.method === 'initialize') {
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dopl-standin', version: '0' } });
    }
    if (m.method === 'tools/list') {
      return reply({ tools: [
        { name: mcp.CHANNEL_TOOL, description: 'Read or post in a Dopl channel.', inputSchema: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] } },
        { name: 'dopl_kb', description: 'Dopl knowledge bases.', inputSchema: { type: 'object', properties: {} } },
      ] });
    }
    if (m.method === 'tools/call') { calls.push(m.params); return reply({ content: [{ type: 'text', text: 'STANDIN-OK' }], isError: false }); }
    return reply({});
  });
  return { ...srv, calls, url: `http://127.0.0.1:${srv.port}/api/mcp` };
}

// THE SCRIPTED MODEL. Round 1: search. Round 2: call whatever the search returned. Round 3: stop.
function sse(res, items) {
  const id = `resp_${Math.random().toString(36).slice(2)}`;
  const ev = (type, obj) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  ev('response.created', { response: { id } });
  for (const item of items) ev('response.output_item.done', { item });
  ev('response.completed', { response: { id, usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } } });
  res.end();
}
async function scriptedModel() {
  const requests = [];
  const srv = await listen((req, res, body) => {
    if (!req.url.endsWith('/responses')) { res.writeHead(404); res.end('{}'); return; }
    const b = JSON.parse(body);
    requests.push(b);
    const input = b.input || [];
    const out = input.find((i) => i.type === 'tool_search_output');
    if (!out) {
      return sse(res, [{ type: 'tool_search_call', id: 'ts_1', call_id: 'ts_call_1', status: 'completed', execution: 'client', arguments: { query: 'dopl channel', limit: 8 } }]);
    }
    if (!input.some((i) => i.type === 'function_call_output')) {
      const ns = (out.tools || []).find((x) => x.type === 'namespace') || {};
      const fn = (ns.tools || []).find((x) => x.name === mcp.CHANNEL_TOOL);
      if (!fn) return sse(res, [{ type: 'message', role: 'assistant', id: 'm0', content: [{ type: 'output_text', text: 'NOT FOUND' }] }]);
      return sse(res, [{ type: 'function_call', id: 'fc_1', call_id: 'fc_call_1', namespace: ns.name, name: fn.name, arguments: JSON.stringify({ op: 'rooms' }) }]);
    }
    return sse(res, [{ type: 'message', role: 'assistant', id: 'm1', content: [{ type: 'output_text', text: 'done' }] }]);
  });
  return { ...srv, requests };
}

const catalogNames = (body) => (body.tools || []).map((t) => t.name || t.type);
const mentionsChannelTool = (body) => JSON.stringify(body.tools || []).includes(mcp.CHANNEL_TOOL);

/** One scripted turn against the real app-server, with the approval answered by `verdict`. */
// ⚠ `opts.linkAuth` links the operator's REAL `auth.json` (never read here, never copied): with it,
// Codex mounts its own `codex_apps` server exactly as a real Dopl launch does, while the stub
// provider still answers for the model — so the foreign surface is measured at zero quota.
const OPERATOR_AUTH = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
async function scriptedTurn(profile, verdict, opts) {
  const o = opts || {};
  const model = await scriptedModel();
  const dopl = await standInDopl();
  const home = mkdtempSync(join(tmpdir(), 'dopl-codex-discovery-'));
  writeFileSync(join(home, 'config.toml'), [
    'model_provider = "stub"', 'model = "gpt-5.5"', '[model_providers.stub]', 'name = "stub"',
    `base_url = "http://127.0.0.1:${model.port}/v1"`, 'wire_api = "responses"',
    'requires_openai_auth = false', 'stream_max_retries = 0', 'request_max_retries = 0', '',
  ].join('\n'));
  if (o.linkAuth) symlinkSync(OPERATOR_AUTH, join(home, 'auth.json'));
  const env = { ...process.env, CODEX_HOME: home, [mcp.BEARER_ENV]: 'cxp3a-bearer', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' };
  const items = [];
  const asked = [];
  const serverReqs = [];
  try {
    const cfg = tools.buildSessionToolConfig(profile);
    const entry = mcp.buildDoplServerEntry(cfg.doplToolsPolicy);
    entry.url = dopl.url;
    let finish = null;
    const finished = new Promise((r) => { finish = r; });
    await withAppServer({
      timeoutMs: BUDGET_MS,
      connect: () => client.connect({
        args: [], env, cwd: home, log: () => {},
        onNotification: (m) => {
          if (m.method === 'item/completed' && m.params && m.params.item) items.push(m.params.item);
          if (m.method === 'turn/completed') finish();
        },
        // ⚠ THE REAL TRANSLATOR, with a recording gate standing in for Dopl's held card.
        onServerRequest: (m) => {
          serverReqs.push(m.method);
          return serverRequests.answer(m, async (name, input) => { asked.push({ name, input }); return verdict; });
        },
      }),
    }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-cxp3a'));
      const th = await conn.request('thread/start', {
        cwd: home, approvalPolicy: cfg.native ? cfg.native.approval_policy : 'untrusted',
        sandbox: cfg.native ? cfg.native.sandbox_mode : 'read-only',
        // ⚠ THE SAME FENCE `launch-spec.js › buildLaunchSpec` sends, unless the arm asks to see without it.
        config: { features: o.noFence ? {} : { ...cfg.features }, mcp_servers: { dopl: entry } },
      });
      await conn.request('turn/start', { threadId: th.thread.id, input: [{ type: 'text', text: 'hello' }] });
      await finished;
    });
    return { requests: model.requests, calls: dopl.calls, items, asked, serverReqs };
  } finally {
    await model.close();
    await dopl.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

describe('TIER 1 — the real app-server defers Dopl, and `tool_search` is the way in', () => {
  test('the adapter declares the verb this suite measures', () => {
    assert.equal(VERB, 'tool_search');
    assert.equal(mcp.descriptor.eagerLoadFlag, null, 'no eager-load flag exists on this CLI');
  });

  for (const profile of ['read_only', 'dopl_only']) {
    test(`${profile}: unexpanded catalog -> search -> dopl_channel -> held approval -> ALLOW runs once`, async (t) => {
      if (skipLive(t, GATE)) return;
      const run = await scriptedTurn(profile, 'allow');
      const [first, second] = run.requests;

      // 1. THE UNEXPANDED CATALOG: no Dopl tool is visible up front, only the search tool.
      assert.equal(mentionsChannelTool(first), false, `dopl_channel was in the first catalog: ${catalogNames(first)}`);
      assert.equal(catalogNames(first).includes('mcp__dopl'), false);
      const search = (first.tools || []).find((x) => x.type === VERB);
      assert.ok(search, `no \`${VERB}\` tool in ${JSON.stringify(catalogNames(first))}`);
      assert.equal(search.execution, 'client', 'executed by the app-server, not by OpenAI');
      assert.match(search.description, /^- dopl$/m, 'the description lists Dopl as a source');
      assert.deepEqual(Object.keys(search.parameters.properties).sort(), ['limit', 'query']);

      // 2. THE SEARCH RESULT: Dopl's namespace ONLY, holding ONLY what the profile enabled.
      const out = second.input.find((i) => i.type === 'tool_search_output');
      assert.ok(out, 'the app-server executed the search and fed its output back');
      const namespaces = out.tools.filter((x) => x.type === 'namespace');
      assert.deepEqual(namespaces.map((n) => n.name), ['mcp__dopl'], '4: no foreign MCP server is discoverable');
      const found = namespaces[0].tools.map((x) => x.name);
      const enabled = tools.buildSessionToolConfig(profile).doplToolsPolicy;
      assert.ok(found.includes(mcp.CHANNEL_TOOL));
      for (const name of found) assert.ok(enabled.includes(name), `${profile}: search exposed non-enabled ${name}`);
      if (profile === 'read_only') assert.deepEqual(found, [mcp.CHANNEL_TOOL], 'read_only discovers the channel tool alone');
      assert.ok(namespaces[0].tools.every((x) => x.defer_loading === true));

      // 3. THE CALL reaches the held-approval path, is gated by name + args, and runs ONCE.
      assert.ok(run.serverReqs.includes('mcpServer/elicitation/request'), `saw ${run.serverReqs}`);
      assert.deepEqual(run.asked, [{ name: mcp.CHANNEL_TOOL, input: { op: 'rooms' } }]);
      assert.equal(run.calls.length, 1, 'allow executes exactly once');
      assert.equal(run.calls[0].name, mcp.CHANNEL_TOOL);
      const call = run.items.find((i) => i.type === 'mcpToolCall');
      assert.equal(call.server, 'dopl');
      assert.equal(call.status, 'completed');
    });
  }

  // 🔒 4 — THE FOREIGN SURFACE. Measured 2026-09-22: WITHOUT the fence, a signed-in thread's search
  // sources are `codex_apps`' (Sites, Codex Document Control, Hotline, …), 'Multi-agent tools' and
  // `dopl`; WITH it, `dopl` alone on the restricted profiles.
  for (const profile of ['read_only', 'dopl_only', 'full']) {
    test(`4: ${profile} — with the operator's auth linked, the ONLY MCP source is Dopl`, async (t) => {
      if (skipLive(t, GATE)) return;
      if (!existsSync(OPERATOR_AUTH)) {
        t.diagnostic(`SKIPPED, NOT PASSED — no ${OPERATOR_AUTH}, so codex_apps cannot mount here`);
        t.skip('no operator auth.json');
        return;
      }
      const sources = (body) => {
        const search = (body.tools || []).find((x) => x.type === 'tool_search');
        return search ? [...search.description.matchAll(/^- ([^:\n]+)/gm)].map((m) => m[1]) : [];
      };
      const bare = await scriptedTurn(profile, 'deny', { linkAuth: true, noFence: true });
      assert.ok(sources(bare.requests[0]).length > 1, 'control: an unfenced signed-in thread has foreign sources');
      const run = await scriptedTurn(profile, 'deny', { linkAuth: true });
      const expected = profile === 'full' ? ['Multi-agent tools', 'dopl'] : ['dopl'];
      assert.deepEqual(sources(run.requests[0]), expected);
      assert.equal(catalogNames(run.requests[0]).includes('request_plugin_install'), false);
      const out = run.requests[1].input.find((i) => i.type === 'tool_search_output');
      assert.deepEqual(out.tools.filter((x) => x.type === 'namespace').map((n) => n.name), ['mcp__dopl']);
    });
  }

  test('DENY at the held approval prevents execution', async (t) => {
    if (skipLive(t, GATE)) return;
    const run = await scriptedTurn('read_only', 'deny');
    assert.deepEqual(run.asked.map((a) => a.name), [mcp.CHANNEL_TOOL]);
    assert.equal(run.calls.length, 0, 'a declined call never reached the Dopl server');
    const call = run.items.find((i) => i.type === 'mcpToolCall');
    assert.equal(call.status, 'failed');
  });
});

describe('TIER 2 — a real model, given Dopl\'s REAL first turn, searches on its own', () => {
  test('the Codex framing gets a fresh agent from zero tools to a held dopl_channel call', async (t) => {
    if (skipTurn(t)) return;
    const dopl = await standInDopl();
    const root = mkdtempSync(join(tmpdir(), 'dopl-codex-discovery-turn-'));
    const cwd = join(root, 'cwd');
    mkdirSync(cwd, { recursive: true });
    // ⚠ `isolatedEnv`, as `launch-spec.js › start` does: the operator's auth, none of their config.
    const env = configHome.isolatedEnv({ ...process.env, [mcp.BEARER_ENV]: 'cxp3a-bearer', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' }, join(root, 'user-data'));
    const items = [];
    const asked = [];
    try {
      const cfg = tools.buildSessionToolConfig('dopl_only');
      const entry = mcp.buildDoplServerEntry(cfg.doplToolsPolicy);
      entry.url = dopl.url;
      const text = framing.buildFencedTurn({
        side: 'responder', nonce: 'cxp3a',
        message: 'Read the rooms of this channel once (op "rooms", action "list"), then stop. If the call is refused, say so and stop.',
        context: {
          channelId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222',
          channelName: 'codex-testing', authorName: 'Samuel', profile: 'dopl_only', mcpDiscovery: VERB,
        },
      });
      assert.equal(/do not go looking/.test(text), false);
      let finish = null;
      const finished = new Promise((r) => { finish = r; });
      await withAppServer({
        timeoutMs: TURN_BUDGET_MS,
        connect: () => client.connect({
          args: [], env, cwd, log: () => {},
          onNotification: (m) => {
            if (m.params && m.params.item) items.push(m.params.item);
            if (/^turn\/(completed|failed|aborted)$/.test(m.method)) finish(m.method);
          },
          onServerRequest: (m) => serverRequests.answer(m, async (name, input) => { asked.push({ name, input }); return 'deny'; }),
        }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-cxp3a'));
        const th = await conn.request('thread/start', {
          cwd, approvalPolicy: cfg.native.approval_policy, sandbox: cfg.native.sandbox_mode,
          config: { features: { ...cfg.features }, mcp_servers: { dopl: entry } },
        });
        await conn.request('turn/start', { threadId: th.thread.id, input: [{ type: 'text', text }] });
        let budget = null;
        try {
          return await Promise.race([finished, new Promise((r) => { budget = setTimeout(() => r('BUDGET'), TURN_BUDGET_MS - 5000); })]);
        } finally { clearTimeout(budget); }
      });
      const call = items.find((i) => i.type === 'mcpToolCall' && i.server === 'dopl');
      const said = items.filter((i) => i.type === 'agentMessage').map((i) => i.text).join(' | ');
      assert.ok(call, `the agent never called Dopl. It said: ${said}`);
      assert.equal(call.tool, mcp.CHANNEL_TOOL);
      assert.ok(asked.some((a) => a.name === mcp.CHANNEL_TOOL), 'the call reached the held approval');
      assert.equal(dopl.calls.length, 0, 'declined, so it never executed');
    } finally {
      await dopl.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test('the discovery tier leaked no app-server processes', (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(leakedPids(), []);
  });
});
