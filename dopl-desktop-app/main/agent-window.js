// The agent window: one of MY agents from the inside (narration, what it sent, a 1:1 composer), one window holding
// one TAB per agent. The pop-out's shape and its security argument (`app-windows.js`): shared SPA web preferences
// and navigation policing, registered in MAIN at creation, a hard ceiling, `{ ok: false }` for every refusal, and
// a route that is not deep-linkable. Keyed by (channel, thread, agent), never the ephemeral sessionId.

const { BrowserWindow } = require('electron');
const appWindows = require('./app-windows');
const spaWindow = require('./spa-window');
const { diag } = require('./diag');

// A copy of `apps/desktop-ui/src/routes.tsx › AGENT_WINDOW_PATH` (main cannot import the SPA); agent-window.test pins it.
const AGENT_WINDOW_PAGE = 'agent-window';

// A renderer-driven tab factory needs a ceiling (each tab is a narration subscription and reads); separate from
// the pop-out's budget.
const MAX_AGENT_TABS = 4;

// MAIN owns the tab set and the renderer renders it: one list, one "last tab closes the window" rule.
let host = null;
const openTabs = new Map();
// The tab main last told the renderer to show: `did-finish-load` fires more than once and must replay THIS key,
// never one captured from the past (a dropped early push, a reload, a closed tab).
let lastFocusKey = '';

// ─── BEGIN AGENT-ROUTE-PURE (unit-tested via source extraction) ──────────────

// No electron/require refs below.

// One window-tab per agent instance; an absent agentId degrades to the old (channel, thread) key.
function agentWindowKey(channelId, taskId, agentId) {
  const agent = String(agentId || '');
  return agent ? `${channelId}|${taskId}|${agent}` : `${channelId}|${taskId}`;
}

// The hash-router path. Inputs are already character-checked by the caller (no second copy of that rule); the
// thread and agent ride as a query selection. A channel-level agent has no thread; one of the two must be present.
function agentRoute(segment, page, channelId, taskId, agentId) {
  if (!segment || !page || !channelId) return null;
  const thread = String(taskId || '');
  const agent = String(agentId || '');
  if (!thread && !agent) return null;
  const query = [thread ? `thread=${thread}` : '', agent ? `agent=${agent}` : '']
    .filter(Boolean)
    .join('&');
  return `/${segment}/${page}/${channelId}?${query}`;
}
// ─── END AGENT-ROUTE-PURE ────────────────────────────────────────────────────

// Forget a dead host, and its tabs with it, so the budget counts only live tabs.
function sweep() {
  if (host && !appWindows.isLiveWindow(host)) {
    host = null;
    openTabs.clear();
    lastFocusKey = '';
  }
  return openTabs;
}

// `window-chrome.js`'s tab ops ask, so a bound sender can only name a tab inside its own window.
function isHostWindow(win) {
  return !!win && host === win;
}

// The whole tab set in one push (idempotent: a missed message cannot drift). `focusKey` is a command; it is
// remembered even if the send is dropped, and a key no longer open falls back to the last tab.
function pushTabs(focusKey) {
  if (!host) return;
  const asked = focusKey || '';
  lastFocusKey = openTabs.has(asked) ? asked : (Array.from(openTabs.keys()).pop() || '');
  try {
    host.webContents.send('agent-window:tabs', {
      tabs: Array.from(openTabs.values()),
      focusKey: lastFocusKey,
    });
  } catch (err) {
    diag('agent-window: could not push the tab set —', (err && err.message) || String(err));
  }
}

function frontHost() {
  if (!host) return;
  try {
    if (host.isMinimized()) host.restore();
    host.show();
    host.focus();
  } catch (err) {
    diag('agent-window: could not front the window —', (err && err.message) || String(err));
  }
}

