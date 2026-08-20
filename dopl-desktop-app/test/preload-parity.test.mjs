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
// takes its own, session-window takes session-preload, claude-auth takes code-prompt-preload),
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

const APP_OPS = [
  "apiRequest",
  "avatarDataUri",
  "beginSignIn",
  "channels.chooseFolder",
  "channels.clearFolder",
  // ⚠ TWO OPS JOINED HERE ON 2026-08-20 (the auto-send posture): the pin failed on the
  // ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `channels:getAutoSend` / `channels:setAutoSend`, both `appWindowOnly`,
  //     both UUID-gating `channelId`, storage in `main/channel-prefs.js › get/setAutoSend`
  //     (durable, default OFF, boolean-only writes).
  //   • THEY WIDEN LITTLE, AND IN THE STATED DIRECTION: the setting governs whether the
  //     operator's OWN agent's drafted reply posts without a Send click. A forged `set`
  //     from an app window can flip a channel to auto-send — the same authority the
  //     Settings tab hands the operator — and never grants a tool, reads a secret, or
  //     reaches another member's machine.
  "channels.getAutoSend",
  "channels.getFolderLabel",
  "channels.getPermissionPreset",
  "channels.setAutoSend",
  "channels.setPermissionPreset",
  "getAuthState",
  "onAuthState",
  "onNavigate",
  "onSyncEvent",
  "openExternal",
  "passwordSignIn",
  "sendMagicLink",
  // ⚠ TWO OPS JOINED HERE ON 2026-08-18 (wiring plan Phase 5): `sessions.pause` and
  // `sessions.end`, the Agents tab's controls on the operator's OWN agent. The pin failed on
  // the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked before this list was edited —
  //     `main/channel-dir-ipc.js` registers `sessions:pause` / `sessions:end`, both wrapped in
  //     the same sender binding as `sessions:reopen` and the folder ops (`mainOnly()` when this
  //     entry was written; `appWindowOnly()` since Phase 10 widened its subject), both
  //     UUID-gating `channelId`. A pinned op with no handler is a promise the bridge cannot
  //     keep; that is the check this rule exists to force.
  //   • THEY WIDEN NOTHING. Each resolves (channel, thread) against main's OWN session
  //     registry and dispatches a reducer event the session window's buttons already
  //     dispatched — `interrupt` (the send button's pause morph) and `end` ("End session").
  //     No query starts, no shell wakes, no tool is granted, nothing is posted. The failure
  //     direction of a forged call is an agent that STOPS.
  //   • Own agents only, structurally: the registry holds nothing but this operator's sessions
  //     on this machine, so there is no cross-member control surface to abuse.
  "sessions.end",
  "sessions.onSummaries",
  "sessions.pause",
  "sessions.reopen",
  "sessions.summaries",
  "signOut",
  "syncWatch",
  // ⚠ ONE JOINED HERE ON 2026-08-18 (wiring plan Phase 10): `threads.openWindow`, the
  // thread view's "Open as new window". The pin failed on the ADD, which is the review this
  // comment records:
  //   • The main-process handler EXISTS and was checked before this list was edited —
  //     `main/channel-dir-ipc.js` registers `threads:openWindow` under the same
  //     `appWindowOnly()` sender binding as every op above, UUID-gates `channelId`, and runs
  //     the segment and the thread id through `deep-link-target.js › isSafeSegment` (the ONE
  //     character rule for a string entering a router path). A pinned op with no handler is
  //     a promise the bridge cannot keep; that is the check this rule exists to force.
  //   • IT ASKS FOR A WINDOW; IT DOES NOT GET ONE. No handle, window id or reference comes
  //     back — main creates the window and main registers it in `main/app-windows.js`. That
  //     is precisely why widening the sender binding in this phase is safe: the renderer
  //     cannot enlarge the set of bound senders, only ask main to.
  //   • The failure directions are all refusals in ONE shape (`{ ok: false }`): a bad id, a
  //     blocking version floor, a full window budget. Nothing here starts a query, wakes a
  //     shell, grants a tool or posts anything.
  "threads.openWindow",
];

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

// ── 2. The session window — the gap the handoff named ───────────────────────
// 17 `session:*` channels carrying consent and handoff, and NOT ONE of them was pinned by
// any test in this tree. The session window is where an agent turn is approved or denied, so
// a dropped op here is a consent card that cannot answer, on the surface where that matters
// most.

const SESSION = loadPreload("session", "session-preload.js");

const SESSION_OPS = [
  "agentName",
  "attendedHandoff",
  "auth.get",
  "auth.onNotice",
  "auth.signIn",
  // ⚠ `closeTask` was here and is REMOVED (wiring plan Phase 4, 2026-08-18) with the whole
  // close lane — the panel, the `session:close-task` IPC handler and the reducer branch.
  // This pin fails on ADD as well as on REMOVE, which is why the removal is stated.
  "consentDecision",
  "end",
  "folder.choose",
  "folder.clear",
  "folder.get",
  "inboundDecision",
  "interrupt",
  "onEvent",
  "permission",
  "request.onStatus",
  "send",
  "sendToPeer",
  "setMessageMode",
  "setModel",
  "setToolMode",
];

test("the session preload exposes exactly its pinned surface, on `doplSession`", () => {
  assert.equal(SESSION.exposedAs, "doplSession", "a DIFFERENT global from the app shell");
  assert.deepEqual(
    opPaths(SESSION.api),
    SESSION_OPS,
    "renderer/session/session-preload.js changed shape. This is the window where an agent " +
      "turn is approved or denied — a dropped op is a consent card that cannot answer."
  );
});

test("the decision ops the consent card cannot work without", () => {
  for (const [op, why] of [
    ["permission", "the tool-permission verdict"],
    ["consentDecision", "accept/decline on a peer's request"],
    ["inboundDecision", "releasing a held inbound reply"],
    ["attendedHandoff", "the attended-handoff answer"],
  ]) {
    assert.equal(typeof SESSION.api[op], "function", `${op} is gone — that breaks ${why}`);
  }
});

// ── 3. The remote preload stays deleted ─────────────────────────────────────

test("Stage D: the remote shell's preload is gone and nothing loads it", () => {
  assert.ok(
    !existsSync(join(HERE, "..", "renderer", "preload.js")),
    "renderer/preload.js is back. It was the REMOTE wrapper's bridge; every window now takes " +
      "its own (spa-window -> app-preload, update-required-window -> update-required-preload, " +
      "session-window -> session-preload, claude-auth -> code-prompt-preload)."
  );
});
