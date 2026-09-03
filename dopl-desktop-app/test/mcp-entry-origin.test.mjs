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
// METHOD is the directory idiom: both modules are electron-bound (app.getPath / safeStorage /
// electron-store / child_process), so the functions under test are source-extracted and driven
// with fakes.
//
// Run: `node --test dopl-desktop-app/test/mcp-entry-origin.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const CONFIG = M("mcp-config.js");
const CLI_ADD = M("mcp-cli-add.js");

// ⚠ `fnOf` anchors on the `function` keyword, so it drops a leading `async` — and this function
// is `async` and full of `await`. Re-attached here rather than loosening the shared probe.
const ENSURE = "async " + fnOf(CONFIG, "ensureMcpConfigInner");
const PARSE = fnOf(CLI_ADD, "parseEntryUrl");

const OURS = "http://localhost:3001/api/mcp";
const STALE = "http://localhost:3000/api/mcp";
const PROD = "https://www.usedopl.com/api/mcp";

// ── the driver ───────────────────────────────────────────────────────────────
// The REAL `ensureMcpConfigInner`, with every collaborator injected. `lastMintWasFresh` is a
// module-level `let` the function resets and the mint sets, so it is declared INSIDE the
// generated body and the fake mint writes it — which is exactly the real control flow.
function runEnsure(opts) {
  const calls = [];
  const diags = [];
  const body = `
    const auth = { ensureSignedIn: async () => SIGNED_IN };
    const spawner = { getClaudeBinPath: async () => BIN };
    const diag = (...a) => { DIAGS.push(a.map(String).join(" ")); };
    let lastMintWasFresh = false;
    const obtainDeviceToken = async () => {
      CALLS.push(["mint"]);
      lastMintWasFresh = FRESH;
      return TOKEN;
    };
    const removeSpawnConfig = () => { CALLS.push(["removeSpawnConfig"]); return true; };
    // ⚠ THE SKILL INSTALL RIDES THIS LANE (2026-09-03) — best-effort, and it sits between the
    // spawn-config removal and the probe so a machine whose CLI binary is unresolved
    // still gets the skill. It is in the sequence because a silent reorder that put it AFTER
    // the CLI gate would strip it from exactly those machines.
    const ensureDoplSkills = () => { CALLS.push(["skills"]); };
    const probeMcpEntry = async () => { CALLS.push(["probe"]); return PROBE; };
    const removeMcpEntry = async () => { CALLS.push(["remove"]); return REMOVE_OK; };
    const addMcpEntry = async (b, t) => { CALLS.push(["add", t]); return ADD_OK; };
    ${ENSURE}
    return ensureMcpConfigInner();
  `;
  const fn = new Function(
    "SIGNED_IN", "BIN", "TOKEN", "FRESH", "PROBE", "REMOVE_OK", "ADD_OK", "MCP_URL", "CALLS", "DIAGS",
    body
  );
  return fn(
    opts.signedIn !== false,
    opts.bin === undefined ? "/bin/claude" : opts.bin,
    opts.token === undefined ? "tok-abc" : opts.token,
    opts.fresh === true,
    opts.probe,
    opts.removeOk !== false,
    opts.addOk !== false,
    OURS,
    calls,
    diags
  ).then(() => ({ calls, diags, names: calls.map((c) => c[0]) }));
}

const present = (url) => ({ state: "present", url });
const ABSENT = { state: "absent", url: "" };
const UNKNOWN = { state: "unknown", url: "" };

// ── 1. THE REGRESSION: ORIGIN DRIFT IS REPAIRED ──────────────────────────────

test("an entry on ANOTHER origin is re-pointed at the current one, with no fresh mint", async () => {
  const r = await runEnsure({ probe: present(STALE), fresh: false });
  assert.deepEqual(r.names, ["mint", "removeSpawnConfig", "skills", "probe", "remove", "add"],
    "the drifted entry must be removed and re-added");
  assert.equal(r.calls.find((c) => c[0] === "add")[1], "tok-abc",
    "and re-added carrying the token this boot resolved");
  assert.ok(r.diags.some((d) => /origin drift/.test(d)), "the log must name WHICH repair ran");
  assert.ok(!r.diags.some((d) => /leaving alone/.test(d)), "this is no longer a leave-alone case");
});

test("the PROD origin is just as stale when this boot is pointed at localhost", async () => {
  // The dev→prod direction and the prod→dev direction are the same defect; a rule that only
  // repaired one of them would pass the incident above and still strand a developer.
  const r = await runEnsure({ probe: present(PROD), fresh: false });
  assert.ok(r.names.includes("remove") && r.names.includes("add"));
});

// ── 2. WHAT MUST NOT CHANGE ──────────────────────────────────────────────────

test("an entry ALREADY on the current origin is left alone (F-085 still holds)", async () => {
  // ⚠ THE POLITENESS RULE SURVIVES FOR THE MATCHING CASE, and that is deliberate: an existing
  // entry may be one the OPERATOR hand-wrote with their own credential, and from outside we
  // cannot tell. A matching url gives us no reason to touch it, so we do not.
  const r = await runEnsure({ probe: present(OURS), fresh: false });
  assert.deepEqual(r.names, ["mint", "removeSpawnConfig", "skills", "probe"], "no remove, no add");
  assert.ok(r.diags.some((d) => /leaving alone/.test(d)));
});

