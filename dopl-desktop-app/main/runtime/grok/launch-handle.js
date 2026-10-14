// The run handle a Grok launch returns: this vendor's interrupt, close and live-model POLICY over the kit's
// handle shape (`../kit/run-handle.js`) and its interrupt bound (`../kit/frame-queue.js`).

const { boundedInterrupt } = require('../kit/frame-queue');
const { runHandle } = require('../kit/run-handle');
const policy = require('./policy');

// Stop = ACP `session/cancel` as a NOTIFICATION (as a request it is -32601, LIVE). The running
// `session/prompt` then resolves at once with `stopReason: "cancelled"` (`MidTurnAbort`, LIVE), so the
// interrupt is done when that turn settles (ours, or one Grok started from a late interjection) — bounded
// anyway, since a Stop must never hang. Every permission reply still waiting is answered `cancelled` (ACP's
// cancel contract). ⚠ A prompt Grok QUEUED behind the cancelled turn then runs (LIVE) — a Stop ends the turn,
// not the queue.
function cancelTurn(link) {
  if (!link.conn || !link.sessionId || !link.busy()) return Promise.resolve();
  link.conn.notify('session/cancel', { sessionId: link.sessionId });
  if (link.driver) link.driver.cancelPending();
  return boundedInterrupt(link.turnDone);
}

// Returned synchronously (two-children bug). `t` is the launch's live state (`launch-spec.js › start`).
function handleFor(link, frames, t) {
  const handle = runHandle({
    frames,
    interrupt() {
      if (!link.conn) { link.interruptPending = true; return Promise.resolve(); }
      return cancelTurn(link);
    },
    close() {
      link.closed = true;
      frames.close();
      if (link.conn) link.conn.close();
    },
  });
  // A LIVE model switch (`liveModelSwitch: true` — LIVE: `session/set_config_option` mid-session, and the
  // next prompt ran on the new model). Read back off the echo; no pick is not a switch Grok can make.
  handle.setModel = async function setModel(id) {
    const value = typeof id === 'string' ? id.trim() : '';
    if (!value) throw new Error('Grok switches only to a named model');
    if (!link.conn || !link.sessionId) throw new Error('this Grok session has not started');
    const r = await link.conn.request('session/set_config_option', { sessionId: link.sessionId, configId: 'model', value });
    policy.assertOptionTook(r && r.configOptions, 'model', value, 'model');
    if (t) t.model = value;
  };
  return handle;
}

module.exports = { handleFor, cancelTurn };
