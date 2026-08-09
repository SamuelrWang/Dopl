/**
 * SSE keep-alive wrapper for the remote MCP endpoint (`/api/mcp`).
 *
 * WHY IT EXISTS (Q9 / FIX M1, 2026-07-31). `/api/mcp` streams: the MCP
 * transport flushes response headers immediately and writes the JSON-RPC
 * result as ONE `event: message` frame when the tool handler finally returns.
 * For `dopl_channel(op="await")` that gap is the whole hold — up to ~215s of a
 * connection that is open, has already sent its headers, and carries no bytes.
 *
 * A response that silent is exactly what an intermediary's idle timeout kills,
 * and the failure is invisible from here: the client sees the stream drop, not
 * a JSON-RPC error, so it loses the graceful "nothing arrived, re-arm on the
 * same cursor" RESULT that carries all of the re-arm teaching. Emitting an SSE
 * COMMENT on a cadence keeps bytes moving without touching the protocol —
 * `:`-prefixed lines are ignored by every conforming SSE parser (the MCP SDK's
 * client feeds the body through `eventsource-parser`, the WHATWG algorithm),
 * so the frame stream a client actually decodes is byte-identical.
 *
 * It is deliberately a wrapper rather than a transport option: the SDK owns the
 * `ReadableStream` and exposes no hook, and wrapping keeps the behaviour on our
 * side of the dependency where it can be tested.
 *
 * NON-SSE RESPONSES PASS THROUGH UNTOUCHED — a 4xx JSON error, a 202 with no
 * body, a JSON-mode response — so this can never inject bytes into a body that
 * is not an event stream.
 */

/**
 * Gap between keep-alive comments. Short enough to stay under the common 30-60s
 * proxy idle timeouts, long enough that a whole 215s hold costs ~14 comments
 * (~15 bytes each). Not a protocol constant — nothing depends on the cadence.
 */
export const SSE_KEEP_ALIVE_MS = 15_000;

/** One SSE comment line. Ignored by parsers; its only job is to be traffic. */
const KEEP_ALIVE_FRAME = ": keep-alive\n\n";

/**
 * Wrap an SSE response so it emits a comment every `intervalMs` while the
 * handler behind it is still working. Returns the response unchanged when it is
 * not an event stream (or carries no body).
 */
export function withSseKeepAlive(
  response: Response,
  intervalMs: number = SSE_KEEP_ALIVE_MS
): Response {
  const source = response.body;
  const contentType = response.headers.get("content-type") ?? "";
  if (!source || !contentType.includes("text/event-stream")) return response;

  const encoder = new TextEncoder();
  const reader = source.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        // The pump may have closed the controller between the tick firing and
        // this line; enqueueing on a closed controller throws, and that must
        // not surface as an unhandled rejection on a response already sent.
        try {
          controller.enqueue(encoder.encode(KEEP_ALIVE_FRAME));
        } catch {
          stopTimer();
        }
      }, intervalMs);

      // Pump the transport's stream through. Deliberately NOT awaited: `start`
      // must return so the Response can be handed to the platform and its
      // headers flushed — awaiting here would reintroduce the very buffering
      // this route exists to avoid.
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          stopTimer();
          controller.close();
        } catch (err) {
          stopTimer();
          try {
            controller.error(err);
          } catch {
            /* already errored or closed — nothing left to signal */
          }
        }
      })();
    },
    cancel(reason) {
      // Client hung up: stop the timer and propagate, or the interval would
      // outlive the request and hold the function open to its maxDuration.
      stopTimer();
      return reader.cancel(reason);
    },
  });

  const headers = new Headers(response.headers);
  // Belt-and-braces against a buffering reverse proxy in front of the function.
  // Vercel does not buffer `text/event-stream`, but a self-hosted nginx does
  // unless told otherwise, and neither header changes the bytes we emit.
  headers.set("X-Accel-Buffering", "no");
  // `no-cache` ONLY. This used to read `no-cache, no-transform`, and
  // `no-transform` is not a synonym or an intensifier — RFC 9111 §5.2.2.6 makes
  // it a directive forbidding every intermediary from altering the payload,
  // which includes applying a content coding. On this route that is precisely
  // backwards: `/api/mcp` is the transport for every MCP tool result, its
  // bodies are JSON-RPC text, and it is the path `dopl_map` and the ontology
  // reads travel. We were affirmatively instructing the CDN not to compress
  // the largest agent-facing payloads the product serves (P0-3).
  //
  // Nothing here needed it. The header was added alongside `X-Accel-Buffering`
  // as anti-buffering hygiene, but buffering and transformation are different
  // properties: `X-Accel-Buffering: no` is what stops a proxy from holding
  // frames, and it is untouched. Compression does not buffer an SSE stream —
  // gzip/br flush per write, so the keep-alive comment still leaves on its
  // 15s tick — and the decoded frames are byte-identical either way, so the
  // `eventsource-parser` contract this whole wrapper protects is unaffected.
  headers.set("Cache-Control", "no-cache");

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
