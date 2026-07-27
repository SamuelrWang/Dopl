// Channels — consent primitives (pending-requests model, Round B).
//
// CONSENT IS A DURABLE, ASYNC ITEM — never a blocking dialog. Every decision is a
// server-side row (channel_consent_requests) that ANY surface can answer: the web
// Pending Requests list (Allow/Deny/Send/Cancel → PATCH the row) or this app's
// native notification (Allow/Send action → PATCH the row; Dismiss PARKS it,
// leaving the row pending). Nothing here blocks the channel long-poll loop: the
// trigger path creates a row + fires a notification and RETURNS; consent-watcher.js
// polls the row off-loop and drives the spawn once it flips.
//
// This module owns only the STATELESS primitives: the consent-row HTTP
// (create / decide / poll) and the two native-notification builders. All lifecycle
// (which rows to watch, terminal-decision persistence, single-flight spawn) lives
// in consent-watcher.js; the spawn/echo/post logic lives in trigger.js.
//
// WHAT ROUND B REMOVED (was here in v1.3.x): the app-modal `dialog.showMessageBox`
// consent dialog, the unified dialog+notif+poll `raceDecision`, and the
// before-quit quit guard (beginConsentModal / endConsentModal /
// isConsentModalGuardActive) that existed ONLY because dismissing that windowless
// modal could terminate the app. With no consent dialog there is no such
// terminate, so the guard and its index.js veto are gone as dead code. The orphan
// outbound sweep (cancelStaleOutbound) is also gone — outbound reviews are now
// durable watcher records that survive a restart and post on Send, so there are
// no dead "Send" buttons to sweep.
//
// TRUST is evaluated SERVER-SIDE only (H-3): createConsentRequest returns the row
// already `auto_allowed` when a standing trust rule matches. There is NO
// desktop-side trust cache and NO desktop PATCH of a row no human here decided.
//
// FAIL-CLOSED: if a row cannot be created (endpoint 404 / network), the caller
// does NOT spawn — there is no consent without a row, and (unlike v1.1) there is
// no dialog fallback. Tokens are never logged; the message body is truncated,
// never a token.

const { app, BrowserWindow, Notification } = require('electron');
const { apiFetch } = require('./api');
const { diag } = require('./diag');

const CONSENT_PATH = '/api/channels/consent';
const HTTP_TIMEOUT_MS = 15000;

// M-7: the server caps body / bodyPreview / proposedReply at 16000 chars
// (ChannelMessageCreateSchema + ConsentCreateSchema). Over that the POST 400s.
// Clamp on our side so a long reply is visibly truncated, never silently dropped.
const MAX_CONSENT_CHARS = 16000;
const CLAMP_MARKER = '\n\n[Truncated to fit the 16000 character channel limit.]';
// D2: the server caps `summary` at 200 chars. Hard-slice with NO trailing
// ellipsis (an ellipsis pushed it to 201 → 400 → the web surface silently died).
const MAX_SUMMARY_CHARS = 200;

function truncate(s, n = 240) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}
function clampBody(s) {
  const str = String(s == null ? '' : s);
  if (str.length <= MAX_CONSENT_CHARS) return str;
  return str.slice(0, MAX_CONSENT_CHARS - CLAMP_MARKER.length) + CLAMP_MARKER;
}
function clampSummary(s) {
  return String(s == null ? '' : s).slice(0, MAX_SUMMARY_CHARS);
}

// A consent notification is easy to miss when Dopl runs hidden in the tray. When
// NO window is visible, bounce the dock so a new request still draws attention.
// macOS only, best-effort — never let this throw.
function requestAttention() {
  try {
    if (process.platform !== 'darwin' || !app.dock) return;
    const anyVisible = BrowserWindow.getAllWindows().some((w) => {
      try { return w.isVisible(); } catch (_) { return false; }
    });
    if (!anyVisible) app.dock.bounce('critical');
  } catch (_) { /* best-effort */ }
}

// ── Server-row helpers ───────────────────────────────────────────────────────
function idOf(row) {
  if (!row || typeof row !== 'object') return null;
  return row.id || (row.request && row.request.id) || (row.consent && row.consent.id) || null;
}
function statusOf(row) {
  if (!row || typeof row !== 'object') return '';
  return (
    row.status ||
    (row.request && row.request.status) ||
    (row.consent && row.consent.status) ||
    ''
  );
}

// Create a consent request row. Resolves `{ rowId, status }` (best-effort) or
// null when unavailable (404) / failed — the caller then fails closed (no spawn).
// The server decides the birth status: a standing trust rule makes it
// `auto_allowed` immediately, which the watcher honors on its first poll. Bodies
// are clamped to the server's caps first so an oversized payload can never 400
// the create and silently kill the web surface.
async function createConsentRequest(workspaceId, payload) {
  const body = {
    channelId: payload.channelId,
    kind: payload.kind,
    summary: clampSummary(payload.summary),
    bodyPreview: clampBody(payload.bodyPreview || ''),
  };
  if (payload.messageSeq != null) body.messageSeq = payload.messageSeq;
  if (payload.proposedReply != null) body.proposedReply = clampBody(payload.proposedReply);

  let res;
  try {
    res = await apiFetch(CONSENT_PATH, {
      method: 'POST', workspaceId, body, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
    });
  } catch (err) {
    diag('consent: create error', err && err.message);
    return null;
  }
  if (res.status === 404) { diag('consent: create endpoint 404 — fail closed'); return null; }
  if (!res.ok) { diag('consent: create failed', res.status, payload.kind); return null; }
  let row;
  try { row = await res.json(); } catch (_) { return null; }
  const rowId = idOf(row);
  if (!rowId) return null;
  return { rowId, status: statusOf(row) };
}

