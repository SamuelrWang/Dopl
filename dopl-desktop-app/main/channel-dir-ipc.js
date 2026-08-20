// IPC bridge for the in-app "Change folder" control (renderer/preload.js exposes
// the matching `window.dopl.channels.*` surface). Kept OUT of index.js so the
// main entrypoint stays under the ENGINEERING §2 500-line cap.
//
// SECURITY MODEL — the main window hosts REMOTE content (usedopl.com), so the
// handlers in this file are the entire privileged surface the web page can reach
// for per-channel settings, and each is deliberately minimal. The three folder
// ops first:
//
//   • channelId is validated as a UUID and rejected otherwise, so a hostile page
//     can't probe arbitrary store keys or smuggle a path fragment through the id.
//   • getFolderLabel / chooseFolder return the ABBREVIATED label only
//     (channel-dirs.liveChannelDirLabel → "~/Downloads/repo" | null). The raw
//     absolute path NEVER crosses back to the renderer, so the local path can't
//     leak to the web page or the Dopl server.
//   • chooseFolder can only OPEN the native OS folder dialog — the USER picks the
//     directory. The page cannot set a path of its own choosing; it can merely
//     trigger a picker the user then drives (or cancels).
//   • No filesystem handle, no absolute path, no listing — nothing beyond these
//     three label-scoped operations is exposed.
//
// Two further ops read/write the per-channel PERMISSION PRESET (the two axes the
// operator picks on the consent card before Allow). They are UUID-gated the same
// way, and every value is re-validated in main against the frozen tool/message
// enums — the renderer can never store a mode that is not one of the eight known
// strings, and a bad pair writes nothing. See main/channel-prefs.js.
//
// The one additional handler here, `sessions:reopen`, is the main-window bridge
// for the web session-card's "Open session" button. It asks the session engine to
// SHOW an existing LIVE session window for a (channel, task) the operator owns; when
// none survives, the engine's P2 fallback (recreateParkedShell) recreates a DORMANT,
// parked window from the durable record + retained sdkSessionId (subject to the shared
// window cap). Either way it starts NO query and runs NO gated tool — a window show()
// or a query-less parked shell (F-072: no read-triggered server/realtime writes) — and
// returns `{ ok }` (ok:false only for a truly-closed thread). channelId is UUID-validated
// like the folder ops; reopenByTask may return a Promise (the fallback is async), which
// ipcMain.handle awaits before replying.
//
// v3.0 VOCABULARY: "Open session" opens the operator's OWN window on a shared THREAD.
// It never starts the agent — only a steer or an accepted inbound resumes a parked
// shell. Wire name `task` == domain name `thread` (the ids stay `taskId`).
// Pinned by test/open-session-no-query.test.mjs.
//
// H3 (2026-07-31) — SENDER BINDING. Every handler below used to answer ANY
// renderer that could reach the channel name: the payload was validated, but the
// CALLER never was. session-ipc.js has always re-derived its target from
// `event.sender` (the frozen §B.3 contract) precisely so a window that does not
// own the thing being changed cannot change it; this file was the one privileged
// surface that skipped that step, while being exposed on the window that loads
// REMOTE usedopl.com content. `appWindowOnly` below is that missing half (it was
// NAMED `mainOnly` from H3 until Phase 10 widened its subject — see the note under
// the op list), applied to every op — not just the permission preset that made it
// a HIGH:
//
//   setPermissionPreset  arms EXECUTION permission for a channel (the H3 report)
//   getPermissionPreset  discloses the posture a channel is armed with
//   setLaunchPosture     sets the DURABLE execution posture for MY OWN launches
//   getLaunchPosture     discloses that posture
//   chooseFolder         pops a native OS dialog on demand (UI-jacking / nagging)
//   clearFolder          silently resets where a channel's agent runs
//   getFolderLabel       discloses a fragment of the operator's LOCAL path
//   sessions:reopen      opens/recreates session windows for arbitrary threads
//   sessions:pause       (Phase 5) interrupts the turn my agent is running on a thread
//   sessions:end         (Phase 5) ends my agent on a thread — terminal, and never the thread
//   threads:openWindow   (Phase 10) opens a pop-out window on ONE thread
//
// Two checks, because one is not enough: the sender must be an APP-OWNED window's
// webContents, AND it must be that window's TOP frame. A cross-origin iframe
// SHARES its host's webContents, so identity alone would still let embedded
// third-party content drive every op above.
//
// ⚠ THE FIRST HALF WIDENED ON 2026-08-18 (wiring plan Phase 10, Samuel's ruling —
// option (a)): the subject was "the MAIN window" and is now "any window in
// `main/app-windows.js`'s registry", which is the shell plus any pop-out thread
// window. `mainOnly` is `appWindowOnly` for the same reason. Read app-windows.js's
// header for why a renderer cannot enlarge that registry. ⚠ NOTHING ELSE MOVED:
// the top-frame check is unchanged, the direction is still fail-closed, and each
// op's refusal is still byte-identical to its own bad-payload rejection so a
// hostile page cannot probe which window it is running in.

