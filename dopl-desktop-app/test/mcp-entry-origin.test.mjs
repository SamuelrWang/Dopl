// THE CLI'S `dopl` MCP ENTRY MUST FOLLOW THE ORIGIN THE APP IS ACTUALLY TALKING TO.
//
// THE BUG (2026-08-25, measured live on the operator's machine). `ensureMcpConfigInner` had
// exactly two outcomes for an entry that already existed: refresh it if THIS boot minted a fresh
// token, otherwise "dopl entry present/unknown — leaving alone". Nothing consulted the entry's
// URL. So an entry written while the app pointed at one origin survived every later boot against
// a DIFFERENT one — and there is no re-mint on a boot inside the 7-day reuse margin, so the
// refresh branch never fired either.
//
// What that looked like on the machine this was found on: the app was booted with
// `DOPL_APP_URL=http://localhost:3001`, the spawn-config file had already been repaired to
// `http://localhost:3001/api/mcp` (that path compares the WHOLE body, so it self-heals), and
// `claude mcp get dopl` still answered:
//
//     Status: ✘ Failed to connect
//     Issue: ConnectionRefused: Unable to connect. Is the computer able to access the url?
//     URL: http://localhost:3000/api/mcp
//
// Nothing was listening on 3000. Every manual `claude` run on that machine, and every lane
// reading the user-scope entry rather than our own two, called a dead endpoint indefinitely.
//
// ⚠ WHAT WAS **NOT** BROKEN, because it is the reason this hid: the SDK SESSION path never reads
// this entry. `sdk-loader.js › buildMcpServers` builds its entry in memory off the compiled-in
// MCP_URL every spawn. (A third surface, the on-disk spawn config, self-healed by whole-body
// comparison; S3 deleted it outright — `mcp-config.js › removeSpawnConfig`, 2026-08-26, which
// is why the ensure sequence below now reads `removeSpawnConfig` where it read
// `writeSpawnConfig`.) This was the one Dopl MCP surface with no origin repair at all.
//
// THE FIX, in two parts, both pinned below:
//   • `mcp-cli-add.js › probeMcpEntry` answers THREE states, not a boolean — 'absent' /
//     'present' (with the parsed url) / 'unknown'. The old `mcpEntryConfirmedAbsent` could not
//     tell "an entry exists and points elsewhere" from "the CLI did not answer", so it had to
//     leave both alone.
//   • `mcp-config.js › ensureMcpConfigInner` repairs on ORIGIN DRIFT as well as on a fresh mint,
//     and touches nothing on 'unknown'.
//
// ⚠ AND THE TOKEN NEVER LEAVES. `claude mcp get dopl` prints the entry's
// `Authorization: Bearer …` back out, so §3 pins that the parser takes the URL line ONLY and
// that no diag on this path is handed anything parsed out of that stdout.
//
// METHOD (cleanup D04, 2026-10-11): the REAL `mcp-config.js` + `mcp-device-token-lifecycle.js`
// + `mcp-device-token.js`, each loaded whole over a strict stub map (`_device-token-harness.mjs`),
// and the REAL `mcp-cli-add.js` over a fake `execFile`. No function body is sliced any more.
//
// Run: `node --test dopl-desktop-app/test/mcp-entry-origin.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadWithStubs } from "./helpers/module-sandbox.mjs";
import { deviceTokenWorld, freshRecord, minted, MCP_URL } from "./_device-token-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const OURS = MCP_URL; // the origin this boot talks to
const STALE = "http://localhost:3000/api/mcp";
const PROD = "https://www.usedopl.com/api/mcp";

// ── the driver ───────────────────────────────────────────────────────────────
// The REAL `ensureMcpConfig`. `fresh: true` = no usable cached token, so this boot MINTS
// (revoke-and-replace server-side); `fresh: false` = a cached token inside the reuse margin,
// so nothing is minted. `token: ""` = the mint fails with nothing cached. The step names are
// what the fakes record, in order: signedIn, fetch:POST (a mint), rm (spawn-file shed), skills,
// bin (external-CLI probe), probe, remove, add:<token>.
async function runEnsure(opts) {
  const fresh = opts.fresh === true || opts.token === "";
  const world = deviceTokenWorld({
    signedIn: opts.signedIn !== false,
    record: fresh ? null : freshRecord({ token: "tok-abc" }),
    fetch: opts.token === "" ? minted({}, 500) : minted({ token: "tok-abc", expiresAt: Date.now() + 90 * 86400e3 }),
    bin: opts.bin,
    probe: opts.probe,
    removeOk: opts.removeOk,
    addOk: opts.addOk,
  });
  await world.config.ensureMcpConfig();
  return { world, names: world.calls.seq, diags: world.calls.diags };
}

