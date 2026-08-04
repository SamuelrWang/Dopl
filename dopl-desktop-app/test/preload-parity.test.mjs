// PRELOAD PARITY — the two shells' `window.dopl` surfaces, held against each
// other and against what the shared web tree actually feature-detects.
//
// WHY THIS FILE EXISTS. Three shipped features have gone silently missing the
// same way: a component in `src/` feature-detects a `window.dopl.*` capability
// and renders NOTHING when it is absent (the correct behaviour for a plain
// browser and for an older desktop build), the SPA preload never grew that
// capability, and so the feature simply is not there — no error, no failing
// unit test, no console line. Avatars, then the consent card's folder row, then
// 1.8.x's "Open thread" button (`sessions.reopen`, absent from
// renderer/app-preload.js while renderer/preload.js had it all along). A
// self-hiding surface cannot report its own absence, so something else must.
//
// THE INVARIANT. The two preloads are NOT meant to be identical: the SPA has a
// large surface the remote shell must never get (apiRequest, the auth ops,
// syncWatch, appOrigin), because the SPA loads OUR bundle and the remote shell
// loads a remote page. The asymmetry that matters runs the other way:
//
//   every OPERATION the remote preload exposes must also exist in the SPA
//   preload, on the same wire, because both shells serve the SAME web tree.
//
// Restricting that to callable members is deliberate and load-bearing — it is
// exactly the set that can be feature-detected with `typeof x === "function"`,
// and it excludes the legacy MARKER values (`isDesktop`, `platform`,
// `versions`) that the SPA preload intentionally does not set. That divergence
// is real and is pinned separately below rather than left implicit.
//
// HOW IT RUNS. Both preloads are EXECUTED here against a fake `electron`, so
// what is compared is the surface the shell really exposes and the channel
// names it really invokes — not a grep over source text that a rename would
// walk straight past. Neither file requires anything but `electron`.
//
// Run: `node --test dopl-desktop-app/test/preload-parity.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const readApp = (...p) => readFileSync(join(HERE, "..", ...p), "utf8");
const readRepo = (...p) => readFileSync(join(HERE, "..", "..", ...p), "utf8");

// ── Running a preload without Electron ───────────────────────────────────────
// `contextBridge.exposeInMainWorld` is captured, `ipcRenderer` records instead
// of sending. The real `process` is used as-is (both files only read
// `platform` / `versions` / `argv`, all harmless here).
function loadPreload(file) {
  const src = readApp("renderer", file);
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
      on() {},
      removeListener() {},
    },
  };
  const requireStub = (id) => {
    if (id === "electron") return electron;
    throw new Error(`${file} must not require ${JSON.stringify(id)}`);
  };
  // The source-extraction idiom this suite already uses (avatar-bridge-policy,
  // channel-ipc-sender): the file is CommonJS with no build step, so the only
  // way to see the REAL surface is to run it.
  new Function("require", "module", "exports", src)(
    requireStub,
    { exports: {} },
    {}
  );
  assert.equal(exposedAs, "dopl", `${file} must expose exactly one global, \`dopl\``);
  assert.ok(exposed, `${file} exposed no bridge object`);
  return { api: exposed, invocations };
}

const REMOTE = loadPreload("preload.js"); // the remote wrapper (DOPL_UI=remote)
const SPA = loadPreload("app-preload.js"); // the bundled shell (default)

// Every callable leaf, as a dotted path.
function opPaths(obj, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") out.push(path);
    else if (value && typeof value === "object") out.push(...opPaths(value, path));
  }
  return out.sort();
}

