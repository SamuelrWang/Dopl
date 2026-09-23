// IPC bridge for the PER-CHANNEL SETTINGS the SPA can reach: the working folder, the durable
// launch posture, and auto-send. `renderer/app-preload.js` exposes the matching
// `window.dopl.channels.*` surface.
//
// ⚠ THE SESSION + WINDOW OPS LIVE IN `main/session-ipc-ops.js` (split 2026-08-20, F-226, at §1's
// cap). The seam is reason-to-change: `channels:*` moves when a per-channel SETTING is added,
// `sessions:*` / `threads:*` when the agent surface moves. `register()` below still calls that
// module, so `index.js` has ONE registration entry point.
//
// SECURITY MODEL — the SPA renderer is the only caller, and these handlers are the entire
// privileged surface it can reach for per-channel settings. Each is deliberately minimal:
//
//   • channelId is validated as a UUID and rejected otherwise, so a compromised page
//     can't probe arbitrary store keys or smuggle a path fragment through the id.
//   • getFolderLabel / chooseFolder return the ABBREVIATED label only
//     (channel-dirs.liveChannelDirLabel → "~/Downloads/repo" | null). The raw
//     absolute path NEVER crosses back to the renderer, so the local path can't
//     leak to the web page or the Dopl server.
//   • chooseFolder can only OPEN the native OS folder dialog — the USER picks the
//     directory. The page cannot set a path of its own choosing.
//   • No filesystem handle, no absolute path, no listing.
//
// 🔒 **THE BINDING SURVIVES ITS ORIGINAL REASON — DO NOT RELAX IT.** It was justified by the main
// window hosting remote content; the website is retired and the shell loads the bundled SPA from
// file://. An app window can still host a cross-origin iframe, an XSS in the bundle is still an
// XSS, and the registry-plus-top-frame pair is what makes "a window that does not own this thing
// cannot change it" true.
//
// H3 (2026-07-31) — SENDER BINDING. Every handler here once answered ANY renderer that could
// reach the channel name: the payload was validated, the CALLER never was. `appWindowOnly` below
// is that missing half, on every op — the privileged ones being `setLaunchPosture` (the DURABLE
// execution posture for my own launches), `setAgentChain` (may my agent launch more of my
// agents), `chooseFolder` (pops a native dialog on demand), `clearFolder`, and the two `get*`
// disclosures including a fragment of the operator's LOCAL path.
//
// Two checks, because one is not enough: the sender must be an APP-OWNED window's webContents,
// AND that window's TOP frame — a cross-origin iframe SHARES its host's webContents, so identity
// alone would let embedded content drive every op. ⚠ THE PREDICATE IS SHARED —
// `main/ipc-guards.js › isAppWindowSender`, ONE source with `ui-bridge.js` since 2026-08-20 (two
// byte-identical copies had already disagreed once: F-221). The `appWindowOnly` WRAPPER stays
// written literally at each registration site, because `test/channel-ipc-sender.test.mjs`'s
// structural belt reads that shape and a factory would silently disarm it.
//
// ⚠ THE SUBJECT IS "any window in `main/app-windows.js`'s registry" — the shell plus any pop-out
// thread or agent window (2026-08-18, Samuel's ruling). Read that file's header for why a
// renderer cannot enlarge the registry. Nothing else moved: the top-frame check is unchanged, the
// direction is fail-closed, and each op's refusal is byte-identical to its own bad-payload
// rejection so a hostile page cannot probe which window it is running in.

const { ipcMain } = require('electron');
const { isAppWindowSender, isUuid } = require('./ipc-guards');
const channelDirs = require('./channel-dirs');
const channelPrefs = require('./channel-prefs');
// 2026-08-31 (port wave D): the channel's RUNTIME pick, and the registry that says which ids
// exist. Both ride the EXISTING posture pair below rather than growing a fourth op — see the
// block over `channels:getLaunchPosture`.
const channelRuntime = require('./channel-runtime');
// ⚠ 2026-09-21 (U6): THE RUNTIME HALF OF BOTH SETTINGS REPLIES MOVED TO `main/channel-runtime-reply.js`
// — the roster, the connectivity labels and the per-runtime MODEL CATALOGS, which both handlers
// below had been assembling by hand. That file carries why; this one keeps its own reason to
// change, which is *which per-channel setting has an op*.
const channelRuntimeReply = require('./channel-runtime-reply');
// 2026-09-18 (the default-agent-settings ruling): the machine-user's DEFAULTS record and the
// seed that copies it into a brand-new channel. Read that module's header before wiring
// anything else to it — it is deliberately NOT a second consumer of the launch posture.
const agentDefaults = require('./agent-defaults');
// U5: the record VERSION every posture/defaults reply declares, so a renderer never has to infer
// which shape it is holding.
const selectionShape = require('./launch-selection');
const sessionIpcOps = require('./session-ipc-ops');
const { diag } = require('./diag');

