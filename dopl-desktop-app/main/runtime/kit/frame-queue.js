// The frame queue a run handle reads from, and the bound on an interrupt request. Pure (no requires),
// vendor-neutral: any adapter whose `start` pumps frames from a child process into core's async iterator
// builds on this (docs/specs/runtime-scaffold.md §3 K2). Moved verbatim from the first adapter's
// launch-handle.js (2026-10-13).

// A push/pull queue: `push` a frame, `fail` the stream, `close` it; core iterates it.
// Returned synchronously by its builder: an await between "the child exists" and "the session points at
// it" is the two-children bug (a second child keeps the session's channel access with nothing to stop it).
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

// An interrupt request on an already-interrupted turn may never answer (measured on the first adapter's
// CLI — its launch-handle.js names the build), so it is bounded. It resolves, never rejects (the terminal
// state arrives on the frame stream either way), and the timer is `unref`'d so a pending bound cannot
// hold Node open at exit (Node 22 CI).
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

module.exports = { makeFrameQueue, boundedInterrupt, INTERRUPT_TIMEOUT_MS };
