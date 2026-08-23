// THE NEUTRALIZERS — every rule for turning caller-supplied text into something that cannot
// forge a line of OUR framing. One subject; the function count is this file's export list.
//
// ⚠ SPLIT OUT OF `main/prompt-framing.js` ON 2026-08-22, under the hard 500-line §1 cap, when
// the TEMPLATE ROLE block landed. That file sat at 499: it could not absorb the two lines the
// splice needed, let alone the comment explaining them, and INVARIANTS §1's rule for that state
// is explicit — a file at the cap stops being CORRECTABLE, so the answer is a split, never a
// terser edit.
//
// ⚠ BUT THE SEAM IS NOT ARITHMETIC, AND THE NEW CONSUMER IS THE PROOF.
// `prompt-framing-template.js` renders a template's name, its custom fields and its attached
// knowledge-base names into a turn, and every one of those is caller-supplied text that must
// pass the SAME neutralizer the counterparty framing passes. Left in `prompt-framing.js` these
// were module-private, so the new module's only options were to import from a peer that does
// not export them or to write a SECOND `sanitizeName` — and a second answer to "what may open a
// line" is precisely the class of bug the `idToken` ordering comment below was bought by. One
// module, one answer, two consumers.
//
// THE SEAM IN ONE SENTENCE: this file changes when the NEUTRALIZATION RULES change (a new line
// terminator a runtime treats as a break, a third fence vocabulary, a different bound);
// `prompt-framing.js` changes when a turn's ASSEMBLY changes; `prompt-framing-text.js` changes
// when the COPY changes.
//
// PURE — no electron / fs / path — so every truth table `require`s it directly.
// ⚠ `prompt-framing.js` RE-EXPORTS `sanitizeName` verbatim, because `session-seed.js` reaches it
// as `framing.sanitizeName` and a split must not move a caller's import.

// ⚠ The fence-token strip must run TO A FIXED POINT. One pass is a single substitution:
// 'BEGINBEGIN-REQUEST-REQUEST' loses the inner match and LEAVES 'BEGIN-REQUEST' behind,
// reconstructing the token. Loop until stable (it shrinks every iteration, so it terminates).
//
// ⚠ IT STRIPS THE REQUEST VOCABULARY ONLY, AND THAT IS DELIBERATE. `BEGIN-ROLE` / `END-ROLE`
// and `BEGIN-OPERATOR` / `END-OPERATOR` are stripped LINE-EXACT by `stripFence` at the point
// the body is fenced, which is the right tool for a body; this one exists for values spliced
// INLINE into a trusted line, where a substring is enough to do damage.
function stripFenceTokens(value) {
  let out = String(value);
  for (;;) {
    const next = out.replace(/BEGIN-REQUEST|END-REQUEST/gi, '');
    if (next === out) return out;
    out = next;
  }
}

// The default bound. ⚠ IT IS A **DISPLAY** DEFAULT, not a security one — see `sanitizeText`.
const DISPLAY_MAX = 80;

// Neutralize caller-supplied text and bound it AT THE BOUND ITS OWN FIELD CARRIES: collapse
// newlines/tabs/whitespace runs to one space, strip BEGIN-REQUEST / END-REQUEST (any case). ''
// when nothing usable, so callers can substitute a generic label.
//
// ⚠ **THE NEUTRALIZATION IS THE SECURITY PART; THE LENGTH IS NOT** (F-287, 2026-08-23). What stops
// a value forging a line of our framing is the collapse and the fence-token strip, and neither
// depends on `max`. The cap is a BUDGET — how much prose one field may spend inside a trusted
// line — so it belongs to the FIELD, not to the neutralizer. `sanitizeName` hard-coded 80 because
// it was written for `display_name`; every later consumer inherited a display default as if it
// were a rule, and a template field value whose real server bound is 1000 was rendered into the
// ROLE block at 8% of it, silently, with every surface around it still showing the whole thing.
// ⚠ THE CALLER PASSES THE FIELD'S OWN SERVER BOUND, so the two ends agree by construction. A
// bound this function invents is one the writer never enforced and the reader cannot predict.
function sanitizeText(value, max) {
  const raw = typeof value === 'string' ? value : '';
  const cap = typeof max === 'number' && max > 0 ? max : DISPLAY_MAX;
  // ⚠ U+0085 (NEL) must be in the collapse class EXPLICITLY: JS `\s` covers U+2028 / U+2029 but
  // NOT U+0085, so a NEL survives every pass into the TRUSTED preamble above the fence
  // (session-seed.frameContinuation interpolates the name there), where any consumer treating
  // NEL as a line break sees a NEW LINE that reads as ours. Everything that can start a line
  // has to die here.
  return stripFenceTokens(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\s\u0085]+/g, ' ')
    .trim()
    .slice(0, cap)
    .trim();
}

// The DISPLAY-NAME case: `sanitizeText` at 80.
//
// ⚠ 80 IS THE RIGHT NUMBER **HERE** — a counterparty `display_name` is unbounded
// attacker-controlled text with no server bound of its own, and the cap is what limits how much
// prose an injected "name" can smuggle into a trusted framing line. It is the WRONG number for a
// field that carries a real bound; those callers spend `sanitizeText(value, <that bound>)`.
function sanitizeName(name) {
  return sanitizeText(name, DISPLAY_MAX);
}

// A bounded ID token. channelId / workspaceId are OUR OWN server-row UUIDs (from the spawn spec,
// never counterparty text), so they skip sanitizeName — a UUID is not a display name. Still
// stripped to id characters and capped, so a malformed value cannot open a line of its own inside
// the framing. '' when nothing usable.
// ⚠ ORDER: id-character strip FIRST, fence belt LAST. Reversed, "BEG@IN-REQUEST" survives the belt
// (not yet a fence token), then the strip removes "@" and RECONSTRUCTS "BEGIN-REQUEST". The belt
// must be the last thing that runs to be a belt at all.
function idToken(value) {
  return stripFenceTokens(String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, ''))
    .slice(0, 64);
}

// ⚠ Remove any line that exactly matches a fence delimiter, so an attacker cannot forge the
// fence from inside the untrusted message body. Same rule as session-spawner.stripDelimiters,
// re-homed so buildFencedTurn stays self-contained and electron/fs-free.
//
// ⚠ IT TAKES A VARIADIC DELIMITER LIST SINCE 2026-08-22, because the TEMPLATE ROLE body has to
// have TWO vocabularies stripped from it, not one. A template's `instructions` are another
// member's text landing inside `BEGIN-ROLE-<nonce>`, and a line forging `BEGIN-REQUEST-<nonce>`
// there would close the role fence and reopen the GOAL fence — i.e. forge a task in main's own
// voice. `session-seed.js › frameOperatorTurn` strips both vocabularies for exactly that reason
// and states the argument; this is that rule made reusable rather than written a third time.
// The old two-argument call shape is unchanged: extra delimiters are simply extra members.
function stripFence(text, ...delimiters) {
  const bad = delimiters.filter((d) => typeof d === 'string' && d !== '');
  return String(text == null ? '' : text)
    .split('\n')
    .filter((line) => bad.indexOf(line.trim()) === -1)
    .join('\n');
}

module.exports = {
  stripFenceTokens,
  sanitizeText, // 2026-08-23: the same neutralizer, at the caller's own field bound (F-287)
  sanitizeName, // …and its display-name default of 80
  DISPLAY_MAX,
  idToken,
  stripFence,
};
