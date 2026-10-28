// SHARED HARNESS for the spawn-funnel suites — `main/session-launch.js › launch`.
//
// ⚠ WHY IT IS ITS OWN FILE (2026-10-11). `session-engine-slot.test.mjs` crossed the hard 500-line
// §2 cap that `test/**/*.mjs` is linted under (`eslint.config.js`, ZERO exemptions), so
// `cd dopl-desktop-app && npm run lint` was red. The cases were split on the seam the file's own
// section headers name — the SLOT ARITHMETIC and its refusals in `session-engine-slot.test.mjs`,
// the RUNTIME-CAPABILITY declarations (D1's windowless tool floor, D3's Axis-B collapse warning)
// in `session-engine-slot-capability.test.mjs` — and the extraction machinery they both drive
// moved HERE rather than being spelled twice. Same precedent as `_ipc-harness.mjs` /
// `_auth-hold-harness.mjs`: the harness is shared, the cases are split by subject.
//
// ⚠ A SECOND COPY OF THIS HARNESS WOULD BOUND NOTHING. Half of what it does is inject the REAL
// shipped predicates (`windowlessFloorRefusal`, `axisBOpScopedWarning`, `muteRefusal`, `liveCount`,
// `MAX_CONCURRENT_SESSIONS`, `liveOnThread`, `slotKey`) rather than fakes, precisely so a case
// cannot pass against a number or a sentence the test made up. Two copies drift, and the copy that
// drifts toward `() => null` turns every case in both files green over gates that do not exist.
//
// METHOD: session-engine.js / session-launch.js are electron-bound and have no extractable pure
// block, so the functions this involves are brace-matched out and evaluated together with fakes for
// the module bindings they close over. That runs the REAL control flow — including the FIX #7
// re-check after the acquireRuntime await — and the ceiling is the REAL `liveCount` + the REAL
// constant, sliced the same way, so the cap case cannot pass against a number this test made up.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { asyncFnOf, codeOf, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MAIN = join(HERE, "..", "main");
// ⚠ `launch` MOVED TO `main/session-launch.js` ON 2026-08-21 — the spawn FUNNEL split out of
// session-engine.js at the hard 500-line §2 cap when the multiplayer wave pushed that file over.
// Same function, same control flow, same refusal shapes; only the file changed.
const ENGINE = readFileSync(join(MAIN, "session-launch.js"), "utf8");
const REGISTRY_SRC = readFileSync(join(MAIN, "session-registry.js"), "utf8");
const STORE_SRC = readFileSync(join(MAIN, "session-store.js"), "utf8");
const WINDOWLESS_SRC = readFileSync(join(MAIN, "session-windowless.js"), "utf8");
// The Dopl delivery-path pre-flight (2026-10-10). Its REFUSAL half is pure and is sliced in whole,
// `DETAIL` included — `muteRefusal` closes over it, so a slice without it returns null for every
// reason and the gate silently disappears. Same shape as CAP_DECL below.
const DELIVERY_SRC = readFileSync(join(MAIN, "delivery-path.js"), "utf8");
const DELIVERY_DETAIL = (DELIVERY_SRC.match(/^const DETAIL = \{[\s\S]*?^\};$/m) || [])[0];
assert.ok(DELIVERY_DETAIL, "the DETAIL table moved or changed shape in delivery-path.js");
// ⚠ THE REAL `session-profiles.js`, REQUIRED not sliced (2026-09-01, D1). It is the electron-free
// module, so a plain require works, and the funnel's one launch-blocking question
// (`windowlessFloorRefusal`) is therefore asked of the SHIPPED descriptors in every case below.
const REAL_PROFILES = createRequire(import.meta.url)(join(MAIN, "session-profiles.js"));

// The REAL key function, so the slot arithmetic under test is the shipped one.
const { sessionKey, slotKey, threadKeyPrefix } = new Function(
  `${fnOf(STORE_SRC, "sessionKey")}\n${fnOf(STORE_SRC, "slotKey")}\n${fnOf(STORE_SRC, "threadKeyPrefix")}\n` +
    ` return { sessionKey, slotKey, threadKeyPrefix };`
)();
export { slotKey };

