// Dedicated preload for a Dopl SESSION window.
//
// ⚠ LOCAL file page only (loadFile, no remote content), contextIsolation + sandbox +
// nodeIntegration:false. The bridge below is the ENTIRE privileged API the page gets (§A.4):
// no Node, no fs, no dynamic channels. Main binds the sessionId from the window
// (event.sender), so a forged id in a payload is ignored — we do not even send one. Every
// argument is coerced to a primitive before it crosses.
const { contextBridge, ipcRenderer } = require('electron');

const asStr = (v) => String(v == null ? '' : v);
const asPriority = (p) => (asStr(p) === 'now' ? 'now' : 'normal');
const asDecision = (d) => {
  const s = asStr(d);
  return s === 'allow-once' || s === 'allow-task' || s === 'deny' ? s : 'deny';
};
const asOutcome = (o) => (asStr(o) === 'failed' ? 'failed' : 'completed');
// ⚠ FAIL-CLOSED: anything but an explicit accept (once, or for this session) is a decline, so
// a forged/garbled value never feeds the agent. `accept-task` is the WIRE value (wire `task` ==
// domain `thread`); the grant it arms lives on the session object and a park clears it.
const asInbound = (d) => {
  const s = asStr(d);
  return s === 'accept' || s === 'accept-task' ? s : 'decline';
};
// Consent decision is fail-closed: anything but an explicit 'accept' is a deny.
const asConsent = (d) => (asStr(d) === 'accept' ? 'accept' : 'deny');
// ⚠ THE TWO AXES. A sandboxed preload cannot require() main, so these are the RENDERER-SIDE
// COPY of session-profiles' canonical tables (pinned against it, the reducer and session.html
// by test/session-permission-axes). Both coerce FAIL-CLOSED: a non-member lands on the MOST
// RESTRICTIVE value, so a compromised page cannot reach `bypass` or `auto_both` with a
// near-miss string. Main re-coerces against the same tables — first of two gates, never the
// only one.
const asToolMode = (v) => {
  const s = asStr(v);
  return s === 'accept_edits' || s === 'auto' || s === 'bypass' ? s : 'manual';
};
const asMessageMode = (v) => {
  const s = asStr(v);
  return s === 'auto_inbound' || s === 'auto_outbound' || s === 'auto_both' ? s : 'ask';
};
// ⚠ THE MODEL: renderer-side copy of main/session-model.MODEL_CHOICES, pinned against it,
// session.html and session-store by test/session-model.test.mjs. Stricter than the two axes —
// this value becomes `--model <argv>` on a CHILD PROCESS, so a near-miss must never survive.
// Fail-closed to 'default', which sets no model option at all. Main re-coerces.
const asModel = (v) => {
  const s = asStr(v);
  return s === 'opus' || s === 'sonnet' || s === 'haiku' || s === 'fable' ? s : 'default';
};

// The session id lives in the window URL (session.html?sid=…). ⚠ Read-only display/debug
// convenience — main is authoritative and re-derives it from the window.
function sessionIdFromUrl() {
  try {
    return asStr(new URLSearchParams(window.location.search).get('sid'));
  } catch (_err) {
    return '';
  }
}

// Single renderer-side event sink. ⚠ The raw ipcRenderer event is never handed over. Events
// arriving before session.js registers its handler (the engine may emit 'init' during window
// load) are BUFFERED and flushed on registration.
let handler = null;
let buffer = [];
function deliver(payload) {
  try {
    handler(payload);
  } catch (_err) {
    /* never let a renderer callback throw back across the bridge */
  }
}
// The sign-in banner is owned by session-auth-ui.js, so the SAME stream fans out to a second
// narrow sink. ⚠ Only the two auth payload types reach it, and the transcript view-model
// ignores them (its `default` case), so neither surface can steal the other's events.
const AUTH_TYPES = { auth_required: true, auth_cleared: true };
let authHandler = null;
let authBuffer = [];
function deliverAuth(payload) {
  try {
    authHandler(payload);
  } catch (_err) {
    /* never let a renderer callback throw back across the bridge */
  }
}
// The REQUEST LIFECYCLE STRIP is owned by session-request-ui.js on the same terms as the
// sign-in banner: its own element, its own narrow sink. ⚠ One payload type reaches it, and the
// transcript view-model ignores that type, so neither surface can steal the other's events.
const REQUEST_TYPES = { request_status: true };
let requestHandler = null;
let requestBuffer = [];
function deliverRequest(payload) {
  try {
    requestHandler(payload);
  } catch (_err) {
    /* never let a renderer callback throw back across the bridge */
  }
}
ipcRenderer.on('session:event', (_evt, payload) => {
  if (payload && AUTH_TYPES[payload.type] === true) {
    if (typeof authHandler === 'function') deliverAuth(payload);
    else authBuffer.push(payload);
  }
  if (payload && REQUEST_TYPES[payload.type] === true) {
    if (typeof requestHandler === 'function') deliverRequest(payload);
    else requestBuffer.push(payload);
  }
  if (typeof handler === 'function') deliver(payload);
  else buffer.push(payload);
});