// Read a dotted path without throwing on a missing namespace.
function at(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const REMOTE_OPS = opPaths(REMOTE.api);
const SPA_OPS = opPaths(SPA.api);

// ── 1. The parity itself ─────────────────────────────────────────────────────

test("the remote preload still exposes the ops this file is about", () => {
  // A guard against the test passing vacuously: if renderer/preload.js were
  // emptied, every parity assertion below would trivially hold.
  for (const op of [
    "channels.getFolderLabel",
    "channels.chooseFolder",
    "channels.clearFolder",
    "channels.getPermissionPreset",
    "channels.setPermissionPreset",
    "sessions.reopen",
  ]) {
    assert.ok(REMOTE_OPS.includes(op), `renderer/preload.js must expose ${op}`);
  }
});

test("PARITY: every op the remote shell exposes exists in the SPA shell", () => {
  const missing = REMOTE_OPS.filter((op) => typeof at(SPA.api, op) !== "function");
  assert.deepEqual(
    missing,
    [],
    "renderer/app-preload.js is missing op(s) the remote preload exposes. Both " +
      "shells serve the same web tree, and the web tree feature-detects these " +
      "and renders NOTHING when absent — so a gap here is a silently missing " +
      "feature, not an error. Add the member to renderer/app-preload.js."
  );
});

test("the SPA is allowed its own, larger surface (this is one-directional)", () => {
  // Sanity: the invariant is remote ⊆ SPA, never SPA ⊆ remote. The SPA's own
  // ops must NOT leak into the preload for the window that hosts a REMOTE page.
  for (const spaOnly of ["apiRequest", "getAuthState", "signOut", "syncWatch"]) {
    assert.ok(SPA_OPS.includes(spaOnly), `the SPA preload must keep ${spaOnly}`);
    assert.ok(
      !REMOTE_OPS.includes(spaOnly),
      `${spaOnly} must never be exposed to the remote page's preload`
    );
  }
});

// ── 2. Same op, same wire ────────────────────────────────────────────────────
// Presence is not enough: a re-added namespace that invokes a different channel
// name, or passes positional args where main expects an object, is the same
// outage with a passing presence check. Both shells are CALLED here and their
// recorded invocations compared.
//
// Arguments are deliberately non-strings, so the shared `asId` / `asMode`
// coercion is part of what is compared.
const CALL_FIXTURES = {
  "channels.getFolderLabel": [7],
  "channels.chooseFolder": [null],
  "channels.clearFolder": [undefined],
  "channels.getPermissionPreset": [123],
  "channels.setPermissionPreset": ["c-2", { tools: 5, messages: null }],
  "sessions.reopen": [42, null],
};

test("every shared op has a wire fixture (a new one cannot slip through)", () => {
  const shared = REMOTE_OPS.filter((op) => typeof at(SPA.api, op) === "function");
  assert.deepEqual(
    Object.keys(CALL_FIXTURES).sort(),
    shared,
    "add a fixture for each shared op so its wire shape is compared too"
  );
});

test("WIRE: the shared ops invoke the same channel with the same payload", () => {
  for (const [op, args] of Object.entries(CALL_FIXTURES)) {
    REMOTE.invocations.length = 0;
    SPA.invocations.length = 0;
    void at(REMOTE.api, op)(...args);
    void at(SPA.api, op)(...args);
    assert.equal(REMOTE.invocations.length, 1, `${op}: remote must invoke exactly once`);
    assert.equal(SPA.invocations.length, 1, `${op}: SPA must invoke exactly once`);
    assert.deepEqual(
      SPA.invocations[0],
      REMOTE.invocations[0],
      `${op}: the SPA must speak the wire main already implements`
    );
  }
});

test("WIRE: sessions.reopen is the object payload main/channel-dir-ipc.js reads", () => {
  SPA.invocations.length = 0;
  void SPA.api.sessions.reopen("11111111-1111-4111-8111-111111111111", 9);
  assert.deepEqual(SPA.invocations[0], {
    channel: "sessions:reopen",
    args: [{ channelId: "11111111-1111-4111-8111-111111111111", taskId: "9" }],
  });
  // The handler it lands on is sender-bound (`mainOnly`), which resolves the
  // LIVE main window — the SPA window in DOPL_UI=spa mode — so this payload is
  // only honoured from the SPA window's own top frame.
  const IPC = readApp("main", "channel-dir-ipc.js");
  assert.match(
    IPC,
    /ipcMain\.handle\('sessions:reopen', mainOnly\(/,
    "sessions:reopen must stay registered, and stay sender-bound"
  );
});

// ── 3. What the WEB TREE detects ─────────────────────────────────────────────
// The preloads are one half of the contract; `src/` is the other. Each row
// names a capability a shared web module feature-detects, the literal
// detection it uses (re-checked against the source, so the row cannot silently
// describe code that no longer exists), and whether the SPA shell has it.
const WEB_DETECTS = [
  {
    path: "isDesktop",
    source: ["src", "shared", "lib", "desktop.ts"],
    detection: "return !!doplBridge()?.isDesktop;",
    inSpa: false,
    why:
      "DELIBERATE DIVERGENCE (2026-08-03 fleet audit). `isDesktop` is the " +
      "LEGACY WRAPPER's marker: isDesktopApp() gates the web login page into " +
      "the browser-OAuth + dopl:// handoff, which the SPA must not take — it " +
      "signs in through main (beginSignIn / passwordSignIn). Setting this in " +
      "app-preload.js would re-route the SPA's sign-in. Ask for a capability, " +
      "not for a shell's name.",
  },
  {
    path: "channels.chooseFolder",
    source: ["src", "shared", "lib", "desktop.ts"],
    detection: 'typeof channels.chooseFolder === "function"',
    inSpa: true,
  },
  {
    path: "sessions.reopen",
    source: ["src", "shared", "lib", "desktop.ts"],
    detection: 'typeof sessions.reopen === "function"',
    inSpa: true,
  },
  {
    path: "channels.getPermissionPreset",
    source: ["src", "features", "channels", "hooks", "use-channel-permission-preset.ts"],
    detection: 'typeof channels.getPermissionPreset === "function"',
    inSpa: true,
  },
  {
    path: "channels.setPermissionPreset",
    source: ["src", "features", "channels", "hooks", "use-channel-permission-preset.ts"],
    detection: 'typeof channels.setPermissionPreset === "function"',
    inSpa: true,
  },
];

test("the detection table still describes the real web tree", () => {
  for (const row of WEB_DETECTS) {
    const src = readRepo(...row.source);
    assert.ok(
      src.includes(row.detection),
      `${row.source.join("/")} no longer contains ${JSON.stringify(row.detection)} — ` +
        "the web tree's feature detection moved; update this table with it"
    );
  }
});

test("CONTRACT: what the web tree detects, the SPA shell provides", () => {
  for (const row of WEB_DETECTS.filter((r) => r.inSpa)) {
    assert.equal(
      typeof at(SPA.api, row.path),
      "function",
      `the web tree feature-detects window.dopl.${row.path} and renders NOTHING ` +
        "without it — renderer/app-preload.js must expose it"
    );
  }
});

test("CONTRACT: the one detected capability the SPA withholds stays withheld", () => {
  for (const row of WEB_DETECTS.filter((r) => !r.inSpa)) {
    assert.equal(
      at(SPA.api, row.path),
      undefined,
      `window.dopl.${row.path} must stay absent from the SPA preload. ${row.why}`
    );
    // It is the remote shell's, and it must stay there.
    assert.notEqual(
      at(REMOTE.api, row.path),
      undefined,
      `window.dopl.${row.path} must remain on the remote preload`
    );
  }
});

// ── 4. The SPA's OWN surface ─────────────────────────────────────────────────
// The remote preload cannot police the members only the SPA has — and the FIRST
// of the three gaps was exactly one of those (`avatarDataUri`: declared, con-
// sumed, never exposed, so every avatar quietly fell back to initials). So the
// other half of the contract is `@/shared/lib/spa-bridge`'s SpaBridgeSurface:
// the web tree's declaration of what the bundled shell provides. Every member
// it names must exist on the real bridge; the optional ones are optional for
// the LEGACY wrapper's benefit, never for the SPA's.
function declaredSpaMembers() {
  const src = readRepo("src", "shared", "lib", "spa-bridge.ts");
  const from = src.indexOf("export interface SpaBridgeSurface {");
  assert.notEqual(from, -1, "SpaBridgeSurface declaration not found — did it move?");
  const to = src.indexOf("\n}", from);
  assert.ok(to > from, "SpaBridgeSurface body is not brace-terminated");
  // Two-space indentation is the interface's own members; anything deeper
  // belongs to a nested options object.
  return [...src.slice(from, to).matchAll(/^ {2}(\w+)\??\s*[(:]/gm)].map((m) => m[1]);
}

test("CONTRACT: every member SpaBridgeSurface declares exists on the SPA bridge", () => {
  const declared = declaredSpaMembers();
  assert.ok(declared.length >= 8, `expected the full interface, parsed ${declared}`);
  const missing = declared.filter(
    (name) => !Object.prototype.hasOwnProperty.call(SPA.api, name)
  );
  assert.deepEqual(
    missing,
    [],
    "the web tree declares (and its call sites feature-detect) these on the " +
      "bundled bridge; renderer/app-preload.js does not expose them. An " +
      "optional member missing here degrades silently — that is how the " +
      "avatar proxy went missing."
  );
});

// ── 5. The new member widens nothing ─────────────────────────────────────────

test("the SPA preload's channel names are all literals (no dynamic channels)", () => {
  const src = readApp("renderer", "app-preload.js");
  const uses = [...src.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\(([^,)]+)/g)];
  assert.ok(uses.length > 0, "expected ipcRenderer usage in app-preload.js");
  for (const [, arg] of uses) {
    assert.match(
      arg.trim(),
      /^('[^']+'|"[^"]+"|[A-Z_]+)$/,
      `ipc channel ${arg.trim()} must be a literal/constant, never a computed name`
    );
  }
});