const present = (url) => ({ state: "present", url });
const ABSENT = { state: "absent", url: "" };
const UNKNOWN = { state: "unknown", url: "" };
const PRE = ["signedIn", "rm", "skills", "bin", "probe"]; // a reuse boot, up to the probe
const PRE_MINT = ["signedIn", "fetch:POST", "rm", "skills", "bin", "probe"];

// ── 1. THE REGRESSION: ORIGIN DRIFT IS REPAIRED ──────────────────────────────

test("an entry on ANOTHER origin is re-pointed at the current one, with no fresh mint", async () => {
  const r = await runEnsure({ probe: present(STALE), fresh: false });
  assert.deepEqual(r.names, [...PRE, "remove", "add:tok-abc"],
    "the drifted entry must be removed and re-added, carrying the token this boot resolved");
  assert.ok(r.diags.some((d) => /origin drift/.test(d)), "the log must name WHICH repair ran");
  assert.ok(!r.diags.some((d) => /leaving alone/.test(d)), "this is no longer a leave-alone case");
});

test("the PROD origin is just as stale when this boot is pointed at localhost", async () => {
  // The dev→prod direction and the prod→dev direction are the same defect; a rule that only
  // repaired one of them would pass the incident above and still strand a developer.
  const r = await runEnsure({ probe: present(PROD), fresh: false });
  assert.ok(r.names.includes("remove") && r.names.includes("add:tok-abc"));
});

// ── 2. WHAT MUST NOT CHANGE ──────────────────────────────────────────────────

test("an entry ALREADY on the current origin is left alone (F-085 still holds)", async () => {
  // ⚠ THE POLITENESS RULE SURVIVES FOR THE MATCHING CASE, and that is deliberate: an existing
  // entry may be one the OPERATOR hand-wrote with their own credential, and from outside we
  // cannot tell. A matching url gives us no reason to touch it, so we do not.
  const r = await runEnsure({ probe: present(OURS), fresh: false });
  assert.deepEqual(r.names, PRE, "no remove, no add");
  assert.ok(r.diags.some((d) => /leaving alone/.test(d)));
});

test("a FRESH MINT still refreshes a matching entry — the pre-existing reason", async () => {
  // A fresh mint revoked the bearer the entry carries, so it must be re-written even though the
  // url is right. This branch predates the origin rule and is not replaced by it.
  const r = await runEnsure({ probe: present(OURS), fresh: true });
  assert.deepEqual(r.names, [...PRE_MINT, "remove", "add:tok-abc"]);
  assert.ok(r.diags.some((d) => /fresh mint/.test(d)));
});

test("the fresh-mint flag is read AFTER the mint resolves, never before", async () => {
  // `mintWasFresh()` moved behind a getter in the D04 split; its read point is the contract.
  // (a) The launch pre-flight's mint is already in flight when startup's ensure begins: the ensure
  //     joins that flight and must see ITS answer, which only exists once the flight resolves.
  let release;
  const gate = new Promise((r) => { release = r; });
  const world = deviceTokenWorld({
    probe: present(OURS),
    fetch: async () => { await gate; return minted({ token: "tok-new", expiresAt: Date.now() + 90 * 86400e3 })(); },
  });
  const preflight = world.lifecycle.ensureDeviceToken();
  const ensure = world.config.ensureMcpConfig();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(world.calls.seq, ["signedIn", "fetch:POST"], "control: ONE mint, still in flight");
  release();
  assert.equal(await preflight, "tok-new");
  await ensure;
  assert.deepEqual(world.calls.seq, ["signedIn", "fetch:POST", "rm", "skills", "bin", "probe", "remove", "add:tok-new"],
    "the joined flight minted fresh, so the matching entry is refreshed");
  // (b) The next boot reuses that token: the flag is reset by the mint gate, not left over.
  world.calls.seq.length = 0;
  await world.config.ensureMcpConfig();
  assert.deepEqual(world.calls.seq, PRE, "a reuse boot after a fresh one leaves the entry alone");
});