contextBridge.exposeInMainWorld('doplSession', {
  sessionId: sessionIdFromUrl(),
  onEvent(cb) {
    handler = typeof cb === 'function' ? cb : null;
    if (handler && buffer.length) {
      const pending = buffer;
      buffer = [];
      for (const payload of pending) deliver(payload);
    }
  },
  send(text, priority) {
    ipcRenderer.invoke('session:send', { text: asStr(text), priority: asPriority(priority) });
  },
  // The operator's OWN words addressed to the PEER's agent. ⚠ NOT a steer: it never reaches
  // the SDK, so no priority and no turn. Fire-and-forget — the outcome returns over the
  // session:event stream (operator_post / operator_post_result), which survives a slow POST.
  sendToPeer(text) {
    ipcRenderer.invoke('session:send-peer', { text: asStr(text) });
  },
  // The handle main gave this session, for the composer pill's resting row. ⚠ No argument
  // either way beyond main's {name} — the session is re-derived from event.sender, so there is
  // nothing to forge. The PROMISE is returned; the pill paints a fallback until it resolves.
  agentName() {
    return ipcRenderer.invoke('session:agent-name', {});
  },
  // ⚠ The invoke PROMISE is RETURNED so the inline outbound card stamps itself only once main
  // has actually taken the decision. Decision string is fail-closed to 'deny'.
  permission(requestId, decision) {
    return ipcRenderer.invoke('session:permission', { requestId: asStr(requestId), decision: asDecision(decision) });
  },
  // The inbound gate. ⚠ The invoke PROMISE is returned so the renderer stamps the card only
  // once main has taken the decision. There is deliberately no accept-only alias — it would
  // invite a decision carrying no pendingId.
  inboundDecision(pendingId, decision) {
    return ipcRenderer.invoke('session:inbound-decision', { pendingId: asStr(pendingId), decision: asInbound(decision) });
  },
  interrupt() {
    ipcRenderer.invoke('session:interrupt', {});
  },
  end() {
    ipcRenderer.invoke('session:end', {});
  },
  closeTask(outcome, summary) {
    ipcRenderer.invoke('session:close-task', { outcome: asOutcome(outcome), summary: asStr(summary) });
  },
  // Pre-consent Accept/Deny. ⚠ Main re-derives the consent row from event.sender; the payload
  // carries only the coerced decision.
  consentDecision(decision) {
    return ipcRenderer.invoke('session:consent-decision', { decision: asConsent(decision) });
  },
  // The attended handoff: open the OPERATOR'S OWN Claude Code on this request with a
  // prefilled, unsubmitted prompt. ⚠ NO ARGUMENT either way beyond main's {ok, route} — main
  // re-derives the consent card from the window, so there is no id to forge and no text this
  // page can inject into the prompt. Decides nothing server-side, so Accept stays answerable.
  attendedHandoff() {
    return ipcRenderer.invoke('session:attended-handoff', {});
  },
  // AXIS A — per-session TOOL permissions (manual | accept_edits | auto | bypass): what MY
  // agent may do on THIS machine. ⚠ Can never approve a message either way; hard-deny is
  // immovable in every mode, `bypass` included (§H-2).
  // ⚠ The invoke PROMISE is RETURNED: discarded, main's {ok:false} (every change from a
  // pre-consent window) reaches nothing and the select shows a posture main never took.
  setToolMode(mode) {
    return ipcRenderer.invoke('session:set-tool-mode', { mode: asToolMode(mode) });
  },
  // AXIS B — per-session MESSAGE flow (ask | auto_inbound | auto_outbound | auto_both): what
  // crosses between machines. ⚠ Can never approve a work tool, and auto_outbound covers only a
  // post into this session's OWN channel — opening a DM stays a click.
  setMessageMode(mode) {
    return ipcRenderer.invoke('session:set-message-mode', { mode: asMessageMode(mode) });
  },
  // THE MODEL this session runs on. ⚠ NOT a permission — approves nothing, denies nothing, and
  // the two axes are unaffected. Live mid-session (main calls Query.setModel, applying to the
  // next response) and durable across park/resume. PROMISE returned so the select can revert.
  setModel(model) {
    return ipcRenderer.invoke('session:set-model', { model: asModel(model) });
  },
  // The Claude Code sign-in banner. ⚠ Three narrow members, no arguments either way: main
  // re-derives the session from event.sender, so there is no id to forge, and only the
  // banner's display payload crosses back (title / body / action / note — never a token or
  // path).
  auth: {
    onNotice(cb) {
      authHandler = typeof cb === 'function' ? cb : null;
      if (authHandler && authBuffer.length) {
        const pending = authBuffer;
        authBuffer = [];
        for (const payload of pending) deliverAuth(payload);
      }
    },
    // The click. Returns main's {ok} so the button can report a sign-in that did not finish.
    signIn() {
      return ipcRenderer.invoke('session:auth-signin', {});
    },
    // Reload / late-registration read of the CURRENT hold (null when there is none).
    get() {
      return ipcRenderer.invoke('session:auth-state', {});
    },
  },
  // The REQUEST LIFECYCLE STRIP. ⚠ ONE member, RECEIVE-only: the strip has no control, so
  // there is nothing to invoke and nothing to forge. The payload carries a status word from a
  // closed table — no id, name or body.
  request: {
    onStatus(cb) {
      requestHandler = typeof cb === 'function' ? cb : null;
      if (requestHandler && requestBuffer.length) {
        const pending = requestBuffer;
        requestBuffer = [];
        for (const payload of pending) deliverRequest(payload);
      }
    },
  },
  // Folder display + change. ⚠ LABEL only ever crosses back — main resolves channelId from
  // the session, and the abs path never enters here.
  folder: {
    get() {
      return ipcRenderer.invoke('session:folder-get', {});
    },
    choose() {
      return ipcRenderer.invoke('session:folder-choose', {});
    },
    clear() {
      return ipcRenderer.invoke('session:folder-clear', {});
    },
  },
});
