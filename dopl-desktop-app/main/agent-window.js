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

// ⚠ A RENDERER-DRIVEN TAB FACTORY WITH NO CEILING IS A RESOURCE PRIMITIVE — the same
// sentence `popout-window.js` carries, and the same number. A TAB is cheaper than a window
// but not free: each one the renderer mounts is a narration subscription, a transcript read
// and a consent read. It is SEPARATE from the pop-out's budget on purpose: they are
// different surfaces answering different questions, and one full budget must not refuse the
// other.
// ⚠ IT WAS `MAX_AGENT_WINDOWS = 4` UNTIL 2026-09-13 and the number did not move — what moved
// is what it counts. `test/agent-window.test.mjs` reads this export; nothing else does
// (`session-narration.js` and `test/app-windows.test.mjs` mention the old name in PROSE only,
// and their sums are unchanged because the ceiling is still four agent views).
const MAX_AGENT_TABS = 4;

/**
 * 🔒 **ONE WINDOW, MANY TABS (Samuel, 2026-09-13, over Wispr Flow's pop-out: *"make this
 * agent tabbable, meaning if I have an agent popout window open already and I go to another
 * agent and click 'Open window,' it just adds another tab to this"*).**
 *
 * ⚠ **MAIN OWNS THE TAB SET AND THE RENDERER RENDERS IT** — not the other way round. The
 * window is created HERE, the budget is enforced HERE, and "closing the last tab closes the
 * window" is a rule with one implementation. A renderer that kept its own list would be a
 * second answer to *which agents are open*, and main is the half that survives a reload.
 *
 * ⚠ **THE KEY IS STILL `agentWindowKey`** — (channel, thread, agent), never `sessionId`
 * (see this file's header). So a tab is addressed by exactly what every session op takes.
 */
let host = null;
/** key -> tab descriptor, in INSERTION ORDER: the strip reads left to right. */
const openTabs = new Map();

// ─── BEGIN AGENT-ROUTE-PURE (unit-tested via source extraction) ──────────────
// No electron/require refs below.

/**
 * One window per AGENT INSTANCE.
 * ⚠ THE THIRD PART JOINED ON 2026-08-21. It was `(channel, thread)`, which was the agent's
 * stable key until multiplayer made a thread hold several of them — at which point opening the
 * second agent's window FRONTED the first one's, silently, with no error anywhere. An absent
 * `agentId` degrades to the old two-part key rather than refusing, so a caller that only knows
 * the pair keeps its previous behaviour exactly.
 */
