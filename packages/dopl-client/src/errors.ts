export class DoplApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string, message?: string) {
    super(message ?? `Dopl API error ${status}: ${responseBody}`);
    this.name = "DoplApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class DoplAuthError extends DoplApiError {
  constructor(status: number, responseBody: string) {
    super(status, responseBody, `Dopl auth failed (${status}): ${responseBody}`);
    this.name = "DoplAuthError";
  }
}

export class DoplNetworkError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DoplNetworkError";
    this.cause = cause;
  }
}

export class DoplTimeoutError extends DoplNetworkError {
  constructor(method: string, path: string, timeoutMs: number) {
    super(`Dopl API request timed out after ${timeoutMs}ms: ${method} ${path}`);
    this.name = "DoplTimeoutError";
  }
}
