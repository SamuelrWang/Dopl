// The SPA avatar proxy — `dopl:avatar` and the policy behind it.
//
// The packaged renderer's CSP cannot name the OAuth avatar CDNs, so main
// fetches them and answers a `data:` URI. That makes an IPC handler the
// renderer calls with an ARBITRARY string into a fetch primitive, so the whole
// safety story is (a) the destination allowlist, (b) the bounded answer, and
// (c) the sender binding — this file pins all three.
//
// SOURCE EXTRACTION, the way test/ui-bridge-guards.test.mjs and
// test/avatar-cache.test.mjs do it: the AVATAR-POLICY-PURE block references
// only Node globals, so it is sliced and driven directly. The delegation to
// avatar-cache (the caching + size story, already pinned in
// avatar-cache.test.mjs) is asserted against the module source, so this file
// needs no electron and no network.
//
// Run: `node --test dopl-desktop-app/test/avatar-bridge-policy.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");

const POLICY = read("main", "avatar-policy.js");
const BRIDGE = read("main", "ui-bridge.js");
const PRELOAD = read("renderer", "app-preload.js");

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

const PURE = slice(POLICY, "AVATAR-POLICY-PURE");

// The sliced block must stay host-free (only Node globals), or the extraction
// below stops proving anything about the shipped code.
for (const banned of ["require(", "electron", "process.", "fs.", "child_process"]) {
  assert.ok(!PURE.includes(banned), `AVATAR-POLICY-PURE must not reference ${banned}`);
}

const { isAllowedAvatarUrl, isBoundedImageDataUri, MAX_DATA_URI_LEN } = new Function(
  `${PURE}; return { isAllowedAvatarUrl, isBoundedImageDataUri, MAX_DATA_URI_LEN };`
)();

const STORAGE = "https://mrefkedvdehahjejreae.supabase.co";

// ── The allowlist ────────────────────────────────────────────────────────────

test("allowlist: the real OAuth avatar hosts are admitted", () => {
  for (const ok of [
    "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c",
    "https://avatars.githubusercontent.com/u/12345?v=4",
    // Google load-balances the same avatar across lh3…lh6.
    "https://lh4.googleusercontent.com/a/x",
    "https://lh6.googleusercontent.com/a/x",
  ]) {
    assert.equal(isAllowedAvatarUrl(ok, STORAGE), true, `${ok} must be allowed`);
  }
});

test("allowlist: the Supabase storage origin is admitted (workspace icons)", () => {
  assert.equal(
    isAllowedAvatarUrl(`${STORAGE}/storage/v1/object/public/icons/a.png`, STORAGE),
    true
  );
  // A DIFFERENT supabase project is a different origin — not ours, not allowed.
  assert.equal(
    isAllowedAvatarUrl("https://someoneelse.supabase.co/storage/v1/x.png", STORAGE),
    false
  );
});

test("allowlist: googleusercontent is NOT open — only the lh<N> avatar family", () => {
  for (const bad of [
    // Google's general user-content hosts: attacker-choosable bytes on a
    // Google origin. A `*.googleusercontent.com` rule would admit all of these.
    "https://doc-0s-8c-docs.googleusercontent.com/x",
    "https://blogger.googleusercontent.com/img/x",
    "https://googleusercontent.com/x",
    "https://lh3.googleusercontent.com.evil.test/x", // suffix-splice
    "https://evil.test/lh3.googleusercontent.com", // path, not host
  ]) {
    assert.equal(isAllowedAvatarUrl(bad, STORAGE), false, `${bad} must be refused`);
  }
});

