// #3031 — "clicking links across the app does not open them in the browser", pinned.
//
// Two gates were each refusing ordinary links and NEITHER logged loudly enough to be noticed:
//
//   1. `ui-bridge.js › dopl:open-external` ran a HOST allowlist (stripe.com, github.com, the
//      app origin). Every other destination answered `{ ok: false }`, which
//      `src/shared/lib/open-external.ts` discards — a clicked link was a silent no-op.
//   2. `spa-window.js › policeNavigation` refused the navigation and stopped: `window.open`
//      denied, `will-navigate` preventDefault'd, no hand-off. A plain `<a href>` or
//      `<a target="_blank">` never reached the bridge at all.
//
// This file pins the policy (`main/external-url.js`, sliced and driven directly) and the WIRING
// of both call sites, because the bug was never in the predicate — it was in what the two
// surfaces did with its answer.
//
// Run: `node --test dopl-desktop-app/test/external-url.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const EXTERNAL = M("external-url.js");
const { isOpenableExternalUrl, externalUrlHost, OPENABLE_SCHEMES } = new Function(
  `${slice(EXTERNAL, "EXTERNAL-URL-PURE")}; return { isOpenableExternalUrl, externalUrlHost, OPENABLE_SCHEMES };`
)();

// ── THE POLICY ───────────────────────────────────────────────────────────────

test("an ordinary link to ANY host opens — that is the whole bug", () => {
  for (const ok of [
    "https://example.com/",
    "https://news.ycombinator.com/item?id=1",
    "http://example.com/plain-http",
    "https://docs.anthropic.com/en/docs#section",
    "https://user.github.io/repo/",
    "https://example.com/path?q=a%20b&r=2",
    "https://xn--bcher-kva.example/", // punycode host
    "https://example.com:8443/x", // non-default port
    "mailto:someone@example.com",
    "mailto:someone@example.com?subject=Hi",
  ]) {
    assert.equal(isOpenableExternalUrl(ok), true, `refused a real link: ${ok}`);
  }
});

test("the bound is the SCHEME: no local-file, code-execution or inline-data target", () => {
  for (const evil of [
    "file:///etc/passwd",
    "file://host/share/x",
    "smb://host/share",
    "javascript:alert(1)",
    "JavaScript:alert(1)", // the constructor lower-cases the scheme
    "  javascript:alert(1)", // …and strips leading whitespace, so prefix tests are not enough
    "\njavascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/abc",
    "about:blank",
    "chrome://settings",
    "ftp://host/f",
    "ms-msdt:/id",
    "not a url",
    "",
    "   ",
  ]) {
    assert.equal(isOpenableExternalUrl(evil), false, `admitted: ${evil}`);
  }
});

test("a non-string is refused, never coerced", () => {
  for (const bad of [null, undefined, 0, 1, {}, [], ["https://example.com"], true]) {
    assert.equal(isOpenableExternalUrl(bad), false, `admitted: ${JSON.stringify(String(bad))}`);
  }
});

test("a file-shaped path under a web scheme is NORMALIZED to a web host, not a local read", () => {
  // ⚠ CHECKED, NOT ASSUMED. The guard was written expecting `http:///etc/passwd` to parse with
  // an empty host and the local pathname — it does not. WHATWG treats http/https as SPECIAL
  // schemes and requires an authority, so the parser consumes the first path segment AS the
  // host: `http:///etc/passwd` → host "etc", path "/passwd". That is an ordinary (unresolvable)
  // web URL, so admitting it is correct and reads nothing off the disk.
  const u = new URL("http:///etc/passwd");
  assert.equal(u.hostname, "etc");
  assert.equal(u.pathname, "/passwd");
  assert.equal(isOpenableExternalUrl("http:///etc/passwd"), true);
  // …and a hostless http(s) URL cannot be constructed at all, which is the other half of why
  // a local path can never arrive wearing a web scheme.
  assert.throws(() => new URL("https://"));
  assert.equal(isOpenableExternalUrl("https://"), false);
  // The empty-host branch therefore guards an unreachable shape TODAY and is kept deliberately:
  // it is what stops a non-special scheme added to the list later from carrying a bare path.
  assert.match(EXTERNAL, /return !!u\.hostname;/);
});

test("the openable set is exactly http, https, mailto — adding one is a deliberate edit", () => {
  assert.deepEqual([...OPENABLE_SCHEMES].sort(), ["http:", "https:", "mailto:"]);
  assert.ok(Object.isFrozen(OPENABLE_SCHEMES), "the list must not be mutable at runtime");
});

