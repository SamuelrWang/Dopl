'use strict';

// LIVE CONTRACT HARNESS — THE MCP TRANSPORT LANE.
//
// `POST /api/mcp` is the endpoint every spawned session talks to, and before this file it
// had NO TEST AT ANY TIER. The unit suites test the tools; nothing tested the envelope that
// carries them. That is the gap this lane exists for, and it is tested from the OUTSIDE —
// raw JSON-RPC on the wire, no SDK client — because an SDK client is the one caller
// guaranteed to send well-formed frames, and the interesting failures are the malformed ones.
//
// FIVE TIERS, cheapest first, because a failure at tier 1 makes the rest meaningless:
//   1. the envelope    does a valid `initialize` come back as JSON-RPC at all
//   2. the catalogue   does `tools/list` name the tools, and is `dopl_channel` among them
//   3. the tool call   does a real op round-trip through the SSE frame parser
//   4. the refusals    unknown method / unknown tool / malformed body — REFUSED, not 200 OK
//   5. strict args     a REMOVED parameter is an ERROR, not silently stripped (F-145)
//
// TIER 5 IS THE ONE THAT SHIPPED BROKEN. P2's design claim was "removed params are refused,
// not stripped", and it was true at the HTTP layer and FALSE through the MCP SDK, whose
// default object parse drops unknown keys. That is invisible to every mock-based test,
// because the mocks were the thing asserting the contract. Only the real endpoint can say.

const { PASS, FAIL, SKIP, result, verdict, missing } = require('./checks-shared');

/** 1. A valid `initialize` comes back as parseable JSON-RPC with a protocol version. */
async function checkInitialize(ctx) {
  const res = await ctx.api.rpc({
    jsonrpc: '2.0',
    id: 'harness-init',
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dopl-live-harness', version: '1' },
    },
  });
  const fails = [];
  if (!res.ok) fails.push(`HTTP ${res.status}: ${String(res.text).slice(0, 300)}`);
  if (!res.payload) fails.push('the body parsed as neither SSE-framed nor plain JSON-RPC');
  else {
    if (res.payload.error) fails.push(`JSON-RPC error: ${JSON.stringify(res.payload.error).slice(0, 300)}`);
    const info = res.payload.result || {};
    if (!info.protocolVersion) fails.push('result carries no protocolVersion');
    if (!info.serverInfo || !info.serverInfo.name) fails.push('result carries no serverInfo.name');
    ctx.mcpServerInfo = info.serverInfo || null;
  }
  return verdict(fails, {
    extraLines: res.payload && res.payload.result
      ? [`server ${JSON.stringify(res.payload.result.serverInfo || {})} proto ${res.payload.result.protocolVersion}`]
      : [`content-type ${res.contentType || '(none)'} body ${String(res.text).slice(0, 200)}`],
  });
}

/** 2. `tools/list` names the tools this workspace's caller can see. */
async function checkToolsList(ctx) {
  const res = await ctx.api.rpc({ jsonrpc: '2.0', id: 'harness-list', method: 'tools/list', params: {} });
  if (!res.ok || !res.payload) {
    return result(FAIL, `HTTP ${res.status} — ${String(res.text).slice(0, 300)}`);
  }
  if (res.payload.error) {
    return result(FAIL, `JSON-RPC error: ${JSON.stringify(res.payload.error).slice(0, 300)}`);
  }
  const tools = (res.payload.result && res.payload.result.tools) || [];
  const names = tools.map((t) => t && t.name).filter(Boolean);
  ctx.mcpTools = names;
  const fails = [];
  if (!names.length) fails.push('tools/list returned an empty catalogue');
  if (!names.includes('dopl_channel')) fails.push(`dopl_channel absent — got [${names.join(', ')}]`);
  // THE RESIDUE ASSERTION. `to_agent` was the summon-era tool; F-141 removed the model it
  // served. A server still advertising it is advertising a capability that cannot work.
  if (names.includes('to_agent')) fails.push('the retired `to_agent` tool is still advertised');
  return verdict(fails, { extraLines: [`${names.length} tools: ${names.join(', ')}`] });
}

