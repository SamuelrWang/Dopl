export interface ParsedApiError {
  code: string | null;
  apiMessage: string | null;
  details: unknown;
}

export function parseApiErrorBody(body: string): ParsedApiError {
  if (!body) return { code: null, apiMessage: null, details: undefined };
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { code: null, apiMessage: null, details: undefined };
    }
    const error = (parsed as { error?: unknown }).error;
    if (!error || typeof error !== "object") {
      return { code: null, apiMessage: null, details: undefined };
    }
    const record = error as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? record.code : null,
      apiMessage: typeof record.message === "string" ? record.message : null,
      details: "details" in record ? record.details : undefined,
    };
  } catch {
    return { code: null, apiMessage: null, details: undefined };
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

export class DoplApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly apiMessage: string | null;
  readonly details: unknown;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    const parsed = parseApiErrorBody(responseBody);
    const message =
      parsed.code && parsed.apiMessage
        ? `${parsed.code}: ${parsed.apiMessage}`
        : parsed.apiMessage
          ? parsed.apiMessage
          : `HTTP ${status}: ${truncate(responseBody, 200)}`;
    super(message);
    this.name = "DoplApiError";
    this.status = status;
    this.code = parsed.code;
    this.apiMessage = parsed.apiMessage;
    this.details = parsed.details;
    this.responseBody = responseBody;
  }
}

export class DoplAuthError extends DoplApiError {
  constructor(status: number, responseBody: string) {
    super(status, responseBody);
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
