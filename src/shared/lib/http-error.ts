/**
 * Typed error for route handlers. Thrown from service/route code and converted
 * by the caller's catch helper (`toHttpErrorResponse` and its feature wrappers)
 * into the ENGINEERING §9 body shape `{ error: { code, message, details? } }`.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toResponseBody(): {
    error: { code: string; message: string; details?: unknown };
  } {
    const body: { code: string; message: string; details?: unknown } = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) {
      body.details = this.details;
    }
    return { error: body };
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Unauthorized"): HttpError {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden"): HttpError {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Not found"): HttpError {
    return new HttpError(404, "NOT_FOUND", message);
  }

  static conflict(message: string, details?: unknown): HttpError {
    return new HttpError(409, "CONFLICT", message, details);
  }

  static tooManyRequests(message = "Too many requests"): HttpError {
    return new HttpError(429, "TOO_MANY_REQUESTS", message);
  }

  static internal(message = "Internal server error"): HttpError {
    return new HttpError(500, "INTERNAL_ERROR", message);
  }
}
