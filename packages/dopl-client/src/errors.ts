export interface ParsedApiError {
  code: string | null;
  apiMessage: string | null;
  details: unknown;
  /**
   * Upgrade link carried by the flat entitlement-denial envelope
   * (`{ error: "over_free_cap", message, upgrade_url }`). Null for the
   * canonical `{ error: { code, message } }` shape.
   */
  upgradeUrl: string | null;
}

const EMPTY: ParsedApiError = {
  code: null,
  apiMessage: null,
  details: undefined,
  upgradeUrl: null,
};

export function parseApiErrorBody(body: string): ParsedApiError {
  if (!body) return EMPTY;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const record = parsed as Record<string, unknown>;
    const error = record.error;

    // Canonical envelope: { error: { code, message, details } }.
    if (error && typeof error === "object") {
      const inner = error as Record<string, unknown>;
      return {
        code: typeof inner.code === "string" ? inner.code : null,
        apiMessage: typeof inner.message === "string" ? inner.message : null,
        details: "details" in inner ? inner.details : undefined,
        upgradeUrl: null,
      };
    }

    // Flat entitlement-denial envelope, e.g. the ontology free-plan object
    // cap: { error: "over_free_cap", message, upgrade_url }. Distinct shape
    // by design — surface its human message + upgrade link instead of a raw
    // "HTTP 403" body dump.
    if (typeof error === "string") {
      return {
        code: error,
        apiMessage: typeof record.message === "string" ? record.message : null,
        details: undefined,
        upgradeUrl:
          typeof record.upgrade_url === "string" ? record.upgrade_url : null,
      };
    }

    return EMPTY;
  } catch {
    return EMPTY;
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
  /** Upgrade link from an entitlement-denial body (else null). */
  readonly upgradeUrl: string | null;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    const parsed = parseApiErrorBody(responseBody);
    const message =
      parsed.apiMessage && parsed.upgradeUrl
        ? `${parsed.apiMessage} Upgrade: ${parsed.upgradeUrl}`
        : parsed.code && parsed.apiMessage
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
    this.upgradeUrl = parsed.upgradeUrl;
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
