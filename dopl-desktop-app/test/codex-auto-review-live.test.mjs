// WHAT CODEX "AUTO" (THE CODEX APP'S "APPROVE FOR ME") DOES TO A DOPL POST — measured on a real
// `codex app-server` (2026-09-25, codex-cli 0.155.1, scripted model; the `codex-parity-fences-live.test.mjs` technique).
//
// Auto sends Ask's pair plus `approvalsReviewer: 'guardian_subagent'` (`policy.js › APPROVALS_REVIEWER`;
// 0.155.1 answers it as `auto_review`). Under it a Dopl channel post is reviewed by Codex's own reviewer
// model and RUNS without Dopl's gate ever being asked. Accepted by Samuel 2026-09-25 (F-765); this test
// keeps the behaviour measured, so a change in either direction is seen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { client, liveGate, announceGate, skipLive, withAppServer } from './_codex-app-server.mjs';
import { CH, standInDopl, scriptedModel, stubHome, doplThreadStart, toolSearch } from './_codex-stub.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const serverRequests = require(join(CODEX, 'server-requests.js'));
const policy = require(join(CODEX, 'policy.js'));
const GATE = announceGate(liveGate());

const REVIEWER = 'codex-auto-review'; // the model id the reviewer asks the provider for
const ALLOW = [{ type: 'message', role: 'assistant', id: 'g', content: [{ type: 'output_text', text: '{"risk_level":"low","outcome":"allow","rationale":"ok"}' }] }];

async function postUnder(reviewer) {
  const post = { op: 'send', channel: CH, thread: 'task-1', kind: 'message', body: 'AUTO-REVIEW-MARKER' };
  let step = 0;
  const model = await scriptedModel((b) => {
    if (b.model === REVIEWER) return ALLOW;
    step += 1;
    if (step === 1) return [toolSearch('dopl channel')];
    if (step === 2) {
      const ns = b.input.find((i) => i.type === 'tool_search_output').tools.find((x) => x.type === 'namespace');
      return [{ type: 'function_call', id: 'fc1', call_id: 'c_1', namespace: ns.name, name: mcp.CHANNEL_TOOL, arguments: JSON.stringify(post) }];
    }
    return null;
  });
  const dopl = await standInDopl();
  const home = stubHome({ port: model.port });
  const cwd = join(home, 'cwd');
  mkdirSync(cwd, { recursive: true });
  const env = { ...process.env, CODEX_HOME: home, [mcp.BEARER_ENV]: 'b', [mcp.WORKSPACE_ENV]: 'ws', [mcp.SESSION_ENV]: 'slot' };
  const ts = { ...doplThreadStart({ toolMode: 'on-request' }), approvalsReviewer: reviewer };
  ts.config.mcp_servers.dopl.url = dopl.url;
  const asked = []; const items = [];
  try {
    let finish; const finished = new Promise((r) => { finish = r; });
    await withAppServer({
      timeoutMs: 60000,
      connect: () => client.connect({
        args: [], env, cwd, log: () => {},
        onNotification: (m) => {
          if (m.method === 'item/completed' && m.params && m.params.item) items.push(m.params.item);
          if (m.method === 'turn/completed') finish();
        },
        onServerRequest: (m) => serverRequests.answer(m, async (name) => { asked.push(name); return 'deny'; }),
      }),
    }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-auto-review'));
      const started = await conn.request('thread/start', Object.assign({}, ts, { cwd }));
      assert.equal(started.approvalsReviewer, reviewer === policy.APPROVALS_REVIEWER.value ? 'auto_review' : reviewer);
      await conn.request('turn/start', { threadId: started.thread.id, input: [{ type: 'text', text: 'hello' }] });
      await finished;
    });
    return { asked, reviewed: model.requests.some((r) => r.model === REVIEWER), ran: items.some((i) => i.type === 'mcpToolCall' && i.status === 'completed') };
  } finally {
    await model.close(); await dopl.close();
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

test('Auto\'s reviewer: a Dopl channel post goes to Codex\'s reviewer and runs; Dopl\'s gate is never asked', async (t) => {
  if (skipLive(t, GATE)) return;
  const run = await postUnder(policy.APPROVALS_REVIEWER.value);
  assert.equal(run.reviewed, true);
  assert.deepEqual(run.asked, []);
  assert.equal(run.ran, true);
});

test('user (Ask\'s reviewer): the same post reaches Dopl\'s gate, and a deny stops it', async (t) => {
  if (skipLive(t, GATE)) return;
  const run = await postUnder('user');
  assert.equal(run.reviewed, false);
  assert.equal(run.asked.length > 0, true);
  assert.equal(run.ran, false);
});
