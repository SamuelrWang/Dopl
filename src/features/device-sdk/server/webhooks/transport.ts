import { request as httpsRequest } from "node:https";
import { BlockedAddressError, guardedLookup, parseEndpointUrl } from "./url-guard";

/**
 * One webhook POST. Never throws: every failure is a {@link TransportResult} with `statusCode: null`
 * and an `error` that is ONE OF {@link CONNECT_ERROR_CLASSES}, never the raw socket / TLS / DNS text
 * (ruled 2026-10-28: raw connection errors would turn the attempt log into a port and service
 * scanner). Only a real HTTP answer carries detail: its status and the first 1 KiB of its body.
 *
 * Rules (ruled): https on port 443 or 8443 only, connect only to addresses `guardedLookup` approved,
 * redirects NOT followed (a 3xx is a failure), {@link WEBHOOK_TIMEOUT_MS} for the whole exchange,
 * at most {@link RESPONSE_BODY_CAP} bytes of the response read (the socket is dropped after that).
 */

export const WEBHOOK_TIMEOUT_MS = 15_000;
export const RESPONSE_BODY_CAP = 1024;
export const WEBHOOK_USER_AGENT = "Dopl-Webhooks/1";

/** What a connection-phase failure is reported as. */
export const CONNECT_ERROR_CLASSES = [
  "dns_failed",
  "connect_refused",
  "tls_failed",
  "timeout",
  "address_blocked",
  "url_refused",
  "connect_failed",
] as const;
export type ConnectErrorClass = (typeof CONNECT_ERROR_CLASSES)[number];

const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA", "ESERVFAIL", "ENONAME"]);
const REFUSED_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

class TimeoutError extends Error {}

/** The class of a connection-phase error. Anything unrecognised is `connect_failed`. */
export function classifyError(err: unknown): ConnectErrorClass {
  if (err instanceof BlockedAddressError) return "address_blocked";
  if (err instanceof TimeoutError) return "timeout";
  const code = typeof err === "object" && err !== null ? String((err as { code?: unknown }).code ?? "") : "";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (DNS_CODES.has(code)) return "dns_failed";
  if (REFUSED_CODES.has(code)) return "connect_refused";
  if (code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL") || code.includes("CERT") || code === "EPROTO" || code.includes("SIGNATURE")) {
    return "tls_failed";
  }
  return "connect_failed";
}

/** Postgres text cannot hold NUL; a response body with one must never fail the attempt record. */
export const stripNul = (s: string): string => s.replace(/\u0000/g, "");

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
    if (!parsed.ok) return done({ statusCode: null, error: "url_refused", responseBody: null });

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
      return done({ statusCode: null, error: classifyError(err), responseBody: null });
    }

    const deadline = setTimeout(() => {
      r.destroy(new TimeoutError());
    }, WEBHOOK_TIMEOUT_MS);

    r.on("timeout", () => r.destroy(new TimeoutError()));
    r.on("error", (err) => {
      clearTimeout(deadline);
      done({ statusCode: null, error: classifyError(err), responseBody: null });
    });
    r.on("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = () => {
        clearTimeout(deadline);
        const text = stripNul(Buffer.concat(chunks).subarray(0, RESPONSE_BODY_CAP).toString("utf8"));
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

/** 2xx only. A redirect is not followed and counts as a failure. */
export const isSuccess = (statusCode: number | null): boolean => statusCode !== null && statusCode >= 200 && statusCode < 300;
