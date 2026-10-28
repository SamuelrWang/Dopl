/**
 * C10 — errors, versioning, test-mode magic ids (docs/specs/device-sdk/SPEC-v1.md › C10).
 *
 * One error shape on every route: `{ error: { type, code, message, device_kind?, retryable, doc_url } }`.
 * Every code has a type, an HTTP status, a retryable default and a doc slug; `doc_url` is
 * `ERROR_DOC_BASE + slug`.
 */
import { z } from "zod";

import { DeviceKindSchema } from "./capabilities";

export const ERROR_TYPES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "rate_limit_error",
  "device_error",
  "api_error",
] as const;
export const ErrorTypeSchema = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

/**
 * The eight spec codes first (C10), then the generic request codes every `/v1` route needs
 * (bad body, bad key, key lacks scope, unknown id, idempotency key reused with a different body).
 */
export const ERROR_CODES = [
  "device_offline",
  "capability_unsupported",
  "grant_missing",
  "grant_expired",
  "confirmation_denied",
  "rate_limited",
  "vendor_error",
  "needs_reauth",
  "invalid_request",
  "unauthenticated",
  "insufficient_scope",
  "not_found",
  "idempotency_conflict",
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_DOC_BASE = "https://www.usedopl.com/docs/errors/";

export interface ErrorCodeInfo {
  type: ErrorType;
  status: number;
  retryable: boolean;
  /** Kebab-case page slug under {@link ERROR_DOC_BASE}. */
  doc_slug: string;
}

export const ERROR_CODE_INFO = {
  device_offline: { type: "device_error", status: 409, retryable: true, doc_slug: "device-offline" },
  capability_unsupported: { type: "invalid_request_error", status: 422, retryable: false, doc_slug: "capability-unsupported" },
  grant_missing: { type: "permission_error", status: 403, retryable: false, doc_slug: "grant-missing" },
  grant_expired: { type: "permission_error", status: 403, retryable: false, doc_slug: "grant-expired" },
  confirmation_denied: { type: "permission_error", status: 403, retryable: false, doc_slug: "confirmation-denied" },
  rate_limited: { type: "rate_limit_error", status: 429, retryable: true, doc_slug: "rate-limited" },
  vendor_error: { type: "device_error", status: 502, retryable: true, doc_slug: "vendor-error" },
  needs_reauth: { type: "permission_error", status: 409, retryable: false, doc_slug: "needs-reauth" },
  invalid_request: { type: "invalid_request_error", status: 400, retryable: false, doc_slug: "invalid-request" },
  unauthenticated: { type: "authentication_error", status: 401, retryable: false, doc_slug: "unauthenticated" },
  insufficient_scope: { type: "permission_error", status: 403, retryable: false, doc_slug: "insufficient-scope" },
  not_found: { type: "invalid_request_error", status: 404, retryable: false, doc_slug: "not-found" },
  idempotency_conflict: { type: "invalid_request_error", status: 409, retryable: false, doc_slug: "idempotency-conflict" },
} as const satisfies Record<ErrorCode, ErrorCodeInfo>;

export const errorDocUrl = (code: ErrorCode): string => ERROR_DOC_BASE + ERROR_CODE_INFO[code].doc_slug;

export const ErrorBodySchema = z.object({
  type: ErrorTypeSchema,
  code: ErrorCodeSchema,
  message: z.string(),
  device_kind: DeviceKindSchema.optional(),
  retryable: z.boolean(),
  doc_url: z.url(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ErrorResponseSchema = z.object({ error: ErrorBodySchema });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Dated API versions, pinned per project (Stripe style). */
export const ApiVersionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type ApiVersion = z.infer<typeof ApiVersionSchema>;
/** The version these contracts freeze (SPEC-v1, 2026-10-27). */
export const DEVICE_SDK_API_VERSION = "2026-10-27";

/** Test mode: device ids that force a failure state (Plaid-sandbox style). */
export const TEST_MAGIC_DEVICE_IDS = {
  sim_device_offline: "device_offline",
  sim_confirm_denied: "confirmation_denied",
} as const satisfies Record<string, ErrorCode>;
