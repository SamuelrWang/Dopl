// The run handle a Codex launch returns, and the frame queue it reads from. Pure (no requires): split
// out of launch-spec.js at the 500-line cap, which re-exports `makeFrameQueue` / `boundedInterrupt`.

// ── HANDLE ───────────────────────────────────────────────────────────────────────────────────
// Returned synchronously: an await between "the child exists" and "the session points at it" is the
// two-children bug (a second child keeps the session's channel access with nothing to stop it).

function makeFrameQueue() {
  const queue = [];
  let waiting = null;
  let failure = null;
  let closed = false;
  const settle = () => {
    if (!waiting) return;
    const w = waiting; waiting = null;
    if (queue.length) { w.resolve({ value: queue.shift(), done: false }); return; }
    if (failure) { const e = failure; failure = null; w.reject(e); return; }
    if (closed) { w.resolve({ value: undefined, done: true }); }
  };
  return {
    push(frame) { if (!closed) { queue.push(frame); settle(); } },
    // Ignored after `close()` (a deliberate shutdown is not a crash) and after a first failure (the cause).
    fail(err) {
      if (closed || failure) return;
      failure = err instanceof Error ? err : new Error(String(err));
      settle();
    },
    close() { closed = true; settle(); },
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (failure) { const e = failure; failure = null; return Promise.reject(e); }
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
    },
  };
}

// `turn/interrupt` on an already-interrupted turn never answers (codex-cli 0.155.1), so it is bounded.
// It resolves, never rejects (the terminal state arrives on the frame stream either way), and the timer
// is `unref`'d so a pending bound cannot hold Node open at exit (Node 22 CI).
const INTERRUPT_TIMEOUT_MS = 5000;

function boundedInterrupt(pending) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, INTERRUPT_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    pending.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); }
    );
  });
}

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

module.exports = { makeFrameQueue, boundedInterrupt, handleFor, INTERRUPT_TIMEOUT_MS };
