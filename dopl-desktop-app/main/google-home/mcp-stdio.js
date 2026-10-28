#!/usr/bin/env node
// `dopl-google-home`: the Google Home tools as a local stdio MCP server. It must run on a computer
// on the same network as the speaker (Cast is LAN-only), which is why it lives with the desktop
// app and not on the hosted /api/mcp. Any MCP client can add it:
//
//   claude mcp add dopl-google-home -- node <repo>/dopl-desktop-app/main/google-home/mcp-stdio.js
//
// `--discover` prints the devices found and exits (discovery only: nothing is played).

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { createGoogleHome } = require('./service');
const { registerGoogleHomeTools } = require('./mcp-tools');

async function main(argv) {
  const home = createGoogleHome();
  if (argv.includes('--discover')) {
    process.stdout.write(`${JSON.stringify(await home.status(), null, 2)}\n`);
    home.close();
    return;
  }
  const server = new McpServer({ name: 'dopl-google-home', version: '0.1.0' });
  registerGoogleHomeTools(server, home);
  await server.connect(new StdioServerTransport());
  const stop = () => { home.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdin.on('close', stop);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`dopl-google-home: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  });
}

module.exports = { main };
