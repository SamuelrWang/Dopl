// THE LAUNCH CONTRACT, CHECKED AGAINST WHAT THE CLI SAYS IT IS RUNNING (2026-10-08, SDK resilience #1).
//
// Every Dopl restriction on a Claude session is an option the CLI is TRUSTED to apply: the permission
// mode that makes it call Dopl's gate (`permissionMode: 'default'`, `launch-spec.js`), the positive
// built-in bound (`tools`), the deny list (`disallowedTools`), and the MCP servers it may reach. A CLI
// build that renamed, dropped or reinterpreted one of them would run with that restriction silently off.
// So the CLI's own `system/init` report — the permission mode it is in, every tool it OFFERS the model —
// is compared with what this launch asked for, BEFORE the first turn can call anything. A mismatch that
// gets past Dopl's gate ENDS the session (fail closed); one the gate still holds is recorded as drift
// (`verifyInit`). An init that does not report what is checked refuses: unverifiable is not safe.
//
// Measured 2026-10-08 on runtime 0.3.293 (claude 2.1.293), Dopl's options and scrubbed env: `init`
// reports `permissionMode: "default"`, `tools` = exactly the `tools` bound (deny-listed names absent),
// and no MCP server Dopl did not configure. Pure.

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const names = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

// `mcp__<server>__<tool>`: the CLI spells a server key with every character outside [A-Za-z0-9_-] as `_`.
const serverToken = (key) => str(key).replace(/[^A-Za-z0-9_-]/g, '_');
const MCP_PREFIX = 'mcp__';

/**
 * What this launch asked for, read off the options `launch-spec.js` hands the SDK (after every
 * modifier, operator tools included). `strictServers` is false when the operator's own servers are
 * loaded ("Use my tools"): their names are the operator's, and the gate judges every call per turn.
 */
function contractOf(options, opts) {
  const o = options || {};
  return {
    permissionMode: str(o.permissionMode) || null,
    // `null` = no positive bound was set (none is today; every profile bounds — `tools.js`).
    tools: Array.isArray(o.tools) ? names(o.tools) : null,
    // Bare names only: a `Read(~/.ssh/**)` rule narrows a tool, it does not remove it.
    denied: names(o.disallowedTools).filter((n) => n.indexOf('(') === -1),
    servers: Object.keys(o.mcpServers || {}).map(serverToken).filter(Boolean),
    strictServers: !(opts && opts.operatorTools),
  };
}

/**
 * `{ refuse: [reason], drift: [reason] }` for one init. REFUSE only what gets PAST Dopl's gate:
 *   - the permission mode is not the one that makes the CLI call the gate (or is not reported);
 *   - a deny-listed tool is offered (the deny list is the hard layer the gate does not repeat);
 *   - the tool list is not reported (nothing above can be checked).
 * DRIFT (recorded, never refused) is what the gate still holds: a built-in offered outside the bound,
 * or a tool from a server Dopl did not configure. In permission mode "default" the CLI asks Dopl's
 * gate for any tool that is not pre-approved, and an unclassified name gates in every mode.
 * ⚠ MEASURED WHY (2026-10-08, 0.3.293): `full` offers `TaskStop`, which no Dopl list names (the
 * CLI's successor to `KillShell`). Refusing it would have stopped every full-profile launch.
 */
function verifyInit(init, contract) {
  const c = contract || {};
  const msg = init || {};
  const refuse = [];
  const drift = [];
  if (c.permissionMode) {
    const mode = str(msg.permissionMode);
    if (!mode) refuse.push('the runtime did not report its permission mode');
    else if (mode !== c.permissionMode) refuse.push(`the runtime is in permission mode "${mode}", not "${c.permissionMode}"`);
  }
  if (!Array.isArray(msg.tools)) {
    refuse.push('the runtime did not report the tools it offers');
    return { refuse, drift };
  }
  const denied = new Set(c.denied || []);
  const bound = Array.isArray(c.tools) ? new Set(c.tools) : null;
  const deniedOffered = [];
  const unbound = [];
  const foreign = [];
  for (const t of names(msg.tools)) {
    if (denied.has(t)) deniedOffered.push(t);
    else if (t.startsWith(MCP_PREFIX)) {
      if (c.strictServers && !(c.servers || []).some((s) => t.startsWith(`${MCP_PREFIX}${s}__`))) foreign.push(t);
    } else if (bound && !bound.has(t)) unbound.push(t);
  }
  if (deniedOffered.length) refuse.push(`the runtime offers tools this launch denied (${shown(deniedOffered)})`);
  if (unbound.length) drift.push(`built-ins offered outside the launch bound: ${shown(unbound)}`);
  if (foreign.length) drift.push(`tools from servers this launch did not configure: ${shown(foreign)}`);
  return { refuse, drift };
}

function shown(list) {
  return list.slice(0, 5).join(', ') + (list.length > 5 ? `, +${list.length - 5} more` : '');
}

/** The sentence the session ends with, or null when nothing refuses. */
function mismatchSentence(init, contract) {
  const { refuse } = verifyInit(init, contract);
  if (!refuse.length) return null;
  return `Dopl ended this session before it could act: ${refuse.join('; ')}. `
    + 'Running it would have left one of Dopl\'s restrictions off.';
}

module.exports = { contractOf, verifyInit, mismatchSentence, serverToken };
