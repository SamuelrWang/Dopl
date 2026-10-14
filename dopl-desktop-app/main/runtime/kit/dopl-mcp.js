// Dopl's own MCP credential and call timeout, read for a session entry (docs/specs/runtime-scaffold.md
// §3 K6). Vendor-neutral: every adapter's `mcp.js` builds its session entry from these two reads, and
// PLACES them its own way on the wire (a header object, env-var NAMES, fetch headers) — placement is the
// adapter's, and so are the stamp literals, which the cross-tree tests pin in each adapter's file.
//
// ⚠ THE POLICY LAYER STAYS IN CORE: `mcp-config.js` owns the device token (safeStorage-held, never on
// disk) and `MCP_CLIENT_TIMEOUT_MS` — the ONE definition of the per-server call timeout, derived from
// the server's own await budget. Both are READ here, never restated (the timeout drifted once by being
// restated). Both requires are LAZY: `mcp-config` pulls auth (and electron behind it), and an adapter's
// `mcp.js` is loaded by the electron-free registry.
// ⚠ THE BEARER NEVER HITS LOGS OR ARGV: the caller keeps it in memory or in an env var.

/** The device token for a spawned session, or '' — an unwired harness or a pre-sign-in launch reads as
 *  "no token", never throws into a launch. */
function doplBearer() {
  try {
    return require('../../mcp-config').deviceTokenForSpawn() || '';
  } catch (_) {
    return '';
  }
}

/**
 * The per-server call timeout in ms, from `mcp-config`. `o.fallbackMs` is a PER-ADAPTER CHOICE, kept as
 * each adapter had it (2026-10-13): given, an unloadable `mcp-config` answers `fallbackMs`; omitted, the
 * failure throws into the caller (an adapter that reaches this only after `doplBearer` proved
 * `mcp-config` loads).
 */
function clientTimeoutMs(o) {
  if (!o || o.fallbackMs === undefined) return require('../../mcp-config').MCP_CLIENT_TIMEOUT_MS;
  try {
    return require('../../mcp-config').MCP_CLIENT_TIMEOUT_MS;
  } catch (_) {
    return o.fallbackMs;
  }
}

module.exports = { doplBearer, clientTimeoutMs };