const { ipcMain } = require('electron');
const channelDirs = require('./channel-dirs');
const channelPrefs = require('./channel-prefs');
const { diag } = require('./diag');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// ─── BEGIN CHANNEL-IPC-SENDER (pure; unit-tested via source extraction) ──────
// No electron/require refs below, so test/channel-ipc-sender.test.mjs slices this
// and drives it with fakes (the CHANNEL-DIR-RESOLVE idiom).

// TRUE only for an APP-OWNED window's own TOP frame. `senderIds` is the LIVE set
// of bound `webContents.id`s (main/app-windows.js › senderIds), resolved at CALL
// time — register() runs before any window exists, the shell is replaced on
// reopen, and a pop-out may appear at any moment — so an absent, empty or stale
// set fails closed rather than throwing.
//
// `senderFrame` is a getter that THROWS once the frame is detached, so it is read
// defensively: a frame we cannot read is refused, never waved through.
//
// ⚠ THE FRAME CHECK IS FAIL-CLOSED ON AN ABSENT FRAME AS OF PHASE 10, matching
// `main/ui-bridge.js › isAppWindowSender`. The pre-Phase-10 form here read
// `if (frame && sender.mainFrame && frame !== sender.mainFrame) return false`,
// which WAVED THROUGH a `senderFrame` that read as null/undefined while the
// bridge's copy refused it — two copies of "the same" predicate disagreeing about
// the more privileged surface (this file arms permission presets). Closed in the
// same security change that widened the identity half; recorded as F-221.
function isAppWindowSender(event, senderIds) {
  if (!senderIds || typeof senderIds.has !== 'function') return false;
  const sender = event && event.sender;
  if (!sender) return false;
  if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return false;
  if (typeof sender.id !== 'number' || !senderIds.has(sender.id)) return false;
  let frame;
  try {
    frame = event.senderFrame;
  } catch (_) {
    return false; // frame already detached — nothing legitimate calls from there
  }
  // An iframe shares the host's webContents; only the top frame may drive these.
  if (!frame || !sender.mainFrame || frame !== sender.mainFrame) return false;
  return true;
}
// ─── END CHANNEL-IPC-SENDER ─────

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

  // Read the current abbreviated label. Label only — never the absolute path.
  ipcMain.handle('channels:getFolderLabel', appWindowOnly('getFolderLabel', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return channelDirs.liveChannelDirLabel(channelId);
  }));

  // Open the native picker (user-driven), store the pick, return the fresh label.
  // On cancel the stored dir is unchanged, so the prior label is returned.
  ipcMain.handle('channels:chooseFolder', appWindowOnly('chooseFolder', null, async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    try {
      await channelDirs.promptAndSetChannelDir(channelId);
    } catch (err) {
      diag('channel-dir ipc choose error', err && err.message);
    }
    onChanged();
    return channelDirs.liveChannelDirLabel(channelId); // label only
  }));

  // Reset to the sandbox default; there is no custom label afterwards.
  ipcMain.handle('channels:clearFolder', appWindowOnly('clearFolder', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    channelDirs.clearChannelDir(channelId);
    onChanged();
    return null;
  }));

  // ── Per-channel PERMISSION ARM (main/channel-prefs.js owns the store) ─────
  // The two axes the operator picks on the inbound consent card BEFORE Allow, so
  // the spawned session starts on the posture they approved instead of one they
  // can only correct after the agent is already running.
  //
  // H2 (2026-07-31): what this WRITES is a single-use, expiring ARM, not a durable
  // channel setting. Only the consent-approved launch may consume it, and doing so
  // deletes it. That is what keeps a compromised page's write from mattering: the
  // worst it can do is pre-arm a posture a HUMAN must still explicitly Allow, on a
  // card that shows that posture, before it applies to anything — and if they do
  // not, it expires. See the header of channel-prefs.js for the full contract.
  //
  // Same guards as the folder ops, plus two more: the sender is bound (appWindowOnly)
  // and the renderer is NEVER trusted with the values. channelId is UUID-gated
  // here; both modes are re-validated in channel-prefs against the frozen enums
  // and an unknown value on either axis writes nothing ({ ok: false }).

  // → { tools, messages } for the channel, or null when nothing is armed (the
  //   card then shows the defaults without claiming they were chosen). Reading
  //   NEVER extends the arm's life.
  ipcMain.handle('channels:getPermissionPreset', appWindowOnly('getPermissionPreset', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return channelPrefs.getPermissionPreset(channelId);
  }));

  // → { ok: true } when BOTH axes validated and the pair was armed; { ok: false }
  //   for a bad channel id or an unknown mode. Fail-closed: nothing is written on
  //   a partial or unknown pair.
  ipcMain.handle('channels:setPermissionPreset', appWindowOnly('setPermissionPreset', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return channelPrefs.armPermissionPreset(p.channelId, p.preset);
  }));

  // THE DURABLE LAUNCH POSTURE (2026-08-20). Same two axes as the arm above and
  // the same validation, but a DIFFERENT record with a different consumer —
  // channel-prefs.js's own block is the statement of the split, read it before
  // changing either op. Same `appWindowOnly` + UUID gating as everything here;
  // both modes are re-validated in channel-prefs against the frozen enums, so an
  // unknown value on either axis writes nothing.
  // → the EFFECTIVE pair, never null (an unset channel really is manual/ask).
  ipcMain.handle('channels:getLaunchPosture', appWindowOnly('getLaunchPosture', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return channelPrefs.getLaunchPosture(channelId);
  }));
  ipcMain.handle('channels:setLaunchPosture', appWindowOnly('setLaunchPosture', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return channelPrefs.setLaunchPosture(p.channelId, p.preset);
  }));

  // AUTO-SEND (2026-08-20) — the durable per-channel send posture (channel-prefs.js
  // owns storage + the default-off rule). Boolean in, boolean out, UUID-gated like
  // every op here; a bad id reads false and writes nothing.
  ipcMain.handle('channels:getAutoSend', appWindowOnly('getAutoSend', false, (_event, channelId) => {
    if (!isUuid(channelId)) return false;
    return channelPrefs.getAutoSend(channelId);
  }));
  ipcMain.handle('channels:setAutoSend', appWindowOnly('setAutoSend', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return { ok: true, on: channelPrefs.setAutoSend(p.channelId, p.on === true) };
  }));

  // LAUNCH MY OWN AGENT ONTO A THREAD (2026-08-20, the Agents tab's button). A
  // WINDOWLESS requester-side session: the clicking human IS the consent (it is
  // their own agent on their own thread — no row is raised), the message axis is
  // floored at auto_inbound, and the OUT half is the channel's auto-send posture.
  // UUID-gated channel; taskId must be a UUID too (first-class threads only —
  // a legacy exchange has no thread to attach to). Fail shape: { ok: false }.
  ipcMain.handle('sessions:launch', appWindowOnly('sessions:launch', { ok: false }, async (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId) || !isUuid(p.taskId)) return { ok: false };
    if (!isUuid(p.counterpartyId)) return { ok: false, reason: 'no-counterparty' };
    const engine = require('./session-engine');
    const channelPrefs = require('./channel-prefs');
    const targeting = require('./targeting');
    const listener = require('./channel-listener');
    // ⚠ CONTAINMENT: the profile comes from MAIN's own watched-channel record
    // (the server DTO), never the renderer's claim — a forged call must not
    // widen it. An unwatched channel fails restrictive.
    const watched = (listener.listWatchedChannels() || []).find((c) => c.id === p.channelId);
    const toolProfile = watched ? targeting.resolveToolProfile(watched) : 'read_only';
    const title = typeof p.threadTitle === 'string' ? p.threadTitle.slice(0, 200) : '';
    const res = await engine.launchRequesterSession({
      channelId: p.channelId,
      taskId: p.taskId,
      workspaceId: typeof p.workspaceId === 'string' ? p.workspaceId : null,
      goal: title
        ? `Join the thread "${title}" as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.`
        : 'Join this thread as my agent: read it with dopl_channel (op "get_thread") and carry the work forward.',
      counterpartyId: isUuid(p.counterpartyId) ? p.counterpartyId : null,
      direct: p.direct === true,
      context: {
        channelName: typeof p.channelName === 'string' ? p.channelName.slice(0, 120) : '',
        taskTitle: title || null,
        channelId: p.channelId,
        workspaceId: typeof p.workspaceId === 'string' ? p.workspaceId : null,
        taskId: p.taskId,
        workspaceSegment: typeof p.workspaceSegment === 'string' ? p.workspaceSegment : null,
      },
      toolProfile,
      mode: 'interactive',
      windowless: true,
      // THE DURABLE POSTURE, CONSUMED HERE AND NOWHERE ELSE (2026-08-20).
      // ⚠ `tools` was PINNED to 'manual' and the operator's Settings-tab pick was
      // never read on this lane at all, so "Tools = Bypass" did nothing for the
      // one launch shape the button in front of them starts. It is a real read
      // now — and this is the ONLY call site, which is what keeps H2 intact: the
      // click on Launch is the human decision this posture applies to, exactly
      // like the consent Allow is the arm's. A peer wake, a resume and a
      // recreate still pass nothing and still inherit manual/ask.
      // ⚠ MESSAGES WIDENS, NEVER NARROWS, and it is floored at auto_inbound for
      // the windowless reason (no Accept UI exists). Auto-send is the durable
      // OUT switch; an auto_outbound / auto_both posture is a second way to say
      // the same thing, so either turns the floor into auto_both — and neither
      // can drop below it.
      startModes: channelPrefs.launchStartModes(p.channelId),
    });
    if (res && res.sessionId) return { ok: true, sessionId: res.sessionId };
    return { ok: false, reason: (res && res.skipped) || 'unknown' };
  }));

  // Reveal a LIVE session window for a (channel, task) from the MAIN window.
  // channelId is UUID-validated (the same anti-probe guard as the folder ops);
  // taskId is an opaque string (a legacy `task-{channel}-{seq}` id or a
  // first-class UUID), coerced and handed to the engine, which resolves the
  // session by `store.sessionKey(channelId, taskId)`. `reopenByTask` is a
  // T2-added export; if it is not wired yet (mid-wave), fail closed with
  // { ok: false } rather than throwing. Lazy-require to avoid any load-time
  // cycle — the engine is only touched when a reopen is actually requested.
  ipcMain.handle('sessions:reopen', appWindowOnly('sessions:reopen', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.reopenByTask !== 'function') return { ok: false };
    return engine.reopenByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
    });
  }));

  // PAUSE / END MY OWN AGENT, from the Agents tab in the main window (wiring plan Phase 5,
  // 2026-08-18). Same guards as `sessions:reopen` — sender-bound, UUID-gated channel id, opaque
  // task id — and the SAME resolution (`store.sessionKey`), so the two ops cannot disagree about
  // which session a card names.
  //
  // ⚠ THESE ARE STOP VERBS AND THEY WIDEN NOTHING. `reopen` opens a window; these two reach the
  // reducer events the session's OWN window has always had on its buttons (`session:interrupt`
  // is the send button's pause morph, `session:end` is "End session"). Nothing here can START a
  // query, wake a parked shell, grant a tool or post on the operator's behalf — the failure
  // direction of a forged call is an agent that stops, which is the safe one.
  // ⚠ There is no cross-machine control here and there must not be: the registry holds only
  // this operator's own sessions, so an unresolvable key answers { ok: false } rather than
  // reaching for anything else. Pause/end is own-agents-only (Samuel's ruling, INVARIANTS §11).
  // ⚠ THE BODY IS SHARED, THE WRAPPING IS NOT. `appWindowOnly(...)` appears literally at each
  // `ipcMain.handle` call below, because test/channel-ipc-sender.test.mjs's structural belt
  // reads exactly that shape — every registered handler must be visibly sender-bound at its
  // registration site. Hiding the wrap inside a factory would pass review and silently
  // disarm the guard that stops the NEXT op being added unbound.
  const control = (action) => (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.controlByTask !== 'function') return { ok: false };
    return engine.controlByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
      action: action,
    });
  };
  ipcMain.handle('sessions:pause', appWindowOnly('sessions:pause', { ok: false }, control('pause')));
  ipcMain.handle('sessions:end', appWindowOnly('sessions:end', { ok: false }, control('end')));

  // THE POP-OUT THREAD WINDOW (wiring plan Phase 10, 2026-08-18). The thread view's
  // "Open as new window" button — a SECOND window on the SAME SPA bundle, landing on the
  // channel route with this thread selected. It is the op the whole sender-binding
  // widening exists for, and it is the only one that can MINT a window.
  //
  // ⚠ THE PAYLOAD IS THREE STRINGS ENTERING A ROUTER PATH, and none of them is trusted:
  // `channelId` is UUID-gated like every op above, and `segment` + `threadId` pass
  // `deep-link-target.js › isSafeSegment` — the ONE character rule for a string entering a
  // router path (INVARIANTS §11). A second regex here would be a second answer to it.
  // Required LAZILY so this file keeps its load-time dependency set at three modules.
  // ⚠ THE VERSION FLOOR APPLIES. `createShellWindow` is the min-version gate's single
  // enforcement point (main/shell-mode.js), and a factory that bypassed it would be a window
  // the block does not cover — so a blocked build refuses here rather than growing a second
  // door. There is nothing to pop out of anyway: the shell is the update screen.
  // ⚠ REFUSES IN THE SAME `{ ok: false }` SHAPE as a bad channel id, a foreign sender and a
  // full window budget alike — a hostile page must not learn which one it hit.
  ipcMain.handle('threads:openWindow', appWindowOnly('threads:openWindow', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const { isSafeSegment } = require('./deep-link-target');
    if (!isSafeSegment(p.segment) || !isSafeSegment(p.threadId)) return { ok: false };
    try {
      if (require('./version-gate').isBlocked()) {
        diag('channel-dir ipc: refused threads:openWindow — the version floor is blocking');
        return { ok: false };
      }
    } catch (_err) { /* mid-wave / harness: no gate is not a block */ }
    return require('./popout-window').openThreadWindow({
      segment: p.segment,
      channelId: p.channelId,
      threadId: p.threadId,
    });
  }));
}

module.exports = { register };
