// THE ADAPTER CONFORMANCE SUITE — ONE set of cases, looped over EVERY registered runtime.
//
// ⚠ IT IS WRITTEN AS A LOOP ON PURPOSE, AND THAT IS THE POINT OF THE WHOLE PORT. The moment a
// second adapter registers it inherits every case here without anybody writing a second file —
// which is the mechanical half of "adapters implement only declared differences". A per-adapter
// suite would let the second one quietly hold a weaker contract than the first.
//
// WHAT IT ASSERTS, in the order the failures matter:
//   1. THE THREE THAT REFUSE. `axisB.enforcementPoint`, every profile's `denyList`, and
//      `session.usageResetsOnResume` are the places `null` is a REFUSAL and not a hidden control
//      (`main/runtime/contract.js › LAUNCH_BLOCKING`). Each is asserted twice: that the shipped
//      descriptor satisfies it, and that a descriptor which does NOT is really rejected — an
//      enforcement test that only ever sees the passing case proves nothing.
//   2. THE DESCRIPTOR IS PURE DATA. Frozen, function-free, JSON round-tripping. A function on it
//      would survive in-process and arrive at the UI as `undefined` after the IPC hop — i.e. as
//      "capability absent", the one meaning that must never be produced by accident.
//   3. ABSENT MEANS `null`, NEVER `false`-WITH-A-STUB AND NEVER `[]`. `null` is what the UI hides
//      on; an empty array renders an empty control instead of no control.
//   4. EVERY CONTRACT METHOD EXISTS WITH THE RIGHT ARITY. A silently-dropped parameter is how an
//      adapter comes to ignore the session it was handed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require = createRequire(import.meta.url);

const registry = require(join(MAIN, "runtime", "index.js"));
const contract = require(join(MAIN, "runtime", "contract.js"));
const capability = require(join(MAIN, "runtime", "capability.js"));

const ADAPTERS = registry.all();

test("at least one runtime is registered, or every case below is vacuous", () => {
  assert.ok(ADAPTERS.length >= 1, "the registry is empty — nothing can spawn");
  assert.deepEqual(registry.ids(), [...new Set(registry.ids())], "two adapters claim one id");
});

// ── 1. THE THREE THAT REFUSE ──────────────────────────────────────────────────

test("every adapter declares an Axis-B ENFORCEMENT POINT, and a null one is REFUSED", () => {
  for (const { descriptor } of ADAPTERS) {
    // ⚠ THE ARGUMENT, not just the field: Axis B needs an in-process tool boundary OR a held
    // callback. The Dopl MCP server is remote HTTP, so the desktop is not in the call path of a
    // channel call; and no posture field crosses the wire, so the server cannot refuse the post
    // either. With neither, an agent posts with NO outbound consent card at all.
    assert.ok(
      ["held-callback", "in-process"].includes(capability.axisBEnforcement(descriptor)),
      `${descriptor.id}: axisB.enforcementPoint must name a real mechanism`
    );
  }
  const broken = clone(ADAPTERS[0]);
  broken.descriptor.axisB.enforcementPoint = null;
  assert.throws(() => contract.sealAdapter(broken), /enforcementPoint is null/,
    "a runtime with no outbound gate must not register at all");
});

test("every Dopl profile carries a deny list IN THAT RUNTIME'S VOCABULARY, or the launch is refused", () => {
  // ⚠ THE ONE PLACE ABSENT DOES NOT MEAN HIDE, because the control here IS containment.
  // `grantDecision` step 1 reads the profile's deny list as the GATE's own first check — the
  // verdict no task grant and no widest mode can open — so a restricted profile with no list has
  // no enforcement at all. A native sandbox bounds the filesystem; it does not deny the
  // delegation, exfil and persistence built-ins those lists exist for.
  for (const { descriptor } of ADAPTERS) {
    for (const profile of ["read_only", "dopl_only", "full"]) {
      assert.ok(capability.canLaunchProfile(descriptor, profile),
        `${descriptor.id}: ${profile} has no deny list — ${capability.profileRefusal(descriptor, profile)}`);
      assert.equal(capability.profileRefusal(descriptor, profile), null);
    }
  }
  const broken = clone(ADAPTERS[0]);
  broken.descriptor.containment.profiles.read_only.denyList = null;
  assert.throws(() => contract.sealAdapter(broken), /denyList is not a list/);
  // …and the REFUSAL is readable, because a refusal an operator cannot read is one they work around.
  const hidden = clone(ADAPTERS[0]);
  delete hidden.descriptor.containment.profiles.dopl_only;
  assert.match(String(capability.profileRefusal(hidden.descriptor, "dopl_only")), /no deny list/);
});

