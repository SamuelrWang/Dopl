// The run handle a Muse launch returns: this vendor's interrupt and close POLICY over the kit's handle shape
// (`../kit/run-handle.js`) and its frame queue + interrupt bound (`../kit/frame-queue.js`).

const { boundedInterrupt } = require('../kit/frame-queue');
const { runHandle } = require('../kit/run-handle');

// Returned synchronously (two-children bug). `turn/interrupt` is MSP's priority-lane "user pressed stop";
// it is done when `turn/completed terminal:"cancelled"` arrives. Measured 1.4.7: on an already-terminal turn
// it answers `accepted` at once — bounded anyway, since an unanswered request must never hang a Stop.
function handleFor(link, frames, sessionIdOf, turnIdOf) {
  return runHandle({
    frames,
    interrupt() {
      const conn = link.conn;
      if (!conn) { link.interruptPending = true; return Promise.resolve(); }
      const sessionId = sessionIdOf();
      const turnId = turnIdOf();
      // No active turn (cleared on `turn/completed`): nothing to stop.
      if (!sessionId || !turnId) return Promise.resolve();
      return boundedInterrupt(conn.request('turn/interrupt', { sessionId, turnId, commandId: link.commandId() }));
    },
    close() {
      link.closed = true;
      frames.close();
      if (link.conn) link.conn.close();
    },
  });
}

module.exports = { handleFor };
