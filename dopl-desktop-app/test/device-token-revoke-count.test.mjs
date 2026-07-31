// A 0-ROW REVOKE IS NOT A REVOCATION (2026-07-31).
//
// THE BUG. `mcp-config.revokeDeviceToken()` returned 'revoked' on any `res.ok`
// and never read the body. `DELETE /api/auth/mcp-device-token` is IDEMPOTENT BY
// DESIGN — an unknown label is a quiet `200 {ok:true, revoked:0}` — so a DELETE
// that matched nothing was indistinguishable from one that killed a live
// credential, and sign-out printed "+ revoked server-side" over a 90-day
// `dopl.read`+`dopl.write` bearer that was still valid.
//
// It is not a corner case. `revokeDeviceToken` selects with
// `rec.label || deviceLabel()`, and the label is only PERSISTED with the token as
// of this round — so every already-installed machine carries a label-less record
// until its next 90-day re-mint and falls back to a RECOMPUTED `os.hostname()`,
// which drifts on macOS (Bonjour renames, "Foo" vs "Foo.local"). Those machines
// match zero rows on every sign-out.
//
// THE FIX, and its one deliberate limit: the count is parsed and 0 reports
// 'no-match'. A 200 whose body carries no readable count is NOT downgraded — the
// request provably reached the route (it only 200s after `revokeDeviceTokens`
// returns) and manufacturing a failure would be its own false claim — but the log
// names the missing count so the ambiguity is visible rather than silent.
//
// The complementary contract (ordering, bounding, the label we present) lives in
// test/device-token-revoke.test.mjs; this file is only about the VERDICT.
//
// Run: `node --test dopl-desktop-app/test/device-token-revoke-count.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const MCP = M("mcp-config.js");
const STATE = M("auth-state.js");

const TOKEN_PATH = "/api/auth/mcp-device-token";
const FAST_TIMEOUT = 20;

function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

function loadRevoke(fetch) {
  const logged = [];
  const src = [
    fnOf(MCP, "deviceLabel"),
    fnOf(MCP, "withTimeout"),
    asyncFnOf(MCP, "revokeDeviceToken"),
  ].join("\n");
  const fn = new Function(
    "apiFetch", "loadDeviceToken", "diag", "MCP_DEVICE_TOKEN_PATH", "REVOKE_TIMEOUT_MS", "require",
    `${src}\n return revokeDeviceToken;`
  )(
    fetch,
    () => ({ token: "dopl_at_x", expiresAt: 0, label: "Dopl Desktop CLI (Minted-Host)" }),
    (...a) => logged.push(a.join(" ")),
    TOKEN_PATH,
    FAST_TIMEOUT,
    (id) => {
      if (id === "os") return { hostname: () => "This-Host" };
      throw new Error(`unexpected require(${id})`);
    }
  );
  return { fn, logged };
}

// The exact shape the route returns (src/app/api/auth/mcp-device-token/route.ts).
const answers = (revoked) => async () => ({ ok: true, status: 200, json: async () => ({ ok: true, revoked }) });

// ── the verdict ─────────────────────────────────────────────────────────────

test("revoked: 0 is NOT a revocation — it reports 'no-match'", async () => {
  const { fn, logged } = loadRevoke(answers(0));
  assert.equal(await fn(), "no-match", "the whole bug: this used to be 'revoked'");
  const line = logged.join("\n");
  assert.match(line, /matched NO token/i, "the log says what actually happened");
  assert.match(line, /STILL VALID/i, "…and what is left behind");
  assert.match(line, /Connected apps/, "…and how to finish the job by hand");
  assert.ok(!/revoked server-side/.test(line), "never the success wording");
});

test("revoked: 1 (or more) is the real thing, and the count is logged", async () => {
  for (const n of [1, 2]) {
    const { fn, logged } = loadRevoke(answers(n));
    assert.equal(await fn(), "revoked");
    assert.match(logged.join("\n"), new RegExp(`revoked server-side \\(${n}\\)`));
  }
});

test("a 200 with no readable count still counts as landed, and SAYS the count is missing", async () => {
  // Our own route always returns the count; anything else is a proxy or a future
  // shape. The request reached a 200, so 'failed' would be its own false claim —
  // but the ambiguity is never hidden.
  const shapes = [
    async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }),
    async () => ({ ok: true, status: 200 }), // no json() at all
  ];
  for (const fetch of shapes) {
    const { fn, logged } = loadRevoke(fetch);
    assert.equal(await fn(), "revoked");
    assert.match(logged.join("\n"), /count not reported/);
  }
});

test("a non-200 is still 'failed' — the count check did not swallow the old paths", async () => {
  for (const status of [400, 401, 404, 500]) {
    const { fn } = loadRevoke(async () => ({ ok: false, status }));
    assert.equal(await fn(), "failed");
  }
});

// ── the local teardown happens regardless of the verdict ────────────────────

test("EVERY verdict still tears down locally — a verdict must never gate the cleanup", async () => {
  const order = [];
  const run = (revoke) => {
    const mcp = {
      revokeDeviceToken: async () => revoke,
      clearDeviceToken: () => {
        order.push(`clearDeviceToken:${revoke}`);
        return true;
      },
    };
    const fn = new Function(
      "blob", "cookies", "diag", "require", "invalidateCookieIdentity",
      `${asyncFnOf(STATE, "signOut")}\n return signOut;`
    )(
      { clearSession: () => {} },
      { clearSessionCookies: async () => true },
      () => {},
      (id) => {
        if (id === "./mcp-config") return mcp;
        if (id === "./claude-token") return { clearStoredOAuthToken: () => true };
        throw new Error(`unexpected require(${id})`);
      },
      () => {}
    );
    return fn();
  };
  for (const verdict of ["revoked", "no-match", "none", "failed"]) await run(verdict);
  assert.deepEqual(order, [
    "clearDeviceToken:revoked",
    "clearDeviceToken:no-match",
    "clearDeviceToken:none",
    "clearDeviceToken:failed",
  ]);
});

test("signOut gives 'no-match' its OWN words — it must not read as a completed revoke", async () => {
  const logged = [];
  const fn = new Function(
    "blob", "cookies", "diag", "require", "invalidateCookieIdentity",
    `${asyncFnOf(STATE, "signOut")}\n return signOut;`
  )(
    { clearSession: () => {} },
    { clearSessionCookies: async () => true },
    (...a) => logged.push(a.join(" ")),
    (id) => {
      if (id === "./mcp-config")
        return { revokeDeviceToken: async () => "no-match", clearDeviceToken: () => true };
      if (id === "./claude-token") return { clearStoredOAuthToken: () => true };
      throw new Error(`unexpected require(${id})`);
    },
    () => {}
  );
  await fn();
  const line = logged.join("\n");
  assert.match(line, /NOT revoked/, "stated plainly");
  assert.match(line, /matched no token for this machine's label/i, "…with the reason");
  assert.match(line, /STILL VALID/i);
  assert.match(line, /Connected apps/);
  assert.ok(!/\+ revoked server-side/.test(line), "the old bug: success claimed for a no-op");
});

// ── the reason the label misses in the first place, recorded ────────────────

test("the source names WHY a label can miss, so the next reader does not re-derive it", () => {
  const prose = MCP.replace(/\n\/\/ ?/g, " ");
  assert.match(prose, /idempotent/i);
  assert.match(prose, /only\s+PERSISTED as of this round/i, "already-installed machines have no label");
  assert.match(prose, /hostname/i, "…and the fallback drifts");
  assert.match(fnOf(MCP, "revokeDeviceToken"), /data\.revoked === 'number'/, "the count is really read");
});
