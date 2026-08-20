// Menu-bar tray for the background role. Template image (macOS recolors it),
// simple menu: Open Dopl / listener status / Quit.

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const appVersion = require('./app-version');

let tray = null;
let currentStatus = 'Listener: starting…';
let signedOutNow = false; // the listener's own signed-out fact (never parsed from the string)
let handlers = {};
let updateReadyVersion = null; // staged-update version; see refreshUpdateReady()
let updateNote = null; // { text, busy } — what the updater is doing right now
let peerSkew = null; // Q10: the newest older-build peer seen this run ({ peer, mine, who })
let versionFloor = null; // min-version gate, WARNING state only ({ tray, ... }) or null
let pendingCount = 0; // Round B: number of pending consent requests (inbound + review)

function iconPath() {
  // Base 16px + a trayTemplate@2x.png sibling for retina (nativeImage picks up
  // the @2x variant by the filename convention).
  return path.join(__dirname, '..', 'renderer', 'assets', 'trayTemplate.png');
}

// Round C: "Channel folders" submenu — per channel, show its current working
// folder (abbreviated ~/… or the sandbox default) and let the operator choose one
// or revert. The folder is the agent's CONTEXT + default cwd, NOT a sandbox: the
// header spells that out so the operator does not read it as a security boundary.
// The channel list + per-channel labels come from index.js accessors, queried
// fresh on every rebuild so a newly-watched channel / changed folder shows up.
function channelFoldersSubmenu() {
  const list = (handlers.getChannels && handlers.getChannels()) || [];
  const items = [
    { label: "Sets where each channel's agent runs (context, not a sandbox)", enabled: false },
    { type: 'separator' },
  ];
  if (!list.length) {
    items.push({ label: 'No channels watched yet', enabled: false });
    return items;
  }
  for (const ch of list) {
    const label = (handlers.getChannelDirLabel && handlers.getChannelDirLabel(ch.id)) || null;
    items.push({
      label: ch.name || 'Channel',
      submenu: [
        { label: label ? `Folder: ${label}` : 'Folder: Default (sandbox)', enabled: false },
        { type: 'separator' },
        { label: 'Choose folder…', click: () => handlers.onSetChannelDir && handlers.onSetChannelDir(ch.id) },
        {
          label: 'Use default folder',
          enabled: !!label,
          click: () => handlers.onClearChannelDir && handlers.onClearChannelDir(ch.id),
        },
      ],
    });
  }
  return items;
}

// ⚠ The "Sessions" tray submenu is GONE with window mode (2026-08-20, settings.js
// header). It held the "Run sessions in a window" executor checkbox and the live
// session windows' Reopen/Show rows — with no session window ever minted, both
// were permanently empty chrome. Sessions are headless, watched in the Agents tab.

// ─── BEGIN TRAY-AUTH (pure; unit-tested via source extraction) ──────────────
// Q4 fix 3: the tray was the ONLY surface that knew the listener was signed out,
// and all it did was print a dead "Listener: signed out" line — no way to act on
// it. Meanwhile the app window rendered signed in on its cookies, so the operator
// had no reason to suspect anything and no control to fix it; the actual field
// recovery was deleting the app's Cookies store by hand.
//
// So the signed-out state drives an affordance: signed out → a clickable "Sign in…"
// that runs the real CSRF-gated OAuth flow; otherwise → "Sign out", which clears
// BOTH the stored blob and the cookie jar. Pure (boolean in, descriptor out) so the
// state transitions are a truth table, not a click test.
//
// FIX (Q5 review): this took the STATUS STRING and ran /signed out/i over it. The
// listener already knows the fact — it calls auth.isSignedIn() to build that string
// — so the tray was re-deriving a boolean from prose it does not own. Rewording
// "Listener: signed out" would have removed the only sign-in entry point in the app
// with nothing failing. channel-listener.setStatus now passes the boolean.
function authMenuState(signedOut) {
  return signedOut === true
    ? { signedOut: true, action: 'signIn', label: 'Listener signed out — Sign in…' }
    : { signedOut: false, action: 'signOut', label: 'Sign out' };
}
// ─── END TRAY-AUTH ───────────────────────────────────────────────────────────

// ─── BEGIN TRAY-UPDATE (pure; unit-tested via source extraction) ─────────────
// Q10(c): electron-updater downloads in the background and installs ON QUIT, and
// a background listener app is quit approximately never. So a Mac can sit on a
// stale build for days while its operator believes it is current — which is what
// cost a full debugging round on 2026-07-31, with a shipped fix reading as broken
// because it was not running. The staged install has to become VISIBLE.
//
// It never restarts on its own: a restart would kill a live spawned session
// mid-turn, so the operator decides when. The affordance is therefore a click,
// plus the tooltip so the menu does not have to be opened to find out.
function updateMenuState(readyVersion) {
  const v = typeof readyVersion === 'string' && readyVersion.trim() ? readyVersion.trim() : '';
  return v
    ? { ready: true, version: v, label: 'Update ready — restart to install v' + v }
    : { ready: false, version: '', label: '' };
}

