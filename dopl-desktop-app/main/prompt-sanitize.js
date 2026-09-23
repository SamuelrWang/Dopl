// The NEUTRALIZERS: every rule for turning caller-supplied text into something that cannot forge a
// line of our framing. One answer for every prompt module (`prompt-framing.js` re-exports
// `sanitizeName` for `session-seed.js`). Pure.

// Strips the REQUEST fence tokens from a value spliced INLINE into a trusted line, TO A FIXED POINT
// (one pass would turn 'BEGINBEGIN-REQUEST-REQUEST' back into 'BEGIN-REQUEST'). Bodies are fenced
// with the line-exact `stripFence` instead.
function stripFenceTokens(value) {
  let out = String(value);
  for (;;) {
    const next = out.replace(/BEGIN-REQUEST|END-REQUEST/gi, '');
    if (next === out) return out;
    out = next;
  }
}

// A DISPLAY default, not a security bound — see `sanitizeText`.
const DISPLAY_MAX = 80;

// Collapse whitespace to single spaces and strip fence tokens; '' when nothing usable. The
// neutralization is the security part; `max` is a budget, and the caller passes the field's own
// server bound (F-287) so the two ends agree.
function sanitizeText(value, max) {
  const raw = typeof value === 'string' ? value : '';
  const cap = typeof max === 'number' && max > 0 ? max : DISPLAY_MAX;
  // U+0085 (NEL) explicitly: JS `\s` omits it, and a consumer treating it as a line break would see
  // a new line that reads as ours.
  return stripFenceTokens(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\s\u0085]+/g, ' ')
    .trim()
    .slice(0, cap)
    .trim();
}

// A counterparty display name: unbounded attacker-controlled text, so the display default applies.
function sanitizeName(name) {
  return sanitizeText(name, DISPLAY_MAX);
}

// A bounded id token (our own server UUIDs), stripped to id characters. ORDER: the character strip
// FIRST and the fence belt LAST, or "BEG@IN-REQUEST" would be reconstructed after the belt ran.
function idToken(value) {
  return stripFenceTokens(String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, ''))
    .slice(0, 64);
}

// Drop every line that exactly matches a fence delimiter, so an untrusted body cannot forge a fence.
// Variadic: a role body strips BOTH the ROLE and the REQUEST vocabularies (a forged REQUEST fence
// inside a role would forge a task in main's own voice).
function stripFence(text, ...delimiters) {
  const bad = delimiters.filter((d) => typeof d === 'string' && d !== '');
  return String(text == null ? '' : text)
    .split('\n')
    .filter((line) => bad.indexOf(line.trim()) === -1)
    .join('\n');
}

module.exports = {
  sanitizeText, // the neutralizer, at the caller's own field bound (F-287)
  sanitizeName, // …and its display-name default of 80
  idToken,
  stripFence,
};