// ...and the REAL ceiling. `session-windowless.js` requires consent / targeting / channel-post at
// its top, so it cannot simply be imported into a plain node test; the two members `launch`
// touches are sliced instead.
const CAP_DECL = (WINDOWLESS_SRC.match(/^const MAX_CONCURRENT_SESSIONS = \d+;$/m) || [])[0];
assert.ok(CAP_DECL, "MAX_CONCURRENT_SESSIONS moved or changed shape in session-windowless.js");
export const sessionWindowless = new Function(
  `${CAP_DECL}\n${fnOf(WINDOWLESS_SRC, "liveCount")}\n return { liveCount, MAX_CONCURRENT_SESSIONS };`
)();

const LAUNCH_SRC = asyncFnOf(ENGINE, "launch");
// ⚠ CODE ONLY. `launch`'s comments NAME the branches that were deleted — that is the house rule
// (nothing is removed silently) — so a negative grep over the raw source would fail on the very
// annotation that documents the removal. Line comments blanked; `launch` carries no string
// literal containing `//`.
export const LAUNCH_CODE = codeOf(LAUNCH_SRC);

export const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
export const AGENT = "a1b2c3d4";
export const THREAD = "11111111-2222-3333-4444-555555555555";

export function harness(cfg = {}) {
  const calls = { started: [], diag: [], acquired: [], signIn: [] };
  const sessions = new Map();
  // `newAgentId` is injected deterministic (the real one is a CSPRNG); the cases are about launch
  // minting one and threading it through the key, the spec and the answer.
  let minted = 0;
  const store = { sessionKey, slotKey, threadKeyPrefix };
  // The REAL `liveOnThread` (session-registry.js), sliced not faked: the auth-hold read resolves
  // through it, and a fake could pass over a scan that does not match the key format.
  const registry = new Function(
    "deps", "store",
    `${fnOf(REGISTRY_SRC, "liveOnThread")}\n${fnOf(REGISTRY_SRC, "sessionOn")}\n return { liveOnThread, sessionOn };`
  )({ sessions }, store);
  const deps = {
    sessions,
    // Throws where no runtime can load; records WHICH id the funnel forwarded (it never invents one).
    acquireRuntime: async (runtimeId) => {
      calls.acquired.push(runtimeId);
      if (cfg.sdkThrows) throw new Error("no agent runtime on this machine");
      if (cfg.duringSdk) cfg.duringSdk(sessions);
      const rt = cfg.rtId ? { id: cfg.rtId } : {};
      return cfg.signedOut ? { ...rt, credentialState: async () => ({ usable: false, source: null }) } : rt;
    },
    startSession: async (spec) => {
      calls.started.push(spec);
      if (cfg.startSessionReturns !== undefined) return cfg.startSessionReturns;
      const s = { ...spec, sessionId: "sess-1", settled: false };
      sessions.set(spec.key, s); // the real startSession sets the Map before its first await
      return s;
    },
    liveOnThread: registry.liveOnThread,
    sessionOn: registry.sessionOn,
  };
  const api = new Function(
    "deps", "store", "sessionWindowless", "diag", "newAgentId", "isAgentId", "profiles",
    "ontologyReach", "roomRoster", "refuseUnknownModel", "launchDefault", "credentials", // faked; own suites drive the real ones
    "operatorTools", "refuseUnreadableProtocol", "offeredDimensions", // faked: operator-tools / sdk-shape / launch-dimensions suites drive the real ones
    "deliveryPath", // the REAL `muteRefusal` over a configurable reason (see below)
    `${LAUNCH_SRC}\n${asyncFnOf(ENGINE, "credentialMissing")}\n${fnOf(ENGINE, "hasLiveSession")}\n${fnOf(ENGINE, "isAuthHeldSession")}\n` +
      ` return { launch, hasLiveSession, isAuthHeldSession };`
  )(
    deps,
    store,
    sessionWindowless,
    (...a) => calls.diag.push(a.join(" ")),
    () => `mint${String(minted++).padStart(4, "0")}`,
    (v) => typeof v === "string" && /^[a-z][a-z0-9]{7}$/.test(v),
    // ⚠ 2026-09-01 (D1): the WINDOWLESS TOOL FLOOR refusal, injected REAL by default so the
    // happy path is measured against the shipped predicate over the shipped descriptors — a
    // fake `() => null` here would make every other case in this file green over a check that
    // does not exist. `cfg.floorRefusal` overrides it for the refusal case, which is the only
    // way to reach a null floor without editing a shipped adapter.
    {
      windowlessFloorRefusal: (id) => (cfg.floorRefusal !== undefined ? cfg.floorRefusal : REAL_PROFILES.windowlessFloorRefusal(id)),
      // ⚠ 2026-09-01 (D3): Axis B's collapse WARNING, also injected REAL. Codex declares
      // `opScoped: 'unverified'`, so this really does fire on the shipped tree — which is the
      // point: the predicate had no consumer at all before this.
      axisBOpScopedWarning: (id) => (cfg.opScopedWarning !== undefined ? cfg.opScopedWarning : REAL_PROFILES.axisBOpScopedWarning(id)),
    },
    // ⚠ 2026-09-09 (F-681): the ontology-reach PRODUCER, faked — an HTTP read behind a device
    // token this file has neither of. `test/ontology-reach-producer.test.mjs` pins the real
    // module's promise never to throw.
    {
      fetchOntologyReach: async () => {
        if (cfg.reachThrows) throw new Error("reach exploded");
        return cfg.ontologies || [];
      },
    },
    // ⚠ 2026-09-18: the ROOM-ROSTER producer, faked like the one above it — the real one reads two
    // HTTP routes, and `room-roster.test.mjs` pins its own promises (no call in a solo room, one
    // bounded read otherwise, fail-open). Here the funnel only has to AWAIT it and survive a throw.
    { fetchRoomRoster: async () => { if (cfg.rosterThrows) throw new Error("roster exploded"); return cfg.roster || { agents: [], agentsMore: 0, people: [], peopleMore: 0, read: 'skipped' };
    } }, async () => cfg.modelRefusal || null, { withRuntimeDefault: async (_rt, model) => model },
    { needSignIn: (id) => calls.signIn.push(id) }, { launchScope: () => cfg.operatorScope || '' },
    async () => cfg.shapeRefusal || null, async (_rt, _model, raw) => cfg.dimensions || raw || {},
    // ⚠ 2026-10-10 (device-token-fix): the DOPL DELIVERY-PATH pre-flight. `muteRefusal` is the
    // REAL one — sliced, not faked, for `windowlessFloorRefusal`'s reason: it owns the refusal
    // WORD, and a `() => null` here would make every case in this file green over a gate that
    // does not exist. Only the READ is configurable (`cfg.deliveryBlocked`), because the real
    // one asks electron-store for a credential this file has none of. Default '' = a machine
    // with a bearer, which is what every other case in this file assumes.
    {
      deliveryBlockedReason: async () => cfg.deliveryBlocked || '',
      muteRefusal: new Function(`${fnOf(DELIVERY_SRC, "muteRefusal")}\n${DELIVERY_DETAIL}\n return muteRefusal;`)(),
    });
  return { ...api, sessions, calls };
}

// A live session occupying a slot, as the registry holds it.
export const live = (key, over = {}) => [key, { key, settled: false, state: {}, ...over }];

// ⚠ EVERY CALL CARRIES `windowless: true`. It is not ceremony: it is the ONLY spawn shape left,
// and the early return in front of it is pinned on its own in the refusals test in
// `session-engine-slot.test.mjs`.
export const call = (a) => ({ windowless: true, ...a });