// The manual check, and the line that reports what it did.
//
// 2026-08-01: publishing a build and then waiting up to four hours for the
// running app to notice is the operator's actual complaint. The click is the
// answer, and the NOTE is what keeps it from being a button that appears to do
// nothing: "Checking for updates…" → "Up to date (v1.7.18)" / "Downloading
// update… 43%" / "Update ready: v1.7.19" / "Update check failed: …". The same
// note is how a long download stops looking like a hung app.
//
// `busy` disables the item while a check or download is in flight, so a second
// click cannot start a second fetch or read as a no-op.
function checkMenuState(note) {
  const text = note && typeof note.text === 'string' ? note.text.trim() : '';
  const busy = !!(note && note.busy);
  return { label: 'Check for updates now', enabled: !busy, note: text };
}

// The hover text. The tray icon is the ONLY always-visible surface this app has,
// so a staged update says so there rather than only inside the menu — and so
// does an in-flight download, which is the state the operator most needs to see
// without clicking anything (quitting halfway is what throws the copy away).
// Settled notes ("Up to date") stay in the menu: a tooltip that keeps asserting
// them hours later would be stale.
function trayTooltip(status, readyVersion, note) {
  const head = status || 'Dopl';
  const u = updateMenuState(readyVersion);
  const lines = [head];
  if (u.ready) lines.push(u.label);
  if (note && note.busy && note.text) lines.push(String(note.text));
  return lines.join('\n');
}

// Q10(b): the other half of a version mismatch, stated as a fact and nothing
// more. Disabled (no click, no action) because the fix is on the PEER's machine;
// this line exists so "why is their side behaving like the old build" has an
// answer on screen. '' when there is nothing to say.
function skewMenuLabel(skew) {
  if (!skew || !skew.peer) return '';
  const who = skew.who ? String(skew.who) : 'A peer';
  return who + ' is on v' + skew.peer + ', you are on v' + (skew.mine || '?');
}

// The minimum-version gate's WARNING state, and only that state. A hard block
// has its own window and never reaches the tray; this line is what a DEGRADED
// block looks like — the server asked for a build that cannot be installed here
// (nothing newer is published, or this build has no updater at all), so the app
// keeps working and the tray states the fact. Disabled, like the skew line: the
// fix is a release, not a click. '' when there is nothing to say.
function floorMenuLabel(notice) {
  return notice && notice.tray ? String(notice.tray) : '';
}
// ─── END TRAY-UPDATE ─────────────────────────────────────────────────────────

// WHERE "an update is staged" IS READ FROM (2026-07-31). The tray used to keep
// ONLY its own copy, fed exclusively by updater's `onReady` event — so the menu
// could answer the question only for a tray that already existed when the
// download finished. updater.isUpdateReady() / updateReadyVersion() were added
// for exactly that gap and then never called by anyone: two dead exports next to
// the bug they were written for. index.js happens to call tray.create() BEFORE
// updater.init(), which is the one ordering under which the event-only path
// works, and nothing pins it — reorder those two lines, or rebuild the tray
// after a download, and the restart item silently vanishes while a staged build
// sits there. That is precisely the Q10 failure (a Mac running a build nobody
// believes it is running), so the menu now asks the module that OWNS the fact
// and keeps the event echo as the fallback.
//
// Lazily required so tray.js holds no top-level updater dependency and still
// loads in a harness where the module is absent. Refreshed on every rebuild
// rather than read once: `readyVersion` is set by an event we do not control.
function refreshUpdateReady() {
  try {
    const updater = require('./updater');
    if (updater.isUpdateReady()) updateReadyVersion = updater.updateReadyVersion();
  } catch (_) { /* no updater here — keep whatever setUpdateReady last echoed */ }
}

