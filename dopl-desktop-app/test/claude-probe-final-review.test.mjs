// FINAL REVIEW 2026-10-08 (KB "SDK Final Review 2026-10-08", Claude semantic probe + its LOWs), one repro each:
//   H1  a slow / errored probe turn is NEVER a refusal (a refusal rejects the version for good)
//   M2  a probe that cannot run (signed out, offline, error result) is not counted and parks nothing
//   M3  every probe's spend is recorded, logged, and shown to the operator
//   L1  (HIGH since c455e1fc) a launch contract or init missing what is checked REFUSES
//   L2  an MCP server is matched by its exact token, not a prefix
//   L4  probe temp folders left by a crash are swept
//   L6  cost-rate saves are coalesced, never one write per turn
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { updates, registry, runner, source, h, setup, record } from "./_runtime-updates-harness.mjs";

const require = createRequire(import.meta.url);
const sem = require("../main/runtime/claude/semantics.js");
const lc = require("../main/runtime/claude/launch-contract.js");
const copy = require("../main/runtime/runtime-copy.js");
const rates = require("../main/runtime/claude/cost-rates.js");
const liveStore = require("../main/runtime/live-store.js");
const normalize = require("../main/runtime/claude/normalize.js").normalize;

beforeEach(() => updates.inject());

// ── H1: the reviewer's repro (`/tmp/sdk-review/timeout-repro.mjs`), verbatim fake SDK ─────────────────
/** Emits the model's Bash tool_use, then hangs (slow CLI / network) until aborted. Never calls the gate. */
const hangingSdk = (first) => ({
  query({ options }) {
    const ac = options.abortController;
    return (async function* () {
      yield first || { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: {} }] } };
      await new Promise((_res, rej) => ac.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    })();
  },
});

test("H1: a turn aborted by its timeout mid tool-call is inconclusive, never refuse (gate + outside read)", async () => {
  for (const name of ["probeGate", "probeShellOutside"]) {
    const r = await sem[name]({ sdk: hangingSdk(), options: {}, cwd: "/tmp", timeoutMs: 200 });
    assert.equal(r.verdict, "inconclusive", name);
    assert.match(r.why, /did not finish in time/);
  }
});

test("H1: an is_error result is never a refusal, even with the tool_use and no gate call", async () => {
  const sdk = { query: () => (async function* () {
    yield { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: {} }] } };
    yield { type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1 };
  })() };
  for (const name of ["probeGate", "probeShellOutside", "probeDeny", "probeShellDeny"]) {
    const r = await sem[name]({ sdk, options: {}, cwd: mkdtempSync(join(tmpdir(), "dopl-fr-cwd-")), timeoutMs: 2000 });
    assert.notEqual(r.verdict, "refuse", name);
  }
});

