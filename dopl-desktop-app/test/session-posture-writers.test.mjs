// H2, THE WRITE SIDE — NOTHING ON THE SESSION PATH WRITES A POSTURE BACK.
//
// ⚠ SPLIT OUT OF `session-preset-start.test.mjs` ON 2026-09-22 (§2), which stood at 523 of the
// 500-line cap `test/**/*.mjs` is linted under. The split is the seam INVARIANTS §1 names — one
// file per reason to change — not the line the cap fell on: that file is the READ side (a
// posture travels ONLY as an explicit `spec.startModes`, handed in by a caller executing a
// decision a human is making right now), and this one is the WRITE side. Nothing moved but the
// section; every assertion, every ⚠ block and every excision note below is verbatim from it, and
// the shared machinery is `_session-preset-harness.mjs`.
//
// ⚠ WHY IT IS A REASON TO CHANGE OF ITS OWN. This section is a CENSUS: it scans `main/` and
// enumerates every module that writes the durable posture, seeds one, or reads the defaults
// record, then pins the list. It goes red when a MODULE joins or leaves — `channel-runtime.js`
// left on U5 by losing its writer, `agent-defaults.js` joined 2026-09-18 by name with its
// reachability asserted, and `channel-seed-watch.js` joined 2026-09-22 the same way when Samuel
// reversed the no-inheritance ruling — which is a different event from a spawn path changing
// shape, and it is the half that had grown to a third of the file on its own.
//
// ⚠ THE RULE IT KEEPS, in one line: if anything on the session path ever writes a posture, a
// session can widen the posture its own NEXT launch starts at — the v3.1 failure H2 was filed
// for, arriving by a different door.
//
// Run: `node --test dopl-desktop-app/test/session-posture-writers.test.mjs`

import {
  test, assert, readdirSync,
  MAIN, read, ENGINE, stripComments,
} from "./_session-preset-harness.mjs";

// ── 4. THE STORAGE CONTRACT the invariant rests on ───────────────────────────
//
// ⚠ TWO CASES STOOD HERE AND ARE DELETED WITH THE ARM (2026-08-20, Samuel's ruling):
//   · "H2: consuming DELETES, so one arm can only ever serve one launch" — it sliced
//     `channel-prefs.js › consumePermissionPreset` and pinned `takeArmFrom(map, channelId, now)`
//     (take-and-remove in ONE step, so a second launch could not find the same pair) and
//     `writeAll(map)` (the removal persisted, so a restart could not resurrect it).
//   · "H2: a denied or expired request CLEARS the arm rather than leaving it to age out" — it
//     pinned `channelPrefs.clearPermissionPreset(rec.channelId)` inside BOTH `inboundDenied` and
//     `inboundExpired`, so a posture armed for a request the operator then refused or ignored
//     could not survive into the NEXT launch on that channel.
// Neither function exists, and neither does `trigger-outcomes.js`'s dependency on
// `channel-prefs` (⚠ the absence used to be asserted by `test/consent-local-expiry.test.mjs`,
// which is deleted 2026-08-22 with the watcher it drove; the writer census below is what still
// refuses a regrowth, and it scans the whole of main/ rather than one file).
//
// ⚠ WHAT THOSE TWO ENFORCED IS NOW TRUE BY CONSTRUCTION, WHICH IS WHY THEY ARE NOT REPOINTED.
// They existed to stop a stored pair reaching a launch nobody approved. An inbound request now
// carries NO stored pair — `startModes` is pinned null and the tool axis floors at `manual` —
// so there is nothing to spend, nothing to expire and nothing to clear. The DURABLE record has
// no consume twin by design (`channel-launch-posture.test.mjs` asserts none has appeared), and
// the write side is enumerated whole below.

