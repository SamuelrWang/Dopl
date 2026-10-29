import { request as httpsRequest } from "node:https";
import { guardedLookup, parseEndpointUrl } from "./url-guard";

/**
 * One webhook POST. Never throws: every failure is a {@link TransportResult} with `statusCode: null`
 * and an `error`. Rules (ruled): https only, connect only to addresses `guardedLookup` approved,
 * redirects NOT followed (a 3xx is a failure), {@link WEBHOOK_TIMEOUT_MS} for the whole exchange,
 * at most {@link RESPONSE_BODY_CAP} bytes of the response read (the socket is dropped after that).
 */

export const WEBHOOK_TIMEOUT_MS = 15_000;
export const RESPONSE_BODY_CAP = 1024;
export const WEBHOOK_USER_AGENT = "Dopl-Webhooks/1";

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface TransportResult {
  statusCode: number | null;
  error: string | null;
  responseBody: string | null;
  durationMs: number;
}

export type Transport = (req: TransportRequest) => Promise<TransportResult>;

export const httpsTransport: Transport = (req) =>
  new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const done = (r: Omit<TransportResult, "durationMs">) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, durationMs: Math.round(performance.now() - started) });
    };

    // Re-check the stored URL: rows written before a guard change must not bypass it.
    const parsed = parseEndpointUrl(req.url);
    if (!parsed.ok) return done({ statusCode: null, error: `refused: ${parsed.reason}`, responseBody: null });

    const body = Buffer.from(req.body, "utf8");
    let r: ReturnType<typeof httpsRequest>;
    try {
      r = httpsRequest(parsed.url, {
        method: "POST",
        lookup: guardedLookup as never,
        headers: {
          ...req.headers,
          "content-type": "application/json",
          "content-length": String(body.length),
          "user-agent": WEBHOOK_USER_AGENT,
        },
        timeout: WEBHOOK_TIMEOUT_MS,
      });
    } catch (err) {
      return done({ statusCode: null, error: errorText(err), responseBody: null });
    }

    const deadline = setTimeout(() => {
      r.destroy(new Error(`timed out after ${WEBHOOK_TIMEOUT_MS}ms`));
    }, WEBHOOK_TIMEOUT_MS);

    r.on("timeout", () => r.destroy(new Error(`timed out after ${WEBHOOK_TIMEOUT_MS}ms`)));
    r.on("error", (err) => {
      clearTimeout(deadline);
      done({ statusCode: null, error: errorText(err), responseBody: null });
    });
    r.on("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = () => {
        clearTimeout(deadline);
        const text = Buffer.concat(chunks).subarray(0, RESPONSE_BODY_CAP).toString("utf8");
        done({ statusCode: res.statusCode ?? null, error: null, responseBody: text.length > 0 ? text : null });
      };
      res.on("data", (chunk: Buffer) => {
        if (size >= RESPONSE_BODY_CAP) return;
        chunks.push(chunk);
        size += chunk.length;
        if (size >= RESPONSE_BODY_CAP) {
          finish();
          res.destroy();
        }
      });
      res.on("end", finish);
      res.on("error", finish);
    });
    r.end(body);
  });

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

/** 2xx only. A redirect is not followed and counts as a failure. */
export const isSuccess = (statusCode: number | null): boolean => statusCode !== null && statusCode >= 200 && statusCode < 300;
