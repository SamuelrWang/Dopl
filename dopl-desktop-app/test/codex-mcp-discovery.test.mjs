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
// ⚠ AND THAT IS ONLY THE NON-CODE-MODE SURFACE. Every other listed model (gpt-6-*, gpt-5.6-*) is
// `code_mode_only`: no `tool_search`, one `exec` (JS), and a deferred tool is found in `ALL_TOOLS`
// and called as `tools.mcp__dopl__dopl_channel(...)` — `descriptor.prose.deferredCatalog`.
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

import { client, liveGate, announceGate, skipLive, skipTurn, withAppServer, leakedPids, LIVE_THREAD, LIVE_TURN } from './_codex-app-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const tools = require(join(CODEX, 'tools.js'));
const configHome = require(join(CODEX, 'config-home.js'));
const serverRequests = require(join(CODEX, 'server-requests.js'));
const runtime = require(join(HERE, '..', 'main', 'runtime'));
const framing = require(join(HERE, '..', 'main', 'prompt-framing.js'));
const profiles = require(join(HERE, '..', 'main', 'session-profiles.js'));

const GATE = announceGate(liveGate());
const BUDGET_MS = 45000;
const TURN_BUDGET_MS = 180000;
const VERB = runtime.descriptorFor('codex').prose.toolSearchVerb;
const DISCOVERY = runtime.capability.mcpDiscovery(runtime.descriptorFor('codex'));

