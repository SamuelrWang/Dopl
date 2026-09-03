/**
 * resources.ts — THE MCP RESOURCES THIS SERVER PUBLISHES. One today: the
 * channels doctrine.
 *
 * ⚠ WHY A RESOURCE AND NOT A LONGER DESCRIPTION (T10/T82, 2026-09-02). A tool
 * description is PUSHED — every connected client pays for it on every
 * connection, whether or not it will ever use the tool. A resource is PULLED:
 * the ~14k characters of channels doctrine cost nothing until an agent asks for
 * them, and an agent that never opens a channel never pays. That is the whole
 * trade, and it is why the text may be thorough here where the description must
 * be a summary.
 *
 * ⚠ IT IS NOT THE ONLY DOOR, DELIBERATELY. Not every MCP client reads resources
 * — several list tools and nothing else — so `dopl_channel(op="help")` returns
 * the SAME constant. Two doors, one text, no drift: `channel-doctrine.ts` is the
 * single definition and both surfaces import it.
 *
 * ⚠ REGISTRATION IS UNGATED AND UNCHARGED, and both are decisions. Ungated: a
 * read-only session needs the rules exactly as much as a write-capable one, and
 * the text describes a surface rather than exposing any of it. Uncharged: MCP
 * credits are charged at the registrar per TOOL CALL (INVARIANTS §10), a
 * resource read is not a tool call, and metering the document that tells an
 * agent how to stop wasting calls would be self-defeating.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CHANNEL_DOCTRINE, DOCTRINE_URI } from "./tools/channel-doctrine.js";

/**
 * Publish every resource onto a session's server. ⚠ Called from
 * `server.ts › createServer` beside the tool registrars, so "what this server
 * publishes" is answerable from one file.
 */
export function registerResources(server: McpServer): void {
  server.registerResource(
    "channels-doctrine",
    DOCTRINE_URI,
    {
      title: "Dopl channels — rules, protocol and etiquette",
      description:
        "How dopl_channel works: the law of a channel, the thread/session model, the await loop and its stop rule, @-tagging, main-room etiquette, and how to run your own agents. Read once; the tool's results report only what each call did.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: CHANNEL_DOCTRINE,
        },
      ],
    }),
  );
}
