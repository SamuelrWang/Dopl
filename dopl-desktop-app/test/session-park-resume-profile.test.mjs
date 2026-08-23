// C7 (MEDIUM-4) — a resume from a durable record must FAIL RESTRICTIVE on its tool profile.
//
// THE BUG. `startResume` (the post-restart "Resume session" notification, and the shared path
// `resume()` uses) passed `rec.profile` RAW. Downstream, tool-profiles.normalizeProfile falls
// back to 'full' for anything it does not recognize, so a record whose profile field was absent,
// truncated, or written by a newer build came back as a FULL-ACCESS session: the most permissive
// profile, chosen by the least trustworthy input we have (a JSON file on disk that survived a
// crash).
//
// THE FIX: `profile: knownProfile(rec.profile)`.
//
// ⚠ IT USED TO BE THE SECOND HALF OF A PAIR, AND IT IS NOW THE WHOLE RULE (2026-08-20, F-228).
// `recreateParkedShell` — the P2 reopen that minted a dormant session WINDOW from a durable
// record — already ran the stored profile through `knownProfile()` (FIX #8), and this file's
// last test pinned the two call sites AGAINST each other. That path is deleted with the session
// window, so there is exactly ONE record-driven spawn left. The rule did not soften: the same
// corrupt-input table and the same three real profiles still run below, and the source guard
// that no RAW stored profile reaches startSession is kept — that guard was never about the
// window, and dropping it with the section it shared a test with is precisely the failure
// INVARIANTS §14 exists to prevent.
//
// SOURCE EXTRACTION: the BEGIN/END SESSION-PARK-PURE block references its leaf deps as free
// vars, so it is sliced and driven with fakes (same idiom as test/session-park.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");
// 2026-08-22: `startResume` mints its own instance id (it is the one spawn `launch` does not
// funnel), so the block's two new free vars are injected REAL — see test/session-park.test.mjs.
const ids = createRequire(import.meta.url)(join(HERE, "..", "main", "agent-id.js"));

const from = SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