// ── ⚠ 1b. D2 — AN EMPTY LIST IS A LIST, AND THE DECLARATION IS NOT THE ENFORCEMENT ───────────
//
// Two holes, filed together on 2026-08-31 and closed 2026-09-01, because they are the same hole
// seen from two sides: `sealAdapter` validated a MIRROR of the thing it claims to protect.
//
//   (a) `denyList: []` — semantically "this profile denies nothing" — passed BOTH
//       `descriptorProblems` and `canLaunchProfile`, because both asked only `Array.isArray`.
//       Nine mutations were driven against `sealAdapter`; it refused eight and admitted this one.
//   (b) `grantDecision` step 1 reads `runtime.toolConfigFor(p).disallowedTools` — the runtime
//       METHOD. It has never read `descriptor.containment.profiles.<p>.denyList`. So an adapter
//       that hand-writes a plausible descriptor while its `toolConfigFor` answers `[]` sealed
//       cleanly, `canLaunchProfile` called the profile enforced, the UI rendered containment, and
//       the gate denied nothing. MEASURED: hardcoding `denyList: []` across every Claude profile
//       failed 0 of 2786 tests; emptying the ENFORCEMENT list fired 16 pins.
//
// ⚠ THE MUTATIONS BELOW ARE THE POINT OF THE SECTION. The shipped-descriptor assertions above
// would pass just as well against the broken contract — they did, for the whole port wave.

test("D2: an EMPTY deny list is refused on a restricted profile, and allowed on `full`", () => {
  for (const profile of ["read_only", "dopl_only"]) {
    const empty = clone(ADAPTERS[0]);
    empty.descriptor.containment.profiles[profile].denyList = [];
    assert.throws(() => contract.sealAdapter(empty), /denyList is EMPTY/,
      `${profile}: a restricted profile that denies nothing must not register`);
    // …and the same rule one step later, at the launch question, with a readable sentence.
    assert.equal(capability.canLaunchProfile(empty.descriptor, profile), false, profile);
    assert.match(String(capability.profileRefusal(empty.descriptor, profile)), /denies nothing/, profile);
  }
  // ⚠ `full` IS EXEMPT AND IT IS NOT A LOOPHOLE. `full` is the profile whose supervision IS Axis A
  // rather than a list, so an empty floor there is a posture somebody chose. Every OTHER profile
  // exists because it denies something — that is what makes it a profile.
  assert.equal(contract.UNRESTRICTED_PROFILE, "full");
  const looseFull = clone(ADAPTERS[0]);
  looseFull.descriptor.containment.profiles.full.denyList = [];
  looseFull.runtime = {
    ...ADAPTERS[0].runtime,
    toolConfigFor: (p) => (p === "full"
      ? { ...ADAPTERS[0].runtime.toolConfigFor(p), disallowedTools: [] }
      : ADAPTERS[0].runtime.toolConfigFor(p)),
  };
  assert.doesNotThrow(() => contract.sealAdapter(looseFull),
    "an empty deny list on `full` is a declared posture, not an absent control");
  assert.equal(capability.canLaunchProfile(looseFull.descriptor, "full"), true);
});

