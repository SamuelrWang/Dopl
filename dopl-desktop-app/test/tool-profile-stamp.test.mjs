// THE PER-SESSION `X-Dopl-Tool-Profile` STAMP — the desktop half of the role-scoped tool
// offer (2026-09-02, MCP v2 wave A / A3).
//
// WHAT IT IS FOR. This app already decides how contained every spawned session is —
// `tool-profiles.js` picks read_only / dopl_only / full and enforces it locally through
// `--disallowedTools`, the `--tools` bound and the permission gate. The MCP SERVER never
// heard that word, so a `dopl_only` courier that will only ever call `dopl_channel` still
// pays for all 13 tools' descriptions and input schemas on connection. One header fixes it.
//
// WHY IT NEEDS ITS OWN FILE, and it is the same argument `session-id-stamp.test.mjs` makes:
// this is a two-sided contract with a server that FAILS OPEN. A header name spelled
// differently, or a value the server's shape check drops, produces no error anywhere — the
// session simply keeps paying for the whole surface, invisibly, forever. So both sides are
// read as SOURCE and pinned against each other; copying the literals here would let them
// drift with a green suite.
//
// ⚠ AND IT PINS THE DIRECTION. The header may only NARROW and it GRANTS NOTHING: the value
// is whatever `normalizeProfile` already answered for this spawn — the same fail-closed read
// the deny list was built from — so the header can never claim a wider profile than the one
// the session is actually contained at.
//
// METHOD: loader.js is electron-bound (app.getPath), so the function under test is
// brace-matched out of the source and evaluated with fakes — the idiom this directory uses
// (sdk-grant / sdk-mcp-token / session-id-stamp).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf, orderOf } from "./helpers/source-probe.mjs";
import { normalizeProfile, KNOWN_PROFILES } from "../main/tool-profiles.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const LOADER = M(join("runtime", "claude", "loader.js"));
const SPEC = M(join("runtime", "claude", "launch-spec.js"));

// The SERVER's own modules — the other two ends of this contract.
const HEADER_SRC = readFileSync(
  join(HERE, "..", "..", "src", "shared", "auth", "tool-profile-header.ts"),
  "utf8"
);
const GATING_SRC = readFileSync(
  join(HERE, "..", "..", "packages", "mcp-server", "src", "gating.ts"),
  "utf8"
);

// The wire name each side spells, read as source. Throws rather than defaulting: a renamed
// constant must fail loudly, never pass by absence.
const SERVER_HEADER = (() => {
  const m = /TOOL_PROFILE_HEADER = "([^"]+)";/.exec(HEADER_SRC);
  assert.ok(m, "tool-profile-header.ts must export TOOL_PROFILE_HEADER");
  return m[1];
})();
const DESKTOP_HEADER = (() => {
  const m = /const TOOL_PROFILE_HEADER = '([^']+)';/.exec(LOADER);
  assert.ok(m, "loader.js must define TOOL_PROFILE_HEADER as a single quoted literal");
  return m[1];
})();

// The server's shape check, compiled from its own source and run for real.
const SERVER_RE = (() => {
  const m = /const TOOL_PROFILE_RE = (\/.*\/);/.exec(HEADER_SRC);
  assert.ok(m, "tool-profile-header.ts must define TOOL_PROFILE_RE");
  return new Function(`return ${m[1]};`)();
})();

// The real stamper, with the real `normalizeProfile` injected.
const withToolProfileStamp = new Function(
  "normalizeProfile",
  `const TOOL_PROFILE_HEADER = ${JSON.stringify(DESKTOP_HEADER)};\n` +
    `${fnOf(LOADER, "withToolProfileStamp")}\n return withToolProfileStamp;`
)(normalizeProfile);

const entry = () => ({ dopl: { headers: { Authorization: "Bearer x" } } });
const stampedValue = (profile) => {
  const servers = entry();
  withToolProfileStamp(servers, profile);
  return servers.dopl.headers[DESKTOP_HEADER];
};

// ── the two sides agree on the wire ──────────────────────────────────────────