function buildMenu() {
  refreshUpdateReady(); // Q10: the updater owns the fact; the local is a cache
  const template = [
    { label: 'Open Dopl', click: () => handlers.onOpen && handlers.onOpen() },
  ];
  // A signed-out listener gets its call to action at the TOP of the menu, above
  // everything else — it is the one thing that has to be fixed first.
  const authItem = authMenuState(signedOutNow);
  if (authItem.signedOut) {
    template.push({ label: authItem.label, click: () => handlers.onSignIn && handlers.onSignIn() });
  }
  // Round B: surface pending consent requests and let a click jump straight to the
  // Channels / Pending Requests view (reuses the notification-click open path).
  if (pendingCount > 0) {
    template.push({
      label: `Pending: ${pendingCount} request${pendingCount === 1 ? '' : 's'}`,
      click: () => handlers.onPending && handlers.onPending(),
    });
  }
  // A staged update sits with the other CALLS TO ACTION at the top, not buried
  // under the submenus where it lived before: it is the item that explains a
  // whole class of "the fix does not work" (Q10c).
  const updateItem = updateMenuState(updateReadyVersion);
  if (updateItem.ready) {
    template.push({ label: updateItem.label, click: () => handlers.onUpdate && handlers.onUpdate() });
  }
  template.push(
    { type: 'separator' },
    { label: currentStatus, enabled: false },
    // This build, so the operator can answer "what am I on?" without the About
    // box — the other half of every version-skew conversation (Q10).
    { label: `Dopl v${appVersion.appVersion() || '?'}`, enabled: false }
  );
  const skewLabel = skewMenuLabel(peerSkew);
  if (skewLabel) template.push({ label: skewLabel, enabled: false });
  const floorLabel = floorMenuLabel(versionFloor);
  if (floorLabel) template.push({ label: floorLabel, enabled: false });
  // The manual check sits with the version lines it is about, and its outcome is
  // printed directly beneath so the click always visibly does something.
  const checkItem = checkMenuState(updateNote);
  template.push({
    label: checkItem.label,
    enabled: checkItem.enabled,
    click: () => handlers.onCheckUpdates && handlers.onCheckUpdates(),
  });
  if (checkItem.note) template.push({ label: checkItem.note, enabled: false });
  template.push(
    { label: 'Channel folders', submenu: channelFoldersSubmenu() },
    { type: 'separator' }
  );
  // The escape hatch. Present whenever we are NOT already signed out, so a wedged
  // session can always be dropped from here instead of by deleting the Cookies
  // store; when signed out the "Sign in…" item above is the affordance instead.
  if (!authItem.signedOut) {
    template.push({ label: authItem.label, click: () => handlers.onSignOut && handlers.onSignOut() });
  }
  template.push({ label: 'Quit Dopl', click: () => handlers.onQuit && handlers.onQuit() });
  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
  tray.setToolTip(trayTooltip(currentStatus, updateReadyVersion, updateNote));
}

function create(opts) {
  handlers = opts || {};
  const img = nativeImage.createFromPath(iconPath());
  if (!img.isEmpty()) img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  if (img.isEmpty()) tray.setTitle('Dopl'); // ensure the tray is visible
  buildMenu();
  return tray;
}

// `meta.signedOut` is the listener's own answer, not something re-read out of the
// status string (see authMenuState). Absent meta leaves the last known value alone,
// so a caller that only wants to change the label cannot flip the affordance.
function update(status, meta) {
  if (status) currentStatus = status;
  if (meta && typeof meta.signedOut === 'boolean') signedOutNow = meta.signedOut;
  if (tray) buildMenu();
}

// The `onReady` echo. Still wired (index.js): the EVENT is what makes the menu
// redraw the moment a download lands. The value it stores is now the FALLBACK —
// refreshUpdateReady() overrides it from the updater on every rebuild.
function setUpdateReady(version) {
  updateReadyVersion = version || null;
  if (tray) buildMenu();
}

// The updater's running commentary (checking / downloading N% / up to date /
// ready / failed). Rebuilds only on a real change, so a `download-progress`
// event that lands on the same whole percent does not redraw the menu ~200 times
// during a download. An empty text clears the line.
function setUpdateNote(text, opts) {
  const next = typeof text === 'string' && text.trim()
    ? { text: text.trim(), busy: !!(opts && opts.busy) }
    : null;
  const same = (updateNote && updateNote.text) === (next && next.text)
    && (updateNote && updateNote.busy) === (next && next.busy);
  if (same) return;
  updateNote = next;
  if (tray) buildMenu();
}

// Q10: the newest peer seen running an older build than this one. Latest wins
// (one line, not a growing list) and a falsy value clears it. Rebuilds only on a
// real change, so a repeated observation never redraws the menu.
function setPeerSkew(skew) {
  const next = skew && skew.peer ? skew : null;
  const same = (peerSkew && peerSkew.peer) === (next && next.peer) &&
    (peerSkew && peerSkew.who) === (next && next.who);
  if (same) return;
  peerSkew = next;
  if (tray) buildMenu();
}

// The min-version gate's standing line. A falsy notice clears it (the gate
// releases as soon as a satisfying build exists), and a repeat of the same line
// never redraws the menu.
function setVersionFloor(notice) {
  const next = notice && notice.tray ? notice : null;
  if ((versionFloor && versionFloor.tray) === (next && next.tray)) return;
  versionFloor = next;
  if (tray) buildMenu();
}

// Round B: update the "Pending: N" tray item. Called from the consent watcher via
// index.js whenever a pending request is created or resolved.
function setPendingCount(n) {
  const next = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (next === pendingCount) return;
  pendingCount = next;
  if (tray) buildMenu();
}

// Round C: rebuild the menu now (after a channel folder is set / cleared) so the
// "Channel folders" submenu reflects the change without waiting for a status tick.
function refresh() {
  if (tray) buildMenu();
}

function destroy() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = {
  create, update, setUpdateReady, setUpdateNote, setPeerSkew, setVersionFloor,
  setPendingCount, refresh, destroy,
};
