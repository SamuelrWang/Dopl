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

// ── THE ROOM ROSTER — WHO ELSE IS HERE, AT LAUNCH (2026-09-18) ────────────────────────────────
//
// ⚠ **IT IS THE READING HALF OF THE FOUR LINES ABOVE, MADE CONCRETE.** Those say how to address
// an agent; this says WHICH agents there are to address, whose each one is, and what role it is
// playing — so picking a collaborator costs no `dopl_channel(op="status")` call. Samuel's rule
// for the wave is that recipients and agents are *structurally conveyed*, and a roster an agent
// has to go and fetch is the case that makes collaboration unreliable.
//
// 🔒 ⚠ **FIXED SIZE, AND THE DEGRADE ORDER IS THE DESIGN.** A room can hold forty agents; a
// prompt block may not grow with it. Five of each kind, then a pointer; and when the block is
// still over {@link ROSTER_MAX_CHARS} the ROLE names go first (the richest text per unit of
// routing), then the PEOPLE line, and never the same-operator flag — which is the one fact that
// cannot be recovered by looking at a handle.
//
// ⚠ **IT SAYS "as of launch" BECAUSE IT IS A SNAPSHOT.** Agents start and end while a session
// runs. The clause plus the pointer is what stops an agent reading a stale list as the room's
// current state, and an agent that arrives LATER introduces itself: `session-seed.js` names an
// unknown agent author on the turn it writes.
const ROSTER_MAX_CHARS = 420;

function agentRow(a) {
  const whose = a.mine ? 'yours' : `${a.owner || 'another member'}'s`;
  return `- @${a.handle} · ${whose}`;
}

function rosterLines(roster, withRoles) {
  const r = roster || {};
  const agents = Array.isArray(r.agents) ? r.agents : [];
  const people = Array.isArray(r.people) ? r.people : [];
  if (!agents.length && !people.length && r.read !== 'failed') return [];
  const lines = [`IN THIS ROOM as of launch (live: dopl_channel op "status"):`];
  for (const a of agents) {
    const role = withRoles && a.role ? ` · ${a.role}` : '';
    lines.push(`${agentRow(a)}${role}`);
  }
  if (r.agentsMore > 0) lines.push(`- and ${r.agentsMore} more agents: dopl_channel op "status"`);
  if (people.length) {
    const tags = people.map((p) => `@${p.handle}`).join(', ');
    const more = r.peopleMore > 0 ? `, and ${r.peopleMore} more` : '';
    lines.push(`- people: ${tags}${more}`);
  }
  // ⚠ SAID OUT LOUD. An unread half is not an empty room, and an agent told nothing would read
  // the local half as the whole roster.
  if (r.read === 'failed') lines.push(`- others: not read; ask dopl_channel op "status"`);
  return lines;
}

/**
 * The roster block, inside its own budget. ⚠ Each fallback DROPS A WHOLE FACT — roles, then the
 * people line — so nothing is ever rendered as half of itself.
 */
function roomRosterLines(roster) {
  const withRoles = rosterLines(roster, true);
  if (!withRoles.length) return [];
  const withoutRoles = rosterLines(roster, false);
  const withoutPeople = withoutRoles.filter((l) => l.indexOf('- people: ') !== 0);
  for (const block of [withRoles, withoutRoles, withoutPeople]) {
    if (block.join('\n').length <= ROSTER_MAX_CHARS) return block;
  }
  // ⚠ THE LAST RESORT KEEPS THE FLAG: handles and whose each one is, nothing else.
  return withoutPeople.slice(0, 1 + (roster && roster.agents ? roster.agents.length : 0));
}

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
    ...roomRosterLines(c.roster),
  ];
}


module.exports = { agentIdentityFraming, roomRosterLines, ROSTER_MAX_CHARS };
