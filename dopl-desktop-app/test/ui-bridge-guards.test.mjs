// Desktop migration Phase 2 — the SPA bridge's security predicates, pinned.
//
// Every ported page's data flows through main/ui-bridge.js, and its two
// gates are the whole story: `isAppWindowSender` decides WHO may call, and
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
import { between, fnOf } from "./helpers/source-probe.mjs";

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

const BRIDGE = M("ui-bridge.js");
const bridgePure = slice(BRIDGE, "UI-BRIDGE-PURE");
const { isAppWindowSender, resolveApiUrl, isExternalUrl, isAllowedExternalUrl, isWorkspaceId } =
  new Function(
    `${bridgePure}; return { isAppWindowSender, resolveApiUrl, isExternalUrl, isAllowedExternalUrl, isWorkspaceId };`
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

// ⚠ WIDENED 2026-08-18 (wiring plan Phase 10, Samuel's ruling — option (a)). The subject of
// this guard was "the MAIN window"; it is now the LIVE SET of `webContents` ids
// `main/app-windows.js` registered at window creation — the shell plus any pop-out thread
// window. Without it a second SPA window would have had every `apiRequest` refused and
// would have rendered nothing while reporting nothing. What did NOT change: the top-frame
// check (an iframe shares its host's webContents), the fail-closed direction, and the
// refusal shape. `test/app-windows.test.mjs` holds the other half — that nothing
// renderer-reachable can enlarge that set.

test("isAppWindowSender fails CLOSED on unreadable/missing frames", () => {
  const wc = { id: 1, mainFrame: {}, isDestroyed: () => false };
  const bound = new Set([1]);
  // Happy path: sender is a REGISTERED webContents, frame is its top frame.
  assert.equal(
    isAppWindowSender({ sender: wc, senderFrame: wc.mainFrame }, bound),
    true
  );
  // senderFrame null/undefined → REFUSED (the old form waved this through).
  assert.equal(isAppWindowSender({ sender: wc, senderFrame: null }, bound), false);
  assert.equal(isAppWindowSender({ sender: wc, senderFrame: undefined }, bound), false);
  // mainFrame missing on the webContents → refused.
  const wcNoMain = { id: 2, isDestroyed: () => false };
  assert.equal(
    isAppWindowSender({ sender: wcNoMain, senderFrame: {} }, new Set([2])),
    false
  );
  // A subframe (different object) → refused.
  assert.equal(isAppWindowSender({ sender: wc, senderFrame: {} }, bound), false);
  // senderFrame getter that throws (detached frame) → refused.
  const evt = { sender: wc };
  Object.defineProperty(evt, "senderFrame", {
    get() {
      throw new Error("frame disposed");
    },
  });
  assert.equal(isAppWindowSender(evt, bound), false);
  // Destroyed sender whose id is still in the set → refused (the sweep can lose a race).
  const dead = { id: 3, mainFrame: {}, isDestroyed: () => true };
  assert.equal(
    isAppWindowSender({ sender: dead, senderFrame: dead.mainFrame }, new Set([3])),
    false
  );
});

test("isAppWindowSender admits EVERY registered window and NOTHING else", () => {
  // The enumeration, at the predicate level: the pop-out is as legitimate a caller as the
  // shell BECAUSE main registered it, and an unregistered window is refused however
  // well-formed it looks.
  const shell = { id: 10, mainFrame: {}, isDestroyed: () => false };
  const popout = { id: 11, mainFrame: {}, isDestroyed: () => false };
  const stranger = { id: 12, mainFrame: {}, isDestroyed: () => false };
  const bound = new Set([10, 11]);
  assert.equal(isAppWindowSender({ sender: shell, senderFrame: shell.mainFrame }, bound), true);
  assert.equal(isAppWindowSender({ sender: popout, senderFrame: popout.mainFrame }, bound), true);
  assert.equal(
    isAppWindowSender({ sender: stranger, senderFrame: stranger.mainFrame }, bound),
    false,
    "a session window, a consent window, or anything else main did not register"
  );
});

test("isAppWindowSender fails CLOSED on an absent/empty/non-Set registry", () => {
  // An unbound privileged surface is the bug, not a compatibility mode: register() runs
  // before any window exists, and until one does every handler must be dead.
  const wc = { id: 1, mainFrame: {}, isDestroyed: () => false };
  const e = { sender: wc, senderFrame: wc.mainFrame };
  for (const registry of [null, undefined, new Set(), {}, [1]]) {
    assert.equal(isAppWindowSender(e, registry), false, JSON.stringify(String(registry)));
  }
});

test("isExternalUrl: http(s) only", () => {
  assert.equal(isExternalUrl("https://example.com/x"), true);
  assert.equal(isExternalUrl("http://example.com"), true);
  for (const evil of ["file:///etc/passwd", "smb://host/share", "javascript:alert(1)", "not a url", ""]) {
    assert.equal(isExternalUrl(evil), false, `admitted: ${evil}`);
  }
});

// ── open-external is a DESTINATION policy, not just a scheme check ───────────
// Fleet audit 2026-08-03 (medium): `shell.openExternal` is the renderer's only
// outbound primitive and no CSP applies to the OS opener, so a scheme-only gate
// turned this handler into an arbitrary outbound GET — the single hole in the
// SPA's `connect-src 'none'` containment, and the exfiltration leg for anything
// readable back over the API bridge (e.g. a minted device token).

test("open-external admits the app origin, Stripe and the release host — nothing else", () => {
  const APP = "https://www.usedopl.com";
  for (const ok of [
    `${APP}/ws/canvas?billing=upgrade`,
    `${APP}/login`,
    "https://billing.stripe.com/p/session/live_abc",
    "https://checkout.stripe.com/c/pay/cs_test",
    "https://github.com/SamuelrWang/Dopl/releases/latest/download/Dopl-arm64.dmg",
  ]) {
    assert.equal(isAllowedExternalUrl(ok, APP), true, `refused a real destination: ${ok}`);
  }
  for (const evil of [
    "https://evil.example/?t=dopl_at_live_token", // the exfiltration shape
    "https://usedopl.com.evil.example/x", // suffix-shaped lookalike
    "https://notgithub.com/x",
    "https://stripe.com.evil.example/x",
    "http://billing.stripe.com/p/session/x", // third parties are https-only
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url",
    "",
    null,
  ]) {
    assert.equal(isAllowedExternalUrl(evil, APP), false, `admitted: ${evil}`);
  }
});

test("open-external follows a dev app origin (DOPL_APP_URL) including plain http", () => {
  const DEV = "http://localhost:3000";
  assert.equal(isAllowedExternalUrl(`${DEV}/ws/canvas`, DEV), true);
  assert.equal(isAllowedExternalUrl("http://localhost:3001/x", DEV), false, "a different port is a different origin");
  // The production origin is NOT implicitly allowed just because it is ours.
  assert.equal(isAllowedExternalUrl("http://www.usedopl.com/x", DEV), false);
});

test("the handler runs the destination policy and names only the host when it refuses", () => {
  const fn = between(BRIDGE, "'dopl:open-external'", "broadcastAuthState");
  assert.match(fn, /isAllowedExternalUrl\(url, APP_ORIGIN\)/, "the scheme check alone is not the gate");
  assert.ok(!/diag\([^)]*url\b/.test(fn), "a refused URL's query string must never reach the log");
});

// ── a refused watch must not read as a committed one ─────────────────────────

test("sync-watch REJECTS a non-UUID instead of resolving {ok:false}", () => {
  // shared-channel-registry's issueWatch commits `watchedWorkspace` on ANY resolved
  // answer, so a soft refusal left the renderer believing it was watching a workspace
  // main never joined — a dead feed its own dedupe then refuses to re-issue.
  const fn = between(BRIDGE, "'dopl:sync-watch'", "'dopl:open-external'");
  assert.match(fn, /throw new Error\('dopl: invalid workspace id'\)/);
  assert.ok(!/return \{ ok: false \}/.test(fn), "a refusal must not be decodable as an answer");
});

// ── the 401 repair may not report a sign-out it did not observe ──────────────

test("'signed-out' is emitted only after a retry with a FRESH token still 401s", () => {
  // auth-tokens classifies 5xx/429/timeouts as TRANSIENT: forceRefresh() answers null
  // while KEEPING the session (it just emitted 'signed-in'). Emitting off the original
  // 401 flipped the renderer to the login screen and tore the sync feed down on a
  // network blip, then flapped back on the next successful refresh.
  const fn = fnOf(BRIDGE, "performApiRequest");
  const repair = fn.slice(fn.indexOf("shouldRepairAuth"));
  const emit = repair.indexOf("emitAuthState('signed-out')");
  const retry = repair.indexOf("sendApiRequest(href, opts, fresh.access_token)");
  assert.ok(retry !== -1 && emit !== -1, "the repair must still retry once and be able to emit");
  assert.ok(retry < emit, "the emit must come after the retry, inside the fresh-token branch");
  const guard = repair.slice(repair.indexOf("if (fresh && fresh.access_token)"), emit);
  assert.ok(guard.length > 0, "the emit must sit INSIDE the `fresh` branch");
});

// ── the SPA auth entry points kick the same services the deep link does ──────

test("SPA password sign-in and sign-out restart the listener (and sign-in writes MCP config)", () => {
  // Without it the listener long-polls on a revoked credential (with a misleading
  // "session expired" notification) and the tray reads signed-out for up to the
  // 5-minute reconcile after a successful sign-in.
  const signIn = between(BRIDGE, "'dopl:password-sign-in'", "'dopl:magic-link'");
  assert.match(signIn, /kickListener\('password-sign-in'\)/);
  assert.match(signIn, /ensureMcpConfig\('password-sign-in'\)/);
  const signOut = between(BRIDGE, "'dopl:sign-out'", "'dopl:sync-watch'");
  assert.match(signOut, /kickListener\('sign-out'\)/);
  assert.match(fnOf(BRIDGE, "kickListener"), /require\('\.\/channel-listener'\)/, "lazy require: no import cycle");
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

test("navigation: only the loaded bundle's file URL, exact on HOST as well as path", () => {
  // ⚠ THE HOST HALF WAS MISSING UNTIL 2026-08-18. A `file:` URL carries an
  // AUTHORITY, so a remote-looking one with the SAME pathname parsed clean and
  // was admitted — the predicate compared `t.pathname === allowed.pathname` and
  // nothing else, and its comment said "exact on the path", so the gap read as
  // intentional. `pathToFileURL` yields an empty host, so anything non-empty is
  // somebody else's authority.
  assert.equal(
    isAllowedNavigation("file://evil.example/app/renderer/app/index.html", "", INDEX),
    false,
    "a foreign authority on the same path is not the same document"
  );
  // ⚠ `localhost` is NOT an exception written into the predicate — the WHATWG
  // parser erases it (`file://localhost/x` normalizes to host ""), so it is the
  // SAME URL as the bundled index and is admitted for that reason. Stated here
  // so nobody "hardens" it into a refusal and breaks a legitimate href.
  assert.equal(
    isAllowedNavigation("file://localhost/app/renderer/app/index.html", "", INDEX),
    true,
    "localhost normalizes to the empty host: the same document, not a foreign one"
  );
  // The reverse direction: whatever host the real index href HAS is the one
  // admitted, so this is exact equality and not an empty-host special case.
  const hosted = "file://somehost/app/renderer/app/index.html";
  assert.equal(isAllowedNavigation(hosted, "", hosted), true);
  assert.equal(isAllowedNavigation(INDEX, "", hosted), false);
});

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
