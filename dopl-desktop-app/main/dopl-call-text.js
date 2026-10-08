// EVERY DOPL CALL A DESKTOP PROMPT SPELLS, rendered for the session's negotiated tool set (DMP-013).
//
// The desktop twin of `packages/mcp-server/src/call-ref.ts`: a call is named by its manifest key
// (`channel.read`, `channel.rooms.threads`, `kb.read_file` — the binding key without `dopl_`, `:` as
// `.`) and rendered from the generated table, so the legacy `mcp__dopl__dopl_channel op "read"` is
// `mcp__dopl__dopl_read_channel` on a granular session with no second mapping. `set` is
// `s.doplToolSet`; anything but `granular` renders the legacy spelling, byte-for-byte what the
// prompts said before. Pure: the table only.

const { GRANULAR_NAMES, granularRow, jobsOf } = require('./dopl-tool-table');

const PREFIX = 'mcp__dopl__';
const GRANULAR = 'granular';

// Manifest key → the granular tool and the selector value that picks the job (null for a one-job
// tool). A preset tool (`dopl_request_decision`) is never the target of a shared key.
const TARGETS = new Map();
for (const name of GRANULAR_NAMES) {
  const row = granularRow(name);
  if (row.preset) continue;
  for (const [job, key] of jobsOf(row)) TARGETS.set(key.slice('dopl_'.length).replace(':', '.'), { name, select: row.select, job });
}

/** The tool name and the job words for `key` in `set`; throws on a key the manifest does not bind. */
function parts(set, key) {
  const target = TARGETS.get(key);
  if (!target) throw new Error(`dopl-call-text: "${key}" is not a manifest key`);
  if (set === GRANULAR) return { tool: target.name, job: target.job === null ? '' : `${target.select} "${target.job}"` };
  const [tool, op, action] = key.split('.');
  return { tool: `dopl_${tool}`, job: [op && `op "${op}"`, action && `action "${action}"`].filter(Boolean).join(', ') };
}

const list = (...xs) => xs.filter(Boolean).join(', ');

/** The fully qualified tool: `mcp__dopl__dopl_channel` / `mcp__dopl__dopl_read_channel`. */
function doplTool(set, key) {
  return PREFIX + parts(set, key).tool;
}

/**
 * The whole call in the prompts' style, `args` (already rendered) appended: `mcp__dopl__dopl_channel
 * op "rooms", action "threads", <args>` / `mcp__dopl__dopl_get_channel action "threads", <args>`.
 * `bare` drops the server prefix, for a line that names the tool short.
 */
function doplCall(set, key, args, bare) {
  const p = parts(set, key);
  const tail = list(p.job, args);
  const head = (bare ? '' : PREFIX) + p.tool;
  return tail ? `${head} ${tail}` : head;
}

/** The args after a line has already named the tool: `op "send", <args>` / `<args>`. */
function doplArgs(set, key, args) {
  return list(parts(set, key).job, args);
}

/** A call named relative to the tool in the sentence (`op "read"`); granular has no such form, so it is whole. */
function doplOp(set, key, args) {
  return set === GRANULAR ? doplCall(set, key, args) : doplArgs(set, key, args);
}

/**
 * **EVERY WAY TO POST, OFF THE TABLE** (2026-10-08): the preset tools bound to the same job as
 * `channel.send` (`dopl_request_decision` kind "decision", `dopl_show` kind "display"), as
 * `[{ kind, call }]` in `set`. Derived, so a preset the manifest adds is named in every prompt with
 * no edit here; a granular session names the preset tool, a legacy one the send with its `kind`.
 */
function sendLanes(set) {
  const send = TARGETS.get('channel.send');
  const bind = send && jobsOf(granularRow(send.name)).find(([job]) => job === send.job);
  const key = bind ? bind[1] : 'dopl_channel:send';
  return GRANULAR_NAMES.map(granularRow)
    .filter((row) => row.preset && typeof row.preset.kind === 'string' && jobsOf(row).some(([, k]) => k === key))
    .map((row) => ({
      kind: row.preset.kind,
      call: set === GRANULAR ? PREFIX + row.name : doplCall(set, 'channel.send', `kind "${row.preset.kind}"`),
    }));
}

module.exports = { doplTool, doplCall, doplArgs, doplOp, sendLanes, GRANULAR };
