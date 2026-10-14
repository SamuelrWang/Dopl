// The run handle `runtime.start()` returns to core (docs/specs/runtime-scaffold.md §3 K3): an async
// iterator over the run's raw frames plus core's two verbs, `interrupt()` and `close()`. Pure,
// vendor-neutral. The POLICY of each verb — what an interrupt sends, when it may not send, what close
// tears down — is the adapter's, passed in as callbacks; the kit only fixes the handle's shape.
//
// Built and returned SYNCHRONOUSLY: an await between "the child exists" and "the session points at it"
// is the two-children bug (a second child keeps the session's channel access with nothing to stop it).

/**
 * `frames` is any async iterator (a `kit/frame-queue.js` queue, an async generator).
 * `interrupt()` → Promise, Dopl's only way to stop a running turn (`session-engine.js › runEffect`
 * `interruptQuery`); it must settle. `close()` → void, ends the run and the stream.
 */
function runHandle({ frames, interrupt, close }) {
  return {
    [Symbol.asyncIterator]() { return frames[Symbol.asyncIterator](); },
    next() { return frames.next(); },
    interrupt,
    close,
  };
}

module.exports = { runHandle };