function agentWindowKey(channelId, taskId, agentId) {
  const agent = String(agentId || '');
  return agent ? `${channelId}|${taskId}|${agent}` : `${channelId}|${taskId}`;
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
 * ⚠ `&agent=` JOINED IT ON 2026-08-21 and is OPTIONAL, on the same terms: with several of the
 * operator's agents on one thread the pair no longer says WHICH one this window shows. Omitted
 * when the caller does not know it, so the route degrades to the old one rather than breaking.
 * The value is `agent-id.js` charset (`[a-z0-9]` only), so it needs no escaping.
 */
function agentRoute(segment, page, channelId, taskId, agentId) {
  if (!segment || !page || !channelId) return null;
  const thread = String(taskId || '');
  const agent = String(agentId || '');
  // ⚠ A CHANNEL-LEVEL AGENT HAS NO THREAD (2026-08-21) and must still be openable. It is
  // identified by its agent id alone, so the thread selection is simply omitted rather than the
  // route refused. One of the two must be present: a route naming neither addresses the whole
  // channel, which is not an agent view.
  if (!thread && !agent) return null;
  const query = [thread ? `thread=${thread}` : '', agent ? `agent=${agent}` : '']
    .filter(Boolean)
    .join('&');
  return `/${segment}/${page}/${channelId}?${query}`;
}
// ─── END AGENT-ROUTE-PURE ────────────────────────────────────────────────────

/**
 * Forget the host once it has gone, so the budget counts only live tabs.
 * ⚠ THE TABS GO WITH IT. They are views INSIDE that window: a dead host holding four tab
 * descriptors would refuse the next open against a budget nothing is spending.
 */
function sweep() {
  if (host && !appWindows.isLiveWindow(host)) {
    host = null;
    openTabs.clear();
  }
  return openTabs;
}

/** Is this the agent window? `window-chrome.js`'s tab ops ask, so a bound sender can only
 *  ever name a tab inside ITS OWN window (that file's header carries the rule). */
function isHostWindow(win) {
  return !!win && host === win;
}

/**
 * THE WHOLE TAB SET, TO THE RENDERER — one push, never a diff.
 *
 * ⚠ **IDEMPOTENT ON PURPOSE.** An add, a close and a focus are all "here is the list, show
 * this one", so a renderer that missed a message cannot drift from main: the next push is
 * complete. `focusKey` is a COMMAND (select this tab now), not a claim about what the
 * operator has selected — clicking a tab is local and rings nothing here.
 */
function pushTabs(focusKey) {
  if (!host) return;
  try {
    host.webContents.send('agent-window:tabs', {
      tabs: Array.from(openTabs.values()),
      focusKey: focusKey || '',
    });
  } catch (err) {
    diag('agent-window: could not push the tab set —', (err && err.message) || String(err));
  }
}

/** Front the host: asking again for an agent already tabbed is a request to SEE it. */
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

// ⚠ 460x640 ORIGINALLY — TALLER AND NARROWER THAN THE POP-OUT'S 520x600, and the difference is
// the content, not a preference. A thread window holds a conversation (wide enough for two
// speakers' bubbles); this holds a NARRATION STREAM, which is one column of short lines
// and wants vertical room. Default size IS the floor, the rule the DELETED `session-window.js`
// established: the window opens at its most compact and the operator grows it.
// ⚠ 640 → 560 HIGH ON 2026-08-29 (Samuel), −80px / 12.5%. **12px of that is MEASURED and the rest
// is the ruling, and the two must not be confused by whoever reads this next.** The posture row
// went from `h-9` to `h-6` in the same wave (see the width block below), so the chrome above the
// stream genuinely lost 12px; the other 68 come out of the stream's own slack because the window
// opened taller than the narration needed. It stays the TALLER-THAN-WIDE shape the content argues
// for (560 > 510), which is the part of the original reasoning that has not changed.
// ⚠ `minHeight` MOVES WITH IT for the same reason `minWidth` does — default size IS the floor.
// ⚠ `title` is the PRE-PAINT name only — the renderer sets `document.title` to
// "Dopl — <agent>" once the feed lands, and Electron copies it onto the window. Nothing
// here disables that, and it must not start to.
// ⚠ 510 WIDE SINCE 2026-08-29, AND THE NUMBER IS STILL THE POSTURE ROW'S — it is a MEASUREMENT of
// the controls, never a taste preference, so it moves when and only when they do. The three live
// controls — Tools, Messages, Model — are one flex row of `SelectMenu` triggers
// (`channels-v2/agent-posture.tsx`). 460 wrapped that row; 660, then 600, were derived over the
// `raised` (`h-9`) trigger; 540 was the first pass at the smaller one.
// ⚠ WHAT CHANGED: the three adopted `select-menu.tsx › TRIGGER_FACE.raisedField` (Samuel,
// 2026-08-29) — the app's consolidated dropdown size, the one the composer launch panel's
// Template/Model rows wear. The face is identical (`auth-btn-3d-light`); the BOX shrank, so the row
// needs less width and the old 600 left a band of empty space to the right of it.
// ⚠ THE ARITHMETIC, REDONE OVER THE NEW SIZE, so the next adjustment knows what the floor is.
// A `raisedField` trigger is `px-2` (16) + `gap-1.5` twice (12) + an 11px chevron = 39px of chrome
// around `prefix` + `label` at `text-small` (12px). The previous derivation's own numbers imply
// ≈0.526em per glyph for these labels at font-medium, i.e. ≈6.3px/char at 12px. Widest label each
// control can hold, counting `prefix` + `label`:
//   Tools    "Tools" + "Ask each time"  = 18ch ≈ 114 + 39 = 153
//   Messages "Messages" + "Auto accept in" = 22ch ≈ 139 + 39 = 178
//   Model    "Model" + "Haiku 4.5"      = 14ch ≈  88 + 39 = 127
// ⚠ THE TOOLS FIGURE IS A CORRECTION: the 600 derivation measured "Accept edits", but
// `permission-preset-row.tsx › TOOL_OPTIONS` also holds "Ask each time", which is a character wider.
// Two `gap-2` gaps = 16, the box's own `px-4` = 32. Row ≈ 153+178+127+16+32 = 506px, so 510.
// ⚠ THE 4px IS BREATHING, NOT SLACK, AND THE DIFFERENCE IS THE POINT (Samuel, 2026-08-29: "only
// just enough so that they are all on the same line with the same spacing"). 540 carried ~34px for
// a LONG FREE-FORM MODEL LABEL — `agentModelOptionsFor` appends whatever the agent is actually
// running, and a dated id is far wider than any of the four picks. That was the window paying, on
// every normal agent, for an uncommon label: visible dead space to the right of Model.
// ⚠ THAT CASE IS THE TRIGGER'S JOB NOW. The row is `flex-nowrap` as of the same date, so a long
// label ELLIPSIZES inside its own pill (`select-menu.tsx`: `min-w-0 max-w-full` on the trigger,
// `min-w-0 truncate` on the label span) instead of breaking the line. Overflow is handled where the
// overflow is. **So do not re-add slack here for a label — fix the control if it ever stops
// truncating**, and do not restore `flex-wrap` there without widening this back: they are one
// decision in two trees, and `channels-v2/agent-posture.tsx` carries the other half.
// ⚠ `minWidth` MOVES WITH IT. Default size IS the floor here (the rule the deleted
// `session-window.js` established), and a floor below the width the content needs would let the
// operator drag the window back into the wrapped state this number exists to prevent.
//
// ⚠ NO TRAFFIC LIGHTS, AND `frame: false` IS THE ONLY OPTION THAT ACHIEVES THAT (Samuel,
// 2026-09-13, over Wispr Flow's pop-out: *"We're going to remove the X, minus, and expand on the
// top left of our Dopl agent popout window ... remove that and then put the name ... at the top
// instead of the bar icon"*). The window took the STANDARD native title bar until then — no
// `titleBarStyle` at all — so macOS drew the three buttons and the bar they sit in.
// ⚠ THE TWO NEAR-MISSES, so the next reader does not reach for them. `titleBarStyle: 'hidden'`
// (and `'hiddenInset'`) KEEP the buttons and merely float them over the content, which is the
// exact bug ENGINEERING.md records this app hitting once: the lights landed on top of the app
// header with no draggable region and the window could not be moved. `trafficLightPosition` moves
// them; it does not remove them, and pushing them off-screen leaves live hit targets under the
// content. `'customButtonsOnHover'` is frameless but paints them again on hover — which is not
// "removed" either. `frame: false` draws no bar and no buttons at all.
// ⚠ SO THE RENDERER OWES THE DRAG REGION. A frameless window has nothing to grab:
// `channels-v2/agent-window-chrome.tsx › AgentWindowChrome` carries `-webkit-app-region: drag`
// and its controls — the TABS included — carry `no-drag`, and `window-chrome.js` is where the
// close/zoom buttons it grew reach main. ⚠ IT WAS `agent-window.tsx › AgentWindowHeader` until
// the tabbed ruling later the same day; the bar belongs to the WINDOW now and outlives any one
// agent view, which is why it is its own file. Resizing is unaffected (`resizable` defaults true; a frameless window still has edges).
// ⚠ `roundedCorners` IS STATED RATHER THAN INHERITED. It defaults to true, and this is the one
// window whose corners are now the OS's ONLY contribution to its chrome — an implicit default is
// the wrong way to hold the whole visible shape of a window. MEASURED, and it is a correction to
// the Wispr reference: the radius is the SYSTEM's (~10pt), not the ≈28px of the screenshot. An
// arbitrary radius needs `transparent: true` plus a CSS-rounded root, which gives up the native
// shadow, the vibrancy and the OS's own corner masking — a different window, not a bigger number.
function createAgentWindow(route) {
  const win = new BrowserWindow({
    width: 510,
    height: 560,
    minWidth: 510,
    minHeight: 560,
    title: 'Dopl',
    frame: false,
    roundedCorners: true,
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
 * Open the agent view for one agent: FIRST one builds the window, every one after it ADDS A
 * TAB to that same window, and one already tabbed is simply focused (Samuel, 2026-09-13).
 *
 * Returns `{ ok }` — `ok:false` for an unusable target or a full budget, in the SAME shape
 * every other refusal in `channel-dir-ipc.js` uses, so a caller cannot tell them apart.
 *
 * ⚠ **THE CALLERS DID NOT CHANGE AND MUST NOT HAVE TO.** `session-ipc-ops.js` (the renderer's
 * "Open window"), `session-engine.js`'s reopen and `session-delete-op.js` all still pass a
 * plain address; whether that becomes a window or a tab is this module's business.
 * ⚠ **WINDOW SIZE AND POSITION ARE UNTOUCHED** (*"Don't change the current window size"*):
 * only the FIRST open constructs a window, and it constructs the same 510×560 one.
 */
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

  // ALREADY TABBED → front the window and tell it which tab to show.
  if (host && openTabs.has(key)) {
    frontHost();
    pushTabs(key);
    return { ok: true };
  }

  if (openTabs.size >= MAX_AGENT_TABS) {
    diag('agent-window: refused — the tab budget is full', `(${MAX_AGENT_TABS})`);
    return { ok: false };
  }

  // A SECOND AGENT WHILE THE WINDOW IS OPEN → a tab, never a second window.
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
  try {
    // ⚠ THE WINDOW'S OWN ROUTE SEEDS ITS FIRST TAB, so the renderer has one before any push
    // arrives — and `did-finish-load` is when a push can be HEARD. A send before the listener
    // is attached is dropped silently, which is how a tab set arrives empty.
    win.webContents.on('did-finish-load', () => pushTabs(key));
  } catch (_err) { /* not an emitter — the route already carries the first tab */ }
  try {
    win.on('closed', () => {
      if (host === win) {
        host = null;
        openTabs.clear();
      }
    });
  } catch (_err) { /* not an emitter — the sweep still collects it */ }
  return { ok: true };
}

/**
 * CLOSE ONE TAB, and the WINDOW with the last of them (Samuel: *"you see there's a little X
 * button"*, and item 1's *"closing the last tab closes the window"*).
 *
 * ⚠ **THE LAST-TAB RULE IS HERE, NOT IN THE RENDERER.** A renderer that closed its own window
 * when its list emptied would be the second implementation of a rule main already has to hold
 * for the delete lane below — and the two would part the day one of them was edited.
 *
 * ⚠ IT ANSWERS "was that tab open", never a handle. Best effort, like `closeAgentWindow`.
 */
function closeAgentTab(key) {
  sweep();
  const id = String(key || '');
  if (!host || !openTabs.has(id)) return false;
  const remaining = Array.from(openTabs.keys()).filter((k) => k !== id);
  openTabs.delete(id);
  if (remaining.length === 0) {
    const win = host;
    host = null;
    try {
      win.close();
    } catch (err) {
      diag('agent-window: could not close the window on its last tab —', (err && err.message) || String(err));
    }
    return true;
  }
  // Focus a NEIGHBOUR rather than nothing: a window whose active tab just went would
  // otherwise render an empty panel.
  pushTabs(remaining[remaining.length - 1]);
  return true;
}

/**
 * CLOSE the window showing one agent, if there is one (2026-08-25, the DELETE lane).
 *
 * ⚠ IT IS NOT A SECOND `openAgentWindow` BRANCH AND IT IS NOT RENDERER-REACHABLE. Nothing on
 * the bridge closes a window: the operator closes their own windows, and a renderer that could
 * shut another app window is a nuisance primitive with no feature behind it. The ONE caller is
 * `main/session-delete-op.js`, where the agent the window is a view OF has just been destroyed
 * — leaving it open would leave a live composer and a live narration subscription pointed at
 * an address that resolves to nothing.
 *
 * ⚠ IT ANSWERS "was one open", never a handle. Best effort by construction: a window that
 * refuses to close must not fail a deletion that has already happened.
 */
function closeAgentWindow(target) {
  const t = target || {};
  // ⚠ IT IS THE TAB LANE NOW, AND THE NAME STAYS FOR ITS ONE CALLER. A deleted agent's view
  // is a TAB since 2026-09-13; closing it takes the window down only if it was the last one,
  // which is exactly the old behaviour when that agent had the only window.
  return closeAgentTab(agentWindowKey(t.channelId, t.taskId, t.agentId));
}

/** Live agent-TAB count. Diagnostics and tests; nothing renderer-reachable reads it.
 *  ⚠ It counted WINDOWS until 2026-09-13, when there stopped being more than one. */
function count() {
  return sweep().size;
}

/** Is the agent window up at all — one window by construction. */
function hasWindow() {
  sweep();
  return host !== null;
}

module.exports = {
  openAgentWindow,
  closeAgentWindow,
  closeAgentTab,
  isHostWindow,
  hasWindow,
  count,
  MAX_AGENT_TABS,
  AGENT_WINDOW_PAGE,
  // The pure half, for callers that need the rule rather than the window.
  agentRoute,
  agentWindowKey,
};
