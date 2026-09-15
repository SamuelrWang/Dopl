'use strict';

// WHO THIS AGENT IS, AND HOW IT NAMES A PEER — the standing identity block
// (§2 split out of `prompt-framing.js` on 2026-09-15, at the 500-line cap).
//
// ⚠ PURE + electron-free, like the module it came from and for the same reason: the truth tables
// `require` it directly. In particular it may NOT require `agent-names.js`, which is
// electron-store backed — which is why the agent's own NAME arrives as an optional `ctx` field
// rather than being looked up here.
//
const { AGENT_ID_RE } = require('./agent-id');

// ── THIS AGENT'S OWN ID (2026-08-21; the claim protocol deleted 2026-09-02) ────────────────
//
// One line. It is the id the agent signs with and the id a peer addresses it by, and there is
// nothing else a session needs told about who else is in the room.
//
// ⚠ **THE ~870-CHARACTER VOLUNTARY CLAIM PROTOCOL IS DELETED, AND THE FAN-OUT PAID FOR IT**
// (v2 wave B, G13's other half). It read: a message naming no agent id is not automatically
// yours · check whether a sibling has already claimed it · CLAIM IT IN ONE SHORT LINE first ·
// COORDINATE IN THE OPEN · other sessions may be active as the same person. Every sentence of it
// answers ONE question — "is this message mine?" — which the agent had to answer by hand because
// an unaddressed message was handed to EVERY live agent on the thread.
//
// **That question is now answered before the message is sent.** The server resolves the recipient
// at write time and stores the verdict on the row (`service-wake-verdict.ts`, RR1/RR2/RR3), and
// the desktop feeds only that recipient (`session-dispatch.js`). A session that was not named is
// not fed; a message that resolves to nobody wakes nobody. So the protocol asked a live session
// to re-derive, in prose, a fact the row already carried — and it is the same defect the deleted
// per-turn stand-down preamble was (`session-seed.js › addressingLines`), one scope up.
//
// ⚠ **IT WAS ALSO MEASURED NOT TO WORK.** The 2026-08-22 note recorded the reason the default was
// flipped in the first place: across 40 real messages in live testing the claim protocol fired
// ZERO times and every sibling answered everything. A rule no agent ever executed is not a fence;
// deleting it removes prose, not enforcement — and what enforcement there is has moved into the
// server, where it does not depend on a model's discipline.
//
// ⚠ WHAT MUST NOT COME BACK: a sentence here that tells an agent to decide whether a message is
// for it. If addressing is ever wrong, the fix is the verdict, not a paragraph asking the reader
// to double-check the delivery it just received.
// ── ⚠ AND WHAT THE ID IS *FOR* (Samuel, 2026-09-15) ──────────────────────────────────────────
//
// Verbatim: *"that ID is only internal for agents to be able to differentiate and for agents to
// see. But they don't need to be telling that or posting the id in the channel, in fact its a bad
// user experience. … In messages the agents should address by the tag which would be the name."*
//
// ⚠ **THE FOURTH LINE CARRIED A CARVE-OUT FOR ONE HOUR AND DOES NOT ANY MORE.** Samuel's first
// ruling that day ended *"the only time the agent id should be used in a sent message, is only if
// there is actually two agents with the exact same name that are active"*, so this block told the
// agent to reach for `@agent-<id>` in that case. His second ruling removed the CASE: *"no two
// agents that are addressable can have the same name … it will automatically auto-resolve to
// coder-1."* The rule is enforced at COMMIT (`main/agent-name-unique.js`), so there is nothing
// left to disambiguate — and a line teaching an id "for the rare case" is a line an agent will
// use in the common one.
//
// ⚠ THE LINE SAID ONLY `YOUR AGENT ID IS <id>.` AND THAT IS WHY IT LEAKED. An agent told its id
// and nothing else signs with it, quotes it back at its operator and writes it into channel posts
// — every one of which puts eight machine characters in front of a person. The id is still HERE,
// because the agent genuinely needs it (the server routes on it, the stamp carries it, and it is
// the disambiguator for the one case below); what it gains is its BOUNDARY.
//
// ⚠ IT IS TWO SHORT LINES AND MUST STAY SHORT. This is the third time a paragraph has been
// proposed for this spot; the two before it (the claim protocol, the per-turn stand-down) were
// both deleted for being prose an agent had to re-derive a fact the system already knew. What
// survives is a FACT and a PROHIBITION, which is the smallest shape that can be followed.
//
// ⚠ THE NAME IS SPOKEN ONLY WHEN THE CALLER SUPPLIES ONE. `ctx.agentName` is optional and this
// module is PURE — it may not require `agent-names.js`, which is electron-store backed — so a
// caller that has the name passes it and one that does not gets the shorter line. Inventing a
// name here, or asserting the agent "has none", would both be claims this module cannot check.
// ⚠ **AND WHEN IT IS SUPPLIED IT IS THE STORED NAME, SUFFIX AND ALL.** An agent launched as the
// second "Coder" is `Coder-1`, and that is the tag peers will use for it — telling it the name it
// was ASKED to have would leave it correcting people who addressed it correctly.
function agentIdentityFraming(ctx) {
  const c = ctx || {};
  const mine = AGENT_ID_RE.test(String(c.agentId || '')) ? String(c.agentId) : '';
  if (!mine) return [];
  const named = typeof c.agentName === 'string' ? c.agentName.trim() : '';
  return [
    named ? `YOU ARE "${named}". YOUR AGENT ID IS ${mine}.` : `YOUR AGENT ID IS ${mine}.`,
    `THE ID IS INTERNAL: read it, never write it in a message.`,
    `ADDRESS AN AGENT BY ITS NAME, as a tag: lower case, spaces as dashes (@bug-reviewer).`,
    `Names are unique among live agents, so a tag reaches exactly one.`,
  ];
}


module.exports = { agentIdentityFraming };
