/**
 * SSE keep-alive wrapper for `/api/mcp`.
 *
 * The MCP transport flushes headers immediately and writes the JSON-RPC result
 * as ONE `event: message` frame when the tool handler returns. For
 * `dopl_channel(op="await")` that gap is up to ~215s of a byte-less open
 * connection — exactly what an intermediary's idle timeout kills, and the client
 * sees a stream drop rather than a JSON-RPC error, losing the graceful re-arm
 * RESULT. An SSE COMMENT on a cadence keeps bytes moving without touching the
 * protocol: `:`-prefixed lines are ignored by every conforming parser, so the
 * decoded frame stream is byte-identical.
 *
 * A wrapper, not a transport option: the SDK owns the `ReadableStream` and
 * exposes no hook.
 *
 * ⚠ NON-SSE RESPONSES PASS THROUGH UNTOUCHED — never inject bytes into a body
 * that is not an event stream.
 */

/** Gap between keep-alive comments. Under the common 30-60s proxy idle timeouts;
 *  a 215s hold costs ~14 comments. Not a protocol constant. */
export const SSE_KEEP_ALIVE_MS = 15_000;

/** One SSE comment line. Ignored by parsers; its only job is to be traffic. */
const KEEP_ALIVE_FRAME = ": keep-alive\n\n";

/** Emit a comment every `intervalMs` while the handler is still working.
 *  Unchanged when not an event stream (or no body). */
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
        // ⚠ The pump may have closed the controller between tick and here;
        // enqueueing on a closed controller throws, and that must not surface
        // as an unhandled rejection on an already-sent response.
        try {
          controller.enqueue(encoder.encode(KEEP_ALIVE_FRAME));
        } catch {
          stopTimer();
        }
      }, intervalMs);

      // ⚠ Deliberately NOT awaited: `start` must return so the Response reaches
      // the platform and its headers flush — awaiting reintroduces the buffering
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
      // ⚠ Client hung up: stop the timer or the interval outlives the request
      // and holds the function open to its maxDuration.
      stopTimer();
      return reader.cancel(reason);
    },
  });

  const headers = new Headers(response.headers);
  // Against a buffering reverse proxy: Vercel does not buffer
  // `text/event-stream`, a self-hosted nginx does unless told otherwise.
  headers.set("X-Accel-Buffering", "no");
  // ⚠ `no-cache` ONLY — never re-add `no-transform`. RFC 9111 §5.2.2.6 makes it
  // forbid intermediaries from applying a content coding, i.e. it instructs the
  // CDN NOT to compress the largest agent-facing payloads the product serves
  // (P0-3). `X-Accel-Buffering: no` is what stops frame-holding; compression
  // does not buffer SSE (gzip/br flush per write) and decoded frames are
  // byte-identical either way.
  headers.set("Cache-Control", "no-cache");

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