function harness() {
  const started = [];
  const sessions = new Map();
  const io = { makePushIterator: () => ({ push() {}, close() {} }) };
  const store = {
    // session-park resumes on the record's OWN slot — all three parts, exactly as the real
    // `main/session-store.js › slotKey` composes them. `getRecord` / `getSdkSessionId` left with
    // the shell-recreate lane — nothing in the surviving block reads a record.
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && a.taskId) || ""}:${(a && a.agentId) || ""}`,
  };
  // ⚠ `sessionWindowless` JOINED 2026-08-22 (F-272): `startResume` now enforces
  // `MAX_CONCURRENT_SESSIONS`. These cases are about the PROFILE a resume comes back with, so the
  // ceiling is deliberately out of their way — the cap's own cases live in
  // `session-park.test.mjs`, and a resume refused here would pass every profile assertion
  // vacuously by never constructing a session at all.
  const sessionWindowless = {
    MAX_CONCURRENT_SESSIONS: Number.MAX_SAFE_INTEGER,
    liveCount: () => 0,
  };
  const api = new Function(
    "io", "store", "crypto", "newAgentId", "isAgentId", "Notification", "sessionWindowless", "diag",
    `${BLOCK}\n return { bind, startResume, knownProfile };`
  )(io, store, { randomBytes: () => ({ toString: () => "dead" }) }, ids.newAgentId, ids.isAgentId, null,
    sessionWindowless, () => {});
  api.bind({
    sessions,
    getSdk: async () => ({ query: () => ({}) }),
    buildSdkOptions: () => ({}),
    consume: () => {},
    dispatch: () => {},
    startSession: async (spec) => { started.push(spec); return { key: spec.key }; },
    hasLiveSession: () => false,
    emit: () => {},
  });
  return { ...api, started };
}

// ⚠ IT CARRIES AN `agentId` SINCE 2026-08-22 so the slot key is deterministic here. A record
// WITHOUT one now gets a freshly minted id (that is the fix, and test/session-park.test.mjs owns
// it); these cases are about the PROFILE, so they pin the id rather than re-testing the mint.
const REC = { channelId: "c1", taskId: "t1", agentId: "a1b2c3d4", workspaceId: "w1", side: "responder", mode: "interactive" };

test("C7: a corrupt / unknown stored profile resumes as read_only, never full", async () => {
  for (const bad of [undefined, null, "", "FULL", "full_access", "administrator", 42, {}, "read_only "]) {
    const h = harness();
    await h.startResume({ ...REC, profile: bad }, "sdk-1", "continue");
    assert.equal(h.started.length, 1);
    assert.equal(h.started[0].profile, "read_only", `stored profile ${JSON.stringify(bad)} must fail restrictive`);
  }
});

test("C7: the three real profiles still resume as themselves", async () => {
  for (const good of ["full", "dopl_only", "read_only"]) {
    const h = harness();
    await h.startResume({ ...REC, profile: good }, "sdk-1", "continue");
    assert.equal(h.started[0].profile, good);
  }
});

test("C7: the rest of the resume spec is unchanged (ids, counterparty, resume id, first turn)", async () => {
  const h = harness();
  await h.startResume({ ...REC, profile: "full", counterpartyId: "peer-1", counterpartyName: "David" }, "sdk-9", "pick it up");
  const spec = h.started[0];
  assert.equal(spec.key, "c1:t1:a1b2c3d4");
  assert.equal(spec.channelId, "c1");
  assert.equal(spec.workspaceId, "w1");
  assert.equal(spec.counterpartyId, "peer-1", "FIX L1: the feed stays counterparty-bound");
  assert.equal(spec.resumeSdkId, "sdk-9");
  assert.equal(spec.rawFirstTurn, "pick it up");
  // D1: the header identity is restored from the record — `contextFromRecord` is live, and this
  // is the ONE test left that drives it now that the recreate path is deleted.
  assert.equal(spec.context.authorName, "David");
});

// ── ⚠ F-288 — THE TEMPLATE IDENTITY SURVIVES A CRASH RESUME ──────────────────────────────
//
// ⚠ **THE HALF `resumeParked` DOES NOT COVER, AND THE DOC SAID IT DID.** INVARIANTS §5A justified
// template survival on the grounds that a park/resume "works IN PLACE and never rewrites
// `s.context`" — true of `resumeParked`, and false of `startResume`, which is a full
// re-`startSession` off a durable record. So a CRASH resume rebuilt the context from
// `contextFromRecord`, which named five keys and no template: `session-summary.js › liveSummary`
// reported `templateName: null`, `templateName` is in `session-telemetry.js › STATE_FIELDS` (so
// the change bypassed the cadence floor and pushed at once), and `repository-sessions.ts ›
// sessionRowMatches` saw a changed row and wrote NULL over the name — under a still-running agent
// whose orchestrator was reading it in `read_sessions` to tell six agents apart.
//
// ⚠ A NAME-ONLY STUB IS THE WHOLE FIX. Nothing after spawn reads `instructions` / `fields` /
// `knowledgeBases`: their one consumer is `prompt-framing-template.js › templateRoleFraming` via
// the one-shot `session-seed.js › takeFraming`, and `session-engine.js` sets `freshFraming` false
// whenever `resumeSdkId` is present — which `startResume` always passes. The SDK's own resume
// carries the original ROLE block.
test("F-288: a crash resume rehydrates `context.template` as a name-only stub", async () => {
  const h = harness();
  await h.startResume({ ...REC, templateName: "Contract Auditor" }, "sdk-1", "continue");
  const ctx = h.started[0].context;
  assert.deepEqual(ctx.template, { name: "Contract Auditor" },
    "the resumed session must report the template it was launched from, not null");
  // ⚠ THE READER'S OWN EXPRESSION, so this pins the shape `liveSummary` actually asks for rather
  // than a shape that merely looks right here.
  assert.equal(ctx.template && ctx.template.name, "Contract Auditor");
  // …and the body is deliberately NOT persisted or rehydrated.
  for (const k of ["instructions", "fields", "knowledgeBases", "authoredByCaller", "model"]) {
    assert.equal(k in ctx.template, false, `${k} must not be rebuilt from disk`);
  }
});

test("F-288: a record with NO template resumes with `template: null`, not undefined", async () => {
  // ⚠ NULL, NOT ABSENT: `session-launch-op.js` puts `template: null` on a blank launch too, and a
  // consumer that had to tell "absent" from "null" would be a consumer with two paths for one
  // state (the durable whitelist's own stated rule).
  const h = harness();
  await h.startResume(REC, "sdk-1", "continue");
  assert.equal(h.started[0].context.template, null);
});

// ⚠ REWRITTEN, NOT REMOVED — the section it shared a test with is what went.
//
// "C7: both record-driven paths now share ONE fail-restrictive rule" counted TWO
// `profile: knownProfile(rec.profile)` call sites and asserted the two paths agreed. One of the
// two (`recreateParkedShell`) is deleted, so the count is 1 and the AGREEMENT half of the claim
// is vacuous. The other two assertions are not: the NEGATIVE grep is the regression this whole
// finding was about — a future edit that reverts to `profile: rec.profile` reintroduces a
// full-access session built from a corrupt file, and no behavioural test can see the difference
// because a *valid* record behaves identically either way.
test("C7: exactly ONE record-driven path remains, and no RAW stored profile reaches startSession", () => {
  const uses = SRC.match(/profile: knownProfile\(rec\.profile\)/g) || [];
  assert.equal(uses.length, 1, "startResume is the only record-driven spawn left (recreateParkedShell is deleted)");
  assert.ok(!/profile: rec\.profile\b/.test(SRC), "no raw stored profile reaches startSession any more");
  const h = harness();
  assert.equal(h.knownProfile("nonsense"), "read_only");
  assert.equal(h.knownProfile("dopl_only"), "dopl_only");
});
