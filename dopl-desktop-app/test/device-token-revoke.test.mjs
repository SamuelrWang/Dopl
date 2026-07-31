// F-085 — SIGN-OUT REVOKES THE DEVICE TOKEN SERVER-SIDE.
//
// THE BUG THIS LOCKS OUT. Q5's S2 fix taught signOut() to delete the app's copies of the
// 90-day `dopl.read`+`dopl.write` MCP device token (electron-store + userData/mcp-spawn.json).
// That is not revocation. `/api/auth/mcp-device-token` was MINT-ONLY, and issueDeviceToken
// revokes prior tokens only for the same label on the NEXT mint — so the credential stayed
// valid for up to 90 days after sign-out, and anything that had ALREADY read it (a backup, an
// earlier `claude mcp add`, a process with read access to the app's data dir) kept full API
// access to the account that had just signed out. The only cure was for the operator to find
// it in the web "Connected apps" list.
//
// The fix has two halves and BOTH are pinned here:
//   1. mcp-config.revokeDeviceToken() calls DELETE /api/auth/mcp-device-token with the label
//      this machine actually MINTED under, bounded so a dead network cannot hold a click.
//   2. auth-state.signOut() calls it FIRST — the route is sessionOnly, so it authenticates on
//      the very cookie jar sign-out is about to clear — and then tears down locally REGARDLESS
//      of the result. A sign-out a bad network can block would be worse than a residual token.
//
// WHY SOURCE EXTRACTION: both modules are electron-bound (app.getPath / safeStorage /
// electron-store), so they cannot be imported under `node --test`. The functions are sliced
// verbatim and driven with fakes — including `require`, which is just another free variable —
// so the test stays honest to what ships.
//
// Run: `node --test dopl-desktop-app/test/device-token-revoke.test.mjs`

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
const FAST_TIMEOUT = 20; // ms — the shipped constant, injected small so the bound is testable

// fnOf slices from the `function` keyword, so an `async function` loses its modifier and the
// extracted body no longer parses. Re-attach it — and assert the shipped function really is
// async, so this can never quietly turn a sync function into an async one.
function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// ── the revoke call itself ──────────────────────────────────────────────────

function loadRevoke({ token = "dopl_at_x", label = "Dopl Desktop CLI (Minted-Host)", fetch }) {
  const calls = { fetches: [], logged: [] };
  const apiFetch = (path, opts) => {
    calls.fetches.push({ path, opts });
    return fetch(path, opts);
  };
  const loadDeviceToken = () => (token ? { token, expiresAt: 0, ...(label ? { label } : {}) } : null);
  const diag = (...a) => calls.logged.push(a.join(" "));
  const src = [
    fnOf(MCP, "deviceLabel"),
    fnOf(MCP, "withTimeout"),
    asyncFnOf(MCP, "revokeDeviceToken"),
  ].join("\n");
  const fn = new Function(
    "apiFetch", "loadDeviceToken", "diag", "MCP_DEVICE_TOKEN_PATH", "REVOKE_TIMEOUT_MS", "require",
    `${src}\n return revokeDeviceToken;`
  )(apiFetch, loadDeviceToken, diag, TOKEN_PATH, FAST_TIMEOUT, (id) => {
    if (id === "os") return { hostname: () => "This-Host" };
    throw new Error(`unexpected require(${id})`);
  });
  return { fn, calls };
}

const ok = async () => ({ ok: true, status: 200 });

test("the revoke is a DELETE to the device-token route carrying the label", async () => {
  const { fn, calls } = loadRevoke({ fetch: ok });
  assert.equal(await fn(), "revoked");
  assert.equal(calls.fetches.length, 1);
  const { path, opts } = calls.fetches[0];
  assert.equal(path, TOKEN_PATH);
  assert.equal(opts.method, "DELETE", "destructive op, modelled like every other one in the API");
  assert.deepEqual(opts.body, { label: "Dopl Desktop CLI (Minted-Host)" });
  assert.equal(opts.noStore, true, "a credential response must never be cached");
});

test("the label is the one we MINTED under, not the one this machine computes today", async () => {
  // Rename the Mac and a recomputed label would revoke a row that never existed while the
  // real token stayed live. The stored record is the source of truth.
  const { fn, calls } = loadRevoke({ label: "Dopl Desktop CLI (Old-Name)", fetch: ok });
  await fn();
  assert.deepEqual(calls.fetches[0].opts.body, { label: "Dopl Desktop CLI (Old-Name)" });
});

