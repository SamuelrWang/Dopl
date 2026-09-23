// THE ONE LINE THAT MAKES THE CONTEXT METER REACHABLE ON CODEX — `launch-spec.js`'s usage fold.
//
// ⚠ ITS OWN FILE, AND THE SEAM IS THE REASON TO CHANGE. `session-context-meter.test.mjs` is about
// the METER'S ARITHMETIC — precedence between a reported window and the frozen table, what an
// absent window renders, what must not clobber a known value. THIS is about the ADAPTER'S FOLD:
// which fields of an out-of-band `thread/tokenUsage/updated` snapshot ride the `turn/completed`
// frame core consumes. The two move for different reasons — one when the gauge's rules change, one
// when the Codex wire does — and the split is what kept the meter file under the §1 cap.
//
// 🔒 THE DEFECT THIS EXISTS FOR (2026-09-22): the whole meter path was built and shipped INERT.
// `modelContextWindow` is a SIBLING of `last`/`total` inside `tokenUsage`, and the fold forwarded
// only those two — so `normalize.js › windowFrom` never saw a window and a Codex session showed
// used tokens over nothing. Every unit test upstream and downstream passed.
//
// ⚠ A SOURCE PIN, because the fold lives inside a closure over a live connection that a unit test
// cannot drive without a child process. The live half is `codex-live-session.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { between, sliceFrom } from "./helpers/source-probe.mjs";

// ─── THE FORWARD THAT MAKES ALL OF THE ABOVE REACHABLE (2026-09-22) ──────────────────────────
//
// 🔒 The window is a SIBLING of `last`/`total` inside `tokenUsage`, and `launch-spec.js` folds the
// out-of-band `thread/tokenUsage/updated` snapshot onto the `turn/completed` frame core consumes.
// It forwarded only those two, so `normalize.js › windowFrom` never saw a window and every case
// above was inert against a real session — the meter showed used tokens over nothing.
//
// ⚠ A SOURCE PIN, because the fold happens inside a closure over a live connection that a unit
// test cannot drive without a child process. The live half is `codex-live-session.test.mjs`.

test("launch-spec forwards the reported window onto the completed frame", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../main/runtime/codex/launch-spec.js", import.meta.url)),
    "utf8"
  );
  const body = between(sliceFrom(src, "const enriched = Object.assign("), "const enriched", "});");
  assert.match(body, /contextWindow:\s*latestUsage \? latestUsage\.modelContextWindow : null/,
    "the window must ride the same fold as usage/promptUsage");
  // ⚠ ABSENT, NOT ZERO — a `0` denominator renders a FULL meter on an empty session, and
  // `contextEvent` can only fall back to its table when it is handed a non-number.
  assert.ok(!/contextWindow:\s*latestUsage\s*&&/.test(body),
    "`latestUsage && latestUsage.modelContextWindow` would answer `null` for a 0 but `undefined` " +
    "for a missing snapshot — the ternary answers null for both");
});
