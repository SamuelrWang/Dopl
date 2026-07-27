// Channels v1.2 — decoupled consent (inbound approve-in + outbound approve-out).
//
// Consent is DECOUPLED from the executor: every decision is a server-side row
// (channel_consent_requests) that EITHER surface can answer — the web app or the
// desktop's own native dialog. The desktop keeps its battle-tested native
// dialog + alert-notification surfaces (v1.1) and ADDS a poll on the server row,
// racing all surfaces onto one single-resolve promise (first answer wins).
//
// Flows:
//   Inbound  (before spawn):  trust auto-allow  |  dialog + notification + web row
//   Outbound (before reply):  dialog + notification + web row  (approve-out gate)
//
// Standing consent is PER-TEAMMATE trust (agent_trust_rules), never per-capability
// — a trusted requester's inbound requests auto-allow. TRUST IS EVALUATED
// SERVER-SIDE ONLY (H-3): createConsentRequest looks up the rule and returns the
// row already `auto_allowed` (decided_by='trust'). The desktop deliberately keeps
// NO local trust cache. It used to, refreshed only once per ~5-minute reconcile,
// which meant a trust rule the operator had just revoked on the web could still
// auto-allow here — and worse, the desktop then PATCHed the server's still-
// 'pending' row to allowed with decided_by='web', fabricating a human decision
// nobody made and showing no dialog. The server is the only authority now, so a
// revocation takes effect on the very next request.
//
// GRACEFUL DEGRADE: if the consent endpoints 404 (web not deployed yet) or a
// create fails, there is no row to poll and we fall back to dialog-only local
// consent — exactly the v1.1 behavior. With no row there is also no auto-allow
// (fail-safe: prompt). Tokens are never logged.
//
// Every decision point is diag()-logged; the message body is truncated, never a
// token.

const { app, BrowserWindow, dialog, Notification } = require('electron');
const { apiFetch } = require('./api');
const { diag } = require('./diag');

// A consent banner is easy to miss when the operator runs Dopl hidden in the
// tray. When NO window is visible, bounce the dock so the request still draws
// attention; when a window is up, the banner + in-app dialog are enough. macOS
// only, best-effort — never let this throw into the consent race.
function requestAttention() {
  try {
    if (process.platform !== 'darwin' || !app.dock) return;
    const anyVisible = BrowserWindow.getAllWindows().some((w) => {
      try { return w.isVisible(); } catch (_) { return false; }
    });
    if (!anyVisible) app.dock.bounce('critical');
  } catch (_) { /* best-effort */ }
}

// ── Quit guard: a windowless app-modal dialog can quit the app on dismissal ────
// The consent dialog below is an app-modal `dialog.showMessageBox` with NO parent
// window (kept so it works the same visible or hidden-in-tray). On macOS, when the
// app has no VISIBLE window (running hidden as a login item / closed-to-tray),
// dismissing it — Cancel/Deny especially — makes AppKit send the process a native
// terminate:, firing `before-quit` and taking the WHOLE app down. Nothing on the
// consent path calls app.quit(), and the empty window-all-closed handler never
// catches it (the hidden window was never closed — the terminate comes straight
// from the modal path, tens of ms after the dialog resolves).
//
// Fix: while a consent dialog is on screen — plus a short grace after it closes,
// since the terminate lands LATER than the resolve — arm this guard. index.js's
// before-quit calls isConsentModalGuardActive() and vetoes any quit that did NOT
// set app.isQuitting (tray Quit / updater do; the spurious modal terminate does
// not), so sanctioned quits are untouched.
let openConsentModals = 0;
let lastConsentModalClosedAt = 0;
const QUIT_GUARD_GRACE_MS = 3000;
function beginConsentModal() { openConsentModals += 1; }
function endConsentModal() {
  if (openConsentModals > 0) openConsentModals -= 1;
  lastConsentModalClosedAt = Date.now();
}
function isConsentModalGuardActive() {
  if (openConsentModals > 0) return true;
  return Date.now() - lastConsentModalClosedAt < QUIT_GUARD_GRACE_MS;
}

