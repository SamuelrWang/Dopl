// The four catalog states (INVARIANTS §11 — unknown is not empty; collapsing any two is the bug). Shared by
// `model-catalog.js` (the cache) and `catalog-readers.js` (the pure readers). Requires nothing.
const STATUS = Object.freeze({
  READY: 'ready',
  LOADING: 'loading',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

module.exports = { STATUS };