test("D2: the seal reads the ENFORCED structure — a declaration that lies is REFUSED", () => {
  // ⚠ THE EXACT MUTATION THE VERIFIER PROVED HARMLESS, RUN AS A PIN. A descriptor with a
  // plausible-looking deny list over a `toolConfigFor` that enforces NOTHING is the shape a
  // fourth adapter reaches by hand-writing its descriptor instead of deriving it.
  const liar = clone(ADAPTERS[0]);
  liar.runtime = {
    ...ADAPTERS[0].runtime,
    toolConfigFor: (p) => ({ ...ADAPTERS[0].runtime.toolConfigFor(p), disallowedTools: [] }),
  };
  assert.throws(() => contract.sealAdapter(liar), /does not match what runtime\.toolConfigFor/,
    "the descriptor is a MIRROR of the gate's first check and must be DERIVED from it");
  // …and it names BOTH directions, so the adapter author is told which way the drift runs.
  assert.throws(() => contract.sealAdapter(liar), /enforced-but-undeclared|declared-but-unenforced/);

  // The inverse drift: the runtime enforces a name the descriptor never declared. The UI would
  // render containment that is narrower than the truth — less dangerous, still a lie.
  const secretive = clone(ADAPTERS[0]);
  secretive.runtime = {
    ...ADAPTERS[0].runtime,
    toolConfigFor: (p) => {
      const cfg = ADAPTERS[0].runtime.toolConfigFor(p);
      return { ...cfg, disallowedTools: cfg.disallowedTools.concat(["SomeUndeclaredTool"]) };
    },
  };
  assert.throws(() => contract.sealAdapter(secretive), /enforced-but-undeclared: \[SomeUndeclaredTool\]/);

  // ⚠ SET COMPARISON, NOT ORDERING. An adapter may build its list in whatever order it likes;
  // refusing a correct one over a cosmetic difference would be a rule nobody keeps.
  const shuffled = clone(ADAPTERS[0]);
  shuffled.descriptor.containment.profiles.read_only.denyList =
    shuffled.descriptor.containment.profiles.read_only.denyList.slice().reverse();
  assert.doesNotThrow(() => contract.sealAdapter(shuffled));
});

test("D2: every SHIPPED adapter derives its declaration from its enforcement", () => {
  // The positive half, asked of what actually ships — this is the property the mutations above
  // protect, and the reason all three adapters pass them.
  for (const { descriptor, runtime } of ADAPTERS) {
    assert.deepEqual(contract.mirrorProblems(descriptor, runtime), [], descriptor.id);
    for (const profile of ["read_only", "dopl_only", "full"]) {
      assert.deepEqual(
        descriptor.containment.profiles[profile].denyList.slice().sort(),
        runtime.toolConfigFor(profile).disallowedTools.slice().sort(),
        `${descriptor.id}/${profile}: the declared list is not the enforced one`
      );
    }
    // …and the restricted profiles really do deny something, on every runtime.
    for (const profile of ["read_only", "dopl_only"]) {
      assert.ok(runtime.toolConfigFor(profile).disallowedTools.length > 0,
        `${descriptor.id}/${profile}: a restricted profile that enforces nothing`);
    }
  }
});

