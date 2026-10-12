// Shared harness for the two shell-mode suites.
//
// ⚠ EXTRACTED 2026-10-12 AT THE §2 CAP. `test/shell-mode.test.mjs` crossed 500 lines when the
// clicked-notification cold-window cases landed, so the channel-navigation half moved to
// `test/shell-mode-channel-nav.test.mjs`. Both load the SAME real modules the same way, and a
// second copy of this loader is exactly the drift a split is supposed to avoid: `loadShell`'s
// stub list is a statement about shell-mode's dependency set, and two of them would disagree.
//
// Nothing here is a test. It is the module loader both suites evaluate the real sources with.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
export const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
export const SHELL = M("shell-mode.js");
export const INDEX = M("index.js");
// The deep-link half moved out of index.js when the `dopl://open` verb joined
// the auth handoff and the file hit the 500-line cap.
export const DEEP_LINK = M("deep-link.js");

/** The REAL segment rule (`main/deep-link-target.js`), for the cases whose subject IS a rejection. */
export const REAL_SAFE = require(join(HERE, "..", "main", "deep-link-target.js")).isSafeSegment;

/**
 * The REAL `deep-link.js`, evaluated with a stub `require` — so a cold-window push exercises the
 * shipped `pushRoute`, not a double of it. ⚠ WHOLESALE, never a sliced function body: this is the
 * one answer to "push a route at a cold window" and a slice would pin its POSITION in that file
 * rather than its behaviour (Brief § source-text probes).
 *
 * ⚠ **`timer` IS A CLOSURE PARAMETER, NOT A PATCHED GLOBAL.** The module body is evaluated with
 * `setTimeout` as a named argument, so a test owns the clock for ITS instance only — no
 * `globalThis` mutation to leak into another case, and nothing bound through `this`.
 */
export function loadDeepLink({ timer } = {}) {
  const stub = (id) => {
    // `app` is only touched inside `arm()`, which neither suite calls.
    if (id === "electron") return { app: { on() {}, setAsDefaultProtocolClient() {} } };
    if (id === "./config") return { PROTOCOL: "dopl" };
    if (id === "./deep-link-target") return { isSafeSegment: () => true };
    throw new Error("unexpected require in deep-link: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", DEEP_LINK)(
    stub,
    mod,
    mod.exports,
    timer || setTimeout
  );
  return mod.exports;
}

/**
 * A clock the caller advances by hand, as a CLOSURE over its own queue.
 * ⚠ `pending()` and `delays()` are the CONTROL: a case that asserts "fired after the gap" must
 * first prove a timer was ever scheduled, or it passes on a module that schedules nothing.
 */
export function makeClock() {
  let queue = [];
  const fake = (fn, ms) => {
    queue.push({ fn, at: Number(ms) || 0 });
    // `pushRoute` does not unref, but a caller might; answer the shape either way.
    return { unref() {} };
  };
  return {
    setTimeout: fake,
    delays: () => queue.map((t) => t.at),
    pending: () => queue.length,
    /** Fire every timer due within `ms`, leaving the rest queued. */
    advance(ms) {
      const due = queue.filter((t) => t.at <= ms);
      queue = queue.filter((t) => t.at > ms);
      for (const t of due) t.fn();
      return due.length;
    },
  };
}

/**
 * The real `shell-mode.js`, evaluated with a stub `require` — it has no module-scope dependencies.
 * ⚠ `safe` defaults to "everything passes" so a routing case is not also a segment-rule case;
 * the degrade case hands in `REAL_SAFE`, because a rejected id is the thing it asserts.
 * ⚠ `deepLink` lets a case hand in a clock-controlled instance; omitted, it is the real module on
 * the real clock, which is every other case byte for byte.
 */
export function loadShell(safe = () => true, deepLink = null) {
  const stub = (id) => {
    if (id === "./update-required-window") {
      return {
        createUpdateRequiredWindow: () => ({ id: "update-screen", on() {}, show() {} }),
        closeUpdateRequiredWindow: () => {},
      };
    }
    if (id === "./deep-link-target") return { isSafeSegment: safe };
    // ⚠ THE REAL ONE. A fake here would make every cold-window assertion vacuous.
    if (id === "./deep-link") return deepLink || loadDeepLink();
    throw new Error("unexpected require: " + id);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", SHELL)(stub, mod, mod.exports);
  return mod.exports;
}
