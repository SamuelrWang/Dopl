// THE CONNECT ASSERTION — F-692 (2026-09-13), pinned against a FAKE INIT MESSAGE.
//
// THE INCIDENT. A Claude session launched into a shared home channel resolved `channel_agent`
// correctly (ruling B7) and then ran its whole life with NO dopl MCP server: `MCP_URL` is
// `APP_ORIGIN + /api/mcp`, and the local Next dev server's COLD route answered
// `POST /api/mcp 200 in 12.4s / 10.0s / 16.2s / 14.7s` — every one past the CLI's connect budget
// (`MCP_CONNECT_TIMEOUT_MS`, default 5000). The IN-PROCESS `dopl_agents` SDK server connected, so
// `rename_agent` worked and every `mcp__dopl__*` call answered "No such tool available" — and
// `prompt-framing.js` told the agent never to report the tool missing, so it did not.
//
// ⚠ THE RUNTIME HAD ALREADY SAID SO, IN THE FIRST MESSAGE OF THE STREAM. `SDKSystemMessage`
// (sdk.d.ts, SDK 0.3.220) is
//     { type:'system', subtype:'init', session_id, model, tools: string[],
//       mcp_servers: { name: string; status: string }[], … }
// and NOTHING READ `mcp_servers`. So the shape is asserted against the INSTALLED SDK's own
// typings below — the `mcp-server-tools-policy.test.mjs` idiom, and for its reason: a version bump
// that changes the field must fail HERE rather than in a session.
//
// ⚠ AND THE THREE CASES ARE DRIVEN THROUGH THE REAL NORMALIZER. `normalize()` is pure, so a fake
// init message is a complete test of the read — connected / failed / the server absent entirely
// (the exact shape of the 2026-08-08 `tools:` regression, which made `mcp_servers` come back `[]`).
//
// Run: `node --test dopl-desktop-app/test/mcp-connect-guard.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const readMain = (...p) => readFileSync(join(MAIN, ...p), "utf8");

const mcpConnect = require(join(MAIN, "mcp-connect.js"));
const normalize = require(join(MAIN, "runtime", "claude", "normalize.js"));
const events = require(join(MAIN, "runtime", "events.js"));

/** A fake init message in the SDK's own shape. `servers` omitted => no `mcp_servers` key at all. */
function initMsg(servers) {
  const msg = { type: "system", subtype: "init", session_id: "sdk-1", model: "claude-x" };
  if (servers !== undefined) msg.mcp_servers = servers;
  return msg;
}

// ── 1. THE SHAPE, AGAINST THE INSTALLED SDK ──────────────────────────────────────────────────

