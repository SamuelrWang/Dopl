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

// ── THIS AGENT'S OWN ID, AND WHAT IT IS FOR ──────────────────────────────────────────────────
//
// Samuel, 2026-09-15: *"that ID is only internal for agents to be able to differentiate and for
// agents to see. But they don't need to be telling that or posting the id in the channel, in fact
// its a bad user experience. … In messages the agents should address by the tag which would be
// the name."*
//
// 🔒 **WHAT MUST NOT COME BACK: a sentence here that tells an agent to decide whether a message
// is for it.** Two such paragraphs have been deleted (the ~870-character voluntary claim protocol
// and the per-turn stand-down preamble) because the server now resolves the recipient at write
// time and stores the verdict on the row (`service-wake-verdict.ts`), and the desktop feeds only
// that recipient (`session-dispatch.js`). The claim protocol was also measured: across 40 real
// messages in live testing it fired ZERO times. If addressing is ever wrong, the fix is the
// verdict, not prose asking the reader to double-check the delivery it just received.
//
// ⚠ **NO ID CARVE-OUT FOR DUPLICATE NAMES** (Samuel's second ruling the same day): names are
// unique among addressable agents, enforced at COMMIT (`main/agent-name-unique.js`), so there is
// nothing left to disambiguate — and a line teaching an id "for the rare case" is a line an agent
// will use in the common one.
//
// ⚠ **IT IS SIX SHORT LINES AND MUST STAY SHORT** — a FACT and a PROHIBITION is the smallest
// shape that can be followed.
//
// ⚠ **THE LAST TWO LINES ARE WHO THE COUNTERPARTY IS, ADDED 2026-09-18 (A2/S45).** They are the
// reading half of the same rule the first four are the writing half of, and each names a label
// the MCP read really prints: `packages/mcp-server/src/tools/channel-render-identity.ts ›
// formatAuthor` renders `agent @x for you` for a SIBLING — another session this same operator
// launched — and `outside session for you` for the operator's own Claude Code / Codex / Cursor
// connection. Without them the agent has the label and no rule for it, which is the lookup this
// wave exists to delete. ⚠ **`@desktop` IS THE GROUP HANDLE FOR THOSE OUTSIDE SESSIONS** and is
// minted on a sibling branch (`OUTSIDE_SESSION_HANDLE`); the two land together.
//
// ⚠ THE NAME IS SPOKEN ONLY WHEN THE CALLER SUPPLIES ONE. `ctx.agentName` is optional and this
// module is PURE, so a caller that has the name passes it; inventing one here, or asserting the
// agent "has none", would both be claims this module cannot check. ⚠ **AND IT IS THE STORED
// NAME, SUFFIX AND ALL** — an agent launched as the second "Coder" is `Coder-1`, which is the tag
// peers will use for it.
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
    `"for you" on an agent line means YOUR operator's agent; another name means another member's.`,
    `"outside session" is your operator's own coding session: address it @desktop, in full detail.`,
  ];
}


module.exports = { agentIdentityFraming };
