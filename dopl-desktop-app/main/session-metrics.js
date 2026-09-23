// The agent view's numbers, read from where they already live on the session: nothing here starts a
// counter, it only decides how to say "not measured" (null, never 0).

const sessionHealth = require('./session-health');

// ─── BEGIN SESSION-METRICS-PURE (injectable; unit-tested via source extraction) ──────

// `sessionHealth` is a free var from here down.

// `typeof` first: `Number(null)` and `Number('')` are 0, which would paint a confident zero.
function metricOrNull(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

// The window the runtime put on its last reading (`session-io.js`), or null; core holds no model table.
function reportedWindow(s) {
  const w = Number(s && s.promptWindow);
  return Number.isFinite(w) && w > 0 ? w : null;
}

/** The agent-view numbers plus the health half; `now` is injectable for the staleness clock. */
function metrics(s, now) {
  return {
    contextUsed: metricOrNull(s && s.promptTokens),
    contextWindow: reportedWindow(s),
    tokensSpent: metricOrNull(s && s.tokensSpent),
    startedAt: metricOrNull(s && s.startedAt),
    lastActivityAt: metricOrNull(s && s.lastActivityAt),
    ...sessionHealth.health(s, typeof now === 'number' ? now : Date.now()),
    // Why this session cannot work (F-692): an explanation, never a state — nothing may branch on it.
    diag: (s && typeof s.mcpDiag === 'string' && s.mcpDiag) || null,
  };
}
// ─── END SESSION-METRICS-PURE ────────────────────────────────────────────────────────

module.exports = { metricOrNull, metrics };
