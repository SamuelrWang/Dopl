// F2 — THE PER-SESSION `X-Dopl-Session-Id` STAMP (F-113 residual (b)).
//
// WHAT IT IS FOR. One `channel_agents` row can be claimed by any number of processes
// holding this device's credential, and on THIS machine that is BY DESIGN: session-store's
// `slotKey` gives a ROOM session (channel, agent) and a PAIR session (channel, thread)
// disjoint keys, so one handle legitimately runs several at once. Nothing on the wire said
// WHICH of them wrote a message — two sessions posted as one handle and gave a peer
// contradictory instructions 79 seconds apart with nothing able to attribute either. The
// header closes that: the server strips any caller-supplied `metadata.session_id` and
// stamps the reserved key ONLY from this header (src/shared/auth/session-header.ts).
//
// WHY IT NEEDS ITS OWN FILE. The desktop half shipped with NO test at all. It is a
// two-sided contract with a server that DROPS SILENTLY: a value outside the server's
// narrowing regex, or a header name spelled differently, produces no stamp and no error
// anywhere — the attribution line simply never appears, months later, on a machine nobody
// is watching. So this file pins BOTH sides against each other by reading the server's own
// regex and header name out of `src/shared/auth/session-header.ts` as source. Copying the
// literals here would let the two drift with a green suite, which is the exact failure the
// stamp exists to prevent.
//
// METHOD: sdk-loader.js is electron-bound (app.getPath), so the functions under test are
// brace-matched out of the source and evaluated with fakes — the idiom this directory uses
// (sdk-grant / sdk-mcp-token / mcp-client-timeout).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf, orderOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const LOADER = M("sdk-loader.js");
const QUERY = M("session-query.js");
const CONFIG = M("mcp-config.js");
const STORE = M("session-store.js");
const LEGACY = M("legacy-threads.js");

// The SERVER's own module — the other end of this contract.
const SERVER = readFileSync(
  join(HERE, "..", "..", "src", "shared", "auth", "session-header.ts"),
  "utf8"
);

// A `const SESSION_ID_RE = /…/;` out of either side, as SOURCE TEXT. Throws rather than
// defaulting: a renamed / deleted constant must fail loudly, never pass by absence.
function reSourceOf(src, what) {
  const m = /const SESSION_ID_RE = (\/.*\/);/.exec(src);
  assert.ok(m, `${what} must define SESSION_ID_RE`);
  return m[1];
}
const DESKTOP_RE_SRC = reSourceOf(LOADER, "sdk-loader.js");
const SERVER_RE_SRC = reSourceOf(SERVER, "session-header.ts");
// The live regex the SERVER narrows with, compiled from its own source.
const SERVER_RE = new Function(`return ${SERVER_RE_SRC};`)();

// The header name each side spells. The server's is the lowercase wire form it reads;
// the desktop writes a canonical-cased one (HTTP field names are case-insensitive).
const SERVER_HEADER = (() => {
  const m = /SESSION_ID_HEADER = "([^"]+)";/.exec(SERVER);
  assert.ok(m, "session-header.ts must export SESSION_ID_HEADER");
  return m[1];
})();
const STAMP_FN = fnOf(LOADER, "withSessionStamp");
const DESKTOP_HEADER = (() => {
  const m = /headers\['([^']+)'\] = slot;/.exec(STAMP_FN);
  assert.ok(m, "withSessionStamp must write a single quoted header name");
  return m[1];
})();

// The real function, with its narrowing regex, run for real.
const withSessionStamp = new Function(
  `const SESSION_ID_RE = ${DESKTOP_RE_SRC};\n${STAMP_FN}\n return withSessionStamp;`
)();

// The real builder, so the stamp lands on the entry a spawn actually gets.
const MCP_URL = "https://dopl.test/api/mcp";
function buildServers(policy = null, workspaceId = "", token = "device-token") {
  return new Function(
    "doplBearer", "clientTimeoutMs", "MCP_URL", "policy", "workspaceId",
    `${fnOf(LOADER, "buildMcpServers")}\n return buildMcpServers(policy, workspaceId);`
  )(() => token, () => 280_000, MCP_URL, policy, workspaceId);
}

// The real slot arithmetic + the real legacy thread id.
const { sessionKey, slotKey } = new Function(
  `${fnOf(STORE, "sessionKey")}\n${fnOf(STORE, "slotKey")}\n return { sessionKey, slotKey };`
)();
const legacyThreadId = new Function(
  `${fnOf(LEGACY, "legacyThreadId")}\n return legacyThreadId;`
)();

