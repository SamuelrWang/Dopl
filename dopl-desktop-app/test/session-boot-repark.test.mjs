// THE BOOT PASS — main/session-boot.js › reparkDormant (F-694, 2026-09-13).
//
// THE DEFECT THIS FILE EXISTS FOR, measured on a real machine: a Dopl channel agent
// (`@agent-y1uun32v`, `phase: 'parked'`, sdk id present in the resume map, identity "Coder") was
// idle when Electron was hard-restarted, and after the restart it was NOWHERE — no card in the
// Agents tab, not even an Ended one, no `agentHistory` entry, its `channel_sessions` row gone.
// `session-engine.js › init` loops the stored records and `continue`s on anything whose
// `store.reloadDisposition(rec.phase)` is not `'resume'`; a parked record's disposition is
// `'dormant'`, so it was neither RE-REGISTERED (never published, never re-projected, unwakeable —
// every wake path resolves against the in-memory registry) nor ENDED (no phase flip, no
// lifecycle, no history). The rule is TWO OUTCOMES AND NEVER A THIRD.
//
// METHOD, AND WHAT IS REAL RATHER THAN FAKED: `_session-boot-harness.mjs`, which carries the rig
// and the argument for every injection choice in it.
//
// ⚠ THE RIG MOVED OUT ON 2026-09-14 (`_session-boot-harness.mjs`) — this file was at 498 of the
// 500-line cap on the day it shipped, which is room for no further case. The rig is unchanged and
// injected from there; everything below is cases.

import {
  test, assert, harness, parkedRecord, flush, CHANNEL, KEY, storePure,
  BOOT_SRC, STORE_SRC, PILL, EFFECTS, PROFILES, RUNTIME,
} from "./_session-boot-harness.mjs";

// ── 1. PARKED + AN SDK ID -> re-registered, published Idle, resumable ────────────────────────

test("a parked record with an sdk id comes back as a registered PARKED session", () => {
  const rec = parkedRecord();
  const h = harness({ records: { [KEY]: rec }, ids: { [KEY]: "sdk-y1uun32v" } });

  const out = h.boot.reparkDormant();

  assert.deepEqual(out, { reparked: 1, ended: 0 });
  const s = h.sessions.get(KEY);
  assert.ok(s, "the record is re-registered under its OWN key — the third segment names WHICH agent");
  // The identity that has to survive a restart, field by field. A new sessionId or a restamped
  // startedAt would destroy the record's identity by the act of restoring it.
  assert.equal(s.sessionId, rec.sessionId);
  assert.equal(s.startedAt, rec.startedAt);
  assert.equal(s.agentId, "y1uun32v");
  assert.equal(s.channelId, CHANNEL);
  assert.equal(s.taskId, "");
  assert.equal(s.workspaceId, rec.workspaceId);
  assert.equal(s.side, "responder");
  assert.equal(s.counterpartyId, "peer-1", "L1: the feed stays bound to the stored counterparty");
  assert.equal(s.bind, "pair");
  assert.equal(s.model, "opus", "the operator's model pick survives, rather than reverting to the CLI default");
  assert.equal(s.runtimeId, "claude", "the conversation handle belongs to ONE vendor");
  assert.equal(s.context.identity.name, "Coder", "F-288: a null identityName here ERASES channel_sessions.identity_name");
  assert.equal(s.context.channelName, "Dopl");
  assert.equal(s.profile, "channel_agent", "the stored profile, through the fail-restrictive reader");
  // The counters: spent turns for display, and the post counter with its crash slack.
  assert.equal(s.state.turns, 7);
  // ⚠ `s.state.costUsd === 0.42` STOOD HERE. The cost column is deleted (2026-09-22, Samuel: *"we
  // dont need cost tracking"*) and the record above still HANDS ONE IN, so this is the proof that
  // a record written by an older build cannot revive it.
  assert.equal(s.state.costUsd, undefined);
  assert.equal(s.ownPostSeq, storePure_resumedPostSeq(3), "2026-08-22: a re-minted client_msg_id is silently discarded by the server");
  // Nothing live is fabricated.
  assert.equal(s.query, null);
  assert.equal(s.abortController, null);
  assert.equal(s.pushIterator, null);
  assert.equal(s.settled, false);
  // ⚠ FAIL-CLOSED, NOT A GAP: the record carries no owner and `setSelfIdentity` has not run yet.
  assert.equal(s.operatorUserId, null);
  // ⚠ NOT a spawn-idle shell: this agent has a conversation and has already been directed.
  assert.equal(s.awaitingDirective, false);
  assert.equal(s.freshFraming, false, "the SDK resume carries the original ROLE block");
});