test("a confirmed-ABSENT entry is added, never removed first", async () => {
  const r = await runEnsure({ probe: ABSENT });
  assert.deepEqual(r.names, [...PRE, "add:tok-abc"]);
});

test("an UNKNOWN probe touches NOTHING — no add (dupes) and no remove (blind clobber)", async () => {
  const r = await runEnsure({ probe: UNKNOWN, fresh: true });
  assert.deepEqual(r.names, PRE_MINT, "even a fresh mint must not act on an answer the CLI did not give");
  assert.ok(r.diags.some((d) => /unknown/.test(d)));
});

test("a present entry with an UNPARSEABLE url is not treated as drifted", async () => {
  // '' means "we could not read it", not "it is wrong". Guessing here would remove an entry on
  // the strength of a parser miss — the blind-clobber case again, in a different coat.
  const r = await runEnsure({ probe: present(""), fresh: false });
  assert.deepEqual(r.names, PRE);
});

// ── 3. THE EARLIER GATES ARE UNCHANGED ───────────────────────────────────────

test("signed out / no token stop BEFORE the probe", async () => {
  assert.deepEqual((await runEnsure({ signedIn: false, probe: present(STALE) })).names, ["signedIn"]);
  assert.deepEqual((await runEnsure({ token: "", probe: present(STALE) })).names, ["signedIn", "fetch:POST"]);
});

test("NO EXTERNAL CLI still mints, still sheds the spawn file, still installs the skill", async () => {
  // ⚠ THIS ASSERTION USED TO READ `[]`, AND THAT WAS THE BUG WRITTEN DOWN (2026-10-10). The
  // external probe ran BEFORE the mint, so a Mac with no separately installed Claude Code CLI —
  // most of the people this app is distributed to — never got a device token from any path
  // (`saveDeviceToken` has one caller), `buildMcpServers` returned {} for every spawn, and every
  // launched session ended `mcp-unreachable` after New Agent had reported success.
  const r = await runEnsure({ bin: "", probe: present(STALE), fresh: true });
  assert.deepEqual(r.names, ["signedIn", "fetch:POST", "rm", "skills", "bin"],
    "everything that does not need a binary must run; only the operator's CLI entry is skipped");
  assert.equal(r.world.stored().token, "tok-abc", "the token really was minted and persisted");
  assert.ok(r.diags.some((d) => /no external claude cli/.test(d)), "and the skip says which part was skipped");
});

// ── 4. THE URL PARSER TAKES THE URL LINE AND NOTHING ELSE ────────────────────
// The REAL `mcp-cli-add.js`, over a fake `execFile`.

function cliAdd(execFile) {
  const diags = [];
  const mod = loadWithStubs("mcp-cli-add.js", {
    child_process: { execFile: execFile || (() => { throw new Error("no execFile expected"); }) },
    "./session-spawner": { cliEnv: () => ({}) },
    "./diag": { diag: (...a) => diags.push(a.map(String).join(" ")) },
    "./config": { MCP_URL: OURS },
  });
  return { mod, diags };
}
const parseUrl = (stdout) => cliAdd().mod.parseEntryUrl(stdout);

// The real shape, captured from `claude mcp get dopl` on the machine this was found on. The
// header line is REAL: the CLI prints the bearer back out, which is why the parser is anchored.
const REAL_OUTPUT = [
  "dopl:",
  "  Scope: User config (available in all your projects)",
  "  Status: ✘ Failed to connect",
  "  Issue: ConnectionRefused: Unable to connect. Is the computer able to access the url?",
  "  Type: http",
  `  URL: ${STALE}`,
  "  Headers:",
  "    Authorization: Bearer dopl_at_SECRETVALUE",
  "",
  "To remove this server, run: claude mcp remove dopl -s user",
].join("\n");

test("the parser returns the URL line's value", () => {
  assert.equal(parseUrl(REAL_OUTPUT), STALE);
});

