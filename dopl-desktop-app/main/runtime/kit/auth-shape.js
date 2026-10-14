// Is this error text the vendor telling us the credential was refused? The SPELLING an adapter's
// `normalize.js` uses to decide (docs/specs/runtime-scaffold.md §3 K5). Pure, vendor-neutral. The adapter
// still makes the decision and core trusts its verdict; the kit only holds the pattern.
//
// A pattern, not a sentence. Over-matching is the safe direction: a false positive parks the session and
// offers sign-in (recoverable); a false negative renders a dead-end bubble.
const AUTH_SHAPED_RE = /\b(401|403)\b|unauthor(?:ised|ized)|not\s+logged\s+in|log\s*in\s+required|login\s+required|authentication\s+(?:failed|required)|invalid\s+(?:api\s+)?(?:key|token)|expired\s+(?:credential|token)/i;

/** True when `text` reads as a refused credential. `extraRe` adds the vendor's own spellings (an env
 *  var name in its signed-out message, say) as one more alternative. */
function authShaped(text, extraRe) {
  const t = String(text == null ? '' : text);
  return AUTH_SHAPED_RE.test(t) || (extraRe instanceof RegExp && extraRe.test(t));
}

module.exports = { AUTH_SHAPED_RE, authShaped };