test("resume is REFUSED where the usage reset is unverified — the cost cap depends on it", () => {
  // ⚠ IT BLOCKS RESUME, NOT REGISTRATION, and the difference is the whole design of the field:
  // a cold launch on such a runtime is unaffected. `session-park.js › resumeParked` zeroes both
  // delta baselines; a runtime that CONTINUES the cumulative total makes every delta negative,
  // `session-io.js › applyCoreEvents` clamps it to zero, and `session-state.js › costCapReached`
  // is then never reached — the budget control silently stops existing.
  // ⚠ REPAIRED 2026-08-31, WHEN THE CODEX ADAPTER ARMED IT, AND THE OLD ASSERTION WAS THE DEFECT.
  // It read `if (!session.resume) continue; assert.equal(canResume, true)` — i.e. "a runtime that
  // declares resume MUST be able to resume", which is the exact opposite of the field's design and
  // of this case's own comment. `usageResetsOnResume: 'unverified'` is supposed to REFUSE A RESUME
  // on a runtime that HAS one; `adapter-architecture.md` §1.4 declares all three adapters
  // unverified, so the old form would have rejected every honest declaration and rewarded the one
  // adapter willing to assume its own answer. What the guard is really for is that a resume is
  // never SILENTLY allowed over an unmeasured baseline — so that is what it asserts now.
  for (const { descriptor } of ADAPTERS) {
    if (!descriptor.session.resume) continue;
    if (capability.canResume(descriptor)) {
      assert.equal(descriptor.session.usageResetsOnResume, true,
        `${descriptor.id}: resume is allowed on an unmeasured usage baseline`);
      assert.equal(capability.resumeRefusal(descriptor), null,
        `${descriptor.id}: resume is allowed and refused at the same time`);
      continue;
    }
    // Refused — and the refusal has to be READABLE, because a refusal an operator cannot read is
    // a refusal they work around.
    assert.match(String(capability.resumeRefusal(descriptor)), /unverified|continues cumulative/,
      `${descriptor.id}: resume is blocked with no reason an operator could act on`);
  }
  const unverified = clone(ADAPTERS[0]);
  unverified.descriptor.session.usageResetsOnResume = "unverified";
  assert.doesNotThrow(() => contract.sealAdapter(unverified), "it must still REGISTER — cold launch is fine");
  assert.equal(capability.canResume(unverified.descriptor), false);
  assert.match(String(capability.resumeRefusal(unverified.descriptor)), /unverified/);
});

// ── 2. THE DESCRIPTOR IS PURE DATA ────────────────────────────────────────────

test("every descriptor is deep-frozen, function-free and JSON round-trips", () => {
  for (const { descriptor } of ADAPTERS) {
    assert.ok(Object.isFrozen(descriptor), `${descriptor.id}: descriptor is mutable`);
    assert.ok(Object.isFrozen(descriptor.toolMode.options), "…and so is every nested value");
    assert.throws(() => { descriptor.toolMode.default = "bypass"; }, /read only|Cannot assign/);
    const round = JSON.parse(JSON.stringify(descriptor));
    assert.deepEqual(round, JSON.parse(JSON.stringify(descriptor)), `${descriptor.id}: does not round-trip`);
    // The IPC hop is a structured clone; a function would arrive as absent, which is the one
    // meaning that must never be produced by accident.
    assert.deepEqual(contract.descriptorProblems(descriptor), []);
  }
  const impure = clone(ADAPTERS[0]);
  impure.descriptor.models.list = () => [];
  assert.throws(() => contract.sealAdapter(impure), /PURE DATA/);
});

// ── 3. ABSENT IS `null`, NEVER `false`-WITH-A-STUB AND NEVER `[]` ─────────────

test("an absent capability is null — an empty array would render an empty control", () => {
  // ⚠ THE FIELDS CHECKED HERE ARE THE HIDE-ON-ABSENT ONES. `null` is the signal the UI hides on
  // (§3.2); `[]` renders a control with nothing in it, and `false` renders a control that lies.
  const NULLABLE = [
    ["models.dimensions", (d) => d.models.dimensions],
    ["toolMode.secondaryAxis", (d) => d.toolMode.secondaryAxis],
    ["toolMode.freeform", (d) => d.toolMode.freeform],
    ["approval.categories", (d) => d.approval.categories],
    ["containment.nativeControls", (d) => d.containment.nativeControls],
    ["deepLink", (d) => d.deepLink],
    ["prose.toolSearchVerb", (d) => d.prose.toolSearchVerb],
    ["mcp.perToolApproval", (d) => d.mcp.perToolApproval],
    ["mcp.eagerLoadFlag", (d) => d.mcp.eagerLoadFlag],
  ];
  for (const { descriptor } of ADAPTERS) {
    for (const [path, read] of NULLABLE) {
      const value = read(descriptor);
      assert.ok(value === null || (value !== undefined && !isEmptyish(value)),
        `${descriptor.id}: ${path} is ${JSON.stringify(value)} — absent must be null, never [] / '' / false`);
    }
  }
});

