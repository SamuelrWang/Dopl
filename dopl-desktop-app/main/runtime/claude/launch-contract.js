// THE LAUNCH CONTRACT, CHECKED AGAINST WHAT THE CLI SAYS IT IS RUNNING (2026-10-08, SDK resilience #1).
//
// Every Dopl restriction on a Claude session is an option the CLI is TRUSTED to apply: the permission
// mode that makes it call Dopl's gate (`permissionMode: 'default'`, `launch-spec.js`), the positive
// built-in bound (`tools`), the deny list (`disallowedTools`), and the MCP servers it may reach. A CLI
// build that renamed, dropped or reinterpreted one of them would run with that restriction silently off.
// So the CLI's own `system/init` report — the permission mode it is in, every tool it OFFERS the model —
// is compared with what this launch asked for, BEFORE the first turn can call anything. Any mismatch ENDS
// the session (fail closed), an init that does not report what is checked refuses, and until a report
// checks out the gate denies every call (`launch-spec.js › untilVerified`).
//
// Measured 2026-10-08 on runtime 0.3.293 (claude 2.1.293), Dopl's options and scrubbed env: `init`
// reports `permissionMode: "default"`, `tools` = exactly the `tools` bound (deny-listed names absent),
// and no MCP server Dopl did not configure. Pure.
// ⚠ RE-MEASURED 2026-10-09 (claude 2.1.287 / 2.1.295 / 2.1.296, identical): the 10-08 run had NO credential,
// so no Dopl server was configured (`loader.js › buildMcpServers` returns {}) and the gap below never showed.
// `init` reports some bound names under ANOTHER SPELLING (`REPORTED_AS`): it canonicalizes legacy names, and
// still reports `Agent` as `Task`. The resource pair is offered only while a CONNECTED server publishes
// resources — Dopl's own always does (`packages/mcp-server/src/resources.ts`) — so every signed-in `full` /
// `channel_agent` launch refused (2026-10-09, listener.log); `Task` only with "Use my tools" (`Agent`).

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const names = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

// `mcp__<server>__<tool>`: the CLI spells a server key with every character outside [A-Za-z0-9_-] as `_`.
const serverToken = (key) => str(key).replace(/[^A-Za-z0-9_-]/g, '_');
const MCP_PREFIX = 'mcp__';

// A bound name → the name(s) `init` reports it as (MEASURED 2026-10-09, see the header; the CLI's alias table
// holds more, but only these were seen). Each widens only a bound that already holds its key: `Task` is
// accepted only where `Agent` was asked for ("Use my tools"), the resource pair only where `full` /
// `channel_agent` bound `ListMcpResources` / `ReadMcpResource` (`tools.js › BYPASS_READS`). The deny list is
// read through the same table and checked FIRST, so a denied name stays refused under either spelling.
const REPORTED_AS = {
  Agent: ['Task'],
  ListMcpResources: ['ListMcpResourcesTool'],
  ReadMcpResource: ['ReadMcpResourceTool'],
};
const withReported = (list) => list.concat(...list.map((n) => (Object.hasOwn(REPORTED_AS, n) ? REPORTED_AS[n] : [])));

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
    tools: Array.isArray(o.tools) ? withReported(names(o.tools)) : null,
    // Bare names only: a `Read(~/.ssh/**)` rule narrows a tool, it does not remove it.
    denied: withReported(names(o.disallowedTools).filter((n) => n.indexOf('(') === -1)),
    servers: Object.keys(o.mcpServers || {}).map(serverToken).filter(Boolean),
    strictServers: !(opts && opts.operatorTools),
  };
}

/**
 * `{ refuse: [reason] }` for one init. REFUSE (2026-10-08, cross-review H2) anything
 * that is not what this launch asked for: a permission mode other than the one that makes the CLI call
 * Dopl's gate (or none reported), a deny-listed tool offered, a built-in outside the bound, a tool from a
 * server the launch did not configure, or no tool list. The gate is NOT a safe backstop for them: the CLI
 * auto-allows some calls without asking it (measured, `semantics.js`). (A `drift` list, always empty, was
 * removed: final review L3.)
 * ⚠ MEASURED (2026-10-08, claude 2.1.293): `full` offered `TaskStop` with no Dopl class; it is now in the
 * shell class (a8ebdf04), so every profile's measured init is clean under this rule.
 * ⚠ MEASURED (2026-10-09, signed in): the bound is matched under the names `init` reports (`REPORTED_AS`).
 */
function verifyInit(init, contract) {
  const c = contract || {};
  const msg = init || {};
  const refuse = [];
  // ⚠ A CONTRACT FIELD THAT IS MISSING REFUSES (final review L1, HIGH once the unknown-shape refusal was lifted
  // for Claude): this check is the only guard, so "nothing to compare" must never read as "nothing wrong".
  // `launch-spec.js` always sets both; an option change that dropped one fails closed here, loudly.
  if (!c.permissionMode) refuse.push('this launch recorded no permission mode to check');
  else {
    const mode = str(msg.permissionMode);
    if (!mode) refuse.push('the runtime did not report its permission mode');
    else if (mode !== c.permissionMode) refuse.push(`the runtime is in permission mode "${mode}", not "${c.permissionMode}"`);
  }
  if (!Array.isArray(c.tools)) refuse.push('this launch recorded no tool bound to check');
  if (!Array.isArray(msg.tools)) {
    refuse.push('the runtime did not report the tools it offers');
    return { refuse };
  }
  const denied = new Set(c.denied || []);
  const bound = new Set(Array.isArray(c.tools) ? c.tools : []);
  const deniedOffered = [];
  const unbound = [];
  const foreign = [];
  for (const t of names(msg.tools)) {
    if (denied.has(t)) deniedOffered.push(t);
    else if (t.startsWith(MCP_PREFIX)) {
      if (c.strictServers && !configuredServer(t, c.servers)) foreign.push(t);
    } else if (!bound.has(t)) unbound.push(t);
  }
  if (deniedOffered.length) refuse.push(`the runtime offers tools this launch denied (${shown(deniedOffered)})`);
  // ⚠ REFUSED, NOT DRIFT (cross-review H2): the bound is a fence Dopl set, and the CLI auto-allows some
  // calls without asking the gate (measured: cwd read-only shell), so an offered tool outside it is not
  // safely "held by the gate". Measured clean on every profile (TaskStop classified, a8ebdf04).
  if (unbound.length) refuse.push(`the runtime offers built-in tools outside this launch's bound (${shown(unbound)})`);
  if (foreign.length) refuse.push(`the runtime offers tools from servers this launch did not configure (${shown(foreign)})`);
  return { refuse };
}

/**
 * Is `mcp__<server>__<tool>` from a server this launch configured? EXACT server token (final review L2): a
 * prefix test let `mcp__dopl__evil__x` (server `dopl__evil`) pass as server `dopl`. The tool part after the
 * configured token must itself hold no `__`, so a longer server name that begins with a configured one is
 * foreign. Dopl's own tool names are single-underscore (`dopl_send_message`); strict mode covers only them.
 */
function configuredServer(tool, servers) {
  for (const s of servers || []) {
    const head = `${MCP_PREFIX}${s}__`;
    if (!tool.startsWith(head)) continue;
    const rest = tool.slice(head.length);
    if (rest && rest.indexOf('__') === -1) return true;
  }
  return false;
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

module.exports = { contractOf, verifyInit, mismatchSentence, serverToken, configuredServer, REPORTED_AS };
