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
          decide({ toolName: DOPL_CHANNEL_TOOL, input: { op: "read", wait_ms: 30000, channel }, messageMode, toolMode }),
          "deny",
          `held read @ msg=${messageMode} tool=${toolMode} channel=${String(channel)}`
        );
      }
    }
  }
});

test("T85: no standing grant can open it — the widest grant key is still a deny", () => {
  const HELD = { op: "read", wait_ms: 30000 };
  const key = profiles.grantKeyFor(DOPL_CHANNEL_TOOL, HELD, CH);
  assert.equal(
    decide({ toolName: DOPL_CHANNEL_TOOL, input: HELD, messageMode: "auto_both", allowForTask: [key] }),
    "deny",
    "an operator's 'allow for this task' click must not resurrect it"
  );
  // ...and the tool-name-shaped key that a coarser grant would carry does not either.
  assert.equal(
    decide({ toolName: DOPL_CHANNEL_TOOL, input: HELD, messageMode: "auto_both", allowForTask: [DOPL_CHANNEL_TOOL] }),
    "deny"
  );
});

test("T85: the deny carries its OWN reason code and its own sentence", () => {
  assert.deepEqual(
    detail({ toolName: DOPL_CHANNEL_TOOL, input: { op: "read", wait_ms: 30000 }, messageMode: "auto_both", toolMode: "bypass" }),
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

test("T85: the SERVER refuses it too, in the same words — the join has no shared module", () => {
  // 🔒 THE PERMISSION GATE IS NOT THE FENCE, IT IS ONE OF TWO (2026-09-02 review, finding 8).
  // This gate covers the runtime it runs in; another vendor's runtime, a raw loopback and a
  // `full`-profile shell all reach `/api/mcp` without passing through it, and until the server
  // grew its own branch each of them got the whole wake-length hold. `@dopl/mcp-server ›
  // tools/channel.ts` now refuses on `identity.ts › isDesktopRun` — the runtime stamp, or the
  // credential's container lock, which rides the token row and no agent can drop.
  //
  // ⚠ AND IT SAYS EXACTLY THIS SENTENCE. Two refusals for one bound, worded differently, read
  // to an agent as two different problems. `packages/*` cannot import this CommonJS main, so
  // the literals agree or they do not — the join `runtime-stamp-literals.test.mjs` established,
  // read from BOTH sources so a change on either side fails here.
  const permissions = require(M("session-permissions.js"));
  const server = readFileSync(
    join(HERE, "..", "..", "packages", "mcp-server", "src", "tools", "channel-hold-budget.ts"),
    "utf8"
  );
  const quoted = /export const DESKTOP_HOLD_REFUSAL =\s*\n?\s*"([^"]+)";/.exec(server);
  assert.ok(quoted, "the server's refusal constant moved — this join needs re-pinning");
  assert.equal(
    quoted[1],
    permissions.AWAIT_DENY_MESSAGE,
    "the server and this machine refuse the same call with different words"
  );
});

test("T85: the classifier still calls it a read — the deny is policy, not a classification hole", () => {
  // ⚠ THE OP IS GONE, THE REFUSAL IS NOT (2026-09-02, F-578). A hold is `read` carrying
  // `wait_ms`, so what is denied is a SHAPE of a member of the read set — which is exactly the
  // separation this case has always pinned: membership answers "what KIND of call is this", the
  // deny answers "may THIS session make it".
  assert.ok(READS.includes("read"), "membership is what makes a cross-channel hold legible");
  assert.equal(profiles.isOwnChannelRead({ op: "read", wait_ms: 30000 }, CH), true);
  assert.equal(profiles.isAwaitOp({ op: "read", wait_ms: 30000 }), true);
  assert.equal(profiles.isAwaitOp({ op: "read", wait_ms: 0 }), true,
    "the caller ASKED to be held; a value the server may clamp is still that request");
  assert.equal(profiles.isAwaitOp({ op: "read" }), false, "an unheld read is an ordinary read");
  assert.equal(profiles.isAwaitOp({ op: "read", wait_ms: null }), false);
  assert.equal(profiles.isAwaitOp({ op: "status", wait_ms: 30000 }), false, "no other op holds");
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
  // ⚠ AND THE OP ITSELF IS GONE (2026-09-02, F-578): a hold is `read` carrying `wait_ms`, so
  // the copy names the SHAPE. Teaching `op "await"` would now be a doubly-wrong call — refused
  // by this gate AND rejected by the tool's own enum.
  assert.ok(!/op "await"/.test(code), "the retired op name is not in the prompt at all");
  assert.ok(/a HELD read \(op "read" with/.test(code) && /wait_ms\) is refused/.test(code),
    "and the replacement says so plainly");
  assert.ok(/delivered to you as a new TURN/.test(code),
    "…and names what happens instead, or the agent invents a poll loop");
});