test("rehydration preserves an open Codex model id in Codex's vocabulary", () => {
  const rec = parkedRecord({ runtimeId: "codex", model: "gpt-6-astra" });
  const h = harness();
  const restored = h.boot.parkedSessionFromRecord(KEY, rec, "thread-codex-1");
  assert.equal(restored.runtimeId, "codex");
  assert.equal(restored.model, "gpt-6-astra");
});

test("CXP-4: a restart restores the record's own WORD, and pairs a baseline of 0 with 0", () => {
  // 🔒 ⚠ **THIS CASE WAS "a restored baseline PAIRS with the accumulator its deltas are added
  // to", AND IT WAS ENTIRELY ABOUT THE COST PAIR.** `session-io.js › applyCoreEvents` adds
  // `platformTotal - baseline` to an accumulator, so the two must start LEVEL — and the COST
  // accumulator WAS restored from the record (`state.costUsd`), so on a CONTINUING runtime its
  // baseline had to be that same figure or the first post-resume turn re-counted it. The column
  // is deleted (2026-09-22, Samuel: *"we dont need cost tracking"*), so the pair it protected no
  // longer exists on this lane.
  //
  // ⚠ **WHAT SURVIVES IS THE HALF THAT STILL DECIDES SOMETHING, AND IT IS WHAT THIS NOW PINS:**
  // the record's WORD crosses into the rebuilt session as `usageBaseline`, where
  // `session-park.js › resumeParked` asks `capability.js › resumeZeroesBaseline` with it on the
  // very next resume and carries-or-zeroes `lastTotalTokens`. Lose that and a `continues` runtime
  // silently goes back to re-counting its whole thread.
  // ⚠ AND THE TOKEN BASELINE IS 0 ON EVERY ARM, WHICH IS THE PAIRING RULE RATHER THAN AN
  // EXCEPTION: `tokensSpent` is NOT in the durable record (`session-io.js › baseRecord`), so the
  // accumulator restarts at 0 and its baseline must too. A wave that persists `tokensSpent` owes
  // this case the arm the cost pair used to be.
  const h = harness();
  const continuing = h.boot.parkedSessionFromRecord(
    KEY, parkedRecord({ runtimeId: "codex", usageBaseline: "continues" }), "thread-codex-1"
  );
  assert.equal(continuing.usageBaseline, "continues", "the record's word is what the next resume asks");
  assert.equal(continuing.lastTotalTokens, 0);
  assert.equal(continuing.tokensSpent, undefined, "…which is exactly why 0 is the right baseline");
  assert.equal(continuing.lastTotalCost, undefined, "and no cost baseline is rebuilt at all");

  // The resetting runtime is untouched — the line Claude always ran.
  const resetting = h.boot.parkedSessionFromRecord(
    KEY, parkedRecord({ runtimeId: "claude", usageBaseline: "resets" }), "sdk-y1uun32v"
  );
  assert.equal(resetting.usageBaseline, "resets");
  assert.equal(resetting.lastTotalTokens, 0);

  // ⚠ THE RECORD'S WORD IS CARRIED VERBATIM, NOT RE-DERIVED FROM TODAY'S DESCRIPTOR — a record
  // written under one answer must not be re-read under a newer one, and that precedence is
  // applied at `resumeParked`. A record that says NOTHING (every one written before U10) crosses
  // as `'unverified'`, the fail-closed member, which falls through to the descriptor THERE rather
  // than refusing here — what keeps upgrade day from mis-counting every session on the disk.
  const crossed = h.boot.parkedSessionFromRecord(
    KEY, parkedRecord({ runtimeId: "claude", usageBaseline: "continues" }), "sdk-y1uun32v"
  );
  assert.equal(crossed.usageBaseline, "continues", "a `resets` descriptor does not overwrite the record");
  const silent = h.boot.parkedSessionFromRecord(
    KEY, parkedRecord({ runtimeId: "codex" }), "thread-codex-1"
  );
  assert.equal(silent.usageBaseline, "unverified", "a pre-U10 record states no measurement");
});