test("a record from a build that predates the stored label falls back to this host's label", async () => {
  const { fn, calls } = loadRevoke({ label: null, fetch: ok });
  await fn();
  assert.deepEqual(calls.fetches[0].opts.body, { label: "Dopl Desktop CLI (This-Host)" });
});

test("the mint and the revoke derive their label from ONE function", () => {
  // If the two ever drift, the revoke silently no-ops and the bug is back with a green suite.
  assert.match(fnOf(MCP, "obtainDeviceToken"), /const label = deviceLabel\(\);/);
  assert.match(fnOf(MCP, "obtainDeviceToken"), /body: \{ label \},/);
  assert.match(fnOf(MCP, "obtainDeviceToken"), /expiresAt: parseExpiry\(data\.expiresAt\), label \}/,
    "…and the label is persisted with the token, or the revoke cannot know it");
  assert.ok(!/hostname\(\)/.test(fnOf(MCP, "obtainDeviceToken")), "no second, inline label recipe");
});

test("FIX M4: no cached token reports 'none', never a revoke we did not perform", async () => {
  // "We hold no copy" is not "the credential is dead" — the local copies may have been
  // cleared by an earlier sign-out whose revoke failed while the 90-day row stayed live.
  // And the label, the only selector, lives in the record we just failed to find, so a
  // guessed label would 200 having revoked nothing. Report it; do not claim it.
  const { fn, calls } = loadRevoke({ token: null, fetch: ok });
  assert.equal(await fn(), "none");
  assert.equal(calls.fetches.length, 0, "and nothing is asked of the server blind");
  assert.match(calls.logged.join("\n"), /nothing to revoke/);
});

// ── it can never hold the click ─────────────────────────────────────────────

test("a hung request is bounded, and the residual is named in the log", async () => {
  const started = Date.now();
  const { fn, calls } = loadRevoke({ fetch: () => new Promise(() => {}) }); // never settles
  assert.equal(await fn(), "failed");
  assert.ok(Date.now() - started < 1_000, "the outer bound fired, not some 15s network timeout");
  assert.match(calls.logged.join("\n"), /TIMED OUT/);
  assert.match(calls.logged.join("\n"), /stays valid server-side/, "the operator is told what is left");
});

