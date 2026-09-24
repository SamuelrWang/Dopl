/**
 * resources.ts — THE MCP RESOURCES THIS SERVER PUBLISHES. Two: the channels
 * doctrine, and the knowledge one.
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
 * — several list tools and nothing else — so the guide topics (`dopl_get_guide`,
 * legacy `rooms action="help"`) return the SAME text. Two doors, one text, no
 * drift: the doctrine modules are the single definition, rendered in the
 * connection's tool set (`call-ref.ts`) through either door.
 *
 * ⚠ REGISTRATION IS UNGATED AND UNCHARGED, and both are decisions. Ungated: a
 * read-only session needs the rules exactly as much as a write-capable one, and
 * the text describes a surface rather than exposing any of it. Uncharged: MCP
 * credits are charged at the registrar per TOOL CALL (INVARIANTS §10), a
 * resource read is not a tool call, and metering the document that tells an
 * agent how to stop wasting calls would be self-defeating.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { bySet, withToolSet } from "./call-ref.js";
import type { ToolSet } from "./tool-manifest.js";
import { channelDoctrine, DOCTRINE_URI } from "./tools/channel-doctrine.js";
import { knowledgeDoctrine, KNOWLEDGE_DOCTRINE_URI } from "./tools/knowledge-doctrine.js";

interface Resource {
  name: string;
  title: string;
  description: () => string;
  text: () => string;
}

const RESOURCES: Readonly<Record<string, Resource>> = {
  [DOCTRINE_URI]: {
    name: "channels-doctrine",
    title: "Dopl channels — rules, protocol and etiquette",
    description: () =>
      `How ${bySet({ legacy: "dopl_channel works", granular: "the channel tools work" })}: the law of a channel, the thread/session model, the await loop and its stop rule, @-tagging, main-room etiquette, and how to run your own agents. Read once; the tool's results report only what each call did.`,
    text: channelDoctrine,
  },
  // ⚠ **500 CHARACTERS AGAINST ~9,000, AND THE ASYMMETRY IS THE ARGUMENT.** A
  // channel has a protocol, a lifecycle and an etiquette; a knowledge base has
  // a filesystem, and the knowledge tools' arguments already describe it. What
  // no argument can carry is the ORDER to read in and the duty that makes the
  // order possible — see `knowledge-doctrine.ts`.
  [KNOWLEDGE_DOCTRINE_URI]: {
    name: "knowledge-doctrine",
    title: "Dopl knowledge — sections",
    description: () =>
      "How to spend fewer characters on a knowledge entry: the read order (excerpt → outline → section → body) and the write duty that makes it possible (## headings, one topic each).",
    text: knowledgeDoctrine,
  },
};

/** A published resource's text in the active set — also what a pulled guide topic serves. */
export function resourceText(uri: string): string {
  return RESOURCES[uri].text();
}

/**
 * Publish every resource onto a session's server, in its tool set. ⚠ Called from
 * `server.ts › createServer` beside the tool registrars, so "what this server
 * publishes" is answerable from one file.
 */
export function registerResources(server: McpServer, toolSet: ToolSet): void {
  for (const [uri, r] of Object.entries(RESOURCES)) {
    server.registerResource(
      r.name,
      uri,
      { title: r.title, description: withToolSet(toolSet, r.description), mimeType: "text/markdown" },
      (href) => ({
        contents: [{ uri: href.href, mimeType: "text/markdown", text: withToolSet(toolSet, r.text) }],
      }),
    );
  }
}
