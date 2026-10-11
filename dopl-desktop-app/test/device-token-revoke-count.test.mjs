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
// test/device-token-revoke.test.mjs; this file is only about the VERDICT. The revoke is the REAL
// module over fakes (`_device-token-harness.mjs`); `auth-state.signOut` is still source-sliced.
//
// Run: `node --test dopl-desktop-app/test/device-token-revoke-count.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";
import { deviceTokenWorld } from "./_device-token-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const STATE = M("auth-state.js");

function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// The REAL revoke (`main/mcp-device-token-lifecycle.js`, via `_device-token-harness.mjs`).
function loadRevoke(fetch) {
  const world = deviceTokenWorld({
    record: { token: "dopl_at_x", expiresAt: 0, label: "Dopl Desktop CLI (Minted-Host)" },
    fetch,
  });
  assert.equal(typeof world.lifecycle.revokeDeviceToken, "function", "revokeDeviceToken must be exported");
  return { fn: world.lifecycle.revokeDeviceToken, logged: world.calls.diags };
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
  assert.match(line, /Settings > Devices/, "…and how to finish the job by hand");
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
  assert.match(line, /Settings > Devices/);
  assert.ok(!/\+ revoked server-side/.test(line), "the old bug: success claimed for a no-op");
});

// ── the count is read from the body, not assumed ────────────────────────────

test("revokeDeviceToken reads the revoked count off the response body", async () => {
  // The verdict must follow the BODY, not the status: the same 200 answers three ways.
  assert.equal(await loadRevoke(answers(0)).fn(), "no-match", "a numeric 0 is read");
  const { fn, logged } = loadRevoke(answers(3));
  assert.equal(await fn(), "revoked");
  assert.match(logged.join("\n"), /revoked server-side \(3\)/, "the number itself is read, not assumed");
  const notNumber = loadRevoke(answers("0"));
  assert.equal(await notNumber.fn(), "revoked", "only a NUMBER counts — a string is a missing count");
  assert.match(notNumber.logged.join("\n"), /count not reported/);
});
