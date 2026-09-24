// Zero-quota building blocks for the live Codex tiers: a stub Responses provider plays the model and a
// 127.0.0.1 stand-in plays Dopl's MCP server; the `codex app-server` between them is the real binary.

import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const CODEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const launchSpec = require(join(CODEX, 'launch-spec.js'));

// gpt-5.5 is the catalog's one non-code-mode model (Dopl tools behind `tool_search`); gpt-6-astra is
// code_mode_only (one `exec`, tools in `ALL_TOOLS`). Only ever sent to the stub provider.
export const STUB_MODEL = Object.freeze({ searchPath: 'gpt-5.5', codeMode: 'gpt-6-astra' });
export const CH = '11111111-1111-4111-8111-111111111111';

// Titled like the real server's tools (`registrar.ts › toolConfig`): Codex names an approval by the title.
export const CHANNEL_TOOL_DEF = Object.freeze({
  name: mcp.CHANNEL_TOOL,
  title: mcp.CHANNEL_TOOL,
  description: 'Read or post in a Dopl channel.',
  inputSchema: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] },
});

export function listen(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => handler(req, res, body));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({
    port: server.address().port, close: () => new Promise((d) => server.close(d)),
  })));
}

/** Dopl's MCP endpoint on 127.0.0.1: answers the handshake, lists `tools`, records every request and call. */
export async function standInDopl(tools = [CHANNEL_TOOL_DEF]) {
  const calls = [];
  const seen = [];
  const srv = await listen((req, res, body) => {
    let m = null; try { m = JSON.parse(body); } catch (_) { /* GET has no body */ }
    seen.push({ method: req.method, headers: req.headers, rpc: m });
    if (!m || m.id === undefined) { res.writeHead(202); res.end(); return; }
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'dopl-standin' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    };
    if (m.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dopl-standin', version: '0' } });
    if (m.method === 'tools/list') return reply({ tools });
    if (m.method === 'tools/call') { calls.push(m.params); return reply({ content: [{ type: 'text', text: 'STANDIN-OK' }], isError: false }); }
    return reply({});
  });
  return {
    ...srv, calls, seen,
    url: `http://127.0.0.1:${srv.port}/api/mcp`,
    rpcNames: () => seen.filter((s) => s.rpc && s.rpc.method).map((s) => s.rpc.method),
  };
}

export const say = (text) => [{ type: 'message', role: 'assistant', id: 'mf', content: [{ type: 'output_text', text }] }];
export const fc = (id, name, args, ns) => [{ type: 'function_call', id: `fc_${id}`, call_id: `c_${id}`, ...(ns ? { namespace: ns } : {}), name, arguments: JSON.stringify(args) }];
export const exec = (js, id = 'p') => [{ type: 'custom_tool_call', id: `ct_${id}`, call_id: `c_${id}`, name: 'exec', input: js }];
export const toolSearch = (query, id = '1') => ({ type: 'tool_search_call', id: `ts${id}`, call_id: `ts_${id}`, status: 'completed', execution: 'client', arguments: { query, limit: 8 } });

/**
 * The scripted model. `script` is an array (`script[i](body)` answers the i-th Responses request) or one
 * function answering every request; no answer ends the turn with a plain message.
 */
export async function scriptedModel(script) {
  const requests = [];
  const srv = await listen((req, res, body) => {
    if (!req.url.endsWith('/responses')) { res.writeHead(404); res.end('{}'); return; }
    const b = JSON.parse(body);
    requests.push(b);
    const fn = typeof script === 'function' ? script : (script || [])[requests.length - 1];
    const items = (fn && fn(b)) || say('done');
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

/** A fresh `CODEX_HOME` whose provider is the stub on `port`; `homeToml` lines are top-level keys. */
export function stubHome({ port, model = STUB_MODEL.searchPath, homeToml = [] }) {
  const home = mkdtempSync(join(tmpdir(), 'dopl-codex-stub-'));
  writeFileSync(join(home, 'config.toml'), [
    'model_provider = "stub"', `model = "${model}"`, ...homeToml, '[model_providers.stub]', 'name = "stub"',
    `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"',
    'requires_openai_auth = false', 'stream_max_retries = 0', 'request_max_retries = 0', '',
  ].join('\n'));
  return home;
}

/** Dopl's real `thread/start` for the `full` profile (a deep copy), with `drop` (a dotted `config` key) removed. */
export function doplThreadStart({ toolMode = 'on-request', drop } = {}) {
  const ts = JSON.parse(JSON.stringify(launchSpec.buildLaunchSpec({
    session: { profile: 'full', channelId: CH, state: { toolMode }, workspaceId: 'ws', model: '', containerToken: { token: 't' } },
    dispatch: () => {},
  }).threadStart));
  if (drop) { const [a, b] = drop.split('.'); if (b) delete ts.config[a][b]; else delete ts.config[a]; }
  return ts;
}
