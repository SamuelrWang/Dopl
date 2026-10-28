/**
 * `DoplError`: every failure the SDK throws, shaped after the one C10 error body
 * (`{ error: { type, code, message, device_kind?, retryable, doc_url } }`).
 *
 * A response that is not a C10 body (a proxy's HTML 502, a network failure, a key refused client
 * side) still becomes a `DoplError`, with `code` from {@link SdkOnlyErrorCode} so callers switch on
 * one field either way.
 */
import type { DeviceKind, ErrorBody, ErrorCode, ErrorType } from "@dopl/device-contracts";

/** Codes the SDK itself raises when the server sent no C10 body. Never sent by the API. */
export type SdkOnlyErrorCode = "network_error" | "unexpected_response" | "publishable_key_not_allowed" | "timeout";

export const DOC_BASE = "https://www.usedopl.com/docs/errors/";

export interface DoplErrorInit {
  type: ErrorType;
  code: ErrorCode | SdkOnlyErrorCode;
  message: string;
  retryable: boolean;
  doc_url: string;
  device_kind?: DeviceKind;
  status?: number | null;
  requestId?: string | null;
}

export class DoplError extends Error {
  readonly type: ErrorType;
  readonly code: ErrorCode | SdkOnlyErrorCode;
  readonly retryable: boolean;
  readonly docUrl: string;
  readonly deviceKind: DeviceKind | undefined;
  /** HTTP status, or null when no response arrived. */
  readonly status: number | null;
  /** The server's request id (`Request-Id` / `X-Request-Id` header) when it sent one. */
  readonly requestId: string | null;

  constructor(init: DoplErrorInit) {
    super(init.message);
    this.name = "DoplError";
    this.type = init.type;
    this.code = init.code;
    this.retryable = init.retryable;
    this.docUrl = init.doc_url;
    this.deviceKind = init.device_kind;
    this.status = init.status ?? null;
    this.requestId = init.requestId ?? null;
  }

  /** Build from a C10 body (an HTTP error or a failed action's `error`). */
  static fromBody(body: ErrorBody, status: number | null, requestId: string | null): DoplError {
    return new DoplError({ ...body, status, requestId });
  }
}

const ERROR_TYPES: readonly string[] = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "rate_limit_error",
  "device_error",
  "api_error",
];

/** True when `value` looks like a C10 `{ error: {...} }` body. Light check: the server owns the schema. */
export function isErrorResponse(value: unknown): value is { error: ErrorBody } {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === "string" && typeof e.message === "string" && ERROR_TYPES.includes(e.type as string);
}

/** A response that carried no C10 body (HTML, empty, truncated). */
export function unexpectedResponse(status: number, requestId: string | null): DoplError {
  return new DoplError({
    type: "api_error",
    code: "unexpected_response",
    message: `Dopl returned HTTP ${status} without an error body.`,
    retryable: status >= 500 || status === 429,
    doc_url: DOC_BASE,
    status,
    requestId,
  });
}

/** fetch itself threw: DNS, TLS, connection reset, abort. */
export function networkError(cause: unknown): DoplError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new DoplError({
    type: "api_error",
    code: "network_error",
    message: `Could not reach Dopl: ${detail}`,
    retryable: true,
    doc_url: DOC_BASE,
  });
}
