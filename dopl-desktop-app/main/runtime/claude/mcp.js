// MCP REGISTRATION — ⚠ TWO MECHANISMS, NOT ONE, AND CONFLATING THEM WAS A REAL DESIGN ERROR.
//
//   SESSION TRANSPORT   what the SPAWNED session gets. Built in memory, per launch, never a file
//                       and never a CLI verb: `loader.js › buildMcpServers` + `› withSessionStamp`.
//                       This is the lane Axis B's whole enforcement story depends on, because the
//                       Dopl MCP server is remote HTTP — the desktop main process is NOT in the
//                       call path of a channel call, so the held permission callback is the only
//                       thing between the model and that endpoint.
//   HOST REGISTRATION   the OPERATOR's own user-scope entry, so their manual runs of this CLI can
//                       reach Dopl too. A CLI verb here (`main/mcp-cli-add.js`, which NEVER edits
//                       the runtime's config file directly), with policy in `main/mcp-config.js`.
//
// ⚠ THE OPERATOR'S ENTRY IS DELIBERATELY UNSTAMPED. `addMcpEntry` sends `Authorization` and
// nothing else — a manual run in the operator's own terminal is NOT a session this app spawned,
// and claiming the desktop custody stamp for it would be the exact confusion that stamp removes.
//
// ⚠ THE POLICY LAYER STAYS IN CORE AND THIS FILE ONLY NAMES THE LANE. `mcp-config.js` owns
// add / leave-alone / repair-on-origin-drift, and it owns `MCP_CLIENT_TIMEOUT_MS` — the ONE
// definition of the per-server call timeout, derived from the server's own await budget.
// `loader.js` reads that constant rather than restating it, because it drifted once already by
// restating it, and moving the builder must not sever that.

const cliAdd = () => require('../../mcp-cli-add');

/** Add or repair the operator's own user-scope entry for this runtime. */
function registerMcp(cfg) {
  return cliAdd().addMcpEntry(cfg);
}

/**
 * ⚠ ABSENT AND UNKNOWN ARE DIFFERENT ANSWERS, and this lane can tell them apart: the CLI's own
 * `get` verb exits non-zero with a "no such server" line, which is CONFIRMED ABSENT, while a
 * missing binary or an unreadable config is UNKNOWN. A probe that collapses the two makes
 * "repair the entry" indistinguishable from "do not touch the operator's config".
 */
function probeMcp() {
  return cliAdd().probeMcpEntry();
}

// Descriptor half.
const descriptor = {
  sessionTransport: 'http',
  hostRegistration: 'cli-verb',
  probe: true,
  toolNamePrefix: 'mcp__<server>__<tool>',
  // ⚠ null: this runtime has no per-MCP-tool approval policy. The per-server `tools` field it
  // DOES have is a PERMISSION policy, not a visibility allowlist, and setting it made the CLI
  // drop the whole server entry — `loader.js › buildMcpServers` carries that measurement.
  perToolApproval: null,
  // ⚠ THE EAGER-LOAD FLAG IS LOAD-BEARING, NOT AN OPTIMISATION. Without it the channel tool —
  // the session's DELIVERY PATH — arrives deferred behind this runtime's tool-search verb, and
  // the session declares it does not have the tool.
  eagerLoadFlag: 'alwaysLoad',
  sessionStampHeader: 'X-Dopl-Session-Id',
};

module.exports = { registerMcp, probeMcp, descriptor };