function storePure_resumedPostSeq(n) {
  const slack = Number((STORE_SRC.match(/RESUME_POST_SEQ_SLACK = (\d+)/) || [])[1]);
  assert.ok(slack > 0, "RESUME_POST_SEQ_SLACK moved or changed shape in session-store.js");
  return n + slack;
}

test("the re-parked session is PUBLISHED as Idle, and the abandonment bound is armed", () => {
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();
  const s = h.sessions.get(KEY);

  // The shipped derivation, not this file's opinion.
  assert.equal(PILL.pillState(s.state), "idle", "the Agents tab card reads Idle");
  assert.equal(PILL.listeningState(s.state), false, "'Idle' rather than 'Waiting': a message must RELAUNCH the query");
  assert.equal(PILL.queryTornDown(s.state), true);
  assert.equal(s.state.phase, "parked");
  assert.equal(s.state.parked, true, "the reducer's wakeEffects fires resumeQuery off this flag");
  // F-236: no accept surface, so the message axis is floored or session-gate.enqueue HOLDS the
  // peer's next reply with nothing left able to release it.
  assert.equal(s.state.messageMode, PROFILES.floorWindowlessMessage("ask"));
  assert.equal(s.windowless, true);

  assert.equal(h.calls.touch, 1, "§3.3: registration is a projection move — the pill must not wait for a first dispatch");
  assert.equal(h.calls.scheduleIdle.length, 1, "an agent nobody comes back to must END on its own");
  assert.equal(h.calls.scheduleIdle[0], s);
  assert.ok(h.calls.diag.some((l) => l.includes("re-parked dormant agent") && l.includes("y1uun32v")), "the boot diag names the agent");
  // Nothing was ended and nothing was echoed.
  assert.deepEqual(h.calls.lifecycle, []);
  assert.deepEqual(h.calls.history, []);
  assert.deepEqual(h.calls.phase, []);
});

test("the re-parked session is RESUMABLE by the real resumeParked, through buildLaunchSpec", async () => {
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();
  const s = h.sessions.get(KEY);

  h.park.resumeParked(s); // what the lazy path runs on the next addressed message

  assert.ok(s.abortController instanceof AbortController, "a fresh controller, SYNCHRONOUSLY");
  assert.ok(s.pushIterator && s.pushIterator.__iter, "...and a fresh iterator, so the queued push lands on it");
  assert.equal(s.resumeSdkId, "sdk-y1uun32v", "options.resume continues the SAME conversation");
  await flush();
  assert.equal(h.calls.buildLaunchSpec.length, 1, "the v1.9 security path, never a divergent assembly");
  assert.equal(h.calls.consume.length, 1, "the consumer loop is running");
});

// ── 2. NEVER INVISIBLE: no sdk id, or a runtime that refuses -> ENDED + history ──────────────

