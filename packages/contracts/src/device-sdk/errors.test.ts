import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  ERROR_CODE_INFO,
  ERROR_DOC_BASE,
  ERROR_TYPES,
  ErrorResponseSchema,
  TEST_MAGIC_DEVICE_IDS,
  errorDocUrl,
} from "./errors.js";
import { expectRoundTrip } from "./test-fixtures.js";

const SPEC_CODES = [
  "device_offline",
  "capability_unsupported",
  "grant_missing",
  "grant_expired",
  "confirmation_denied",
  "rate_limited",
  "vendor_error",
  "needs_reauth",
];

describe("C10 errors", () => {
  it("contains every spec code", () => {
    for (const c of SPEC_CODES) expect(ERROR_CODES).toContain(c);
  });

  it("every code has a doc slug, a type and a status", () => {
    const slugs = new Set<string>();
    for (const code of ERROR_CODES) {
      const info = ERROR_CODE_INFO[code];
      expect(info.doc_slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ERROR_TYPES).toContain(info.type);
      expect(info.status).toBeGreaterThanOrEqual(400);
      expect(errorDocUrl(code)).toBe(ERROR_DOC_BASE + info.doc_slug);
      slugs.add(info.doc_slug);
    }
    expect(slugs.size).toBe(ERROR_CODES.length);
    expect(Object.keys(ERROR_CODE_INFO).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("round-trips the error shape, with and without device_kind", () => {
    expectRoundTrip(ErrorResponseSchema, {
      error: {
        type: "device_error",
        code: "device_offline",
        message: "The glasses have not been seen for 120s.",
        device_kind: "glasses",
        retryable: true,
        doc_url: errorDocUrl("device_offline"),
      },
    });
    expectRoundTrip(ErrorResponseSchema, {
      error: { type: "rate_limit_error", code: "rate_limited", message: "Slow down.", retryable: true, doc_url: errorDocUrl("rate_limited") },
    });
  });

  it("magic test ids map to real codes", () => {
    for (const code of Object.values(TEST_MAGIC_DEVICE_IDS)) expect(ERROR_CODES).toContain(code);
  });
});
