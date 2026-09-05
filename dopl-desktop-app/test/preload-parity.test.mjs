// PRELOAD SURFACES — every `window.dopl*` bridge, pinned against removal.
//
// WHY THIS FILE EXISTS. Four shipped features have gone silently missing the same way: a
// component feature-detects a bridge capability and renders NOTHING when it is absent (the
// correct behaviour for a plain browser and for an older desktop build), the preload never
// grew that capability — or quietly lost it — and so the feature simply is not there. No
// error, no failing unit test, no console line. Avatars, then the consent card's folder row,
// then 1.8.x's "Open thread" (`sessions.reopen`, absent from app-preload while the remote
// preload had it all along). **A self-hiding surface cannot report its own absence, so
// something else must.**
//
// WHAT CHANGED (Stage D, 2026-08-06) AND WHY THE INVARIANT IS DIFFERENT NOW. This file used
// to hold the SPA preload against `renderer/preload.js` — the REMOTE shell's — and assert
// `remote ⊆ SPA`. That worked because both shells served one web tree, so the retired shell
// doubled as a reference implementation. **The remote shell is deleted and its preload was
// orphaned** (no window loaded it: spa-window takes app-preload, update-required-window
// takes its own, claude-auth takes code-prompt-preload),
// so the reference is gone and comparing two preloads is no longer a thing that can be done.
//
// WHAT REPLACES IT IS A PINNED INVENTORY, and the choice is deliberate. The obvious
// alternative — derive the required set from the tree by grepping `dopl.<ns>.<op>` — was
// tried and REJECTED on measurement: it finds exactly three paths, because the tree mostly
// destructures the bridge or reaches it through typed wrappers. A derivation that sees 3 of
// 20 ops would have passed while eighteen went missing, which is the failure this file
// exists to prevent, dressed up as rigour. An explicit list is honest about being a list.
//
// SO THE ASSERTION IS: THESE OPS EXIST, ON THIS WIRE. Removing one fails here. ADDING one
// also fails here — deliberately, because the pin is only worth what its last review was,
// and a new op should be looked at rather than absorbed.
//
// HOW IT RUNS. Every preload is EXECUTED against a fake `electron`, so what is compared is
// the surface the shell really exposes — not a grep over source text that a rename would
// walk straight past. No preload requires anything but `electron`.
//
// Run: `node --test dopl-desktop-app/test/preload-parity.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const readApp = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");

// ── Running a preload without Electron ───────────────────────────────────────
// `contextBridge.exposeInMainWorld` is captured; `ipcRenderer` records instead of sending.
function loadPreload(...file) {
  const src = readApp("renderer", ...file);
  const invocations = [];
  let exposed;
  let exposedAs;
  const electron = {
    contextBridge: {
      exposeInMainWorld(key, value) {
        exposedAs = key;
        exposed = value;
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invocations.push({ channel, args });
        return Promise.resolve(null);
      },
      send(channel, ...args) {
        invocations.push({ channel, args });
      },
      on() {},
      removeListener() {},
    },
  };
  const requireStub = (id) => {
    if (id === "electron") return electron;
    throw new Error(`${file.join("/")} must not require ${JSON.stringify(id)}`);
  };
  new Function("require", "module", "exports", src)(requireStub, { exports: {} }, {});
  assert.ok(exposedAs, `${file.join("/")} exposed no global`);
  assert.ok(exposed, `${file.join("/")} exposed no bridge object`);
  return { api: exposed, exposedAs, invocations };
}

/** Every callable leaf, as a dotted path. */
function opPaths(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") out.push(path);
    else if (value && typeof value === "object") out.push(...opPaths(value, path));
  }
  return out.sort();
}

// ── 1. The app shell — what the SPA's own components feature-detect ──────────

const APP = loadPreload("app-preload.js");

import { APP_OPS } from "./_app-ops-fixture.mjs";

test("the app preload exposes exactly its pinned surface, on `dopl`", () => {
  assert.equal(APP.exposedAs, "dopl", "the global the whole web tree feature-detects");
  assert.deepEqual(
    opPaths(APP.api),
    APP_OPS,
    "renderer/app-preload.js changed shape. A REMOVED op is a silently missing feature — the " +
      "component that needs it renders nothing and reports nothing (this is how sessions.reopen " +
      "vanished for all of 1.8.x). An ADDED op fails here on purpose: update this list once you " +
      "have checked the main-process handler exists."
  );
});

test("the three ops whose absence has ALREADY shipped a silent bug", () => {
  // Named individually so the failure says which feature died, not just "shape changed".
  for (const [op, feature] of [
    ["sessions.reopen", '"Open thread" on a channel DM (missing for all of 1.8.x)'],
    ["channels.chooseFolder", "the consent card's folder row"],
    ["avatarDataUri", "member avatars"],
  ]) {
    const fn = op.split(".").reduce((o, k) => (o == null ? undefined : o[k]), APP.api);
    assert.equal(typeof fn, "function", `${op} is gone — that silently removes ${feature}`);
  }
});

// ── 2. THE SESSION PRELOAD IS DELETED ───────────────────────────────────────
//
// ⚠ SECTION 2 PINNED `renderer/session/session-preload.js` — 20 `doplSession` ops carrying the
// tool-permission verdict, accept/decline on a peer's request, the held-inbound release and the
// attended-handoff answer. It is deleted with the window it bridged (2026-08-20, F-228), and so
// is every handler behind it (`main/session-ipc.js`).
//
// ⚠ WHAT REPLACED IT IS NOT A SECOND PRELOAD — IT IS SECTION 1. Every decision those ops
// carried now happens on the channels surfaces over the APP preload: a tool gate on a
// windowless session bridges to a consent row and is answered in the thread view, and the
// operator's own agent is paused, ended, opened and messaged through `sessions.*` in APP_OPS
// above. That is why this file did not shrink to a single section quietly — the ops moved
// lists, and APP_OPS is where they are now reviewed.

// ── 3. The remote preload stays deleted ─────────────────────────────────────

test("Stage D: the remote shell's preload is gone and nothing loads it", () => {
  assert.ok(
    !existsSync(join(HERE, "..", "renderer", "preload.js")),
    "renderer/preload.js is back. It was the REMOTE wrapper's bridge; every window now takes " +
      "its own (spa-window -> app-preload, update-required-window -> update-required-preload, " +
      "claude-auth -> code-prompt-preload)."
  );
});
