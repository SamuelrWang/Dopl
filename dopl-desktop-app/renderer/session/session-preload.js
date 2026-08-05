// Dedicated preload for a Dopl SESSION window (v1.9).
//
// This surface loads a LOCAL file page only (loadFile, no remote content) with
// contextIsolation + sandbox + nodeIntegration:false. The bridge below is the
// ENTIRE privileged API the page gets — exactly the §A.4 contract, nothing more.
// No Node, no fs, no dynamic channels. The main side binds the sessionId from
// the window (event.sender), so a forged id in a payload is ignored; we do not
// even send one. Every argument is coerced to a primitive before it crosses.
const { contextBridge, ipcRenderer } = require('electron');

const asStr = (v) => String(v == null ? '' : v);
const asPriority = (p) => (asStr(p) === 'now' ? 'now' : 'normal');
const asDecision = (d) => {
  const s = asStr(d);
  return s === 'allow-once' || s === 'allow-task' || s === 'deny' ? s : 'deny';
};
const asOutcome = (o) => (asStr(o) === 'failed' ? 'failed' : 'completed');
// v2.5 D1: the inbound gate decision is fail-closed — anything but an explicit accept
// (once, or for this session) is a decline, so a forged/garbled value never feeds the agent.
// v3.0: `accept-task` stays the wire value (wire name `task` == domain name `thread`); the
// grant it arms lives on the session object and a park clears it, which the copy now says.
const asInbound = (d) => {
  const s = asStr(d);
  return s === 'accept' || s === 'accept-task' ? s : 'decline';
};
// Consent decision is fail-closed: anything but an explicit 'accept' is a deny.
const asConsent = (d) => (asStr(d) === 'accept' ? 'accept' : 'deny');
// v2.9 THE TWO AXES. A sandboxed preload cannot require() main, so these lists are the
// renderer-side copy of session-profiles' canonical tables (pinned against it, the reducer
// and session.html by test/session-permission-axes). Both coerce FAIL-CLOSED: anything that
// is not an exact member lands on the MOST RESTRICTIVE value of that axis, so a compromised
// page cannot reach `bypass` or `auto_both` by sending a near-miss string. Main re-coerces
// against the same tables, so this is the first of two identical gates, never the only one.
const asToolMode = (v) => {
  const s = asStr(v);
  return s === 'accept_edits' || s === 'auto' || s === 'bypass' ? s : 'manual';
};
const asMessageMode = (v) => {
  const s = asStr(v);
  return s === 'auto_inbound' || s === 'auto_outbound' || s === 'auto_both' ? s : 'ask';
};
// 2026-08-02 THE MODEL. The renderer-side copy of main/session-model.MODEL_CHOICES (a sandboxed
// preload cannot require main), pinned against it, session.html and session-store by
// test/session-model.test.mjs. It matters MORE than the two above: this value becomes
// `--model <argv>` on a child process, so a near-miss string must never survive. Fail-closed to
// 'default', which sets no model option at all. Main re-coerces against the same list, so this
// is the first of several identical gates and never the only one.
const asModel = (v) => {
  const s = asStr(v);
  return s === 'opus' || s === 'sonnet' || s === 'haiku' || s === 'fable' ? s : 'default';
};

// The session id lives in the window URL (session.html?sid=…). Read-only; the
// main process is authoritative and re-derives it from the window — this is a
// display/debug convenience only.
function sessionIdFromUrl() {
  try {
    return asStr(new URLSearchParams(window.location.search).get('sid'));
  } catch (_err) {
    return '';
  }
}

