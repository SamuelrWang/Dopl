// The run handle a Codex launch returns. The frame queue and the interrupt bound are vendor-neutral and
// live in `../kit/frame-queue.js` (runtime scaffold K2, 2026-10-13).

const { boundedInterrupt } = require('../kit/frame-queue');

// ── HANDLE ───────────────────────────────────────────────────────────────────────────────────
// Returned synchronously: an await between "the child exists" and "the session points at it" is the
// two-children bug (a second child keeps the session's channel access with nothing to stop it).
// `turn/interrupt` on an already-interrupted turn never answers (codex-cli 0.155.1) — hence the bound.

function handleFor(link, frames, threadIdOf, turnIdOf) {
  return {
    [Symbol.asyncIterator]() { return frames[Symbol.asyncIterator](); },
    next() { return frames.next(); },
    /** Dopl's only way to stop a running turn (`session-engine.js › runEffect` `interruptQuery`). */
    interrupt() {
      const conn = link.conn;
      if (!conn) return Promise.resolve();
      // During the first turn's wait: cut it short; the pump interrupts the turn once it has an id.
      if (link.ready.isWaiting()) {
        link.interruptPending = true;
        link.ready.release('interrupted');
        return Promise.resolve();
      }
      const threadId = threadIdOf();
      const turnId = turnIdOf();
      // No active turn (cleared on `turn/completed`), no request: an interrupted turn never answers one.
      if (!threadId || !turnId) return Promise.resolve();
      return boundedInterrupt(conn.request('turn/interrupt', { threadId, turnId }));
    },
    close() {
      link.closed = true;
      link.ready.release('closed');
      frames.close();
      if (link.conn) link.conn.close();
    },
  };
}

module.exports = { handleFor };
