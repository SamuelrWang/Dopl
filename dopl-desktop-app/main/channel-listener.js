// Background Channels listener.
//
// For every non-archived channel the signed-in user can see, runs an
// authenticated long-poll (`/api/channels/[id]/await`) with a persisted `since`
// cursor and capped-exponential reconnect backoff. New human messages from
// other users trigger a native consent prompt; only on explicit approval does
// session-spawner run a Claude session and post the reply back with an
// idempotent client_msg_id. One active session per channel.
//
// Auth is via forwarded Supabase cookies (see auth.js for why not a bearer).
// No renderer IPC is added — consent is a main-process native dialog.

const { dialog, Notification } = require('electron');
const Store = require('electron-store');
const auth = require('./auth');
const spawner = require('./session-spawner');
const { API_BASE, LISTENER } = require('./config');

const store = new Store();

let running = false;
let onStatus = null; // tray callback
let refreshTimer = null;
let featureAvailable = true;
let staleNotified = false;
let cliWarned = false;
let myUserId = null; // resolved operator identity (H2); null until known
let reconciling = null; // in-flight reconcile promise (M1 re-entrancy guard)
const loops = new Map(); // channelId -> loop entry
const replayed = new Set(); // channels whose crash-pending record was replayed

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Cursor + seed persistence ──────────────────────────────────────────────
function getCursor(channelId) {
  const c = store.get('cursors') || {};
  return c[channelId] || 0;
}
function setCursor(channelId, seq) {
  const c = store.get('cursors') || {};
  c[channelId] = seq;
  store.set('cursors', c);
}
function isSeeded(channelId) {
  const s = store.get('seeded') || {};
  return !!s[channelId];
}
function markSeeded(channelId) {
  const s = store.get('seeded') || {};
  s[channelId] = true;
  store.set('seeded', s);
}

// ── Pending-consent records (M5b) ────────────────────────────────────────────
// A per-channel {seq, messageId, workspaceId} written BEFORE the consent dialog
// and cleared after the reply is posted (or the request is denied). If the app
// crashes between consent and post, the record lets us re-prompt for that exact
// message on next launch. Deny clears the record → Deny still means no replay.
function getPending() {
  return store.get('pendingConsent') || {};
}
function setPending(channelId, rec) {
  const p = getPending();
  p[channelId] = rec;
  store.set('pendingConsent', p);
}
function clearPending(channelId) {
  const p = getPending();
  if (channelId in p) {
    delete p[channelId];
    store.set('pendingConsent', p);
  }
}

