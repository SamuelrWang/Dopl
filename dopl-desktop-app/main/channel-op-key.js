// THE CHANNEL CALL'S CLASSIFICATION KEY — `<op>` or `<op>.<action>`, one spelling.
//
// ⚠ WHY THE ACTION IS PART OF THE KEY (2026-09-02, F-578). `dopl_channel` collapsed to five ops
// and two of them DISPATCH: `manage` (launch · end · rename · posture · direct) and `rooms`
// (list · open · invite · members · threads · thread_mode · update · help). `rooms` carries four
// reads and four writes, so a desktop predicate keyed on the op alone is either too wide — an
// own-channel READ allow that also opens and invites — or too narrow. The server's own gate
// already reads this grain (`packages/mcp-server/src/gating.ts › isWriteOp`, whose `WRITE_OPS`
// entries are `rooms.open` / `rooms.invite` / `rooms.thread_mode` / `rooms.update`), and the
// desktop's classifiers now ask the same question in the same shape.
//
// ⚠ ONE MODULE BECAUSE FOUR CALLERS ASK IT — the read set (`session-profiles.js`), the two
// own-machine lanes (`session-own-launch.js`, `session-own-direct.js`) and the explainer
// (`session-gate-reason.js`). A second spelling of "which call is this" is how a gate and the
// sentence describing it come to disagree, which is the defect `makeGateReason`'s whole
// injection idiom exists to prevent.
//
// ⚠ FAIL-SAFE IS THE NARROW KEY, NOT THE WIDE ONE. A call that names no `action` keys as the
// BARE op, so it matches only entries that are themselves bare. Every list here is an ALLOW
// list, so an unmatched key gates — the same direction `gating.ts › isWriteOp` takes from the
// other side, where an unmatched bare op is treated as a write.
function channelOpKey(input) {
  const i = input || {};
  const op = typeof i.op === 'string' ? i.op : '';
  if (!op) return '';
  const action = typeof i.action === 'string' ? i.action : '';
  return action ? `${op}.${action}` : op;
}

module.exports = { channelOpKey };
