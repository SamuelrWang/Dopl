// The summary's display text: one bounded, whitespace-collapsed line. Pure (the summary harness injects it).

/** Counterparty-influenced text on its way to a renderer: one line, collapsed, bounded, or null. Not
 *  `session-telemetry.js › labelOrNull`, which adds the server's charset for a checked column. */
function displayText(value, max = 80) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || null;
}

// The identity name's bound is the column's (120), not the 80 display default.
const IDENTITY_NAME_MAX = 120;

module.exports = { displayText, IDENTITY_NAME_MAX };