const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const THREAD = "11111111-2222-3333-4444-555555555555";
const AGENT = "9a1b2c3d-4444-4eee-8fff-000000000000";

// ── The two-sided contract (the drift this file exists to catch) ───────────────

test("the desktop narrows a slot with the SERVER's regex, character for character", () => {
  // Not "the desktop has a regex" — that is what shipped. The desktop mirrors the
  // server's shape so an unsendable value is never put on the wire; widen or narrow
  // either side alone and the two disagree about what survives, silently.
  assert.equal(
    DESKTOP_RE_SRC,
    SERVER_RE_SRC,
    "sdk-loader's SESSION_ID_RE must be the server's SESSION_ID_RE — fix the copy, not this test"
  );
});

test("the header the desktop writes is the header the server reads", () => {
  // The server drops an unrecognized field name in silence: no stamp, no error, no log.
  // A typo here costs every future attribution line and nothing else would catch it.
  assert.equal(DESKTOP_HEADER.toLowerCase(), SERVER_HEADER);
  assert.equal(DESKTOP_HEADER, "X-Dopl-Session-Id", "the canonical casing the app sends");
  assert.equal(SERVER_HEADER, "x-dopl-session-id", "…and the lowercase wire form it is read by");
});

// ── withSessionStamp: what it does to the entry ────────────────────────────────

test("the slot key rides the dopl entry beside the bearer, pin and runtime stamp", () => {
  // ⚠ THE KEY GAINED AN AGENT SEGMENT ON 2026-08-21 and the stamp follows it, deliberately: the
  // header names the REGISTRY SLOT this run occupies, and with several of the operator's agents
  // on one thread the (channel, thread) pair no longer names one. The server's own
  // `SESSION_ID_RE` (`^[A-Za-z0-9:._-]{1,128}$`, pinned identical above) already admits more
  // than one colon and the agent charset, so no schema moved for this.
  const AGENT = "a1b2c3d4";
  const servers = buildServers(null, "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee");
  withSessionStamp(servers, slotKey({ channelId: CH, taskId: THREAD, agentId: AGENT }));
  assert.deepEqual(servers.dopl.headers, {
    Authorization: "Bearer device-token",
    "X-Dopl-Runtime": "desktop-session",
    "X-Workspace-Id": "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee",
    "X-Dopl-Session-Id": `${CH}:${THREAD}:${AGENT}`,
  }, "every header the builder set survives, and the stamp joins them");
  // TWO agents on ONE thread stamp two DIFFERENT values, which is the whole point of the
  // widening: nothing on the wire could otherwise tell their calls apart.
  const other = buildServers(null, "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee");
  withSessionStamp(other, slotKey({ channelId: CH, taskId: THREAD, agentId: "z9y8x7w6" }));
  assert.notEqual(other.dopl.headers["X-Dopl-Session-Id"], servers.dopl.headers["X-Dopl-Session-Id"]);
});

test("an entry that arrives WITHOUT a headers object gets one, and never throws", () => {
  // buildMcpServers always ships `headers`, so this is unreachable today — the pin is
  // that the failure mode of a LABEL can never be a dead launch. withSessionStamp runs
  // inside buildSdkOptions, the ONE assembly point every spawn shape goes through, so a
  // TypeError here would take down the session for an attribution hint.
  const servers = { dopl: { type: "http", url: MCP_URL } };
  withSessionStamp(servers, "c1:t1");
  assert.deepEqual(servers.dopl.headers, { "X-Dopl-Session-Id": "c1:t1" });
  assert.equal(servers.dopl.url, MCP_URL, "the rest of the entry is untouched");
});

test("an existing headers object is added to, never replaced", () => {
  const headers = { Authorization: "Bearer t", "X-Dopl-Runtime": "desktop-session" };
  const servers = { dopl: { headers } };
  withSessionStamp(servers, "c1:t1");
  assert.equal(servers.dopl.headers, headers, "the SAME object — no rebuild, no dropped field");
  assert.deepEqual(headers, {
    Authorization: "Bearer t",
    "X-Dopl-Runtime": "desktop-session",
    "X-Dopl-Session-Id": "c1:t1",
  });
});

