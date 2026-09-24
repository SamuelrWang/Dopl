// SIGN-OUT LEAVES NO USABLE AGENT-RUNTIME CREDENTIAL BEHIND.
//
// An agent session runs on Dopl's OWN credential for its runtime and nothing else: the Claude token
// `claude-token.js` holds (set as `CLAUDE_CODE_OAUTH_TOKEN` by `runtime/claude/credential.js ›
// withCredential`) and the Codex `auth.json` in the private CODEX_HOME. Left behind by a sign-out, the
// NEXT operator on this Mac runs every agent on the FIRST operator's account (the 2026-07-31 bug).
//
// Each store has exactly one writer — Dopl's own sign-in, from a child this app started — so it never
// holds a login the operator made outside Dopl, and dropping it on a Dopl sign-out is unambiguous. What it
// is NOT is a revocation at the vendor, and the log line says so.
//
// Source extraction, as everywhere else here: the modules are electron-bound (safeStorage /
// electron-store), so the functions are sliced verbatim and driven with fakes.
//
// Run: `node --test dopl-desktop-app/test/signout-runtime-credentials.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const STATE = M("auth-state.js");
const TOKEN = M("claude-token.js");
const AUTH = M("claude-auth.js");
const RESOLVE = M("claude-resolve.js");
const CLAUDE_CREDENTIAL = M("runtime/claude/credential.js");
const CODEX_LOGIN = M("runtime/codex/login.js");

function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// ── the premise: what can this store ever hold? ──────────────────────────────