const CONSENT_PATH = '/api/channels/consent';
// L: 2s against a 30-minute ceiling is up to 900 requests per pending decision,
// and each GET makes the server run its expire-stale sweep. Start at 5s and step
// down further the longer a request sits unanswered — a human who has not
// answered in ten minutes is not answering in the next two seconds either.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_INTERVAL_MS = 20000;
const POLL_MAX_MS = 30 * 60 * 1000; // align with the server-side pending expiry
const HTTP_TIMEOUT_MS = 15000;
// M-7: the server caps body / bodyPreview / proposedReply at 16000 chars
// (ChannelMessageCreateSchema + ConsentCreateSchema). Over that the POST 400s and
// the whole outbound review silently degrades to dialog-only, or an approved
// reply is dropped with nothing but a diag line. Clamp on our side instead.
const MAX_CONSENT_CHARS = 16000;

// Poll cadence: 5s for the first minute, 10s to five minutes, then 20s.
function pollDelay(elapsedMs) {
  if (elapsedMs < 60_000) return POLL_INTERVAL_MS;
  if (elapsedMs < 5 * 60_000) return POLL_INTERVAL_MS * 2;
  return POLL_MAX_INTERVAL_MS;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DECIDED = new Set(['allowed', 'denied', 'expired', 'auto_allowed']);
const isDecided = (s) => DECIDED.has(String(s || ''));
const isAllowed = (s) => s === 'allowed' || s === 'auto_allowed';

function truncate(s, n = 240) {
  const str = String(s == null ? '' : s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// M-7: clamp to the server's cap with a marker the operator can see in the
// review dialog, so a long reply is visibly truncated rather than silently lost.
const CLAMP_MARKER = '\n\n[Truncated to fit the 16000 character channel limit.]';
function clampBody(s) {
  const str = String(s == null ? '' : s);
  if (str.length <= MAX_CONSENT_CHARS) return str;
  return str.slice(0, MAX_CONSENT_CHARS - CLAMP_MARKER.length) + CLAMP_MARKER;
}

// D2: the server caps `summary` at 200 chars (ConsentCreateSchema). `truncate(…,
// 200)` appended an ellipsis, so an over-length summary became 201 chars → the
// POST 400s and the whole web review surface silently degrades to dialog-only.
// Clamp with a hard slice and NO trailing ellipsis, everywhere a summary is sent
// to /consent or rendered into a dialog/notification body.
const MAX_SUMMARY_CHARS = 200;
function clampSummary(s) {
  return String(s == null ? '' : s).slice(0, MAX_SUMMARY_CHARS);
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

// Create a consent request row. Returns the parsed row (best-effort) or null when
// unavailable (404) / failed — caller then degrades to dialog-only. The server
// decides the row's birth status: a standing trust rule makes it `auto_allowed`
// immediately, and the caller must honor that instead of prompting (M-1).
// Bodies are clamped to the server's cap first (M-7) so an oversized reply can
// never 400 the create and silently kill the web surface.
async function postConsentRequest(workspaceId, payload) {
  const body = {
    channelId: payload.channelId,
    kind: payload.kind,
    summary: clampSummary(payload.summary), // D2: hard 200-char slice, no ellipsis
    bodyPreview: clampBody(payload.bodyPreview || ''),
  };
  if (payload.messageSeq != null) body.messageSeq = payload.messageSeq;
  if (payload.proposedReply != null) body.proposedReply = clampBody(payload.proposedReply);

  let res;
  try {
    res = await apiFetch(CONSENT_PATH, {
      method: 'POST',
      workspaceId,
      body,
      timeoutMs: HTTP_TIMEOUT_MS,
      noStore: true,
    });
  } catch (err) {
    diag('consent: create error', err && err.message);
    return null;
  }
  if (res.status === 404) {
    diag('consent: create endpoint 404 — dialog-only fallback');
    return null;
  }
  if (!res.ok) {
    diag('consent: create failed', res.status, payload.kind);
    return null;
  }
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Record a decision a HUMAN made on this machine. `decidedBy: 'desktop'` is what
// keeps the audit trail honest — the desktop used to leave it unset, so every
// native-dialog decision was filed as if it had been clicked on the web (M-8).
// The server's ConsentDecisionSchema takes 'web' | 'desktop' and defaults to
// 'web'; 'trust' is server-generated only and rejected from callers.
//
// A 409 means the OTHER surface decided first (the server CASes on
// status='pending'). That is a lost race, not a failure: the decision stands,
// it just isn't ours. Returning false is correct and there is nothing to retry.
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

// M-6: deny this channel's orphaned pending OUTBOUND rows.
//
// An outbound row is created, then the app crashes (or is quit) before the reply
// is posted. The row stays 'pending' forever, so the web review card keeps a live
// Send button whose click does nothing at all — the desktop that held the drafted
// reply is gone, and nothing on the server can post it. Unlike inbound, outbound
// creates are not de-duped server-side, so these accumulate. Sweep them once per
// channel per app run, before any new flow can add another.
//
// A server-side sweep would be cleaner (these are dead the moment the desktop
// disconnects, and only the server knows that); this is the client-side stopgap.
//
// `exceptMessageSeq` is load-bearing now that outbound creates are de-duped
// server-side at ANY status on (operator, channel, kind, message_seq): denying a
// row here means a later POST for that same seq returns the DENIED row and the
// reply is dropped with no dialog. The one message we are about to replay must
// therefore be left alone — its row goes live again the moment the replayed
// spawn re-POSTs and starts polling it.
async function cancelStaleOutbound(workspaceId, channelId, exceptMessageSeq) {
  if (!workspaceId || !channelId) return 0;
  let res;
  try {
    res = await apiFetch(`${CONSENT_PATH}?channelId=${encodeURIComponent(channelId)}`, {
      workspaceId,
      timeoutMs: HTTP_TIMEOUT_MS,
      noStore: true,
    });
  } catch (err) {
    diag('consent sweep: error', err && err.message);
    return 0;
  }
  if (res.status === 404) return 0; // endpoint not deployed yet
  if (!res.ok) {
    diag('consent sweep: list failed', res.status);
    return 0;
  }
  let data;
  try {
    data = await res.json();
  } catch (_) {
    return 0;
  }
  const rows = Array.isArray(data) ? data : (data && (data.requests || data.data)) || [];
  let denied = 0;
  for (const r of rows) {
    if (!r || r.kind !== 'outbound') continue;
    const status = String(r.status || 'pending');
    if (status !== 'pending') continue;
    if (exceptMessageSeq != null && Number(r.messageSeq) === Number(exceptMessageSeq)) {
      diag('consent sweep: keeping row for replayed seq', exceptMessageSeq);
      continue;
    }
    if (await patchDecision(workspaceId, r.id, 'deny')) denied++;
  }
  if (denied) diag('consent sweep: denied', denied, 'orphan outbound row(s)');
  return denied;
}

// One poll of the single row's status. Returns 'allowed'|'auto_allowed' → true,
// 'denied'|'expired' → false, anything else (still pending / transient) → null.
async function pollOnce(workspaceId, rowId) {
  let res;
  try {
    res = await apiFetch(`${CONSENT_PATH}/${rowId}`, {
      workspaceId,
      timeoutMs: HTTP_TIMEOUT_MS,
      noStore: true,
    });
  } catch (_) {
    return null;
  }
  if (res.status === 404) return false; // row gone → treat as resolved (deny/drop)
  if (!res.ok) return null;
  let data;
  try {
    data = await res.json();
  } catch (_) {
    return null;
  }
  const status = statusOf(data);
  if (status === 'allowed' || status === 'auto_allowed') return true;
  if (status === 'denied' || status === 'expired') return false;
  return null;
}

// ── Unified single-resolve race (dialog + notification + web-row poll) ───────
// Mirrors the v1.1 requestConsent pattern: the in-app dialog is the source of
// truth; an alert notification offers a one-click affirmative; the web row is
// polled. First answer wins; the others are dismissed best-effort. The
// notification 'close' event deliberately does NOT settle (it also fires on
// system auto-dismiss / banner style / Focus mode — indistinguishable from an
// explicit dismiss). Negative decisions route through the dialog or the web row.
function raceDecision({ workspaceId, rowId, surfaces, onOpenChannel }) {
  return new Promise((resolve) => {
    let settled = false;
    let notif = null;
    let polling = true;

    const finish = (val, via) => {
      if (settled) return;
      settled = true;
      polling = false;
      diag('consent', surfaces.kind, 'via', via, '->', val ? 'ALLOWED' : 'denied');
      try {
        if (notif) notif.close();
      } catch (_) {
        /* best-effort */
      }
      // Reflect a locally-made decision back onto the server row so the web
      // surface stops showing it as pending.
      if (via !== 'web' && rowId) {
        patchDecision(workspaceId, rowId, val ? 'allow' : 'deny').catch(() => {});
      }
      resolve(val);
    };

    // Surface 1: alert notification with an affirmative action (best-effort).
    try {
      if (Notification.isSupported()) {
        notif = new Notification({
          title: surfaces.notifTitle,
          body: surfaces.notifBody,
          silent: false,
          actions: [{ type: 'button', text: surfaces.notifActionText }],
          closeButtonText: 'Dismiss',
        });
        notif.on('action', () => finish(true, 'notif-action'));
        notif.on('click', () => {
          try {
            if (onOpenChannel) onOpenChannel();
          } catch (_) {
            /* window may be gone */
          }
        });
        notif.show();
        requestAttention(); // bounce the dock when running hidden in the tray
      }
    } catch (_) {
      /* notifications are best-effort */
    }

    // Surface 2: in-app dialog — the source of truth. App-modal, NO parent window
    // (works the same visible or hidden-in-tray). beginConsentModal/endConsentModal
    // arm the quit guard so its dismissal can't take the whole app down when Dopl
    // is windowless — see isConsentModalGuardActive() and index.js's before-quit.
    beginConsentModal();
    dialog
      .showMessageBox({
        type: surfaces.dialogType || 'question',
        buttons: surfaces.dialogButtons,
        defaultId: surfaces.dialogDefaultId,
        cancelId: surfaces.dialogCancelId,
        noLink: true,
        title: 'Dopl Channels',
        message: surfaces.dialogMessage,
        detail: surfaces.dialogDetail,
      })
      .then(({ response }) => finish(response === surfaces.dialogAllowIndex, 'dialog'))
      .catch(() => finish(false, 'dialog-error'))
      .finally(endConsentModal);

    // Surface 3: poll the web row (skipped when there is no row). The cadence
    // backs off the longer the request sits unanswered — every GET also runs the
    // server's expire-stale sweep, so a tight loop is not free.
    if (rowId) {
      (async () => {
        const startedAt = Date.now();
        const deadline = startedAt + POLL_MAX_MS;
        while (polling && !settled && Date.now() < deadline) {
          await sleep(pollDelay(Date.now() - startedAt));
          if (!polling || settled) return;
          const r = await pollOnce(workspaceId, rowId);
          if (r === true) return finish(true, 'web');
          if (r === false) return finish(false, 'web');
        }
      })().catch((err) => diag('consent: poll error', err && err.message));
    }
  });
}

// ── Inbound (approve-in, before spawn) ───────────────────────────────────────
// ALWAYS create the row first, then read the status the SERVER gave it:
//   auto_allowed / allowed  → spawn immediately, no dialog (trust, or the
//                             operator answered on the web before we got here)
//   denied / expired        → drop, no dialog
//   pending (or no row)     → race dialog + notification + poll as before
// H-3/M-1: there is no desktop-side trust evaluation and no desktop-side PATCH
// of a row no human here decided. Ignoring the created row's status was also how
// a server auto-allow could fire a dialog nobody could meaningfully dismiss.
async function decideInbound({ entry, m, requesterName, summary, workspaceId, onOpenChannel }) {
  const channel = entry.channel;
  const bodyPreview = truncate(m.body, 2000);
  // D2: clamp once here so the summary sent to /consent and the summary rendered
  // into the notification + dialog below are identical and never exceed the cap.
  const summaryText = clampSummary(summary);

  const row = await postConsentRequest(workspaceId, {
    channelId: channel.id,
    kind: 'inbound',
    messageSeq: m.seq,
    summary: summaryText,
    bodyPreview,
  });
  const rowId = idOf(row);
  const born = statusOf(row);
  if (isDecided(born)) {
    diag('consent inbound: server-decided at creation ->', born, '(no dialog)');
    return isAllowed(born);
  }
  diag('consent inbound: row', rowId ? String(rowId).slice(0, 8) : 'none (dialog-only)');

  const notifBody = summaryText
    ? `${requesterName}'s agent asks: ${summaryText}`
    : `${requesterName}'s agent: ${truncate(m.body, 120)}`;

  return raceDecision({
    workspaceId,
    rowId,
    onOpenChannel,
    surfaces: {
      kind: 'inbound',
      notifTitle: channel.name,
      notifBody,
      notifActionText: 'Allow',
      dialogType: 'question',
      dialogButtons: ['Deny', 'Allow once'],
      dialogDefaultId: 0,
      dialogCancelId: 0,
      dialogAllowIndex: 1,
      dialogMessage: `Run a Claude session to answer this message in "${channel.name}"?`,
      dialogDetail: summaryText
        ? `${requesterName}: ${summaryText}\n\n${truncate(m.body, 500)}`
        : truncate(m.body, 600),
    },
  });
}

// ── Outbound (approve-out, before the reply leaves the machine) ──────────────
// The agent produced a reply; nothing is posted until the operator approves.
// Create a row (web review) and race dialog + notif + poll. On deny/expire the
// caller drops the reply. Trust never auto-allows an outbound row server-side,
// but we still honor a decided birth status for the same reason inbound does.
async function decideOutbound({ entry, m, proposedReply, workspaceId, onOpenChannel }) {
  const channel = entry.channel;
  const reply = clampBody(proposedReply); // M-7: keep review and post identical
  const row = await postConsentRequest(workspaceId, {
    channelId: channel.id,
    kind: 'outbound',
    messageSeq: m.seq,
    summary: `Reply from your agent in "${channel.name}"`,
    bodyPreview: truncate(reply, 2000),
    proposedReply: reply,
  });
  const rowId = idOf(row);
  const born = statusOf(row);
  if (isDecided(born)) {
    diag('consent outbound: server-decided at creation ->', born, '(no dialog)');
    return isAllowed(born);
  }
  diag('consent outbound: row', rowId ? String(rowId).slice(0, 8) : 'none (dialog-only)');

  return raceDecision({
    workspaceId,
    rowId,
    onOpenChannel,
    surfaces: {
      kind: 'outbound',
      notifTitle: channel.name,
      notifBody: `Your agent drafted a reply: ${truncate(reply, 120)}`,
      notifActionText: 'Send',
      dialogType: 'question',
      dialogButtons: ['Cancel', 'Send reply'],
      // M-5: Cancel is the default. This dialog can appear while the operator is
      // typing elsewhere, and a stray Return must never push an agent-written
      // message out to teammates. Inbound already defaults to Deny; the send
      // gate is the one that leaks data, so it gets the same treatment.
      dialogDefaultId: 0,
      dialogCancelId: 0,
      dialogAllowIndex: 1,
      dialogMessage: `Send your agent's reply in "${channel.name}"?`,
      dialogDetail: truncate(reply, 1500),
    },
  });
}

module.exports = {
  decideInbound, decideOutbound, cancelStaleOutbound, clampBody, isConsentModalGuardActive,
};