/** 3. A real op round-trips through the SSE frame parser and renders text. */
async function checkToolCallRoundTrip(ctx) {
  const res = await ctx.api.channelOp('list');
  const fails = [];
  if (!res.ok) {
    fails.push(
      res.rpcError
        ? `JSON-RPC error: ${JSON.stringify(res.rpcError).slice(0, 300)}`
        : `HTTP ${res.status}: ${String(res.text).slice(0, 300)}`
    );
  } else {
    if (res.isError) fails.push(`the tool answered isError: ${res.rendered.slice(0, 300)}`);
    if (!res.rendered.trim()) fails.push('the tool returned no text content');
    // The harness channel was created over REST; it must be visible over MCP. That is the
    // round trip the two surfaces exist to keep honest.
    if (ctx.channel && res.rendered && !res.rendered.includes(ctx.channel.name)) {
      fails.push(`the harness channel "${ctx.channel.name}" is absent from the MCP list render`);
    }
  }
  return verdict(fails, {
    extraLines: [`rendered ${String(res.rendered || '').length} chars`],
  });
}

/**
 * 4. THE REFUSALS. Three malformed calls, each of which must be REFUSED — and the check
 * fails on a 200-with-a-result just as hard as on a crash, because "accepted something
 * meaningless" is the failure mode a transport test exists to catch.
 */
async function checkTransportRefusals(ctx) {
  const fails = [];
  const lines = [];

  const unknownMethod = await ctx.api.rpc({ jsonrpc: '2.0', id: 1, method: 'nonsense/method', params: {} });
  const rejectedMethod = !!(unknownMethod.payload && unknownMethod.payload.error) || !unknownMethod.ok;
  lines.push(`unknown method -> HTTP ${unknownMethod.status} ${describe(unknownMethod)}`);
  if (!rejectedMethod) fails.push('an unknown JSON-RPC method was ACCEPTED');

  const unknownTool = await ctx.api.mcp('dopl_not_a_tool', {});
  const rejectedTool = !unknownTool.ok || unknownTool.isError;
  lines.push(`unknown tool -> HTTP ${unknownTool.status} ${unknownTool.rpcError ? 'rpc-error' : unknownTool.isError ? 'isError' : 'ACCEPTED'}`);
  if (!rejectedTool) fails.push('an unknown tool name was ACCEPTED');

  // Not JSON at all. The transport must answer something structured, never hang and never
  // 500 with a stack.
  const malformed = await ctx.api.rpc('{"jsonrpc":"2.0",,,}');
  const rejectedBody = !malformed.ok || !!(malformed.payload && malformed.payload.error);
  lines.push(`malformed body -> HTTP ${malformed.status} ${describe(malformed)}`);
  if (!rejectedBody) fails.push('a malformed JSON body was ACCEPTED');
  if (malformed.status >= 500) fails.push(`a malformed body produced a ${malformed.status}, not a 4xx`);

  return verdict(fails, { extraLines: lines });
}

/**
 * 5. STRICT ARGS (F-145). A parameter the rollback REMOVED must be an error, not a silent
 * strip. Probed with the removed `toAgents` on a read-only op, so a server that wrongly
 * accepts it does nothing worse than answer a read.
 *
 * NO VACUOUS PASS: a refusal only means something if the SAME op WITHOUT the removed key
 * succeeds. Both halves run, and the check fails if the control does not pass.
 */
