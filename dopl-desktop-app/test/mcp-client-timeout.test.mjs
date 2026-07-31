// THE PER-SERVER MCP `timeout` — the ARITHMETIC, not the literal (2026-07-31).
//
// THE BUG THIS LOCKS OUT. `main/mcp-config.js` and `main/sdk-loader.js` each
// hardcoded `280_000`, and both comments justified it against "the 215s hold".
// 215s is the DEFAULT hold (`AWAIT_HOLD_DEFAULT_MS`), which is not the number a
// client has to survive: a caller may pass `timeout_ms` explicitly and reach
// `AWAIT_HOLD_CAP_MS` = 230s. 280 − 230 = 50s of headroom, UNDER this repo's own
// `AWAIT_HOLD_MARGIN_MS` = 60s — the very margin the server package computes its
// own numbers against. Nothing anywhere pinned the relation, so the desktop's
// client abort could be moved under a reachable hold by editing either file, or
// by raising the cap on the server, with a fully green suite.
//
// So this file asserts the RELATION against the server's own constants, read out
// of `packages/mcp-server/src/tools/channel-await-budget.ts` as source. Move the
// cap or the margin and this fails, which is the point — a literal-for-literal
// test would have passed through the whole regression.
//
// Run: `node --test dopl-desktop-app/test/mcp-client-timeout.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const CONFIG = M("mcp-config.js");
const LOADER = M("sdk-loader.js");

const BUDGET = readFileSync(
  join(HERE, "..", "..", "packages", "mcp-server", "src", "tools", "channel-await-budget.ts"),
  "utf8"
);

// A named `export const X = <number>;` out of the budget module. Throws rather
// than defaulting: a renamed constant must fail loudly, not silently pass.
function budgetConst(name) {
  const m = new RegExp(`export const ${name} = ([\\d_]+);`).exec(BUDGET);
  assert.ok(m, `channel-await-budget.ts must export ${name}`);
  return Number(m[1].replace(/_/g, ""));
}

const AWAIT_HOLD_CAP_MS = budgetConst("AWAIT_HOLD_CAP_MS");
const AWAIT_HOLD_DEFAULT_MS = budgetConst("AWAIT_HOLD_DEFAULT_MS");
const AWAIT_HOLD_MARGIN_MS = budgetConst("AWAIT_HOLD_MARGIN_MS");
const MCP_ROUTE_MAX_DURATION_MS = budgetConst("MCP_ROUTE_MAX_DURATION_MS");

const CLIENT_TIMEOUT_MS = (() => {
  const m = /MCP_CLIENT_TIMEOUT_MS = ([\d_]+);/.exec(CONFIG);
  assert.ok(m, "mcp-config.js must define MCP_CLIENT_TIMEOUT_MS");
  return Number(m[1].replace(/_/g, ""));
})();

// ── the relation ─────────────────────────────────────────────────────────────

test("the client timeout covers the LONGEST REACHABLE hold plus the route's own margin", () => {
  // THE INVARIANT. Not "280 > 215" — that comparison is what shipped, and it was
  // measured against a hold no caller has to ask for.
  assert.ok(
    AWAIT_HOLD_CAP_MS + AWAIT_HOLD_MARGIN_MS <= CLIENT_TIMEOUT_MS,
    `cap ${AWAIT_HOLD_CAP_MS} + margin ${AWAIT_HOLD_MARGIN_MS} must fit inside the ` +
      `client timeout ${CLIENT_TIMEOUT_MS} — move the cap and fix this number, not this test`
  );
});

test("the DEFAULT hold is the weaker bound, and is not what the number is derived from", () => {
  // Kept as a regression note: the old 280_000 satisfied this and failed the one above.
  assert.ok(AWAIT_HOLD_DEFAULT_MS < AWAIT_HOLD_CAP_MS, "the default is below the cap by design");
  assert.ok(
    AWAIT_HOLD_DEFAULT_MS + AWAIT_HOLD_MARGIN_MS <= CLIENT_TIMEOUT_MS,
    "…so satisfying the cap satisfies the default automatically"
  );
  assert.ok(
    280_000 < AWAIT_HOLD_CAP_MS + AWAIT_HOLD_MARGIN_MS,
    "the shipped-and-wrong value must stay outside the invariant, or this test proves nothing"
  );
});

test("it never exceeds the platform ceiling the whole op runs inside", () => {
  // Waiting past the point the function is killed buys nothing: the client would
  // sit on a connection the platform has already torn down.
  assert.ok(
    CLIENT_TIMEOUT_MS <= MCP_ROUTE_MAX_DURATION_MS,
    `client timeout ${CLIENT_TIMEOUT_MS} must not outlast /api/mcp's maxDuration ${MCP_ROUTE_MAX_DURATION_MS}`
  );
});

test("it clears the client's own 60s floor, or setting the key changes nothing", () => {
  // VERSION-QUALIFIED: Claude Code 2.1.220 (bundled by @anthropic-ai/claude-agent-sdk
  // 0.3.220) computes the HTTP abort as
  // min(max(timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647). The key can
  // only RAISE the abort; a value under 60s is silently discarded.
  assert.ok(CLIENT_TIMEOUT_MS > 60_000);
  assert.ok(CLIENT_TIMEOUT_MS < 2_147_483_647, "…and inside the binary's own clamp");
});

// ── ONE definition ───────────────────────────────────────────────────────────

test("both entries this app owns read the SAME constant — no second literal", () => {
  // The spawn-config file (CLI path) and sdk-loader's in-memory server (session
  // path) are the same client talking to the same endpoint. They drifted because
  // each restated the number.
  assert.match(CONFIG, /timeout: MCP_CLIENT_TIMEOUT_MS,/);
  assert.match(CONFIG, /MCP_CLIENT_TIMEOUT_MS, \/\/ Q9/, "exported for sdk-loader");
  assert.match(LOADER, /timeout: clientTimeoutMs\(\),/);
  assert.match(
    fnOf(LOADER, "clientTimeoutMs"),
    /require\('\.\/mcp-config'\)\.MCP_CLIENT_TIMEOUT_MS/,
    "sdk-loader imports it from mcp-config rather than restating it"
  );
  assert.ok(
    !/\b280_000\b/.test(CONFIG + LOADER),
    "the old literal must not survive anywhere in either module"
  );
});

test("the comments that justify the number are TRUE and version-qualified", () => {
  const prose = (CONFIG + LOADER).replace(/\n\s*\/\/ ?/g, " ");
  assert.match(prose, /2\.1\.220/, "the honouring of `timeout` is a per-version fact");
  assert.match(prose, /can only RAISE/i, "nuance 1: the 60s floor cannot be lowered");
  assert.match(prose, /hard tool-call ceiling/i, "nuance 2: it also lowers the tool-call ceiling");
  assert.ok(
    !/clears the 215s hold/.test(prose),
    "the old justification (against the DEFAULT hold) must be gone, not just outvoted"
  );
});
