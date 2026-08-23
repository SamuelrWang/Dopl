// IPC bridge for the PER-CHANNEL SETTINGS the SPA can reach: the working folder, the durable
// launch posture, and auto-send. `renderer/app-preload.js` exposes the matching
// `window.dopl.channels.*` surface.
//
// ⚠ THE SESSION + WINDOW OPS SPLIT OUT ON 2026-08-20 (F-226) into `main/session-ipc-ops.js`.
// This file sat at EXACTLY 500 lines, which under INVARIANTS §1 means it could not absorb so
// much as a corrected COMMENT — and it was carrying four stale ones. The seam is
// reason-to-change: `channels:*` moves when a new per-channel SETTING is added, `sessions:*` /
// `threads:*` move when the agent surface moves. `register()` below still calls that module,
// so `index.js` has ONE registration entry point and one place to pass the registry accessor.
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
//     directory. The page cannot set a path of its own choosing; it can merely
//     trigger a picker the user then drives (or cancels).
//   • No filesystem handle, no absolute path, no listing — nothing beyond these
//     three label-scoped operations is exposed.
//
// ⚠ THIS PARAGRAPH USED TO READ "the main window hosts REMOTE content (usedopl.com)", and
// that was the stated JUSTIFICATION for the whole binding until 2026-08-20. The website is
// retired (`main/version-gate.js`, `main/spa-window.js`) and the shell loads the bundled SPA
// from a file:// URL. The binding is not weaker for it: an app window can still host a
// cross-origin iframe, an XSS in the bundle is still an XSS, and the registry-plus-top-frame
// pair is what makes "a window that does not own this thing cannot change it" true. **The
// rule survives its original reason** — do not relax it on the grounds that the remote origin
// is gone.
//
// H3 (2026-07-31) — SENDER BINDING. Every handler here used to answer ANY renderer that could
// reach the channel name: the payload was validated, but the CALLER never was. `appWindowOnly`
// below is that missing half, applied to every op:
//
//   setLaunchPosture     sets the DURABLE execution posture for MY OWN launches
//   getLaunchPosture     discloses that posture
//   setAutoSend          decides whether my agent's replies leave without me
//   getAutoSend          discloses that setting
//   chooseFolder         pops a native OS dialog on demand (UI-jacking / nagging)
//   clearFolder          silently resets where a channel's agent runs
//   getFolderLabel       discloses a fragment of the operator's LOCAL path
//
// ⚠ `setPermissionPreset` STOOD AT THE TOP OF THAT LIST — the SINGLE-USE consent-card arm, and
// H3's own worst case. It is DELETED (2026-08-20, Samuel's ruling; F-233): its web controls
// had stopped rendering at the 2026-08-18 consent rewrite, so the ops armed a record nothing
// could set. `setLaunchPosture` inherits the title of most privileged write here — the DURABLE
// half of the same two axes, same validator, same UUID gate, and a longer-lived write than the
// arm ever had. `main/channel-prefs.js` states why the two were never merged.
//
// Two checks, because one is not enough: the sender must be an APP-OWNED window's
// webContents, AND it must be that window's TOP frame. A cross-origin iframe SHARES its
// host's webContents, so identity alone would still let embedded third-party content drive
// every op above. ⚠ THE PREDICATE IS SHARED — `main/ipc-guards.js › isAppWindowSender`, ONE
// source with `ui-bridge.js` since 2026-08-20 (it was two byte-identical copies, and they had
// already disagreed once: F-221). The `appWindowOnly` WRAPPER stays written literally at each
// registration site, because `test/channel-ipc-sender.test.mjs`'s structural belt reads that
// shape and a factory would silently disarm it.
//
// ⚠ THE FIRST HALF WIDENED ON 2026-08-18 (wiring plan Phase 10, Samuel's ruling — option (a)):
// the subject was "the MAIN window" and is now "any window in `main/app-windows.js`'s
// registry", which is the shell plus any pop-out thread or agent window. Read app-windows.js's
// header for why a renderer cannot enlarge that registry. ⚠ NOTHING ELSE MOVED: the top-frame
// check is unchanged, the direction is still fail-closed, and each op's refusal is still
// byte-identical to its own bad-payload rejection so a hostile page cannot probe which window
// it is running in.

const { ipcMain } = require('electron');
const { isAppWindowSender, isUuid } = require('./ipc-guards');
const channelDirs = require('./channel-dirs');
const channelPrefs = require('./channel-prefs');
const sessionIpcOps = require('./session-ipc-ops');
const { diag } = require('./diag');

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

  // ⚠ ONE REGISTRATION ENTRY POINT. The session + window ops take the SAME registry accessor
  // and the same binding; splitting the file did not split the wiring, because a second
  // `register(...)` in index.js would be a second place to forget `getSenderIds` — and an
  // unbound privileged surface is the bug this binding exists to prevent.
  sessionIpcOps.register({ getSenderIds: getSenderIds });
}

module.exports = { register };
