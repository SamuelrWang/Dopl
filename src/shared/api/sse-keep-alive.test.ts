/**
 * THE REMOTE MCP ENDPOINT STREAMS, AND KEEPS STREAMING. Losing either property
 * silently breaks every MCP client we cannot configure:
 *
 *   1. ⚠ `/api/mcp` must NOT set `enableJsonResponse` — that flag withholds the
 *      whole response, headers included, until the tool handler returns, putting
 *      a long `dopl_channel(op="await")` hold inside the client's 60s
 *      TIME-TO-HEADERS abort (every incident ended at exactly 60.0s).
 *   2. ⚠ A stream that flushes headers then says nothing for ~215s is killed by
 *      an intermediary's idle timeout. `withSseKeepAlive` keeps bytes moving
 *      with SSE COMMENTS, ignored by every conforming parser.
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
    // ⚠ Identity, not equivalence: a 4xx must never grow a comment line and a
    // bodyless 202 must never grow a body.
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
    for (const c of comments) expect(c).toBe(": keep-alive");
  });

  it("keeps the payload a client decodes byte-identical to the source", async () => {
    // ⚠ The safety argument: `:` lines are comments in the WHATWG event-stream
    // algorithm, so stripping them must recover the source exactly.
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
    // ⚠ A leaked timer holds the function open to maxDuration after hangup.
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
    // ⚠ Never `no-transform` (RFC 9111 §5.2.2.6): it forbids intermediaries from
    // applying a content coding, i.e. tells the CDN not to compress the largest
    // agent-facing payloads in the product. The anti-BUFFERING guarantee is
    // `X-Accel-Buffering: no`, asserted above.
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
/** ⚠ Comments stripped — the file EXPLAINS the flag; only code counts. */
const routeCode = routeSrc.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("/api/mcp transport shape", () => {
  it("never re-enables JSON-response mode", () => {
    // ⚠ Re-adding this flag restores the 60s time-to-headers abort for every
    // client, and no SDK-mocking test would notice.
    expect(routeCode).not.toMatch(/enableJsonResponse/);
    expect(routeCode).toMatch(
      /new WebStandardStreamableHTTPServerTransport\(\{\s*sessionIdGenerator: undefined,\s*\}\)/
    );
  });

  it("wraps the transport response in the keep-alive", () => {
    expect(routeSrc).toMatch(/withSseKeepAlive\(await transport\.handleRequest\(/);
  });

  it("stays on the Node runtime with a 300s ceiling", () => {
    // ⚠ maxDuration is mirrored into the MCP package's deadline chain.
    expect(routeSrc).toMatch(/export const runtime = "nodejs"/);
    expect(routeSrc).toMatch(/export const maxDuration = 300/);
  });

  it("hands the caller's abort signal to the loopback client (Q14)", () => {
    // ⚠ Without this the handler never learns the client hung up, so an
    // `op="await"` hold re-issues loopback polls for its whole budget. Checked
    // at source level: the wiring is one argument and losing it is silent.
    expect(routeCode).toMatch(/signal: request\.signal/);
  });
});

// ── ⚠ GET is 405, and must NOT be the JSON-RPC handler ──────────────────────
// Routing GET to `handle` fails by SUCCEEDING: the stateless SDK transport
// answers 200 `text/event-stream` with a stream nothing can write to or close,
// and the keep-alive comment every 15s is exactly what stops an intermediary
// reaping it — so it survives to `maxDuration`. Every SDK client opens it after
// `notifications/initialized` and reconnects when it ends: one 300s function per
// connected client, renewed ~12x/hour, forever.

describe("/api/mcp GET", () => {
  it("answers 405 with an Allow header, and no event stream", async () => {
    const { GET } = await import("@/app/api/mcp/route");
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, DELETE");
    // ⚠ Load-bearing half: a `text/event-stream` here lives to maxDuration.
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("is a DIFFERENT export from POST/DELETE", async () => {
    // ⚠ The regression: `export const GET = handle` makes these identical.
    const { GET, POST, DELETE } = await import("@/app/api/mcp/route");
    expect(GET).not.toBe(POST);
    expect(GET).not.toBe(DELETE);
    expect(POST).toBe(DELETE);
  });

  it("needs no request argument — it authenticates nothing", async () => {
    // ⚠ If this grows a parameter it has started doing work on an
    // unauthenticated GET — how the eternal stream got opened.
    const { GET } = await import("@/app/api/mcp/route");
    expect(GET.length).toBe(0);
  });

  it("cannot be picked up by the keep-alive wrapper", async () => {
    // ⚠ The wrapper must pass a 405 straight through, identity-equal.
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