test("a FRESH MINT still refreshes a matching entry — the pre-existing reason", async () => {
  // A fresh mint revoked the bearer the entry carries, so it must be re-written even though the
  // url is right. This branch predates the origin rule and is not replaced by it.
  const r = await runEnsure({ probe: present(OURS), fresh: true });
  assert.deepEqual(r.names, ["mint", "removeSpawnConfig", "skills", "probe", "remove", "add"]);
  assert.ok(r.diags.some((d) => /fresh mint/.test(d)));
});

test("a confirmed-ABSENT entry is added, never removed first", async () => {
  const r = await runEnsure({ probe: ABSENT });
  assert.deepEqual(r.names, ["mint", "removeSpawnConfig", "skills", "probe", "add"]);
});

test("an UNKNOWN probe touches NOTHING — no add (dupes) and no remove (blind clobber)", async () => {
  const r = await runEnsure({ probe: UNKNOWN, fresh: true });
  assert.deepEqual(r.names, ["mint", "removeSpawnConfig", "skills", "probe"],
    "even a fresh mint must not act on an answer the CLI did not give");
  assert.ok(r.diags.some((d) => /unknown/.test(d)));
});

test("a present entry with an UNPARSEABLE url is not treated as drifted", async () => {
  // '' means "we could not read it", not "it is wrong". Guessing here would remove an entry on
  // the strength of a parser miss — the blind-clobber case again, in a different coat.
  const r = await runEnsure({ probe: present(""), fresh: false });
  assert.deepEqual(r.names, ["mint", "removeSpawnConfig", "skills", "probe"]);
});

// ── 3. THE EARLIER GATES ARE UNCHANGED ───────────────────────────────────────

test("signed out / no cli / no token all stop BEFORE the probe", async () => {
  assert.deepEqual((await runEnsure({ signedIn: false, probe: present(STALE) })).names, []);
  assert.deepEqual((await runEnsure({ bin: "", probe: present(STALE) })).names, []);
  assert.deepEqual((await runEnsure({ token: "", probe: present(STALE) })).names, ["mint"]);
});

// ── 4. THE URL PARSER TAKES THE URL LINE AND NOTHING ELSE ────────────────────

function parseUrl(stdout) {
  return new Function("stdout", `${PARSE}\n return parseEntryUrl(stdout);`)(stdout);
}

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

test("⚠ neither the entry's url nor the token is interpolated into a diag on this path", () => {
  // The repair diag names the REASON ('origin drift' / 'fresh mint') and the outcome. A source
  // pin because this is a property of what is WRITTEN, not of what a fake returns.
  // ⚠ The check is for the IDENTIFIER passed as an argument, not for the WORD: "no device token"
  // is a perfectly good log line, and a grep that cannot tell a message from a value would ban it
  // while still missing `diag(x, t)`. So: no diag argument may BE one of these bindings.
  const argsOf = (src) => [...src.matchAll(/\bdiag\(([^;]*?)\);/g)].map((m) => m[1]);
  const passesValue = (src, name) =>
    argsOf(src).some((args) =>
      new RegExp(`(^|,)\\s*${name.replace(".", "\\.")}\\s*(,|$)`).test(args) ||
      new RegExp(`\\$\\{${name.replace(".", "\\.")}\\}`).test(args)
    );
  // ⚠ POSITIVE CONTROL FIRST — the guard must actually FIRE on a leak, or a
  // vacuous pass reads as a clean bill. (This replaces a bug: the identifier was
  // passed DOUBLE-escaped, `"probe\\.url"`, so `.replace(".", "\\.")` produced a
  // regex `probe\\.url` — a LITERAL backslash — which no real diag line has, so
  // the assertion could never match and tested nothing.) The name here is the
  // single-escaped identifier `probe.url`; `passesValue` does the regex escaping.
  assert.ok(
    passesValue("diag('origin drift', probe.url);", "probe.url"),
    "control: a bare-argument leak MUST trip the guard"
  );
  assert.ok(
    passesValue("diag(`stale ${probe.url}`);", "probe.url"),
    "control: an interpolated leak MUST trip the guard"
  );
  assert.ok(
    !passesValue("diag('no device token found');", "token"),
    "control: the WORD in a message must NOT trip the guard — only the value"
  );

  assert.ok(!passesValue(ENSURE, "probe.url"), "probe.url must never be logged");
  assert.ok(!passesValue(ENSURE, "token"), "the token must never be logged");
  assert.ok(!passesValue(ENSURE, "MCP_URL"), "our own url stays out of it too");
  // And the whole module: the only place the bearer is allowed to appear is an argv/header build.
  assert.ok(!/diag\([^)]*Bearer/.test(CONFIG) && !/diag\([^)]*Bearer/.test(CLI_ADD));
});

test("probeMcpEntry returns the three states and nothing else", () => {
  const src = fnOf(CLI_ADD, "probeMcpEntry");
  for (const state of ["present", "absent", "unknown"]) {
    assert.ok(src.includes(`'${state}'`), `${state} branch present`);
  }
  // The boolean it replaced must be gone as CODE — a surviving export or call site would let a
  // caller re-adopt the two-answer probe that could not see drift in the first place. The NAME
  // is still allowed to appear in prose (both files explain what it was and why it went).
  assert.ok(!/^\s*function\s+mcpEntryConfirmedAbsent/m.test(CLI_ADD), "the boolean probe is retired");
  assert.ok(!/module\.exports[\s\S]*mcpEntryConfirmedAbsent/.test(CLI_ADD), "and not exported");
  assert.ok(!/mcpEntryConfirmedAbsent\s*\(/.test(CONFIG), "and nothing still calls it");
});
