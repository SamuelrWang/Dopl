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
  // ⚠ TWO MORE JOINED HERE ON 2026-08-20 (the arm-vs-durable-posture split): the pin failed
  // on the ADD, which is the review this comment records:
  //   • The main-process handlers EXIST and were checked first — `main/channel-dir-ipc.js`
  //     registers `channels:getLaunchPosture` / `channels:setLaunchPosture`, both
  //     `appWindowOnly`, both UUID-gating `channelId`, with BOTH axes re-validated against
  //     the frozen enums in `main/channel-prefs.js › normalizePreset` (a half-valid pair is
  //     rejected whole and writes nothing).
  //   • THEY WIDEN THE SAME AUTHORITY THE SETTINGS TAB ALREADY HANDS THE OPERATOR, on a
  //     record with exactly ONE consumer: `sessions:launch`, the operator's own Launch
  //     button. It is SUPERVISION, not containment — a forged `set` to `bypass` cannot
  //     escape the channel's tool profile or `session-profiles.js › SESSION_HARD_DENY`, and
  //     Axis B still refuses to let any tool posture send a message.
  //   • ⚠ AND SINCE LATER THE SAME DAY THEY ARE THE ONLY POSTURE OPS ON THIS BRIDGE. The
  //     entry above used to end "IT IS NOT THE ARM — `channels.get/setPermissionPreset` stays
  //     single-use, 30-minute, consent-only (H2), and wiring either pair to the other's
  //     consumer re-opens the failure H2 exists to prevent". Both arm ops are DELETED
  //     (Samuel's ruling), together with their main-process handlers and the whole
  //     `channelPermissionPresets` record. The warning still applies to THIS pair and is
  //     what the one-consumer census in `test/session-preset-start.test.mjs` enforces:
  //     `channels.setLaunchPosture` writes a record read by `sessions:launch` and by nothing
  //     else, and a second reader is H2 re-opened whether or not an arm exists to contrast it
  //     with.
  "channels.getLaunchPosture",
  // ⚠ TWO OPS WERE REMOVED FROM THIS LIST ON 2026-08-20, and a REMOVAL is exactly what this
  // file exists to catch — so it is stated rather than absorbed. `channels.getPermissionPreset`
  // and `channels.setPermissionPreset` sat between the two entries above and below. The pin's
  // premise is "a removed op is a silently missing feature", and the check that premise
  // demands was made: the feature was ALREADY missing. The arm's web controls lived in
  // `launch-panel.tsx`'s INBOUND branch, which stopped rendering at the 2026-08-18 consent
  // rewrite (the panel's one consumer is the outbound send box, so `kind === "inbound"` was
  // never true in production — measured, F-233). Nothing feature-detected these two, because
  // nothing could reach them. The main-process handlers are gone with them, so leaving them
  // pinned would assert a bridge to nowhere.
  "channels.setAutoSend",
  "channels.setLaunchPosture",
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
  // ⚠ JOINED 2026-08-22 with Samuel's ended-agent ruling: `sessions.forgetThread` drops every
  // LOCAL trace of a deleted thread's ended agents (frozen history, durable record, resume map,
  // ended card, notice guard). Main cannot see the server's delete cascade, so without a call
  // from the SPA an ended agent's history outlives its thread by up to seven days. It deletes
  // no `channel_messages` and cannot touch a LIVE session — the SPA ends those first.
  "sessions.forgetThread",
  // ⚠ ONE JOINED HERE ON 2026-08-20: `sessions.launch`, the Agents tab's "Launch
  // agent" button — attach MY OWN agent to a thread, windowless. Handler exists
  // (`main/channel-dir-ipc.js › sessions:launch`, appWindowOnly, UUID-gated channel
  // AND task). It DOES start a query — the materially different shape Phase 5's
  // stop verbs called out — and that is the feature: the same authority the
  // consent Allow exercises, here exercised by the operator on their OWN thread
  // with no peer involved. Posture is main's (auto_inbound / channel auto-send);
  // the renderer hands over ids and display strings only.
  "sessions.launch",
  // ⚠ FOUR JOINED HERE ON 2026-08-20 (F-212's closure — the AGENT WINDOW). The pin failed
  // on the ADD, which is the review this comment records. They are NOT equivalent to each
  // other and are reviewed separately:
  //
  //   `sessions.message` — ⚠ THE ONE OP ON THIS BRIDGE THAT STARTS A TURN, and the only
  //     reason this namespace's failure direction is no longer simply "an agent that
  //     stops". Handler: `main/channel-dir-ipc.js › sessions:message`, appWindowOnly,
  //     UUID-gated channel, body capped in BOTH layers (the preload's is a convenience,
  //     main's `MESSAGE_CAP` is the fence), empty-after-trim refused, and the version floor
  //     applies. It dispatches the EXISTING `steer` reducer event through
  //     `session-reopen.js › messageByTask` — no new branch and no second wake path — on a
  //     session resolved by (channel, thread) against MAIN'S OWN registry, which is what
  //     makes it own-agents-only structurally rather than by a check. The text is delimited
  //     with that session's nonce and carries OPERATOR authority (`session-seed.js ›
  //     frameOperatorTurn`); it is deliberately NOT fenced as data, and that file states
  //     why. ⚠ It BYPASSES the inbound gate, correctly: AXIS B governs counterparty turns,
  //     and this is the operator's own keyboard in a window main created. Worst case of a
  //     forged call: the operator's own agent does work they did not ask for, inside its
  //     existing profile and containment — it grants no tool, widens no posture, reaches no
  //     other machine, and cannot post without the outbound gate.
  //   `sessions.openAgentWindow` — `threads.openWindow`'s twin, verbatim guards: it ASKS
  //     for a window and gets none back, three strings character-checked (UUID + two
  //     `isSafeSegment`), one `{ ok: false }` refusal shape, version floor honoured.
  //   `sessions.narration` / `sessions.onNarration` — READ-ONLY, derived from in-memory
  //     state: no path, no token, no window handle, and explicitly no `inputFull` (which is
  //     unbounded by construction — `main/session-narration.js` states what may enter a
  //     ring entry). Read once on mount, then listen, like `summaries`/`onSummaries`.
  "sessions.message",
  "sessions.narration",
  "sessions.onNarration",
  "sessions.onSummaries",
  "sessions.openAgentWindow",
  "sessions.pause",
  "sessions.reopen",
  // ⚠ ONE JOINED HERE ON 2026-08-20: `sessions.setMode`, the agent view's LIVE permission
  // controls. The pin failed on the ADD, which is the review this comment records:
  //   • The main-process handler EXISTS and was checked first — `main/channel-dir-ipc.js`
  //     registers `sessions:setMode`, `appWindowOnly`, UUID-gating `channelId`, with the
  //     AXIS restricted to the two literals and the MODE re-validated against
  //     `session-profiles.js`'s frozen enums (the same normalizers `channel-prefs.js`
  //     uses) — and the reducer coerces AGAIN fail-closed via `coerceMode`, so an unknown
  //     value lands on the most restrictive member of its axis rather than half-applying.
  //   • ⚠ IT WIDENS SUPERVISION, NEVER CONTAINMENT — the review this op turns on. The two
  //     axes decide whether the OPERATOR IS ASKED. The PROFILE decides what is reachable at
  //     all, is checked FIRST, and no posture can widen it: `SESSION_HARD_DENY` is
  //     unconditional, and `bypass` is a POSITIVE allow-list, so an unclassified tool (any
  //     built-in a newer CLI ships, every tool from the operator's own MCP servers) gates in
  //     EVERY mode, `bypass` included. So the worst a forged call achieves is to stop asking
  //     about tools this operator's own channel profile ALREADY PERMITS.
  //   • THAT IS THE SAME AUTHORITY THE DURABLE POSTURE ALREADY HANDS THEM. `channels.
  //     setLaunchPosture` sets exactly these two axes for the next spawn; this sets them on a
  //     session already running. A forged call buys a few minutes' head start on a decision
  //     the operator can make from the Settings tab, and reaches no other machine.
  //   • ⚠ IT IS NOT THAT DURABLE POSTURE AND MUST NOT BE WIRED TO IT. This writes NOTHING —
  //     it moves one live session's reducer state, and the channel's stored posture is
  //     untouched. Collapsing the two would make a per-session decision permanent.
  "sessions.setMode",
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
