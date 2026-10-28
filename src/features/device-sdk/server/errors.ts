import { NextResponse } from "next/server";
import { ERROR_CODE_INFO, errorDocUrl, type ErrorCode, type ErrorResponse } from "../types";

/**
 * The C10 error response: `{ error: { type, code, message, retryable, doc_url } }` with the code's
 * HTTP status. Type, status, retryable and doc slug all come from the contracts table; a route only
 * chooses the code and the message. A 401 carries `WWW-Authenticate: Bearer` (RFC 6750).
 */
export function devSdkError(code: ErrorCode, message: string): NextResponse<ErrorResponse> {
  const info = ERROR_CODE_INFO[code];
  const body: ErrorResponse = {
    error: {
      type: info.type,
      code,
      message,
      retryable: info.retryable,
      doc_url: errorDocUrl(code),
    },
  };
  const headers: Record<string, string> = {};
  if (info.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="dopl"';
  if (code === "insufficient_scope") headers["WWW-Authenticate"] = 'Bearer realm="dopl", error="insufficient_scope"';
  const res = NextResponse.json(body, { status: info.status, headers });
  codeOf.set(res, code);
  return res;
}

/** Which C10 code a response was built with (for the event row), without reading its body. */
const codeOf = new WeakMap<Response, ErrorCode>();
export function devSdkErrorCode(res: Response): ErrorCode | null {
  return codeOf.get(res) ?? null;
}
