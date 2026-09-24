// LAUNCH-CRITICAL (2026-08-04) — A FRESH INSTALL RECEIVED NOTHING IN CHANNELS.
//
// THE DEFECT. `trigger.handleTrigger` opened with:
//
//     if (!(await spawner.claudeAvailable())) { diag(…); return; }
//
// and `claudeAvailable` answers ONE question: is there an EXTERNAL `claude` on
// PATH (`claude-resolve.resolveClaude` = `probeStaticPath()` || `probeLoginShell()`).
// The binary a SESSION runs is not that one — it ships INSIDE the app bundle
// (`sdk-loader.resolveClaudeExecutable`, asar-unpacked and signed), which is what
// `session-auth-detect.js` already says in its header.
//
// So on any machine whose owner never separately installed the Claude Code CLI —
// which is the ordinary case for someone who just downloaded Dopl — every inbound
// channel request returned at that line: NO consent row, NO native notification,
// NO pre-consent window, nothing anywhere in the product. Silent, and invisible
// from a developer machine where the CLI is present and the startup diag reads
// `claudeAvailable: true`.
//
// WHAT THIS FILE PINS, and why it is worth its own file: the two questions must
// stay APART and the trigger must ask the right one. The regression is cheap to
// re-introduce precisely because the wrong probe reads fine at the call site
// ("is claude available? then spawn") — it is only wrong if you know there are
// two binaries. So the assertions are about the SEAM, not about a return value:
//   1. a trigger survives an absent EXTERNAL cli when the BUNDLED one resolves;
//   2. it is still refused when NEITHER resolves (the gate is not just deleted);
//   3. the external probe is not consulted at all when the bundled one answers;
//   4. `handleTrigger`'s source does not reach for `claudeAvailable` again.
//
// METHOD: `trigger.js` is electron-bound, so — like `classify.test.mjs` and
// `first-class-task-id.test.mjs` — the gate is exercised through the real source
// of `sessionSpawnAvailable` plus a source ASSERTION on `handleTrigger`, rather
// than by booting the module. `sessionSpawnAvailable` lives in `claude-runtime.js`
// (split out at the §2 cap, and because the question deserved a home of its own);
// it is source-extracted and evaluated against injected probes, which is exactly
// the pair of facts the function combines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { codeOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, "..", "main", f), "utf8");

const TRIGGER = read("trigger.js");
const RUNTIME = read("claude-runtime.js");
const SPAWNER = read("session-spawner.js");
const LISTENER = read("channel-listener.js");

/** Brace-balancing slice — the idiom the other trigger/targeting suites use. */
function extractFn(src, name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return src.slice(start, i);
}

/**
 * Build the REAL `sessionSpawnAvailable` with the runtime registry injected.
 *
 * `require` and `diag` are free variables inside the extracted body, so they are supplied here.
 * The only thing it may require is the registry (P3-01): it required `./sdk-loader`, a module
 * deleted with the adapter port, and this harness pinned that dead name (the injected `require`
 * answered it), so every case passed while the real probe always threw.
 */
function buildProbe({ connected }) {
  const calls = { asked: 0 };
  const fakeRequire = (name) => {
    assert.equal(name, "./runtime", "the spawn question is the runtime registry's");
    return {
      connectedIds: async () => {
        calls.asked++;
        if (connected === "throw") throw new Error("probe exploded");
        return connected;
      },
    };
  };
  const fn = new Function(
    "require",
    "diag",
    `${extractFn(RUNTIME, "sessionSpawnAvailable")}\n return sessionSpawnAvailable;`
  )(fakeRequire, () => {});
  return { fn, calls };
}

// ── 1. the regression itself ───────────────────────────────────────────────────

test("THE BUG: no external CLI, the bundled runtime loads -> a session CAN be spawned", async () => {
  // This is the fresh-install machine. The registry's Claude adapter answers `available()` from
  // the bundled SDK; an external `claude` on PATH is not asked at all.
  const { fn, calls } = buildProbe({ connected: ["claude"] });
  assert.equal(await fn(), true);
  assert.equal(calls.asked, 1);
});

test("P3-01: NOT Claude-only — a Mac whose only usable runtime is Codex answers requests", async () => {
  const { fn } = buildProbe({ connected: ["codex"] });
  assert.equal(await fn(), true);
});

test("NOTHING usable -> false. The gate is narrowed, not deleted", async () => {
  // With nothing that can run a session, a notification would promise an answer that cannot come.
  const { fn } = buildProbe({ connected: [] });
  assert.equal(await fn(), false);
});

test("a THROWING probe answers false (the trigger defers), never a crash", async () => {
  const { fn } = buildProbe({ connected: "throw" });
  assert.equal(await fn(), false);
});

test("SMOKE: every module the spawn and sign-in paths require really exists", () => {
  // The dead `./sdk-loader` name survived because every suite injected `require`. This one does
  // not: each lazy `require('./…')` in these files is resolved from `main/` for real.
  const req = createRequire(join(HERE, "..", "main", "index.js"));
  for (const file of ["claude-runtime.js", "claude-auth.js", "runtime-credentials.js"]) {
    const src = read(file);
    const names = [...src.matchAll(/require\('(\.\/[^']+)'\)/g)].map((m) => m[1]);
    assert.ok(names.length > 0, file);
    for (const name of names) assert.doesNotThrow(() => req.resolve(name), `${file} requires ${name}`);
  }
  assert.equal(typeof req("./claude-runtime.js").sessionSpawnAvailable, "function");
  assert.equal(typeof req("./runtime-credentials.js").signIn, "function");
});

// ── 2. the call sites, so the right question stays asked ───────────────────────

/** Source with `//` comments stripped — a fix is allowed to NAME what it fixed. */
const uncommented = (src) => src.replace(/^\s*\/\/.*$/gm, "");

test("handleTrigger gates on sessionSpawnAvailable and no longer on claudeAvailable", () => {
  const body = uncommented(extractFn(TRIGGER, "handleTrigger"));
  assert.match(body, /spawner\.sessionSpawnAvailable\(\)/, "the trigger asks 'can a session run'");
  assert.ok(
    !/spawner\.claudeAvailable\(\)/.test(body),
    "the trigger must not ask the EXTERNAL-CLI question again — that is the bug"
  );
});

test("the startup notice fires on the spawn question, not on the PATH probe", () => {
  // The visible half of the same conflation: it announced "Channel auto-responses
  // stay off until it is installed" to every install without the external CLI,
  // while the bundled binary was sitting there able to answer.
  const src = uncommented(LISTENER);
  assert.match(src, /claudeRuntime\.checkRuntimeAtStart\(/, "the warning reads the spawn question");
  assert.ok(
    !/Claude CLI not found on PATH\. Channel auto-responses stay off/.test(src + RUNTIME),
    "the old, false notice copy is gone"
  );
  // …and the surviving copy names no one vendor: any runtime can answer (P3-01).
  assert.match(RUNTIME, /copy\.noRuntimeCopy\(null\)/);
  assert.ok(!/No Claude Code runtime was found/.test(RUNTIME));
});

test("the two questions keep two names", () => {
  // Collapsing them is the tempting 'cleanup' that would re-open this: the
  // auxiliary commands (`claude mcp …`, `claude setup-token`) genuinely need a
  // binary on PATH, so `claudeAvailable` has a real job and must keep it.
  assert.match(codeOf(RUNTIME), /function sessionSpawnAvailable/, "the spawn question exists");
  assert.match(codeOf(SPAWNER), /claudeAvailable,/, "…and the external-CLI question is still exported");
});