test("the Axis-A modes are ordered NARROWEST FIRST, and the windowless floor is one of them", () => {
  // ⚠ THE ORDER IS LOAD-BEARING. `[0]` is where every unknown value fail-closes, and the LAST
  // entry is the widest mode — which is how the windowless floor stays widen-only and how "is
  // this tool classified at all" is asked without core holding a copy of any allow-list.
  for (const { descriptor, runtime } of ADAPTERS) {
    const modes = capability.toolModes(descriptor);
    assert.ok(modes.length >= 2, `${descriptor.id}: fewer than two Axis-A modes`);
    assert.equal(capability.normalizeToolMode(descriptor, "not-a-mode"), modes[0], "unknown fail-closes to the narrowest");
    assert.equal(capability.narrowestToolMode(descriptor), descriptor.toolMode.default,
      "the default IS the narrowest — a session starts asking, and park resets it there");
    const floor = capability.windowlessToolFloor(descriptor);
    assert.ok(modes.includes(floor), `${descriptor.id}: windowlessFloor '${floor}' is not one of its modes`);
    // WIDEN-ONLY, driven rather than asserted: every mode floors to one at or above the floor,
    // and the widest is never narrowed.
    for (const mode of modes.concat(["", null, "garbage"])) {
      const floored = capability.floorWindowlessTool(descriptor, mode);
      assert.ok(modes.indexOf(floored) >= modes.indexOf(floor), `${descriptor.id}: ${mode} floored BELOW the floor`);
    }
    assert.equal(capability.floorWindowlessTool(descriptor, capability.widestToolMode(descriptor)),
      capability.widestToolMode(descriptor), "the widest mode is never narrowed by a floor");
    // ⚠ AND THE FLOOR REALLY REACHES A TOOL. A mode that fail-closes to a vocabulary the runtime
    // does not speak allows NOTHING, which on a surface-less session is a silent deny of every
    // read the prompt orders the agent to make — the failure this declaration exists to prevent.
    const auto = capability.toolTaxonomy(descriptor).auto;
    assert.ok(auto.length > 0 && runtime.axisAAllows(floor, auto[0]),
      `${descriptor.id}: the windowless floor allows no tool at all`);
  }
});

// ── 4. THE METHOD SURFACE ─────────────────────────────────────────────────────

test("every runtime implements every contract method, at the declared arity", () => {
  for (const { descriptor, runtime } of ADAPTERS) {
    assert.deepEqual(contract.runtimeProblems(runtime, descriptor.id), []);
    for (const [name, arity] of Object.entries(contract.RUNTIME_METHODS)) {
      assert.equal(typeof runtime[name], "function", `${descriptor.id}.${name}`);
      assert.equal(runtime[name].length, arity, `${descriptor.id}.${name} arity`);
    }
  }
  const short = clone(ADAPTERS[0]);
  short.runtime = { ...ADAPTERS[0].runtime, normalize: (msg) => [msg] };
  assert.throws(() => contract.sealAdapter(short), /normalize takes 1 arguments/);
});

test("the id is the SAME word on the descriptor, the runtime and the wire", () => {
  // ⚠ THREE COPIES WITH NO SHARED MODULE ACROSS THE LAST HOP: the header literal is read by a
  // regex in `runtime-stamp-literals.test.mjs` (it must stay a literal), and core stamps
  // `runtime.id` onto every session. A mismatch would make a session resolve its tools against
  // one runtime while its MCP calls claim another.
  for (const { descriptor, runtime } of ADAPTERS) {
    assert.equal(runtime.id, descriptor.id, `${descriptor.id}: the runtime half claims a different id`);
    assert.equal(registry.runtimeFor(descriptor.id), runtime);
    assert.equal(registry.descriptorFor(descriptor.id), descriptor);
  }
});