test("H2: nothing in the session path ever WRITES a posture back", () => {
  // ⚠ THIS CASE HAS NOW LOST BOTH ITS ORIGINAL SUBJECTS AND KEPT ITS RULE, TWICE (INVARIANTS §14).
  // It began as two assertions against `main/session-ipc.js` — that changing the axes IN-WINDOW
  // persisted nothing, and that `session:set-tool-mode` still existed. That module went with the
  // renderer it served (F-228), and there is NO per-session mode control any more: the posture is
  // decided once at launch and never touched again. So it became an enumeration of every writer
  // of an ARM — and on 2026-08-20 the arm went too, taking `armPermissionPreset` and
  // `channels:setPermissionPreset` with it.
  //
  // ⚠ THE RULE IS THE ENUMERATION, NOT THE RECORD IT ENUMERATES. "A session must not re-arm its
  // own future" is what this pins, and it re-points cleanly onto the DURABLE posture, which is
  // now the only writable permission record on the machine. If anything on the session path ever
  // writes one, a session can widen the posture its own next launch starts at — which is the
  // v3.1 failure H2 was filed for, arriving by a different door.
  assert.ok(!/setLaunchPosture|setLaunchSelection|setAutoSend/.test(stripComments(ENGINE)),
    "the engine never writes a posture");
  // ⚠ **THE ONE VALIDATING WRITER IS `setLaunchSelection` SINCE U5**, and the census follows the
  // writer rather than the name: `setLaunchPosture` survives as the legacy both-axes-or-nothing
  // wrapper, so scanning for either is what keeps the enumeration complete.
  const writers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js") && f !== "channel-prefs.js")
    .filter((f) => /\.setLaunchPosture\(|\.setLaunchSelection\(/.test(stripComments(read(f))))
    .sort();
  // ⚠ **`channel-runtime.js` LEFT THIS CENSUS ON U5 BY LOSING ITS WRITER, NOT BY BEING EXCUSED.**
  // It joined 2026-09-07 to clear the channel's model on a runtime switch; the pick is a FIELD of
  // the versioned selection now (one writer, one write) and the clear is DELETED (Decisions #1/#2).
  // ⚠ `agent-defaults.js` JOINED 2026-09-18 AND THE RULE IS UNCHANGED: admitted by NAME with its
  // reachability asserted, never by loosening the census. It SEEDS a brand-new channel's record
  // from the operator's defaults through the one validating writer. "Nothing on the SESSION path
  // re-arms its own future" holds twice over: its only entry point is `seedChannel`, which the
  // assertion below shows no session-path module calls, AND `seedChannel` refuses a channel that
  // already has a posture — so even reached from the wrong place it could not rewrite a room a
  // session is running in.
  assert.deepEqual(
    writers,
    ["agent-defaults.js", "channel-dir-ipc.js"],
    "the Settings tab's own control (`channels:setLaunchPosture`) and " +
      "new-channel seed — a posture written from anywhere on the SESSION path is a session " +
      "re-arming its own future"
  );
  // ⚠ THE SEED'S OWN REACHABILITY CENSUS, and it is the half that makes admitting it by name
  // honest. `seedChannel` must be callable from the bound-sender IPC surface and from the
  // listener's channel-observation watch, and from nowhere else; a session-path module that could
  // call it would be a session writing a posture through a door this case just opened.
  //
  // ⚠ `channel-seed-watch.js` JOINED 2026-09-22 AND THE RULE IS UNCHANGED — admitted by NAME with
  // its reachability asserted (`test/channel-seed-watch.test.mjs` pins that `channel-listener.js`
  // is its ONLY requirer), never by loosening the census. Samuel REVERSED the standing guardrail
  // that agent-created channels do not inherit (the plan's Handoff item 3), and the reversal is a
  // second SEED SITE, not a second READER: a channel created over MCP has no renderer to run the
  // creation-time seed, so the reconcile pass that first observes it writes the channel's own
  // posture instead. The three properties that made the first site safe all still hold — it
  // WRITES a per-channel record and never re-points a launch at the defaults, `seedChannel`
  // refuses a channel that already has a posture, and the defaults record never leaves the
  // machine — and the reader census below is what keeps the "never at a spawn" half true.
  const seedCallers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js") && f !== "agent-defaults.js")
    .filter((f) => /\.seedChannel\(/.test(stripComments(read(f))))
    .sort();
  assert.deepEqual(seedCallers, ["channel-dir-ipc.js", "channel-seed-watch.js"],
    "the new-channel seed is reachable only from the bound-sender IPC surface and the " +
      "listener's observation watch, never from a session");
  // ⚠ AND THE DEFAULTS RECORD ITSELF IS NEVER READ ON THE SESSION PATH. That is the OTHER half of
  // H2 for this feature: a defaults record consulted at spawn time is an ambient posture read at a
  // launch no human is attending, and it would additionally re-point every EXISTING channel.
  const defaultsReaders = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js") && f !== "agent-defaults.js")
    .filter((f) => /\.getAgentDefaults\(/.test(stripComments(read(f))))
    .sort();
  assert.deepEqual(defaultsReaders, ["channel-dir-ipc.js"],
    "the defaults record is read by the Agents tab's own op and by nothing else — never at a spawn");
  // ⚠ **AND `setChannelRuntime` MUST STAY DELETED (U5)** — re-adding it puts back a writer this
  // census cannot see (it excludes a module from its own count) of a record designed to have one.
  const runtimeCallers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => /setChannelRuntime/.test(stripComments(read(f))))
    .sort();
  assert.deepEqual(runtimeCallers, [],
    "the runtime pick has no second writer — it is a field of the record with one validating writer");
  // The one writer is behind the app-window sender gate, not reachable from a session at all.
  const handler = read("channel-dir-ipc.js");
  assert.match(handler, /ipcMain\.handle\('channels:setLaunchPosture', appWindowOnly\(/,
    "and it is bound-sender gated like every other privileged op");
  // ⚠ AND THE ARM'S WRITER IS GONE FROM THE WIRE, not merely unused: a registered op with no
  // storage behind it is worse than either half alone.
  assert.ok(!/channels:setPermissionPreset|channels:getPermissionPreset/.test(stripComments(handler)),
    "the arm's two handlers are deleted, so no session or page can reach them");
});