test("the desktop writes the header name the server reads", () => {
  // HTTP field names are case-insensitive; the server reads the lowercase wire form.
  assert.equal(DESKTOP_HEADER.toLowerCase(), SERVER_HEADER);
});

test("every value the desktop can stamp survives the server's shape check", () => {
  // ⚠ THE SILENT-DROP FAILURE, closed. A profile name outside the server's regex is dropped
  // with no error on either side, and the session keeps paying for the whole surface.
  for (const p of KNOWN_PROFILES) {
    assert.match(stampedValue(p), SERVER_RE, `${p} is dropped by the server's shape check`);
  }
});

test("the server's role table is the ONLY vocabulary — the reader enumerates nothing", () => {
  // ⚠ The asymmetry with X-Dopl-Runtime / X-Dopl-Vendor, which DO enumerate. A second list
  // of profile names on the server's request path would be a hand-mirror of
  // `gating.ts › TOOL_PROFILE_TOOLS` whose only possible effect is drift.
  for (const p of KNOWN_PROFILES) {
    assert.ok(
      !HEADER_SRC.includes(`"${p}"`),
      `tool-profile-header.ts hardcodes the profile name ${p} — the vocabulary belongs in gating.ts`
    );
  }
  assert.match(GATING_SRC, /TOOL_PROFILE_TOOLS = new Map<string, ReadonlySet<string>>\(\)/,
    "gating.ts must hold the role table (empty in wave A) — repoint this probe if it moved");
});

// ── it may only narrow, and it grants nothing ────────────────────────────────

test("the stamp is the profile the session is CONTAINED at, not a claim", () => {
  assert.equal(stampedValue("dopl_only"), "dopl_only");
  assert.equal(stampedValue("full"), "full");
});

test("an unresolvable profile stamps the NARROWEST one, never the widest", () => {
  // ⚠ Fail closed, matching `normalizeProfile` and the deny list built from the same read.
  // A header claiming `full` over a spawn contained at read_only would ask the server for a
  // wider offer than the machine will let the session use.
  for (const bogus of [undefined, null, "", "admin", "FULL", 7, {}]) {
    assert.equal(stampedValue(bogus), "read_only", String(bogus));
  }
});

// ── it can never break a launch ──────────────────────────────────────────────

test("no dopl entry (pre-sign-in) stamps nothing and does not throw", () => {
  // buildMcpServers returns {} with no bearer, and that spawn still has to launch.
  assert.deepEqual(withToolProfileStamp({}, "full"), {});
  assert.equal(withToolProfileStamp(null, "full"), null);
  assert.equal(withToolProfileStamp(undefined, "full"), undefined);
});

test("an entry with no headers object gains one rather than throwing", () => {
  const servers = { dopl: {} };
  withToolProfileStamp(servers, "dopl_only");
  assert.equal(servers.dopl.headers[DESKTOP_HEADER], "dopl_only");
});

// ── it is applied at the one assembly point, on the shared entry ─────────────

test("the launch spec stamps it after building the servers, beside the session stamp", () => {
  assert.match(
    SPEC,
    /loader\.withToolProfileStamp\(options\.mcpServers, s\.profile\);/,
    "buildOptions must stamp this run's profile onto the dopl entry"
  );
  orderOf(
    SPEC,
    "mcpServers: loader.buildMcpServers(",
    "loader.withToolProfileStamp(",
    "launch-spec"
  );
});

test("the SHARED builder does not stamp it — that seam is deliberate", () => {
  // ⚠ Same rule as the session stamp: `buildMcpServers` answers "what MCP server does this
  // app offer", the same answer for every spawn, and a per-run value cannot live there.
  // ⚠ The probe is the IDENTIFIER, not the wire name: that function's docblock names the
  // header on purpose (it is where the `server.tools` measurement lives), and a text grep
  // for `Tool-Profile` would fail on the explanation rather than on a stamp.
  assert.ok(
    !/TOOL_PROFILE_HEADER\]/.test(fnOf(LOADER, "buildMcpServers")),
    "buildMcpServers must not stamp a per-run value"
  );
});