test("a parked record with NO sdk id is ENDED with a history entry, not dropped", () => {
  const rec = parkedRecord({ sdkSessionId: null, agentId: "sp4wnidl", identityName: null });
  const key = `${CHANNEL}::sp4wnidl`;
  rec.key = key;
  const h = harness({ records: { [key]: rec }, ids: {} }); // nothing in the resume map

  const out = h.boot.reparkDormant();

  assert.deepEqual(out, { reparked: 0, ended: 1 });
  assert.equal(h.sessions.has(key), false, "an unresumable agent must not hold a slot it can never use");
  assert.deepEqual(h.calls.phase, [[key, "ended"]]);
  assert.equal(h.calls.lifecycle.length, 1);
  assert.equal(h.calls.lifecycle[0].kind, "task_failed");
  assert.deepEqual(h.calls.lifecycle[0].extra, { interrupted: true });
  assert.equal(h.calls.lifecycle[0].body, EFFECTS.terminalBody({ interrupted: true }), "a terminal says why, in the shared calm one-liner");
  assert.equal(h.calls.lifecycle[0].info.key, key);
  // ⚠ THE HISTORY ENTRY IS WHAT MAKES THE CARD EXIST — `session-summary.js` reads its ended set
  // from `agent-history.js › listEnded`. A phase flip alone is the F-694 symptom by a shorter path.
  assert.equal(h.calls.history.length, 1);
  const hist = h.calls.history[0];
  assert.equal(hist.key, key);
  assert.equal(hist.agentId, "sp4wnidl");
  assert.equal(hist.channelName, "Dopl");
  assert.ok(Number(hist.endedAt) > 0);
  assert.deepEqual(hist.entries, [], "the narration ring lived on a session object this process never had");
  // ⚠ NO REASON LINE (2026-09-13, Samuel: "We don't need that line to be there … We can just put
  // 'ended.'"). The card's own `AgentEndedPill` is the word; a `diag` here renders a red duplicate
  // of it, and the sentence it used to carry is the one he asked to delete.
  assert.equal(hist.diag, null, "the Ended card says 'Ended' and nothing else");
  assert.equal(h.calls.touch, 1, "the ended half needs the projection refreshed too");
});

test("a parked record on a runtime that REFUSES resume is ENDED, never left Idle-and-unwakeable", () => {
  // ⚠ NOT A MADE-UP RUNTIME: the id is read back out of the REGISTRY, and the refusal is the
  // shipped `capability.js › resumeRefusal` over that adapter's own descriptor — two of the three
  // answer `'unverified'` today (smoke items C8/X4), so this is a real shipped state.
  const refusing = RUNTIME.ids().find((id) => RUNTIME.capability.resumeRefusal(RUNTIME.descriptorFor(id)));
  assert.ok(refusing, "no registered runtime refuses a resume — this case needs rewriting, not deleting");
  const rec = parkedRecord({ runtimeId: refusing });
  const h = harness({ records: { [KEY]: rec }, ids: { [KEY]: "sdk-y1uun32v" } });

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 1 });
  assert.equal(h.sessions.has(KEY), false);
  assert.deepEqual(h.calls.phase, [[KEY, "ended"]]);
  assert.equal(h.calls.history.length, 1, "an Ended card with a readable reason is the floor");
  assert.equal(h.calls.lifecycle[0].kind, "task_failed");
});

// ── 3. NON-PARKED RECORDS ARE UNTOUCHED (the two other dispositions) ────────────────────────

test("'ended' and live-when-it-died records are left entirely to init()'s own scan", () => {
  const endedKey = `${CHANNEL}::aaaaaaaa`;
  const runningKey = `${CHANNEL}::bbbbbbbb`;
  const records = {
    [endedKey]: parkedRecord({ key: endedKey, agentId: "aaaaaaaa", phase: "ended" }),
    [runningKey]: parkedRecord({ key: runningKey, agentId: "bbbbbbbb", phase: "awaiting_inbound" }),
  };
  const h = harness({ records, ids: { [endedKey]: "sdk-a", [runningKey]: "sdk-b" } });

  // The dispositions under test are the SHIPPED ones, asserted here so this case cannot pass
  // against a record shape that stopped meaning what it means.
  assert.equal(storePure.reloadDisposition("ended"), "ignore");
  assert.equal(storePure.reloadDisposition("awaiting_inbound"), "resume");

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 0 });
  assert.equal(h.sessions.size, 0, "nothing is registered");
  assert.deepEqual(h.calls.phase, [], "the interrupted echo + phase flip belong to init()'s loop, and would DOUBLE here");
  assert.deepEqual(h.calls.lifecycle, []);
  assert.deepEqual(h.calls.history, []);
  assert.equal(h.calls.touch, 0, "nothing moved, so nothing is published");
});