test("the SDK still declares `mcp_servers: {name, status}[]` on the init message", () => {
  // ⚠ READ OUT OF node_modules, never restated. The whole assertion rests on this field existing
  // with these two members; a bump that renames `status` would otherwise leave `doplStatus`
  // answering `missing` for a healthy server and every launch would fail closed on a lie.
  const dts = readFileSync(
    join(HERE, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"),
    "utf8"
  );
  const decl = dts.slice(dts.indexOf("export declare type SDKSystemMessage"));
  assert.ok(decl.startsWith("export declare type SDKSystemMessage"), "SDKSystemMessage is gone");
  const body = decl.slice(0, decl.indexOf("\n};"));
  assert.match(body, /subtype: 'init'/, "the init discriminator moved");
  assert.match(body, /mcp_servers: \{\s*name: string;\s*status: string;\s*\}\[\]/,
    "the init message's mcp_servers shape changed — re-measure mcp-connect.js › doplStatus");
});

// ── 2. THE READ — the three cases, through the REAL normalizer ────────────────────────────────

test("CONNECTED: the dopl entry's status rides the `launched` event and reads connected", () => {
  const [ev] = normalize.normalize(initMsg([
    { name: "dopl_agents", status: "connected" },
    { name: "dopl", status: "connected" },
  ]), {});
  assert.equal(ev.type, "launched");
  assert.equal(ev.sessionId, "sdk-1", "the conversation handle must still ride this event");
  assert.deepEqual(mcpConnect.doplStatus(ev.mcpServers), "connected");
  assert.equal(mcpConnect.isConnected(mcpConnect.doplStatus(ev.mcpServers)), true);
});

test("FAILED: a dopl entry that did not connect is not connected, whatever the word", () => {
  // ⚠ EVERY NON-`connected` WORD, INCLUDING THE OPTIMISTIC ONES. `connecting` / `pending` were
  // measured in the bundled binary beside `failed` / `needs-auth` / `disabled`, and the entry
  // carries `alwaysLoad: true` — which BLOCKS the launch until the server connects — so a
  // `connecting` at init is a server that ran out the connect timeout, not one still in flight.
  for (const status of ["failed", "needs-auth", "connecting", "pending", "disabled"]) {
    const [ev] = normalize.normalize(initMsg([{ name: "dopl", status }]), {});
    assert.equal(mcpConnect.doplStatus(ev.mcpServers), status);
    assert.equal(mcpConnect.isConnected(status), false, `${status} must not read as connected`);
  }
});

test("MISSING: the CLI dropped the whole entry — the 2026-08-08 shape — reads `missing`", () => {
  const [dropped] = normalize.normalize(initMsg([]), {});
  assert.equal(mcpConnect.doplStatus(dropped.mcpServers), mcpConnect.STATUS_MISSING);
  const [others] = normalize.normalize(initMsg([{ name: "dopl_agents", status: "connected" }]), {});
  assert.equal(mcpConnect.doplStatus(others.mcpServers), mcpConnect.STATUS_MISSING,
    "another server's health is NOT ours — the in-process one connecting is exactly what hid F-692");
  // ⚠ NAME MATCH IS EXACT: a prefix match would accept `dopl_agents` as the dopl server.
  assert.equal(mcpConnect.doplStatus([{ name: "dopl", status: "" }]), mcpConnect.STATUS_MISSING,
    "an entry with no status word says nothing about being up");
});

test("UNREPORTED: a runtime that publishes no list is not evidence of an outage", () => {
  // ⚠ THE ONE CASE THAT MUST NOT FAIL A LAUNCH. A second adapter that emits no `mcp_servers` has
  // not told us the server is down, and refusing every launch on its silence would make this
  // guard a claim about a runtime it cannot see.
  const [ev] = normalize.normalize(initMsg(undefined), {});
  assert.equal(ev.mcpServers, null, "an absent list is null on the event, never []");
  assert.equal(mcpConnect.doplStatus(ev.mcpServers), mcpConnect.STATUS_UNREPORTED);
  assert.equal(mcpConnect.mcpConnectVerdict({ status: mcpConnect.STATUS_UNREPORTED, attempt: 0 }), "ok");
  assert.equal(mcpConnect.mcpConnectVerdict({ status: mcpConnect.STATUS_UNREPORTED, attempt: 9 }), "ok");
  // The constructor's own contract, stated where a reader will look for it.
  assert.equal(events.launched("s", "m", "not-an-array").mcpServers, null);
});

// ── 3. THE VERDICT — ONE retry, then fail. Never a mute agent ─────────────────────────────────

test("a first failure RETRIES and a second one FAILS — exactly one retry, ever", () => {
  for (const status of ["failed", "missing", "connecting"]) {
    assert.equal(mcpConnect.mcpConnectVerdict({ status, attempt: 0 }), "retry", `${status} @0`);
    assert.equal(mcpConnect.mcpConnectVerdict({ status, attempt: 1 }), "fail", `${status} @1`);
    assert.equal(mcpConnect.mcpConnectVerdict({ status, attempt: 7 }), "fail", `${status} @7`);
  }
  assert.equal(mcpConnect.mcpConnectVerdict({ status: "connected", attempt: 0 }), "ok");
  assert.equal(mcpConnect.mcpConnectVerdict({ status: "connected", attempt: 1 }), "ok",
    "a retry that CONNECTED is a healthy session, not a failure");
});

test("the operator's sentence names the server and the status, and never guesses the cause", () => {
  const first = mcpConnect.mcpDownText("failed", 0);
  const second = mcpConnect.mcpDownText("missing", 1);
  for (const text of [first, second]) {
    assert.match(text, /MCP unavailable/, "the operator-visible label is missing");
    assert.match(text, /Dopl MCP server/);
    assert.ok(!/dev server|Next|deploy/i.test(text), "it must not guess the cause");
  }
  assert.match(first, /"failed"/);
  assert.match(second, /"missing"/);
  assert.match(second, /after a retry/, "the second failure must say the retry already happened");
});

// ── 4. THE WIRE — the three sites that carry the read, pinned by source ───────────────────────

test("the guard is BOUND by the engine and CONSULTED by the consume loop", () => {
  // ⚠ BY SOURCE, because deleting either half is otherwise silent: an unbound guard answers
  // `false` to everything (its own documented harness behaviour) and a consume loop that stops
  // asking restores the incident exactly.
  assert.match(readMain("session-engine.js"), /mcpGuard\.bind\(\{[^}]*startQuery[^}]*\}\)/s,
    "the engine no longer binds mcp-connect-guard — every failure would answer `false`");
  const query = readMain("session-query.js");
  assert.match(query, /signal\.type === 'mcp_status'/, "the consume loop stopped branching on the signal");
  assert.match(query, /mcpGuard\.handleMcpStatus\(s, signal\.status\)/, "the guard is not consulted");
  assert.match(query, /warmMcpRoute\(\{/, "the pre-flight left session-query");
  // ⚠ AND THE PRE-FLIGHT'S OWN COST IS FENCED (2026-09-14 review). It puts up to WARM_TIMEOUT_MS
  // between the caller's decision to launch and the spawn, with the old query already torn down —
  // so a session settled in that window (an interrupt, a delete, an abandonment timeout) would
  // otherwise still spawn a child holding its pre-approved channel access, with nothing left
  // pointing at it. ⚠ ASSERTED AS THE PAIR, in order, INSIDE `preflightMcp`: a guard that stands
  // ABOVE the warm call is a guard about a moment that has passed.
  const pre = query.indexOf("async function preflightMcp(s) {");
  assert.ok(pre > 0, "preflightMcp is gone — both launch lanes reach the pre-flight through it");
  assert.ok(query.indexOf("warmMcpRoute({", pre) < query.indexOf("if (s.settled) {", pre),
    "preflightMcp must re-check `s.settled` AFTER the warm call, not before it");
  assert.ok(query.indexOf("if (await preflightMcp(s)) return;") < query.indexOf("rt.start(buildLaunchSpec(s))"),
    "startQuery must abandon the launch when the pre-flight says the session is gone");
  // ⚠ AND THE RESUME LANE REACHES THE SAME FUNCTION (F-696). It used to skip the pre-flight on the
  // claim that "its route was warmed by the launch it is resuming" — false after a boot re-park,
  // which resumes off DISK against a route nothing in this process has touched.
  assert.match(readMain("session-park.js"), /deps\.preflightMcp && \(await deps\.preflightMcp\(s\)\)/,
    "startResumedConsumer stopped warming the route before it resumes");
  assert.match(readMain("session-engine.js"), /preflightMcp: sessionQuery\.preflightMcp/,
    "…and the engine must still inject it, or the guard above is a dead branch");
  // The adapter must keep FORWARDING the field, or core has nothing to read.
  assert.match(readMain("runtime", "claude", "normalize.js"),
    /events\.launched\(msg\.session_id, msg\.model, msg\.mcp_servers\)/,
    "the Claude adapter stopped forwarding mcp_servers");
});

test("the CLI's connect budget is RAISED on every spawn, by env, because there is no flag", () => {
  // ⚠ MEASURED: the bundled binary reads `MCP_CONNECT_TIMEOUT_MS` (int, default 5000) and ships
  // exactly ONE mcp flag, `--mcp-config`. `MCP_TIMEOUT` / `MCP_TOOL_TIMEOUT` are other clocks.
  assert.equal(mcpConnect.CLI_CONNECT_TIMEOUT_ENV, "MCP_CONNECT_TIMEOUT_MS");
  assert.ok(mcpConnect.CLI_CONNECT_TIMEOUT_MS > 5000, "raising it is the whole point");
  assert.match(readMain("runtime", "claude", "loader.js"),
    /out\[mcpConnect\.CLI_CONNECT_TIMEOUT_ENV\] = String\(mcpConnect\.CLI_CONNECT_TIMEOUT_MS\)/,
    "the scrubbed env stopped setting the connect budget");
});

// ── 5. THE PRE-FLIGHT — it warms, and it can never fail a launch ──────────────────────────────

test("the pre-flight POSTs an MCP initialize with the bearer, and answers a word", () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200 }; };
  return mcpConnect.warmMcpRoute({
    url: "https://dopl.test/api/mcp", token: "tok", workspaceId: "ws-1", fetchImpl,
  }).then((word) => {
    assert.equal(word, "http 200");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
    assert.equal(calls[0].init.headers["X-Workspace-Id"], "ws-1");
    assert.equal(JSON.parse(calls[0].init.body).method, "initialize",
      "a shape the route rejects early can be answered WITHOUT compiling the handler");
  });
});

test("…and NOTHING it can meet fails the launch — a throw, a 401 and a hang are all words", async () => {
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", fetchImpl: async () => ({ status: 401 }) }), "http 401");
  assert.match(await mcpConnect.warmMcpRoute({
    url: "u", fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  }), /^error ECONNREFUSED/);
  assert.equal(await mcpConnect.warmMcpRoute({
    url: "u", timeoutMs: 5, fetchImpl: () => new Promise(() => {}),
  }), "timeout", "a route that never answers must resolve on OUR clock, not the caller's");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "", fetchImpl: async () => ({}) }), "skipped");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u" }), "skipped", "no fetch on this runtime");
});
