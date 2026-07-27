// Channels listener — I/O layer (persistence + HTTP + identity + name cache).
//
// SPLIT NOTE (§2 refactor): extracted from channel-listener.js so that file
// could come under the 500-line cap. This module owns the cursor / seed /
// pending-consent stores, the listener's authenticated fetch + list helpers, the
// operator-identity resolution, and the requester/target display-name cache. It
// also owns the two HTTP-status flags those helpers set (`featureAvailable`,
// `staleNotified`) and the stale-session notification, so listWorkspaces /
// listChannels stay self-contained and this module never has to import back into
// channel-listener.js (no import cycle).
//
// Auth is via forwarded Supabase cookies (see auth.js for why not a bearer).

const { Notification } = require('electron');
const Store = require('electron-store');
const auth = require('./auth');
const { API_BASE } = require('./config');
const { diag } = require('./diag');

const store = new Store();
const nameCache = new Map(); // userId -> displayName, refreshed once per reconcile

let featureAvailable = true; // false once /api/channels 404s (feature not deployed)
let staleNotified = false; // one-shot guard for the "session expired" notification

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

// ── Stale-session notification + feature-availability flag ───────────────────
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
// channelLoop resets this after a successful await so a later expiry re-notifies.
function resetStale() {
  staleNotified = false;
}
function isFeatureAvailable() {
  return featureAvailable;
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

// ── Identity ─────────────────────────────────────────────────────────────────
// Resolve the operator's own user id so we never self-trigger. Layered so it
// works for BOTH deep-link sessions (stored JWT) and cookie-only web sign-ins
// (H2): (1) stored session blob, (2) the Supabase auth cookie's JWT `sub`,
// (3) the /api/workspaces/me whoami endpoint as a last resort.
async function resolveIdentity(preferWorkspaceId) {
  let id = auth.getUserId();
  diag('identity tier1 (stored blob):', id ? 'hit' : 'miss');
  if (!id) {
    id = await auth.getUserIdFromCookies();
    diag('identity tier2 (cookie jwt):', id ? 'hit' : 'miss');
  }
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
      diag('identity tier3 (whoami):', res.ok ? `hit ${res.status}` : `miss ${res.status}`);
    } catch (err) {
      diag('identity tier3 (whoami): error', err && err.message);
    }
  }
  return id || null;
}

// ── Display-name cache (Feature B/C) ─────────────────────────────────────────
// Requester + target names for notification copy. Filled once per workspace per
// reconcile from the workspace members listing. Falls back to 'A teammate'.
function displayNameFor(userId) {
  return (userId && nameCache.get(userId)) || 'A teammate';
}

async function refreshNameCache(ws) {
  // Canonical `{slug}-{publicId}` segment resolves by publicId (no legacy-slug
  // redirect event). Cookie-authed (withUserAuth); X-Workspace-Id is harmless.
  const segment = `${ws.slug}-${ws.publicId}`;
  try {
    const res = await apiFetch(`/api/workspaces/${encodeURIComponent(segment)}/members`, {
      workspaceId: ws.id,
      timeoutMs: 15000,
    });
    if (!res.ok) {
      diag('namecache miss', res.status, 'ws', ws.slug);
      return;
    }
    const members = normalizeList(await res.json(), 'members');
    for (const mem of members) {
      if (mem && mem.userId) {
        const dn = mem.displayName || mem.email || null;
        if (dn) nameCache.set(mem.userId, dn);
      }
    }
    diag('namecache loaded', members.length, 'ws', ws.slug);
  } catch (err) {
    diag('namecache error', err && err.message);
  }
}

module.exports = {
  sleep,
  getCursor,
  setCursor,
  isSeeded,
  markSeeded,
  getPending,
  setPending,
  clearPending,
  notifyStale,
  resetStale,
  isFeatureAvailable,
  apiFetch,
  normalizeList,
  listWorkspaces,
  listChannels,
  resolveIdentity,
  displayNameFor,
  refreshNameCache,
};