// ── HTTP ────────────────────────────────────────────────────────────────────
async function apiFetch(pathname, opts = {}) {
  const { method = 'GET', workspaceId, body, timeoutMs } = opts;
  const cookie = await auth.getAuthCookie();
  const headers = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(`${API_BASE}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeList(data, key) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

async function listWorkspaces() {
  const res = await apiFetch('/api/workspaces', { timeoutMs: 15000 });
  if (res.status === 401) { notifyStale(); return null; }
  if (!res.ok) return [];
  return normalizeList(await res.json(), 'workspaces');
}

async function listChannels(workspaceId) {
  const res = await apiFetch('/api/channels', { workspaceId, timeoutMs: 15000 });
  if (res.status === 404) { featureAvailable = false; return []; }
  if (res.status === 401) { notifyStale(); return []; }
  if (!res.ok) return [];
  featureAvailable = true;
  return normalizeList(await res.json(), 'channels');
}

// ── Identity + trigger predicate + consent ──────────────────────────────────
// Resolve the operator's own user id so we never self-trigger. Layered so it
// works for BOTH deep-link sessions (stored JWT) and cookie-only web sign-ins
// (H2): (1) stored session blob, (2) the Supabase auth cookie's JWT `sub`,
// (3) the /api/workspaces/me whoami endpoint as a last resort.
async function resolveIdentity(preferWorkspaceId) {
  let id = auth.getUserId();
  if (!id) id = await auth.getUserIdFromCookies();
  if (!id) {
    try {
      const res = await apiFetch('/api/workspaces/me', {
        workspaceId: preferWorkspaceId,
        timeoutMs: 15000,
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.userId) id = d.userId;
      }
    } catch (_) {
      /* best-effort — fall through to null */
    }
  }
  return id || null;
}

// H2: FAIL CLOSED. If we don't know our own id, treat nothing as a trigger —
// a null id would otherwise make the operator's OWN messages self-trigger.
function isTrigger(m, myId) {
  if (!myId) return false;
  return (
    m &&
    m.kind === 'message' &&
    m.authorKind === 'user' &&
    m.authorUserId &&
    m.authorUserId !== myId
  );
}

function truncate(s, n = 240) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// Native consent BEFORE any spawn. Allow-once / Deny (no persistence, no
// auto-spawn). Returns true only on explicit approval.
async function requestConsent(channel, m) {
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: `Dopl: request in "${channel.name}"`,
        body: truncate(m.body, 120),
        silent: false,
      }).show();
    }
  } catch (_) { /* notifications are best-effort */ }

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Deny', 'Allow once'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Dopl Channels',
    message: `Run a Claude session to answer this message in "${channel.name}"?`,
    detail: truncate(m.body, 600),
  });
  return response === 1;
}

// M5a: bounded retry with backoff. `clientMsgId` is deterministic per (channel,
// seq) so the server dedupes — retries can never double-post. Returns true on a
// confirmed post.
async function postResult(entry, m, text) {
  const body = {
    body: text,
    authorKind: 'agent',
    clientMsgId: `agent-${entry.channel.id}-${m.seq}`,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await apiFetch(`/api/channels/${entry.channel.id}/messages`, {
        method: 'POST',
        workspaceId: entry.workspaceId,
        body,
        timeoutMs: 20000,
      });
      if (res.ok) return true;
      // 4xx (other than rate-limit) won't improve on retry — stop early.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.warn('[listener] post result failed (no retry):', res.status);
        return false;
      }
      console.warn('[listener] post result failed:', res.status, 'attempt', attempt);
    } catch (err) {
      console.error('[listener] post result error attempt', attempt, err && err.message);
    }
    if (attempt < 3) await sleep(500 * 2 ** (attempt - 1)); // 500ms, then 1s
  }
  return false;
}

async function handleTrigger(entry, m) {
  // H1: gate on CLI resolution. If claude can't be found, don't prompt and don't
  // post — the one-time "CLI not found" notice already fired at startup.
  if (!(await spawner.claudeAvailable())) return;

  // M5b: persist the pending request BEFORE the dialog so a crash between consent
  // and post can be recovered on next launch.
  setPending(entry.channel.id, {
    seq: m.seq,
    messageId: m.id,
    workspaceId: entry.workspaceId,
  });

  const approved = await requestConsent(entry.channel, m);
  if (!approved) {
    clearPending(entry.channel.id); // Deny = no replay
    console.log('[listener] consent denied for', entry.channel.id, 'seq', m.seq);
    return; // cursor already advanced — we won't re-prompt for this message
  }
  const result = await spawner.runForChannel({
    channelId: entry.channel.id,
    message: m.body,
    context: {
      channelName: entry.channel.name,
      authorName: `user ${String(m.authorUserId).slice(0, 8)}`,
    },
  });
  // L3: a busy skip (another session already running for this channel) is not a
  // silent drop — tell the channel to resend rather than losing the request.
  if (result.skipped === 'busy') {
    await postResult(
      entry,
      m,
      "I'm still finishing a previous request in this channel — please resend in a moment."
    );
    clearPending(entry.channel.id);
    return;
  }
  if (result.skipped) {
    // e.g. 'no-cli' — stay silent (H1: no error replies into the channel).
    clearPending(entry.channel.id);
    return;
  }
  if (result.text) await postResult(entry, m, result.text);
  clearPending(entry.channel.id);
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: `Dopl: replied in "${entry.channel.name}"`,
        body: truncate(result.text, 120),
        silent: true,
      }).show();
    }
  } catch (_) { /* best-effort */ }
}

// M5b recovery: on first watch of a channel, if a pending-consent record survived
// a crash, fetch that exact message and re-prompt for it. Runs at most once per
// channel per app run.
async function replayPendingFor(entry) {
  const id = entry.channel.id;
  if (replayed.has(id)) return;
  const pending = getPending()[id];
  if (!pending) return;
  replayed.add(id);
  try {
    const since = Math.max(0, (pending.seq || 1) - 1);
    const res = await apiFetch(
      `/api/channels/${id}/messages?since=${since}&limit=1`,
      { workspaceId: entry.workspaceId, timeoutMs: 15000 }
    );
    if (!res.ok) return; // leave the record; try again next launch
    const data = await res.json();
    const msgs = normalizeList(data, 'messages');
    const m =
      msgs.find((x) => (x.seq || 0) === pending.seq) ||
      msgs.find((x) => x.id === pending.messageId);
    if (m) {
      await handleTrigger(entry, m);
    } else {
      clearPending(id); // message no longer retrievable — drop the stale record
    }
  } catch (err) {
    console.error('[listener] replay pending error:', err && err.message);
  }
}

// ── Per-channel long-poll loop ──────────────────────────────────────────────
async function channelLoop(entry) {
  while (running && !entry.stop) {
    const since = getCursor(entry.channel.id);
    let res;
    try {
      res = await apiFetch(
        `/api/channels/${entry.channel.id}/await?since=${since}&timeoutMs=${LISTENER.AWAIT_TIMEOUT_MS}`,
        { workspaceId: entry.workspaceId, timeoutMs: LISTENER.AWAIT_FETCH_TIMEOUT_MS }
      );
    } catch (err) {
      // AbortError from our own fetch timeout is a normal long-poll turnover.
      if (err && err.name === 'AbortError') continue;
      await backoff(entry);
      continue;
    }

    if (res.status === 404) {
      // L2: a single channel's await 404 means THIS channel is gone (deleted /
      // left), not that the whole Channels feature is down. Drop just this loop —
      // do NOT flip the global featureAvailable flag. reconcile() re-adds it if
      // the channel reappears. (Whole-feature 404 is caught in listChannels.)
      entry.stop = true;
      loops.delete(entry.channel.id);
      return;
    }
    if (res.status === 401) {
      notifyStale();
      await auth.ensureFresh().then((s) => s && auth.writeSessionCookies(s));
      await backoff(entry);
      continue;
    }
    if (!res.ok) {
      await backoff(entry);
      continue;
    }

    entry.attempts = 0;
    staleNotified = false;
    let data;
    try {
      data = await res.json();
    } catch (_) {
      await sleep(LISTENER.IDLE_GAP_MS);
      continue;
    }

    const msgs = normalizeList(data, 'messages')
      .slice()
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const maxSeq = msgs.reduce((mx, m) => Math.max(mx, m.seq || 0), since);

    if (entry.seedMode) {
      // Drain history quietly until caught up to the tip, then go live. Avoids
      // replaying a backlog as consent prompts on first watch.
      //
      // L1 (known v1 limitation, documented): a genuine trigger that lands in the
      // very first await window while we're still seeding is absorbed into this
      // cursor advance and won't prompt. Accepted for v1 — suppressing the
      // first-watch backlog outweighs the rare missed first live message.
      if (maxSeq > since) setCursor(entry.channel.id, maxSeq);
      if (data.timedOut || msgs.length === 0) {
        markSeeded(entry.channel.id);
        entry.seedMode = false;
      }
    } else {
      for (const m of msgs) {
        if ((m.seq || 0) > getCursor(entry.channel.id)) setCursor(entry.channel.id, m.seq);
        if (isTrigger(m, myUserId)) await handleTrigger(entry, m);
      }
      if (msgs.length === 0 && maxSeq > since) setCursor(entry.channel.id, maxSeq);
    }
    await sleep(LISTENER.IDLE_GAP_MS);
  }
}

async function backoff(entry) {
  const n = entry.attempts || 0;
  const delay = Math.min(LISTENER.BACKOFF_MAX_MS, LISTENER.BACKOFF_BASE_MS * 2 ** n);
  const jitter = Math.floor(Math.random() * 500);
  entry.attempts = n + 1;
  await sleep(delay + jitter);
}

function notifyStale() {
  if (staleNotified) return;
  staleNotified = true;
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Dopl',
        body: 'Your session expired. Open Dopl and sign in to resume channel listening.',
      }).show();
    }
  } catch (_) { /* best-effort */ }
}

// ── Channel-set reconciliation ──────────────────────────────────────────────
// M1: reconcile is NOT re-entrant — the startup call and the deep-link restart()
// (+3s timer) can both await the network and then both start loops for the same
// channel (dup long-polls + double consent dialogs). Coalesce concurrent calls
// onto one in-flight promise; subsequent callers await the running pass.
function reconcile() {
  if (reconciling) return reconciling;
  reconciling = reconcileInner()
    .catch((err) => console.error('[listener] reconcile error:', err && err.message))
    .finally(() => {
      reconciling = null;
    });
  return reconciling;
}

async function reconcileInner() {
  if (!running) return;
  if (!auth.isSignedIn()) {
    myUserId = null; // force re-resolve on next sign-in
    stopLoops();
    setStatus();
    return;
  }
  let workspaces;
  try {
    workspaces = await listWorkspaces();
  } catch (err) {
    console.error('[listener] listWorkspaces error:', err && err.message);
    setStatus();
    return;
  }
  if (workspaces === null) { setStatus(); return; } // 401 handled

  const desired = new Map();
  for (const ws of workspaces) {
    if (!ws || !ws.id) continue;
    let chans = [];
    try {
      chans = await listChannels(ws.id);
    } catch (err) {
      console.error('[listener] listChannels error:', err && err.message);
    }
    for (const c of chans) {
      if (!c || !c.id) continue;
      if (c.archivedAt) continue;
      desired.set(c.id, { workspaceId: ws.id, channel: c });
    }
  }

  // H2: resolve the operator identity before any loop can evaluate isTrigger.
  if (!myUserId) {
    const firstWs = desired.size ? desired.values().next().value.workspaceId : undefined;
    myUserId = await resolveIdentity(firstWs);
  }

  // Stop loops for channels no longer desired.
  for (const [id, entry] of loops) {
    if (!desired.has(id)) {
      entry.stop = true;
      loops.delete(id);
    }
  }
  // Start loops for newly-seen channels; refresh metadata for existing. The
  // in-flight guard above means this runs serialized, but we still re-check
  // loops.get(id) right before starting so a loop is never double-started.
  for (const [id, d] of desired) {
    const existing = loops.get(id);
    if (!existing) {
      const entry = {
        channel: d.channel,
        workspaceId: d.workspaceId,
        stop: false,
        attempts: 0,
        seedMode: !isSeeded(id),
      };
      loops.set(id, entry);
      channelLoop(entry);
      replayPendingFor(entry); // M5b: recover a crash-pending consent, if any
    } else {
      existing.channel = d.channel;
      existing.workspaceId = d.workspaceId;
    }
  }
  setStatus();
}

function stopLoops() {
  for (const entry of loops.values()) entry.stop = true;
  loops.clear();
}

// ── Public API ──────────────────────────────────────────────────────────────
function status() {
  if (!running) return 'Listener: off';
  if (!auth.isSignedIn()) return 'Listener: signed out';
  if (!featureAvailable) return 'Listener: waiting for Channels';
  const n = loops.size;
  return `Listener: watching ${n} channel${n === 1 ? '' : 's'}`;
}

function setStatus() {
  if (onStatus) {
    try { onStatus(status()); } catch (_) { /* tray may be gone */ }
  }
}

function start(statusCb) {
  onStatus = statusCb || onStatus;
  if (running) { reconcile(); return; }
  running = true;
  spawner.claudeAvailable().then((ok) => {
    if (!ok && !cliWarned) {
      cliWarned = true;
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Dopl',
            body: 'Claude CLI not found on PATH. Channel auto-responses stay off until it is installed.',
          }).show();
        }
      } catch (_) { /* best-effort */ }
    }
  });
  reconcile();
  refreshTimer = setInterval(reconcile, LISTENER.CHANNEL_REFRESH_MS);
  setStatus();
}

// Re-run reconciliation now (e.g. right after a fresh sign-in).
function restart() {
  if (!running) { start(onStatus); return; }
  reconcile();
}

function stop() {
  running = false;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  stopLoops();
  setStatus();
}

module.exports = { start, stop, restart, status };