test("a session already live on this key is never overwritten", () => {
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  const live = { key: KEY, settled: false, __theRealOne: true };
  h.sessions.set(KEY, live);

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 0 });
  assert.equal(h.sessions.get(KEY), live, "replacing the Map entry orphans a live query");
});

// ── 4. THE PRUNE KEEPS THE RE-PARKED KEY ─────────────────────────────────────────────────────

test("pruneRecords' REAL policy keeps a re-parked key, even one older than the TTL", () => {
  // ⚠ ANCIENT ON PURPOSE. `init()` runs the re-park BEFORE the prune, and the prune's `keep` is
  // the live registry's key set — so an agent parked longer than RECORD_TTL_MS must be protected
  // by having been re-parked, not by luck of its timestamp.
  const rec = parkedRecord({ startedAt: 1 }); // ancient START, parked just now — the window reads the PARK
  const h = harness({ records: { [KEY]: rec }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();

  const drop = h.storePure.prunableKeys(h.cfg.records, {
    now: Date.now(),
    keep: new Set(h.sessions.keys()), // exactly what session-engine.js › init hands it
    hasSdkId: (k) => !!h.cfg.ids[k],
  });
  assert.deepEqual(drop, [], "the re-parked record survives the sweep that runs right behind it");

  // ...and the same record is prunable when it was NOT re-parked and nothing retains it, so the
  // assertion above is about the protection rather than about a policy that drops nothing.
  const drop2 = h.storePure.prunableKeys({ [KEY]: { ...rec, phase: "ended" } }, {
    now: Date.now(), keep: new Set(), hasSdkId: () => false,
  });
  assert.deepEqual(drop2, [KEY]);
});

// ── 5. THE RECENCY WINDOW, AND THE ONE WORD (the 2026-09-13 REGRESSION) ──────────────────────
//
// MEASURED minutes after F-694's fix shipped: 66 records sat at `phase: 'parked'` (63 older than a
// week, the oldest 46 days) because the F-694 bug ITSELF had left restart-killed agents in that
// phase forever — so the first pass to read the phase honestly revived the whole backlog as Idle
// pills. "a bunch of the agents that were ended are now marked as idle … that's kind of a serious
// issue." ⚠ THESE CASES ARE WRITTEN AGAINST THE SHIPPED CONSTANT, in fractions of it, so widening
// the window in production cannot leave a test agreeing with a number nobody ships.

test("a record parked INSIDE the window comes back Idle; one parked OUTSIDE it is ENDED", () => {
  const W = harness().boot.REPARK_WINDOW_MS;
  assert.equal(W, 24 * 60 * 60 * 1000, "the window moved — decide deliberately, then fix this line");
  const freshKey = `${CHANNEL}::fresh111`;
  const staleKey = `${CHANNEL}::stale222`;
  const records = {
    [freshKey]: parkedRecord({ key: freshKey, agentId: "fresh111", parkedAt: Date.now() - W * (23 / 24) }),
    [staleKey]: parkedRecord({ key: staleKey, agentId: "stale222", parkedAt: Date.now() - W * (25 / 24) }),
  };
  const h = harness({ records, ids: { [freshKey]: "sdk-fresh", [staleKey]: "sdk-stale" } });

  assert.deepEqual(h.boot.reparkDormant(), { reparked: 1, ended: 1 });
  assert.ok(h.sessions.has(freshKey), "23h parked: the operator is still coming back to this one");
  assert.equal(h.sessions.has(staleKey), false, "25h parked: reviving it IS the regression");
  // ⚠ AND THE STALE ONE ENDS — QUIETLY (2026-09-13 evening): the window NARROWS the
  // revive lane, it does not add a third state. The phase flips and the card-making
  // history entry is written, but NO channel post is made for a record parked
  // weeks ago (65 of them across 12 channels on the first boot after the window).
  assert.deepEqual(h.calls.phase, [[staleKey, "ended"]]);
  assert.equal(h.calls.lifecycle.length, 0, "a stale end tells no channel anything");
  assert.deepEqual(h.calls.history.map((r) => r.key), [staleKey]);
});

test("the window reads the MOST RECENT stamp, and startedAt is the FLOOR the 66 records were judged on", () => {
  const W = harness().boot.REPARK_WINDOW_MS;
  // A 46-day-old agent parked this morning is one he is still using.
  const old = harness({ records: { [KEY]: parkedRecord({ startedAt: 1, parkedAt: Date.now() - W / 2 }) }, ids: { [KEY]: "sdk-y1uun32v" } });
  assert.deepEqual(old.boot.reparkDormant(), { reparked: 1, ended: 0 });

  // ⚠ NO `parkedAt` AT ALL — the shape of every record written before the field existed, which is
  // all 66 measured. `startedAt` is then the only honest lower bound: an agent that STARTED inside
  // the window cannot have been parked before it.
  const recentKey = `${CHANNEL}::recent33`;
  const ancientKey = `${CHANNEL}::ancient4`;
  const h = harness({
    records: {
      [recentKey]: parkedRecord({ key: recentKey, agentId: "recent33", parkedAt: undefined, startedAt: Date.now() - W / 4 }),
      [ancientKey]: parkedRecord({ key: ancientKey, agentId: "ancient4", parkedAt: undefined, startedAt: Date.now() - W * 46 }),
    },
    ids: { [recentKey]: "sdk-r", [ancientKey]: "sdk-a" },
  });
  assert.deepEqual(h.boot.reparkDormant(), { reparked: 1, ended: 1 });
  assert.ok(h.sessions.has(recentKey));
  assert.equal(h.sessions.has(ancientKey), false);
});

test("a record with NO usable stamp is OLD, never unknown-means-recent", () => {
  const h0 = harness();
  for (const over of [{ startedAt: 0 }, { startedAt: null }, { startedAt: "" }, { startedAt: NaN }, { startedAt: -1 }]) {
    assert.equal(h0.boot.withinReparkWindow({ ...parkedRecord({ parkedAt: undefined }), ...over }, Date.now()), false, JSON.stringify(over));
  }
  const h = harness({ records: { [KEY]: parkedRecord({ parkedAt: undefined, startedAt: 0 }) }, ids: { [KEY]: "sdk-y1uun32v" } });
  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 1 }, "and it ENDS, so it is still not invisible");
  assert.equal(h.calls.history.length, 1);
});

