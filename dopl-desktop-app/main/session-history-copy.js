// Every operator-facing string a reopened shell's channel history can produce, and the two
// builders that assemble the FIX N1 counts.
//
// Split out of main/session-history.js to respect the HARD 500-line-per-file cap (§2) when FIX N1
// added the "what was withheld" copy — the same discipline as the session-io / session-seed and
// session-viewmodel / session-history-vm splits. session-history.js re-exports every constant
// below verbatim, so `NO_PEER_NOTE` and friends are unchanged for its callers and its tests.
//
// PURE and dependency-free: strings and string assembly only, no session object, no electron, no
// fs. session-history.js requires it ABOVE its BEGIN/END PURE sentinel and references it as the
// free var `copy`, so the source-extraction harness injects the REAL module — the copy under test
// is the copy that ships.
//
// COPY RULES (product voice): plain sentences, no em dash, never a claim the read cannot support.
// That last one is the whole point of this file: a notice about hidden messages must not assert
// WHOSE they were unless the read actually knows.

const FETCH_FAILED_NOTE = 'Could not load earlier messages.';
// FIX F4 / FIX N1: a shell with NEITHER a bound counterparty NOR a resolvable operator id cannot
// lane a single row honestly, so it paints NO history at all and says where to read it instead.
// (The same pointer serves a task whose span fell out of the fetched page.)
const NO_PEER_NOTE = 'Earlier messages are in the channel thread.';
// FIX N1: the two one-sided windows. A thread in a GROUP channel has no counterparty at all
// (channel-context resolves one for direct channels only), and an identity lookup can fail; in
// both cases the window still shows the side it CAN attribute, and has to say so.
const NO_PEER_PARTIAL_NOTE = 'This window has no counterparty, so it shows only your own messages.';
const NO_SELF_PARTIAL_NOTE = 'This window could not confirm which messages are yours, so it shows only the counterparty side.';

// The count, attributed no further than the window can honestly attribute it. With the operator's
// own id resolved, everything the author rule dropped really IS someone else's. Without it every
// row fails the 'me' test, so the OPERATOR'S OWN messages are among the drops and the sentence
// must claim nothing about whose they are.
function hiddenCount(n, knowSelf) {
  if (n === 1) {
    return knowSelf
      ? '1 earlier message from another channel member is not shown here.'
      : '1 earlier message is not shown here.';
  }
  return knowSelf
    ? `${n} earlier messages from other channel members are not shown here.`
    : `${n} earlier messages are not shown here.`;
}

// The WINDOW's line. With both ids the count is the whole story. With one of them missing the
// operator also has to be told WHY the window is one-sided, or a complete-looking half of a
// conversation is exactly the lie FIX N1 exists to remove. session-history.load never reaches
// this with NEITHER id (it takes the NO_PEER_NOTE branch first), so the unknown-self case always
// means "the counterparty side is what survived".
function hiddenNote(n, hasPeer, hasSelf) {
  if (!(n > 0)) return '';
  const count = hiddenCount(n, hasSelf);
  if (!hasSelf) return `${NO_SELF_PARTIAL_NOTE} ${count}`;
  if (!hasPeer) return `${NO_PEER_PARTIAL_NOTE} ${count}`;
  return count;
}

// The SEED's copy of the same truth, as one history ENTRY. It rides as a transcript LINE rather
// than as preamble because the fence's trusted preamble is session-seed.frameHistorySeed's, and
// this wave does not touch that file; `historyTranscript` renders `from: text`, so the note reads
// as an annotation rather than as anyone's words. session-history appends it LAST on purpose: the
// seed transcript is truncated from the HEAD (SEED_CAP keeps the tail), so a leading note would be
// the first thing a long thread dropped. It is stashed only, never emitted, so no such bubble is
// ever painted.
function hiddenSeedEntry(n, knowSelf) {
  return { from: 'Note', text: hiddenCount(n, knowSelf), lane: 'me', agent: false };
}

module.exports = {
  FETCH_FAILED_NOTE,
  NO_PEER_NOTE,
  NO_PEER_PARTIAL_NOTE,
  NO_SELF_PARTIAL_NOTE,
  hiddenCount,
  hiddenNote,
  hiddenSeedEntry,
};
