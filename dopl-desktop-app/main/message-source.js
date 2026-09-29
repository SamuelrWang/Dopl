// WHICH DEVICE A MEMBER WROTE FROM — the server-stamped `metadata.source` (docs/specs/
// device-aware-messages.md), as one line of OUR narration above a fed message's fence, plus the
// glasses reply guidance. ⚠ THE GUIDANCE IS A RESTATEMENT: the one copy is
// `packages/mcp-server/src/tools/channel-source.ts › GLASSES_REPLY_GUIDANCE`, held byte-equal by
// test/inbound-reply-address.test.mjs. The label is the member's own device name, so it is sanitized.

const { sanitizeName } = require('./prompt-sanitize');

const GLASSES_REPLY_GUIDANCE =
  "They are on glasses: reply in at most ~5 short plain-text lines (no tables, code or long lists). " +
  "Choices or structure: dopl_show (it reaches the lens). " +
  "Don't ask for what glasses can't do (approve permissions, open files, paste, type long text): do it later on their computer, or say so briefly.";

const KINDS = ['glasses', 'computer', 'web', 'phone'];

// `null` for no stamp / an unknown kind; else `Sent via glasses (Even G2).` (+ guidance for glasses).
function sourceNote(source) {
  if (!source || typeof source !== 'object' || KINDS.indexOf(source.kind) === -1) return null;
  const label = source.kind === 'web' ? '' : sanitizeName(typeof source.label === 'string' ? source.label : '');
  const line = `Sent via ${source.kind}${label ? ` (${label})` : ''}.`;
  return source.kind === 'glasses' ? `${line} ${GLASSES_REPLY_GUIDANCE}` : line;
}

// The author note and the source note, one per line; null when neither.
function withSourceNote(authorNote, source) {
  const notes = [authorNote, sourceNote(source)].filter(Boolean);
  return notes.length ? notes.join('\n') : null;
}

module.exports = { GLASSES_REPLY_GUIDANCE, withSourceNote };