test("allowlist: refuses non-https, credentialed, and unparseable forms (fail closed)", () => {
  for (const bad of [
    "http://lh3.googleusercontent.com/a/x", // downgraded scheme
    "//lh3.googleusercontent.com/a/x", // protocol-relative
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "https://user:pass@lh3.googleusercontent.com/a/x", // credential smuggling
    "not a url",
    "",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(isAllowedAvatarUrl(bad, STORAGE), false, `${String(bad)} must be refused`);
  }
});

test("allowlist: an absent storage origin does not open a hole", () => {
  // A config without a parseable SUPABASE_URL degrades to '' — which must not
  // match `u.origin` for anything.
  assert.equal(isAllowedAvatarUrl(`${STORAGE}/x.png`, ""), false);
  assert.equal(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a/x", ""), true);
});

// ── The bounded answer ───────────────────────────────────────────────────────

test("answer: only a bounded data:image/* URI survives the boundary check", () => {
  assert.equal(isBoundedImageDataUri("data:image/png;base64,QUFB", MAX_DATA_URI_LEN), true);
  for (const bad of [
    "data:text/html;base64,QUFB", // mime coerced to image/*
    "data:image/", // header only, no payload
    "https://lh3.googleusercontent.com/a/x", // a URL must never come back
    "",
    null,
    undefined,
  ]) {
    assert.equal(isBoundedImageDataUri(bad, MAX_DATA_URI_LEN), false, `${String(bad)} rejected`);
  }
});

test("answer: the size cap is enforced at the IPC boundary, not just in the cache", () => {
  const cap = MAX_DATA_URI_LEN;
  assert.equal(cap, 512 * 1024, "the boundary cap is ~512KB");
  const head = "data:image/png;base64,";
  assert.equal(isBoundedImageDataUri(head + "A".repeat(cap - head.length), cap), true);
  assert.equal(isBoundedImageDataUri(head + "A".repeat(cap), cap), false, "over cap -> refused");
});

// ── Delegation: avatar-cache stays the ONLY fetcher ──────────────────────────

test("policy: serves through avatar-cache and never opens its own fetch", () => {
  assert.match(
    POLICY,
    /avatarCache\.getDataUri\(url\)/,
    "the bounded, memoized GET must come from main/avatar-cache.js"
  );
  assert.ok(
    !/\bfetch\s*\(/.test(POLICY),
    "avatar-policy must not fetch — that is avatar-cache's one-shot bounded GET"
  );
  // Refusal happens BEFORE the cache is touched, so a refused host is never
  // downloaded (nor cached) even once.
  assert.match(
    POLICY,
    /if \(!isAllowedAvatarUrl\(url, AVATAR_STORAGE_ORIGIN\)\) return null;\s*\n\s*const uri = await avatarCache\.getDataUri\(url\);/,
    "the allowlist must gate the fetch, not filter its result"
  );
});

// ── The handler: sender-bound like every other one ───────────────────────────

test("ui-bridge: dopl:avatar is registered through the sender-binding wrapper", () => {
  const handler = BRIDGE.slice(BRIDGE.indexOf("'dopl:avatar'"));
  assert.match(
    handler.slice(0, 900),
    /bound\('avatar',/,
    "dopl:avatar must go through `bound(...)` — an unbound fetch primitive is reachable from any frame"
  );
  assert.match(
    handler.slice(0, 900),
    /String\(url == null \? '' : url\)/,
    "the handler must coerce its argument to a string before the policy sees it"
  );
});

// ── The preload: one new member, no new capability ───────────────────────────

test("app-preload: avatarDataUri is string-coerced and the token invariants hold", () => {
  assert.match(
    PRELOAD,
    /avatarDataUri: \(url\) => ipcRenderer\.invoke\('dopl:avatar', asStr\(url\)\)/,
    "the new member must coerce its argument like every other one"
  );
  // INVARIANT 1 — no tokens. The preload may name auth state, never a token.
  for (const banned of ["access_token", "refresh_token", "getAccessToken", "Bearer"]) {
    assert.ok(!PRELOAD.includes(banned), `app-preload must not mention ${banned}`);
  }
  // INVARIANT 2 — no caller-supplied headers.
  // (Prose may DISCUSS headers; what must not exist is a `headers:` payload.)
  assert.ok(
    !/headers\s*:/.test(PRELOAD),
    "app-preload must never build a headers payload — main owns every header"
  );
  // The bridge stays a fixed surface: no dynamic channel names.
  const invocations = [...PRELOAD.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\(([^,)]+)/g)];
  for (const [, arg] of invocations) {
    assert.match(
      arg.trim(),
      /^('[^']+'|"[^"]+"|[A-Z_]+)$/,
      `ipc channel ${arg.trim()} must be a literal/constant, never a computed name`
    );
  }
});