// ── THE POSTURE APPLIES TO THE ROOM, NOT JUST TO THE NEXT SPAWN ──────────────────────────────
//
// 🔒 Samuel, 2026-08-25: *"PERMISSION SETTINGS MUST APPLY TO RUNNING SESSIONS."* Opening a channel
// to Tools=Bypass while agents were already working in it moved only the ones spawned AFTERWARDS;
// the rest went on gating every post against their launch-time posture, holding for minutes while
// Settings displayed the new pair.
//
// ⚠ A FAN-OUT OVER THE EXISTING OP, NOT A SECOND IMPLEMENTATION. `session-reopen.js ›
// setModeByTask` already moves one running session's axes through the reducer, and `session-io.js
// › grantArgs` reads them at CALL time. That op is where the windowless message FLOOR (F-236) and
// the reducer's fail-closed coercion live; a second writer to the same two fields is how two
// readers come to disagree about one posture.
//
// ⚠ IT ADDS NO AUTHORITY. `sessions:setMode` already exposes this to this sender. It widens
// SUPERVISION — is the operator asked? — never CONTAINMENT: the tool PROFILE is checked first,
// `SESSION_HARD_DENY` is unconditional, and `bypass` is a positive allow-list.
// ⚠ ADDRESSED PER AGENT, NEVER PER THREAD — `listLiveSessions` yields one row per SLOT, and
// (channel, thread) alone would take the oldest agent and silently skip its N−1 siblings, which in
// the incident above is most of the room.
// ⚠ BEST-EFFORT, AND THE DURABLE WRITE HAS ALREADY LANDED: a session that settles mid-dispatch is
// not counted, and an engine throw must never turn a successful setting write into a failed one.
// ⚠ ONLY WHAT CHANGED, ONLY WHERE IT APPLIES (P3-02): Axis A goes to a session only when ITS
// runtime's record moved, in that runtime's words (a runtime switch moves no session's record);
// Axis B, channel-wide, goes to every session when it moved. Never a per-agent pick: the fan-out
// is unpinned, so a picked session keeps its pick and narrows to the channel (C2).
// Returns HOW MANY live sessions took a change.
function applyPostureToLive(channelId, before, after) {
  if (!before || !after) return 0;
  let applied = 0;
  try {
    const engine = require('./session-engine');
    if (typeof engine.listLiveSessions !== 'function' || typeof engine.setModeByTask !== 'function') return 0;
    const c = require('./runtime').selectionContext();
    const toolsOf = (sel, rt) => selectionShape.activeRecord(c, { ...sel, runtime: rt }).tools || c.narrowestToolFor(rt);
    for (const row of engine.listLiveSessions()) {
      if (!row || row.channelId !== channelId) continue;
      const target = { channelId: channelId, taskId: row.taskId || '', agentId: row.agentId || '' };
      const rt = row.runtimeId || c.defaultId;
      const tools = toolsOf(after, rt);
      const results = [];
      if (tools !== toolsOf(before, rt)) results.push(engine.setModeByTask({ axis: 'tools', mode: tools, ...target }));
      if (after.messages !== before.messages) results.push(engine.setModeByTask({ axis: 'messages', mode: after.messages, ...target }));
      if (results.some((r) => r && r.ok)) applied += 1;
    }
  } catch (err) {
    diag('channel-dir ipc: live posture fan-out failed', err && err.message);
    return applied;
  }
  if (applied) diag('channel-dir ipc: posture applied to', applied, 'live session(s)', String(channelId).slice(0, 8));
  return applied;
}

