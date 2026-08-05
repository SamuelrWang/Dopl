/**
 * F-145 — AN UNKNOWN TOOL ARGUMENT IS REFUSED BY NAME, NOT SILENTLY DROPPED.
 *
 * THE DEFECT THIS FILE PINS, end to end and through the REAL SDK. Every tool was
 * registered with a RAW SHAPE, which the SDK turns into a plain `z.object` and
 * parses with `safeParseAsync`. A plain `z.object` strips unknown keys, so
 * `dopl_channel {op:"post", body:"hi", to_agent:"quartz"}` was ACCEPTED,
 * `to_agent` never reached the handler, the post landed UNADDRESSED, and the
 * result narrated a success. That is the invisible delivery the route layer
 * already refuses — `src/features/channels/schema.ts#removedParam` declares the
 * deleted named-agent params as `z.never()` for exactly this reason — and the
 * MCP layer IN FRONT of it had the hole the route had closed. It was reachable:
 * `closedThreadNote` shipped a sentence teaching `to_agent="<handle>"` on every
 * post into a closed thread, so the tool taught the argument its own parser
 * then swallowed.
 *
 * NOT MOCKED, deliberately. `server.test.ts` stubs `McpServer` to capture
 * handlers, so it can pin what we PASS but never what the SDK DOES with it —
 * and the whole finding lives inside the SDK's parse step. This file boots the
 * real `createServer` over a real `InMemoryTransport` pair and asks a real
 * `Client`, so what it observes is what a remote agent observes.
 *
 * THE SCOPE IS EVERY TOOL, not `dopl_channel`. Removed vocabulary is one way a
 * model arrives at a param that does not exist; a stale cached tool list, an
 * older build's docs and plain invention are others, and none of them is
 * specific to channels.
 */
export {};