// Single renderer-side event sink. main → renderer 'session:event' is forwarded
// to the page's callback; the raw ipcRenderer event is never handed over. Events
// that arrive before session.js registers its handler (the engine may emit
// 'init' during window load) are buffered and flushed on registration.
let handler = null;
let buffer = [];
function deliver(payload) {
  try {
    handler(payload);
  } catch (_err) {
    /* never let a renderer callback throw back across the bridge */
  }
}
// Q6: the sign-in banner is owned by session-auth-ui.js, not the transcript controller, so the
// SAME main->renderer stream fans out to a second, narrow sink. Only the two auth payload types
// reach it; everything else is untouched, and the transcript view-model ignores them (its
// `default` case), so neither surface can steal the other's events.
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
// 2026-08-02: the REQUEST LIFECYCLE STRIP is owned by session-request-ui.js on exactly the same
// terms as the sign-in banner above — its own element, its own narrow sink — because session.js,
// session-render.js and the view-model are all at the §2 500-line cap and this line needs none
// of them. One payload type reaches it; the transcript view-model ignores that type (its
// `default` case), so neither surface can steal the other's events.
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
  // v2.8: the operator's OWN words, addressed to the PEER's agent (an `@their-agent` tag in
  // the composer). NOT a steer: it never reaches the SDK, so there is no priority and no
  // turn. Fire-and-forget on purpose — the outcome comes back over the session:event stream
  // (operator_post / operator_post_result), which is also what survives a slow POST.
  sendToPeer(text) {
    ipcRenderer.invoke('session:send-peer', { text: asStr(text) });
  },
  // §3.2: the handle main gave this session, for the composer pill's resting row. Takes no
  // argument in either direction beyond main's {name}: the session is re-derived from
  // event.sender, so there is nothing to forge. The PROMISE is returned — the pill paints the
  // fallback ("Message this session") until it resolves, and repaints when it does.
  agentName() {
    return ipcRenderer.invoke('session:agent-name', {});
  },
  // v2.7 L3: the invoke PROMISE is RETURNED (it always resolved main's {ok} — the dock
  // simply ignored it), so the inline outbound decision card can stamp itself only once
  // main has actually taken the decision, exactly like the inbound gate. The decision
  // string stays fail-closed: anything but allow-once / allow-task coerces to 'deny'.
  permission(requestId, decision) {
    return ipcRenderer.invoke('session:permission', { requestId: asStr(requestId), decision: asDecision(decision) });
  },
  // v2.5 D1: the inbound gate. FIX F10: the invoke PROMISE is returned, so the renderer
  // can stamp the card only once main has actually taken the decision. The dead
  // accept-only alias that used to sit here (and its main handler) is deleted: nothing
  // called it, and it invited a decision carrying no pendingId.
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
  // Pre-consent Accept/Deny (item 8). The main side re-derives the consent row
  // from event.sender; the payload carries only the coerced decision.
  consentDecision(decision) {
    return ipcRenderer.invoke('session:consent-decision', { decision: asConsent(decision) });
  },
  // F-118 — the attended handoff: open the OPERATOR'S OWN Claude Code on this request,
  // with a prefilled, unsubmitted prompt. NO ARGUMENT in either direction beyond main's
  // {ok, route}: main re-derives the consent card from the window, exactly like
  // consentDecision above, so there is no id to forge and no text this page can inject
  // into the prompt. It decides nothing on the server, so Accept stays answerable.
  attendedHandoff() {
    return ipcRenderer.invoke('session:attended-handoff', {});
  },
  // v2.9 AXIS A — per-session TOOL permissions (manual | accept_edits | auto | bypass).
  // What MY agent may do on THIS machine. It can never approve an outbound message or an
  // incoming one; hard-deny stays immovable in every mode, `bypass` included (§H-2).
  // FIX 2 (2026-08-02): the invoke PROMISE is RETURNED, like permission() and
  // inboundDecision() already do. It was DISCARDED, so main's {ok:false} — every change made
  // from a pre-consent window answered with one — reached nothing, and the select sat there
  // showing a posture main had never taken. The renderer now reverts on a refusal.
  setToolMode(mode) {
    return ipcRenderer.invoke('session:set-tool-mode', { mode: asToolMode(mode) });
  },
  // v2.9 AXIS B — per-session MESSAGE flow (ask | auto_inbound | auto_outbound | auto_both).
  // What crosses between machines. It can never approve a work tool, and even auto_outbound
  // only covers a post into this session's OWN channel: opening a DM stays a click.
  setMessageMode(mode) {
    return ipcRenderer.invoke('session:set-message-mode', { mode: asMessageMode(mode) });
  },
  // 2026-08-02 — THE MODEL this session runs on. NOT a permission: it can approve nothing and
  // deny nothing, and the two axes above are unaffected by it. Live mid-session (main calls
  // Query.setModel, which applies to the next response) and durable across a park/resume. The
  // invoke PROMISE is returned like the two axes, so the select reverts when main refuses.
  setModel(model) {
    return ipcRenderer.invoke('session:set-model', { model: asModel(model) });
  },
  // Q6 — the Claude Code sign-in banner. THREE narrow members, no arguments in either
  // direction: main re-derives the session from the window (event.sender) exactly like every
  // other handler, so there is no id to forge, and the only thing that crosses back is the
  // banner's own display payload (title / body / action / note — never a token or a path).
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
  // 2026-08-02 — the REQUEST LIFECYCLE STRIP. ONE member, and it only RECEIVES: the strip has
  // no control on it, so there is nothing to invoke and nothing to forge. The payload carries a
  // status word from a closed table and no id, name or body.
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
  // Folder display + change (item 7). LABEL only ever crosses back — the main
  // side resolves channelId from the session; the abs path never enters here.
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