const skipLiveTurn = (t) => skipLive(t, GATE) || skipTurn(t);

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
async function scriptedModel(call) {
  const want = (call && call.fn) || mcp.CHANNEL_TOOL;
  const args = (call && call.args) || { op: 'rooms' };
  const requests = [];
  const srv = await listen((req, res, body) => {
    if (!req.url.endsWith('/responses')) { res.writeHead(404); res.end('{}'); return; }
    const b = JSON.parse(body);
    requests.push(b);
    const input = b.input || [];
    // CODE MODE: one `exec` whose JS finds the tool in `ALL_TOOLS` and calls it, then stop.
    if (call && call.codeMode) {
      if (input.some((i) => i.type === 'custom_tool_call_output')) {
        return sse(res, [{ type: 'message', role: 'assistant', id: 'm1', content: [{ type: 'output_text', text: 'done' }] }]);
      }
      const js = call.js || `const hits = ALL_TOOLS.filter((t) => /dopl_channel/.test(t.name)).map((t) => t.name);
text(JSON.stringify(hits));
await tools.mcp__dopl__dopl_channel(${JSON.stringify(args)});`;
      return sse(res, [{ type: 'custom_tool_call', id: 'ct_1', call_id: 'ct_call_1', name: 'exec', input: js }]);
    }
    const out = input.find((i) => i.type === 'tool_search_output');
    if (!out) {
      return sse(res, [{ type: 'tool_search_call', id: 'ts_1', call_id: 'ts_call_1', status: 'completed', execution: 'client', arguments: { query: 'dopl channel', limit: 8 } }]);
    }
    if (!input.some((i) => i.type === 'function_call_output')) {
      const ns = (out.tools || []).find((x) => x.type === 'namespace') || {};
      const fn = (ns.tools || []).find((x) => x.name === want);
      if (!fn) return sse(res, [{ type: 'message', role: 'assistant', id: 'm0', content: [{ type: 'output_text', text: 'NOT FOUND' }] }]);
      return sse(res, [{ type: 'function_call', id: 'fc_1', call_id: 'fc_call_1', namespace: ns.name, name: fn.name, arguments: JSON.stringify(args) }]);
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
  const model = await scriptedModel(o.call);
  const dopl = await standInDopl();
  const home = mkdtempSync(join(tmpdir(), 'dopl-codex-discovery-'));
  writeFileSync(join(home, 'config.toml'), [
    // ⚠ gpt-5.5 is the catalog's one NON-code-mode model; gpt-6-astra is `code_mode_only` (2026-09-22).
    'model_provider = "stub"', `model = "${o.call && o.call.codeMode ? 'gpt-6-astra' : 'gpt-5.5'}"`, '[model_providers.stub]', 'name = "stub"',
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
    if (o.defaultMode) entry.default_tools_approval_mode = o.defaultMode;
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
      // 🔒 2026-09-22: delegation is off on EVERY profile, so `full` loses 'Multi-agent tools' too.
      assert.deepEqual(sources(run.requests[0]), ['dopl']);
      assert.equal(catalogNames(run.requests[0]).includes('request_plugin_install'), false);
      const out = run.requests[1].input.find((i) => i.type === 'tool_search_output');
      assert.deepEqual(out.tools.filter((x) => x.type === 'namespace').map((n) => n.name), ['mcp__dopl']);
    });
  }

  // 🔒 §5 C1b — THE PREMISE `approval.js › doplElicitation` NAMES ASKS BY. Every ask from Dopl's
  // server is named `dopl_channel`, so NO other Dopl tool may ask. Measured 2026-09-22: under
  // `'auto'` a `dopl_kb` call DID ask (and would have been gated as a channel call with a KB
  // call's arguments); under `'approve'` it runs with no request at all.
  test('C1b: a NON-channel Dopl tool raises no request under the shipped default, and did under `auto`', async (t) => {
    if (skipLive(t, GATE)) return;
    const call = { fn: 'dopl_kb', args: { op: 'list' } };
    const control = await scriptedTurn('dopl_only', 'deny', { call, defaultMode: 'auto' });
    assert.ok(control.serverReqs.includes('mcpServer/elicitation/request'), 'control: `auto` asks');
    assert.equal(control.calls.length, 0);
    assert.equal(mcp.DEFAULT_TOOL_APPROVAL_MODE, 'approve');
    const run = await scriptedTurn('dopl_only', 'deny', { call });
    assert.deepEqual(run.serverReqs, [], 'the shipped default raised a request for a non-channel tool');
    assert.deepEqual(run.asked, []);
    assert.deepEqual(run.calls.map((c) => c.name), ['dopl_kb'], 'it ran, once, with no card');
  });

  test('C1b: a channel POST hands the gate its FULL arguments — op-scoped, not whole-tool', async (t) => {
    if (skipLive(t, GATE)) return;
    const args = { op: 'send', channel: 'chan-1', thread: 'task-1', kind: 'message', body: 'CXP3A-MARKER' };
    const run = await scriptedTurn('read_only', 'deny', { call: { fn: mcp.CHANNEL_TOOL, args } });
    assert.deepEqual(run.asked, [{ name: mcp.CHANNEL_TOOL, input: args }]);
    assert.equal(run.calls.length, 0);
    assert.equal(runtime.descriptorFor('codex').axisB.opScoped, true);
  });

  // 🔒 THE CODE-MODE WAY IN (measured 2026-09-22): no `tool_search` at all — one `exec` tool, and a
  // deferred MCP tool is listed in `ALL_TOOLS` under its FULL name and callable on `tools`.
  test('code mode: no tool_search, `ALL_TOOLS` lists mcp__dopl__dopl_channel, and the call is held', async (t) => {
    if (skipLive(t, GATE)) return;
    assert.equal(DISCOVERY.catalog, 'ALL_TOOLS');
    const run = await scriptedTurn('read_only', 'allow', { call: { codeMode: true, args: { op: 'rooms' } } });
    const [first, second] = run.requests;
    assert.equal(catalogNames(first).includes(VERB), false, 'a code-mode request carries no tool_search');
    const extra = (first.input || []).filter((i) => i.type === 'additional_tools').flatMap((i) => i.tools);
    const nested = extra.flatMap((ns) => (ns.tools || []).map((x) => x.name));
    assert.ok(nested.includes('exec'), `no exec tool: ${nested}`);
    assert.equal(JSON.stringify(extra).includes('mcp__dopl__dopl_channel'), false, 'deferred: not in the description');
    const out = second.input.find((i) => i.type === 'custom_tool_call_output');
    assert.match(JSON.stringify(out.output), /mcp__dopl__dopl_channel/, 'ALL_TOOLS names it in full');
    assert.deepEqual(run.asked, [{ name: mcp.CHANNEL_TOOL, input: { op: 'rooms' } }], 'the SAME held approval');
    assert.equal(run.calls.length, 1, 'allowed, and run once');
  });

  test('4 (code mode): with the operator\'s auth linked, ALL_TOOLS reaches Dopl\'s MCP server and no other', async (t) => {
    if (skipLive(t, GATE)) return;
    if (!existsSync(OPERATOR_AUTH)) { t.diagnostic(`SKIPPED, NOT PASSED — no ${OPERATOR_AUTH}`); t.skip('no operator auth.json'); return; }
    const js = 'text(JSON.stringify([...new Set(ALL_TOOLS.map((t) => t.name).filter((n) => n.startsWith("mcp__")).map((n) => n.split("__")[1]))].sort()));';
    const servers = (run) => JSON.parse(run.requests[1].input.find((i) => i.type === 'custom_tool_call_output').output.map((o) => o.text).filter((x) => x.startsWith('['))[0]);
    const call = { codeMode: true, js };
    const bare = await scriptedTurn('dopl_only', 'deny', { linkAuth: true, noFence: true, call });
    assert.ok(servers(bare).includes('codex_apps'), `control: an unfenced signed-in thread reaches codex_apps: ${servers(bare)}`);
    const run = await scriptedTurn('dopl_only', 'deny', { linkAuth: true, call });
    assert.deepEqual(servers(run), ['dopl']);
  });

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
  // ⚠ THE GATE HERE IS THE REAL ONE: `session-profiles.js › grantDecision`, op-scoped, at the posture
  // a windowless agent is floored to (`auto_outbound` + `on-request`). An own-channel post allows.
  test('the Codex framing gets a fresh agent from zero tools to ONE marker posted through the gate', async (t) => {
    if (skipLiveTurn(t)) return;
    const dopl = await standInDopl();
    const root = mkdtempSync(join(tmpdir(), 'dopl-codex-discovery-turn-'));
    const cwd = join(root, 'cwd');
    mkdirSync(cwd, { recursive: true });
    // ⚠ `isolatedEnv`, as `launch-spec.js › start` does: the operator's auth, none of their config.
    const env = configHome.isolatedEnv({ ...process.env, [mcp.BEARER_ENV]: 'cxp3a-bearer', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' }, join(root, 'user-data'));
    const items = [];
    const asked = [];
    const CH = '11111111-1111-4111-8111-111111111111';
    const MARKER = `CXP3A-${Date.now().toString(36)}`;
    try {
      const cfg = tools.buildSessionToolConfig('dopl_only');
      const entry = mcp.buildDoplServerEntry(cfg.doplToolsPolicy);
      entry.url = dopl.url;
      const text = framing.buildFencedTurn({
        side: 'responder', nonce: 'cxp3a',
        message: `Post exactly one message to this channel whose body is ${MARKER}, then stop. Do not retry.`,
        context: {
          channelId: CH, workspaceId: '22222222-2222-4222-8222-222222222222',
          channelName: 'codex-testing', authorName: 'Samuel', profile: 'dopl_only', mcpDiscovery: DISCOVERY,
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
          onServerRequest: (m) => serverRequests.answer(m, async (name, input) => {
            asked.push({ name, input });
            const verdict = profiles.grantDecision({ runtime: 'codex', profile: 'dopl_only', toolMode: 'on-request', messageMode: 'auto_outbound', channelId: CH, allowForTask: [], toolName: name, input });
            return verdict === 'allow' ? 'allow' : 'deny';
          }),
        }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-cxp3a'));
        const th = await conn.request('thread/start', {
          cwd, approvalPolicy: cfg.native.approval_policy, sandbox: cfg.native.sandbox_mode,
          config: { features: { ...cfg.features }, mcp_servers: { dopl: entry } }, ...LIVE_THREAD,
        });
        await conn.request('turn/start', { threadId: th.thread.id, input: [{ type: 'text', text }], ...LIVE_TURN });
        let budget = null;
        try {
          return await Promise.race([finished, new Promise((r) => { budget = setTimeout(() => r('BUDGET'), TURN_BUDGET_MS - 5000); })]);
        } finally { clearTimeout(budget); }
      });
      const call = items.find((i) => i.type === 'mcpToolCall' && i.server === 'dopl');
      const said = items.filter((i) => i.type === 'agentMessage').map((i) => i.text).join(' | ');
      assert.ok(call, `the agent never called Dopl. It said: ${said}`);
      assert.equal(call.tool, mcp.CHANNEL_TOOL);
      assert.ok(asked.some((a) => a.name === mcp.CHANNEL_TOOL && a.input.op === 'send'), `the post reached the held approval: ${JSON.stringify(asked)}`);
      const posts = dopl.calls.filter((c) => c.name === mcp.CHANNEL_TOOL && c.arguments && c.arguments.op === 'send');
      assert.equal(posts.length, 1, `exactly one post executed: ${JSON.stringify(dopl.calls)}`);
      assert.ok(String(posts[0].arguments.body).includes(MARKER));
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
