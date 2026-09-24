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
import type { ToolSet } from "./tool-manifest.js";
/** A published resource's text in the active set — also what a pulled guide topic serves. */
export declare function resourceText(uri: string): string;
/**
 * Publish every resource onto a session's server, in its tool set. ⚠ Called from
 * `server.ts › createServer` beside the tool registrars, so "what this server
 * publishes" is answerable from one file.
 */
export declare function registerResources(server: McpServer, toolSet: ToolSet): void;