test("externalUrlHost gives a host and never the query string", () => {
  assert.equal(externalUrlHost("https://example.com/p?token=secret"), "example.com");
  assert.equal(externalUrlHost("https://example.com:8443/x"), "example.com:8443");
  assert.equal(externalUrlHost("not a url"), "?");
  assert.equal(externalUrlHost(null), "?");
  assert.ok(!externalUrlHost("https://example.com/?t=secret").includes("secret"));
});

// ── CALL SITE 1: the bridge handler asks, and opens on a yes ────────────────

test("dopl:open-external opens whatever the policy admits", () => {
  const BRIDGE = M("ui-bridge.js");
  const fn = BRIDGE.slice(
    BRIDGE.indexOf("'dopl:open-external'"),
    BRIDGE.indexOf("broadcastAuthState")
  );
  assert.match(fn, /externalUrl\.isOpenableExternalUrl\(url\)/);
  assert.match(fn, /shell\.openExternal\(/, "a yes must actually reach the OS opener");
  // ⚠ Match the DECLARATION, not the name: both names survive in the comments that record why
  // they went, and a bare name test fails on its own tombstone.
  assert.ok(
    !/EXTERNAL_HOST_ALLOWLIST\s*=/.test(BRIDGE),
    "the host allowlist must not be redeclared in the bridge"
  );
  assert.ok(
    !/function isAllowedExternalUrl/.test(BRIDGE),
    "nor its predicate"
  );
});

// ── CALL SITE 2: the window hands off what it refuses to navigate ───────────

test("a DENIED window.open still hands its URL to the real browser", () => {
  const SPA = M("spa-window.js");
  const handler = SPA.slice(
    SPA.indexOf("setWindowOpenHandler"),
    SPA.indexOf("const indexHref")
  );
  assert.match(handler, /handOffExternal\(/, "target=_blank / window.open must hand off");
  assert.match(handler, /action: 'deny'/, "…and the in-app window must still be denied");
});

test("a REFUSED top-frame navigation hands off instead of being swallowed", () => {
  const SPA = M("spa-window.js");
  const police = SPA.slice(
    SPA.indexOf("const police = (event, url)"),
    SPA.indexOf("win.webContents.on('will-navigate'")
  );
  assert.match(police, /event\.preventDefault\(\)/, "the top frame still may not leave");
  assert.match(police, /handOffExternal\(url/, "and the URL goes to the browser");
  // The predicate itself did not loosen — this is the same gate, with an else-branch.
  assert.match(police, /isAllowedNavigation\(url, devUrl\(\), indexHref\)/);
});

test("will-frame-navigate refuses WITHOUT handing off, so one click is not two tabs", () => {
  // Electron fires BOTH will-navigate and will-frame-navigate for one main-frame navigation.
  const SPA = M("spa-window.js");
  const frame = SPA.slice(
    SPA.indexOf("win.webContents.on('will-frame-navigate'"),
    SPA.indexOf("return win;")
  );
  assert.ok(!/handOffExternal/.test(frame), "a second hand-off would open the link twice");
  assert.match(frame, /if \(!event\.isMainFrame\) \{ event\.preventDefault\(\); return; \}/);
});

test("the hand-off asks the SHARED policy and cannot reject into an event handler", () => {
  const SPA = M("spa-window.js");
  const fn = SPA.slice(
    SPA.indexOf("function handOffExternal"),
    SPA.indexOf("// Deny every `window.open`")
  );
  assert.match(fn, /externalUrl\.isOpenableExternalUrl\(url\)/, "one policy, not a second copy");
  assert.match(fn, /\.catch\(/, "a failed OS opener must not surface as an unhandled rejection");
  assert.match(fn, /externalUrlHost\(url\)/, "a refused URL is logged by host only");
  // ⚠ The URL must never be a diag ARGUMENT. Matching a bare `url)` hits `externalUrlHost(url)`
  // — the very call that makes this safe — so pin the argument position instead.
  assert.ok(!/diag\([^)]*,\s*url\s*[),]/.test(fn), "never pass the URL itself to diag");
  assert.ok(!/diag\(\s*url\b/.test(fn), "nor as its first argument");
});

test("both surfaces require the ONE module, neither re-implements it", () => {
  for (const f of ["ui-bridge.js", "spa-window.js"]) {
    assert.match(M(f), /require\('\.\/external-url'\)/, `${f} must share the policy`);
  }
  // No third copy of a scheme test anywhere in main.
  assert.ok(
    !/function isExternalUrl/.test(M("ui-bridge.js") + M("spa-window.js")),
    "a second scheme predicate is how the OS opener comes to have two policies"
  );
});
