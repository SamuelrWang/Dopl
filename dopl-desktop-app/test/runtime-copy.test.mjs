// RUNTIME-OWNED COPY — `main/runtime/runtime-copy.js` (2026-09-21, U10).
//
// ⚠ THE DEFECT THIS FILE GUARDS. Core said `No Claude runtime on this Mac`, `Sign in to Claude`
// and `Claude Code sign-in is restored on this Mac` on paths EVERY runtime reaches, so a
// signed-out Codex session sent the operator to fix a credential the session does not use, and a
// machine running Codex perfectly well was told it had no runtime. The plan's verification bar is
// that a search of shared UI/core paths finds no hardcoded Claude error copy outside CLAUDE-OWNED
// adapter and sign-in surfaces.
//
// ⚠ THE SOURCE SCAN AT THE BOTTOM IS THE HALF THAT CANNOT ROT. Every assertion above it would
// still pass against a module that special-cased three ids by hand; the scan is what says a
// FOURTH adapter gets correct copy by registering rather than by someone remembering to add an arm.
//
// Run: `node --test dopl-desktop-app/test/runtime-copy.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);

// ⚠ REQUIRED, NOT SLICED, AND THAT IS ITSELF A CLAIM: this module must require NOTHING, so a
// plain `require` in a plain Node test is the proof. `main/runtime/index.js` is electron-free by
// contract (INVARIANTS §11.0), which is what lets the real descriptors come along for the ride.
const copy = require_(join(MAIN, "runtime/runtime-copy.js"));
const registry = require_(join(MAIN, "runtime/index.js"));
const SRC = readFileSync(join(MAIN, "runtime/runtime-copy.js"), "utf8");

const d = (id) => registry.descriptorFor(id);

// ── 1. THE SIGN-IN SENTENCE, PER RUNTIME ─────────────────────────────────────────────────────

test("a signed-out Codex says `Sign in to Codex`; the Claude path still says Claude", () => {
  assert.equal(copy.signInAction(d("codex")), null, "Codex has no in-app flow — no BUTTON");
  assert.equal(copy.signedOutLaunchCopy(d("codex")), "Sign in to Codex to start an agent");
  assert.equal(copy.heldToolDenial(d("codex")), "Sign in to Codex to continue");
  assert.match(copy.signInPointer(d("codex")), /^Sign in to Codex/);
  // ⚠ AND CODEX MUST NOT BE ABLE TO SAY CLAUDE ANYWHERE — the verification bar itself.
  for (const line of [
    copy.signedOutLaunchCopy(d("codex")), copy.heldToolDenial(d("codex")),
    copy.resumeNudge(d("codex")), copy.noRuntimeCopy(d("codex")),
    copy.authHoldCopy(d("codex"), "error").body, copy.authHoldCopy(d("codex"), "preflight").body,
    copy.errorCopy(d("codex"), "runtime-signed-out").body,
  ]) {
    assert.ok(!/Claude|Anthropic/.test(line), `a Codex sentence named Claude: ${line}`);
  }

  // ⚠ THE OTHER HALF: CLAUDE IS UNTOUCHED. A de-naming that fires on every runtime is a
  // regression, not a feature — and it still says Claude because the DESCRIPTOR does.
  assert.equal(copy.signInAction(d("claude")), "Sign in to Claude Code");
  assert.match(copy.heldToolDenial(d("claude")), /Claude/);
  assert.match(copy.resumeNudge(d("claude")), /^Claude Code sign-in is restored on this Mac/);
});

test("three runtimes, three sentences — a copy function that ignored the descriptor would pass one at a time", () => {
  for (const fn of ["noRuntimeCopy", "signedOutLaunchCopy", "heldToolDenial", "resumeNudge"]) {
    const said = registry.ids().map((id) => copy[fn](d(id)));
    assert.equal(new Set(said).size, registry.ids().length, `${fn} answered one string for every runtime`);
  }
});

test("hide, never gray: only a runtime with a real in-app flow offers an ACTION", () => {
  // ⚠ CODEX AND CURSOR DECLARE `credential.interactiveSignIn: null` — their sign-in is a
  // browser/device-code hop Dopl cannot complete in its own window. What is hidden is the
  // AFFORDANCE, never the FACT: the sentence is still said, and `authHoldCopy` falls back to a
  // POINTER so the banner never goes silent.
  assert.equal(copy.canSignIn(d("claude")), true);
  assert.equal(copy.canSignIn(d("codex")), false);
  assert.equal(copy.signInWorking(d("codex")), null);
  const held = copy.authHoldCopy(d("codex"), "error");
  assert.equal(held.actionable, false, "no button");
  assert.match(held.action, /Sign in to Codex/, "…but still a stated remedy");
  assert.equal(copy.authHoldCopy(d("claude"), "error").actionable, true);
});

// ── 2. THE STRUCTURED ERROR CODES ────────────────────────────────────────────────────────────

test("every declared code has a body, and each names the runtime that produced it", () => {
  for (const code of copy.RUNTIME_ERROR_CODES) {
    for (const id of registry.ids()) {
      const out = copy.errorCopy(d(id), code);
      assert.equal(out.code, code);
      assert.ok(out.body.length > 0, `${id}/${code} has no body`);
      assert.ok(
        out.body.includes(d(id).label) || out.title.includes(d(id).label),
        `${id}/${code} names no runtime: ${out.body}`
      );
    }
  }
});

