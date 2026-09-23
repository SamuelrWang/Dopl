// THE GRANT SENTENCE OF `prompt-framing.js › firstActions`, PER RUNTIME (CXP-3A, 2026-09-22).
//
// PURE — no electron / fs / path. Split out of `prompt-framing.js` for the §2 500-line cap, and
// on a real seam: this is the one part of the first turn whose wording depends on HOW THE RUNTIME
// EXPOSES DOPL'S TOOLS, and it changes when a runtime's tool surface is re-measured.
//
// 🔒 MEASURED (codex-cli 0.155.1; `test/codex-mcp-discovery.test.mjs`): Codex defers every MCP
// tool. A non-code-mode model (gpt-5.5) reaches it through a client-executed `tool_search`; a
// `code_mode_only` model (every gpt-6-* / gpt-5.6-* in the 2026-09-22 catalog) runs tools inside
// `exec`, where a deferred tool is listed in `ALL_TOOLS` as `mcp__dopl__dopl_channel` and called
// as `tools.mcp__dopl__dopl_channel(...)`. Both land on the same held approval.

// ⚠ RUNTIME-AWARE SINCE CXP-3A (2026-09-22). `ctx.mcpDiscovery` is `capability.mcpDiscovery`'s
// answer: null (Claude — `alwaysLoad`, ToolSearch denied) keeps the wording BYTE-IDENTICAL; Codex
// (deferred MCP tools; neither way in is on Dopl's deny list) gets the two MEASURED ways in —
// `tool_search`, and code-mode's `ALL_TOOLS` inside `exec` — instead of "do not go looking for it",
// which a spawned Codex agent QUOTED when it refused to search.
const WORD = /^[A-Za-z_]+$/;
function grantLines(disc) {
  const verb = disc && WORD.test(disc.verb || '') ? disc.verb : null;
  const catalog = disc && WORD.test(disc.catalog || '') ? disc.catalog : null;
  if (!verb && !catalog) {
    return [
      `  path and it is the reason this session exists, so do not go looking for it and do not`,
      `  test for it: if it is not in a list you can enumerate, that is the list, not the grant.`,
      `  If mcp__dopl__dopl_channel is not in your tool list, say so in your first reply: the`,
      `  desktop failed to connect Dopl.`,
    ];
  }
  return [
    `  path and it is the reason this session exists. On this runtime Dopl's tools are DEFERRED:`,
    `  they are not in your initial tool list, and that is expected. Load it before your first Dopl`,
    `  call, by whichever way in your tools offer:`,
    ...(verb ? [`  - call \`${verb}\` with the query "dopl channel"; it returns the tool in the mcp__dopl namespace.`] : []),
    ...(catalog ? [`  - if your tools run inside \`exec\`, find it in \`${catalog}\` and call tools.mcp__dopl__dopl_channel there.`] : []),
    `  Either way that IS mcp__dopl__dopl_channel, and the lookup is the normal way in, not a test.`,
    `  If it is not found, say so in your first reply: the desktop failed to connect Dopl.`,
  ];
}

module.exports = { grantLines };
