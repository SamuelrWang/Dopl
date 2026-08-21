// THE AGENT WINDOW (2026-08-20, F-212's closure).
//
// WHAT IT IS. One of MY agents, from the inside: what it is doing right now, what it has
// been doing (the narration ring), what it has sent, and a 1:1 composer that talks to it
// out of band. It is the surface the session window used to be, rebuilt on the channels
// tree — not restored. The session window is gone (INVARIANTS §11, F-228) and none of it
// comes back: no transcript of its own, no permission cards, no folder chip, no modes
// header. Those either moved to the channels surfaces or died with the retirement.
//
// ⚠ WHY IT EXISTS AT ALL, IN THE OPERATOR'S OWN WORDS. Between the retirement and this
// window, the agent view's "Open window" button had nothing to open, and the honest
// refusal we shipped in the meantime read "This agent runs without a window" — which
// Samuel correctly called meaningless. **A WINDOW IS A VIEW, NOT A RUNTIME PROPERTY.**
// Whether main happens to have minted a BrowserWindow for a session is an implementation
// detail of the spawn shape; it is not a fact about the agent, and it is certainly not an
// answer to "show me what this thing is doing". The button now always opens this view, and
// the notice is deleted.
//
// ⚠ IT IS THE POP-OUT'S SHAPE, DELIBERATELY, AND INHERITS ITS RULING. `popout-window.js`
// is the model for every line below: `spa-window.js › spaWebPreferences` and
// `› policeNavigation` shared VERBATIM (never copied), `appWindows.register(win)` in MAIN
// at creation, one window per key, a hard ceiling, `{ ok: false }` for every refusal so a
// caller cannot tell them apart, and a route that is deliberately NOT deep-linkable.
// Samuel's option-(a) ruling (widen the sender binding to a registry of app-owned windows)
// is what makes a second app window possible at all, and this is the third kind under it —
// so the security argument is inherited, not re-opened. `main/app-windows.js`'s header
// carries it.
//
// ⚠ THE ROUTE IS KEYED (channel, thread), LIKE EVERY OTHER AGENT ADDRESS IN THIS TREE.
// Never `sessionId`: that id is re-minted by a park+resume or a recreate, so a window keyed
// on it would orphan itself under the operator the moment their agent parked. It is the
// same pair `sessions.pause` / `sessions.end` / `reopen` take, and the same pair main
// resolves against its own registry.

const { BrowserWindow } = require('electron');
const appWindows = require('./app-windows');
const spaWindow = require('./spa-window');
const { diag } = require('./diag');

// ⚠ A HAND COPY of `apps/desktop-ui/src/routes.tsx › AGENT_WINDOW_PATH` (main cannot
// import the SPA's TypeScript — the same constraint `deep-link-target.js`'s page table and
// `popout-window.js › THREAD_WINDOW_PAGE` are under). `test/agent-window.test.mjs` reads
// the SPA export and fails on drift.
const AGENT_WINDOW_PAGE = 'agent-window';

// ⚠ A RENDERER-DRIVEN WINDOW FACTORY WITH NO CEILING IS A RESOURCE PRIMITIVE — the same
// sentence `popout-window.js` carries, and the same number. It is SEPARATE from the
// pop-out's budget on purpose: they are different surfaces answering different questions,
// and one full budget must not refuse the other.
const MAX_AGENT_WINDOWS = 4;

// key -> BrowserWindow. Reuse rather than duplicate: asking twice for the same agent
// FRONTS the window that already shows it.
const openWindows = new Map();

// ─── BEGIN AGENT-ROUTE-PURE (unit-tested via source extraction) ──────────────
// No electron/require refs below.

/** One window per (channel, thread) — the agent's own stable key. */
function agentWindowKey(channelId, taskId) {
  return `${channelId}|${taskId}`;
}

/**
 * THE ROUTE AN AGENT WINDOW LANDS ON, as a hash-router path.
 *
 * ⚠ EVERY INPUT IS ALREADY CHARACTER-CHECKED BY THE CALLER (`channel-dir-ipc.js` runs the
 * UUID gate on the channel and `deep-link-target.js › isSafeSegment` on the other two).
 * This refuses an EMPTY one and interpolates the rest — deliberately NOT a second copy of
 * the character rule, because a second copy is a second answer to it (INVARIANTS §11).
 *
 * ⚠ THE THREAD RIDES `?thread=` AS A SELECTION, exactly as the pop-out's does: which agent
 * this window is showing is not a different PAGE.
 */
