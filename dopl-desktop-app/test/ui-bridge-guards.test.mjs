// Desktop migration Phase 2 — the SPA bridge's security predicates, pinned.
//
// Every ported page's data flows through main/ui-bridge.js, and its two
// gates are the whole story: `isWindowSender` decides WHO may call, and
// `resolveApiUrl` decides WHERE main will fetch on the caller's behalf —
// with the caller's Bearer credential attached once auth is wired. The
// scaffold review found both original forms wanting (a character-blacklist
// path gate that WHATWG normalization sidestepped via `%2e%2e`, and a
// sender check that failed OPEN on an unreadable frame); this file pins
// the corrected behavior the way test/channel-ipc-sender.test.mjs pins the
// channel-dir guards, plus the spa-window navigation predicate.
//
// Run: `node --test dopl-desktop-app/test/ui-bridge-guards.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

function slice(src, name) {
  const BEGIN = `// ─── BEGIN ${name}`;
  const END = `// ─── END ${name}`;
  const from = src.indexOf(BEGIN);
  const to = src.indexOf(END);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

// ── ui-bridge pure guards, sliced and driven directly ────────────────────────

const bridgePure = slice(M("ui-bridge.js"), "UI-BRIDGE-PURE");
const { isWindowSender, resolveApiUrl, isExternalUrl, isWorkspaceId } =
  new Function(
    `${bridgePure}; return { isWindowSender, resolveApiUrl, isExternalUrl, isWorkspaceId };`
  )();

const API_BASE = "https://www.usedopl.com";

test("resolveApiUrl admits plain /api paths and returns the resolved href", () => {
  assert.equal(
    resolveApiUrl("/api/workspaces/me", API_BASE),
    "https://www.usedopl.com/api/workspaces/me"
  );
  // Query strings ride along.
  assert.equal(
    resolveApiUrl("/api/skills?limit=5", API_BASE),
    "https://www.usedopl.com/api/skills?limit=5"
  );
});

test("resolveApiUrl refuses every traversal/steering encoding AFTER normalization", () => {
  // The exact bypasses of the old character blacklist: WHATWG decodes
  // dot-segments after any string check, so the gate must judge the
  // parsed result.
  for (const evil of [
    "/api/%2e%2e/auth/callback", // percent-encoded dot-segment
    "/api/../auth/v1/token", // literal traversal
    "/api/%2E%2E/%2E%2E/oauth/authorize", // upper-hex
    "//evil.example/api/x", // protocol-relative → other origin
    "https://evil.example/api/x", // absolute other origin
    "/auth/callback", // non-API app path
    "/apifake/x", // prefix-shaped but not /api/
    "", // empty
    null, // null
    "\\\\evil\\api", // backslash forms
  ]) {
    assert.equal(resolveApiUrl(evil, API_BASE), null, `admitted: ${evil}`);
  }
});

test("resolveApiUrl never returns a href on a foreign origin", () => {
  // Property over a fuzz set: whatever comes back MUST be on the app
  // origin under /api — the caller fetches the RETURNED href.
  const probes = [
    "/api/a/../b", // normalizes WITHIN /api → allowed as /api/b
    "/api//double//slash",
    "/api/%61uth", // decodes to 'auth' but stays under /api/
  ];
  for (const p of probes) {
    const href = resolveApiUrl(p, API_BASE);
    if (href !== null) {
      const u = new URL(href);
      assert.equal(u.origin, API_BASE, `foreign origin from ${p}`);
      assert.ok(u.pathname.startsWith("/api"), `escaped /api from ${p} → ${u.pathname}`);
    }
  }
});

test("isWindowSender fails CLOSED on unreadable/missing frames", () => {
  const wc = { mainFrame: {} };
  const win = { isDestroyed: () => false, webContents: wc };
  // Happy path: sender is the window's webContents, frame is its top frame.
  assert.equal(
    isWindowSender({ sender: wc, senderFrame: wc.mainFrame }, win),
    true
  );
  // senderFrame null/undefined → REFUSED (the old form waved this through).
  assert.equal(isWindowSender({ sender: wc, senderFrame: null }, win), false);
  assert.equal(isWindowSender({ sender: wc, senderFrame: undefined }, win), false);
  // mainFrame missing on the webContents → refused.
  const wcNoMain = {};
  const winNoMain = { isDestroyed: () => false, webContents: wcNoMain };
  assert.equal(
    isWindowSender({ sender: wcNoMain, senderFrame: {} }, winNoMain),
    false
  );
  // A subframe (different object) → refused.
  assert.equal(isWindowSender({ sender: wc, senderFrame: {} }, win), false);
  // senderFrame getter that throws (detached frame) → refused.
  const evt = { sender: wc };
  Object.defineProperty(evt, "senderFrame", {
    get() {
      throw new Error("frame disposed");
    },
  });
  assert.equal(isWindowSender(evt, win), false);
  // Destroyed / absent window → refused.
  assert.equal(isWindowSender({ sender: wc, senderFrame: wc.mainFrame }, null), false);
  assert.equal(
    isWindowSender(
      { sender: wc, senderFrame: wc.mainFrame },
      { isDestroyed: () => true, webContents: wc }
    ),
    false
  );
});

test("isExternalUrl: http(s) only", () => {
  assert.equal(isExternalUrl("https://example.com/x"), true);
  assert.equal(isExternalUrl("http://example.com"), true);
  for (const evil of ["file:///etc/passwd", "smb://host/share", "javascript:alert(1)", "not a url", ""]) {
    assert.equal(isExternalUrl(evil), false, `admitted: ${evil}`);
  }
});

test("isWorkspaceId: UUID only", () => {
  assert.equal(isWorkspaceId("0b0e7bd8-9c1e-4a52-8f8e-1c2d3e4f5a6b"), true);
  for (const bad of ["my-workspace", "0b0e7bd8", 42, null, "", "0b0e7bd8-9c1e-4a52-8f8e-1c2d3e4f5a6b\n"]) {
    assert.equal(isWorkspaceId(bad), false, `admitted: ${bad}`);
  }
});

// ── spa-window navigation predicate ──────────────────────────────────────────

const navPure = slice(M("spa-window.js"), "SPA-WINDOW-PURE");
const { isAllowedNavigation } = new Function(
  `${navPure}; return { isAllowedNavigation };`
)();

const INDEX = pathToFileURL("/app/renderer/app/index.html").href;

test("navigation: only the loaded bundle's file URL, exact on path", () => {
  assert.equal(isAllowedNavigation(INDEX, "", INDEX), true);
  // Hash / query variants of the SAME document are the router working.
  assert.equal(isAllowedNavigation(`${INDEX}#/ws/overview`, "", INDEX), true);
  assert.equal(isAllowedNavigation(`${INDEX}?x=1`, "", INDEX), true);
  // ANY other local document is refused — it would inherit window.dopl with
  // no CSP (the policy is a per-document <meta>).
  assert.equal(
    isAllowedNavigation("file:///etc/passwd", "", INDEX),
    false
  );
  assert.equal(
    isAllowedNavigation(pathToFileURL("/app/renderer/other.html").href, "", INDEX),
    false
  );
  // No indexHref configured → every file: URL refused.
  assert.equal(isAllowedNavigation(INDEX, "", ""), false);
});

test("navigation: dev origin only when devUrl set; everything else refused", () => {
  assert.equal(isAllowedNavigation("http://localhost:5173/x", "http://localhost:5173", INDEX), true);
  assert.equal(isAllowedNavigation("http://localhost:9999/x", "http://localhost:5173", INDEX), false);
  assert.equal(isAllowedNavigation("https://www.usedopl.com/canvas", "", INDEX), false);
  assert.equal(isAllowedNavigation("javascript:alert(1)", "", INDEX), false);
  assert.equal(isAllowedNavigation("not a url", "http://localhost:5173", INDEX), false);
});
