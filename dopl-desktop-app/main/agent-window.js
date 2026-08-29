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

/** Forget windows that have gone, so the budget counts only live ones. */
function sweep() {
  for (const [key, win] of Array.from(openWindows)) {
    if (!appWindows.isLiveWindow(win)) openWindows.delete(key);
  }
  return openWindows;
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
function createAgentWindow(route) {
  const win = new BrowserWindow({
    width: 510,
    height: 560,
    minWidth: 510,
    minHeight: 560,
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
  const route = agentRoute(t.segment, AGENT_WINDOW_PAGE, t.channelId, t.taskId, t.agentId);
  if (!route) return { ok: false };

  const key = agentWindowKey(t.channelId, t.taskId, t.agentId);
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
  const key = agentWindowKey(t.channelId, t.taskId, t.agentId);
  sweep();
  const win = openWindows.get(key);
  if (!win) return false;
  openWindows.delete(key);
  try {
    win.close();
  } catch (err) {
    diag('agent-window: could not close a deleted agent\'s window —', (err && err.message) || String(err));
  }
  return true;
}

/** Live agent-window count. Diagnostics and tests; nothing renderer-reachable reads it. */
function count() {
  return sweep().size;
}

module.exports = {
  openAgentWindow,
  closeAgentWindow,
  count,
  MAX_AGENT_WINDOWS,
  AGENT_WINDOW_PAGE,
  // The pure half, for callers that need the rule rather than the window.
  agentRoute,
  agentWindowKey,
};
