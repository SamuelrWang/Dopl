// Q6 — the in-window "Sign in to Claude" banner (renderer side).
//
// Two layers, the discipline of session-gate-dom.test.mjs:
//   1. DOM-EXEC — a stub document (node --test isolates this file's process) so the REAL
//      session-auth-ui.js is booted and driven: what a notice paints, what the click sends, and
//      that a refused sign-in hands the button back.
//   2. STRUCTURAL — the markup / CSS / preload guards: textContent only, no innerHTML, no id or
//      path in the payload, the CSP untouched, and the bridge bound from the WINDOW.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { hasRule } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const R = (p) => fileURLToPath(new URL("../renderer/session/" + p, import.meta.url));
const M = (p) => fileURLToPath(new URL("../main/" + p, import.meta.url));
const detect = require(M("session-auth-detect.js"));
const HTML = readFileSync(R("session.html"), "utf8");
const CSS = readFileSync(R("session.css"), "utf8");
const UI = readFileSync(R("session-auth-ui.js"), "utf8");
const PRELOAD = readFileSync(R("session-preload.js"), "utf8");
// The guards below read CODE, not prose: the module comments name the very things they ban
// (innerHTML, sessionId) while explaining why neither appears. Same helper as session-permission-axes.
const stripComments = (src) => src
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/\s.*$/, ""))
  .join("\n");
const UI_CODE = stripComments(UI);

// ── the stub DOM ─────────────────────────────────────────────────────────────
function makeEl() {
  const node = {
    className: "", textContent: "", disabled: false, _listeners: {},
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    fire(k, ev) { for (const fn of this._listeners[k] || []) fn(ev || {}); },
  };
  const has = (c) => node.className.split(/\s+/).filter(Boolean).includes(c);
  node.classList = {
    add(...cs) { const s = new Set(node.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); node.className = [...s].join(" "); },
    remove(...cs) { const s = new Set(node.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.delete(c)); node.className = [...s].join(" "); },
    contains: has,
    toggle(c, on) { const want = on === undefined ? !has(c) : !!on; if (want) node.classList.add(c); else node.classList.remove(c); },
  };
  return node;
}
const byId = new Map();
const $ = (id) => byId.get(id);
globalThis.document = { getElementById: (id) => { if (!byId.has(id)) byId.set(id, makeEl()); return byId.get(id); } };
globalThis.window = globalThis;

let notice = null; // the registered auth sink
const calls = { signIn: 0, get: 0 };
let signInResult = { ok: true };
globalThis.doplSession = {
  auth: {
    onNotice(cb) { notice = cb; },
    signIn() { calls.signIn++; return Promise.resolve(signInResult); },
    get() { calls.get++; return Promise.resolve(null); },
  },
};
new Function(readFileSync(R("session-auth-ui.js"), "utf8"))(); // boot the banner controller

const banner = $("authNotice");
const button = $("btnAuthSignIn");
const flush = () => new Promise((r) => setImmediate(r));

// ── 1. DOM-EXEC ──────────────────────────────────────────────────────────────

test("the banner is invisible until main holds the session", () => {
  assert.equal(banner.classList.contains("is-active"), false);
  assert.equal(calls.get, 1, "a reloaded window asks main whether a hold is open");
});

test("a preflight notice paints the credential copy via textContent", () => {
  notice(detect.authNotice("preflight", {}));
  assert.equal(banner.classList.contains("is-active"), true);
  assert.equal($("authTitle").textContent, detect.AUTH_TITLE);
  assert.match($("authTitle").textContent, /Claude Code sign-in needed on this Mac/);
  assert.equal($("authBody").textContent, detect.AUTH_PREFLIGHT_BODY);
  assert.equal(button.textContent, "Sign in to Claude");
  assert.equal(button.disabled, false);
  assert.equal($("authNote").classList.contains("hidden"), true, "no note until there is one");
});

test("an error notice takes the error class and the mid-session copy", () => {
  notice(detect.authNotice("error", {}));
  assert.equal(banner.classList.contains("is-error"), true);
  assert.equal($("authBody").textContent, detect.AUTH_ERROR_BODY);
});

