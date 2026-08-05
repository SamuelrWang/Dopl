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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
 * Build the REAL `sessionSpawnAvailable` with its two probes injected.
 *
 * `require` and `diag` are free variables inside the extracted body (the module
 * requires them at its own scope), so they are supplied here — which is also how
 * the bundled probe's THROW path gets exercised without a real sdk-loader.
 */
function buildProbe({ bundled, external }) {
  const calls = { bundled: 0, external: 0 };
  const fakeRequire = (name) => {
    assert.equal(name, "./sdk-loader", "the bundled probe must come from sdk-loader");
    calls.bundled++;
    return {
      resolveClaudeExecutable: () => {
        if (bundled === "throw") throw new Error("electron.app unavailable");
        return bundled;
      },
    };
  };
  const claudeAvailable = async () => {
    calls.external++;
    return external;
  };
  const fn = new Function(
    "require",
    "diag",
    "claudeAvailable",
    `${extractFn(RUNTIME, "sessionSpawnAvailable")}\n return sessionSpawnAvailable;`
  )(fakeRequire, () => {}, claudeAvailable);
  return { fn, calls };
}

// ── 1. the regression itself ───────────────────────────────────────────────────

test("THE BUG: no external CLI, bundled binary present -> a session CAN be spawned", async () => {
  // This is the fresh-install machine. Before the fix `handleTrigger` returned on
  // exactly this shape and the operator received nothing at all.
  const { fn, calls } = buildProbe({
    bundled: "/Applications/Dopl.app/…/app.asar.unpacked/…/claude",
    external: false,
  });
  assert.equal(await fn(), true);
  // …and the external probe is never even consulted: it is a login-shell exec
  // with a 6s timeout, on the inbound path of every trigger.
  assert.equal(calls.external, 0, "the external probe should not run once the bundled one answers");
});

test("no bundled binary, external CLI present -> still true (the headless fallback)", async () => {
  // A dev tree, or a build whose optional platform package did not install. The
  // headless spawner runs the external CLI, so a request is still answerable.
  const { fn, calls } = buildProbe({ bundled: null, external: true });
  assert.equal(await fn(), true);
  assert.equal(calls.external, 1);
});

test("NEITHER -> false. The gate is narrowed, not deleted", async () => {
  // The half that keeps this a fix rather than a removal: with nothing that can
  // run a session, a consent row would promise an answer that cannot come.
  const { fn } = buildProbe({ bundled: null, external: false });
  assert.equal(await fn(), false);
});

test("a THROWING bundled probe degrades to the external one, never to a crash", async () => {
  // sdk-loader pulls `electron.app` at module scope. A harness (or a launch order
  // that has not created the app yet) must not take the whole trigger path down —
  // which is the failure mode this function exists to remove.
  const present = buildProbe({ bundled: "throw", external: true });
  assert.equal(await present.fn(), true);
  const absent = buildProbe({ bundled: "throw", external: false });
  assert.equal(await absent.fn(), false);
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
  // …and the surviving copy does not claim the CLI is what channels needs.
  assert.match(RUNTIME, /No Claude Code runtime was found on this Mac/);
});

test("the two questions keep two names, and each says which it answers", () => {
  // Collapsing them is the tempting 'cleanup' that would re-open this: the
  // auxiliary commands (`claude mcp …`, `claude setup-token`) genuinely need a
  // binary on PATH, so `claudeAvailable` has a real job and must keep it.
  assert.match(RUNTIME, /function sessionSpawnAvailable/, "the spawn question exists");
  assert.match(SPAWNER, /claudeAvailable,/, "…and the external-CLI question is still exported");
  assert.match(
    RUNTIME,
    /is there an EXTERNAL cli for auxiliary commands/,
    "the distinction is written down where the next reader will be"
  );
});