test("H1: EVIDENCE still refuses on a timed-out turn (a write that happened is a write that happened)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "dopl-fr-cwd-"));
  const sdk = { query({ prompt, options }) {
    writeFileSync(/touch (\S+)/.exec(prompt)[1], "");
    return hangingSdk().query({ options });
  } };
  try {
    assert.equal((await sem.probeGate({ sdk, options: {}, cwd, timeoutMs: 200 })).verdict, "refuse");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

// ── M2: could not run → unrun, stop spending ───────────────────────────────────────────────────────
test("M2: an error result with no answer (offline, signed out, rate-limited) is UNRUN, and no further probe runs", async () => {
  let queries = 0;
  const sdk = { query: () => { queries += 1; return (async function* () {
    yield { type: "result", subtype: "error_during_execution", is_error: true, result: "Invalid API key" };
  })(); } };
  const r = await sem.verifySemantics({ sdk, options: {}, timeoutMs: 2000 });
  assert.deepEqual(r.refuse, []);
  assert.deepEqual(r.inconclusive, []);
  assert.equal(r.unrun.length, 1);
  assert.equal(queries, 1, "the first unrun turn stops the other three");
});

test("M2: no assistant message before the timeout is UNRUN, not inconclusive", async () => {
  const r = await sem.probeGate({ sdk: hangingSdk({ type: "system", subtype: "init" }), options: {}, cwd: "/tmp", timeoutMs: 200 });
  assert.equal(r.verdict, "unrun");
});

test("M2: an unrun probe is not counted, parks nothing, rejects nothing; the next check probes again", async () => {
  setup(registry(mkdtempSync(join(tmpdir(), "dopl-reg-")), "0.3.10"), runner());
  let probes = 0;
  const src = source({ verifySemantics: async () => { probes += 1; return { refuse: [], inconclusive: [], unrun: ["offline"], turns: 0 }; } });
  for (let i = 0; i < 5; i += 1) assert.equal(await updates.check(src), "failed");
  assert.equal(probes, 5, "never parked: every check tries");
  assert.equal(record().attention ?? null, null, "no attempt counted");
  assert.deepEqual(record().rejected, []);
  assert.ok(h.diags.some((l) => /not judged .* not counted/.test(l)));
});

test("M2: unrun wins over an earlier inconclusive (nothing was judged), and over nothing else", async () => {
  setup(registry(mkdtempSync(join(tmpdir(), "dopl-reg-")), "0.3.10"), runner());
  const src = source({ verifySemantics: async () => ({ refuse: [], inconclusive: ["the model did not try the Bash tool"], unrun: ["offline"], turns: 1 }) });
  assert.equal(await updates.check(src), "failed");
  assert.equal(record().attention ?? null, null);
});

test("M2: signed out → the probe cannot run → no download, no probe, not counted", async () => {
  const reg = registry(mkdtempSync(join(tmpdir(), "dopl-reg-")), "0.3.10");
  setup(reg, runner());
  let probes = 0;
  const src = source({ probeReady: () => false, verifySemantics: async () => { probes += 1; return { refuse: [], inconclusive: [] }; } });
  assert.equal(await updates.check(src), "failed");
  assert.equal(reg.calls.tarball, 0, "nothing downloaded");
  assert.equal(probes, 0);
  assert.ok(h.diags.some((l) => /waits .*not signed in/.test(l)));
});

test("M2: Claude's source reports unrun when signed out, without driving the SDK", async () => {
  const src = require("../main/runtime/claude/update-source.js");
  assert.equal(typeof src.probeReady, "function");
  // No Electron safeStorage here, so the credential reads as absent: exactly the signed-out path.
  const r = await src.verifySemantics("/nonexistent/claude");
  assert.deepEqual(r, { refuse: [], inconclusive: [], unrun: ["Claude Code is not signed in to Dopl"], turns: 0 });
});

// ── M3: the spend is visible ────────────────────────────────────────────────────────────────────────
test("M3: every probe's turns are counted from the CLI's own results and summed", async () => {
  const sdk = { query: () => (async function* () {
    yield { type: "assistant", message: { content: [{ type: "text", text: "no" }] } };
    yield { type: "result", subtype: "success", num_turns: 2 };
  })() };
  const r = await sem.verifySemantics({ sdk, options: {}, timeoutMs: 2000 });
  assert.equal(r.turns, 8, "4 probes × 2 turns each");
});

test("M3: the updater records and logs the spend, and keeps it through the switch it paid for", async () => {
  setup(registry(mkdtempSync(join(tmpdir(), "dopl-reg-")), "0.3.10"), runner());
  assert.equal(await updates.check(source({ verifySemantics: async () => ({ refuse: [], inconclusive: [], turns: 4 }) })), "updated");
  assert.deepEqual({ ...record().probe, at: 0 }, { version: "0.3.10", turns: 4, verdict: "passed", at: 0 });
  assert.ok(h.diags.some((l) => /0\.3\.10 safety probe used 4 model turns on this account \(passed\)/.test(l)));
  assert.equal(updates.lastProbe("fake"), null, "lastProbe answers for registered sources only (start() registers)");
});

test("M3: the operator's sentence names the build, the turns and what happens next; nothing when nothing was spent", () => {
  const d = { label: "Claude Code" };
  assert.equal(copy.probeNotice(d, { version: "2.1.300", turns: 4, verdict: "passed" }),
    "Safety check of Claude Code 2.1.300 used 4 short model turns on this account. Dopl uses it now.");
  assert.match(copy.probeNotice(d, { version: "2.1.300", turns: 1, verdict: "refused" }), /1 short model turn on .* will not use this version\.$/);
  assert.match(copy.probeNotice(d, { version: "2.1.300", turns: 3, verdict: "inconclusive" }), /check it again later\.$/);
  assert.equal(copy.probeNotice(d, { version: "2.1.300", turns: 0, verdict: "not-run" }), null);
  assert.equal(copy.probeNotice(d, null), null);
  assert.ok(!/—/.test(copy.probeNotice(d, { version: "1", turns: 2, verdict: "passed" })), "no em dash in product copy");
});

// ── L1 (HIGH): missing fields refuse ─────────────────────────────────────────────────────────────────
const INIT = { type: "system", subtype: "init", permissionMode: "default", tools: ["Read"] };
const CONTRACT = { permissionMode: "default", tools: ["Read"], denied: [], servers: [], strictServers: true };

test("L1: a contract with no permission mode, or no tool bound, REFUSES (never 'nothing to compare')", () => {
  assert.deepEqual(lc.verifyInit(INIT, CONTRACT), { refuse: [] }, "the complete pair passes");
  assert.match(lc.verifyInit(INIT, { ...CONTRACT, permissionMode: null }).refuse.join(), /no permission mode to check/);
  assert.match(lc.verifyInit(INIT, { ...CONTRACT, tools: null }).refuse.join(), /no tool bound to check/);
  assert.ok(lc.verifyInit(INIT, {}).refuse.length >= 2, "an empty contract refuses on both");
});

test("L1: an init with no permission mode, no tools, or no init at all REFUSES", () => {
  assert.match(lc.verifyInit({ ...INIT, permissionMode: undefined }, CONTRACT).refuse.join(), /did not report its permission mode/);
  assert.match(lc.verifyInit({ ...INIT, tools: undefined }, CONTRACT).refuse.join(), /did not report the tools/);
  const none = lc.verifyInit(null, CONTRACT).refuse.join();
  assert.match(none, /permission mode/);
  assert.match(none, /tools/);
});

test("L1: end to end, the normalizer stops the session on each (no init at all: the first message stops it)", () => {
  const ctx = () => ({ launchContract: CONTRACT, launchVerified: false, windows: new Map() });
  for (const init of [{ ...INIT, permissionMode: undefined }, { ...INIT, tools: undefined }]) {
    assert.ok(normalize(init, ctx()).some((e) => e.type === "safety_mismatch"));
  }
  const firstWord = normalize({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }, ctx());
  assert.ok(firstWord.some((e) => e.type === "safety_mismatch"), "no init before the model speaks");
  const contractless = normalize(INIT, { launchContract: { ...CONTRACT, permissionMode: null }, windows: new Map() });
  assert.ok(contractless.some((e) => e.type === "safety_mismatch"));
});

// ── L2 ──────────────────────────────────────────────────────────────────────────────────────────────
test("L2: a foreign server whose name begins with a configured one is foreign", () => {
  const c = { ...CONTRACT, tools: [], servers: ["dopl"] };
  assert.deepEqual(lc.verifyInit({ ...INIT, tools: ["mcp__dopl__dopl_send_message"] }, c), { refuse: [] });
  assert.match(lc.verifyInit({ ...INIT, tools: ["mcp__dopl__evil__x"] }, c).refuse.join(), /did not configure/);
  assert.equal(lc.configuredServer("mcp__dopl__", ["dopl"]), false, "no tool part: not a tool of that server");
});

// ── L4 ──────────────────────────────────────────────────────────────────────────────────────────────
test("L4: probe folders older than any probe are swept; fresh ones and others' folders are not", () => {
  const root = mkdtempSync(join(tmpdir(), "dopl-sweep-"));
  const old = Date.now() / 1000 - 2 * 3600;
  for (const p of sem.TEMP_PREFIXES) { const d = join(root, `${p}old`); mkdirSync(d); utimesSync(d, old, old); }
  mkdirSync(join(root, `${sem.TEMP_PREFIXES[0]}fresh`));
  const other = join(root, "someone-else"); mkdirSync(other); utimesSync(other, old, old);
  assert.equal(sem.sweepStale(root), 3);
  assert.ok(existsSync(join(root, `${sem.TEMP_PREFIXES[0]}fresh`)));
  assert.ok(existsSync(other));
  rmSync(root, { recursive: true, force: true });
});

// ── L6 ──────────────────────────────────────────────────────────────────────────────────────────────
test("L6: a burst of turns is no burst of disk writes (the shared store coalesces); flush writes it once", () => {
  let writes = 0;
  liveStore.inject({ readFile: () => { throw new Error("none"); }, writeFile: () => { writes += 1; }, rename: () => {}, file: () => "/dev/null/x", diag: () => {} });
  rates.reset();
  const u = (usd) => ({ m: { costUSD: usd, inputTokens: 100, outputTokens: 0 } });
  for (let i = 0; i < 20; i += 1) rates.learn(u(0.001));
  assert.equal(writes, 0, "no synchronous write per turn");
  liveStore.flush();
  assert.ok(writes >= 1 && writes <= 2, "one coalesced write (tmp + rename at most)");
  assert.equal(rates.cheapest(["m"]), "m", "and the rates are current in memory at once");
  liveStore.inject();
});

// ── L1 (HIGH, reviewer's re-check of c455e1fc): an EMPTY profile must offer no built-ins, and be checked ───
test("L1: the launch ALWAYS sends an explicit tools bound; an empty profile sends [] (measured: no built-ins)", () => {
  const src = readFileSync(new URL("../main/runtime/claude/launch-spec.js", import.meta.url), "utf8");
  assert.match(src, /options\.tools = Array\.isArray\(cfg\.builtinTools\) \? cfg\.builtinTools\.slice\(\) : \[\];/);
  assert.doesNotMatch(src, /if \(cfg\.builtinTools\.length\)/, "never conditional on a non-empty list");
  // What that line does to an empty, a missing and a malformed profile list:
  const bind = (builtinTools) => (Array.isArray(builtinTools) ? builtinTools.slice() : []);
  assert.deepEqual(bind([]), []);
  assert.deepEqual(bind(undefined), []);
  assert.deepEqual(bind("Read"), []);
});

test("L1: an EMPTY bound means no built-ins: any offered built-in refuses; an omitted bound refuses outright", () => {
  const empty = lc.contractOf({ permissionMode: "default", tools: [], disallowedTools: [], mcpServers: {} });
  assert.deepEqual(empty.tools, []);
  assert.deepEqual(lc.verifyInit({ ...INIT, tools: [] }, empty), { refuse: [] }, "nothing offered: clean");
  assert.match(lc.verifyInit({ ...INIT, tools: ["Bash"] }, empty).refuse.join(), /outside this launch's bound \(Bash\)/);
  const omitted = lc.contractOf({ permissionMode: "default", disallowedTools: [], mcpServers: {} });
  assert.equal(omitted.tools, null);
  assert.match(lc.verifyInit({ ...INIT, tools: [] }, omitted).refuse.join(), /no tool bound to check/);
});
