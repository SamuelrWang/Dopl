// U4's DOPL-MCP PROOF — what a real `codex app-server` does with the entry `mcp.js` builds, and
// THE TOOL-NAME SHAPE, which the plan calls its highest-stakes unknown.
//
// 🔒 ⚠ **THE MEASURED ANSWER, AND IT IS A THIRD SHAPE** (codex-cli 0.155.1, 2026-09-22):
// Codex does not put an MCP tool into ONE prefixed name at all. The thread item is
// `{ type: 'mcpToolCall', server: 'dopl', tool: 'dopl_channel', arguments: {...} }` — the server
// and the tool are SEPARATE FIELDS and the tool name is BARE, with no `mcp__…__` anywhere. So
// `main/mcp-tool-names.js › canonicalDoplName` canonicalises the `tool` field correctly
// (`dopl_channel` → `mcp__dopl__dopl_channel`); the F-139 hazard is NOT the spelling.
//
// 🔒 ⚠ **THE HAZARD IS THAT THE APPROVAL NEVER CARRIES THAT FIELD.** A Dopl MCP call arrives as
// **`mcpServer/elicitation/request`**, not an `item/*/requestApproval`: its params carry
// `serverName`, `message` and `_meta.codex_approval_kind === 'mcp_tool_call'` and NO tool-name
// field, and its reply is `{ action }` (`accept|decline|cancel`), not `{ decision }`. For one day
// `server-requests.js` answered it with an UNCONDITIONAL `{ action: 'decline' }`.
// 🔒 ⚠ **RESOLVED BY SERVER (Samuel, 2026-09-22), NEVER BY READING THE SENTENCE**: the request
// names the SERVER, Dopl mounts that server itself, and `mcp.js` puts exactly ONE tool on Dopl's
// entry in a mode that can ask — so identity plus "an ask happened" resolves the tool.
// `test/codex-server-requests.test.mjs` pins the route and every decline against a synthetic
// request; here it is pinned against the CAPTURED one.
//
// ⚠ **THE DOPL SIDE OF THE HTTP HOP IS A LOCAL STAND-IN; THE CODEX SIDE IS ENTIRELY REAL.**
// `mcp-config.js`'s device token lives in Electron `safeStorage`, so a spawned-session bearer for
// the real `usedopl.com` endpoint cannot be obtained without the running desktop app. What is
// measured here is therefore everything up to that boundary — that the real app-server ACCEPTS
// Dopl's entry, connects it over HTTP, carries the bearer and both header pairs, exposes the tool
// surface and calls it — against a stand-in that answers the MCP handshake at `127.0.0.1`. The
// remaining step (a call against the real Dopl server, classified and audited through a Dopl
// channel) needs the Electron app and is recorded as such rather than faked here.
//
// ⚠ TWO GATES. `CODEX_APP_SERVER_LIVE=1` runs everything that costs nothing. The one arm that
// spends the operator's OpenAI quota — a model-initiated tool call, which is the only way to see
// the shapes above come off the wire — additionally needs `CODEX_LIVE_TURN=1`, and skips just as
// loudly. A release gate must not silently bill a turn on every run.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { client, liveGate, announceGate, skipLive, withAppServer, leakedPids } from './_codex-app-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, '..', 'main', 'runtime', 'codex');
const mcp = require(join(CODEX, 'mcp.js'));
const configHome = require(join(CODEX, 'config-home.js'));
const approval = require(join(CODEX, 'approval.js'));
const serverRequests = require(join(CODEX, 'server-requests.js'));
const { canonicalDoplName } = require(join(HERE, '..', 'main', 'mcp-tool-names.js'));

const GATE = announceGate(liveGate());
const TURN_ENV = 'CODEX_LIVE_TURN';
const BUDGET_MS = 45000;
const TURN_BUDGET_MS = 180000;

/** The quota gate, on top of the live gate. ⚠ Loud, for the same reason `skipLive` is. */
function skipTurn(t) {
  if (skipLive(t, GATE)) return true;
  if (String(process.env[TURN_ENV] || '') === '1') return false;
  const why = `${TURN_ENV} is not 1 — this arm SPENDS THE OPERATOR'S OpenAI QUOTA on a real turn, `
    + 'so it is opt-in even inside the live tier';
  t.diagnostic(`SKIPPED, NOT PASSED — ${why}`);
  t.skip(why);
  return true;
}