test("an UNKNOWN code renders the generic arm — never a raw key, never silence", () => {
  // ⚠ A ROW FROZEN BY A NEWER BUILD. Passing the code through would put an enum in front of an
  // operator; answering nothing would drop a failure. The generic arm still names the RUNTIME.
  const out = copy.errorCopy(d("codex"), "quantum-decoherence");
  assert.equal(out.code, null, "an unrecognised code is not passed through as one");
  assert.ok(!/quantum-decoherence/.test(out.body));
  assert.match(out.body, /Codex/);
});

test("only the signed-out code offers a sign-in, and only where one exists", () => {
  assert.equal(copy.errorCopy(d("claude"), "runtime-signed-out").action, "Sign in to Claude Code");
  assert.equal(copy.errorCopy(d("codex"), "runtime-signed-out").action, null);
  assert.equal(copy.errorCopy(d("claude"), "runtime-crashed").action, null,
    "a crash is not fixed by signing in");
});

test("`detail` is passed through verbatim and is the ONE part allowed to name a runtime", () => {
  const out = copy.errorCopy(d("codex"), "resume-refused", "usage accounting on resume is unverified");
  assert.equal(out.detail, "usage accounting on resume is unverified");
  assert.equal(copy.errorCopy(d("codex"), "resume-refused").detail, null, "absent stays absent");
  assert.equal(copy.errorCopy(d("codex"), "resume-refused", "").detail, null, "'' is absent too");
});

// ── 3. THE UNNAMED LANE — UNKNOWN IS NOT EMPTY ───────────────────────────────────────────────

test("with no descriptor every sentence names NO vendor, and none of them is a placeholder splice", () => {
  // ⚠ A plain browser and every desktop older than the runtime port send no descriptor. Naming
  // Claude there was the old behaviour and it was wrong whenever Claude was not the runtime.
  assert.equal(copy.named(null), "", "'' is the UNKNOWN answer, distinct from a label");
  assert.equal(copy.noRuntimeCopy(null), "No agent runtime on this Mac");
  assert.equal(copy.signedOutLaunchCopy(null), "Sign in to your agent runtime to start an agent");
  for (const line of [
    copy.noRuntimeCopy(null), copy.signedOutLaunchCopy(null), copy.heldToolDenial(null),
    copy.resumeNudge(null), copy.errorCopy(null, "runtime-crashed").body,
  ]) {
    assert.ok(!/Claude|Codex|Cursor|Anthropic|OpenAI/.test(line), line);
    assert.ok(line.length > 0, "a refusal with no runtime is still a refusal");
    // ⚠ "No the agent runtime runtime on this Mac" is what a bare `${runtimeLabel(d)}` fallback
    // produces. Each sentence carries its OWN unnamed form instead.
    assert.ok(!/the agent runtime runtime/.test(line), `placeholder spliced into a named sentence: ${line}`);
  }
});

// ── 4. THE LIVE-MODEL-SWITCH REFUSAL ─────────────────────────────────────────────────────────

test("the live-model-switch refusal is per runtime and words unverified apart from a measured no", () => {
  assert.equal(copy.liveModelSwitchRefusal(d("claude")), null, "Claude keeps the control");
  const codex = copy.liveModelSwitchRefusal(d("codex"));
  assert.match(codex, /Codex/);
  assert.match(codex, /has not been measured/);
  assert.equal(
    copy.liveModelSwitchRefusal({ label: "Nomodel", session: { liveModelSwitch: false } }),
    "Nomodel cannot change a running agent's model. Start a new agent on the model you want."
  );
});

// ── 5. THE SOURCE SCAN — THE HALF THAT CANNOT ROT ────────────────────────────────────────────

test("the module names no vendor and branches on no runtime id", () => {
  // ⚠ CODE LINES ONLY. The header NAMES the vendors it exists to remove from the shared path —
  // that is this repo's house rule, comments carry the argument — so a scan over the raw source
  // would fail on the very sentence explaining why it must not appear in the code.
  const code = SRC.split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  for (const vendor of ["Claude", "Anthropic", "Codex", "OpenAI", "Cursor", "Anysphere"]) {
    assert.ok(!code.includes(vendor), `a vendor literal reached the CODE: ${vendor}`);
  }
  // ⚠ AND NO ID BRANCH EITHER — the shape a "small exception" takes the first time.
  for (const id of registry.ids()) {
    assert.ok(!code.includes(`'${id}'`) && !code.includes(`"${id}"`), `branches on the id ${id}`);
  }
});

test("the closed code set is what the table declares — no orphan body, no unbodied code", () => {
  const bodies = Object.keys(
    new Function(`${SRC.slice(SRC.indexOf("const ERROR_BODIES"), SRC.indexOf("/** Is this one of the codes above?"))}
       return ERROR_BODIES;`)()
  );
  assert.deepEqual(bodies.slice().sort(), copy.RUNTIME_ERROR_CODES.slice().sort());
});
