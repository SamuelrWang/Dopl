// THE SERVER'S RESOLVED POSTURE, READ BY THE WIRE (2026-09-02, v2 wave A slice A9 — G6/G7).
//
// ⚠ **WITHOUT THIS PRECEDENCE THE SERVER'S CLAMP IS COSMETIC.** The server now narrows a
// launch request to the CHANNEL's stored ceiling at creation and writes `resolved_*`; if
// `directiveFrom` went on reading `start_*`, the row would record a clamp nothing applied,
// because this machine's own ceiling is a DIFFERENT record and may be wider.
//
// ⚠ **AND WITHOUT THE FALLBACK IT WOULD BREAK EVERY OLDER SERVER.** A deployment that predates
// the column sends no `resolved_*` at all, and the chain must land on `start_*` — which is
// today's behaviour, byte for byte.
//
// ⚠ THE MACHINE'S OWN CLAMP IS NOT UNDER TEST HERE AND IS NOT REMOVED. `launch-posture.js`
// still narrows whatever arrives to the OPERATOR's stored pair; two fences on one rule, and
// this one only decides which REQUEST the second fence sees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const wire = require_(join(HERE, "..", "main", "launch-directive-wire.js"));

const WS = "99999999-9999-4999-8999-999999999999";
const DID = "77777777-7777-4777-8777-777777777777";
const CH = "88888888-8888-4888-8888-888888888888";

const from = (over) => wire.directiveFrom({ id: DID, channel_id: CH, ...over }, WS);

test("RESOLVED: the server's clamped value WINS over the raw request", () => {
  const d = from({ start_tool_mode: "bypass", resolved_tool_mode: "manual" });
  assert.equal(d.startToolMode, "manual");
});

test("RESOLVED: …on the message axis too, and independently", () => {
  const d = from({
    start_message_mode: "auto_both",
    resolved_message_mode: "ask",
    start_tool_mode: "auto",
  });
  assert.equal(d.startMessageMode, "ask");
  // ⚠ INDEPENDENT: a ceiling on one axis must not silently move the other.
  assert.equal(d.startToolMode, "auto");
});

test("RESOLVED: the camelCase spelling is read too — the claim's answer is the DTO", () => {
  // ⚠ A row reaches this function by TWO roads that disagree about the name: a realtime frame
  // is the raw row, the claim's answer is `service-launch-dto.ts › toDirective`.
  assert.equal(from({ startToolMode: "bypass", resolvedToolMode: "auto" }).startToolMode, "auto");
});

test("OLDER SERVER: no `resolved_*` at all falls through to the request", () => {
  const d = from({ start_tool_mode: "bypass", start_message_mode: "auto_both" });
  assert.equal(d.startToolMode, "bypass");
  assert.equal(d.startMessageMode, "auto_both");
});

test("OLDER SERVER: a NULL resolved value is not a value — it falls through", () => {
  // ⚠ `null` on this column is "the request named nothing", so the request is what to read.
  assert.equal(
    from({ start_tool_mode: "bypass", resolved_tool_mode: null }).startToolMode,
    "bypass"
  );
});

test("NARROWING SURVIVES: a resolved mode this build has never heard of collapses", () => {
  // ⚠ `directiveFrom` is a NARROWING. A mode outside the frozen enum must not travel toward a
  // reducer that would coerce it to the most restrictive member without anybody saying so —
  // and it must not shadow a request this build CAN do either.
  assert.equal(
    from({ start_tool_mode: "auto", resolved_tool_mode: "godmode" }).startToolMode,
    "auto"
  );
  assert.equal(from({ resolved_tool_mode: "godmode" }).startToolMode, "");
});

test("CHAIN: the resolved tri-state wins, and all three states survive", () => {
  assert.equal(from({ chain: true, resolved_chain: false }).chain, false);
  assert.equal(from({ chain: true, resolved_chain: true }).chain, true);
  // ⚠ `null` resolved = "did not ask"; the raw request is then the answer, which keeps the
  // 2026-09-01 `chain: false` fix intact — a stored `false` must not fall down the null arm.
  assert.equal(from({ chain: false, resolved_chain: null }).chain, false);
  assert.equal(from({ chain: null, resolved_chain: null }).chain, null);
  assert.equal(from({}).chain, null);
});

test("CHAIN: a stringified boolean is read on BOTH sides of the precedence", () => {
  // ⚠ A one-sided coercion is how the two halves of a tri-state stop being symmetric — which
  // WAS the 2026-09-01 defect, in a different costume.
  assert.equal(from({ resolved_chain: "false" }).chain, false);
  assert.equal(from({ resolved_chain: "true" }).chain, true);
  assert.equal(from({ chain: "false" }).chain, false);
});
