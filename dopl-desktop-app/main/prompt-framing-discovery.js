// The grant sentence of `prompt-framing.js › firstActions`, per runtime (CXP-3A). Pure.
// `ctx.mcpDiscovery` (`capability.mcpDiscovery`) is null on Claude (tools always loaded; wording
// byte-identical). Codex defers every MCP tool: measured (`test/codex-mcp-discovery.test.mjs`), a
// model reaches it through `tool_search`, or in code mode lists it in `ALL_TOOLS` inside `exec` —
// so it is told both ways in rather than "do not go looking for it".

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