// ── THE STAND-IN DOPL ENDPOINT ───────────────────────────────────────────────────────────────
//
// ⚠ IT IMPERSONATES DOPL'S MCP SERVER, NOT CODEX. Inventing an app-server is what
// `test/_codex-app-server.mjs` forbids and nothing here does it: the `codex app-server` on the
// other end of every assertion below is the real installed binary. This is the far side of an
// HTTP hop, standing in for `usedopl.com/api/mcp` because its bearer is not reachable from a
// plain-Node test (see the header).
function standInDopl(tools) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let msg = null;
      try { msg = JSON.parse(body); } catch (_) { /* GET has no body */ }
      seen.push({ method: req.method, headers: req.headers, rpc: msg });
      if (!msg || msg.id === undefined) { res.writeHead(202); res.end(); return; }
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'dopl-standin' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      };
      if (msg.method === 'initialize') {
        return reply({
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dopl-standin', version: '0.0.1' },
        });
      }
      if (msg.method === 'tools/list') return reply({ tools });
      if (msg.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'STANDIN-OK' }], isError: false });
      return reply({});
    });
  });
  return {
    seen,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}/api/mcp`))),
    close: () => new Promise((r) => server.close(r)),
    rpcNames: () => seen.filter((s) => s.rpc && s.rpc.method).map((s) => s.rpc.method),
  };
}

const CHANNEL_TOOL_SCHEMA = [{
  name: mcp.CHANNEL_TOOL,
  description: 'Read or post in a Dopl channel.',
  inputSchema: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'] },
}];

const BEARER = 'u4-stand-in-bearer-not-a-real-token';
function childEnv(extra) {
  const home = mkdtempSync(join(tmpdir(), 'dopl-codex-mcphome-'));
  return {
    home,
    env: Object.assign({}, process.env, {
      CODEX_HOME: home,
      [mcp.BEARER_ENV]: BEARER,
      [mcp.WORKSPACE_ENV]: 'ws-u4',
      [mcp.SESSION_ENV]: 'slot-u4',
    }, extra || {}),
  };
}

// ══ TIER 1 — THE MEASURED SHAPES, AS ASSERTIONS ABOUT DOPL'S OWN CODE ═══════════════════════

// 🔒 CAPTURED FROM THE WIRE on 2026-09-22 against codex-cli 0.155.1, in a bounded turn whose
// every approval was DECLINED. It is a TRANSCRIPT, not an invention, and it is inline rather
// than in `test/fixtures/codex-app-server.json` because that file belongs to `npm run
// codex:schema` and a hand-added member there would be exactly the synthetic-fixture failure the
// compatibility suite exists to prevent.
const CAPTURED = Object.freeze({
  capturedAt: '2026-09-22',
  cli: 'codex-cli 0.155.1',
  mcpElicitation: Object.freeze({
    method: 'mcpServer/elicitation/request',
    params: {
      threadId: '01a0ca52-8185-72d2-a2d8-814a510a8179',
      turnId: '01a0ca52-823c-75c0-b229-0502a2e558f5',
      serverName: 'dopl',
      mode: 'form',
      _meta: {
        codex_approval_kind: 'mcp_tool_call',
        tool_description: 'Read or post in a Dopl channel.',
        tool_params: { op: 'rooms' },
        tool_params_display: [{ name: 'op', value: 'rooms', display_name: 'op' }],
      },
      message: 'Allow the dopl MCP server to run tool "dopl_channel"?',
      requestedSchema: { type: 'object', properties: {} },
    },
  }),
  mcpToolCallItem: Object.freeze({
    type: 'mcpToolCall', id: 'exec-72b371ce-5299-40c8-917a-eed11367e812',
    server: 'dopl', tool: 'dopl_channel', status: 'inProgress', arguments: { op: 'rooms' },
  }),
  commandApproval: Object.freeze({
    method: 'item/commandExecution/requestApproval',
    params: {
      kind: 'command',
      threadId: '01a0ca52-8185-72d2-a2d8-814a510a8179',
      turnId: '01a0ca52-823c-75c0-b229-0502a2e558f5',
      itemId: 'exec-77e9cb60-b513-489e-8c33-5679cbc91e4a',
      startedAtMs: 1790100806329,
      environmentId: 'local',
      command: "/bin/zsh -lc 'echo hi'",
      cwd: '/tmp/dopl-live',
      commandActions: [{ type: 'unknown', command: 'echo hi' }],
      proposedExecpolicyAmendment: ['echo', 'hi'],
      availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['echo', 'hi'] } }, 'cancel'],
    },
  }),
  fileChangeApproval: Object.freeze({
    method: 'item/fileChange/requestApproval',
    params: {
      threadId: '01a0ca52-8185-72d2-a2d8-814a510a8179',
      turnId: '01a0ca52-823c-75c0-b229-0502a2e558f5',
      itemId: 'exec-e6c4e958-2b1c-410a-bbd8-6640310927e7',
      startedAtMs: 1790100809752,
      reason: null,
      grantRoot: null,
    },
  }),
});