test("the outer bound covers getAuthCookie too, not just the fetch", () => {
  // apiFetch awaits auth.getAuthCookie() BEFORE its AbortController starts, and that call can
  // await a token refresh. Without the race, an offline refresh would hang the whole sign-out.
  const fn = fnOf(MCP, "revokeDeviceToken");
  assert.match(fn, /withTimeout\(/, "the whole call is raced, not only the request");
  assert.match(fn, /timeoutMs: REVOKE_TIMEOUT_MS/, "…and the request keeps its own abort too");
  assert.match(MCP, /REVOKE_TIMEOUT_MS = 3_000/, "a click-sized bound, not a network-sized one");
});

test("a 5xx / 401 / 404 is a clean 'failed', never a throw", async () => {
  for (const status of [401, 404, 500]) {
    const { fn, calls } = loadRevoke({ fetch: async () => ({ ok: false, status }) });
    assert.equal(await fn(), "failed");
    assert.match(calls.logged.join("\n"), /revoke failed/);
  }
});

test("a rejected request (offline) is a clean 'failed', never a throw", async () => {
  const { fn, calls } = loadRevoke({ fetch: async () => { throw new Error("ENOTFOUND"); } });
  assert.equal(await fn(), "failed");
  assert.match(calls.logged.join("\n"), /revoke error/);
  assert.match(calls.logged.join("\n"), /Connected apps/, "…and how to finish the job by hand");
});

// ── signOut wires it in the only order that can work ────────────────────────

function loadSignOut({ revoke, clear = () => true }) {
  const order = [];
  const blob = { clearSession: () => order.push("blob.clearSession") };
  const cookies = {
    clearSessionCookies: async () => {
      order.push("cookies.clearSessionCookies");
      return true;
    },
  };
  const invalidateCookieIdentity = () => order.push("invalidateCookieIdentity");
  const mod = {
    revokeDeviceToken: async () => {
      order.push("revokeDeviceToken");
      return revoke();
    },
    clearDeviceToken: () => {
      order.push("clearDeviceToken");
      return clear();
    },
  };
  const logged = [];
  const fn = new Function(
    "blob", "cookies", "diag", "require", "invalidateCookieIdentity",
    `${asyncFnOf(STATE, "signOut")}\n return signOut;`
  )(blob, cookies, (...a) => logged.push(a.join(" ")), (id) => {
    if (id === "./mcp-config") return mod;
    throw new Error(`unexpected require(${id})`);
  }, invalidateCookieIdentity);
  return { fn, order, logged };
}

test("signOut revokes BEFORE it clears anything local", async () => {
  // The route is sessionOnly: it authenticates on the cookie jar this function is about to
  // clear. Revoking after the teardown would 401 every time — a revoke that never lands.
  const { fn, order } = loadSignOut({ revoke: () => "revoked" });
  assert.equal(await fn(), true);
  assert.deepEqual(order, [
    "revokeDeviceToken",
    "blob.clearSession",
    "invalidateCookieIdentity",
    "cookies.clearSessionCookies",
    "clearDeviceToken",
  ]);
});

test("a FAILED revoke still tears down locally — the network cannot block a sign-out", async () => {
  const { fn, order, logged } = loadSignOut({ revoke: () => "failed" });
  assert.equal(await fn(), true, "sign-out still succeeds");
  assert.deepEqual(order.slice(1), [
    "blob.clearSession",
    "invalidateCookieIdentity",
    "cookies.clearSessionCookies",
    "clearDeviceToken",
  ]);
  assert.match(logged.join("\n"), /NOT revoked server-side/, "and the residual is stated, not hidden");
});

test("a THROWN revoke is caught, and sign-out completes anyway", async () => {
  const { fn, order, logged } = loadSignOut({
    revoke: () => { throw new Error("boom"); },
  });
  assert.equal(await fn(), true);
  assert.ok(order.includes("clearDeviceToken"), "the local teardown is unconditional");
  assert.match(logged.join("\n"), /revoke failed/);
});

test("a successful revoke says so, so the log distinguishes the end states", async () => {
  const { fn, logged } = loadSignOut({ revoke: () => "revoked" });
  await fn();
  assert.match(logged.join("\n"), /\+ revoked server-side/);
  assert.ok(!/NOT revoked/.test(logged.join("\n")));
  assert.ok(!/no local token/.test(logged.join("\n")));
});

test("FIX M4: 'none' gets its OWN line — it never reads as a completed revoke", async () => {
  const { fn, logged } = loadSignOut({ revoke: () => "none" });
  await fn();
  const line = logged.join("\n");
  assert.match(line, /no local token to revoke/);
  assert.match(line, /nothing was revoked server-side/, "stated plainly, not implied");
  assert.match(line, /Connected apps/, "…with the way to finish the job by hand");
  assert.ok(!/\+ revoked server-side/.test(line), "the old bug: success claimed for a no-op");
});

test("FIX M4: a THROWN revoke is reported as failed, not as 'none'", async () => {
  // A throw is the one case where the DELETE may have been sent and its answer lost.
  // Over-warning is the safe direction.
  const { fn, logged } = loadSignOut({ revoke: () => { throw new Error("boom"); } });
  await fn();
  assert.match(logged.join("\n"), /NOT revoked server-side/);
});

// ── the residual we deliberately did NOT touch ──────────────────────────────

test("the CLI's own user-scope entry is left alone, ON PURPOSE, and it says why", () => {
  // ensureMcpConfig only ADDS that entry when it was confirmed absent, so an entry that exists
  // may be one the operator wrote with their own credential — indistinguishable from ours from
  // outside. After a successful revoke its bearer is dead anyway (401), and the next sign-in
  // refreshes it. Deleting a hand-made global config entry would be the worse failure.
  const prose = MCP.replace(/\n\/\/ ?/g, " ");
  assert.match(prose, /F-085/, "the residual stays tracked");
  assert.match(prose, /cannot tell the two apart from outside/i);
  assert.ok(
    !/removeMcpEntry/.test(fnOf(MCP, "clearDeviceToken") + fnOf(STATE, "signOut")),
    "no sign-out path spawns the CLI child process"
  );
});
