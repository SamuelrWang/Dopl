/**
 * The one HTTP path every SDK method takes: Bearer auth, JSON in and out, the optional
 * `Idempotency-Key` header, C10 error mapping, and the client side `pk_` refusal.
 *
 * Key safety: the key lives only in a closure here. It is never logged, never put in an error
 * message, and never placed in a URL.
 */
import { DOC_BASE, DoplError, isErrorResponse, networkError, unexpectedResponse } from "./errors.js";

export const DEFAULT_BASE_URL = "https://www.usedopl.com/api/v1";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RequestSpec {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path below the base URL, already encoded, starting with `/`. */
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  /** Only `POST /connect_sessions` sets this: the one route a publishable key may call. */
  allowPublishable?: boolean;
  signal?: AbortSignal;
}

export type Transport = <T>(spec: RequestSpec) => Promise<T>;

export interface TransportOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Extra headers on every request (for example a pinned API version). */
  headers?: Record<string, string>;
}

export const isPublishableKey = (key: string): boolean => key.startsWith("pk_");

function requestIdOf(res: Response): string | null {
  return res.headers.get("request-id") ?? res.headers.get("x-request-id");
}

function publishableRefusal(): DoplError {
  return new DoplError({
    type: "permission_error",
    code: "publishable_key_not_allowed",
    message:
      "A publishable (pk_) key can only create Connect sessions. Use a secret key (sk_test_ or sk_live_) on your server for every other call.",
    retryable: false,
    doc_url: `${DOC_BASE}insufficient-scope`,
  });
}

export function createTransport(opts: TransportOptions): Transport {
  const apiKey = opts.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new DoplError({
      type: "authentication_error",
      code: "unauthenticated",
      message: "Missing apiKey. Pass new Dopl({ apiKey }) with a key from your Dopl project.",
      retryable: false,
      doc_url: `${DOC_BASE}unauthenticated`,
    });
  }
  const publishable = isPublishableKey(apiKey);
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const extraHeaders = opts.headers ?? {};

  return async function request<T>(spec: RequestSpec): Promise<T> {
    if (publishable && !spec.allowPublishable) throw publishableRefusal();

    const headers: Record<string, string> = {
      ...extraHeaders,
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (spec.body !== undefined) headers["Content-Type"] = "application/json";
    if (spec.idempotencyKey !== undefined) headers["Idempotency-Key"] = spec.idempotencyKey;

    let res: Response;
    try {
      res = await doFetch(baseUrl + spec.path, {
        method: spec.method,
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: spec.signal,
      });
    } catch (cause) {
      throw networkError(cause);
    }

    const requestId = requestIdOf(res);
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }

    if (!res.ok) {
      if (isErrorResponse(parsed)) throw DoplError.fromBody(parsed.error, res.status, requestId);
      throw unexpectedResponse(res.status, requestId);
    }
    if (parsed === undefined) throw unexpectedResponse(res.status, requestId);
    return parsed as T;
  };
}

/** Encode one path segment. */
export const seg = (value: string): string => encodeURIComponent(value);