function agentRoute(segment, page, channelId, taskId) {
  if (!segment || !page || !channelId || !taskId) return null;
  return `/${segment}/${page}/${channelId}?thread=${taskId}`;
}
// ─── END AGENT-ROUTE-PURE ────────────────────────────────────────────────────

/** Forget windows that have gone, so the budget counts only live ones. */
function sweep() {
  for (const [key, win] of Array.from(openWindows)) {
    if (!appWindows.isLiveWindow(win)) openWindows.delete(key);
  }
  return openWindows;
}

// ⚠ 460x640 — TALLER AND NARROWER THAN THE POP-OUT'S 520x600, and the difference is the
// content, not a preference. A thread window holds a conversation (wide enough for two
// speakers' bubbles); this holds a NARRATION STREAM, which is one column of short lines
// and wants vertical room. Default size IS the floor, the rule `session-window.js`
// established: the window opens at its most compact and the operator grows it.
// ⚠ `title` is the PRE-PAINT name only — the renderer sets `document.title` to
// "Dopl — <agent>" once the feed lands, and Electron copies it onto the window. Nothing
// here disables that, and it must not start to.
function createAgentWindow(route) {
  const win = new BrowserWindow({
    width: 460,
    height: 640,
    minWidth: 460,
    minHeight: 640,
    title: 'Dopl',
    // --bg-base from the design tokens, so the first paint is not a white flash.
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: spaWindow.spaWebPreferences(),
  });

  const dev = spaWindow.devUrl();
  if (dev) {
    win.loadURL(`${dev}#${route}`);
  } else {
    // ⚠ `hash` carries no leading '#'. The navigation lock compares PATHNAMES and ignores
    // query/hash, so landing this way is inside the policy rather than an exception to it.
    win.loadFile(spaWindow.INDEX_HTML, { hash: route });
  }
  win.once('ready-to-show', () => win.show());

  spaWindow.policeNavigation(win);
  // ⚠ THE LINE THAT MAKES THE WINDOW WORK AT ALL. Without it every privileged call from
  // this renderer is refused and the surface renders nothing while reporting nothing.
  // Registration happens HERE, in main, at creation — never on a renderer's say-so.
  appWindows.register(win);
  return win;
}

/**
 * Open (or front) the window for one agent. Returns `{ ok }` — `ok:false` for an unusable
 * target or a full budget, in the SAME shape every other refusal in `channel-dir-ipc.js`
 * uses, so a caller cannot tell them apart.
 */
function openAgentWindow(target) {
  const t = target || {};
  const route = agentRoute(t.segment, AGENT_WINDOW_PAGE, t.channelId, t.taskId);
  if (!route) return { ok: false };

  const key = agentWindowKey(t.channelId, t.taskId);
  sweep();
  const existing = openWindows.get(key);
  if (existing) {
    // Asking again for an agent already open is a request to SEE it.
    try {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
    } catch (err) {
      diag('agent-window: could not front an existing window —', (err && err.message) || String(err));
    }
    return { ok: true };
  }

  if (openWindows.size >= MAX_AGENT_WINDOWS) {
    diag('agent-window: refused — the window budget is full', `(${MAX_AGENT_WINDOWS})`);
    return { ok: false };
  }

  let win;
  try {
    win = createAgentWindow(route);
  } catch (err) {
    diag('agent-window: create failed —', (err && err.message) || String(err));
    return { ok: false };
  }
  openWindows.set(key, win);
  try {
    win.on('closed', () => { if (openWindows.get(key) === win) openWindows.delete(key); });
  } catch (_err) { /* not an emitter — the sweep still collects it */ }
  return { ok: true };
}

/** Live agent-window count. Diagnostics and tests; nothing renderer-reachable reads it. */
function count() {
  return sweep().size;
}

module.exports = {
  openAgentWindow,
  count,
  MAX_AGENT_WINDOWS,
  AGENT_WINDOW_PAGE,
  // The pure half, for callers that need the rule rather than the window.
  agentRoute,
  agentWindowKey,
};