test("it MUTATES IN PLACE, because the call site ignores the return value", () => {
  // session-query.js calls `withSessionStamp(options.mcpServers, store.slotKey(s))` as a
  // statement. Returning a stamped COPY would leave `options.mcpServers` unstamped with
  // every other assertion in this file still green.
  const servers = buildServers();
  const out = withSessionStamp(servers, "c1:t1");
  assert.equal(out, servers, "the same object comes back");
  assert.equal(servers.dopl.headers["X-Dopl-Session-Id"], "c1:t1", "…and it was stamped");
});

// ── Nothing to stamp: NO KEY AT ALL, which is what every other poster looks like ──

test("an absent / empty / non-string slot leaves the entry with no such header", () => {
  // "Absent header → NO KEY AT ALL" is the server's stated shape for a non-desktop
  // poster (session-header.ts). An empty stamp must therefore be an ABSENT field, not
  // an empty-valued one: `X-Dopl-Session-Id: ''` would be a value the server rejects
  // rather than a caller that never claimed a session.
  for (const nothing of [undefined, null, "", "   ", "\n", 42, {}, [], true]) {
    const servers = buildServers();
    withSessionStamp(servers, nothing);
    assert.deepEqual(
      Object.keys(servers.dopl.headers),
      ["Authorization", "X-Dopl-Runtime"],
      `slot=${JSON.stringify(nothing)} must leave the headers exactly as built`
    );
    assert.ok(!("X-Dopl-Session-Id" in servers.dopl.headers));
  }
});

test("a slot the SERVER would reject is not sent at all (fail closed, never a crash)", () => {
  // Whitespace is the load-bearing case: this string is echoed back onto another
  // member's screen as part of a message line, so a newline could forge a render line.
  // The desktop refusing to send it is belt over the server's own braces.
  const bad = [
    "c1 t1", "c1\nt1", "c1\tt1", "`c1`", "c1'; drop", "<b>c1</b>", "c1/t1", "c1@t1",
    "café:t1", "c1:t1 ", // trailing space survives the trim? (it does not — see below)
    "x".repeat(129),
  ];
  for (const slot of bad) {
    const servers = buildServers();
    withSessionStamp(servers, slot);
    const sent = servers.dopl.headers["X-Dopl-Session-Id"];
    if (sent !== undefined) {
      // The ONE tolerated case: surrounding whitespace is trimmed off first, exactly as
      // the Headers layer would. Whatever is sent must still satisfy the server.
      assert.match(sent, SERVER_RE, `stamped ${JSON.stringify(sent)} — the server drops it`);
      assert.equal(sent, slot.trim());
    }
  }
  // The boundary itself: 128 is the longest sendable slot, 129 is silence.
  const at = buildServers();
  withSessionStamp(at, "x".repeat(128));
  assert.equal(at.dopl.headers["X-Dopl-Session-Id"], "x".repeat(128));
  const over = buildServers();
  withSessionStamp(over, "x".repeat(129));
  assert.ok(!("X-Dopl-Session-Id" in over.dopl.headers), "129 chars is dropped, not truncated");
});

test("no dopl entry (pre-sign-in) and junk input are no-ops, not throws", () => {
  // buildMcpServers returns {} with no bearer, and that spawn still has to launch.
  assert.deepEqual(withSessionStamp(buildServers(null, "", ""), "c1:t1"), {});
  for (const junk of [null, undefined, "", 0, "servers", [], { dopl: null }, { dopl: "x" }, { other: {} }]) {
    assert.equal(withSessionStamp(junk, "c1:t1"), junk, `${JSON.stringify(junk)} comes back unchanged`);
  }
});

// ── The value: every slot key this machine mints is sendable ───────────────────

test("every slot shape passes the SERVER's regex, so the stamp is never dropped", () => {
  // The desktop's ids are UUIDs and `task-<channel>-<seq>` legacy ids, all of which sit
  // inside the server's character class — but that is a PROPERTY of today's id sources,
  // not a guarantee. Change how a thread / agent id is minted and this fails here rather
  // than by an attribution line quietly never appearing in production.
  const slots = {
    "pair (channel, thread)": slotKey({ channelId: CH, taskId: THREAD }),
    "room (channel, agent)": slotKey({ channelId: CH, agentId: AGENT }),
    "team agent with no thread": slotKey({ channelId: CH, agentId: AGENT, taskId: "" }),
    "responder with no first-class thread": slotKey({ channelId: CH, taskId: "" }),
    "legacy thread id": slotKey({ channelId: CH, taskId: legacyThreadId(CH, 41) }),
  };
  for (const [what, slot] of Object.entries(slots)) {
    assert.match(slot, SERVER_RE, `${what}: ${JSON.stringify(slot)} would be dropped by the server`);
    assert.ok(slot.length <= 128, `${what}: ${slot.length} chars`);
    // …and it really does reach the wire, rather than merely being regex-clean.
    const servers = buildServers();
    withSessionStamp(servers, slot);
    assert.equal(servers.dopl.headers["X-Dopl-Session-Id"], slot, what);
  }
  // The room and pair slots of ONE channel are DIFFERENT values, which is the entire
  // point: two concurrent sessions of one agent handle must be tellable apart.
  assert.notEqual(slots["pair (channel, thread)"], slots["room (channel, agent)"]);
  assert.equal(slotKey({ channelId: CH, taskId: THREAD }), sessionKey(CH, THREAD), "no agent -> byte-for-byte the session key");
});

