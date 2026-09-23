// THE MID-TURN FOLD (P4-05). The CLI absorbs a queued `priority: 'next'` message into the running
// turn after its next tool batch, so one `result` answers both (`test/claude-mid-turn-fold-live.test.mjs`).
// It reports a command's lifecycle only for a message carrying a `uuid`, so every push is stamped.
// A fold is `command_lifecycle{started}` for a stamped uuid after the current turn produced output;
// a command that runs as its own turn starts before any output of that turn.

const crypto = require('crypto');

// A stamped command the CLI never reports is dropped oldest-first, not held for the session's life.
const PENDING_MAX = 64;

function pushedText(msg) {
  const content = msg && msg.message && msg.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
  }
  return '';
}

/**
 * One query's fold watch. `stamp(prompt)` wraps the push iterable the SDK reads; `observe(msg)`
 * sees every message the query yields; `onJoined(text)` runs once per push the CLI folded.
 */
function makeFoldWatch(onJoined) {
  const pending = new Map();
  let turnHasOutput = false;

  function remember(uuid, text) {
    pending.set(uuid, text);
    while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value);
  }

  function stamp(prompt) {
    const source = prompt && typeof prompt[Symbol.asyncIterator] === 'function' ? prompt[Symbol.asyncIterator]() : prompt;
    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        const r = await source.next();
        if (r.done || !r.value || typeof r.value !== 'object') return r;
        const uuid = crypto.randomUUID();
        remember(uuid, pushedText(r.value));
        return { value: Object.assign({}, r.value, { uuid }), done: false };
      },
      async return(v) {
        if (source && typeof source.return === 'function') return source.return(v);
        return { value: v, done: true };
      },
    };
  }

  function observe(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'result') { turnHasOutput = false; return; }
    if (msg.type === 'assistant' || msg.type === 'user') { turnHasOutput = true; return; }
    if (msg.type !== 'command_lifecycle' || msg.state === 'queued') return;
    const uuid = msg.command_uuid;
    if (!pending.has(uuid)) return;
    const text = pending.get(uuid);
    pending.delete(uuid);
    if (msg.state === 'started' && turnHasOutput && text) onJoined(text);
  }

  return { stamp, observe };
}

/**
 * The SDK query, unchanged except that iterating it also feeds `observe`. Every other member
 * (interrupt, setModel, close, …) is the query's own, bound to it.
 */
function observeQuery(query, observe) {
  return new Proxy(query, {
    get(target, prop) {
      if (prop === Symbol.asyncIterator) {
        return () => {
          const it = target[Symbol.asyncIterator]();
          return {
            [Symbol.asyncIterator]() { return this; },
            async next(v) {
              const r = await it.next(v);
              if (!r.done) {
                try { observe(r.value); } catch (_) { /* a watch failure never breaks the stream */ }
              }
              return r;
            },
            return(v) { return typeof it.return === 'function' ? it.return(v) : Promise.resolve({ value: v, done: true }); },
            throw(e) { return typeof it.throw === 'function' ? it.throw(e) : Promise.reject(e); },
          };
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

module.exports = { makeFoldWatch, observeQuery, PENDING_MAX };
