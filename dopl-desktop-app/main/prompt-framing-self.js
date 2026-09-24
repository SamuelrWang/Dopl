'use strict';

// WHO THIS RUNNING AGENT IS, AND HOW IT NAMES A PEER — the standing identity block and the room
// roster. Pure: the agent's own name arrives as `ctx.agentName` (agent-names.js is electron-backed).
// Must NOT come back: a sentence asking an agent to decide whether a message is for it — the server
// resolves the recipient (`service-wake-verdict.ts`) and the desktop feeds only that one; nor an
// id carve-out for duplicate names (names are unique at commit, `agent-name-unique.js`).
// Keep it to a few short lines: a fact and a prohibition is the shape an agent follows.

const { AGENT_ID_RE } = require('./agent-id');
const { doplCall } = require('./dopl-call-text');

// The roster block's budget. Fixed size; its degrade order is roles, then the people line, never the
// same-operator flag (the one fact a handle cannot carry). It says "as of launch": a snapshot.
const ROSTER_MAX_CHARS = 420;

function agentRow(a) {
  const whose = a.mine ? 'yours' : `${a.owner || 'another member'}'s`;
  return `- @${a.handle} · ${whose}`;
}

function rosterLines(roster, withRoles, set) {
  const status = doplCall(set, 'channel.status', '', true);
  const r = roster || {};
  const agents = Array.isArray(r.agents) ? r.agents : [];
  const people = Array.isArray(r.people) ? r.people : [];
  if (!agents.length && !people.length && r.read !== 'failed') return [];
  const lines = [`IN THIS ROOM as of launch (live: ${status}):`];
  for (const a of agents) {
    const role = withRoles && a.role ? ` · ${a.role}` : '';
    lines.push(`${agentRow(a)}${role}`);
  }
  if (r.agentsMore > 0) lines.push(`- and ${r.agentsMore} more agents: ${status}`);
  if (people.length) {
    const tags = people.map((p) => `@${p.handle}`).join(', ');
    const more = r.peopleMore > 0 ? `, and ${r.peopleMore} more` : '';
    lines.push(`- people: ${tags}${more}`);
  }
  // An unread half is said out loud, never shown as an empty room.
  if (r.read === 'failed') lines.push(`- others: not read; ask ${status}`);
  return lines;
}

/** The roster within its budget; each fallback drops a WHOLE fact, never half of one. */
function roomRosterLines(roster, set) {
  const withRoles = rosterLines(roster, true, set);
  if (!withRoles.length) return [];
  const withoutRoles = rosterLines(roster, false, set);
  const withoutPeople = withoutRoles.filter((l) => l.indexOf('- people: ') !== 0);
  for (const block of [withRoles, withoutRoles, withoutPeople]) {
    if (block.join('\n').length <= ROSTER_MAX_CHARS) return block;
  }
  return withoutPeople.slice(0, 1 + (roster && roster.agents ? roster.agents.length : 0));
}

/**
 * The agent's own id line (read, never written in a message), how to tag an agent, and the legend for
 * the MCP read's `for you` / `outside session` labels (`channel-render-identity.ts › formatAuthor`).
 */
function agentSelfFraming(ctx) {
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
    ...roomRosterLines(c.roster, c.toolSet),
  ];
}

module.exports = { agentSelfFraming, roomRosterLines, ROSTER_MAX_CHARS };
