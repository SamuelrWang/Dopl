// DOM-exec tests for the session-window factories (renderer/session/session-render.js).
//
// session-render.js touches `document` ONLY inside a factory, so requiring it is
// DOM-free; a tiny stub lets us actually EXERCISE the factories (item 8 tool-card
// collapse, item 2 counterparty avatar) without pulling in jsdom. Split out of
// session-render.test.mjs purely to respect the HARD 500-line-per-file cap.
//
// The stub models only the surface the factories use: createElement, className,
// textContent, appendChild, and a minimal classList.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vm = require(
  fileURLToPath(new URL("../renderer/session/session-viewmodel.js", import.meta.url))
);

function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: "",
    textContent: "",
    children: [],
    _attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; if (k === "class") this.className = v; },
    getAttribute(k) { return this._attrs[k]; },
    replaceChildren() { this.children = []; },
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
globalThis.document = { createElement: (t) => makeEl(t) };
const render = require(
  fileURLToPath(new URL("../renderer/session/session-render.js", import.meta.url))
);

// ── item 2: the counterparty lane renders an initials-on-token avatar ─────────

test("makeCounterparty renders an initials avatar from the peer name (item 2)", () => {
  const rec = render.makeCounterparty({ from: "David", text: "hi" });
  const head = rec.el.children[0];
  const avatar = head.children.find((c) => c.classList.contains("cp-avatar"));
  assert.ok(avatar, "a cp-avatar is rendered");
  assert.equal(avatar.textContent, "D");
});

// ── item 8: tool cards default COLLAPSED ──────────────────────────────────────

test("makeTool: head is always visible; body is a CLOSED <details> with the result hidden (item 8)", () => {
  const rec = render.makeTool(
    { name: "Bash", inputSummary: "$ ls", inputFull: { command: "ls" } },
    { vm }
  );
  const root = rec.el;
  assert.ok(root.classList.contains("tool-card"));

  // Head (name + summary + status) is OUTSIDE the details → always visible.
  const head = root.children[0];
  assert.ok(head.classList.contains("tool-card__head"));
  const status = head.children.find((c) => c.classList.contains("tool-status"));
  assert.ok(status, "the run status lives in the always-visible head");
  const summary = head.children.find((c) => c.classList.contains("tool-card__summary"));
  assert.equal(summary.textContent, "$ ls");

  // Body is the <details> itself, default CLOSED (no `open`).
  const body = root.children[1];
  assert.equal(body.tagName, "DETAILS");
  assert.ok(body.classList.contains("tool-card__body"));
  assert.ok(!body._attrs.open && !body.open, "the details must start CLOSED");

  // The result lives INSIDE the details and starts hidden.
  const result = body.children.find((c) => c.classList.contains("tool-result"));
  assert.ok(result, "the result is inside the details (not dumped into the stream)");
  assert.ok(result.classList.contains("hidden"), "the result is hidden until the user expands");
});

test("makeTool.update fills the result + status but keeps the result inside the closed details (item 8)", () => {
  const rec = render.makeTool({ name: "Bash", inputFull: { command: "ls" } }, { vm });
  rec.update({ status: "ok", resultSummary: "2 files" });

  const body = rec.el.children[1];
  assert.equal(body.tagName, "DETAILS");
  assert.ok(!body._attrs.open && !body.open, "still collapsed after a result arrives");

  const result = body.children.find((c) => c.classList.contains("tool-result"));
  assert.equal(result.textContent, "2 files");
  assert.ok(!result.classList.contains("hidden"), "the result is revealed but stays inside the details");

  const status = rec.el.children[0].children.find((c) => c.classList.contains("tool-status"));
  assert.equal(status.textContent, "Done");
  assert.ok(status.classList.contains("is-ok"));
});