test("each store's ONLY writer is Dopl's own sign-in, so the credential is ours to clear", () => {
  // A second writer would break the "we minted it" argument, and the sign-out copy with it.
  const writers = [];
  for (const [name, src] of Object.entries({
    "claude-auth.js": AUTH,
    "claude-resolve.js": RESOLVE,
    "runtime/claude/credential.js": CLAUDE_CREDENTIAL,
    "auth-state.js": STATE,
  })) {
    if (/setStoredOAuthToken\(/.test(src.replace(/const \{[^}]*\} = require\('\.\/claude-token'\);/g, "")))
      writers.push(name);
  }
  assert.deepEqual(writers, ["claude-auth.js"], "exactly one module writes the Claude token");
  const flow = fnOf(AUTH, "runSetupTokenFlow");
  assert.match(flow, /finish\(setStoredOAuthToken\(token\)\)/, "…only the token its own child printed");
  assert.match(flow, /spawn\('script', \['-q', '\/dev\/null', bin, 'setup-token'\]/,
    "the token is captured from a child THIS APP started");
  assert.match(CODEX_LOGIN, /configHome\.installAuth\(/, "the Codex auth.json is installed only by Dopl's login");
});

test("a session spawn carries Dopl's token whenever one is stored, so a residue is a live billing surface", () => {
  const fn = fnOf(CLAUDE_CREDENTIAL, "withCredential");
  assert.match(fn, /if \(token\) env\[TOKEN_ENV\] = token;/, "unconditional on any other source");
  assert.equal(/function spawnEnv\s*\(/.test(RESOLVE), false,
    "the headless env builder is deleted — a revival needs a lane, and there is none");
});

// ── the teardown ────────────────────────────────────────────────────────────

function loadClear({ encrypted = null, plain = null, throws = false } = {}) {
  const bag = { [KEY]: encrypted, [KEY_PLAIN]: plain };
  const store = {
    get: (k) => bag[k],
    delete: (k) => {
      if (throws) throw new Error("store is read-only");
      delete bag[k];
    },
  };
  const src = [fnOf(TOKEN, "getStoredOAuthToken"), fnOf(TOKEN, "clearStoredOAuthToken")].join("\n");
  const api = new Function(
    "store", "safeStorage", "Buffer", "KEY", "KEY_PLAIN",
    `${src}\n return { clearStoredOAuthToken, getStoredOAuthToken };`
  )(store, { isEncryptionAvailable: () => true, decryptString: (b) => b.toString("utf8") }, Buffer, KEY, KEY_PLAIN);
  return { ...api, bag };
}
const KEY = "claudeOAuthToken";
const KEY_PLAIN = "claudeOAuthTokenPlain";

test("clearStoredOAuthToken removes BOTH shapes and reports that nothing usable is left", () => {
  const h = loadClear({ encrypted: Buffer.from("sk-ant-secret").toString("base64") });
  assert.equal(h.getStoredOAuthToken(), "sk-ant-secret", "precondition: a usable credential");
  assert.equal(h.clearStoredOAuthToken(), true);
  assert.equal(h.getStoredOAuthToken(), null, "no credential survives the clear");
  assert.equal(h.bag[KEY], undefined);
  assert.equal(h.bag[KEY_PLAIN], undefined);
});

test("the no-keychain PLAINTEXT fallback is cleared too — it is the worse residue", () => {
  const h = loadClear({ plain: "sk-ant-plaintext" });
  assert.equal(h.getStoredOAuthToken(), "sk-ant-plaintext");
  assert.equal(h.clearStoredOAuthToken(), true);
  assert.equal(h.getStoredOAuthToken(), null);
});

test("a store that refuses the delete reports FALSE — never a silent success", () => {
  const h = loadClear({ encrypted: Buffer.from("sk-ant-secret").toString("base64"), throws: true });
  assert.equal(h.clearStoredOAuthToken(), false);
  assert.equal(h.getStoredOAuthToken(), "sk-ant-secret", "and the credential is provably still there");
});

// ── signOut wires it, and says what it did ──────────────────────────────────

function loadSignOut({ revoke = () => "revoked", cleared = true, throws = false } = {}) {
  const order = [];
  const logged = [];
  const blob = { clearSession: () => order.push("blob.clearSession") };
  const cookies = {
    clearSessionCookies: async () => {
      order.push("cookies.clearSessionCookies");
      return true;
    },
  };
  const mcp = {
    revokeDeviceToken: async () => {
      order.push("revokeDeviceToken");
      return revoke();
    },
    clearDeviceToken: () => {
      order.push("clearDeviceToken");
      return true;
    },
  };
  const credentials = {
    signOutAll: async () => {
      order.push("signOutAll");
      if (throws) throw new Error("safeStorage exploded");
      return cleared;
    },
  };
  const fn = new Function(
    "blob", "cookies", "diag", "require", "invalidateCookieIdentity",
    `${asyncFnOf(STATE, "signOut")}\n return signOut;`
  )(
    blob,
    cookies,
    (...a) => logged.push(a.join(" ")),
    (id) => {
      if (id === "./mcp-config") return mcp;
      if (id === "./runtime-credentials") return credentials;
      throw new Error(`unexpected require(${id})`);
    },
    () => order.push("invalidateCookieIdentity")
  );
  return { fn, order, logged };
}

test("SIGN-OUT LEAVES NO USABLE RUNTIME CREDENTIAL — the whole point of this file", async () => {
  const { fn, order } = loadSignOut({});
  await fn();
  // Every credential this app can hold is dropped in one action, the runtimes' last.
  assert.deepEqual(order, [
    "revokeDeviceToken",
    "blob.clearSession",
    "invalidateCookieIdentity",
    "cookies.clearSessionCookies",
    "clearDeviceToken",
    "signOutAll",
  ]);
});

test("the log states what was cleared AND what clearing cannot do", async () => {
  const { fn, logged } = loadSignOut({});
  await fn();
  const line = logged.join("\n");
  assert.match(line, /agent-runtime sign-ins cleared from this Mac/);
  assert.match(line, /stays valid at its vendor/i, "honest about the limit: nothing is revoked vendor-side");
  assert.ok(!/revoked at/i.test(line), "and never claims a revoke it did not perform");
});

test("a FAILED clear is shouted, naming the consequence in the operator's terms", async () => {
  const { fn, logged } = loadSignOut({ cleared: false });
  await fn();
  assert.match(logged.join("\n"), /CLEAR FAILED/);
  assert.match(logged.join("\n"), /would run agents on YOUR account/);
});

test("a THROWING clear cannot break the sign-out", async () => {
  const { fn, order, logged } = loadSignOut({ throws: true });
  assert.equal(await fn(), true, "sign-out still succeeds");
  assert.ok(order.includes("clearDeviceToken"), "the earlier teardown still happened");
  assert.match(logged.join("\n"), /runtime sign-in teardown failed/);
});