test("ENDED IS THE WHOLE SENTENCE, on every surface a person reads", () => {
  // 1. THE CHANNEL POST / the shared calm terminal one-liner.
  assert.equal(EFFECTS.terminalBody({ interrupted: true }), "Ended", "Samuel 2026-09-13: \"We can just put 'ended.'\"");
  assert.equal(EFFECTS.TERMINAL_BODIES.interrupted, "Ended");

  // 2. THE HISTORY ENTRY -> the Agents-tab card, where `agents-tab-cards.tsx` renders `agent.diag`
  // as a RED line under a pill that already says Ended. So the reason field is empty on this route.
  const h = harness({ records: { [KEY]: parkedRecord({ parkedAt: Date.now() - harness().boot.REPARK_WINDOW_MS * 2 }) }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.reparkDormant();
  assert.equal(h.calls.history[0].diag, null);
  // A stale-window end is QUIET (no channel post at all), so the "Ended" body is
  // pinned on the effect above and on a no-sdk-id end below, not here.
  assert.equal(h.calls.lifecycle.length, 0);
  const noSdk = harness({ records: { [KEY]: parkedRecord({ parkedAt: Date.now() }) }, ids: {} });
  noSdk.boot.reparkDormant();
  assert.equal(noSdk.calls.lifecycle[0].body, "Ended");

  // 3. AND THE DELETED SENTENCE IS GONE FROM THE SOURCE, not merely unreachable — it was reachable
  // through TWO reasons (no sdk id, and a runtime refusal), so pinning one call site would have let
  // the other keep saying it. It may survive as PROSE in a comment: that is the record of a ruling.
  const codeLines = BOOT_SRC.split("\n").filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  });
  assert.deepEqual(codeLines.filter((l) => l.includes("nothing to resume")), [], "never on a line this module executes");

  // 4. THE ENGINEER'S LANE IS UNTOUCHED: the reason still reaches the diag log, which is not copy.
  assert.ok(h.calls.diag.some((l) => l.includes("ended dormant agent") && l.includes("re-park window")), "a log still tells the end reasons apart");
});

