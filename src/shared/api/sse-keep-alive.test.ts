/**
 * FIX M1 (Q9, 2026-07-31) — THE REMOTE MCP ENDPOINT STREAMS, AND KEEPS STREAMING.
 *
 * Two properties are pinned here, and losing either one silently breaks every
 * MCP client we cannot configure (terminal Claude Code, claude.ai connectors,
 * Claude Desktop, third-party clients):
 *
 *   1. `/api/mcp` must NOT set `enableJsonResponse`. That flag makes the SDK
 *      withhold the whole response — headers included — until the tool handler
 *      returns, which puts a long `dopl_channel(op="await")` hold inside the
 *      client's 60s TIME-TO-HEADERS abort. Every incident ended at exactly
 *      60.0s. On the default SSE path headers flush at t≈0 instead.
 *   2. A stream that flushes headers and then says nothing for ~215s is what an
 *      intermediary's idle timeout kills. `withSseKeepAlive` keeps bytes moving
 *      with SSE COMMENTS, which are ignored by every conforming parser, so the
 *      frames a client decodes are unchanged.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { SSE_KEEP_ALIVE_MS, withSseKeepAlive } from "./sse-keep-alive";

const decoder = new TextDecoder();

/** Read a whole wrapped body to a string. */
async function drain(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function sseResponse(body: BodyInit, init?: ResponseInit): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    ...init,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withSseKeepAlive", () => {
  it("passes a non-SSE response straight through, same object", () => {
    const json = new Response(JSON.stringify({ ok: true }), {
      status: 406,
      headers: { "Content-Type": "application/json" },
    });
    // Identity, not just equivalence: a 4xx JSON-RPC error must never grow a
    // comment line, and a bodyless 202 must never grow a body.
    expect(withSseKeepAlive(json)).toBe(json);
    const accepted = new Response(null, { status: 202 });
    expect(withSseKeepAlive(accepted)).toBe(accepted);
  });

  it("forwards every source byte unchanged when the source is prompt", async () => {
    const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n\n`;
    const wrapped = withSseKeepAlive(sseResponse(frame));
    expect(await drain(wrapped)).toBe(frame);
  });

  it("emits comments while the handler is slow, then the real frame", async () => {
    // The await-hold shape: headers out immediately, one frame much later.
    const frame = `event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n`;
    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        await sleep(60);
        controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    });
    const body = await drain(withSseKeepAlive(sseResponse(source), 10));
    expect(body.endsWith(frame)).toBe(true);
    const comments = body.split("\n\n").filter((l) => l.startsWith(": "));
    expect(comments.length).toBeGreaterThan(1);
    // Comments only — nothing that a parser would decode as an event.
    for (const c of comments) expect(c).toBe(": keep-alive");
  });

  it("keeps the payload a client decodes byte-identical to the source", async () => {
    // The whole safety argument: `:` lines are comments in the WHATWG event
    // stream algorithm, so stripping them must recover the source exactly.
    const frame = `event: message\ndata: {"jsonrpc":"2.0","id":7}\n\n`;
    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        await sleep(40);
        controller.enqueue(new TextEncoder().encode(frame));
        controller.close();
      },
    });
    const body = await drain(withSseKeepAlive(sseResponse(source), 5));
    expect(body.replaceAll(": keep-alive\n\n", "")).toBe(frame);
  });

  it("propagates a source error instead of hanging on it", async () => {
    const boom = new Error("upstream exploded");
    const source = new ReadableStream<Uint8Array>({
      async start(controller) {
        await sleep(10);
        controller.error(boom);
      },
    });
    await expect(drain(withSseKeepAlive(sseResponse(source), 5))).rejects.toThrow(
      "upstream exploded"
    );
  });

  it("cancelling the wrapper cancels the source and stops the timer", async () => {
    let cancelled: unknown = "never";
    const source = new ReadableStream<Uint8Array>({
      start() {
        /* never produces */
      },
      cancel(reason) {
        cancelled = reason;
      },
    });
    const wrapped = withSseKeepAlive(sseResponse(source), 5);
    const reader = wrapped.body!.getReader();
    await reader.cancel("client hung up");
    expect(cancelled).toBe("client hung up");
    // A timer left running would hold the serverless function open to its
    // maxDuration after the client is already gone.
    await sleep(20);
  });

  it("marks the response no-buffer / no-cache and keeps the status", () => {
    const wrapped = withSseKeepAlive(sseResponse("", { status: 200 }), 5);
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get("content-type")).toBe("text/event-stream");
    expect(wrapped.headers.get("x-accel-buffering")).toBe("no");
    expect(wrapped.headers.get("cache-control")).toBe("no-cache");
  });

  it("does NOT send no-transform — it would forbid compressing every MCP result", () => {
    // This assertion used to be its inverse. `no-transform` (RFC 9111
    // §5.2.2.6) forbids an intermediary from applying a content coding, and
    // this is the response carrying every JSON-RPC tool result, including the
    // ontology reads and the `dopl_map` manifest the server instructions
    // mandate before an agent's first reply. Shipping it told the CDN not to
    // compress the largest agent-facing payloads in the product (P0-3).
    //
    // The anti-BUFFERING guarantee this wrapper actually needs is
    // `X-Accel-Buffering: no`, asserted above and untouched. Compression does
    // not buffer SSE (codings flush per write) and the decoded frames are
    // byte-identical, so nothing the keep-alive protects depends on it.
    const wrapped = withSseKeepAlive(sseResponse("", { status: 200 }), 5);
    expect(wrapped.headers.get("cache-control")).not.toContain("no-transform");
  });

  it("holds the cadence under the common proxy idle timeouts", () => {
    expect(SSE_KEEP_ALIVE_MS).toBeGreaterThan(0);
    expect(SSE_KEEP_ALIVE_MS).toBeLessThanOrEqual(30_000);
  });
});

// ── the route this exists for ───────────────────────────────────────────────

const routeSrc = readFileSync(
  path.resolve(process.cwd(), "src", "app", "api", "mcp", "route.ts"),
  "utf8"
);
/** Comments stripped — the file EXPLAINS the flag at length; only code counts. */
const routeCode = routeSrc.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("/api/mcp transport shape", () => {
  it("never re-enables JSON-response mode", () => {
    // Re-adding this flag restores the 60s time-to-headers abort for every
    // client, and no test that mocks the SDK would notice.
    expect(routeCode).not.toMatch(/enableJsonResponse/);
    // …and the transport really is constructed, stateless, right here.
    expect(routeCode).toMatch(
      /new WebStandardStreamableHTTPServerTransport\(\{\s*sessionIdGenerator: undefined,\s*\}\)/
    );
  });

  it("wraps the transport response in the keep-alive", () => {
    expect(routeSrc).toMatch(/withSseKeepAlive\(await transport\.handleRequest\(/);
  });

  it("stays on the Node runtime with a 300s ceiling", () => {
    // Edge would change the streaming/runtime story wholesale; maxDuration is
    // mirrored into the MCP package's deadline chain and pinned from there too.
    expect(routeSrc).toMatch(/export const runtime = "nodejs"/);
    expect(routeSrc).toMatch(/export const maxDuration = 300/);
  });

  it("hands the caller's abort signal to the loopback client (Q14)", () => {
    // Without this the MCP handler never learns the client hung up, so an
    // `op="await"` hold keeps re-issuing loopback polls for its whole budget.
    // Source-level because the behavioural path needs a full authenticated
    // transport boot; the wiring is one argument and losing it is silent.
    expect(routeCode).toMatch(/signal: request\.signal/);
  });
});

// ── FIX Q6: GET is 405, and is NOT the JSON-RPC handler ─────────────────────
//
// Routing GET to `handle` did not fail loudly, it failed by SUCCEEDING: the
// stateless SDK transport answers a GET with 200 `text/event-stream` carrying a
// stream nothing can ever write to or close (the transport is a per-request
// local, so no POST invocation can reach it). While that stream was byte-silent
// an intermediary reaped it in ~30-60s. `withSseKeepAlive` then started feeding
// it a comment every 15s — exactly what stops it being reaped — so it survived
// to `maxDuration`. Every SDK client opens it right after
// `notifications/initialized` and reconnects when it ends, so the steady state
// was one 300s function per connected client, renewed ~12x/hour, forever.
//
// These tests exist because nothing about that is visible from a passing suite:
// the failure mode is a 200.

describe("/api/mcp GET", () => {
  it("answers 405 with an Allow header, and no event stream", async () => {
    const { GET } = await import("@/app/api/mcp/route");
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    // The content type is the load-bearing half: a `text/event-stream` here is
    // a stream that lives to maxDuration.
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("is a DIFFERENT export from POST/DELETE", async () => {
    // The exact regression: `export const GET = handle` makes these identical.
    const { GET, POST, DELETE } = await import("@/app/api/mcp/route");
    expect(GET).not.toBe(POST);
    expect(GET).not.toBe(DELETE);
    // …while POST and DELETE do still share the one JSON-RPC handler.
    expect(POST).toBe(DELETE);
  });

  it("needs no request argument — it authenticates nothing", async () => {
    // A method-level refusal that reveals nothing and costs nothing. If this
    // ever grows a parameter it has started doing work on an unauthenticated
    // GET, which is how the eternal stream got opened in the first place.
    const { GET } = await import("@/app/api/mcp/route");
    expect(GET.length).toBe(0);
  });

  it("cannot be picked up by the keep-alive wrapper", async () => {
    // Belt and braces on the interaction that made this expensive: the wrapper
    // must pass a 405 straight through, identity-equal, feeding it nothing.
    const { GET } = await import("@/app/api/mcp/route");
    const response = GET();
    expect(withSseKeepAlive(response)).toBe(response);
  });

  it("never routes GET back to the JSON-RPC handler in source", () => {
    expect(routeCode).not.toMatch(/export const GET = handle/);
    expect(routeCode).toMatch(/export const POST = handle/);
    expect(routeCode).toMatch(/export const DELETE = handle/);
  });
});