// `opts.onChanged()` (optional) lets index.js refresh the tray so the menu-bar
// "Channel folders" submenu and the in-app control never drift after a set/clear.
// `opts.getSenderIds()` returns the LIVE set of app-owned `webContents` ids
// (main/app-windows.js › senderIds) — the senders every handler here is bound to.
// Absent (a mid-wave caller, a harness), every handler fails CLOSED: an unbound
// privileged surface is not a usable one.
function register(opts = {}) {
  const onChanged = typeof opts.onChanged === 'function' ? opts.onChanged : () => {};
  const getSenderIds = typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  // Wrap a handler so it only ever runs for a bound sender. `refusal` is what a
  // rejected call sees — deliberately the SAME shape a bad channel id already
  // returns, so a hostile page learns nothing from the difference.
  const appWindowOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('channel-dir ipc: refused', name, '— sender is not an app window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // ── ⚠ THE FOLDER ANSWER IS A PAIR, BECAUSE THE ROW ASKS TWO QUESTIONS (2026-09-05; Samuel's
  // ruling is the ABBREVIATED form).
  //
  //   label   WHAT THE AGENT WILL ACTUALLY RUN IN, always a real short-form and NEVER null.
  //           `channel-dirs.js › resolvedDirLabel` reads THROUGH `sessionSpawnDir`, the same
  //           function that produces the spawn cwd, so the label and the cwd cannot disagree.
  //   custom  WHETHER A PER-CHANNEL DIR IS SET — the reset control's question, which is a
  //           different question from the label's.
  //
  // ⚠ ONE NULLABLE LABEL WAS THE BUG: the renderer invented a word for the null and printed
  // "Sandbox (default)" for a place that does not exist (the default is `~/Downloads`, or the
  // homedir). Two fields is the fix.
  // ⚠ IT WIDENS NO DISCLOSURE AND IS NOT A NEW OP. Both members are `abbreviateHome` output; the
  // raw absolute path still never crosses back (the header's rule stands untouched), and the op
  // names, the `appWindowOnly` binding, the UUID gate and the `null` refusal are unchanged.
  const folderAnswer = (channelId) => ({
    label: channelDirs.resolvedDirLabel(channelId),
    custom: channelDirs.liveChannelDirLabel(channelId) !== null,
  });

  // Read the current folder answer. Labels only — never the absolute path.
  ipcMain.handle('channels:getFolderLabel', appWindowOnly('getFolderLabel', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return folderAnswer(channelId);
  }));

  // Open the native picker (user-driven), store the pick, return the fresh answer.
  // On cancel the stored dir is unchanged, so the prior answer is returned.
  ipcMain.handle('channels:chooseFolder', appWindowOnly('chooseFolder', null, async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    try {
      await channelDirs.promptAndSetChannelDir(channelId);
    } catch (err) {
      diag('channel-dir ipc choose error', err && err.message);
    }
    onChanged();
    return folderAnswer(channelId); // labels only
  }));

  // Drop the per-channel dir. ⚠ IT ANSWERS THE DEFAULT'S REAL NAME rather than `null`: the reset
  // lands the channel somewhere specific, and the row must be able to say where.
  ipcMain.handle('channels:clearFolder', appWindowOnly('clearFolder', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    channelDirs.clearChannelDir(channelId);
    onChanged();
    return folderAnswer(channelId);
  }));

  // ── THE DURABLE LAUNCH POSTURE (2026-08-20) ─────────────────────────────────
  // The two axes governing how the operator's OWN agent starts on this channel, read at
  // exactly one call site (`session-ipc-ops.js › sessions:launch`, the Agents tab's Launch
  // button). It is a SETTING, with no TTL and no consume twin — `main/channel-prefs.js`'s own
  // block is the statement of what that means and why it is safe, read it before changing
  // either op.
  //
  // ⚠ `channels:getPermissionPreset` / `setPermissionPreset` STOOD HERE AND ARE DELETED
  // (2026-08-20, Samuel's ruling). They armed the SINGLE-USE consent-card posture, whose web
  // controls stopped rendering at the 2026-08-18 consent rewrite and were never noticed
  // (F-233). An arm no human can set is a store key, not a safety mechanism. What kept H2
  // closed was never the TTL — it is the CONSUMER COUNT, and that is unchanged at one.
  //
  // Same `appWindowOnly` + UUID gating as everything here; both modes are re-validated in
  // channel-prefs against the frozen enums, so an unknown value on either axis writes nothing.
  // → the EFFECTIVE pair, never null (an unset channel is the selected runtime's narrowest / ask).
  // ── ⚠ THE RUNTIME RIDES THIS PAIR, AND IT DOES NOT GET AN OP OF ITS OWN (2026-08-31) ────────
  //
  // The runtime is the same shape of decision as the pair (what MY agent starts as when I press
  // Launch), read and written from the same Settings surface, so it is an OWN KEY on this record:
  // a new op would be one more thing for the SPA to feature-detect for a record it already reads.
  // ⚠ AND THERE IS A HARD CONSTRAINT BEHIND THAT PREFERENCE, NOT ONLY AN AESTHETIC ONE:
  // `renderer/app-preload.js` is AT the 500-line §1 cap and `test/preload-parity.test.mjs`
  // asserts that NO preload requires anything but `electron` — so it has no split seam, and a new
  // bridge NAMESPACE cannot be added there without changing that security invariant. Recorded as
  // a finding rather than worked around silently.
  //
  // ⚠ THE DESCRIPTOR TABLE RIDES THE READ, AND IT IS PURE DATA BY CONSTRUCTION. `contract.js ›
  // sealAdapter` deep-freezes every descriptor and REFUSES one carrying a function, exactly so it
  // survives this structured-clone hop and reaches the UI as data rather than as `undefined` —
  // which is the one meaning ("capability absent") that must never be produced by accident.
  // ⚠ IT DISCLOSES NOTHING PRIVILEGED: what a runtime can do, its own mode vocabulary, and the
  // sentences a refusal carries. No path, no credential, no token.
  // ── ⚠ AND SINCE 2026-09-08 IT ALSO SAYS WHICH OF THEM THIS MAC IS CONNECTED TO ──────────────
  //
  // Samuel's correction, verbatim, after a pass that narrowed the popup's roster to the connected
  // ones: *"No, even if the user does not have codex or cursor connected, I still want them to be
  // options there so that the user knows that those are options, so they can connect them. It
  // should just be logged in, like it is just put in their default, right? I did not say to remove
  // them."* So `runtimes` is UNCHANGED — every registered adapter, always — and `connected` is a
  // FACT ABOUT EACH ENTRY beside it. ⚠ A future reader shortening `runtimes` to `connected` is
  // undoing this ruling; the roster is what tells an operator that Codex is a thing they could
  // connect.
  // ⚠ IT IS A CACHED PROBE AND IT IS 60s STALE BY DESIGN (`runtime/connectivity.js` carries the
  // whole argument): each adapter's `available()` under a 1500ms leash, a hang reading as ABSENT,
  // and the sweep standing for a minute so opening a dialog does not spawn three binaries.
  // ⚠ IT NEVER FAILS THE READ. Every probe failure is "not connected", and the `catch` below is
  // the belt for a registry that has no such accessor at all — a posture read that threw would
  // take the Settings tab and the popup with it over a field neither one needs to render.
  // ⚠ IT DISCLOSES NOTHING PRIVILEGED, on the block above's own terms: three ids the reply already
  // names, and no path, credential, version or reason string.
  ipcMain.handle('channels:getLaunchPosture', appWindowOnly('getLaunchPosture', null, async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    // ⚠ **THE VERSIONED SELECTION RIDES BESIDE THE LEGACY PAIR, ADDITIVELY (2026-09-21, U5).**
    // The legacy OWN KEYS stay exactly where they were, because every renderer older than U5
    // feature-probes them and renders NO row when one is missing — dropping them would not migrate
    // those builds, it would make the controls vanish. ⚠ `model` IS THE EXCEPTION AND IS GONE
    // (2026-09-23): making an older renderer's Model row vanish is exactly the ruling. The new fields say what this build
    // can actually do, in the terms INVARIANTS §11 asks for: `selectionVersion` is the record
    // version main WRITES (a renderer that reads a different one must not assume the shape),
    // `selection` is the whole runtime-keyed record, and `needsReview` is the non-empty list of
    // sentences for a record this build could not fully honour. **`needsReview` is never a
    // failure of the read** — the settings it describes are already the narrower ones.
    const detail = channelPrefs.getLaunchSelectionDetail(channelId);
    return Object.assign({}, channelPrefs.getLaunchPosture(channelId), {
      selection: detail.selection,
      needsReview: detail.review,
      // The channel's pick, `''` for the default adapter. ⚠ ALWAYS PRESENT ON THE WIRE even when
      // nothing is stored, for `model`'s reason: an OWN-KEY probe is how the SPA tells "this
      // desktop has no runtime concept" (render no row) from "no pick, the default applies".
      runtime: channelRuntime.getChannelRuntime(channelId),
    }, await channelRuntimeReply.runtimeReply());
  }));
  ipcMain.handle('channels:setLaunchPosture', appWindowOnly('setLaunchPosture', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const patch = p.preset && typeof p.preset === 'object' && !Array.isArray(p.preset) ? p.preset : null;
    if (!patch || !Object.keys(patch).length) return { ok: false }; // an empty patch writes nothing (P3-35)
    // ⚠ ONE WRITE, NOT TWO, SINCE 2026-09-21 (U5). The runtime pick used to be a SECOND store
    // write issued after the pair; it is a field of the same versioned record now, so a rejected
    // write cannot half-apply a runtime and a successful one cannot leave the two disagreeing.
    // `setLaunchSelection` is own-key throughout, so a patch that omits `runtime` still leaves the
    // pick alone — which is the contract this op already had.
    const before = channelPrefs.getLaunchSelection(p.channelId);
    const res = channelPrefs.setLaunchSelection(p.channelId, patch);
    if (!res || res.ok !== true) return res || { ok: false };
    // ⚠ THE RUNTIME IS WRITTEN AFTER THE PAIR AND ONLY ON A SUCCESSFUL ONE, so a rejected posture
    // never half-applies. `setChannelRuntime` answers the value the store ACTUALLY holds, and an
    // id this build does not register CLEARS the key rather than parking a value nothing can
    // resolve — so the reply is always a runtime the SPA can name.
    // ⚠ IT IS NOT FANNED OUT TO LIVE SESSIONS, and the asymmetry with `applied` below is the
    // rule rather than an omission. `applyPostureToLive` widens SUPERVISION on a running agent;
    // a session's runtime is STAMPED AT SPAWN and never read live (`session-engine.js ›
    // startSession`), because the conversation handle, the tool vocabulary and the Axis-A modes
    // all belong to ONE runtime. Re-pointing a running session would hand one platform's
    // conversation id to another platform's adapter.
    const runtime = res.selection.runtime;
    // ⚠ AND IT APPLIES TO THE AGENTS ALREADY RUNNING (2026-08-25, Samuel's ruling: "permission
    // settings must apply to running sessions"). See `applyPostureToLive` below for the whole
    // argument. ADDITIVE on the wire — `applied` is a new field beside the existing
    // `{ok, preset}`, so a renderer that does not read it is unaffected.
    return Object.assign({}, res, {
      applied: applyPostureToLive(p.channelId, before, res.selection),
      runtime,
    });
  }));

  // ⚠ `channels:getAutoSend` / `channels:setAutoSend` ARE DELETED (2026-09-06, item 8).
  // Auto-send was a second control over the same axis as the launch posture's `messages`;
  // `channel-prefs.js` carries the full argument and `session-private.js ›
  // effectiveMessageMode` — still the one live Axis-B read — sources that axis now.
  // ⚠ DELETED, NOT LEFT REGISTERED-BUT-UNUSED. An op nobody calls is still an op a hostile
  // page can call, and this file's whole H3 header is about the caller rather than the
  // payload. The two rows left `test/_ipc-ops-table.mjs` in the same change, which is what
  // keeps `every privileged op in the file is registered` honest in both directions.

  // ── ⚠ AGENT CHAINING (2026-08-31, Samuel's ruling) — THE ONE-GENERATION LAUNCH BOUND, AS A
  // PER-CHANNEL SETTING. Boolean in, boolean out, UUID-gated and `appWindowOnly` like every op
  // here; default and fail-closed answer are both FALSE, which is the bound that shipped.
  //
  // ⚠ IT BELONGS ON THE H3 LIST ABOVE, AND ITS ENTRY IS: *decides whether an agent I launched may
  // launch more of my agents.* A forged `set` from a hostile page in an app-window top frame
  // could turn it on — the same authority the Settings row hands the operator, and no wider: it
  // grants no tool, widens no posture, reaches no other machine, and a chained launch still needs
  // `bypass` + the outbound half + the machine-wide orchestrator toggle + a free slot + budget.
  //
  // ⚠ NO LIVE FAN-OUT, UNLIKE `setLaunchPosture` DIRECTLY ABOVE, AND THE ASYMMETRY IS THE RULE
  // RATHER THAN AN OMISSION. `applyPostureToLive`'s own argument is that it widens SUPERVISION and
  // never CONTAINMENT; this is containment, so it takes the spawn-time stamp discipline instead
  // (`session-own-launch.js`). A running session keeps the bound its room had when it started.
  ipcMain.handle('channels:getAgentChain', appWindowOnly('getAgentChain', false, (_event, channelId) => {
    if (!isUuid(channelId)) return false;
    return channelPrefs.getAgentChain(channelId);
  }));
  ipcMain.handle('channels:setAgentChain', appWindowOnly('setAgentChain', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return { ok: true, on: channelPrefs.setAgentChain(p.channelId, p.on === true) };
  }));

  // ── ⚠ DEFAULT AGENT SETTINGS (2026-09-18, Samuel's ruling) — WHAT A **NEW** CHANNEL STARTS ON.
  //
  // THREE ops, and the third is the whole feature: `applyAgentDefaults` SEEDS a channel that was
  // just created with the record the other two read and write. `main/agent-defaults.js` carries
  // the argument; the part that belongs in THIS file is what a hostile page could do with them.
  //
  // ⚠ ITS H3 ENTRY IS: *decides what MY next new channel's agents start on.* A forged `set` is the
  // same authority the Agents tab hands the operator and no wider — it reaches no EXISTING
  // channel, no running session, and no other machine. A forged `apply` can only copy that record
  // into a channel that has NO posture yet (`agent-defaults.js › seedChannel` refuses otherwise),
  // so the worst it can do to a configured room is nothing at all.
  //
  // ⚠ NO LIVE FAN-OUT, UNLIKE THE POSTURE OP ABOVE, AND THE ASYMMETRY IS THE RULE. That one
  // widens SUPERVISION on agents already running in the room the operator is looking at; this
  // record governs rooms that do not exist yet, so there is nothing live for it to reach and a
  // fan-out here would make a defaults write silently re-posture the whole fleet.
  //
  // ⚠ THE READ CARRIES THE RUNTIME ROSTER, exactly as `channels:getLaunchPosture` does and for the
  // same reason: the Agents tab renders the SAME row vocabulary as the per-channel Settings tab,
  // and those rows feature-probe OWN KEYS (`runtime`) to decide whether to draw at all. Answering
  // the pair alone would tell the tab this desktop has no runtime concept. (`model` is ABSENT on
  // purpose since 2026-09-23 — there is no stored model to draw a row for.)
  ipcMain.handle('channels:getAgentDefaults', appWindowOnly('getAgentDefaults', null, async () => {
    // ⚠ THE DEFAULTS RECORD CARRIES ITS OWN `v` AND `byRuntime` (U5, additive), and the SAME
    // runtime half as `channels:getLaunchPosture` one op above — roster, connectivity labels and
    // the per-runtime model CATALOGS. The Agents tab renders the same rows as the per-channel
    // Settings tab, so a tab that sourced its own roster would be the second table U6 deletes.
    return Object.assign({}, agentDefaults.getAgentDefaults(), await channelRuntimeReply.runtimeReply());
  }));
  // ⚠ NO `channelId` AND NOTHING TO UUID-GATE — the subject is the machine-user, like the two
  // orchestrator consents below. The sender binding is the only guard, which is why this pair is
  // in `test/_ipc-ops-table.mjs`'s census.
  ipcMain.handle('channels:setAgentDefaults', appWindowOnly('setAgentDefaults', { ok: false }, (_event, payload) => {
    const p = payload || {};
    // ⚠ THE SHAPE GATE IS HERE AS WELL AS IN THE STORE, and it stands in for the `isUuid` gate
    // every other op in this file has: with no channel id there is nothing to reject a probe on,
    // so the PAYLOAD is what a bad-payload call has to be refused over. `agent-defaults.js`
    // re-validates every field regardless — this is the surface's half, not a substitute.
    if (!p.defaults || typeof p.defaults !== 'object' || Array.isArray(p.defaults)) return { ok: false };
    return agentDefaults.setAgentDefaults(p.defaults);
  }));
  // ⚠ THE INHERITANCE POINT, CALLED ONCE PER CREATED CHANNEL BY THE RENDERER THAT JUST CREATED IT.
  // Idempotent by construction (`seeded: false` when a posture already exists), so a retry, a
  // double-mounted dialog or a second window racing the same creation cannot rewrite a room.
  ipcMain.handle('channels:applyAgentDefaults', appWindowOnly('applyAgentDefaults', { ok: false, seeded: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false, seeded: false };
    return agentDefaults.seedChannel(p.channelId);
  }));

  // ── ⚠ THE ORCHESTRATOR LAUNCH TOGGLE (2026-08-22, Samuel's launch-over-MCP ruling) ────────
  //
  // MACHINE-WIDE, not per channel, so it takes no `channelId` and there is nothing to UUID-gate
  // — the payload is a bare boolean and `=== true` is the whole validation. It is the one op
  // pair in this file whose subject is the MACHINE rather than a channel; it lives here because
  // this is the `appWindowOnly` surface and a second IPC module for two handlers would be a
  // second place to forget the binding.
  //
  // ⚠ THIS PAIR IS THE **ONLY** WAY THE VALUE MOVES, AND THAT IS THE SECURITY PROPERTY. Read
  // `main/channel-prefs.js`'s block before touching either: the toggle is the standing consent
  // for another agent to spawn sessions on this Mac, and a spawned session has `Bash` plus this
  // operator's device token on disk (§6). A server-reachable version of this setting would let
  // an agent holding that credential arm the fleet with the operator's own authority. **Never
  // add a route, an MCP op, a `workspace_settings` column or any other remotely-addressable
  // writer for it.**
  //
  // ⚠ THE FAILURE DIRECTION OF A FORGED `set` IS THE ONLY REASON IT IS ON THIS BRIDGE AT ALL: a
  // hostile page in an app window's top frame could enable the lane — the same authority the
  // Settings row hands the operator, and no wider. It grants no tool, widens no posture and
  // reaches no other machine; a directive-driven launch is exactly as contained as a button
  // launch (same channel tool profile, same durable posture, same hard-deny set).
  // ⚠ THE ANSWER IS MAIN'S OWN VALUE, NEVER AN ECHO OF THE REQUEST — the same rule
  // `sessions:setMode` and `sessions:setModel` follow. `set` reports `{ok:false}` when the store
  // did not end up holding what was asked for, which is what lets the SPA's optimistic toggle
  // REVERT rather than show a switch nothing is enforcing.
  // ⚠ AND BOTH REFUSAL SHAPES FAIL CLOSED AND ARE INDISTINGUISHABLE FROM A GENUINE "off": a
  // rejected sender reads `{enabled:false}` / `{ok:false}`, exactly like a machine that has
  // never enabled the lane. A hostile page learns nothing from the difference.
  ipcMain.handle('orchestrator:getLaunchEnabled', appWindowOnly('getLaunchEnabled', { enabled: false }, () =>
    ({ enabled: channelPrefs.getOrchestratorLaunch() })));
  ipcMain.handle('orchestrator:setLaunchEnabled', appWindowOnly('setLaunchEnabled', { ok: false }, (_event, payload) => {
    const want = (payload || {}).enabled === true;
    const got = channelPrefs.setOrchestratorLaunch(want);
    // ⚠ THE FLIP HAS TO REACH REALTIME, and it cannot be a value the socket reads later: a
    // `postgres_changes` binding is fixed at JOIN time, so arming the lane REJOINS the
    // per-workspace channels (`main/realtime.js › setDirectives`). Without this call the
    // operator would turn the toggle on and nothing would subscribe until the next reconcile —
    // a setting that appears to work and silently does not, for up to five minutes.
    // ⚠ Lazy-required so this IPC module keeps loading in the harnesses, which stub `require`.
    try { require('./launch-directives').refresh(); }
    catch (err) { diag('orchestrator toggle: could not re-arm the directive lane —', err && err.message); }
    return got === want ? { ok: true, enabled: got } : { ok: false, reason: 'store', enabled: got };
  }));

  // ── THE PRIVATE DIRECT LANE'S TOGGLE (Samuel's ruling, 2026-08-31) ────────────────────────
  //
  // ⚠ **THE SAME SHAPE AS THE PAIR ABOVE AND A SEPARATE GRANT.** Launching over MCP buys
  // COMPUTE; directing over MCP reaches a running agent's PRIVATE lane and starts a turn in it.
  // An operator may want one and not the other, so there are two toggles and two IPC pairs.
  // ⚠ NO `channelId` AND NO UUID GATE: the subject is the MACHINE, so `=== true` on a bare
  // boolean is the whole validation.
  // ⚠ THE `refresh()` CALL IS LOAD-BEARING — without it the toggle flips and nothing subscribes
  // until the next reconcile, which is a setting that appears to work and silently does not.
  // Lazy-required so this IPC module keeps loading in the harnesses, which stub `require`.
  // ⚠ THE ANSWER IS MAIN'S OWN VALUE, never an echo of the request, so an SPA that stamped
  // optimistically can revert on `{ok:false}`.
  ipcMain.handle('orchestrator:getDirectEnabled', appWindowOnly('getDirectEnabled', { enabled: false }, () =>
    ({ enabled: channelPrefs.getOrchestratorDirect() })));
  ipcMain.handle('orchestrator:setDirectEnabled', appWindowOnly('setDirectEnabled', { ok: false }, (_event, payload) => {
    const want = (payload || {}).enabled === true;
    const got = channelPrefs.setOrchestratorDirect(want);
    try { require('./agent-directions').refresh(); }
    catch (err) { diag('orchestrator direct toggle: could not re-arm the direction lane —', err && err.message); }
    return got === want ? { ok: true, enabled: got } : { ok: false, reason: 'store', enabled: got };
  }));

  // ── ⚠ THE TURN-CAP CONTROL (2026-09-05, task 9b; Samuel's #1098 via #1101 4b, ruled #1177) ──
  //
  // THE THIRD MACHINE-WIDE PAIR IN THIS FILE, and it is here for the two orchestrator toggles'
  // exact reason: this is the `appWindowOnly` surface, and a second IPC module for one pair would
  // be a second place to forget the binding. No `channelId`, so nothing to UUID-gate.
  //
  // ⚠ THE BINDING IS THE WHOLE SECURITY PROPERTY, and it is the same CLASS as the toggles above
  // rather than a weaker one. The toggles are standing consent for another agent to spend this
  // Mac's compute; an UNBOUNDED turn cap is standing consent for one session to spend it without
  // end — the loop-safety brake, set from a page. There is no route, no MCP op and no column for
  // this key, deliberately: an agent holding this operator's device token (§6) must not be able
  // to remove the bound that stops it.
  // ⚠ AND `get` DISCLOSES A MACHINE SETTING, which is why the read is bound too.
  //
  // ⚠ THE ANSWER IS MAIN'S OWN VALUE, RE-READ, NEVER AN ECHO OF THE REQUEST — the rule
  // `sessions:setMode`, `sessions:setModel` and both toggles above follow. `set` reports
  // `{ok:false}` when the store did not end up holding what was asked for, which is what lets an
  // optimistic SPA stamp REVERT rather than show a cap nothing is enforcing.
  //
  // 🔒 `settings:getTurnCap` AND `settings:setTurnCap` STOOD HERE AND ARE DELETED (2026-09-07,
  // Samuel's ruling). Both routes are unregistered, not stubbed: an IPC channel that answers is a
  // surface a page can still call, and one that answers `{ok:true}` about a cap nothing enforces
  // would be the honest-controls defect in its purest form. A caller now gets the same "no such
  // channel" any other unknown route gets.
  // ⚠ THE PRELOAD BINDING AND THE SETTINGS ROW GO WITH THEM. A bound method over a missing route
  // is a control that throws on click rather than one that is absent.

  // ⚠ ONE REGISTRATION ENTRY POINT. The session + window ops take the SAME registry accessor
  // and the same binding; splitting the file did not split the wiring, because a second
  // `register(...)` in index.js would be a second place to forget `getSenderIds` — and an
  // unbound privileged surface is the bug this binding exists to prevent.
  sessionIpcOps.register({ getSenderIds: getSenderIds });
}

module.exports = { register };
