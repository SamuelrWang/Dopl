// C7 (MEDIUM-4) — a resume from a durable record must FAIL RESTRICTIVE on its tool profile.
//
// THE BUG. `recreateParkedShell` (the P2 reopen path) already ran the stored profile through
// `knownProfile()` — FIX #8 — so a missing / corrupt / future-version value recreates as
// read_only. `startResume` (the post-restart "Resume session" notification, and the shared
// path `resume()` uses) passed `rec.profile` RAW. Downstream, tool-profiles.normalizeProfile
// falls back to 'full' for anything it does not recognize, so a record whose profile field
// was absent, truncated, or written by a newer build came back as a FULL-ACCESS session:
// the most permissive profile, chosen by the least trustworthy input we have (a JSON file on
// disk that survived a crash).
//
// THE FIX: `profile: knownProfile(rec.profile)`, exactly like recreateParkedShell.
//
// SOURCE EXTRACTION: the BEGIN/END SESSION-PARK-PURE block references its leaf deps as free
// vars, so it is sliced and driven with fakes (same idiom as test/session-park.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-park.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-PARK-PURE");
const to = SRC.indexOf("// ─── END SESSION-PARK-PURE");
assert.ok(from !== -1 && to > from, "SESSION-PARK-PURE sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

function harness() {
  const started = [];
  const sessions = new Map();
  const io = { makePushIterator: () => ({ push() {}, close() {} }), noteGatedBody: () => {} };
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    getRecord: () => null,
    getSdkSessionId: () => null,
  };
  const api = new Function(
    "io", "store", "crypto", "Notification", "diag",
    `${BLOCK}\n return { bind, startResume, knownProfile };`
  )(io, store, { randomBytes: () => ({ toString: () => "dead" }) }, null, () => {});
  api.bind({
    sessions,
    getSdk: async () => ({ query: () => ({}) }),
    buildSdkOptions: () => ({}),
    consume: () => {},
    dispatch: () => {},
    startSession: async (spec) => { started.push(spec); return { key: spec.key }; },
    hasLiveSession: () => false,
    windowFactoryReady: () => true,
    emit: () => {},
  });
  return { ...api, started };
}

const REC = { channelId: "c1", taskId: "t1", workspaceId: "w1", side: "responder", mode: "interactive" };

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
  assert.equal(spec.key, "c1:t1");
  assert.equal(spec.channelId, "c1");
  assert.equal(spec.workspaceId, "w1");
  assert.equal(spec.counterpartyId, "peer-1", "FIX L1: the feed stays counterparty-bound");
  assert.equal(spec.resumeSdkId, "sdk-9");
  assert.equal(spec.rawFirstTurn, "pick it up");
  assert.equal(spec.context.authorName, "David", "D1: the header identity is restored");
});

test("C7: both record-driven paths now share ONE fail-restrictive rule", () => {
  const uses = SRC.match(/profile: knownProfile\(rec\.profile\)/g) || [];
  assert.equal(uses.length, 2, "startResume AND recreateParkedShell (the P2 reopen) both use it");
  assert.ok(!/profile: rec\.profile\b/.test(SRC), "no raw stored profile reaches startSession any more");
  const h = harness();
  assert.equal(h.knownProfile("nonsense"), "read_only");
  assert.equal(h.knownProfile("dopl_only"), "dopl_only");
});