describe('the measured MCP tool-name shape', () => {
  test('the name is BARE and the server rides a SEPARATE field', () => {
    const item = CAPTURED.mcpToolCallItem;
    assert.equal(item.tool, mcp.CHANNEL_TOOL, 'the tool field is the bare server-local name');
    assert.equal(item.server, 'dopl');
    assert.equal(/^mcp__/.test(item.tool), false, 'Codex adds no `mcp__<server>__` prefix');
    // The bare form is one of the two `mcp-tool-names.js` already handles, so the gate's lists
    // are reachable FROM THIS FIELD — which is what makes the approval-path gap below the bug,
    // rather than the spelling.
    assert.equal(canonicalDoplName(item.tool), 'mcp__dopl__dopl_channel');
  });

  test('the descriptor records the measured shape instead of claiming ignorance', () => {
    assert.notEqual(mcp.descriptor.toolNamePrefix, null,
      'toolNamePrefix was `null` for "unmeasured"; it is measured now');
    assert.equal(mcp.descriptor.toolNamePrefix, '<tool>');
    assert.equal(mcp.descriptor.toolNameServerField, 'server');
  });
});

describe('a Dopl MCP call reaches Dopl\'s gate, resolved by SERVER', () => {
  test('the elicitation reply is `{action}`, not `{decision}` — and the gate is what decides it', async () => {
    // ⚠ VOCABULARY AS MUCH AS VERDICT: `{ action }` here, `{ decision }` there, crossing hangs.
    const asked = [];
    const allowed = await serverRequests.answer(CAPTURED.mcpElicitation,
      async (name, input) => { asked.push({ name, input }); return 'allow'; });
    assert.deepEqual(allowed, { action: 'accept' });
    assert.deepEqual(asked, [{ name: mcp.CHANNEL_TOOL, input: { op: 'rooms' } }], 'gate consulted');
    assert.deepEqual(
      await serverRequests.answer(CAPTURED.mcpElicitation, async () => 'deny'), { action: 'decline' });
  });

  test('the elicitation carries NO tool-name field, which is why it cannot be classified', () => {
    const p = CAPTURED.mcpElicitation.params;
    assert.equal(p.toolName, undefined);
    assert.equal(p.tool, undefined);
    assert.equal(p.itemId, undefined, 'and no itemId either, so it cannot be joined to the item by id');
    assert.equal(p._meta.codex_approval_kind, 'mcp_tool_call', 'the only structured discriminator');
    // ⚠ §5 C1 ANSWERED YES: the ARGUMENTS ride `_meta.tool_params` and reach the gate since
    // 2026-09-22. `opScoped` still reads `'unverified'` — a deliberate UNDER-claim (§5 C1b).
    assert.deepEqual(p._meta.tool_params, { op: 'rooms' });
  });

  test('`toolNameFor` names DOPL\'s by its entry, and everyone else\'s by Codex\'s category', () => {
    // ⚠ NOT IN THE REQUEST, NOT FROM THE MESSAGE — from the entry `mcp.js` builds.
    assert.equal(approval.toolNameFor(CAPTURED.mcpElicitation), mcp.soleAskingTool());
    assert.equal(mcp.soleAskingTool(), mcp.CHANNEL_TOOL);    // ⚠ FAIL-CLOSED FOR EVERY OTHER SERVER: one field different, and it lands on a category in
    // no Axis-A allow-list.
    const params = Object.assign({}, CAPTURED.mcpElicitation.params, { serverName: 'somebody-else' });
    const name = approval.toolNameFor({ method: CAPTURED.mcpElicitation.method, params });
    assert.equal(name, 'mcp_elicitations');
    assert.notEqual(name, mcp.CHANNEL_TOOL, "a third party must NOT resolve to Dopl's channel tool");
    const tools = require(join(CODEX, 'tools.js'));
    for (const mode of tools.TOOL_MODES) {
      assert.equal(tools.axisAAllows(mode, name), false, `${mode} must not auto-allow it`);
    }
  });
});