test("the click sends NO argument and locks the button while the flow owns the screen", async () => {
  const before = calls.signIn;
  button.fire("click");
  assert.equal(calls.signIn, before + 1);
  assert.equal(button.disabled, true, "a second click cannot stack a second flow");
  button.fire("click");
  assert.equal(calls.signIn, before + 1, "…and does not even reach the bridge");
  await flush();
});

test("main's own busy/failed repaint drives the button, not the click", () => {
  notice(detect.authNotice("error", { busy: true, note: detect.AUTH_WORKING }));
  assert.equal(button.disabled, true);
  assert.equal($("authNote").textContent, detect.AUTH_WORKING);
  assert.equal($("authNote").classList.contains("hidden"), false);
  notice(detect.authNotice("error", { busy: false, note: detect.AUTH_FAILED }));
  assert.equal(button.disabled, false, "a failed sign-in hands the button straight back");
  assert.equal($("authNote").textContent, detect.AUTH_FAILED);
});

test("a REFUSED invoke also hands the button back (never a dead control)", async () => {
  signInResult = { ok: false };
  button.fire("click");
  assert.equal(button.disabled, true);
  await flush();
  assert.equal(button.disabled, false);
  signInResult = { ok: true };
});

test("auth_cleared hides the banner and clears the note", () => {
  notice({ type: "auth_cleared" });
  assert.equal(banner.classList.contains("is-active"), false);
  assert.equal($("authNote").textContent, "");
  assert.equal(button.disabled, false);
});

// ── 2. STRUCTURAL ────────────────────────────────────────────────────────────

test("the banner is STATIC markup filled by textContent — no innerHTML anywhere", () => {
  assert.match(HTML, /id="authNotice"/);
  assert.match(HTML, /id="btnAuthSignIn"[^>]*>Sign in to Claude</, "the action label is static markup");
  for (const id of ["authTitle", "authBody", "authNote"]) assert.ok(HTML.includes(`id="${id}"`), id);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(UI_CODE), "no HTML parsing of any string");
  assert.ok(!/createElement/.test(UI_CODE), "the banner builds no nodes at all — the markup is fixed");
  assert.match(UI_CODE, /\.textContent = /, "every string is set as text");
});

test("the banner leaks no id, path or session handle into the renderer", () => {
  assert.ok(!/sessionId|channelId|taskId|requestId|token|cwd|\/Users\//.test(UI_CODE), "nothing identifying in the controller");
  const payloadKeys = Object.keys(detect.authNotice("preflight", {}));
  for (const key of payloadKeys) assert.ok(!/id$|path|token/i.test(key), `payload key ${key} is display copy`);
});

test("the CSS carries the banner recipe and hides it by default", () => {
  assert.ok(hasRule(CSS, ".auth-notice"));
  assert.ok(hasRule(CSS, ".auth-notice.is-active"));
  assert.ok(!/content:\s*["']/.test(CSS.slice(CSS.indexOf(".auth-notice"), CSS.indexOf(".auth-notice") + 900)),
    "no copy in CSS `content` — every word is markup or textContent");
});

test("the page is still local-only: the CSP and the script list are untouched by Q6", () => {
  assert.match(HTML, /default-src 'none'; script-src 'self'; style-src 'self'/);
  assert.match(HTML, /<script src="session-auth-ui\.js"><\/script>/);
  assert.ok(!/https?:\/\//.test(HTML.slice(HTML.indexOf("<body"))), "no remote asset in the body");
});

test("the bridge is three narrow members, bound from the WINDOW (no id crosses)", () => {
  assert.match(PRELOAD, /session:auth-signin/);
  assert.match(PRELOAD, /session:auth-state/);
  assert.match(PRELOAD, /signIn\(\) \{/, "the click takes no argument at all");
  const IPC = readFileSync(M("session-auth.js"), "utf8");
  assert.match(IPC, /ipcMain\.handle\('session:auth-signin', \(e\) => \{/);
  assert.match(IPC, /deps\.getSessionBySender\(e && e\.sender\)/, "the session comes from the window");
  assert.match(IPC, /if \(!s \|\| !s\.authHold\) return \{ ok: false \};/, "a window with no hold is refused");
  // The fan-out must not steal the transcript's events.
  assert.match(PRELOAD, /if \(typeof handler === 'function'\) deliver\(payload\);/, "the controller still sees everything");
  assert.match(PRELOAD, /const AUTH_TYPES = \{ auth_required: true, auth_cleared: true \};/);
});