// Record a decision a HUMAN made on this machine (the notification Allow/Send
// action). `decidedBy: 'desktop'` keeps the audit trail honest — a native
// decision is NOT a web click (M-8). The server's ConsentDecisionSchema takes
// 'web' | 'desktop' and rejects the server-only 'trust'.
//
// A 409 means the OTHER surface (the web list) decided first — the server CASes on
// status='pending'. That is a lost race, not a failure: the decision stands, it
// just isn't ours. Returning false is correct and there is nothing to retry; the
// watcher's poll will read whatever status won.
async function patchDecision(workspaceId, rowId, decision) {
  if (!rowId) return false;
  try {
    const res = await apiFetch(`${CONSENT_PATH}/${rowId}`, {
      method: 'PATCH',
      workspaceId,
      body: { decision, decidedBy: 'desktop' },
      timeoutMs: HTTP_TIMEOUT_MS,
      noStore: true,
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// One poll of a single row's status. Returns the raw status string
// ('pending' | 'allowed' | 'auto_allowed' | 'denied' | 'expired') for the watcher
// to map, or null on a transient error (keep waiting). A 404 (row hard-deleted)
// is terminal → reported as 'expired' so the watcher drops it silently.
async function pollStatus(workspaceId, rowId) {
  let res;
  try {
    res = await apiFetch(`${CONSENT_PATH}/${rowId}`, {
      workspaceId, timeoutMs: HTTP_TIMEOUT_MS, noStore: true,
    });
  } catch (_) {
    return null;
  }
  if (res.status === 404) return 'expired';
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch (_) { return null; }
  return statusOf(data) || 'pending';
}

// ── Native notifications ─────────────────────────────────────────────────────
// One affirmative action button (Allow / Send) + Dismiss. Dismiss is a PARK, not
// a decision: the 'close' event deliberately does NOT settle (it also fires on
// system auto-dismiss / banner style / Focus mode — indistinguishable from an
// explicit dismiss), so the row stays pending and the request lives on in the web
// list. The affirmative action PATCHes the row; a negative decision (Deny/Cancel)
// comes only from the web list. Clicking the body opens the app to the channel.
function buildActionNotification({ title, body, actionText, onAffirm, onOpen }) {
  if (!Notification.isSupported()) return null;
  let notif;
  try {
    notif = new Notification({
      title,
      body,
      silent: false,
      actions: [{ type: 'button', text: actionText }],
      closeButtonText: 'Dismiss',
    });
  } catch (_) {
    return null; // notifications are best-effort
  }
  notif.on('action', () => { try { if (onAffirm) onAffirm(); } catch (_) { /* window gone */ } });
  notif.on('click', () => { try { if (onOpen) onOpen(); } catch (_) { /* window gone */ } });
  try {
    notif.show();
    requestAttention();
  } catch (_) { /* best-effort */ }
  return notif;
}

// Inbound: "<requester>'s agent asks: <summary>" with an Allow action, plus the
// Round C BLAST-RADIUS line — in plain language, WHERE the agent will run and with
// WHICH tools, so the operator sees the real bound before approving. `runsIn` is an
// already-abbreviated local path (~/…) or null → "the sandbox folder" (the path is
// never sent to the server; the web card can only show the tool profile). The
// location is context; the tool label is the actual containment.
function notifyInbound({ channelName, requesterName, summary, bodyPreview, runsIn, toolLabel, capabilityHint, onAllow, onOpen }) {
  const ask = summary
    ? `${requesterName}'s agent asks: ${clampSummary(summary)}`
    : `${requesterName}'s agent: ${truncate(bodyPreview, 120)}`;
  const where = runsIn || 'the sandbox folder';
  const tools = toolLabel || 'Full-access';
  // Blast-radius line (where + which tool profile) plus a per-profile capability hint
  // composed by the caller from the snapshotted profile (tool-profiles.profileHint):
  // it tells the operator the REAL headless reach — what a restricted profile can
  // safely read, and that `full` is limited headless and needs Run-in-Terminal for
  // shell — BEFORE they approve.
  const hint = capabilityHint ? `\n${capabilityHint}` : '';
  const body = `${ask}\nRuns in ${where} with ${tools} tools${hint}`;
  return buildActionNotification({
    title: channelName, body, actionText: 'Allow', onAffirm: onAllow, onOpen,
  });
}

// Outbound: the drafted reply preview with a Send action.
function notifyOutbound({ channelName, proposedReply, onSend, onOpen }) {
  return buildActionNotification({
    title: channelName,
    body: `Your agent drafted a reply: ${truncate(proposedReply, 120)}`,
    actionText: 'Send',
    onAffirm: onSend,
    onOpen,
  });
}

module.exports = {
  clampBody,
  clampSummary,
  truncate,
  createConsentRequest,
  patchDecision,
  pollStatus,
  notifyInbound,
  notifyOutbound,
};