describe('the captured approval payloads for a command and a file change', () => {
  test('a commandExecution approval carries the command, cwd and parsed actions', () => {
    const p = CAPTURED.commandApproval.params;
    assert.equal(approval.toolNameFor(CAPTURED.commandApproval), 'commandExecution');
    const input = serverRequests.approvalInput(CAPTURED.commandApproval.method, p);
    assert.equal(input.command, "/bin/zsh -lc 'echo hi'",
      'the command is the FULL shell invocation, not the bare argv the model proposed');
    assert.equal(input.cwd, '/tmp/dopl-live');
    // ⚠ MEASURED AND NOT IN THE GENERATED SCHEMA: `availableDecisions` is on the wire and absent
    // from `CommandExecutionRequestApprovalParams.json`. It offers `accept`, an
    // `acceptWithExecpolicyAmendment` object and `cancel` — and NOT `decline`, although `decline`
    // is what Dopl sends and what the live capture shows working (`status: 'declined'`, turn
    // continues). It also never offers `acceptForSession`, so `approval.js`'s standing refusal to
    // send that word costs nothing here.
    assert.equal(p.availableDecisions.includes('decline'), false);
    assert.equal(p.availableDecisions.includes('acceptForSession'), false);
  });

  test('a fileChange approval carries NO PATH — §5 item C2, answered', () => {
    const p = CAPTURED.fileChangeApproval.params;
    assert.equal(approval.toolNameFor(CAPTURED.fileChangeApproval), 'fileChange');
    for (const key of ['path', 'paths', 'changes', 'diff', 'files']) {
      assert.equal(p[key], undefined, `a fileChange approval carries no \`${key}\``);
    }
    // So `approvalInput` is genuinely empty here, and that is the payload's fault, not a bug:
    // the paths arrive on the `item/started` notification for the SAME `itemId`
    // (`changes: [{ path, kind, diff }]`), which is the only join available.
    assert.deepEqual(serverRequests.approvalInput(CAPTURED.fileChangeApproval.method, p), {});
    assert.ok(p.itemId, 'the itemId is the join back to the item that holds the paths');
  });

  test('a decline is the answer for every verdict that is not an explicit allow', () => {
    for (const verdict of ['deny', 'gate', undefined, null, 'accept', 'allow-once']) {
      assert.equal(approval.answerApproval({}, verdict).decision, 'decline', String(verdict));
    }
    assert.equal(approval.answerApproval({}, 'allow').decision, 'accept');
    assert.notEqual(approval.answerApproval({}, 'allow').decision, 'acceptForSession');
  });
});

// ══ TIER 2 — THE REAL app-server ════════════════════════════════════════════════════════════