test("⚠ the parser can NEVER return credential material", () => {
  assert.ok(!/dopl_at_|Bearer/.test(parseUrl(REAL_OUTPUT)), "no bearer in the parsed url");
  // A header VALUE that itself contains the word `url:` must not be reachable: the match is
  // anchored to the start of a line and requires the whole line to be the field.
  const hostile = "  Authorization: Bearer url: https://evil.test/steal\n  URL: " + OURS;
  assert.equal(parseUrl(hostile), OURS);
});

test("no entry / empty output parses to '' (which §2 treats as 'do not act')", () => {
  for (const empty of ["", null, undefined, "No MCP server named dopl"]) {
    assert.equal(parseUrl(empty), "");
  }
});

// ── 5. NOTHING PARSED OUT OF THAT STDOUT REACHES A LOG ───────────────────────

test("⚠ neither the entry's url nor the token is interpolated into a diag on this path", async () => {
  // Every branch of the real ensure, with distinctive values, and every diag line it wrote. The
  // repair diag names the REASON ('origin drift' / 'fresh mint') and the outcome, never a value.
  const runs = [
    await runEnsure({ probe: present(STALE), fresh: false }),
    await runEnsure({ probe: present(PROD), fresh: true }),
    await runEnsure({ probe: present(OURS), fresh: true }),
    await runEnsure({ probe: present(OURS), fresh: false }),
    await runEnsure({ probe: ABSENT, fresh: true }),
    await runEnsure({ probe: UNKNOWN, fresh: true }),
    await runEnsure({ probe: present(STALE), addOk: false }),
    await runEnsure({ bin: "", probe: present(STALE), fresh: true }),
  ];
  // ⚠ POSITIVE CONTROL FIRST — the values really flowed through these runs, so their absence
  // from the log below is a finding and not an empty harness.
  assert.ok(runs.some((r) => r.names.includes("add:tok-abc")), "control: the token reached the CLI seam");
  assert.ok(runs.every((r) => r.diags.length > 0), "control: every run logged something");
  const log = runs.flatMap((r) => r.diags).join("\n");
  for (const value of ["tok-abc", STALE, PROD, OURS, "Bearer"]) {
    assert.ok(!log.includes(value), `${value} must never be logged`);
  }
  // And the modules' own text: the only place the bearer is allowed to appear is an argv build.
  for (const f of ["mcp-config.js", "mcp-device-token-lifecycle.js", "mcp-cli-add.js"]) {
    assert.ok(!/diag\([^)]*Bearer/.test(M(f)), `${f}: no diag names a bearer`);
  }
});

test("probeMcpEntry returns the three states and nothing else", async () => {
  const run = async (err, stdout) => {
    const { mod, diags } = cliAdd((_bin, _args, _opts, cb) => cb(err, stdout));
    return { answer: await mod.probeMcpEntry("/bin/claude"), diags };
  };
  assert.deepEqual((await run(null, REAL_OUTPUT)).answer, { state: "present", url: STALE });
  const absent = Object.assign(new Error("No MCP server named dopl"), { code: 1 });
  assert.deepEqual((await run(absent, "")).answer, { state: "absent", url: "" });
  const hung = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  const unknown = await run(hung, REAL_OUTPUT);
  assert.deepEqual(unknown.answer, { state: "unknown", url: "" });
  assert.ok(!unknown.diags.join("\n").includes("dopl_at_"), "the unknown branch logs no stdout");
  // The boolean it replaced must be gone as CODE — a surviving export or call site would let a
  // caller re-adopt the two-answer probe that could not see drift in the first place. The NAME
  // is still allowed to appear in prose (both files explain what it was and why it went).
  const CLI_ADD = M("mcp-cli-add.js");
  assert.deepEqual(Object.keys(cliAdd().mod).sort(), ["addMcpEntry", "parseEntryUrl", "probeMcpEntry", "removeMcpEntry"]);
  assert.ok(!/^\s*function\s+mcpEntryConfirmedAbsent/m.test(CLI_ADD), "the boolean probe is retired");
  assert.ok(!/mcpEntryConfirmedAbsent\s*\(/.test(M("mcp-config.js")), "and nothing still calls it");
});
