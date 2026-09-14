// THE SUMMARY'S DISPLAY TEXT — one bounded, whitespace-collapsed line, and the one bound that is
// not the default.
//
// ⚠ ITS OWN FILE SINCE 2026-09-13, AND THE SEAM IS §1's: `session-summary.js` answers "which
// sessions exist and what rides with each" and moves when the projection grows a field; this
// answers "how does counterparty-influenced text reach a renderer" and moves when a BOUND moves.
// The split was forced by the agent-colour field — that file sat exactly AT the 500-line cap, and
// INVARIANTS §1's own rule is that a file at 500 cannot absorb a comment, let alone a member.
//
// ⚠ PURE, AND IT HAS TO BE: `session-summary.js` requires this ABOVE its BEGIN sentinel, so the
// source-extraction harness (`test/_session-summary-harness.mjs`) injects it. Nothing here may
// reach electron, the network or a store.
//
// ⚠ IT IS NOT `session-telemetry.js › labelOrNull` AND MUST NOT BE MERGED WITH IT. That one adds
// the SERVER's charset on top of the collapse, because its output is about to be INSERTed into a
// checked column; this one is for a renderer. Two readers, two rules, and the day they merge is
// the day a display bound starts refusing a push or a push starts painting a control character.

/**
 * Display string for the wire: one line, whitespace collapsed, bounded, or null. ⚠ Same
 * discipline as session-store's `durableName`: channel name and thread title are
 * counterparty-influenced text on their way to a renderer.
 * ⚠ THE BOUND IS A PARAMETER SINCE 2026-08-22, defaulting to the 80 every existing caller had.
 * `templateName` takes 120 — the COLUMN's bound on both ends — because clipping an identity to
 * fit a display default would report a name no template has.
 */
function displayText(value, max = 80) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || null;
}

/** The AGENT TEMPLATE a session runs as, as a NAME and never an id. `null` for a blank agent. */
const TEMPLATE_NAME_MAX = 120;

module.exports = { displayText, TEMPLATE_NAME_MAX };