// 510x560 is the floor as well as the default: the width is MEASURED from the posture row's three triggers (a long
// model label ellipsizes in its pill — fix the control, not this number). `frame: false` is the only option that
// removes the traffic lights, so the renderer owns the drag region (`agent-window-chrome.tsx`). Rounded corners
// are the OS's, stated rather than inherited.
function createAgentWindow(route) {
  const win = new BrowserWindow({
    width: 510,
    height: 560,
    minWidth: 510,
    minHeight: 560,
    title: 'Dopl',
    frame: false,
    roundedCorners: true,
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: spaWindow.spaWebPreferences(),
  });

  const dev = spaWindow.devUrl();
  if (dev) {
    win.loadURL(`${dev}#${route}`);
  } else {
    // `hash` has no leading '#'; the navigation lock compares pathnames, so this is inside the policy.
    win.loadFile(spaWindow.INDEX_HTML, { hash: route });
  }
  win.once('ready-to-show', () => win.show());

  spaWindow.policeNavigation(win);
  // Without this every privileged call from this renderer is refused; registered in main, never on the renderer's word.
  appWindows.register(win);
  return win;
}

/** Open one agent's view: the first builds the window, later ones add a tab, one already tabbed is focused.
 *  Answers `{ ok }` in the one refusal shape. */
function openAgentWindow(target) {
  const t = target || {};
  const route = agentRoute(t.segment, AGENT_WINDOW_PAGE, t.channelId, t.taskId, t.agentId);
  if (!route) return { ok: false };

  const key = agentWindowKey(t.channelId, t.taskId, t.agentId);
  const tab = {
    key,
    segment: String(t.segment || ''),
    channelId: String(t.channelId || ''),
    taskId: String(t.taskId || ''),
    agentId: String(t.agentId || ''),
  };
  sweep();

  if (host && openTabs.has(key)) {
    frontHost();
    pushTabs(key);
    return { ok: true };
  }

  if (openTabs.size >= MAX_AGENT_TABS) {
    diag('agent-window: refused — the tab budget is full', `(${MAX_AGENT_TABS})`);
    return { ok: false };
  }

  if (host) {
    openTabs.set(key, tab);
    frontHost();
    pushTabs(key);
    return { ok: true };
  }

  let win;
  try {
    win = createAgentWindow(route);
  } catch (err) {
    diag('agent-window: create failed —', (err && err.message) || String(err));
    return { ok: false };
  }
  host = win;
  openTabs.clear();
  openTabs.set(key, tab);
  lastFocusKey = key;
  try {
    // The route seeds the first tab; the push is replayed on every load with the CURRENT focus.
    win.webContents.on('did-finish-load', () => pushTabs(lastFocusKey));
  } catch (_err) {}
  try {
    win.on('closed', () => {
      if (host === win) {
        host = null;
        openTabs.clear();
        lastFocusKey = '';
      }
    });
  } catch (_err) {}
  return { ok: true };
}

/** Close one tab, and the window with the last of them (the rule lives here, not in the renderer). Answers
 *  whether it was open; best effort. */
function closeAgentTab(key) {
  sweep();
  const id = String(key || '');
  if (!host || !openTabs.has(id)) return false;
  const remaining = Array.from(openTabs.keys()).filter((k) => k !== id);
  openTabs.delete(id);
  if (remaining.length === 0) {
    const win = host;
    host = null;
    lastFocusKey = '';
    try {
      win.close();
    } catch (err) {
      diag('agent-window: could not close the window on its last tab —', (err && err.message) || String(err));
    }
    return true;
  }
  // Focus a neighbour, not nothing.
  pushTabs(remaining[remaining.length - 1]);
  return true;
}

/** The DELETE lane's close (`session-delete-op.js`, its only caller; not renderer-reachable): a deleted agent's
 *  view must not keep a live composer pointed at nothing. Best effort. */
function closeAgentWindow(target) {
  const t = target || {};
  return closeAgentTab(agentWindowKey(t.channelId, t.taskId, t.agentId));
}

/** Live agent-tab count, for diagnostics and tests. */
function count() {
  return sweep().size;
}

module.exports = {
  openAgentWindow,
  closeAgentWindow,
  closeAgentTab,
  isHostWindow,
  count,
  MAX_AGENT_TABS,
  AGENT_WINDOW_PAGE,
  agentRoute,
  agentWindowKey,
};
