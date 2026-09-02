// T85 (2026-09-01) — `dopl_channel(op="await")` IS REFUSED ON A SESSION THIS MACHINE RUNS.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────
// An `await` holds a long-poll for a message that a desktop-run session receives as a TURN
// anyway (`session-dispatch.js › feedLiveSession` fans an addressed post out to every live
// session on the thread). So the call bought nothing and cost the held context re-read on the
// far side of it — measured across an orchestration run as the single largest source of calls
// that did no work.
//
// ── THE RULE ────────────────────────────────────────────────────────────────────────
// `grantDecision` answers `deny` for the op inside its CHANNEL branch, ahead of every standing
// grant and both axes, and the refusal carries its own reason code (`await-desktop-session`) and
// its own short sentence (`session-permissions.js › AWAIT_DENY_MESSAGE`).
//
// ⚠ IT IS NOT A PERMISSION QUESTION, WHICH IS WHY THE CASES BELOW WALK EVERY POSTURE AND EVERY
// GRANT SHAPE RATHER THAN THE DEFAULT ONE. Nothing on this machine makes the call useful, so an
// "allow" would be a mistake a surface let somebody make — a case that only proved "denied at
// manual/ask" would not notice a later grant path re-opening it.
//
// Its own file because `session-channel-read.test.mjs` — where the op's CLASSIFICATION is
// pinned — stood at 487 of the 500-line cap `test/**/*.mjs` is linted under. Same split rule as
// that file's own origin.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const profiles = require(M("session-profiles.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "ch1";
const decide = (over) => profiles.grantDecision({ profile: "full", channelId: CH, ...over });
const detail = (over) => profiles.grantDecisionDetail({ profile: "full", channelId: CH, ...over });
const READS = profiles.OWN_CHANNEL_READ_OPS;

test("T85: await is DENIED in every posture, on both axes, own channel or not", () => {
  for (const messageMode of profiles.MESSAGE_MODES) {
    for (const toolMode of profiles.TOOL_MODES) {
      for (const channel of [undefined, "", CH, "other-id", "my-slug"]) {
        assert.equal(
          decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "await", channel }, messageMode, toolMode }),
          "deny",
          `await @ msg=${messageMode} tool=${toolMode} channel=${String(channel)}`
        );
      }
    }
  }
});

test("T85: no standing grant can open it — the widest grant key is still a deny", () => {
  const key = profiles.grantKeyFor(DOPL_CHANNEL_TOOL, { op: "await" }, CH);
  assert.equal(
    decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "await" }, messageMode: "auto_both", allowForTask: [key] }),
    "deny",
    "an operator's 'allow for this task' click must not resurrect it"
  );
  // ...and the tool-name-shaped key that a coarser grant would carry does not either.
  assert.equal(
    decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "await" }, messageMode: "auto_both", allowForTask: [DOPL_CHANNEL_TOOL] }),
    "deny"
  );
});

test("T85: the deny carries its OWN reason code and its own sentence", () => {
  assert.deepEqual(
    detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "await" }, messageMode: "auto_both", toolMode: "bypass" }),
    { decision: "deny", reason: "await-desktop-session" },
    "never `hard-denied` — dopl_channel is on no profile's deny list, and no setting opens this"
  );
  const permissions = require(M("session-permissions.js"));
  assert.equal(
    permissions.denyMessageFor("await-desktop-session"),
    permissions.AWAIT_DENY_MESSAGE
  );
  // The sentence names the mechanism that replaces it, or the agent reaches for a poll loop.
  assert.match(permissions.AWAIT_DENY_MESSAGE, /woken when addressed/);
  // ⚠ SHORT. The whole ticket is that this call wastes tokens; a lecture would spend them here.
  assert.ok(permissions.AWAIT_DENY_MESSAGE.length < 160,
    "the refusal must not cost more than the call it refuses");
});

test("T85: the classifier still calls it a read — the deny is policy, not a classification hole", () => {
  assert.ok(READS.includes("await"), "membership is what makes a cross-channel await legible");
  assert.equal(profiles.isOwnChannelRead({ op: "await" }, CH), true);
  assert.equal(profiles.isAwaitOp({ op: "await" }), true);
  assert.equal(profiles.isAwaitOp({ op: "read" }), false);
  assert.equal(profiles.isAwaitOp({}), false);
  assert.equal(profiles.isAwaitOp(undefined), false);
  assert.equal(profiles.isAwaitOp(null), false);
});

test("T85: the framing does not teach a call the gate refuses", () => {
  // ⚠ COPY THAT NAMES A DENIED CALL IS WORSE THAN NO COPY: the agent spends a turn on it, reads
  // a refusal, and reaches for the poll the sentence was steering it away from. The framing said
  // `You may also hold op "await" on this channel` until this ticket, so the old invitation is
  // asserted GONE from every line the prompt can reach — comments are exempt, because this tree's
  // comments carry the argument and the retraction has to be readable next to what it replaced.
  const src = readFileSync(M("prompt-framing.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/may also hold op "await"/.test(code), "the old invitation must not survive in the prompt");
  assert.ok(/op "await" is refused in/.test(code), "and the replacement says so plainly");
  assert.ok(/delivered to you as a new TURN/.test(code),
    "…and names what happens instead, or the agent invents a poll loop");
});
