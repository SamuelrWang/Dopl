// SIGN-OUT LEAVES NO USABLE CLAUDE CREDENTIAL BEHIND (2026-07-31).
//
// THE BUG. `main/claude-token.js` holds an `sk-ant-*` Claude OAuth token, and
// BOTH spawn paths inject it as `CLAUDE_CODE_OAUTH_TOKEN`:
//   claude-resolve.spawnEnv      — the headless channel-answering spawn
//   session-auth.withStoredCredential — the session-window path
// `clearStoredOAuthToken()` existed and had ZERO callers, and signOut()'s own
// comment enumerated what it did not cover while omitting this credential
// entirely. So: sign out, hand the Mac to the next person, they sign in — and
// every agent session they run bills the FIRST operator's Anthropic account,
// against their rate limits, with nothing on screen or in the log saying so.
//
// THE DESIGN CALL, and why it is not a judgement call at all. The store has
// EXACTLY ONE writer — claude-auth.js's tier-2 flow, where Dopl itself drives
// `claude setup-token` under a pty from a Dopl dialog and captures the token the
// child prints. A `setup-token` the operator runs in their own terminal prints to
// their terminal; an interactive `claude /login` stores in the CLI's own
// keychain/credentials file, which this app never touches (session-auth reads
// MARKERS there, never a secret). So this key can only ever hold a credential
// Dopl minted, and dropping it on a Dopl sign-out is unambiguous. The one thing
// it is NOT is a revocation at Anthropic — the log line says so rather than
// implying the token is dead.
//
// Source extraction, as everywhere else here: both modules are electron-bound
// (safeStorage / electron-store), so the functions are sliced verbatim and driven
// with fakes — `require` included, since it is just another free variable.
//
// Run: `node --test dopl-desktop-app/test/signout-claude-credential.test.mjs`

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
const SESSION_AUTH = M("session-auth.js");

function asyncFnOf(src, name) {
  assert.match(src, new RegExp(`async function ${name}\\(`), `${name} must be async`);
  return `async ${fnOf(src, name)}`;
}

// ── the premise: what can this store ever hold? ──────────────────────────────

test("the ONLY writer is Dopl's own setup-token flow, so the credential is ours to clear", () => {
  // If a second writer ever appears, the "we minted it" argument above stops
  // holding and the sign-out copy has to change with it.
  const writers = [];
  for (const [name, src] of Object.entries({
    "claude-auth.js": AUTH,
    "claude-resolve.js": RESOLVE,
    "session-auth.js": SESSION_AUTH,
    "auth-state.js": STATE,
  })) {
    if (/setStoredOAuthToken\(/.test(src.replace(/const \{[^}]*\} = require\('\.\/claude-token'\);/g, "")))
      writers.push(name);
  }
  assert.deepEqual(writers, ["claude-auth.js"], "exactly one module writes the token");
  // …and it writes ONLY what our own pty child printed, never anything read off disk.
  const flow = fnOf(AUTH, "runSetupTokenFlow");
  assert.match(flow, /setStoredOAuthToken\(capturedToken\)/);
  assert.match(flow, /spawn\('script', \['-q', '\/dev\/null', bin, 'setup-token'\]/,
    "the token is captured from a child THIS APP started");
});

test("both spawn paths really do inject it, so a residue is a live billing surface", () => {
  assert.match(fnOf(RESOLVE, "spawnEnv"), /env\.CLAUDE_CODE_OAUTH_TOKEN = token;/);
  assert.match(fnOf(SESSION_AUTH, "withStoredCredential"), /env\.CLAUDE_CODE_OAUTH_TOKEN = token;/);
  // The headless path injects it UNCONDITIONALLY (no source ordering), which is why
  // "the CLI has its own sign-in too" does not make the residue harmless.
  assert.ok(
    !/credentialState|source/.test(fnOf(RESOLVE, "spawnEnv")),
    "spawnEnv injects whenever a token exists"
  );
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

function loadSignOut({ revoke = () => "revoked", claudeCleared = true, claudeThrows = false } = {}) {
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
  const claudeToken = {
    clearStoredOAuthToken: () => {
      order.push("clearStoredOAuthToken");
      if (claudeThrows) throw new Error("safeStorage exploded");
      return claudeCleared;
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
      if (id === "./claude-token") return claudeToken;
      throw new Error(`unexpected require(${id})`);
    },
    () => order.push("invalidateCookieIdentity")
  );
  return { fn, order, logged };
}

test("SIGN-OUT LEAVES NO USABLE CLAUDE CREDENTIAL — the whole point of this file", () => {
  const { fn, order } = loadSignOut({});
  return fn().then(() => {
    assert.ok(order.includes("clearStoredOAuthToken"), "the Claude token teardown ran");
    // All FOUR credentials this app can hold are dropped in one action.
    assert.deepEqual(order, [
      "revokeDeviceToken",
      "blob.clearSession",
      "invalidateCookieIdentity",
      "cookies.clearSessionCookies",
      "clearDeviceToken",
      "clearStoredOAuthToken",
    ]);
  });
});

test("the log states what was cleared AND what clearing cannot do", async () => {
  const { fn, logged } = loadSignOut({});
  await fn();
  const line = logged.join("\n");
  assert.match(line, /Claude sign-in token cleared from this Mac/);
  // Honest about the limit: we hold no way to revoke an Anthropic-side token.
  assert.match(line, /stays valid at Anthropic/i);
  assert.ok(!/revoked at Anthropic/i.test(line), "and never claims a revoke it did not perform");
});

test("a FAILED clear is shouted, naming the consequence in the operator's terms", async () => {
  const { fn, logged } = loadSignOut({ claudeCleared: false });
  await fn();
  assert.match(logged.join("\n"), /CLEAR FAILED/);
  assert.match(logged.join("\n"), /would run agents on YOUR Anthropic account/);
});

test("a THROWING clear cannot break the sign-out", async () => {
  const { fn, order, logged } = loadSignOut({ claudeThrows: true });
  assert.equal(await fn(), true, "sign-out still succeeds");
  assert.ok(order.includes("clearDeviceToken"), "the earlier teardown still happened");
  assert.match(logged.join("\n"), /claude-token teardown failed/);
});

test("the reasoning is recorded where the next reader will look", () => {
  const prose = (STATE + TOKEN).replace(/\n\/\/ ?/g, " ");
  assert.match(prose, /ZERO callers/, "why this was missed");
  assert.match(prose, /CLAUDE_CODE_OAUTH_TOKEN/, "what the residue is used for");
  assert.match(prose, /one writer|ONE writer|only writer|ONLY writer/,
    "the argument that makes clearing it unambiguous");
});