test("an unknown runtime id resolves to the DEFAULT rather than refusing", () => {
  // ⚠ A DIFFERENT KIND OF FAIL-CLOSED FROM A GATE'S, and deliberately so. An unknown id is a
  // session record written by a build that knew a runtime this one does not; refusing would
  // strand the session with no way to end it. Nothing is GRANTED by the choice — every posture,
  // profile and gate decision is re-derived per call.
  // ⚠ THE JUNK VALUES MUST BE WORDS THAT WILL NEVER BE A RUNTIME ID. This list read `"codex"`
  // until 2026-08-31, when the Codex adapter registered and the case started asserting that a
  // REAL runtime resolves to the default — which is the one thing `resolve` must never do, and
  // which would have silently run every Codex session on the wrong adapter's tool tables had the
  // assertion been written the other way round.
  for (const junk of ["", "  ", null, undefined, 42, {}, "not-a-runtime", "claude-code"]) {
    assert.equal(registry.runtimeFor(junk).id, registry.DEFAULT_ID, JSON.stringify(junk));
  }
  // …and the inverse, so "everything resolves to the default" can never be how this passes.
  for (const id of registry.ids()) assert.equal(registry.runtimeFor(id).id, id);
});

// ── the packaging claim is a MEASUREMENT, not a belief ────────────────────────

test("a bundled runtime's unpack globs are the build file's, verbatim", () => {
  // ⚠ A DESCRIPTOR THAT PARAPHRASES THE BUILD IS ONE THAT WILL BE WRONG the first time the build
  // changes. The platform binary cannot exec from inside the read-only asar and codesign cannot
  // sign a file inside it, so these globs are what make a bundled runtime launchable at all.
  const build = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).build;
  for (const { descriptor } of ADAPTERS) {
    if (descriptor.packaging.delivery !== "bundled") {
      assert.equal(descriptor.packaging.unpackGlobs, null, `${descriptor.id}: a path-delivered runtime unpacks nothing`);
      continue;
    }
    for (const glob of descriptor.packaging.unpackGlobs) {
      assert.ok(build.asarUnpack.includes(glob),
        `${descriptor.id}: '${glob}' is not in package.json › build.asarUnpack`);
    }
  }
});

// ── the triage fence is DECLARED, not just built ──────────────────────────────

test("every declared triage carries a turn bound and an MCP surface, or it is not a fence", () => {
  for (const { descriptor } of ADAPTERS) {
    const t = descriptor.triage;
    if (t === null) continue; // a runtime that cannot triage says so; nothing calls it
    // ⚠ AN UNBOUNDED TRIAGE TURN READING UNTRUSTED GUEST TEXT IS AN UNFENCED ONE, and `null` here
    // is the shape that ships one silently.
    assert.ok(typeof t.turnBound === "number" && t.turnBound >= 1, `${descriptor.id}: triage.turnBound`);
    assert.ok(t.mcpSurface != null, `${descriptor.id}: triage.mcpSurface — no way to say "no Dopl surface"`);
    assert.ok(["none", "deny-callback"].includes(t.toolSurface), `${descriptor.id}: triage.toolSurface`);
    assert.equal(t.cwdFence, "tmp", "the router has no business knowing the channel folder exists");
    assert.equal(t.ambientIsolation, true);
    assert.equal(t.envScrub, true);
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────

// A MUTABLE deep copy of a sealed adapter, so a case can build the failing descriptor the
// contract is supposed to reject. ⚠ The shipped one is frozen, which is what the case above pins.
function clone(adapter) {
  return { descriptor: JSON.parse(JSON.stringify(adapter.descriptor)), runtime: adapter.runtime };
}

function isEmptyish(v) {
  if (Array.isArray(v)) return v.length === 0;
  if (v === "" || v === false) return true;
  return typeof v === "object" && v !== null && Object.keys(v).length === 0;
}