// ── 6. ONE BAD RECORD MUST NOT TAKE THE PASS DOWN (2026-09-14 review) ────────────────────────
//
// The docblock said "each record is independent" over a bare loop with no guard. It was not true:
// one throw — a history write that fails, a store handle that is gone, an unbound `deps` —
// abandoned the scan where it stood, and EVERY record after it was left in the third state F-694
// exists to forbid: no session, no Ended card, no history entry, nothing in the product. `init()`'s
// own try/catch cannot help; by the time it catches, the pass is over.

test("a record that THROWS is skipped and every other record is still decided", () => {
  const boomKey = `${CHANNEL}::boom0000`;  // ends, and its history write explodes
  const freshKey = `${CHANNEL}::fresh111`; // must still come back Idle
  const staleKey = `${CHANNEL}::stale222`; // must still end quietly
  const records = {
    [boomKey]: parkedRecord({ key: boomKey, agentId: "boom0000", parkedAt: Date.now() }),
    [freshKey]: parkedRecord({ key: freshKey, agentId: "fresh111", parkedAt: Date.now() }),
    [staleKey]: parkedRecord({ key: staleKey, agentId: "stale222", parkedAt: 1 }),
  };
  const h = harness({
    records,
    ids: { [freshKey]: "sdk-fresh", [staleKey]: "sdk-stale" }, // boom has no sdk id, so it ENDS
    throwHistoryFor: boomKey,
  });

  const out = h.boot.reparkDormant();

  // ⚠ COUNTED AS NEITHER. A thrown record did not land either outcome, and a tally that claimed
  // it did would be the pass lying about the one thing it is for.
  assert.deepEqual(out, { reparked: 1, ended: 1 });
  assert.ok(h.sessions.has(freshKey), "the record AFTER the throw was still re-parked");
  assert.deepEqual(h.calls.history.map((r) => r.key), [staleKey], "…and the stale one still ended");
  assert.equal(h.calls.touch, 1, "the projection is still refreshed for the records that moved");
  assert.ok(
    h.calls.diag.some((l) => l.includes("threw and the pass CONTINUED") && l.includes("boom0000")),
    "the failing key must be nameable from the log"
  );
});

test("an UNBOUND harness does not abandon the scan either", () => {
  // `bind()` is called at `session-engine.js` load, so this is the mid-wave / harness shape — and
  // it is the cheapest proof that the guard wraps the WHOLE decision and not just the history write.
  const h = harness({ records: { [KEY]: parkedRecord() }, ids: { [KEY]: "sdk-y1uun32v" } });
  h.boot.bind(null);
  assert.deepEqual(h.boot.reparkDormant(), { reparked: 0, ended: 0 }, "it answers rather than throwing");
  assert.equal(h.calls.touch, 0, "nothing moved, so nothing is published");
});