test("a slot key built from a hostile id degrades to NO stamp, never to a bad header", () => {
  // Defense in depth. Today `targeting.firstClassTaskId` UUID-narrows an inbound
  // `metadata.taskId` (which is caller-settable) before it can ever key a session, so
  // this input is unreachable through the trigger path. If a future path ever lets one
  // through, the cost is a missing attribution hint — not a forged render line, and not
  // a failed spawn.
  const slot = slotKey({ channelId: CH, taskId: "t1\nX-Dopl-Runtime: desktop-session" });
  assert.doesNotMatch(slot, SERVER_RE, "the harness input must actually be rejectable");
  const servers = buildServers();
  withSessionStamp(servers, slot);
  assert.ok(!("X-Dopl-Session-Id" in servers.dopl.headers), "nothing is sent");
});

// ── The wiring: session-query.js actually applies it, with the slot key ─────────

test("buildSdkOptions stamps the assembled mcpServers with store.slotKey(s)", () => {
  const opts = fnOf(QUERY, "buildSdkOptions");
  // The stamp names the REGISTRY SLOT this run occupies — `store.slotKey` is the one
  // definition of that (channel, agent) / (channel, thread) arithmetic. Rebuilding the
  // value by hand here is the bug FIX N1 already fixed one file over.
  assert.match(opts, /withSessionStamp\(options\.mcpServers, store\.slotKey\(s\)\);/);
  // The builder literal two other suites source-scan is untouched, and the stamp is
  // applied AFTER it — stamping a not-yet-built object would be a silent no-op.
  // 🔒 THE THIRD ARGUMENT IS THE CONTAINER LOCK (2026-08-26, plan §4.4 B1) — the child
  // credential for a session spawned into a SHARED link container, '' for every other
  // session. It is pinned INTO this literal rather than beside it because dropping the
  // argument silently reverts every locked session to the operator's device token.
  assert.match(opts, /mcpServers: buildMcpServers\(cfg\.doplToolsPolicy, s\.workspaceId, sessionCredential\.sessionBearer\(s\)\),/);
  assert.ok(
    orderOf(opts, "mcpServers: buildMcpServers(", "withSessionStamp(", "buildSdkOptions"),
    "the entry must exist before it can be stamped"
  );
  // …and the two modules are really joined: the import and the export.
  assert.match(QUERY, /withSessionStamp[^\n]*\} = require\('\.\/sdk-loader'\);/);
  assert.match(LOADER, /^\s*withSessionStamp, \/\/ F2/m, "exported from the one SDK-facing module");
});

test("the per-session stamp NEVER reaches the shared, on-disk spawn config", () => {
  // The seam this split exists for. buildMcpServers answers "what MCP server does this
  // app offer" — the same answer for every spawn — and mcp-config.js used to write that
  // same shape ONCE into userData/mcp-spawn.json for the headless `--mcp-config` path,
  // where a per-session value could not be correct for the sessions that later read it.
  // ⚠ S3 (2026-08-26) DELETED that file and its writer (`mcp-config.js › removeSpawnConfig`),
  // so these assertions no longer guard a live shared artifact — they guard the SEAM, which
  // is still the right one and is the thing a future author would collapse. Only the
  // in-memory SDK path knows which run is calling, so only it stamps.
  assert.ok(!/Session-Id/.test(fnOf(LOADER, "buildMcpServers")), "the shared builder does not stamp");
  assert.ok(!/Session-Id/i.test(CONFIG), "and the spawn-config file has no session header at all");
  assert.ok(!/withSessionStamp/.test(CONFIG), "…nor a call to the stamper");
});