async function checkStrictArgs(ctx) {
  const control = await ctx.api.channelOp('list');
  if (!control.ok || control.isError) {
    return result(
      SKIP,
      `the control call (op="list", no removed keys) did not succeed, so a refusal below would ` +
        `prove nothing: ${control.rendered ? control.rendered.slice(0, 200) : `HTTP ${control.status}`}`
    );
  }
  const withRemoved = await ctx.api.channelOp('list', { toAgents: ['hxa'] });
  const refused = !withRemoved.ok || withRemoved.isError;
  if (!refused) {
    return result(
      FAIL,
      'the removed parameter `toAgents` was ACCEPTED on op="list" — the MCP layer is parsing ' +
        'non-strict and STRIPPING unknown keys, which is the exact F-145 defect',
      { extraLines: [`rendered: ${String(withRemoved.rendered).slice(0, 200)}`] }
    );
  }
  return result(PASS, '', {
    extraLines: [
      `control ok; removed-key call refused with ${withRemoved.rpcError ? 'a JSON-RPC error' : 'isError'}`,
    ],
  });
}

/**
 * 6. X-Dopl-Runtime END TO END — AND THE HONESTY BOUND ON IT.
 *
 * Two recognized values (`src/shared/auth/runtime-header.ts`), and this harness can only
 * legitimately produce ONE of them, which is the whole point of the check:
 *
 *   `desktop-session`  DELIBERATELY CREDENTIAL-AGNOSTIC — a desktop-spawned session
 *                      authenticates with exactly the device token this harness holds, so
 *                      bounding it would refuse the caller it was invented for. This one
 *                      MUST stamp.
 *   `desktop-ui`       "a person typed this in the app". `narrowRuntime` REFUSES it for an
 *                      agent credential, which is every credential this harness can hold.
 *                      This one MUST NOT stamp.
 *
 * So the check drives both and asserts the ASYMMETRY. A run where both stamp has lost the
 * bound; a run where neither stamps has lost the feature. The first draft of this check
 * sent `desktop-ui` and read its (correct) refusal as a product bug — the asymmetry is the
 * only reading that can tell those two apart.
 */
function checkRuntimeStamp(ctx) {
  const stamped = ctx.msg.stamped;
  const spoofed = ctx.msg.spoofedRuntime;
  const plain = ctx.msg.control;
  if (!stamped) return result(SKIP, 'the desktop-session post was not accepted, so there is nothing to read back');
  const runtimeOf = (m) => ((m && m.metadata) || {}).runtime;
  const seen = runtimeOf(stamped);
  const spoofSeen = runtimeOf(spoofed);
  const plainSeen = runtimeOf(plain);

  const fails = [];
  if (!seen) {
    fails.push(
      'a post carrying X-Dopl-Runtime: desktop-session stored NO runtime field ' +
        `(metadata keys: ${Object.keys((stamped && stamped.metadata) || {}).join(', ') || 'none'}). ` +
        'That stamp is credential-agnostic by design and must survive a device token.'
    );
  } else if (seen !== 'desktop-session') {
    fails.push(`sent desktop-session but the server stored runtime="${seen}"`);
  }
  // THE BOUND. An agent credential claiming to be a person must be refused.
  if (spoofed && spoofSeen === 'desktop-ui') {
    fails.push(
      'an AGENT credential sent X-Dopl-Runtime: desktop-ui and the server STAMPED it — ' +
        'narrowRuntime is supposed to refuse that claim outright, and the desktop reads this ' +
        'stamp when deciding whether to open a window'
    );
  }
  // THE CONTROL. A post that sent no header at all must carry no stamp.
  if (plainSeen) {
    fails.push(`the CONTROL post (no header sent) reads back runtime="${plainSeen}" — the field is not caller-derived`);
  }
  return verdict(fails, {
    extraLines: [
      `desktop-session=${seen || '(absent)'} desktop-ui-spoof=${spoofSeen || '(refused, absent)'} control=${plainSeen || '(absent)'}`,
    ],
  });
}

const describe = (r) =>
  r.payload && r.payload.error ? 'rpc-error' : r.payload && r.payload.result ? 'ACCEPTED' : 'unparseable';

module.exports = {
  checkInitialize,
  checkToolsList,
  checkToolCallRoundTrip,
  checkTransportRefusals,
  checkStrictArgs,
  checkRuntimeStamp,
};