describe('the real app-server accepts the entry Dopl builds', () => {
  test('every key survives `config/read`, INCLUDING under `--strict-config`', async (t) => {
    if (skipLive(t, GATE)) return;
    const { home, env } = childEnv();
    try {
      const entry = mcp.buildDoplServerEntry(['dopl_channel', 'dopl_kb']);
      entry.url = 'http://127.0.0.1:1/api/mcp'; // never contacted — this arm only reads the parse
      writeFileSync(join(home, 'config.toml'), tomlFor(entry));
      // ⚠ `--strict-config` IS THE POINT OF THE SECOND PASS: it makes the CLI ERROR on any field
      // it does not recognise, so a key that is merely tolerated cannot pass for a supported one.
      for (const args of [[], ['--strict-config']]) {
        const read = await withAppServer({
          timeoutMs: BUDGET_MS,
          connect: () => client.connect({ args, env, cwd: home, log: () => {} }),
        }, async (conn) => {
          await conn.request('initialize', client.initializeParams('0.0.0-u4-mcp'));
          return conn.request('config/read', { cwd: home });
        });
        const back = read.config.mcp_servers.dopl;
        const why = `args=${JSON.stringify(args)}`;
        assert.equal(back.url, entry.url, why);
        assert.equal(back.bearer_token_env_var, mcp.BEARER_ENV, why);
        assert.deepEqual(back.http_headers, mcp.RUNTIME_HEADERS, why);
        assert.equal(back.env_http_headers['X-Workspace-Id'], mcp.WORKSPACE_ENV, why);
        assert.equal(back.env_http_headers['X-Dopl-Session-Id'], mcp.SESSION_ENV, why);
        assert.equal(back.startup_timeout_sec, entry.startup_timeout_sec, why);
        assert.equal(back.tool_timeout_sec, entry.tool_timeout_sec, why);
        // 🔒 `auto` SINCE 2026-09-22: a default that can ask makes every elicitation un-nameable.
        assert.equal(back.default_tools_approval_mode, mcp.DEFAULT_TOOL_APPROVAL_MODE, why);
        assert.deepEqual(mcp.askingToolsIn(back), [mcp.CHANNEL_TOOL], `${why}: nameable as read BACK`);
        assert.deepEqual(back.enabled_tools, ['dopl_channel', 'dopl_kb'], why);
        // 🔒 AXIS B'S PIN IS A REAL, RECOGNISED KEY ON THIS CLI — `mcp.descriptor.perToolApproval`
        // is not a hopeful string. (What it does NOT do is reach Dopl's gate; see the tier-1
        // cases above.)
        assert.deepEqual(back.tools, { dopl_channel: { approval_mode: 'prompt' } }, why);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the server connects over HTTP, the tool surface appears, and the bearer rides the ENV', async (t) => {
    if (skipLive(t, GATE)) return;
    const dopl = standInDopl(CHANNEL_TOOL_SCHEMA);
    const url = await dopl.listen();
    const { home, env } = childEnv();
    try {
      const states = [];
      const entry = mcp.buildDoplServerEntry(null);
      entry.url = url;
      // 🔒 THE TOKEN IS NOT IN THE ENTRY, therefore not in any `-c` override, therefore not on a
      // command line every `ps` on the machine can read. It is only a VARIABLE NAME here.
      assert.equal(JSON.stringify(entry).includes(BEARER), false);
      assert.equal(entry.bearer_token_env_var, mcp.BEARER_ENV);

      const seen = await withAppServer({
        timeoutMs: BUDGET_MS,
        connect: () => client.connect({
          args: [], env, cwd: home, log: () => {},
          onNotification: (m) => { if (m.method === 'mcpServer/startupStatus/updated') states.push(m.params); },
        }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-u4-mcp'));
        const thread = await conn.request('thread/start', {
          cwd: home, approvalPolicy: 'untrusted', sandbox: 'read-only',
          config: { mcp_servers: { dopl: entry } },
        });
        // A CLIENT-INITIATED call — the same transport the model's call takes, without a turn.
        const call = await conn.request('mcpServer/tool/call', {
          threadId: thread.thread.id, server: 'dopl', tool: mcp.CHANNEL_TOOL, arguments: { op: 'rooms' },
        });
        return { thread, call };
      });

      assert.equal(seen.thread.approvalPolicy, 'untrusted');
      assert.equal(seen.thread.sandbox.type, 'readOnly');
      assert.ok(states.some((s) => s.name === 'dopl' && s.status === 'ready'),
        `the dopl MCP server must reach \`ready\` — saw ${JSON.stringify(states)}`);
      assert.equal(seen.call.isError, false, 'the tool call reached the endpoint and answered');

      // The handshake the real app-server performed against Dopl's entry.
      assert.deepEqual(
        dopl.rpcNames().filter((n) => n !== 'notifications/initialized'),
        ['initialize', 'tools/list', 'tools/call'],
      );
      const headers = dopl.seen[0].headers;
      assert.equal(headers.authorization, `Bearer ${BEARER}`, 'the CLI read the token from the env var');
      assert.equal(headers['x-dopl-runtime'], 'desktop-session');
      assert.equal(headers['x-dopl-vendor'], 'codex');
      assert.equal(headers['x-workspace-id'], 'ws-u4');
      assert.equal(headers['x-dopl-session-id'], 'slot-u4');

      // 🔒 THE NAME ON THE WIRE, MEASURED AGAIN END TO END: bare, with the server named separately
      // by the app-server's own `server` parameter.
      const called = dopl.seen.find((s) => s.rpc && s.rpc.method === 'tools/call');
      assert.equal(called.rpc.params.name, mcp.CHANNEL_TOOL);
      assert.equal(/^mcp__/.test(called.rpc.params.name), false);
    } finally {
      await dopl.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a MODEL-INITIATED Dopl tool call produces the two measured shapes', async (t) => {
    if (skipTurn(t)) return;
    const dopl = standInDopl(CHANNEL_TOOL_SCHEMA);
    const url = await dopl.listen();
    // ⚠ THIS ARM GOES THROUGH `isolatedEnv`, AND IT HAS TO. A bare temp `CODEX_HOME` holds no
    // `auth.json`, so the app-server accepts the turn and completes it having produced NOTHING —
    // a signed-out session looks exactly like a model that chose not to call the tool. Linking
    // the operator's credential is also the faithful path: it is what `launch-spec.js › start`
    // does for every real Dopl launch.
    const root = mkdtempSync(join(tmpdir(), 'dopl-codex-turn-'));
    const home = join(root, 'cwd');
    mkdirSync(home, { recursive: true });
    const env = configHome.isolatedEnv(Object.assign({}, process.env, {
      [mcp.BEARER_ENV]: BEARER, [mcp.WORKSPACE_ENV]: 'ws-u4', [mcp.SESSION_ENV]: 'slot-u4',
    }), join(root, 'user-data'));
    const items = [];
    const requests = [];
    try {
      const entry = mcp.buildDoplServerEntry(null);
      entry.url = url;
      let finish = null;
      const finished = new Promise((r) => { finish = r; });
      await withAppServer({
        timeoutMs: TURN_BUDGET_MS,
        connect: () => client.connect({
          args: [], env, cwd: home, log: () => {},
          onNotification: (m) => {
            if (m.params && m.params.item) items.push(m.params.item);
            if (/^turn\/(completed|failed|aborted)$/.test(m.method)) finish(m.method);
          },
          // ⚠ EVERY REQUEST IS DECLINED. The point is that the approval is REQUESTED and refused;
          // nothing this turn proposes is ever allowed to run.
          onServerRequest: (m) => {
            requests.push({ method: m.method, params: m.params });
            return m.method === 'mcpServer/elicitation/request'
              ? { action: 'decline' }
              : { decision: 'decline', message: 'Denied by the U4 proof' };
          },
        }),
      }, async (conn) => {
        await conn.request('initialize', client.initializeParams('0.0.0-u4-mcp'));
        const thread = await conn.request('thread/start', {
          cwd: home, approvalPolicy: 'untrusted', sandbox: 'read-only',
          config: { mcp_servers: { dopl: entry } },
        });
        await conn.request('turn/start', {
          threadId: thread.thread.id,
          input: [{ type: 'text', text: `Call the ${mcp.CHANNEL_TOOL} tool once with op set to rooms, then stop. Do not retry if it is denied.` }],
        });
        // ⚠ THE BUDGET TIMER IS CLEARED, NOT LEFT TO FIRE. An un-cleared `setTimeout` holds the
        // event loop open and makes a 9-second test report three minutes — the CI-on-Node-22
        // hang this repo has already paid for once.
        let budget = null;
        try {
          return await Promise.race([
            finished,
            new Promise((r) => { budget = setTimeout(() => r('BUDGET'), TURN_BUDGET_MS - 5000); }),
          ]);
        } finally {
          clearTimeout(budget);
        }
      });

      const call = items.find((i) => i.type === 'mcpToolCall');
      assert.ok(call, 'the model made an MCP tool call');
      assert.equal(call.server, 'dopl');
      assert.equal(call.tool, mcp.CHANNEL_TOOL);
      assert.equal(/^mcp__/.test(call.tool), false, 'THE measurement: the name is bare');
      const elicit = requests.find((r) => r.method === 'mcpServer/elicitation/request');
      assert.ok(elicit, 'the per-tool `approval_mode: prompt` pin produced a HELD request');
      assert.equal(elicit.params._meta.codex_approval_kind, 'mcp_tool_call');
      assert.equal(elicit.params.serverName, 'dopl');
      assert.equal(elicit.params.toolName, undefined, 'and it still carries no tool-name field');
    } finally {
      await dopl.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });

  test('the MCP tier leaked no app-server processes', (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(leakedPids(), []);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** Serialise one `mcp_servers.dopl` entry as the TOML the operator's own config would hold. */
function tomlFor(entry) {
  const lines = ['[mcp_servers.dopl]'];
  for (const [k, v] of Object.entries(entry)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) continue;
    lines.push(`${k} = ${JSON.stringify(v)}`);
  }
  lines.push('[mcp_servers.dopl.http_headers]');
  for (const [k, v] of Object.entries(entry.http_headers)) lines.push(`${JSON.stringify(k)} = ${JSON.stringify(v)}`);
  lines.push('[mcp_servers.dopl.env_http_headers]');
  for (const [k, v] of Object.entries(entry.env_http_headers)) lines.push(`${JSON.stringify(k)} = ${JSON.stringify(v)}`);
  for (const [tool, cfg] of Object.entries(entry.tools || {})) {
    lines.push(`[mcp_servers.dopl.tools.${tool}]`);
    for (const [k, v] of Object.entries(cfg)) lines.push(`${k} = ${JSON.stringify(v)}`);
  }
  return lines.join('\n') + '\n';
}
