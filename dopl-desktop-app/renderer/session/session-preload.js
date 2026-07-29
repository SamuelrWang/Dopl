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
const asBool = (v) => v === true;
const asPriority = (p) => (asStr(p) === 'now' ? 'now' : 'normal');
const asDecision = (d) => {
  const s = asStr(d);
  return s === 'allow-once' || s === 'allow-task' || s === 'deny' ? s : 'deny';
};
const asOutcome = (o) => (asStr(o) === 'failed' ? 'failed' : 'completed');
// Consent decision is fail-closed: anything but an explicit 'accept' is a deny.
const asConsent = (d) => (asStr(d) === 'accept' ? 'accept' : 'deny');

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
ipcRenderer.on('session:event', (_evt, payload) => {
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
  permission(requestId, decision) {
    ipcRenderer.invoke('session:permission', { requestId: asStr(requestId), decision: asDecision(decision) });
  },
  releaseInbound(pendingId) {
    ipcRenderer.invoke('session:release-inbound', { pendingId: asStr(pendingId) });
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
  // Per-session auto-approve toggle (item 10). Sends only the coerced boolean;
  // the main side re-derives the session from event.sender. This flips ONLY the
  // gate→allow branch in makeCanUseTool — hard-deny stays immovable (§H-2).
  setAutoApprove(enabled) {
    ipcRenderer.invoke('session:set-auto-approve', { enabled: asBool(enabled) });
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
